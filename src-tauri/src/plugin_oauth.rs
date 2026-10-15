//! Google sign-in for plugins, without a code to copy by hand.
//!
//! The device flow a plugin can run on its own ("open google.com/device and
//! type ABCD-EFGH") exists for televisions. Notible is a desktop app that can
//! listen on a loopback port, so it can use the flow meant for one: open the
//! browser, catch the redirect on `127.0.0.1`, done. No code, no typing.
//!
//! A plugin cannot do this itself — it has no socket — so the command lives
//! here. And because EVERY registered command is reachable from EVERY plugin
//! in the webview, it is written as if the caller were hostile.
//!
//! The one thing that matters: **the caller does not choose the client id or
//! the scopes.** If it did, a hostile plugin could put a real Google consent
//! screen in front of the user asking for Gmail, or for full Drive, against
//! an OAuth client the attacker controls, and receive the code. Instead the
//! caller names a provider from the list below and Core supplies both. The
//! worst a plugin can obtain is what `Provider::scopes` already grants to the
//! sync plugin — which it could reach anyway, since the sync plugin's own
//! credentials sit in a readable plugin file.
//!
//! Since API 1.21 that also includes `google.identity`: the user's e-mail,
//! name and a Google-signed ID token for this client. Any plugin with
//! `network` can ask for it (Google shows the account chooser each time), so a
//! server that trusts these tokens (Notible Teams) must not treat "has a valid
//! token" as "is the Teams plugin" -- it keeps its own allowlist.

use serde::Serialize;
use std::{collections::HashMap, net::TcpListener};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::cloud_oauth::{callback, pkce, random_token};

/// Client id and secret for the "Notible Sync" OAuth client (type: Desktop
/// app). Google requires the secret in the token exchange even with PKCE for
/// installed apps, and an installed app has nowhere to hide one — this is the
/// same acknowledged trade-off as the calendar client. The mitigation is the
/// same too: a dedicated client whose consent screen lists `drive.file` and
/// the basic identity scopes and nothing else, so a leak of these strings cannot be turned into a request
/// for Gmail or full Drive.
const SYNC_CLIENT_ID: &str =
    "73659392730-coll1lrb1f8av6rhg65u24innjn3plnk.apps.googleusercontent.com";

/// The desktop-app client secret, kept out of version control. The local value
/// lives in the git-ignored `.cargo/config.toml` (`[env]` table) and is
/// embedded at build time via `option_env!`, exactly like the calendar client
/// (`calendar_oauth.rs`). An installed app still ships it in the binary — the
/// mitigation is the `drive.file`-only scope, not secrecy.
fn sync_client_secret() -> String {
    std::env::var("NOTIBLE_SYNC_GOOGLE_CLIENT_SECRET")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| option_env!("NOTIBLE_SYNC_GOOGLE_CLIENT_SECRET").map(str::to_owned))
        .unwrap_or_default()
}

/// The providers a plugin may ask for, by name. Adding one here widens what
/// every installed plugin can reach; read the module comment first.
enum Provider {
    /// Files this application created on the user's Drive. Not the rest of
    /// the Drive, and no other Google product.
    GoogleDriveFile,
    /// Who the user is: a Google-signed ID token with their e-mail and name.
    /// Nothing on their Drive or in any other Google product. Added in API
    /// 1.21 so a plugin can prove the user's identity to its own server
    /// (Notible Teams) without Core knowing that server.
    GoogleIdentity,
}

impl Provider {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "google.drive.file" => Ok(Self::GoogleDriveFile),
            "google.identity" => Ok(Self::GoogleIdentity),
            other => Err(format!("unknown sign-in provider: {other}")),
        }
    }

    fn client(&self) -> (&'static str, String) {
        match self {
            Self::GoogleDriveFile | Self::GoogleIdentity => (SYNC_CLIENT_ID, sync_client_secret()),
        }
    }

    fn scopes(&self) -> &'static str {
        match self {
            Self::GoogleDriveFile => "https://www.googleapis.com/auth/drive.file",
            Self::GoogleIdentity => "openid email profile",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleGrant {
    /// Absent for `google.identity`, which is a one-time sign-in.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    pub access_token: String,
    /// Seconds, as Google reports it.
    pub expires_in: u64,
    /// Only for `google.identity`: the signed ID token (JWT) a server can
    /// verify against Google's keys. Audience: the Notible Sync client id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleAccessToken {
    pub access_token: String,
    pub expires_in: u64,
}

/// Read a token response, turning Google's error shape into a message rather
/// than a silent empty string.
fn read_token_response(body: &str) -> Result<serde_json::Value, String> {
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|e| format!("Google returned an unreadable response: {e}"))?;
    if let Some(error) = value.get("error") {
        let description = value
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| error.as_str().unwrap_or("unknown error"));
        return Err(format!("Google refused the request: {description}"));
    }
    Ok(value)
}

fn string_field(value: &serde_json::Value, field: &str) -> Result<String, String> {
    value
        .get(field)
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .ok_or_else(|| format!("Google's response had no {field}"))
}

