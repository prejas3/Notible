use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use keyring::Entry;
use rand::{distributions::Alphanumeric, Rng};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::net::TcpListener;
use std::sync::Mutex as StdMutex;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use url::Url;

const SERVICE: &str = "com.notible.calendar.oauth";
// OAuth client identifiers are public application identifiers, not secrets.
// Environment variables can still override them for branded/custom builds.
pub(crate) const GOOGLE_CLIENT_ID: &str =
    "73659392730-p802qoidm7line3esq3qliuifche06es.apps.googleusercontent.com";
const MICROSOFT_CLIENT_ID: &str = "965f86e2-f749-4187-a895-d559d51de9fb";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Google,
    Outlook,
}

impl Provider {
    fn key(self) -> &'static str {
        match self {
            Self::Google => "google",
            Self::Outlook => "outlook",
        }
    }
    fn client_id(self) -> Result<String, String> {
        let name = match self {
            Self::Google => "NOTIBLE_GOOGLE_CLIENT_ID",
            Self::Outlook => "NOTIBLE_MICROSOFT_CLIENT_ID",
        };
        std::env::var(name)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                Some(
                    match self {
                        Self::Google => {
                            option_env!("NOTIBLE_GOOGLE_CLIENT_ID").unwrap_or(GOOGLE_CLIENT_ID)
                        }
                        Self::Outlook => option_env!("NOTIBLE_MICROSOFT_CLIENT_ID")
                            .unwrap_or(MICROSOFT_CLIENT_ID),
                    }
                    .to_owned(),
                )
            })
            .ok_or_else(|| format!("{name} is not configured"))
    }
    fn authorize_url(self) -> &'static str {
        match self {
            Self::Google => "https://accounts.google.com/o/oauth2/v2/auth",
            Self::Outlook => "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        }
    }

    fn client_secret(self) -> Option<String> {
        if self != Self::Google {
            return None;
        }
        // TODO(security, pre-public-release): remove the desktop credential from
        // distributed builds and exchange Google codes in the HTTPS token broker.
        // The current local value lives in the git-ignored .cargo/config.toml.
        std::env::var("NOTIBLE_GOOGLE_CLIENT_SECRET")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| option_env!("NOTIBLE_GOOGLE_CLIENT_SECRET").map(str::to_owned))
    }
    fn token_url(self) -> &'static str {
        match self {
            Self::Google => "https://oauth2.googleapis.com/token",
            Self::Outlook => "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        }
    }
    fn scope(self) -> &'static str {
        match self {
            Self::Google => "https://www.googleapis.com/auth/calendar.readonly",
            Self::Outlook => "offline_access https://graph.microsoft.com/Calendars.Read",
        }
    }

    fn redirect_uri(self, port: u16) -> String {
        match self {
            // Google documents the loopback IP redirect for native clients.
            Self::Google => format!("http://127.0.0.1:{port}"),
            // Entra's desktop flow accepts the localhost loopback redirect.
            Self::Outlook => format!("http://localhost:{port}"),
        }
    }
}

/// (provider, opaque handle) -> real provider calendar id, per process.
/// Disconnecting one provider drops only that provider's entries. A handle
/// that has aged out just makes the picker re-populate and the user re-tick —
/// a stored id is never a security value.
fn handle_map() -> &'static StdMutex<HashMap<(Provider, String), String>> {
    static MAP: OnceLock<StdMutex<HashMap<(Provider, String), String>>> = OnceLock::new();
    MAP.get_or_init(|| StdMutex::new(HashMap::new()))
}

