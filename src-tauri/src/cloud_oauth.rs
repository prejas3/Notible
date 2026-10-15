use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use reqwest::Client;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, net::TcpListener, time::Duration};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::calendar_oauth::GOOGLE_CLIENT_ID;

pub(crate) fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn pkce() -> (String, String) {
    let verifier = random_token();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

/// The page the browser shows after the redirect. A browser will not let a
/// page close a tab it did not open, so the tab stays: it has to read as the
/// end of signing in (Notible's mark, one sentence), not as a debug line, and
/// `callback` brings the app window forward so the user lands back in it.
/// Text only, no data from the request, so nothing here needs escaping.
/// Always English, whatever the browser's language.
fn callback_page(ok: bool) -> String {
    let (title, body) = if ok {
        ("You\u{2019}re signed in", "Notible is connected. You can close this tab and go back to the app.")
    } else {
        ("Sign-in didn\u{2019}t finish", "Nothing was connected. Go back to Notible and try again.")
    };
    let accent = if ok { "#7557E8" } else { "#D05A5A" };
    format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · Notible</title><link rel="icon" href="data:,">
<style>
:root{{color-scheme:light dark;--bg:#F3F0E8;--text:#090B0D;--muted:#5C5F66}}
@media (prefers-color-scheme:dark){{:root{{--bg:#090B0D;--text:#F3F0E8;--muted:#9A9DA5}}}}
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px/1.55 "Segoe UI",system-ui,-apple-system,sans-serif}}
main{{display:grid;justify-items:center;gap:14px;max-width:420px;padding:24px;text-align:center}}
svg{{width:64px;height:64px;margin-bottom:8px}}
h1{{margin:0;font-size:22px;font-weight:600}}
p{{margin:0;color:var(--muted)}}
</style></head><body><main>
{icon}
<h1>{title}</h1><p>{body}</p>
</main></body></html>"#,
        icon = include_str!("../../public/brand/notible-icon.svg").replace("#7557E8", accent),
    )
}

/// Waits for the provider's redirect on the loopback listener, answers it
/// with `callback_page`, and returns the authorization code. Shared by every
/// provider (plugin Google sign-in, calendars, cloud).
pub(crate) fn callback(app: &AppHandle, listener: TcpListener, expected_state: String) -> Result<String, String> {
    listener.set_nonblocking(false).map_err(|e| e.to_string())?;
    let server = tiny_http::Server::from_listener(listener, None).map_err(|e| e.to_string())?;
    let request = server
        .recv_timeout(Duration::from_secs(180))
        .map_err(|e| e.to_string())?
        .ok_or("Sign-in timed out. Try again.")?;
    let url = Url::parse(&format!("http://127.0.0.1{}", request.url())).map_err(|e| e.to_string())?;
    let params: HashMap<_, _> = url.query_pairs().into_owned().collect();
    let valid = params.get("state") == Some(&expected_state);
    let ok = valid && params.contains_key("code") && !params.contains_key("error");
    let response = tiny_http::Response::from_string(callback_page(ok)).with_header(
        "Content-Type: text/html; charset=utf-8"
            .parse::<tiny_http::Header>()
            .unwrap(),
    );
    let _ = request.respond(response);
    crate::show_main_window(app);
    if !valid {
        return Err("Sign-in failed: the reply did not match this request.".into());
    }
    if let Some(error) = params.get("error") {
        return Err(format!("Sign-in was declined ({error})."));
    }
    params.get("code").cloned().ok_or_else(|| "Sign-in failed: no authorization code came back.".into())
}

#[tauri::command]
pub async fn cloud_google_login(app: AppHandle, endpoint: String) -> Result<String, String> {
    let endpoint = endpoint.trim().trim_end_matches('/').to_string();
    if !(endpoint.starts_with("https://") || endpoint.starts_with("http://localhost")) {
        return Err("Cloud endpoint must use HTTPS (or localhost during development)".into());
    }

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let state = random_token();
    let (verifier, challenge) = pkce();
    let mut authorize = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    authorize
        .query_pairs_mut()
        .append_pair("client_id", GOOGLE_CLIENT_ID)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "online")
        .append_pair("prompt", "select_account");
    app.opener()
        .open_url(authorize.as_str(), None::<&str>)
        .map_err(|e| format!("Could not open Google sign-in: {e}"))?;

    let handle = app.clone();
    let code = tauri::async_runtime::spawn_blocking(move || callback(&handle, listener, state))
        .await
        .map_err(|e| e.to_string())??;
    let client = Client::new();
    let session_response = client
        .post(format!("{endpoint}/v1/auth/google/exchange"))
        .json(&serde_json::json!({
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": redirect_uri,
        }))
        .send()
        .await
        .map_err(|e| format!("Notible sign-in request failed: {e}"))?;
    let session_status = session_response.status();
    let body = session_response.text().await.map_err(|e| e.to_string())?;
    if !session_status.is_success() {
        let message = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value.get("error").and_then(|error| error.as_str()).map(str::to_owned))
            .unwrap_or_else(|| format!("Notible sign-in failed ({session_status})"));
        return Err(message);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::callback_page;

    #[test]
    fn callback_page_is_a_whole_english_page() {
        for (ok, text) in [(true, "signed in"), (false, "try again")] {
            let page = callback_page(ok);
            assert!(page.contains(text) && page.contains("lang=\"en\"") && page.contains("<svg") && page.ends_with("</html>"), "{page}");
            if let Ok(dir) = std::env::var("NOTIBLE_DUMP_CALLBACK_PAGE") {
                std::fs::write(format!("{dir}/callback-{ok}.html"), &page).unwrap();
            }
        }
    }
}