/// Sign in through the system browser and return the tokens.
///
/// Blocks until the user finishes or the callback times out (three minutes,
/// enforced by `callback`). The refresh token goes back to the caller because
/// the plugin already stores one; Core keeping it instead would move the
/// secret without removing it, and would not survive the plugin being
/// uninstalled and reinstalled.
#[tauri::command]
pub async fn plugin_google_login(app: AppHandle, provider: String) -> Result<GoogleGrant, String> {
    let provider = Provider::parse(&provider)?;
    let (client_id, client_secret) = provider.client();

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let state = random_token();
    let (verifier, challenge) = pkce();

    let mut authorize = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    authorize
        .query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", provider.scopes())
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    let identity = matches!(provider, Provider::GoogleIdentity);
    if identity {
        // Identity is needed once, so no refresh token: one with `openid`
        // could mint fresh ID tokens for as long as it lives, in whatever
        // plugin storage it ended up in.
        authorize
            .query_pairs_mut()
            .append_pair("access_type", "online")
            .append_pair("prompt", "select_account");
    } else {
        // Without both of these Google returns no refresh token on a repeat
        // sign-in, and the plugin silently loses access at the first expiry.
        authorize
            .query_pairs_mut()
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");
    }
    app.opener()
        .open_url(authorize.as_str(), None::<&str>)
        .map_err(|e| format!("Could not open Google sign-in: {e}"))?;

    let handle = app.clone();
    let code = tauri::async_runtime::spawn_blocking(move || callback(&handle, listener, state))
        .await
        .map_err(|e| e.to_string())??;

    let mut form = HashMap::new();
    form.insert("code", code);
    form.insert("client_id", client_id.to_string());
    form.insert("client_secret", client_secret.to_string());
    form.insert("redirect_uri", redirect_uri);
    form.insert("grant_type", "authorization_code".to_string());
    form.insert("code_verifier", verifier);
    let body = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Google token request failed: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let value = read_token_response(&body)?;
    Ok(GoogleGrant {
        refresh_token: if identity { None } else { Some(string_field(&value, "refresh_token")?) },
        access_token: string_field(&value, "access_token")?,
        expires_in: value
            .get("expires_in")
            .and_then(|v| v.as_u64())
            .unwrap_or(3600),
        id_token: if identity { Some(string_field(&value, "id_token")?) } else { None },
    })
}

/// Trade a stored refresh token for a fresh access token.
///
/// The plugin cannot do this itself: the exchange needs the client secret,
/// and the whole point of moving the credentials here was that the plugin no
/// longer carries it.
#[tauri::command]
pub async fn plugin_google_access_token(
    provider: String,
    refresh_token: String,
) -> Result<GoogleAccessToken, String> {
    let provider = Provider::parse(&provider)?;
    let (client_id, client_secret) = provider.client();
    let mut form = HashMap::new();
    form.insert("refresh_token", refresh_token);
    form.insert("client_id", client_id.to_string());
    form.insert("client_secret", client_secret.to_string());
    form.insert("grant_type", "refresh_token".to_string());
    let body = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Google token refresh failed: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let value = read_token_response(&body)?;
    Ok(GoogleAccessToken {
        access_token: string_field(&value, "access_token")?,
        expires_in: value
            .get("expires_in")
            .and_then(|v| v.as_u64())
            .unwrap_or(3600),
    })
}

/// Let go of the grant on Google's side, not just locally.
#[tauri::command]
pub async fn plugin_google_revoke(refresh_token: String) -> Result<(), String> {
    // Google answers 200 for an already-invalid token, so a failure here is
    // a network problem, not "it was not revoked".
    reqwest::Client::new()
        .post("https://oauth2.googleapis.com/revoke")
        .form(&[("token", refresh_token)])
        .send()
        .await
        .map_err(|e| format!("Could not reach Google to revoke access: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_providers_are_accepted() {
        assert!(Provider::parse("google.drive.file").is_ok());
        assert!(Provider::parse("google.identity").is_ok());
        for attempt in [
            "google.drive",
            "https://www.googleapis.com/auth/gmail.readonly",
            "",
            "GOOGLE.DRIVE.FILE",
        ] {
            assert!(
                Provider::parse(attempt).is_err(),
                "a plugin must not be able to name its own scope: {attempt}"
            );
        }
    }

    #[test]
    fn identity_is_the_only_other_scope() {
        assert_eq!(Provider::GoogleIdentity.scopes(), "openid email profile");
    }

    #[test]
    fn the_only_scope_is_drive_file() {
        // Widening this is a decision, not a refactor: every installed plugin
        // can call the command that uses it.
        assert_eq!(
            Provider::GoogleDriveFile.scopes(),
            "https://www.googleapis.com/auth/drive.file"
        );
    }

    #[test]
    fn a_google_error_body_becomes_a_message() {
        let body =
            r#"{"error":"invalid_grant","error_description":"Token has been expired or revoked."}"#;
        let error = read_token_response(body).unwrap_err();
        assert!(error.contains("expired or revoked"), "got: {error}");
    }

    #[test]
    fn a_missing_field_is_reported_rather_than_defaulted() {
        let value = read_token_response(r#"{"access_token":"a"}"#).unwrap();
        assert!(string_field(&value, "refresh_token").is_err());
    }
}