/// Deterministic per (provider, real id) so a project's stored handle keeps
/// resolving across `list_sources` calls within a session.
fn source_handle(provider: Provider, real_id: &str) -> String {
    let digest = Sha256::digest(format!("{}:{}", provider.key(), real_id).as_bytes());
    format!("cal_{}", hex_lower(&digest[..8]))
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Providers currently mid sign-in; a `ConnectGuard` removes its entry on every
/// exit path (success, error, timeout).
fn connect_in_progress() -> &'static StdMutex<HashSet<&'static str>> {
    static SET: OnceLock<StdMutex<HashSet<&'static str>>> = OnceLock::new();
    SET.get_or_init(|| StdMutex::new(HashSet::new()))
}

struct ConnectGuard(&'static str);
impl Drop for ConnectGuard {
    fn drop(&mut self) {
        connect_in_progress().lock().unwrap().remove(self.0);
    }
}

/// Per-provider guard around the token-refresh path in `access_token`.
fn refresh_lock(provider: Provider) -> &'static tauri::async_runtime::Mutex<()> {
    static G: OnceLock<tauri::async_runtime::Mutex<()>> = OnceLock::new();
    static O: OnceLock<tauri::async_runtime::Mutex<()>> = OnceLock::new();
    match provider {
        Provider::Google => G.get_or_init(|| tauri::async_runtime::Mutex::new(())),
        Provider::Outlook => O.get_or_init(|| tauri::async_runtime::Mutex::new(())),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStatus {
    provider: Provider,
    configured: bool,
    connected: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    provider: Provider,
    connected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSource {
    id: String,
    name: String,
    primary: Option<bool>,
    color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    id: String,
    provider: Provider,
    calendar_id: String,
    title: String,
    start: String,
    end: String,
    all_day: bool,
    location: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredToken {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: u64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

async fn token_response(
    response: reqwest::Response,
    provider: Provider,
) -> Result<TokenResponse, String> {
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let details = serde_json::from_str::<Value>(&body).ok();
        let code = details
            .as_ref()
            .and_then(|value| value["error"].as_str())
            .unwrap_or("token_exchange_failed");
        let description = details
            .as_ref()
            .and_then(|value| value["error_description"].as_str())
            .unwrap_or_else(|| body.trim());
        let description = if description.is_empty() {
            status.as_str()
        } else {
            description
        };
        return Err(format!(
            "{} rejected the OAuth token exchange ({code}): {description}",
            match provider {
                Provider::Google => "Google",
                Provider::Outlook => "Microsoft",
            }
        ));
    }
    serde_json::from_str::<TokenResponse>(&body)
        .map_err(|e| format!("OAuth token response was invalid: {e}"))
}

async fn api_json(
    response: reqwest::Response,
    provider: Provider,
    operation: &str,
) -> Result<Value, String> {
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    let value = serde_json::from_str::<Value>(&body).ok();
    if !status.is_success() {
        let details = value
            .as_ref()
            .and_then(|json| json["error"]["message"].as_str())
            .or_else(|| {
                value
                    .as_ref()
                    .and_then(|json| json["error_description"].as_str())
            })
            .or_else(|| {
                value
                    .as_ref()
                    .and_then(|json| json["error"]["code"].as_str())
            })
            .unwrap_or_else(|| body.trim());
        let details = if details.is_empty() {
            status.as_str()
        } else {
            details
        };
        return Err(format!(
            "{} could not {operation} (HTTP {}): {details}",
            match provider {
                Provider::Google => "Google Calendar",
                Provider::Outlook => "Outlook Calendar",
            },
            status.as_u16()
        ));
    }
    value.ok_or_else(|| format!("{operation} returned an invalid JSON response"))
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn pkce() -> (String, String) {
    let verifier: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(96)
        .map(char::from)
        .collect();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

fn random_state() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

fn entry(provider: Provider) -> Result<Entry, String> {
    Entry::new(&crate::sandbox::keyring_service(SERVICE), provider.key()).map_err(|e| format!("secure token store unavailable: {e}"))
}

fn load_token(provider: Provider) -> Result<Option<StoredToken>, String> {
    match entry(provider)?.get_password() {
        Ok(value) => serde_json::from_str(&value)
            .map(Some)
            .map_err(|e| format!("invalid secure token: {e}")),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("secure token read failed: {e}")),
    }
}

fn save_token(provider: Provider, token: &StoredToken) -> Result<(), String> {
    entry(provider)?
        .set_password(&serde_json::to_string(token).map_err(|e| e.to_string())?)
        .map_err(|e| format!("secure token write failed: {e}"))
}

#[tauri::command]
pub fn calendar_oauth_status(provider: Provider) -> Result<OAuthStatus, String> {
    Ok(OAuthStatus {
        provider,
        configured: provider.client_id().is_ok(),
        connected: load_token(provider)?.is_some(),
    })
}

#[tauri::command]
pub fn calendar_disconnect(provider: Provider) -> Result<(), String> {
    handle_map()
        .lock()
        .unwrap()
        .retain(|(p, _), _| *p != provider);
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn calendar_connect(
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
    provider: Provider,
) -> Result<ConnectResult, String> {
    if !crate::calendar_sharing_allowed(&state)? {
        return Err("Reading your calendars is switched off. Turn on \u{201c}Let plugins read your calendars\u{201d} in Settings \u{2192} Files & links.".into());
    }
    let key = provider.key();
    if !connect_in_progress().lock().unwrap().insert(key) {
        return Err("a sign-in for this provider is already in progress".into());
    }
    let _guard = ConnectGuard(key);
    let client_id = provider.client_id()?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let redirect_uri =
        provider.redirect_uri(listener.local_addr().map_err(|e| e.to_string())?.port());
    let (verifier, challenge) = pkce();
    let state = random_state();
    let mut auth = Url::parse(provider.authorize_url()).unwrap();
    auth.query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", provider.scope())
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    if provider == Provider::Google {
        auth.query_pairs_mut()
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");
    }
    app.opener()
        .open_url(auth.as_str(), None::<&str>)
        .map_err(|e| e.to_string())?;
    let handle = app.clone();
    let code = tauri::async_runtime::spawn_blocking(move || crate::cloud_oauth::callback(&handle, listener, state))
        .await
        .map_err(|e| e.to_string())??;
    let client_secret = provider.client_secret();
    let mut token_form = vec![
        ("client_id", client_id.as_str()),
        ("code", code.as_str()),
        ("code_verifier", verifier.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
    ];
    if let Some(secret) = client_secret.as_deref() {
        token_form.push(("client_secret", secret));
    }
    let response = Client::new()
        .post(provider.token_url())
        .form(&token_form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = token_response(response, provider).await?;
    save_token(
        provider,
        &StoredToken {
            access_token: response.access_token,
            refresh_token: response.refresh_token,
            expires_at: now() + response.expires_in.unwrap_or(3600).saturating_sub(60),
        },
    )?;
    Ok(ConnectResult {
        provider,
        connected: true,
    })
}

async fn access_token(provider: Provider) -> Result<String, String> {
    let token = load_token(provider)?.ok_or("calendar provider is not connected")?;
    if token.expires_at > now() {
        return Ok(token.access_token);
    }
    let _refresh = refresh_lock(provider).lock().await;
    // Re-read the token: another caller may have refreshed while we waited.
    let mut token = load_token(provider)?.ok_or("calendar provider is not connected")?;
    if token.expires_at > now() {
        return Ok(token.access_token);
    }
    let refresh = token
        .refresh_token
        .clone()
        .ok_or("OAuth session expired; reconnect the provider")?;
    let client_id = provider.client_id()?;
    let client_secret = provider.client_secret();
    let mut refresh_form = vec![
        ("client_id", client_id.as_str()),
        ("refresh_token", refresh.as_str()),
        ("grant_type", "refresh_token"),
        ("scope", provider.scope()),
    ];
    if let Some(secret) = client_secret.as_deref() {
        refresh_form.push(("client_secret", secret));
    }
    let response = Client::new()
        .post(provider.token_url())
        .form(&refresh_form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let response = token_response(response, provider).await?;
    token.access_token = response.access_token;
    token.refresh_token = response.refresh_token.or(Some(refresh));
    token.expires_at = now() + response.expires_in.unwrap_or(3600).saturating_sub(60);
    save_token(provider, &token)?;
    Ok(token.access_token)
}

/// Raw `calendarList` items for the provider. Shared by `calendar_list_sources`
/// (build the picker) and `calendar_sync_project` (rebuild a stale handle map
/// on its own instead of failing).
async fn fetch_calendar_items(provider: Provider) -> Result<Vec<Value>, String> {
    let token = access_token(provider).await?;
    let url = match provider {
        Provider::Google => "https://www.googleapis.com/calendar/v3/users/me/calendarList",
        Provider::Outlook => "https://graph.microsoft.com/v1.0/me/calendars",
    };
    let response = Client::new()
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let value = api_json(response, provider, "list calendars").await?;
    Ok(match provider {
        Provider::Google => value["items"].as_array(),
        Provider::Outlook => value["value"].as_array(),
    }
    .cloned()
    .unwrap_or_default())
}

/// (opaque handle -> real id) for every item, into the process map.
fn populate_handle_map(provider: Provider, items: &[Value]) {
    let mut map = handle_map().lock().unwrap();
    for item in items {
        if let Some(real) = item["id"].as_str() {
            map.insert((provider, source_handle(provider, real)), real.to_string());
        }
    }
}

#[tauri::command]
pub async fn calendar_list_sources(
    state: tauri::State<'_, crate::AppState>,
    provider: Provider,
) -> Result<Vec<CalendarSource>, String> {
    if !crate::calendar_sharing_allowed(&state)? {
        return Err("Reading your calendars is switched off. Turn on \u{201c}Let plugins read your calendars\u{201d} in Settings \u{2192} Files & links.".into());
    }
    let items = fetch_calendar_items(provider).await?;
    populate_handle_map(provider, &items);
    Ok(items
        .into_iter()
        .filter_map(|v| {
            let real = v["id"].as_str()?.to_string();
            Some(CalendarSource {
                id: source_handle(provider, &real),
                name: v["summary"]
                    .as_str()
                    .or_else(|| v["name"].as_str())
                    .unwrap_or("Calendar")
                    .to_string(),
                primary: v["primary"]
                    .as_bool()
                    .or_else(|| v["isDefaultCalendar"].as_bool()),
                color: v["backgroundColor"]
                    .as_str()
                    .or_else(|| v["color"].as_str())
                    .map(str::to_string),
            })
        })
        .collect())
}

const MAX_CALENDARS_PER_SYNC: usize = 32;
const MAX_WINDOW_DAYS: i64 = 800;
const MAX_PAST_DAYS: i64 = 730;
const MAX_FUTURE_DAYS: i64 = 730;

/// Turn a bare `YYYY-MM-DD` into a full RFC3339 instant Google/Graph accept;
/// leave an already-qualified timestamp alone.
fn expand_bound(value: &str, end_of_day: bool) -> String {
    if value.len() == 10 && value.as_bytes().get(4) == Some(&b'-') {
        format!(
            "{value}T{}",
            if end_of_day { "23:59:59Z" } else { "00:00:00Z" }
        )
    } else {
        value.to_string()
    }
}

/// Proleptic-Gregorian day count from the leading `YYYY-MM-DD`; only used for
/// window-width and range comparisons, so the origin just has to be consistent.
fn day_number(value: &str) -> Option<i64> {
    use chrono::Datelike;
    let head = value.get(0..10)?;
    let date = chrono::NaiveDate::parse_from_str(head, "%Y-%m-%d").ok()?;
    Some(date.num_days_from_ce() as i64)
}

/// `YYYY-MM-DD` for today, UTC.
fn now_date() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

fn validate_sync_request(
    calendar_ids: &[String],
    time_min: &str,
    time_max: &str,
) -> Result<(), String> {
    if calendar_ids.is_empty() {
        return Err("no calendars selected".into());
    }
    if calendar_ids.len() > MAX_CALENDARS_PER_SYNC {
        return Err("too many calendars in one request".into());
    }
    let (Some(lo), Some(hi)) = (day_number(time_min), day_number(time_max)) else {
        return Err("time_min / time_max must start with YYYY-MM-DD".into());
    };
    if hi < lo || hi - lo > MAX_WINDOW_DAYS {
        return Err("requested calendar window is too wide".into());
    }
    if let Some(today) = day_number(&now_date()) {
        if lo < today - MAX_PAST_DAYS || hi > today + MAX_FUTURE_DAYS {
            return Err("requested calendar window is out of range".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn calendar_sync_project(
    state: tauri::State<'_, crate::AppState>,
    provider: Provider,
    calendar_ids: Vec<String>,
    time_min: String,
    time_max: String,
) -> Result<Vec<CalendarEvent>, String> {
    if !crate::calendar_sharing_allowed(&state)? {
        return Err("Reading your calendars is switched off. Turn on \u{201c}Let plugins read your calendars\u{201d} in Settings \u{2192} Files & links.".into());
    }
    validate_sync_request(&calendar_ids, &time_min, &time_max)?;
    let time_min = expand_bound(&time_min, false);
    let time_max = expand_bound(&time_max, true);

    // Resolve opaque handles to real calendar ids. A miss used to fail the
    // whole request ("unknown calendar"), so one stale connection — a calendar
    // removed from the account, or a leftover from a previous session before
    // the handle map was repopulated — killed sync for every calendar. Now:
    // rebuild the map once from the live calendar list on any miss, then drop
    // whatever still doesn't resolve and sync the rest.
    let resolve = move || {
        let map = handle_map().lock().unwrap();
        let mut hit: Vec<String> = Vec::new();
        let mut miss: Vec<String> = Vec::new();
        for handle in &calendar_ids {
            match map.get(&(provider, handle.clone())) {
                Some(real) => hit.push(real.clone()),
                None => miss.push(handle.clone()),
            }
        }
        (hit, miss)
    };
    let (mut real_ids, missed) = resolve();
    if !missed.is_empty() {
        if let Ok(items) = fetch_calendar_items(provider).await {
            populate_handle_map(provider, &items);
            let (retry_hit, _) = resolve();
            real_ids = retry_hit;
        }
    }
    if real_ids.is_empty() {
        return Err("none of this project's linked calendars are still on the connected account; open Connections and re-pick them".to_string());
    }

    let token = access_token(provider).await?;
    let client = Client::new();
    let mut output = Vec::new();
    for calendar_id in real_ids {
        let url = match provider {
            Provider::Google => format!(
                "https://www.googleapis.com/calendar/v3/calendars/{}/events",
                url::form_urlencoded::byte_serialize(calendar_id.as_bytes()).collect::<String>()
            ),
            Provider::Outlook => format!(
                "https://graph.microsoft.com/v1.0/me/calendars/{}/calendarView",
                url::form_urlencoded::byte_serialize(calendar_id.as_bytes()).collect::<String>()
            ),
        };
        let mut req = client.get(url).bearer_auth(&token);
        req = match provider {
            Provider::Google => req.query(&[
                ("timeMin", &time_min),
                ("timeMax", &time_max),
                ("singleEvents", &"true".to_string()),
            ]),
            Provider::Outlook => {
                req.query(&[("startDateTime", &time_min), ("endDateTime", &time_max)])
            }
        };
        let response = req.send().await.map_err(|e| e.to_string())?;
        let value = api_json(response, provider, "synchronize calendar events").await?;
        let items = match provider {
            Provider::Google => value["items"].as_array(),
            Provider::Outlook => value["value"].as_array(),
        }
        .cloned()
        .unwrap_or_default();
        for v in items {
            let (start, end, all_day) = match provider {
                Provider::Google => (
                    v["start"]["dateTime"]
                        .as_str()
                        .or_else(|| v["start"]["date"].as_str()),
                    v["end"]["dateTime"]
                        .as_str()
                        .or_else(|| v["end"]["date"].as_str()),
                    v["start"]["dateTime"].is_null(),
                ),
                Provider::Outlook => (
                    v["start"]["dateTime"].as_str(),
                    v["end"]["dateTime"].as_str(),
                    v["isAllDay"].as_bool().unwrap_or(false),
                ),
            };
            if let (Some(id), Some(start), Some(end)) = (v["id"].as_str(), start, end) {
                output.push(CalendarEvent {
                    id: id.into(),
                    provider,
                    calendar_id: calendar_id.clone(),
                    title: v["summary"]
                        .as_str()
                        .or_else(|| v["subject"].as_str())
                        .unwrap_or("Untitled event")
                        .into(),
                    start: start.into(),
                    end: end.into(),
                    all_day,
                    location: v["location"]
                        .as_str()
                        .or_else(|| v["location"]["displayName"].as_str())
                        .map(str::to_string),
                });
            }
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pkce_is_rfc7636_s256() {
        let (v, c) = pkce();
        assert!((43..=128).contains(&v.len()));
        assert_eq!(c, URL_SAFE_NO_PAD.encode(Sha256::digest(v.as_bytes())));
        assert!(!c.contains('='));
    }
    #[test]
    fn source_handles_are_stable_and_opaque() {
        let h1 = source_handle(Provider::Google, "alice@example.com");
        let h2 = source_handle(Provider::Google, "alice@example.com");
        assert_eq!(h1, h2, "same real id -> same handle");
        assert!(h1.starts_with("cal_"));
        assert!(!h1.contains('@'));
        assert_ne!(h1, source_handle(Provider::Google, "team@example.com"));
        assert_ne!(h1, source_handle(Provider::Outlook, "alice@example.com"));
    }

    #[test]
    fn disconnect_only_drops_its_own_provider_handles() {
        let g = source_handle(Provider::Google, "disc-test-g@example.com");
        let o = source_handle(Provider::Outlook, "disc-test-o@example.com");
        {
            let mut map = handle_map().lock().unwrap();
            map.insert((Provider::Google, g.clone()), "g-real".into());
            map.insert((Provider::Outlook, o.clone()), "o-real".into());
        }
        // Mirror `calendar_disconnect(Provider::Google)`.
        handle_map()
            .lock()
            .unwrap()
            .retain(|(p, _), _| *p != Provider::Google);
        let map = handle_map().lock().unwrap();
        assert!(map.get(&(Provider::Google, g)).is_none(), "google handle gone");
        assert_eq!(
            map.get(&(Provider::Outlook, o)).map(String::as_str),
            Some("o-real"),
            "outlook handle survives"
        );
    }

    #[test]
    fn sync_rejects_too_many_calendars() {
        let ids: Vec<String> = (0..33).map(|i| i.to_string()).collect();
        assert!(validate_sync_request(&ids, "2026-01-01", "2026-02-01").is_err());
    }

    #[test]
    fn sync_rejects_wide_window() {
        let ids = vec!["primary".to_string()];
        assert!(validate_sync_request(&ids, "2000-01-01", "2100-01-01").is_err());
    }

    #[test]
    fn sync_expands_bare_dates() {
        assert_eq!(expand_bound("2026-08-31", false), "2026-08-31T00:00:00Z");
        assert_eq!(expand_bound("2026-08-31", true), "2026-08-31T23:59:59Z");
        assert_eq!(
            expand_bound("2026-08-31T12:00:00+02:00", false),
            "2026-08-31T12:00:00+02:00"
        );
    }

    #[test]
    fn calendar_sharing_key_is_stable() {
        assert_eq!(crate::CALENDAR_SHARING_KEY, "calendar_sharing_allowed");
    }
    #[test]
    fn state_is_random_and_high_entropy() {
        let a = random_state();
        let b = random_state();
        assert_eq!(a.len(), 48);
        assert_ne!(a, b);
    }
    #[test]
    fn scopes_are_read_only() {
        assert!(Provider::Google.scope().contains("calendar.readonly"));
        assert!(Provider::Outlook.scope().contains("Calendars.Read"));
        assert!(!Provider::Outlook.scope().contains("ReadWrite"));
    }
    #[test]
    fn providers_use_compatible_loopback_redirects() {
        assert_eq!(
            Provider::Google.redirect_uri(55171),
            "http://127.0.0.1:55171"
        );
        assert_eq!(
            Provider::Outlook.redirect_uri(55171),
            "http://localhost:55171"
        );
    }
    #[test]
    fn bundled_client_ids_make_development_builds_configured() {
        assert!(GOOGLE_CLIENT_ID.ends_with(".apps.googleusercontent.com"));
        assert_eq!(MICROSOFT_CLIENT_ID.len(), 36);
    }
}
