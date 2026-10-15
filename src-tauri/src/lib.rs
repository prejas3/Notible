mod calendar_oauth;
mod ai;
mod db;
mod files;
mod locales;
mod notifications;
mod plugin_oauth;
mod plugin_store;
mod plugins;
mod cloud_auth;
mod cloud_oauth;
mod sandbox;
mod mcp_cleanup;
mod media_import;
mod sync_conflicts;

use db::{
    Backlink, HistoryEntry, HistoryMeta, IntegrationEvent, Object, PluginRegistryEntry, Relation,
    SyncOutboxEntry, SyncRelation, SyncRelationTombstone, SyncTombstone, TypeDef,
};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Manager, Wry,
};

/// Tray "Quit": ask the page to save what is typed first (it calls `quit_app`
/// when done), and exit anyway after 3 s if the page never answers.
fn request_quit(app: &tauri::AppHandle) {
    let asked = app
        .get_webview_window("main")
        .map(|window| window.eval("window.dispatchEvent(new Event('notible:quit-requested'))").is_ok())
        .unwrap_or(false);
    if !asked {
        app.exit(0);
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        app.exit(0);
    });
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Spell checking follows the app's language (E11). wry starts WebView2 in the
/// Windows display language, and only that language's dictionary is used, so
/// on a Polish Windows every English word was underlined. The UI stores its
/// language here; the next start hands it to WebView2 as `--accept-lang`.
const UI_LANGUAGE_FILE: &str = "ui-language";

fn is_language_tag(value: &str) -> bool {
    !value.is_empty() && value.len() <= 16 && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

#[tauri::command]
fn set_ui_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    let language = language.trim();
    if !is_language_tag(language) {
        return Err("Not a language tag".into());
    }
    let dir = app_data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(err_to_string)?;
    let path = dir.join(UI_LANGUAGE_FILE);
    if std::fs::read_to_string(&path).ok().as_deref() == Some(language) {
        return Ok(());
    }
    std::fs::write(path, language).map_err(err_to_string)
}

#[cfg(windows)]
fn apply_ui_language_to_webview() {
    // No AppHandle yet: the same folder app_data_dir() resolves to later.
    let dir = sandbox::test_data_dir()
        .or_else(|| std::env::var_os("APPDATA").map(|appdata| PathBuf::from(appdata).join("com.notible.app")));
    let Some(stored) = dir.and_then(|dir| std::fs::read_to_string(dir.join(UI_LANGUAGE_FILE)).ok()) else {
        return;
    };
    let language = stored.trim();
    if !is_language_tag(language) {
        return;
    }
    let accept = if language == "en" { "en-US" } else { language };
    // Setting this variable replaces wry's own arguments, so its defaults are
    // repeated here (wry 0.55 webview2/mod.rs); a sandbox's debug port is kept.
    let base = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")
        .unwrap_or_else(|_| "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection".to_string());
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", format!("{base} --accept-lang={accept}"));
}

pub(crate) fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// In debug builds, allow the desktop E2E harness to use a disposable app
/// data directory. Release builds always use Tauri's normal app-data path.
pub(crate) fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = sandbox::test_data_dir() {
        if !path.is_absolute() || path.components().count() < 2 {
            return Err("NOTIBLE_TEST_APP_DATA_DIR must be a non-root absolute path".into());
        }
        return Ok(path);
    }
    app.path().app_data_dir().map_err(err_to_string)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct McpInfo {
    bundled: bool,
    command: String,
    server_script: String,
    database_path: String,
    client_config: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncSnapshot {
    device_id: String,
    cursor: i64,
    objects: Vec<Object>,
    relations: Vec<SyncRelation>,
    tombstones: Vec<SyncTombstone>,
    relation_tombstones: Vec<SyncRelationTombstone>,
    outbox: Vec<SyncOutboxEntry>,
    conflicts: Vec<sync_conflicts::Descriptor>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct SyncApplyRequest {
    // Hive #7: malformed optional descriptors must not prevent copying notes.
    #[serde(default)]
    conflicts: Vec<serde_json::Value>,
    cursor: i64,
    objects: Vec<Object>,
    relations: Vec<SyncRelation>,
    tombstones: Vec<SyncTombstone>,
    relation_tombstones: Vec<SyncRelationTombstone>,
    #[serde(default)]
    acknowledged_operations: Vec<String>,
    /// SYNC-NO-LOSS (Hive #14, F2): object id -> the local `updated_at` the
    /// caller planned against (null: the row did not exist). A row that moved
    /// since is refused and listed in `stale_objects`.
    /// Hive #19: sending it at all (even `{}`) also opts in to the cursor
    /// check on every id the request touches. Absent (an older caller, Teams)
    /// keeps the old unchecked behaviour.
    #[serde(default)]
    expected: Option<std::collections::HashMap<String, Option<i64>>>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncApplyResult {
    applied_objects: usize,
    added_relations: usize,
    deleted_relations: usize,
    deleted_objects: usize,
    acknowledged_operations: usize,
    cursor: i64,
    stale_objects: Vec<String>,
}

#[tauri::command]
fn mcp_info(app: tauri::AppHandle) -> Result<McpInfo, String> {
    let resource_dir = app.path().resource_dir().map_err(err_to_string)?;
    let data_dir = app_data_dir(&app)?;
    let command = resource_dir.join("mcp-server").join("runtime").join("node.exe");
    let server_script = resource_dir.join("mcp-server").join("index.js");
    let database_path = data_dir.join("notible.db");
    let bundled = command.exists() && server_script.exists();
    // MCP-SETTINGS (Hive #29): shown and copied into client configs, so drop
    // Windows' verbatim `\\?\` prefix that resource_dir() returns.
    let plain = |path: &std::path::Path| {
        let text = path.to_string_lossy().into_owned();
        match text.strip_prefix(r"\\?\") {
            Some(rest) if rest.as_bytes().get(1) == Some(&b':') => rest.to_string(),
            _ => text,
        }
    };
    let (command, server_script, database_path) = (plain(&command), plain(&server_script), plain(&database_path));
    let config = serde_json::json!({
        "mcpServers": { "notible": {
            "command": command,
            "args": [server_script],
            "env": { "NOTIBLE_DB_PATH": database_path }
        }}
    });
    Ok(McpInfo {
        bundled,
        client_config: serde_json::to_string_pretty(&config).map_err(err_to_string)?,
        command,
        server_script,
        database_path,
    })
}

#[tauri::command]
fn extract_plugin_zip(
    app: tauri::AppHandle,
    official_installs: tauri::State<OfficialInstalls>,
    path: String,
) -> Result<plugins::ExtractedPlugin, String> {
    // Without this, a plugin could unpack a zip the user was tricked into
    // downloading, bypassing the picker entirely. The extraction itself is
    // safe (see plugins.rs), but the picker gesture is what makes it the
    // user's decision rather than the caller's.
    let resolved = files::resolve_granted_file(&app, &path)?;
    let data_dir = app_data_dir(&app)?;
    let extracted = plugins::extract_plugin_zip(&data_dir, &resolved.to_string_lossy(), None, None)?;
    locked(&official_installs.0).note_extract(None, &extracted);
    Ok(extracted)
}

/// Install a plugin package that carries no signature — the community market
/// model. This command performs NO user gesture and NO signature or hash
/// check. It base64-decodes the body, stages it to a temp file, and calls
/// `extract_plugin_zip`, which enforces the structural rules (path traversal,
/// symlinks, zip-bomb, size and entry limits) and the id/version cross-check
/// against what the catalog claimed. That is all this function guards.
///
/// The extraction step here is deliberately unguarded; it is safe only
/// because activation is gated downstream: `grant_plugin_trust` shows a
/// blocking native dialog before the plugin is loaded, and release builds
/// force `verified: false` in the registry for a community plugin. The UI
/// also shows a trust modal before calling this, but that is a caller
/// convention — this function neither performs nor verifies it.
#[tauri::command]
fn install_plugin_zip(
    app: tauri::AppHandle,
    official_installs: tauri::State<OfficialInstalls>,
    package_base64: String,
    expected_id: String,
    expected_version: String,
) -> Result<plugins::ExtractedPlugin, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&package_base64)
        .map_err(|e| format!("invalid package encoding: {e}"))?;
    let data_dir = app_data_dir(&app)?;
    let staging = data_dir.join(format!("plugin-install-{}.zip", uuid::Uuid::new_v4()));
    std::fs::write(&staging, &bytes).map_err(|e| format!("cannot stage plugin package: {e}"))?;
    let result = plugins::extract_plugin_zip(
        &data_dir,
        &staging.to_string_lossy(),
        Some(&expected_id),
        Some(&expected_version),
    );
    let _ = std::fs::remove_file(&staging);
    let extracted = result?;
    locked(&official_installs.0).note_extract(Some(&bytes), &extracted);
    Ok(extracted)
}

/// Fetch a plugin's GitHub-release file (its `plugin.json` or the package ZIP)
/// from Rust. The WebView `fetch` cannot read these: `github.com` and
/// `*.githubusercontent.com` send no `Access-Control-Allow-Origin`, so a
/// cross-origin fetch from the app is blocked by CORS. Host-allowlisted to
/// GitHub release assets (checked on every redirect hop so this is not a
/// general SSRF primitive), redirect-limited and byte-capped. The body comes
/// back base64-encoded, like the other plugin-install IPC.
#[tauri::command]
async fn market_fetch(
    official_installs: tauri::State<'_, OfficialInstalls>,
    url: String,
    max_bytes: u64,
) -> Result<String, String> {
    use base64::Engine;
    fn host_allowed(u: &reqwest::Url) -> bool {
        u.scheme() == "https"
            && u.host_str().is_some_and(|h| h == "github.com" || h.ends_with(".githubusercontent.com"))
    }
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    if !host_allowed(&parsed) {
        return Err(format!("market_fetch will not fetch from {}", parsed.host_str().unwrap_or("that host")));
    }
    // Hive #21: an official download must stay official on every hop, or the
    // bytes it ends with would be recorded as an official release.
    let official = official_release(&parsed);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() > 6 {
                attempt.error("too many redirects")
            } else if official.as_ref().is_some_and(|start| !official_redirect_ok(start, attempt.url())) {
                attempt.error("redirect leaves the official release")
            } else if host_allowed(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(parsed).send().await
        .map_err(|e| format!("could not fetch {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("{url} returned {}", response.status()));
    }
    if let Some(len) = response.content_length() {
        if len > max_bytes {
            return Err(format!("{url} is larger than the byte limit"));
        }
    }
    let body = response.bytes().await.map_err(|e| format!("could not read {url}: {e}"))?;
    if body.len() as u64 > max_bytes {
        return Err(format!("{url} is larger than the byte limit"));
    }
    // The URL the caller asked for, not the redirect target: GitHub serves
    // release assets from githubusercontent.com, so the owner lives here.
    // The redirect policy above already refused any hop off that release.
    locked(&official_installs.0).note_fetch(&url, &body);
    Ok(base64::engine::general_purpose::STANDARD.encode(&body))
}

#[tauri::command]
fn hash_plugin_package(app: tauri::AppHandle, path: String) -> Result<String, String> {
    // Hashing an arbitrary path is a file-existence and content-fingerprint
    // oracle over the whole disk. The only legitimate target is a package the
    // user picked, and picking grants it.
    let resolved = files::resolve_granted_file(&app, &path)?;
    plugins::sha256_file(&resolved.to_string_lossy())
}

#[tauri::command]
fn list_plugin_registry(state: tauri::State<AppState>) -> Result<Vec<PluginRegistryEntry>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::list_plugin_registry(&conn).map_err(err_to_string)
}

/// One image or font of an installed *theme pack*, as a data: URI. The caller
/// names the plugin; its folder comes from the registry (never from the
/// caller), only packs whose manifest carries a theme are served, and the file
/// must be a real image or font inside that folder. See plugins.rs.
#[tauri::command]
fn read_theme_asset(state: tauri::State<AppState>, plugin_id: String, path: String) -> Result<String, String> {
    let entries = {
        let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        db::list_plugin_registry(&conn).map_err(err_to_string)?
    };
    let entry = entries
        .into_iter()
        .filter(|entry| entry.plugin_id == plugin_id)
        .max_by_key(|entry| entry.installed_at)
        .ok_or("that theme is not installed")?;
    let is_theme = serde_json::from_str::<serde_json::Value>(&entry.manifest)
        .ok()
        .and_then(|manifest| manifest.get("theme").map(|theme| theme.is_object()))
        .unwrap_or(false);
    if !is_theme {
        return Err("that plugin is not a theme pack".into());
    }
    plugins::read_theme_asset(std::path::Path::new(&entry.install_path), &path)
}

#[tauri::command]
fn upsert_plugin_registry(
    state: tauri::State<AppState>,
    plugin_id: String,
    version: String,
    source: String,
    install_path: String,
    manifest: String,
    verified: bool,
) -> Result<PluginRegistryEntry, String> {
    // `verified` must never be trusted as a raw client-supplied flag in a
    // release build (audit finding A2): the frontend's check can be bypassed
    // by any code running in the webview, since it's just a JS-side gate
    // before an `invoke()` call. Model A ships no signed plugin manifests, so
    // there is nothing for Rust to re-derive trust from: release builds
    // always record `false`, and only debug/test builds honor the caller's
    // flag so the local E2E harness for unsigned test plugins keeps working.
    let resolved_verified = cfg!(debug_assertions) && verified;
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::upsert_plugin_registry(
        &conn,
        &plugin_id,
        &version,
        &source,
        &install_path,
        &manifest,
        resolved_verified,
    )
    .map_err(err_to_string)
}

/// The plugin API version this build offers. Must equal
/// `EXTENSION_API_VERSION` in packages/plugin-api; scripts/plugin-docs-check
/// fails the build if the two drift. Until 0.46.0 this side said "0.1" long
/// after the TypeScript side had moved on, so every scaffolded plugin and the
/// developer pack's own header advertised a version that no longer existed.
const PLUGIN_API_VERSION: &str = "1.28";

/// The developer pack, compiled into the binary so it always matches the
/// build the user is running. Documentation that ships separately from the
/// app drifts; this cannot.
const DEVKIT_FILES: &[(&str, &str)] = &[
    ("START.md", include_str!("../../docs/plugin-api/START.md")),
    ("REFERENCE.md", include_str!("../../docs/plugin-api/REFERENCE.md")),
    (
        "notible-plugin-api.d.ts",
        include_str!("../../packages/plugin-api/notible-plugin-api.d.ts"),
    ),
    (
        "examples/pomodoro/plugin.json",
        include_str!("../../plugins/examples/pomodoro/plugin.json"),
    ),
    (
        "examples/pomodoro/main.js",
        include_str!("../../plugins/examples/pomodoro/main.js"),
    ),
    (
        "examples/pomodoro/README.md",
        include_str!("../../plugins/examples/pomodoro/README.md"),
    ),
    (
        "examples/workbench/plugin.json",
        include_str!("../../plugins/examples/workbench/plugin.json"),
    ),
    (
        "examples/workbench/main.js",
        include_str!("../../plugins/examples/workbench/main.js"),
    ),
    (
        "examples/workbench/theme.css",
        include_str!("../../plugins/examples/workbench/theme.css"),
    ),
    // Community packs: a theme (styles only) and a language (one JSON file).
    ("THEME_PACKS.md", include_str!("../../docs/THEME_PACKS.md")),
    ("LANGUAGE_PACKS.md", include_str!("../../docs/LANGUAGE_PACKS.md")),
    (
        "examples/theme-glass/plugin.json",
        include_str!("../../examples/theme-glass/plugin.json"),
    ),
    (
        "examples/theme-glass/theme.css",
        include_str!("../../examples/theme-glass/theme.css"),
    ),
    // The canonical list of every translatable string, of exactly this build.
    ("examples/language/en.json", include_str!("../../locales/en.json")),
];

/// Write the plugin developer pack — guide, full reference, editor types and a
/// complete worked example — into a folder the user picked.
#[tauri::command]
fn export_plugin_devkit(app: tauri::AppHandle, folder: String) -> Result<String, String> {
    let root = files::resolve_granted_dir(&app, &folder)?;
    let target = root.join("notible-plugin-devkit");
    std::fs::create_dir_all(&target).map_err(|e| format!("cannot create {}: {e}", target.display()))?;

    for (name, contents) in DEVKIT_FILES {
        let path = target.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, contents)
            .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    }

    let index = format!(
        "# Notible — plugin author pack\n\n\
         App version: {}. API: {}.\n\n\
         - `START.md` — start here. A working plugin in five minutes.\n\
         - `REFERENCE.md` — full documentation: every type, method and slot.\n\
         - `notible-plugin-api.d.ts` — types for editor autocomplete.\n\
         - `examples/pomodoro/` — a complete, working plugin.\n\
         - `examples/workbench/` — an API check: every slot, overlay,\n\
           content index, a custom stylesheet and a settings panel.\n\n\
         Community packs (no code, no plugin API):
         - `THEME_PACKS.md` — build and publish a theme: colours, backgrounds,
           glass, animation. Example: `examples/theme-glass/`.
         - `LANGUAGE_PACKS.md` — translate Notible and publish it as one JSON
           file. Start from `examples/language/en.json`.

         To run an example: Settings -> Plugins -> Market tab -> Add plugin\n\
         folder, pointing at `examples/pomodoro`.\n\n\
         This pack was written by the app, so it matches exactly the version\n\
         you have installed.\n",
        app.package_info().version,
        PLUGIN_API_VERSION,
    );
    std::fs::write(target.join("README.md"), index).map_err(|e| e.to_string())?;

    Ok(target.to_string_lossy().into_owned())
}

/// Write a working starter plugin into a folder the user picked.
///
/// The point is that the first step of writing a plugin is "you already have
/// a running one", not "read this document". No npm, no bundler, no account:
/// two files that load as-is.
#[tauri::command]
fn scaffold_plugin(app: tauri::AppHandle, folder: String, plugin_id: String) -> Result<String, String> {
    if !plugins::valid_plugin_id(&plugin_id) {
        return Err("plugin id must be lowercase words separated by . or -".into());
    }
    // Same containment as every other write: the folder must be one the user
    // granted through the picker.
    let root = files::resolve_granted_dir(&app, &folder)?;
    let target = root.join(&plugin_id);
    if target.exists() {
        return Err(format!("{} already exists", target.display()));
    }
    std::fs::create_dir_all(&target).map_err(|e| format!("cannot create {}: {e}", target.display()))?;

    let manifest = format!(
        r#"{{
  "id": "{plugin_id}",
  "name": "My plugin",
  "version": "0.1.0",
  "apiVersion": "{PLUGIN_API_VERSION}",
  "description": "Describe what this plugin does.",
  "entry": "main.js",
  "permissions": ["workspace.ui"]
}}
"#
    );
    let entry = format!(
        r#"// {plugin_id} — a starting point.
//
// This file is loaded as an ES module exactly as written: no build step, no
// dependencies. Edit it, then press Reload on this plugin in Settings.

export default {{
  manifest: {{
    id: "{plugin_id}",
    name: "My plugin",
    version: "0.1.0",
    apiVersion: "{PLUGIN_API_VERSION}",
    permissions: ["workspace.ui"],
  }},

  onload(context) {{
    // A command, reachable from the command palette.
    context.commands.register({{
      id: "hello",
      name: "Say hello",
      execute: () => {{
        context.ui.notice("Hello from {plugin_id}");
        return {{ ok: true }};
      }},
    }});

    // A panel in the sidebar. `mount` hands you a plain element; render
    // whatever you like into it and return something to clean up with.
    context.ui.registerSlot("workspace.sidebar", {{
      id: "panel",
      mount({{ container }}) {{
        const box = document.createElement("div");
        box.textContent = "Hello from {plugin_id}";
        box.style.margin = "8px 12px";
        box.style.padding = "12px";
        box.style.border = "1px solid var(--notible-border)";
        box.style.borderRadius = "10px";
        box.style.color = "var(--notible-text)";
        container.append(box);
        return {{ dispose: () => box.remove() }};
      }},
    }});
  }},

  onunload() {{
    // Anything you set up outside a Disposable gets torn down here.
  }},
}};
"#
    );
    let readme = format!(
        "# {plugin_id}\n\n\
         Two files, no build step.\n\n\
         - `plugin.json` — the manifest. `entry` points at the code.\n\
         - `main.js` — an ES module exporting `{{ manifest, onload, onunload }}`.\n\n\
         Install it with Settings -> Plugins -> Market tab -> Add plugin folder,\n\
         pointing at this directory. After editing, press Reload on its row.\n\n\
         The contract lives in `packages/plugin-api`; slots Core renders are\n\
         listed in `UI_SLOTS`.\n"
    );

    std::fs::write(target.join("plugin.json"), manifest).map_err(|e| e.to_string())?;
    std::fs::write(target.join("main.js"), entry).map_err(|e| e.to_string())?;
    std::fs::write(target.join("README.md"), readme).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}

/// Trim a manifest string to something safe to render in a native dialog.
///
/// `name` and `description` are attacker-controlled free text that appears on
/// the one screen the user makes a trust decision on. Bidi format characters
/// can reorder a line so it reads as the opposite of what it says, and C0/C1
/// controls can blank or split it, so both are dropped and the result is
/// length-capped.
fn dialog_safe(value: &str, max_chars: usize) -> String {
    let cleaned: String = value
        .chars()
        .filter(|c| {
            !c.is_control()
                && !matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{200E}' | '\u{200F}')
        })
        .take(max_chars)
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() { "(unnamed)".to_string() } else { trimmed.to_string() }
}

/// GitHub accounts whose releases count as OFFICIAL: published by the
/// Notible developer, curated and vetted the same way the builtin plugins
/// are. Mirrors `OFFICIAL_GITHUB_OWNERS`/`isOfficialReleaseUrl` in
/// `src/core/app/marketSource.ts` — kept in Rust too because the decision to
/// skip the native trust dialog below is security-relevant and must not
/// rest on a bare boolean the caller could get wrong; Rust re-derives it
/// from the URL string itself, the same way `market_fetch` re-checks its
/// own host allowlist rather than trusting the caller's intent.
const OFFICIAL_GITHUB_OWNERS: &[&str] = &["prejas3"];

/// Hive #21: hosts GitHub hands a release-asset download over to. Only an
/// official release URL's redirect may land here and still count.
const RELEASE_ASSET_CDN_HOSTS: &[&str] = &["release-assets.githubusercontent.com", "objects.githubusercontent.com"];

/// `(owner, repo)` of an official release asset: exactly
/// `https://github.com/<official owner>/<repo>/releases/download/<tag>/<asset>`,
/// or the market's `.../releases/latest/download/<asset>` (Hive #23), which
/// GitHub redirects to the pinned form and then the asset CDN.
/// Hive #21: the owner alone was not enough; `/<owner>/<repo>/raw/<commit>/…`
/// also serves commits pushed to forks in the same network.
fn official_release(url: &reqwest::Url) -> Option<(String, String)> {
    if url.scheme() != "https" || url.host_str() != Some("github.com") {
        return None;
    }
    let segments: Vec<&str> = url.path_segments()?.collect();
    let (owner, repo, tag, asset) = match segments.as_slice() {
        [owner, repo, "releases", "download", tag, asset] => (*owner, *repo, *tag, *asset),
        [owner, repo, "releases", "latest", "download", asset] => (*owner, *repo, "latest", *asset),
        _ => return None,
    };
    if [owner, repo, tag, asset].iter().any(|part| part.is_empty())
        || !OFFICIAL_GITHUB_OWNERS.iter().any(|candidate| candidate.eq_ignore_ascii_case(owner))
    {
        return None;
    }
    Some((owner.to_ascii_lowercase(), repo.to_ascii_lowercase()))
}

fn is_official_release_url(url: &str) -> bool {
    reqwest::Url::parse(url).ok().is_some_and(|parsed| official_release(&parsed).is_some())
}

/// A redirect hop out of an official release download: the same owner and
/// repo's release assets, or GitHub's asset CDN. Anything else (another
/// owner or repo, a raw/blob path) fails the fetch rather than letting other
/// bytes be recorded as official.
fn official_redirect_ok(start: &(String, String), hop: &reqwest::Url) -> bool {
    match hop.host_str() {
        Some("github.com") => official_release(hop).as_ref() == Some(start),
        Some(host) => hop.scheme() == "https" && RELEASE_ASSET_CDN_HOSTS.contains(&host),
        None => false,
    }
}

/// TRUST-OFFICIAL-SOURCE (Hive #8): Rust's own record of which installs came
/// from an official release. `grant_plugin_trust` used to take the source URL
/// as an argument, but every command is reachable from plugin code, so a
/// plugin could install any bytes and then name an official URL to skip the
/// dialog. Now "official" means: these exact bytes were downloaded by
/// `market_fetch` from an official URL, then extracted by
/// `install_plugin_zip` to this id/version/path. In memory only: trust that
/// was granted is already persisted, and a restart just means the dialog.
#[derive(Default)]
pub struct OfficialInstalls(Mutex<OfficialRecord>);

#[derive(Default)]
struct OfficialRecord {
    // ponytail: grows by one hash per official fetch per session; fine at market scale.
    fetched: std::collections::HashSet<String>,
    installed: std::collections::HashSet<(String, String, String)>,
}

impl OfficialRecord {
    fn note_fetch(&mut self, url: &str, body: &[u8]) {
        if is_official_release_url(url) {
            self.fetched.insert(sha256_hex(body));
        }
    }

    /// `body` is the package bytes, or `None` for a picked file. Any extraction
    /// that is not an official package clears the path, so a reinstall over
    /// it cannot inherit the earlier official mark.
    fn note_extract(&mut self, body: Option<&[u8]>, extracted: &plugins::ExtractedPlugin) {
        let key = (extracted.plugin_id.clone(), extracted.version.clone(), extracted.install_path.clone());
        if body.is_some_and(|bytes| self.fetched.contains(&sha256_hex(bytes))) {
            self.installed.insert(key);
        } else {
            self.installed.remove(&key);
        }
    }

    fn is_official(&self, plugin_id: &str, version: &str, install_path: &str) -> bool {
        self.installed.contains(&(plugin_id.to_string(), version.to_string(), install_path.to_string()))
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}

/// Ask the user, natively and bluntly, before any of this package's code is
/// executed for the first time.
///
/// This is the only writer of `user_trusted`. It reads the package's own
/// description out of the registry row rather than taking it as an argument,
/// so the text on the decision screen is what was actually recorded at
/// install, not whatever the calling code would like it to say.
///
/// The one exception: the dialog is SKIPPED for a package Rust itself saw
/// downloaded from an official release and extracted to this row's path
/// (`OfficialInstalls`, TRUST-OFFICIAL-SOURCE) — those are curated by the
/// same person who ships Core. `source_url` is accepted for compatibility but
/// ignored (Hive #8): it is the caller's say-so, and the caller may be a plugin.
#[tauri::command]
fn grant_plugin_trust(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    official_installs: tauri::State<OfficialInstalls>,
    plugin_id: String,
    version: String,
    source_url: Option<String>,
) -> Result<db::PluginRegistryEntry, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let _ = source_url;
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let entry = db::list_plugin_registry(&conn)
        .map_err(err_to_string)?
        .into_iter()
        .find(|e| e.plugin_id == plugin_id && e.version == version)
        .ok_or("plugin is not in the registry")?;

    let manifest: serde_json::Value =
        serde_json::from_str(&entry.manifest).map_err(|e| format!("invalid stored manifest: {e}"))?;
    let str_field = |key: &str| {
        manifest
            .get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let has_code = manifest
        .get("entry")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    let permissions = manifest
        .get("permissions")
        .and_then(serde_json::Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(|value| dialog_safe(value, 40))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "none declared".to_string());
    // API 1.28: declared, shown here, enforced only for media.importImageFromUrl (media_import.rs).
    let network_hosts = manifest
        .get("networkHosts")
        .and_then(serde_json::Value::as_array)
        .map(|values| values.iter().filter_map(serde_json::Value::as_str).take(20).map(|value| dialog_safe(value, 80)).collect::<Vec<_>>().join(", "))
        .filter(|value| !value.is_empty())
        .map(|hosts| format!("\n\nTalks to: {hosts}"))
        .unwrap_or_default();

    // A package with no executable entry cannot run code, so it needs no
    // warning — but it is also not something this command should be silently
    // marking as trusted. Refuse rather than pop a dialog that misdescribes it.
    // `grant_theme_trust` is the path for those.
    if !has_code {
        return Err("this package contains no executable entry; use grant_theme_trust".into());
    }

    let official = locked(&official_installs.0).is_official(&plugin_id, &version, &entry.install_path);
    if official {
        return db::set_plugin_user_trusted(&conn, &plugin_id, &version).map_err(err_to_string);
    }

    let body = format!(
        "{name} {version} by {author}\n\n\
         {description}\n\n\
         Declared permissions: {permissions}{network_hosts}\n\n\
         This package contains code. Notible does not sandbox plugin code: \
         once you install it, it can do anything you can do on this machine — \
         read and change every note, reach the network, and use any capability \
         the app has. Only continue if you trust the source it came from.",
        name = dialog_safe(&str_field("name"), 60),
        version = dialog_safe(&version, 40),
        author = dialog_safe(&str_field("author"), 60),
        description = dialog_safe(&str_field("description"), 300),
        permissions = permissions,
        network_hosts = network_hosts,
    );
    let title = "Install a plugin that contains code";
    let approved = sandbox::dialog_answer(title).unwrap_or_else(|| app
        .dialog()
        .message(body)
        .title(title)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Install and run".into(),
            "Cancel".into(),
        ))
        .blocking_show());
    if !approved {
        return Err("Cancelled.".into());
    }
    db::set_plugin_user_trusted(&conn, &plugin_id, &version).map_err(err_to_string)
}

/// Trust a package that contains no executable code.
///
/// No dialog: a theme executes nothing, and this app's CSP carries no remote
/// scheme in `img-src`/`font-src`/`style-src`, so injected CSS has nowhere to
/// send what it can observe. Prompting here would train users to click through
/// the prompt that *does* matter.
///
/// The manifest is re-read from the registry rather than trusted from the
/// caller, so this cannot be used to wave through a package that does have an
/// entry.
/// Read the content index: headings, tags, wiki links and task items found
/// inside note bodies. Computed on demand, so it can never be stale.
#[tauri::command]
fn query_content_index(
    state: tauri::State<AppState>,
    kind: Option<String>,
    value: Option<String>,
    object_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<db::ContentIndexEntry>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::query_content_index(
        &conn,
        kind.as_deref(),
        value.as_deref(),
        object_id.as_deref(),
        limit,
    )
    .map_err(err_to_string)
}

/// D13 — the ordered block projection of one note. Read-only and computed on
/// demand, so it cannot disagree with what is stored.
#[tauri::command]
fn project_document(
    state: tauri::State<AppState>,
    object_id: String,
) -> Result<Vec<db::DocumentBlock>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let object = db::get_object(&conn, &object_id).map_err(err_to_string)?;
    Ok(object.map(|value| db::project_document(&value.content)).unwrap_or_default())
}

#[tauri::command]
fn grant_theme_trust(
    state: tauri::State<AppState>,
    plugin_id: String,
    version: String,
) -> Result<db::PluginRegistryEntry, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let entry = db::list_plugin_registry(&conn)
        .map_err(err_to_string)?
        .into_iter()
        .find(|e| e.plugin_id == plugin_id && e.version == version)
        .ok_or("plugin is not in the registry")?;
    let manifest: serde_json::Value =
        serde_json::from_str(&entry.manifest).map_err(|e| format!("invalid stored manifest: {e}"))?;
    if manifest
        .get("entry")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Err("this package contains executable code; it needs the install warning".into());
    }
    if manifest
        .get("styles")
        .and_then(serde_json::Value::as_array)
        .is_none_or(|values| values.is_empty())
    {
        return Err("this package declares no stylesheets".into());
    }
    db::set_plugin_user_trusted(&conn, &plugin_id, &version).map_err(err_to_string)
}

#[tauri::command]
fn set_plugin_registry_state(
    state: tauri::State<AppState>,
    plugin_id: String,
    version: String,
    plugin_state: String,
    last_error: Option<String>,
) -> Result<PluginRegistryEntry, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::set_plugin_registry_state(
        &conn,
        &plugin_id,
        &version,
        &plugin_state,
        last_error.as_deref(),
    )
    .map_err(err_to_string)
}

#[tauri::command]
fn remove_plugin_registry(
    state: tauri::State<AppState>,
    store: tauri::State<StoreState>,
    plugin_id: String,
    version: Option<String>,
) -> Result<usize, String> {
    let conn = locked(&state.conn);
    let removed = db::remove_plugin_registry(&conn, &plugin_id, version.as_deref()).map_err(err_to_string)?;
    // STORE-API (Hive #5): an update removes the old version after the new
    // row exists and keeps the store; removing the last version wipes it.
    match plugin_store::is_registered(&conn, &plugin_id) {
        Ok(false) => {
            if let Err(e) = plugin_store::delete_plugin(&locked(&store.conn), &plugin_id) {
                eprintln!("plugin store cleanup for {plugin_id} failed: {e}");
            }
        }
        Ok(true) => {}
        // A query failure is not proof the plugin is gone; keep its data.
        Err(e) => eprintln!("plugin store cleanup for {plugin_id} skipped: {e}"),
    }
    Ok(removed)
}

pub struct AppState {
    pub conn: Mutex<Connection>,
}

/// STORE-API (Hive #5): `plugin-store.db`, separate from the workspace DB.
/// Lock order whenever both are needed: `AppState.conn` first, then this.
/// Each command below holds the store lock across the generation check and
/// the write (they are not atomic on their own).
pub struct StoreState {
    pub conn: Mutex<Connection>,
}

fn locked<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Checks registration under the main DB lock, released before the store
/// lock is taken (never the reverse order).
fn store_access(state: &AppState, plugin_id: &str) -> Result<(), String> {
    plugin_store::ensure_registered(&locked(&state.conn), plugin_id)
}

#[tauri::command]
fn plugin_store_generation(store: tauri::State<StoreState>) -> Result<String, String> {
    plugin_store::generation(&locked(&store.conn))
}

#[tauri::command]
fn plugin_store_get_many(
    state: tauri::State<AppState>,
    store: tauri::State<StoreState>,
    plugin_id: String,
    keys: Vec<String>,
) -> Result<Vec<Option<String>>, String> {
    store_access(&state, &plugin_id)?;
    plugin_store::get_many(&locked(&store.conn), &plugin_id, &keys)
}

#[tauri::command]
fn plugin_store_set_many(
    state: tauri::State<AppState>,
    store: tauri::State<StoreState>,
    plugin_id: String,
    generation: String,
    entries: Vec<(String, String)>,
) -> Result<(), String> {
    store_access(&state, &plugin_id)?;
    plugin_store::set_many(&locked(&store.conn), &plugin_id, &generation, &entries)
}

#[tauri::command]
fn plugin_store_delete_many(
    state: tauri::State<AppState>,
    store: tauri::State<StoreState>,
    plugin_id: String,
    generation: String,
    keys: Vec<String>,
) -> Result<(), String> {
    store_access(&state, &plugin_id)?;
    plugin_store::delete_many(&locked(&store.conn), &plugin_id, &generation, &keys)
}

#[tauri::command]
fn plugin_store_keys(
    state: tauri::State<AppState>,
    store: tauri::State<StoreState>,
    plugin_id: String,
    prefix: String,
) -> Result<Vec<String>, String> {
    store_access(&state, &plugin_id)?;
    plugin_store::keys(&locked(&store.conn), &plugin_id, &prefix)
}

#[tauri::command]
fn plugin_store_delete_prefix(
    state: tauri::State<AppState>,
    store: tauri::State<StoreState>,
    plugin_id: String,
    generation: String,
    prefix: String,
) -> Result<usize, String> {
    store_access(&state, &plugin_id)?;
    plugin_store::delete_prefix(&locked(&store.conn), &plugin_id, &generation, &prefix)
}

/// The pending update, held between `update_check` and `update_install`.
pub struct PendingUpdate(pub Mutex<Option<tauri_plugin_updater::Update>>);

/// The tray's menu items and icon, built once in `setup()` with a hardcoded
/// English placeholder (native tray UI exists before any webview has loaded,
/// so there is nothing to ask for a language yet) and retexted in place by
/// `set_tray_texts` once the webview knows the user's actual language —
/// same trust boundary as the rest of this app's i18n: JS already owns every
/// string's translation, Rust only ever applies text JS hands it.
pub struct TrayHandles {
    pub show: MenuItem<Wry>,
    pub quit: MenuItem<Wry>,
    pub tray: TrayIcon<Wry>,
}

/// Called once at startup (as soon as the webview knows the active language)
/// and again on every language change, so the tray never has to guess: it
/// starts in the fallback and is corrected the moment JS can say what it
/// should be.
#[tauri::command]
fn set_tray_texts(app: tauri::AppHandle, show: String, quit: String, tooltip: String) -> Result<(), String> {
    let handles = app.state::<TrayHandles>();
    handles.show.set_text(show).map_err(err_to_string)?;
    handles.quit.set_text(quit).map_err(err_to_string)?;
    handles.tray.set_tooltip(Some(tooltip)).map_err(err_to_string)?;
    Ok(())
}

/// Check the release feed from Rust, not from JS.
///
/// The updater's own JS commands take `proxy`, `headers` and
/// `allow_downgrades` straight from the caller — and every registered command
/// is reachable from any plugin in the webview (see the note on the command
/// list below). That combination let a plugin point the updater at its own
/// server and install an OLDER release of Notible: still signed by our key,
/// so the signature check passes, and `installMode: "passive"` means nobody
/// is asked. Downgrading to a version with a known hole is as good as
/// arbitrary code for an attacker.
///
/// So `updater:default` is off in `capabilities/default.json` and these two
/// commands are the only way in. They take no arguments: the endpoint, the
/// key and the version comparison are whatever the build was compiled with.
#[tauri::command]
async fn update_check(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<Option<String>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(err_to_string)?
        .check()
        .await
        .map_err(err_to_string)?;
    let version = update.as_ref().map(|found| found.version.clone());
    *pending.0.lock().map_err(err_to_string)? = update;
    Ok(version)
}

/// Download and install the update `update_check` found. Consumes it, so a
/// second call has nothing to install rather than installing twice.
#[tauri::command]
async fn update_install(app: tauri::AppHandle, pending: tauri::State<'_, PendingUpdate>) -> Result<(), String> {
    // The installer would overwrite the real install, not this test build.
    if sandbox::is_test_instance() {
        return Err("Updates are disabled in test instances.".into());
    }
    // Taken out of the lock before the first await: the guard must not be
    // held across one.
    let update = pending.0.lock().map_err(err_to_string)?.take();
    let update = update.ok_or("no update has been found yet")?;
    let bytes = update.download(|_, _| {}, || {}).await.map_err(err_to_string)?;
    // `Update::install` on Windows launches the NSIS/MSI installer and then
    // calls `std::process::exit(0)` directly — it never fires a window
    // `CloseRequested` event, so tauri-plugin-window-state's normal
    // save-on-close never runs and the fullscreen/maximized/size state right
    // before an update is silently lost (the next launch restores whatever
    // was saved from the last *ordinary* close instead). Save it ourselves,
    // one line, right before the point of no return.
    use tauri_plugin_window_state::{AppHandleExt as _, StateFlags};
    let _ = app.save_window_state(StateFlags::all());
    update.install(bytes).map_err(err_to_string)
}

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Reject payloads that are not valid JSON before they reach the DB.
fn require_json(label: &str, value: &Option<String>) -> Result<(), String> {
    if let Some(v) = value {
        serde_json::from_str::<serde_json::Value>(v)
            .map_err(|e| format!("invalid {label} JSON: {e}"))?;
    }
    Ok(())
}

fn require_known_type(conn: &Connection, name: &str) -> Result<(), String> {
    let exists: bool = conn
        .query_row("SELECT 1 FROM types WHERE name = ?1", [name], |_| Ok(true))
        .unwrap_or(false);
    if exists {
        Ok(())
    } else {
        Err(format!("unknown object type: {name}"))
    }
}

fn require_object_exists(conn: &Connection, id: &str) -> Result<(), String> {
    match db::get_object(conn, id).map_err(err_to_string)? {
        Some(_) => Ok(()),
        None => Err(format!("object not found: {id}")),
    }
}

#[tauri::command]
fn create_object(
    state: tauri::State<AppState>,
    r#type: String,
    title: String,
    content: Option<String>,
    props: Option<String>,
    parent_id: Option<String>,
) -> Result<Object, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    require_known_type(&conn, &r#type)?;
    require_json("content", &content)?;
    require_json("props", &props)?;
    if let Some(pid) = &parent_id {
        require_object_exists(&conn, pid)?;
    }
    db::create_object(
        &conn,
        &r#type,
        &title,
        content.as_deref(),
        props.as_deref(),
        parent_id.as_deref(),
    )
    .map_err(err_to_string)
}

#[tauri::command]
fn get_object(state: tauri::State<AppState>, id: String) -> Result<Option<Object>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::get_object(&conn, &id).map_err(err_to_string)
}

#[tauri::command]
fn update_object(
    state: tauri::State<AppState>,
    id: String,
    title: Option<String>,
    content: Option<String>,
    props: Option<String>,
    expected_updated_at: Option<i64>,
    writer: Option<String>,
) -> Result<Object, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    require_json("content", &content)?;
    require_json("props", &props)?;
    // Only the note editor's autosaves coalesce into sessions; any other value is ignored.
    let writer = writer.as_deref().filter(|value| *value == "editor");
    db::update_object_as(
        &conn,
        &id,
        title.as_deref(),
        content.as_deref(),
        props.as_deref(),
        expected_updated_at,
        writer,
        db::HistorySource::Local,
    )
    .map_err(err_to_string)
}

#[tauri::command]
fn set_object_type(
    state: tauri::State<AppState>,
    id: String,
    new_type: String,
    expected_updated_at: Option<i64>,
) -> Result<Object, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::set_object_type(&conn, &id, &new_type, expected_updated_at).map_err(err_to_string)
}

#[tauri::command]
fn list_history(
    state: tauri::State<AppState>,
    object_id: String,
    limit: Option<i64>,
) -> Result<Vec<HistoryMeta>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::list_history(&conn, &object_id, limit.unwrap_or(50)).map_err(err_to_string)
}

#[tauri::command]
fn restore_version(
    state: tauri::State<AppState>,
    object_id: String,
    version_id: i64,
) -> Result<Object, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let entry = db::get_history_entry(&conn, &object_id, version_id)
        .map_err(err_to_string)?
        .ok_or_else(|| "That version no longer exists.".to_string())?;
    let snap: serde_json::Value = serde_json::from_str(&entry.patch).map_err(err_to_string)?;
    // The same checks an ordinary save runs: a snapshot that came in through
    // sync was never validated on the way in.
    require_json("content", &snap["content"].as_str().map(str::to_string))?;
    require_json("props", &snap["props"].as_str().map(str::to_string))?;
    db::restore_version(&conn, &object_id, version_id).map_err(err_to_string)
}

#[tauri::command]
fn get_history_entry(state: tauri::State<AppState>, object_id: String, id: i64) -> Result<Option<HistoryEntry>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::get_history_entry(&conn, &object_id, id).map_err(err_to_string)
}

#[tauri::command]
fn delete_history_entry(state: tauri::State<AppState>, object_id: String, id: i64) -> Result<bool, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::delete_history_entry(&conn, &object_id, id).map_err(err_to_string)
}

#[tauri::command]
fn clear_history(state: tauri::State<AppState>, object_id: String) -> Result<usize, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::clear_history(&conn, &object_id).map_err(err_to_string)
}

#[tauri::command]
fn trash_object(state: tauri::State<AppState>, id: String) -> Result<Option<Object>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::trash_object(&conn, &id).map_err(err_to_string)
}

#[tauri::command]
fn restore_object(state: tauri::State<AppState>, id: String) -> Result<Option<Object>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::restore_object(&conn, &id).map_err(err_to_string)
}

#[tauri::command]
fn list_trash(state: tauri::State<AppState>) -> Result<Vec<Object>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::list_trash(&conn).map_err(err_to_string)
}

/// Remove media files that are no longer reachable from any record.
/// Only ever touches `app_data/media`, and only files nothing references.
fn remove_media_files(app: &tauri::AppHandle, filenames: &[String]) -> u64 {
    let Ok(dir) = app_data_dir(app).map(|path| path.join("media")) else {
        return 0;
    };
    let mut freed = 0;
    for filename in filenames {
        let path = dir.join(filename);
        // Belt and braces: the name came from our own scanner, but a path that
        // is not directly inside the media directory must never be unlinked.
        if path.parent() != Some(dir.as_path()) {
            continue;
        }
        let size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        if std::fs::remove_file(&path).is_ok() {
            freed += size;
        }
    }
    freed
}

/// Hard delete, plus the pasted images that die with the object.
///
/// Deleting the record used to leave every screenshot pasted into it sitting
/// in `app_data/media` forever — the note was gone from the app while its
/// pictures stayed readable on disk. The candidates are collected *before* the
/// row disappears and are only unlinked once nothing else (another note, a
/// property, or a restorable history snapshot) still mentions them.
#[tauri::command]
fn delete_object(app: tauri::AppHandle, state: tauri::State<AppState>, id: String) -> Result<bool, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    // MCP-CLEANUP (Hive #13): purge hold while an AI cleanup can still be undone.
    if mcp_cleanup::held_ids(&conn).map_err(err_to_string)?.contains(&id) {
        return Err("This note was moved to the Trash by an AI cleanup and can be undone for 24 hours. It can be deleted for good after that.".into());
    }
    let candidates = db::media_filenames_of_object(&conn, &id).map_err(err_to_string)?;
    let deleted = db::delete_object(&conn, &id).map_err(err_to_string)?;
    if deleted && !candidates.is_empty() {
        let orphans = db::unreferenced_media(&conn, &candidates).map_err(err_to_string)?;
        remove_media_files(&app, &orphans);
    }
    Ok(deleted)
}

/// Translations the user has installed, as validated data rather than file
/// text. See `locales.rs` for why this parses in Rust: any code in the webview
/// can call this, plugins included, so a command that returned file bytes
/// would be a read primitive whatever directory it pointed at.
#[tauri::command]
fn list_locales(app: tauri::AppHandle) -> Result<Vec<locales::LocaleBundle>, String> {
    Ok(locales::read_locales(&app_data_dir(&app)?))
}

/// Install a language pack the app downloaded (the text of its language.json).
/// Validated and re-written in Rust; see locales.rs.
#[tauri::command]
fn install_locale(app: tauri::AppHandle, json: String) -> Result<locales::LocaleBundle, String> {
    locales::install_locale(&app_data_dir(&app)?, &json)
}

#[tauri::command]
fn remove_locale(app: tauri::AppHandle, tag: String) -> Result<(), String> {
    locales::remove_locale(&app_data_dir(&app)?, &tag)
}

#[derive(serde::Serialize)]
struct MediaSweep {
    files: usize,
    bytes: u64,
    deleted: bool,
}

/// Report — and optionally delete — media files no record mentions any more.
///
/// These accumulate from before the delete-time collection above existed, and
/// from any path that drops an image reference without deleting the object
/// (undo, an edit that removes the picture, a restored backup).
#[tauri::command]
fn sweep_orphan_media(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    delete: bool,
) -> Result<MediaSweep, String> {
    let dir = app_data_dir(&app)?.join("media");
    if !dir.is_dir() {
        return Ok(MediaSweep { files: 0, bytes: 0, deleted: delete });
    }
    let on_disk: Vec<String> = std::fs::read_dir(&dir)
        .map_err(err_to_string)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_file())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let orphans = db::unreferenced_media(&conn, &on_disk).map_err(err_to_string)?;
    let bytes: u64 = orphans
        .iter()
        .filter_map(|name| std::fs::metadata(dir.join(name)).ok())
        .map(|meta| meta.len())
        .sum();
    if delete {
        let freed = remove_media_files(&app, &orphans);
        return Ok(MediaSweep { files: orphans.len(), bytes: freed, deleted: true });
    }
    Ok(MediaSweep { files: orphans.len(), bytes, deleted: false })
}

#[tauri::command]
fn list_root_objects(state: tauri::State<AppState>) -> Result<Vec<Object>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::list_root_objects(&conn).map_err(err_to_string)
}

/// User-configurable "keep the N newest backups" retention count, persisted
/// as a one-line file next to the backups themselves (no DB migration
/// warranted for a single integer). Read by both the manual backup command
/// and the automatic startup backup in `run()`.
fn backup_retention_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data_dir(app)?.join("backups").join("retention.txt"))
}

fn read_backup_retention(app: &tauri::AppHandle) -> usize {
    backup_retention_path(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(10)
}

#[tauri::command]
fn get_backup_retention(app: tauri::AppHandle) -> Result<usize, String> {
    Ok(read_backup_retention(&app))
}

#[tauri::command]
fn set_backup_retention(app: tauri::AppHandle, value: usize) -> Result<(), String> {
    let value = value.max(1);
    let path = backup_retention_path(&app)?;
    std::fs::create_dir_all(path.parent().expect("backups dir")).map_err(err_to_string)?;
    std::fs::write(path, value.to_string()).map_err(err_to_string)
}

#[tauri::command]
fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    // The Run key is per app name, so a test instance would report the real
    // install's setting.
    if sandbox::is_test_instance() {
        return Ok(false);
    }
    app.autolaunch().is_enabled().map_err(err_to_string)
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    // Would register this debug build to start with Windows.
    if enabled && sandbox::is_test_instance() {
        return Err("Autostart is disabled in test instances.".into());
    }
    if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    }
    .map_err(err_to_string)
}

#[tauri::command]
fn backup_database(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    store: tauri::State<StoreState>,
) -> Result<String, String> {
    let dir = app_data_dir(&app)?.join("backups");
    let keep = read_backup_retention(&app);
    let conn = locked(&state.conn);
    let path = db::backup_db(&conn, &dir, keep)?;
    // STORE-API (Hive #5): the backup now carries an epoch no live store has.
    if let Err(e) = plugin_store::rotate_epoch(&conn, &locked(&store.conn)) {
        eprintln!("plugin store epoch rotation failed: {e}");
    }
    Ok(path.to_string_lossy().into_owned())
}

/// The folder backups live in, so Recovery can tell the user exactly where a
/// backup dropped in from elsewhere (a cloud drive, another machine) needs to go.
#[tauri::command]
fn backups_directory(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app_data_dir(&app)?.join("backups");
    std::fs::create_dir_all(&dir).map_err(err_to_string)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_backups(app: tauri::AppHandle) -> Result<Vec<db::BackupInfo>, String> {
    let dir = app_data_dir(&app)?.join("backups");
    db::list_backups(&dir)
}

#[tauri::command]
fn delete_backup(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = app_data_dir(&app)?.join("backups");
    db::delete_backup(&dir, &PathBuf::from(path))
}

/// Restore the complete workspace database from a validated local backup.
/// The live connection is released before the atomic file swap so Windows can
/// rename the database. On validation failure, the current database remains
/// in place and the connection is reopened.
#[tauri::command]
fn restore_database(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    store: tauri::State<StoreState>,
    cleanup: tauri::State<mcp_cleanup::McpCleanupState>,
    backup_path: String,
) -> Result<String, String> {
    // MCP-CLEANUP (Hive #13): no AI cleanup request from before the restore may run.
    cleanup.rotate();
    let destination = app_data_dir(&app)?.join("notible.db");
    let backup = PathBuf::from(&backup_path);
    if !backup.is_file() {
        return Err(format!("backup file does not exist: {backup_path}"));
    }
    if backup == destination {
        return Err("backup and live database must be different files".into());
    }

    let in_memory = db::open_in_memory().map_err(err_to_string)?;
    {
        let mut guard = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let old = std::mem::replace(&mut *guard, in_memory);
        drop(old);
    }

    if let Err(error) = db::restore_db_copy(&backup, &destination) {
        let reopened = db::open(destination.to_str().ok_or("database path is not UTF-8")?)
            .map_err(err_to_string)?;
        let mut guard = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let old = std::mem::replace(&mut *guard, reopened);
        drop(old);
        return Err(error);
    }

    let reopened = db::open(destination.to_str().ok_or("database path is not UTF-8")?)
        .map_err(err_to_string)?;
    let mut guard = locked(&state.conn);
    let old = std::mem::replace(&mut *guard, reopened);
    drop(old);
    // STORE-API (Hive #5): the store described the database just replaced.
    // Main DB lock is held first, then the store lock, for the whole wipe.
    let mut store_guard = locked(&store.conn);
    // The file swap already happened, so a store failure is not returned.
    // SYNC-NO-LOSS (Hive #14, F7): it fails closed instead of leaving the old
    // store (sync lineage for the replaced database) in use until a restart.
    if let Err(e) = plugin_store::wipe(&store_guard)
        .and_then(|_| plugin_store::rotate_epoch(&guard, &store_guard))
    {
        plugin_store::fail_closed(&mut store_guard, &format!("reset after restore failed: {e}"));
    }
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
fn archive_object(state: tauri::State<AppState>, id: String) -> Result<Option<Object>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::archive_object(&conn, &id).map_err(err_to_string)
}

#[tauri::command]
fn list_objects(
    state: tauri::State<AppState>,
    r#type: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<Object>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::list_objects(
        &conn,
        r#type.as_deref(),
        limit.unwrap_or(100),
        offset.unwrap_or(0),
    )
    .map_err(err_to_string)
}

#[tauri::command]
fn search_objects(
    state: tauri::State<AppState>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<Object>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::search_objects(&conn, &query, limit.unwrap_or(100)).map_err(err_to_string)
}

#[tauri::command]
fn search_objects_text(
    state: tauri::State<AppState>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<Object>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::search_objects_text(&conn, &query, limit.unwrap_or(5000)).map_err(err_to_string)
}

/// Backs the plugin API's `objects.findByTitle` (API 1.18). See
/// `db::find_objects_by_title` for why this is title-only, not the
/// title+content `search_objects` above.
#[tauri::command]
fn find_objects_by_title(
    state: tauri::State<AppState>,
    query: String,
    exact: Option<bool>,
    limit: Option<i64>,
) -> Result<Vec<Object>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::find_objects_by_title(&conn, &query, exact.unwrap_or(false), limit.unwrap_or(100)).map_err(err_to_string)
}

#[tauri::command]
fn create_relation(
    state: tauri::State<AppState>,
    from_id: String,
    to_id: String,
    kind: String,
) -> Result<Relation, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if kind.trim().is_empty() {
        return Err("relation kind cannot be empty".into());
    }
    require_object_exists(&conn, &from_id)?;
    require_object_exists(&conn, &to_id)?;
    db::create_relation(&conn, &from_id, &to_id, &kind).map_err(err_to_string)
}

#[tauri::command]
fn delete_relation(
    state: tauri::State<AppState>,
    from_id: String,
    to_id: String,
    kind: String,
) -> Result<bool, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::delete_relation(&conn, &from_id, &to_id, &kind).map_err(err_to_string)
}

const GANTT_DEPENDENCY_KINDS: [&str; 4] = ["gantt_fs", "gantt_ss", "gantt_ff", "blocks"];

#[tauri::command]
fn create_gantt_dependency(
    state: tauri::State<AppState>,
    predecessor_id: String,
    successor_id: String,
    kind: String,
) -> Result<Relation, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if !GANTT_DEPENDENCY_KINDS.contains(&kind.as_str()) {
        return Err("unsupported gantt dependency kind".into());
    }
    if predecessor_id == successor_id {
        return Err("a task cannot depend on itself".into());
    }
    require_object_exists(&conn, &predecessor_id)?;
    require_object_exists(&conn, &successor_id)?;
    if db::gantt_dependency_would_cycle(&conn, &predecessor_id, &successor_id)
        .map_err(err_to_string)?
    {
        return Err("dependency would create a cycle".into());
    }
    db::create_relation(&conn, &predecessor_id, &successor_id, &kind).map_err(err_to_string)
}

#[tauri::command]
fn delete_gantt_dependency(
    state: tauri::State<AppState>,
    predecessor_id: String,
    successor_id: String,
    kind: String,
) -> Result<bool, String> {
    if !GANTT_DEPENDENCY_KINDS.contains(&kind.as_str()) {
        return Err("unsupported gantt dependency kind".into());
    }
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::delete_relation(&conn, &predecessor_id, &successor_id, &kind).map_err(err_to_string)
}

#[tauri::command]
fn list_relations(
    state: tauri::State<AppState>,
    object_id: String,
) -> Result<Vec<Relation>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::list_relations(&conn, &object_id).map_err(err_to_string)
}

#[tauri::command]
fn list_relations_bulk(
    state: tauri::State<AppState>,
    ids: Vec<String>,
) -> Result<Vec<Relation>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::list_relations_bulk(&conn, &ids).map_err(err_to_string)
}

#[tauri::command]
fn query_objects(
    state: tauri::State<AppState>,
    parent_id: Option<String>,
    r#type: Option<String>,
    tag: Option<String>,
    include_archived: Option<bool>,
    limit: Option<i64>,
) -> Result<Vec<Object>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::query_objects(
        &conn,
        parent_id.as_deref(),
        r#type.as_deref(),
        tag.as_deref(),
        include_archived.unwrap_or(false),
        limit.unwrap_or(500).clamp(1, 5000),
    )
    .map_err(err_to_string)
}

#[tauri::command]
fn move_object(
    state: tauri::State<AppState>,
    id: String,
    new_parent_id: Option<String>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::move_object(&conn, &id, new_parent_id.as_deref()).map_err(err_to_string)
}

#[tauri::command]
fn list_types(state: tauri::State<AppState>) -> Result<Vec<TypeDef>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::list_types(&conn).map_err(err_to_string)
}

#[tauri::command]
fn upsert_type(
    state: tauri::State<AppState>,
    name: String,
    schema: String,
    icon: Option<String>,
    color: Option<String>,
    plugin_id: Option<String>,
) -> Result<TypeDef, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::validate_type_namespace(&name, &schema, plugin_id.as_deref())?;
    db::upsert_type(&conn, &name, &schema, icon.as_deref(), color.as_deref()).map_err(err_to_string)
}

#[tauri::command]
fn get_backlinks(state: tauri::State<AppState>, id: String) -> Result<Vec<Backlink>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::get_backlinks(&conn, &id).map_err(err_to_string)
}

#[tauri::command]
fn set_tags(
    state: tauri::State<AppState>,
    id: String,
    tags: Vec<String>,
) -> Result<Option<Object>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::set_tags(&conn, &id, &tags).map_err(err_to_string)
}

#[tauri::command]
fn list_all_tags(state: tauri::State<AppState>) -> Result<Vec<String>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::list_all_tags(&conn).map_err(err_to_string)
}

/// Write export content into app_data/exports/<filename>; returns the path.
#[tauri::command]
fn write_export(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<String, String> {
    // strip path separators so the file always lands inside exports/
    let safe: String = filename
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let safe = safe.trim().trim_matches('.');
    if safe.is_empty() {
        return Err("empty filename".into());
    }
    let dir = app_data_dir(&app)?.join("exports");
    std::fs::create_dir_all(&dir).map_err(err_to_string)?;
    let path = dir.join(safe);
    std::fs::write(&path, content).map_err(err_to_string)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Save a base64-encoded image into app_data/media/<uuid>.<ext>; returns the path.
#[tauri::command]
fn save_media(app: tauri::AppHandle, data_base64: String, ext: String) -> Result<String, String> {
    use base64::Engine;
    let ext = ext.to_ascii_lowercase();
    if !matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp"
    ) {
        return Err(format!("unsupported image type: {ext}"));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(err_to_string)?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("image too large (max 20 MB)".into());
    }
    let dir = app_data_dir(&app)?.join("media");
    std::fs::create_dir_all(&dir).map_err(err_to_string)?;
    let path = dir.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
    std::fs::write(&path, bytes).map_err(err_to_string)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Write base64-decoded bytes into app_data/exports/<filename>; returns the
/// path. The binary twin of `write_export` — a plugin generates a spreadsheet
/// or an image and hands Core the bytes. Filename is sanitised the same way.
#[tauri::command]
fn save_export_binary(
    app: tauri::AppHandle,
    filename: String,
    data_base64: String,
) -> Result<String, String> {
    use base64::Engine;
    let safe: String = filename
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let safe = safe.trim().trim_matches('.');
    if safe.is_empty() {
        return Err("empty filename".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(err_to_string)?;
    if bytes.len() > 50 * 1024 * 1024 {
        return Err("file too large (max 50 MB)".into());
    }
    let dir = app_data_dir(&app)?.join("exports");
    std::fs::create_dir_all(&dir).map_err(err_to_string)?;
    let path = dir.join(safe);
    std::fs::write(&path, bytes).map_err(err_to_string)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Like `save_export_binary`, but through a native "Save As" dialog instead
/// of the fixed exports/ folder — the user picks both the folder and the
/// file name. `filename` only seeds the dialog's default name. Returns
/// `Ok(None)` on cancel (not an error) rather than a path.
#[tauri::command]
async fn save_export_binary_as(
    app: tauri::AppHandle,
    filename: String,
    data_base64: String,
) -> Result<Option<String>, String> {
    use base64::Engine;
    use tauri_plugin_dialog::DialogExt;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(err_to_string)?;
    if bytes.len() > 50 * 1024 * 1024 {
        return Err("file too large (max 50 MB)".into());
    }
    let extension = std::path::Path::new(&filename)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_uppercase());
    if let Some(dir) = sandbox::exports_dir() {
        let name = std::path::Path::new(&filename)
            .file_name()
            .ok_or("invalid file name")?;
        std::fs::create_dir_all(&dir).map_err(err_to_string)?;
        let path = dir.join(name);
        std::fs::write(&path, bytes).map_err(err_to_string)?;
        return Ok(Some(path.to_string_lossy().into_owned()));
    }
    let mut dialog = app.dialog().file().set_file_name(&filename);
    if let Some(extension) = extension.as_deref() {
        dialog = dialog.add_filter(extension, &[&extension.to_ascii_lowercase()]);
    }
    let Some(chosen) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = chosen
        .into_path()
        .map_err(|_| "chosen save path is not a local file".to_string())?;
    std::fs::write(&path, bytes).map_err(err_to_string)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

// ---------------------------------------------------------------- sync media
//
// A pasted screenshot lives in `app_data/media` and only its filename is
// stored in the note, so a synchronised workspace shows dead pictures on the
// second machine unless the bytes travel too. The sync plugin cannot read
// files, so these commands are its only way — and, because every registered
// command is reachable from ANY plugin in the webview, they are written as if
// the caller were hostile.

/// Whether plugins may read pasted image bytes at all.
const MEDIA_SHARING_KEY: &str = "media_sharing_allowed";

/// One media file may not exceed this, matching `save_media`.
const MEDIA_MAX_BYTES: usize = 20 * 1024 * 1024;

/// And the folder as a whole may not. Without a ceiling, a crafted snapshot
/// naming 50 000 files fills the disk — and `sweep_orphan_media` will not win
/// it back, because a name mentioned in `history` counts as referenced
/// (`db::media_filename_is_referenced`).
const MEDIA_MAX_DIR_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// Where this installation keeps pasted images. The front end needs it to
/// turn a stored `media/<uuid>.<ext>` reference into a loadable URL; it is
/// the directory path only, never a file's contents.
#[tauri::command]
fn media_directory(app: tauri::AppHandle) -> Result<String, String> {
    Ok(media_dir(&app)?.to_string_lossy().into_owned())
}

fn media_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join("media");
    std::fs::create_dir_all(&dir).map_err(err_to_string)?;
    Ok(dir)
}

/// Resolve a peer-supplied filename inside the media directory, or refuse.
///
/// Two independent checks, because either one alone has been wrong before:
/// the shape of the name, and the parent of the joined path. On Windows
/// `Path::join` with a component carrying a drive letter REPLACES the base —
/// that was the 0.51.0 package escape — so the parent check is what catches
/// the family of tricks the name check has not thought of.
fn media_path(app: &tauri::AppHandle, filename: &str) -> Result<PathBuf, String> {
    if !db::is_media_filename(filename) {
        return Err(format!("not a media filename: {filename}"));
    }
    let dir = media_dir(app)?;
    let path = dir.join(filename);
    if path.parent() != Some(dir.as_path()) {
        return Err("media path escapes the media directory".into());
    }
    // A symlink or junction planted inside media/ (by a third party or the
    // user — neither save_media nor sync_media_write can create one) would let
    // this resolve to a file elsewhere. Neither of our own writers follows a
    // link (files.rs makes the same choice after the `mklink /J` finding), so
    // refuse one here rather than read through it.
    if let Ok(meta) = std::fs::symlink_metadata(&path) {
        if meta.file_type().is_symlink() {
            return Err("media entry is a symbolic link".into());
        }
    }
    Ok(path)
}

/// Do the first bytes match the extension the name claims?
///
/// `svg` is absent on purpose and refused outright by `sync_media_write`: it
/// is the one accepted extension carrying active content and the one with no
/// magic bytes at all, so "contents match the extension" would either be
/// vacuous or a second XML parser disagreeing with the WebView's.
fn media_bytes_match_extension(filename: &str, bytes: &[u8]) -> bool {
    let extension = filename.rsplit('.').next().unwrap_or_default();
    let starts = |prefix: &[u8]| bytes.starts_with(prefix);
    match extension {
        "png" => starts(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        "jpg" | "jpeg" => starts(&[0xFF, 0xD8, 0xFF]),
        "gif" => starts(b"GIF87a") || starts(b"GIF89a"),
        "bmp" => starts(b"BM"),
        "webp" => bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

/// Open Notible's own picker and copy the selected image into managed media.
/// The command deliberately accepts no path: only a fresh user gesture can
/// choose the source file. The extension comes from the bytes, not its name.
#[tauri::command]
async fn pick_media_image(app: tauri::AppHandle, state: tauri::State<'_, AppState>, plugin_id: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    if !plugins::valid_plugin_id(&plugin_id) { return Err("invalid plugin id".into()); }
    let chosen = crate::sandbox::picked_path().unwrap_or_else(|| app.dialog().file()
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
        .blocking_pick_file().map(|file| file.to_string()));
    let Some(chosen) = chosen else { return Ok(None) };
    let source = PathBuf::from(chosen);
    let meta = std::fs::metadata(&source).map_err(err_to_string)?;
    if !meta.is_file() { return Err("selected image is not a file".into()); }
    if meta.len() > MEDIA_MAX_BYTES as u64 { return Err("image too large (max 20 MB)".into()); }
    let bytes = std::fs::read(&source).map_err(err_to_string)?;
    if bytes.len() > MEDIA_MAX_BYTES { return Err("image too large (max 20 MB)".into()); }
    let ext = ["png", "jpg", "gif", "webp", "bmp"].into_iter()
        .find(|ext| media_bytes_match_extension(&format!("image.{ext}"), &bytes))
        .ok_or("selected file is not a supported image")?;
    store_plugin_media(&app, &state, &plugin_id, &bytes, ext).map(Some)
}

/// Write image bytes to a fresh `media/<uuid>.<ext>` (never overwriting) and record
/// that `plugin_id` owns it, so `plugin_media_read` lets that plugin read it back.
fn store_plugin_media(app: &tauri::AppHandle, state: &AppState, plugin_id: &str, bytes: &[u8], ext: &str) -> Result<String, String> {
    let dir = media_dir(app)?;
    if media_dir_size(&dir) + bytes.len() as u64 > MEDIA_MAX_DIR_BYTES {
        return Err("the media folder is at its size limit".into());
    }
    let filename = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    let path = media_path(app, &filename)?;
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(err_to_string)?;
    file.write_all(bytes).map_err(err_to_string)?;
    let conn = locked(&state.conn);
    let key = format!("plugin_media_owner:{plugin_id}");
    let mut owned: Vec<String> = db::get_sync_state(&conn, &key).map_err(err_to_string)?.and_then(|value| serde_json::from_str(&value).ok()).unwrap_or_default();
    owned.push(filename.clone());
    owned.sort(); owned.dedup();
    db::set_sync_state(&conn, &key, &serde_json::to_string(&owned).map_err(err_to_string)?).map_err(err_to_string)?;
    Ok(format!("media/{filename}"))
}

/// Plugin API 1.28 `media.importImageFromUrl`. The hosts and permissions come from the
/// plugin's stored manifest (active and trusted), never from the caller; media_import.rs
/// checks https, hosts per redirect hop, public IPs, timeout, size and image bytes.
#[tauri::command]
async fn plugin_media_import_url(app: tauri::AppHandle, state: tauri::State<'_, AppState>, plugin_id: String, url: String) -> Result<String, String> {
    if !plugins::valid_plugin_id(&plugin_id) { return Err("invalid plugin id".into()); }
    let hosts = {
        let conn = locked(&state.conn);
        let entry = db::list_plugin_registry(&conn).map_err(err_to_string)?.into_iter()
            .find(|entry| entry.plugin_id == plugin_id && entry.state == "active" && (entry.verified || entry.user_trusted))
            .ok_or("plugin is not installed, trusted and active")?;
        let manifest: serde_json::Value = serde_json::from_str(&entry.manifest).map_err(|error| format!("invalid stored manifest: {error}"))?;
        media_import::allowed_hosts(&manifest)?
    };
    let (bytes, ext) = media_import::import(&url, &hosts, media_import::TIMEOUT, media_import::resolve_host, media_import::fetch_hop).await?;
    store_plugin_media(&app, &state, &plugin_id, &bytes, ext)
}

#[tauri::command]
fn plugin_media_read(app: tauri::AppHandle, state: tauri::State<AppState>, plugin_id: String, filename: String) -> Result<String, String> {
    use base64::Engine;
    if !plugins::valid_plugin_id(&plugin_id) || !db::is_media_filename(&filename) { return Err("invalid plugin media reference".into()); }
    let conn = locked(&state.conn);
    let key = format!("plugin_media_owner:{plugin_id}");
    let owned: Vec<String> = db::get_sync_state(&conn, &key).map_err(err_to_string)?.and_then(|value| serde_json::from_str(&value).ok()).unwrap_or_default();
    if !owned.iter().any(|name| name == &filename) { return Err("plugin does not own this media file".into()); }
    let path = media_path(&app, &filename)?;
    let bytes = std::fs::read(&path).map_err(err_to_string)?;
    if bytes.len() > MEDIA_MAX_BYTES { return Err("image too large (max 20 MB)".into()); }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Which of these media files this machine does not have yet.
///
/// Reads nothing out, so it carries no switch of its own: the names are
/// already in note content the caller can read anyway.
#[tauri::command]
fn sync_media_missing(
    app: tauri::AppHandle,
    filenames: Vec<String>,
) -> Result<Vec<String>, String> {
    let dir = media_dir(&app)?;
    Ok(filenames
        .into_iter()
        .filter(|name| db::is_media_filename(name) && !dir.join(name).is_file())
        .collect())
}

/// Read one pasted image, base64, so a sync plugin can carry it to the other
/// machine.
///
/// This hands plugin code the bytes of every screenshot the user ever pasted,
/// and the CSP lets any plugin POST them anywhere. There is no caller
/// identity in this architecture to gate it with, so it is gated on the user
/// instead: off by default, switched on only through a native dialog that JS
/// cannot click.
#[tauri::command]
fn sync_media_read(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    filename: String,
) -> Result<String, String> {
    if !media_sharing_allowed(&state)? {
        return Err("Reading pasted images is switched off in Settings.".into());
    }
    use base64::Engine;
    let path = media_path(&app, &filename)?;
    let bytes = std::fs::read(&path).map_err(err_to_string)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Store one pasted image that arrived from another machine.
///
/// Needs no switch — writing does not exfiltrate — but every other rule
/// applies, because this is a peer writing a file onto the user's disk.
#[tauri::command]
fn sync_media_write(
    app: tauri::AppHandle,
    filename: String,
    data_base64: String,
) -> Result<(), String> {
    use base64::Engine;
    if filename.ends_with(".svg") {
        return Err("svg is not accepted from another machine".into());
    }
    let path = media_path(&app, &filename)?;
    // Never overwrite. The name is a v4 UUID, so a file already under this
    // name IS this file; a second copy could only be a peer replacing the
    // user's screenshot with its own, and there is no bin to restore from.
    if path.exists() {
        return Ok(());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(err_to_string)?;
    if bytes.len() > MEDIA_MAX_BYTES {
        return Err("image too large (max 20 MB)".into());
    }
    if !media_bytes_match_extension(&filename, &bytes) {
        return Err(format!("contents are not a {filename}"));
    }
    let dir = media_dir(&app)?;
    if media_dir_size(&dir) + bytes.len() as u64 > MEDIA_MAX_DIR_BYTES {
        return Err("the media folder is at its size limit".into());
    }
    // Written under a random name in a subdirectory, then renamed into place.
    // Not `<name>.part` beside it: `sweep_orphan_media` lists everything in
    // `media` and deletes what the database does not mention, so a file in
    // flight would vanish under the writer's hand.
    let staging = dir.join(".tmp");
    std::fs::create_dir_all(&staging).map_err(err_to_string)?;
    let temporary = staging.join(format!("{}.part", uuid::Uuid::new_v4()));
    std::fs::write(&temporary, &bytes).map_err(err_to_string)?;
    let written = std::fs::metadata(&temporary)
        .map(|meta| meta.len())
        .unwrap_or(0);
    if written != bytes.len() as u64 {
        let _ = std::fs::remove_file(&temporary);
        return Err("short write while storing media".into());
    }
    std::fs::rename(&temporary, &path).map_err(err_to_string)
}

/// Bytes held directly in the media directory, ignoring the staging folder.
fn media_dir_size(dir: &std::path::Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter_map(|entry| entry.metadata().ok())
        .filter(|meta| meta.is_file())
        .map(|meta| meta.len())
        .sum()
}

fn media_sharing_allowed(state: &tauri::State<AppState>) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(err_to_string)?;
    Ok(db::get_sync_state(&conn, MEDIA_SHARING_KEY)
        .map_err(err_to_string)?
        .as_deref()
        == Some("true"))
}

#[tauri::command]
fn media_sharing_status(state: tauri::State<AppState>) -> Result<bool, String> {
    media_sharing_allowed(&state)
}

/// Turn plugin access to pasted images on or off.
///
/// Switching it ON asks natively first. A plugin can call this command — that
/// is the architecture, not an oversight — so the dialog IS the control: it
/// cannot be clicked from JS, and it names what is being granted. Switching
/// off is free; taking a capability away never needs a prompt.
#[tauri::command]
fn set_media_sharing(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    allowed: bool,
) -> Result<bool, String> {
    if allowed && !media_sharing_allowed(&state)? {
        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
        let approved = sandbox::dialog_answer("Let plugins read pasted images?").unwrap_or_else(|| app
            .dialog()
            .message(
                "Installed plugins will be able to read every image you have pasted into a note, and to send it anywhere. Turn this on only while you are syncing between your own machines, with a sync plugin you trust.",
            )
            .title("Let plugins read pasted images?")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Allow".into(),
                "Cancel".into(),
            ))
            .blocking_show());
        if !approved {
            return Ok(false);
        }
    }
    let conn = state.conn.lock().map_err(err_to_string)?;
    db::set_sync_state(
        &conn,
        MEDIA_SHARING_KEY,
        if allowed { "true" } else { "false" },
    )
    .map_err(err_to_string)?;
    Ok(allowed)
}

/// Whether builtin surfaces may connect an external calendar and read it.
const CALENDAR_SHARING_KEY: &str = "calendar_sharing_allowed";

pub(crate) fn calendar_sharing_allowed(state: &tauri::State<AppState>) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(err_to_string)?;
    Ok(db::get_sync_state(&conn, CALENDAR_SHARING_KEY)
        .map_err(err_to_string)?
        .as_deref()
        == Some("true"))
}

#[tauri::command]
fn calendar_sharing_status(state: tauri::State<AppState>) -> Result<bool, String> {
    calendar_sharing_allowed(&state)
}

/// Turn the Calendar tab's access to external calendars on or off.
///
/// Turning it ON asks natively first — a plugin can call this command, so the
/// dialog IS the control: it cannot be clicked from JS and it names what is
/// being granted. Turning off is free.
#[tauri::command]
fn set_calendar_sharing(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    allowed: bool,
) -> Result<bool, String> {
    if allowed && !calendar_sharing_allowed(&state)? {
        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
        let approved = sandbox::dialog_answer("Let plugins read your calendars?").unwrap_or_else(|| app
            .dialog()
            .message(
                "The Calendar tab will be able to open a Google or Microsoft sign-in in your browser and read the events on the calendars you choose. Turn this on only if you want to see an external calendar next to your project.",
            )
            .title("Let plugins read your calendars?")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Allow".into(),
                "Cancel".into(),
            ))
            .blocking_show());
        if !approved {
            return Ok(false);
        }
    }
    let conn = state.conn.lock().map_err(err_to_string)?;
    db::set_sync_state(
        &conn,
        CALENDAR_SHARING_KEY,
        if allowed { "true" } else { "false" },
    )
    .map_err(err_to_string)?;
    Ok(allowed)
}

/// Import a Markdown file from disk as a new note (optionally into a parent).
#[tauri::command]
fn import_markdown(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    path: String,
    parent_id: Option<String>,
) -> Result<Object, String> {
    // Containment, not a bare caller-supplied path. Without this the command
    // read any .md/.txt on the machine and wrote it into an object the calling
    // plugin could read straight back out — a read-and-exfiltrate primitive
    // needing no grant and no click. `pick_file` grants the one file the user
    // chose, which is what an import should be built on.
    let resolved = files::resolve_granted_file(&app, &path)?;
    let p = resolved.as_path();
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    if !matches!(ext.as_deref(), Some("md") | Some("markdown") | Some("txt")) {
        return Err("only .md, .markdown and .txt files can be imported".into());
    }
    let meta = std::fs::metadata(p).map_err(err_to_string)?;
    if meta.len() > 5 * 1024 * 1024 {
        return Err("file too large (max 5 MB)".into());
    }
    let raw = std::fs::read_to_string(p).map_err(err_to_string)?;
    // title: first heading, else the file stem
    let title = raw
        .lines()
        .find_map(|l| l.strip_prefix("# ").map(|t| t.trim().to_string()))
        .unwrap_or_else(|| {
            p.file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Imported note".into())
        });
    let content = db::markdown_to_tiptap(&raw).to_string();
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(pid) = &parent_id {
        require_object_exists(&conn, pid)?;
    }
    db::create_object(
        &conn,
        "note",
        &title,
        Some(&content),
        None,
        parent_id.as_deref(),
    )
    .map_err(err_to_string)
}

#[tauri::command]
fn list_data_sources(state: tauri::State<AppState>) -> Result<Vec<db::DataSource>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::list_data_sources(&conn).map_err(err_to_string)
}

#[tauri::command]
fn upsert_data_source(
    state: tauri::State<AppState>,
    id: Option<String>,
    name: String,
    definition: String,
) -> Result<db::DataSource, String> {
    if name.trim().is_empty() {
        return Err("data source name cannot be empty".into());
    }
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::upsert_data_source(&conn, id.as_deref(), &name, &definition).map_err(err_to_string)
}

#[tauri::command]
fn delete_data_source(state: tauri::State<AppState>, id: String) -> Result<bool, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::delete_data_source(&conn, &id).map_err(err_to_string)
}

#[tauri::command]
fn write_xlsx(
    app: tauri::AppHandle,
    filename: String,
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
) -> Result<String, String> {
    if headers.is_empty() || headers.len() > 200 || rows.len() > 50_000 {
        return Err("invalid spreadsheet dimensions".into());
    }
    let safe: String = filename
        .chars()
        .map(|ch| {
            if matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                ch
            }
        })
        .collect();
    let safe = if safe.to_ascii_lowercase().ends_with(".xlsx") {
        safe
    } else {
        format!("{safe}.xlsx")
    };
    let dir = app_data_dir(&app)?.join("exports");
    std::fs::create_dir_all(&dir).map_err(err_to_string)?;
    let path = dir.join(safe);
    let mut workbook = rust_xlsxwriter::Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet.set_name("Finance").map_err(err_to_string)?;
    for (column, header) in headers.iter().enumerate() {
        worksheet
            .write_string(0, column as u16, header)
            .map_err(err_to_string)?;
    }
    for (row_index, row) in rows.iter().enumerate() {
        for (column, value) in row.iter().take(headers.len()).enumerate() {
            let numeric_column = matches!(
                headers[column].to_ascii_lowercase().as_str(),
                "amount" | "hours" | "billable_rate" | "cost_rate"
            );
            if numeric_column {
                if let Ok(number) = value.parse::<f64>() {
                    worksheet
                        .write_number((row_index + 1) as u32, column as u16, number)
                        .map_err(err_to_string)?;
                    continue;
                }
            }
            worksheet
                .write_string((row_index + 1) as u32, column as u16, value)
                .map_err(err_to_string)?;
        }
    }
    worksheet.autofit();
    workbook.save(&path).map_err(err_to_string)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_integration_events(
    state: tauri::State<AppState>,
    after: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<IntegrationEvent>, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::list_integration_events(&conn, after.unwrap_or(0), limit.unwrap_or(100))
        .map_err(err_to_string)
}

#[tauri::command]
fn sync_export(state: tauri::State<AppState>) -> Result<SyncSnapshot, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let device_id = match db::get_sync_state(&conn, "device_id").map_err(err_to_string)? {
        Some(value) => value,
        None => {
            let value = uuid::Uuid::new_v4().to_string();
            db::set_sync_state(&conn, "device_id", &value).map_err(err_to_string)?;
            value
        }
    };
    // SYNC-NO-LOSS (Hive #18, N1): the export's place in local history. The
    // plugin hands it back in `sync_apply`, which refuses planned ids moved,
    // trashed, restored or archived after it.
    let cursor = db::sync_export_mark(&conn).map_err(err_to_string)?;
    db::prepare_sync_outbox(&conn, &device_id).map_err(err_to_string)?;
    Ok(SyncSnapshot {
        device_id,
        cursor,
        objects: db::list_all_objects_for_sync(&conn).map_err(err_to_string)?,
        relations: db::list_sync_relations(&conn).map_err(err_to_string)?,
        tombstones: db::list_sync_tombstones(&conn).map_err(err_to_string)?,
        relation_tombstones: db::list_sync_relation_tombstones(&conn).map_err(err_to_string)?,
        outbox: db::list_sync_outbox(&conn, 500).map_err(err_to_string)?,
        conflicts: sync_conflicts::descriptors(&conn).map_err(err_to_string)?,
    })
}

// Hive #7: Core owns recovery; the plugin surface is navigation only.
#[tauri::command]
fn sync_conflict_list(state: tauri::State<AppState>, offset: Option<i64>) -> Result<Vec<sync_conflicts::QueueItem>, String> {
    sync_conflicts::queue(&locked(&state.conn),offset.unwrap_or(0)).map_err(err_to_string)
}
#[tauri::command]
fn sync_conflict_pair(state: tauri::State<AppState>, copy_id:String, original_id:Option<String>) -> Result<sync_conflicts::Pair,String> {
    sync_conflicts::pair(&locked(&state.conn),&copy_id,original_id.as_deref())
}
#[tauri::command]
fn sync_conflict_resolve(state: tauri::State<AppState>, request:sync_conflicts::Resolution) -> Result<sync_conflicts::Saved,String> {
    sync_conflicts::resolve(&locked(&state.conn),&request)
}
#[tauri::command]
fn sync_conflict_undo(state: tauri::State<AppState>, token:String) -> Result<sync_conflicts::Undone,String> {
    sync_conflicts::undo(&locked(&state.conn),&token)
}
#[tauri::command]
fn sync_conflict_descriptors(state: tauri::State<AppState>) -> Result<Vec<sync_conflicts::Descriptor>,String> {
    sync_conflicts::active_descriptors(&locked(&state.conn)).map_err(err_to_string)
}

#[tauri::command]
fn sync_mark_outbox_attempts(
    state: tauri::State<AppState>,
    operation_ids: Vec<String>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    db::mark_sync_outbox_attempts(&conn, &operation_ids).map_err(err_to_string)
}

#[tauri::command]
fn sync_apply(state: tauri::State<AppState>, request: SyncApplyRequest) -> Result<SyncApplyResult, String> {
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    conn.execute_batch("BEGIN IMMEDIATE").map_err(err_to_string)?;
    let result = apply_sync_request(&conn, &request);
    match result {
        Ok(value) => { conn.execute_batch("COMMIT").map_err(err_to_string)?; Ok(value) }
        Err(error) => { let _ = conn.execute_batch("ROLLBACK"); Err(error) }
    }
}

/// The body of `sync_apply`, inside the caller's transaction.
fn apply_sync_request(conn: &rusqlite::Connection, request: &SyncApplyRequest) -> Result<SyncApplyResult, String> {
    {
        let mut applied_objects = 0;
        let mut deleted_objects = 0;
        // SYNC-NO-LOSS (Hive #14, F2; Hive #18, N1): decided before anything is
        // written. A planned id is stale when its row changed since the plan
        // (`updated_at`) or it was moved, trashed, restored or archived here
        // after the export the plan came from (its mark is above that export's
        // cursor; those changes leave `updated_at` alone). Nothing about a
        // stale id is applied, not its row, tombstone or relations, and the
        // caller retries it against the new state.
        let moved_since_export = |id: &str| -> Result<bool, String> {
            Ok(db::local_mark(conn, id).map_err(err_to_string)?.is_some_and(|rev| rev > request.cursor))
        };
        // Hive #19: the cursor is checked against every id the request would
        // touch (rows, object tombstones, the `from_id` of relations and
        // relation tombstones), so a tombstone-only or relation-only apply
        // cannot undo a restore or a move either.
        let mut stale = std::collections::BTreeSet::new();
        if let Some(expected) = &request.expected {
            for (id, planned) in expected {
                let current = db::get_object(conn, id).map_err(err_to_string)?.map(|item| item.updated_at);
                if current != *planned {
                    stale.insert(id.as_str());
                }
            }
            let touched = expected.keys()
                .chain(request.objects.iter().map(|item| &item.id))
                .chain(request.tombstones.iter().map(|item| &item.object_id))
                .chain(request.relations.iter().map(|item| &item.from_id))
                .chain(request.relation_tombstones.iter().map(|item| &item.from_id));
            for id in touched {
                if !stale.contains(id.as_str()) && moved_since_export(id)? {
                    stale.insert(id.as_str());
                }
            }
        }
        // SYNC-NO-LOSS (Hive #14, F8): ids whose row Core took from this
        // request. Their `parent_id` is the caller's chosen placement (a merge,
        // a conflict copy), so it is written through the `in` relation, and
        // the peer's own `in` relations for them are superseded.
        let mut placed = std::collections::HashSet::new();
        let acknowledged_operations = db::acknowledge_sync_outbox(&conn, &request.acknowledged_operations)
            .map_err(err_to_string)?;
        // MCP-CLEANUP (Hive #22): a peer's purge of a note inside an AI-cleanup
        // undo window waits until the window ends; earlier deferred ones apply now.
        // They obey `stale` like any tombstone, and a newer local change drops them.
        deleted_objects += mcp_cleanup::release_deferred(conn, &stale).map_err(err_to_string)?;
        let held = mcp_cleanup::held_ids(conn).map_err(err_to_string)?;
        for tombstone in request.tombstones.iter().filter(|item| !stale.contains(item.object_id.as_str())) {
            if mcp_cleanup::defer_if_held(conn, &held, tombstone).map_err(err_to_string)? {
                continue;
            }
            if db::apply_sync_tombstone(&conn, tombstone).map_err(err_to_string)? {
                deleted_objects += 1;
            }
        }
        let mut deleted_relations = 0;
        for tombstone in request.relation_tombstones.iter().filter(|item| !stale.contains(item.from_id.as_str())) {
            if db::apply_sync_relation_tombstone(&conn, tombstone).map_err(err_to_string)? {
                deleted_relations += 1;
            }
        }
        for object in &request.objects {
            if stale.contains(object.id.as_str()) {
                continue;
            }
            if db::get_sync_tombstone(&conn, &object.id).map_err(err_to_string)?.is_some_and(|item| item.deleted_at >= object.updated_at) {
                continue;
            }
            let before = db::get_object(&conn, &object.id).map_err(err_to_string)?;
            let merged = db::upsert_synced_object(&conn, object).map_err(err_to_string)?;
            if before.as_ref().map(|item| item.updated_at != merged.updated_at).unwrap_or(true) {
                applied_objects += 1;
            }
            // Only a row Core really took, and only from a caller that sent
            // `expected` (it chose the placement): a re-sent identical row or a
            // plain newest-wins push must not undo a local move.
            let took = before.as_ref().map(|item| item.updated_at < object.updated_at).unwrap_or(true);
            if took && merged.updated_at == object.updated_at && request.expected.as_ref().is_some_and(|expected| expected.contains_key(&object.id)) {
                placed.insert(object.id.as_str());
            }
        }
        // After every row is in, so a parent later in the list exists.
        for object in request.objects.iter().filter(|object| placed.contains(object.id.as_str())) {
            db::place_synced_object(&conn, &object.id, object.parent_id.as_deref()).map_err(err_to_string)?;
        }
        let mut added_relations = 0;
        for relation in &request.relations {
            if relation.kind == "in" && placed.contains(relation.from_id.as_str()) || stale.contains(relation.from_id.as_str()) {
                continue;
            }
            if db::get_object(&conn, &relation.from_id).map_err(err_to_string)?.is_none()
                || db::get_object(&conn, &relation.to_id).map_err(err_to_string)?.is_none()
            {
                continue;
            }
            if db::upsert_synced_relation(&conn, relation).map_err(err_to_string)? {
                added_relations += 1;
            }
        }
        // Hive #7: accept metadata only alongside a non-stale copy row.
        let included: std::collections::HashSet<&str> = request.objects.iter()
            .filter(|o| !stale.contains(o.id.as_str())).map(|o| o.id.as_str()).collect();
        let mut seen = std::collections::HashSet::new();
        for value in request.conflicts.iter().take(request.objects.len()) {
            let Some(id) = value.get("copyId").and_then(|v|v.as_str()) else { continue; };
            let original = value.get("originalId").and_then(|v|v.as_str()).unwrap_or("");
            if included.contains(id) && !stale.contains(original) && seen.insert(id) {
                sync_conflicts::register(conn,value).map_err(err_to_string)?;
            }
        }
        db::enforce_history_budget(&conn, db::HISTORY_BUDGET).map_err(err_to_string)?;
        let stale_objects = stale.into_iter().map(String::from).collect();
        Ok(SyncApplyResult { applied_objects, added_relations, deleted_relations, deleted_objects, acknowledged_operations, cursor: request.cursor, stale_objects })
    }
}

fn parse_delimited_row(line: &str, delimiter: char) -> Vec<String> {
    let mut values = Vec::new();
    let mut value = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '"' {
            if quoted && chars.peek() == Some(&'"') {
                value.push('"');
                chars.next();
            } else {
                quoted = !quoted;
            }
        } else if ch == delimiter && !quoted {
            values.push(value.trim().to_string());
            value.clear();
        } else {
            value.push(ch);
        }
    }
    values.push(value.trim().to_string());
    values
}

/// Parse a delimited document while preserving newlines inside quoted cells.
/// The previous line-based parser made common exports with multiline notes
/// split into multiple records.
fn parse_delimited_rows(raw: &str, delimiter: char) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut values = Vec::new();
    let mut value = String::new();
    let mut quoted = false;
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '"' {
            if quoted && chars.peek() == Some(&'"') {
                value.push('"');
                chars.next();
            } else {
                quoted = !quoted;
            }
        } else if ch == delimiter && !quoted {
            values.push(value.trim().to_string());
            value.clear();
        } else if (ch == '\n' || ch == '\r') && !quoted {
            if ch == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            values.push(value.trim().to_string());
            value.clear();
            if values.iter().any(|item| !item.is_empty()) {
                rows.push(std::mem::take(&mut values));
            } else {
                values.clear();
            }
        } else {
            value.push(ch);
        }
    }
    if !value.is_empty() || !values.is_empty() {
        values.push(value.trim().to_string());
        if values.iter().any(|item| !item.is_empty()) {
            rows.push(values);
        }
    }
    rows
}

#[derive(Debug, Clone, serde::Serialize)]
struct TabularPreview {
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
    total_rows: usize,
    truncated: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct ImportColumnMapping {
    source_index: usize,
    /// Reserved targets: __skip, __title. Everything else is a property key.
    target: String,
}

fn read_tabular_file(
    path: &std::path::Path,
) -> Result<(Vec<String>, Vec<Vec<String>>, bool), String> {
    use calamine::Reader;
    let meta = std::fs::metadata(path).map_err(err_to_string)?;
    if meta.len() > 50 * 1024 * 1024 {
        return Err("file too large (max 50 MB)".into());
    }
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let (headers, rows, truncated) = if matches!(ext.as_str(), "csv" | "tsv") {
        let raw = std::fs::read_to_string(path).map_err(err_to_string)?;
        let delimiter = if ext == "tsv" { '\t' } else { ',' };
        let mut parsed = parse_delimited_rows(&raw, delimiter).into_iter();
        let mut headers = parsed.next().ok_or("file has no header")?;
        if let Some(first) = headers.first_mut() {
            *first = first.trim_start_matches('\u{feff}').to_string();
        }
        let all_rows: Vec<Vec<String>> = parsed.collect();
        let truncated = all_rows.len() > 10_000;
        (headers, all_rows.into_iter().take(10_000).collect(), truncated)
    } else if matches!(ext.as_str(), "xlsx" | "xls" | "xlsb" | "ods") {
        let mut workbook = calamine::open_workbook_auto(path).map_err(err_to_string)?;
        let sheet_name = workbook
            .sheet_names()
            .first()
            .cloned()
            .ok_or("workbook has no sheets")?;
        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(err_to_string)?;
        let data: Vec<Vec<String>> = range
            .rows()
            .map(|row| row.iter().map(|cell| cell.to_string()).collect::<Vec<_>>())
            .collect();
        let mut data = data.into_iter();
        let headers = data.next().ok_or("worksheet has no header")?;
        let all_rows: Vec<Vec<String>> = data.collect();
        let truncated = all_rows.len() > 10_000;
        (headers, all_rows.into_iter().take(10_000).collect(), truncated)
    } else {
        return Err("supported formats: CSV, TSV, XLSX, XLS, XLSB and ODS".into());
    };
    if headers.is_empty() || headers.len() > 200 {
        return Err("invalid column count".into());
    }
    Ok((headers, rows, truncated))
}

fn run_import_transaction<T, F>(conn: &Connection, operation: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String>,
{
    conn.execute_batch("BEGIN IMMEDIATE").map_err(err_to_string)?;
    match operation(conn) {
        Ok(value) => {
            conn.execute_batch("COMMIT").map_err(err_to_string)?;
            Ok(value)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

#[tauri::command]
fn preview_tabular(path: String) -> Result<TabularPreview, String> {
    let (headers, rows, truncated) = read_tabular_file(std::path::Path::new(&path))?;
    Ok(TabularPreview {
        headers,
        total_rows: rows.len(),
        rows: rows.into_iter().take(20).collect(),
        truncated,
    })
}

fn import_mapped_rows(
    conn: &rusqlite::Connection,
    rows: Vec<Vec<String>>,
    parent_id: Option<&str>,
    object_type: &str,
    mapping: &[ImportColumnMapping],
) -> Result<Vec<Object>, String> {
    let mut imported = Vec::new();
    for (row_index, values) in rows.into_iter().enumerate() {
        let title = mapping
            .iter()
            .find(|entry| entry.target == "__title")
            .and_then(|entry| values.get(entry.source_index))
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("Imported item {}", row_index + 1));
        let mut props = serde_json::Map::new();
        props.insert("importRow".into(), serde_json::json!(row_index + 2));
        if matches!(object_type, "task" | "issue") {
            props.insert("status".into(), serde_json::Value::String("triage".into()));
        }
        for entry in mapping {
            if entry.target == "__skip" || entry.target == "__title" {
                continue;
            }
            if let Some(value) = values
                .get(entry.source_index)
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
            {
                props.insert(
                    entry.target.clone(),
                    serde_json::Value::String(value.to_owned()),
                );
            }
        }
        imported.push(
            db::create_object(
                conn,
                object_type,
                &title,
                None,
                Some(&serde_json::Value::Object(props).to_string()),
                parent_id,
            )
            .map_err(err_to_string)?,
        );
    }
    Ok(imported)
}

#[tauri::command]
fn import_mapped_tabular(
    state: tauri::State<AppState>,
    path: String,
    parent_id: Option<String>,
    object_type: String,
    mapping: Vec<ImportColumnMapping>,
) -> Result<Vec<Object>, String> {
    let (_headers, rows, _truncated) = read_tabular_file(std::path::Path::new(&path))?;
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(parent_id) = &parent_id {
        require_object_exists(&conn, parent_id)?;
    }
    run_import_transaction(&conn, |conn| {
        import_mapped_rows(conn, rows, parent_id.as_deref(), &object_type, &mapping)
    })
}

#[cfg(test)]
mod official_source_tests {
    // TRUST-OFFICIAL-SOURCE (Hive #8): the repro. Before the fix, steps 1-2
    // below were enough: any caller could name an official URL.
    use super::{plugins::ExtractedPlugin, OfficialRecord};

    fn extracted(id: &str, path: &str) -> ExtractedPlugin {
        ExtractedPlugin { plugin_id: id.into(), version: "1.0.0".into(), install_path: path.into(), manifest: "{}".into() }
    }

    #[test]
    fn only_bytes_fetched_from_an_official_release_count() {
        let mut record = OfficialRecord::default();
        let official_url = "https://github.com/prejas3/notible-graph/releases/download/v1/p.zip";

        // Attack: a plugin installs its own bytes and claims an official source.
        record.note_extract(Some(b"evil zip"), &extracted("evil.x", "P/evil"));
        assert!(!record.is_official("evil.x", "1.0.0", "P/evil"));

        // Attack: fetched from a non-official owner (or a look-alike host).
        record.note_fetch("https://github.com/someone/x/releases/download/v1/p.zip", b"other zip");
        record.note_fetch("https://github.com.evil.io/prejas3/x/p.zip", b"other zip");
        record.note_extract(Some(b"other zip"), &extracted("other.x", "P/other"));
        assert!(!record.is_official("other.x", "1.0.0", "P/other"));

        // Legit market install: same bytes Rust fetched from an official URL.
        record.note_fetch(official_url, b"graph zip");
        record.note_extract(Some(b"graph zip"), &extracted("notible.graph", "P/graph"));
        assert!(record.is_official("notible.graph", "1.0.0", "P/graph"));

        // A registry row pointing the official id at a different folder does not inherit it.
        assert!(!record.is_official("notible.graph", "1.0.0", "P/evil"));
        assert!(!record.is_official("evil.x", "1.0.0", "P/graph"));

        // Reinstalling something else at that path (after an uninstall) clears the mark.
        record.note_extract(Some(b"evil zip"), &extracted("notible.graph", "P/graph"));
        assert!(!record.is_official("notible.graph", "1.0.0", "P/graph"));
        record.note_extract(Some(b"graph zip"), &extracted("notible.graph", "P/graph"));
        record.note_extract(None, &extracted("notible.graph", "P/graph"));
        assert!(!record.is_official("notible.graph", "1.0.0", "P/graph"));
    }

    /// Hive #21: only a release asset of an official owner counts, not
    /// anything else served under that owner's path.
    #[test]
    fn only_release_assets_are_official() {
        use super::is_official_release_url as official;
        assert!(official("https://github.com/prejas3/notible-graph/releases/download/v0.11.4/notible-graph.zip"));
        assert!(official("https://github.com/Prejas3/notible-graph/releases/download/v1/p.zip"), "owner case");
        for not in [
            "https://github.com/prejas3/notible-graph/raw/0123abc/p.zip",
            "https://github.com/prejas3/notible-graph/blob/main/p.zip",
            "https://github.com/prejas3/notible-graph/commit/0123abc.patch",
            "https://github.com/prejas3/notible-graph/archive/refs/heads/main.zip",
            "https://github.com/prejas3/notible-graph/releases/download/v1",
            "https://github.com/prejas3/notible-graph/releases/download/v1/",
            "https://github.com/prejas3/notible-graph/releases/download/v1/p.zip/extra",
            "https://github.com/prejas3//releases/download/v1/p.zip",
            "https://github.com/prejas3/notible-graph/releases/download/v1/../../raw/abc/p.zip",
            "http://github.com/prejas3/notible-graph/releases/download/v1/p.zip",
            "https://raw.githubusercontent.com/prejas3/notible-graph/main/p.zip",
            "https://github.com/someone/notible-graph/releases/download/v1/p.zip",
        ] {
            assert!(!official(not), "{not}");
        }
    }

    /// Hive #21: hops out of an official download. The genuine one (to the
    /// asset CDN) is followed; leaving the owner or repo, or the release path,
    /// fails the fetch.
    #[test]
    fn official_redirects_stay_on_the_release() {
        use super::{official_redirect_ok, official_release};
        let url = |s: &str| reqwest::Url::parse(s).unwrap();
        let start = official_release(&url("https://github.com/prejas3/notible-graph/releases/download/v1/p.zip")).unwrap();
        assert!(official_redirect_ok(&start, &url("https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sig=x")));
        assert!(official_redirect_ok(&start, &url("https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/2")));
        assert!(official_redirect_ok(&start, &url("https://github.com/prejas3/notible-graph/releases/download/v1.0/p.zip")), "a renamed tag in the same repo");
        for bad in [
            "https://github.com/someone/notible-graph/releases/download/v1/p.zip",
            "https://github.com/prejas3/other-repo/releases/download/v1/p.zip",
            "https://github.com/prejas3/notible-graph/raw/0123abc/p.zip",
            "https://raw.githubusercontent.com/prejas3/notible-graph/main/p.zip",
            "https://codeload.github.com/prejas3/notible-graph/zip/refs/heads/main",
            "http://release-assets.githubusercontent.com/x",
        ] {
            assert!(!official_redirect_ok(&start, &url(bad)), "{bad}");
        }
    }

    /// Hive #23: the market asks for `releases/latest/download/<id>.zip`.
    /// That is official, its genuine redirects (to the pinned tag, then the
    /// CDN) are followed, and a hop to another owner or repo is not; a market
    /// install from it still skips the dialog.
    #[test]
    fn market_latest_urls_are_official() {
        use super::{is_official_release_url, official_redirect_ok, official_release};
        let url = |s: &str| reqwest::Url::parse(s).unwrap();
        let latest = "https://github.com/prejas3/notible-graph/releases/latest/download/notible.graph.zip";
        assert!(is_official_release_url(latest));
        for not in [
            "https://github.com/someone/notible-graph/releases/latest/download/notible.graph.zip",
            "https://github.com/prejas3/notible-graph/releases/latest/download/",
            "https://github.com/prejas3/notible-graph/releases/latest/notible.graph.zip",
            "https://github.com/prejas3/notible-graph/releases/latest/download/a/b.zip",
            "https://github.com/prejas3/notible-graph/raw/latest/download/notible.graph.zip",
        ] {
            assert!(!is_official_release_url(not), "{not}");
        }
        let start = official_release(&url(latest)).unwrap();
        assert!(official_redirect_ok(&start, &url("https://github.com/prejas3/notible-graph/releases/download/v0.11.4/notible.graph.zip")));
        assert!(official_redirect_ok(&start, &url("https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sig=x")));
        assert!(!official_redirect_ok(&start, &url("https://github.com/someone/notible-graph/releases/download/v1/notible.graph.zip")), "owner changed");
        assert!(!official_redirect_ok(&start, &url("https://github.com/prejas3/other/releases/download/v1/notible.graph.zip")), "repo changed");

        let mut record = OfficialRecord::default();
        record.note_fetch(latest, b"graph zip");
        record.note_extract(Some(b"graph zip"), &extracted("notible.graph", "P/graph"));
        assert!(record.is_official("notible.graph", "1.0.0", "P/graph"), "skips the dialog");
    }
}

#[cfg(test)]
mod import_tests {
    use super::{
        db, import_finance_rows, import_mapped_rows, parse_delimited_row, parse_delimited_rows,
        ImportColumnMapping,
    };

    #[test]
    fn parses_quoted_csv_values() {
        assert_eq!(
            parse_delimited_row("Title,\"Design, review\",\"a \"\"quote\"\"\"", ','),
            vec!["Title", "Design, review", "a \"quote\""]
        );
    }

    #[test]
    fn parses_multiline_quoted_csv_values_as_one_record() {
        assert_eq!(
            parse_delimited_rows("Title,Notes\nTask,\"line one\nline two\"\n", ','),
            vec![
                vec!["Title", "Notes"],
                vec!["Task", "line one\nline two"]
            ]
        );
    }

    #[test]
    fn finance_rows_import_as_project_children() {
        let conn = db::open_in_memory().unwrap();
        let project = db::create_object(&conn, "project", "Budget", None, None, None).unwrap();
        let imported = import_finance_rows(
            &conn,
            vec![
                "title".into(),
                "amount".into(),
                "kind".into(),
                "vendor".into(),
            ],
            vec![vec![
                "Hosting".into(),
                "49.90".into(),
                "cost".into(),
                "Net House".into(),
            ]],
            &project.id,
        )
        .unwrap();
        assert_eq!(imported.len(), 1);
        let props: serde_json::Value = serde_json::from_str(&imported[0].props).unwrap();
        assert_eq!(props["amount"], 49.9);
        assert_eq!(props["vendor"], "Net House");
    }

    #[test]
    fn exported_time_rows_round_trip_as_time_entries() {
        let conn = db::open_in_memory().unwrap();
        let project = db::create_object(&conn, "project", "Budget", None, None, None).unwrap();
        let imported = import_finance_rows(
            &conn,
            vec![
                "record_type".into(),
                "title".into(),
                "amount".into(),
                "hours".into(),
                "billable_rate".into(),
                "cost_rate".into(),
                "billable".into(),
            ],
            vec![vec![
                "time_entry".into(),
                "Design review".into(),
                "".into(),
                "2.5".into(),
                "180".into(),
                "90".into(),
                "true".into(),
            ]],
            &project.id,
        )
        .unwrap();
        assert_eq!(imported[0].r#type, "time_entry");
        let props: serde_json::Value = serde_json::from_str(&imported[0].props).unwrap();
        assert_eq!(props["hours"], 2.5);
        assert_eq!(props["billableRate"], 180.0);
        assert_eq!(props["costRate"], 90.0);
        assert_eq!(props["billable"], true);
    }

    #[test]
    fn mapped_rows_use_selected_title_and_properties() {
        let conn = db::open_in_memory().unwrap();
        let project = db::create_object(&conn, "project", "Support", None, None, None).unwrap();
        let mapping = vec![
            ImportColumnMapping {
                source_index: 0,
                target: "__title".into(),
            },
            ImportColumnMapping {
                source_index: 1,
                target: "priority".into(),
            },
            ImportColumnMapping {
                source_index: 2,
                target: "__skip".into(),
            },
        ];
        let rows = vec![vec!["Login broken".into(), "high".into(), "ignored".into()]];
        let imported = import_mapped_rows(&conn, rows, Some(&project.id), "issue", &mapping).unwrap();
        assert_eq!(imported[0].title, "Login broken");
        let props: serde_json::Value = serde_json::from_str(&imported[0].props).unwrap();
        assert_eq!(props["priority"], "high");
        assert!(props.get("ignored").is_none());
    }
}

/// Import CSV/TSV exports from project-management tools into Triage.
#[tauri::command]
fn import_delimited(
    state: tauri::State<AppState>,
    path: String,
    parent_id: Option<String>,
) -> Result<Vec<Object>, String> {
    let p = std::path::Path::new(&path);
    let ext = p
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "csv" | "tsv") {
        return Err("only .csv and .tsv files can be imported".into());
    }
    let meta = std::fs::metadata(p).map_err(err_to_string)?;
    if meta.len() > 20 * 1024 * 1024 {
        return Err("file too large (max 20 MB)".into());
    }
    let raw = std::fs::read_to_string(p).map_err(err_to_string)?;
    let delimiter = if ext == "tsv" { '\t' } else { ',' };
    let mut parsed = parse_delimited_rows(&raw, delimiter).into_iter();
    let mut headers = parsed.next().ok_or("file has no header")?;
    if let Some(first) = headers.first_mut() {
        *first = first.trim_start_matches('\u{feff}').to_string();
    }
    if headers.is_empty() || headers.len() > 200 {
        return Err("invalid column count".into());
    }
    let normalized: Vec<String> = headers
        .iter()
        .map(|header| header.trim().to_ascii_lowercase())
        .collect();
    let title_index = normalized
        .iter()
        .position(|header| matches!(header.as_str(), "title" | "name" | "summary"))
        .unwrap_or(0);
    let type_index = normalized
        .iter()
        .position(|header| matches!(header.as_str(), "type" | "kind" | "item type"));
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(pid) = &parent_id {
        require_object_exists(&conn, pid)?;
    }
    let imported = run_import_transaction(&conn, |conn| {
        let mut imported = Vec::new();
        for (index, values) in parsed.take(10_000).enumerate() {
        let title = values
            .get(title_index)
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("Imported item");
        let object_type = type_index
            .and_then(|position| values.get(position))
            .map(|value| value.to_ascii_lowercase())
            .filter(|value| value == "issue" || value == "task")
            .unwrap_or_else(|| "task".into());
        let mut props = serde_json::Map::new();
        props.insert("status".into(), serde_json::Value::String("triage".into()));
        props.insert(
            "importRow".into(),
            serde_json::Value::Number(((index + 2) as u64).into()),
        );
        for (column, header) in headers.iter().enumerate() {
            if column == title_index || Some(column) == type_index {
                continue;
            }
            if let Some(value) = values.get(column).filter(|value| !value.is_empty()) {
                let key = header.trim().replace(' ', "_");
                props.insert(key, serde_json::Value::String(value.clone()));
            }
        }
        let object = db::create_object(
            conn,
            &object_type,
            title,
            None,
            Some(&serde_json::Value::Object(props).to_string()),
            parent_id.as_deref(),
        )
        .map_err(err_to_string)?;
            imported.push(object);
        }
        Ok(imported)
    })?;
    Ok(imported)
}

fn import_finance_rows(
    conn: &Connection,
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
    parent_id: &str,
) -> Result<Vec<Object>, String> {
    let normalized: Vec<String> = headers
        .iter()
        .map(|header| header.trim().to_ascii_lowercase().replace(' ', "_"))
        .collect();
    let amount_index = normalized.iter().position(|header| header == "amount");
    let record_type_index = normalized.iter().position(|header| header == "record_type");
    let title_index = normalized
        .iter()
        .position(|header| matches!(header.as_str(), "title" | "name" | "description"));
    let mut imported = Vec::new();
    for (index, values) in rows.into_iter().take(10_000).enumerate() {
        let object_type = record_type_index
            .and_then(|position| values.get(position))
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| value == "time_entry")
            .unwrap_or_else(|| "financial_entry".into());
        let fallback_title = if object_type == "time_entry" {
            "Time entry"
        } else {
            "Finance entry"
        };
        let title = title_index
            .and_then(|position| values.get(position))
            .filter(|value| !value.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| format!("{fallback_title} {}", index + 1));
        let mut props = serde_json::Map::new();
        for (column, header) in normalized.iter().enumerate() {
            if Some(column) == title_index || Some(column) == record_type_index {
                continue;
            }
            if let Some(value) = values.get(column).filter(|value| !value.trim().is_empty()) {
                let trimmed = value.trim();
                let (key, parsed) = match header.as_str() {
                    "amount" | "hours" => (
                        header.as_str(),
                        serde_json::json!(trimmed
                            .replace(',', ".")
                            .parse::<f64>()
                            .map_err(|_| format!("invalid {header} in row {}", index + 2))?),
                    ),
                    "billable_rate" => (
                        "billableRate",
                        serde_json::json!(trimmed
                            .replace(',', ".")
                            .parse::<f64>()
                            .map_err(|_| format!("invalid billable rate in row {}", index + 2))?),
                    ),
                    "cost_rate" => (
                        "costRate",
                        serde_json::json!(trimmed
                            .replace(',', ".")
                            .parse::<f64>()
                            .map_err(|_| format!("invalid cost rate in row {}", index + 2))?),
                    ),
                    "billable" => (
                        "billable",
                        serde_json::json!(matches!(
                            trimmed.to_ascii_lowercase().as_str(),
                            "true" | "yes" | "1"
                        )),
                    ),
                    _ => (
                        header.as_str(),
                        serde_json::Value::String(trimmed.to_string()),
                    ),
                };
                props.insert(key.into(), parsed);
            }
        }
        if object_type == "financial_entry" {
            if amount_index.is_none() || !props.contains_key("amount") {
                return Err(format!("invalid amount in row {}", index + 2));
            }
            if !props.contains_key("kind") {
                props.insert("kind".into(), serde_json::Value::String("cost".into()));
            }
            if !props.contains_key("status") {
                props.insert("status".into(), serde_json::Value::String("planned".into()));
            }
        } else if !props.contains_key("hours") {
            return Err(format!("invalid hours in row {}", index + 2));
        }
        let object = db::create_object(
            conn,
            &object_type,
            &title,
            None,
            Some(&serde_json::Value::Object(props).to_string()),
            Some(parent_id),
        )
        .map_err(err_to_string)?;
        imported.push(object);
    }
    Ok(imported)
}

#[tauri::command]
fn import_finance_file(
    state: tauri::State<AppState>,
    path: String,
    parent_id: String,
) -> Result<Vec<Object>, String> {
    use calamine::Reader;
    let p = std::path::Path::new(&path);
    let meta = std::fs::metadata(p).map_err(err_to_string)?;
    if meta.len() > 50 * 1024 * 1024 {
        return Err("file too large (max 50 MB)".into());
    }
    let ext = p
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let (headers, rows) = if matches!(ext.as_str(), "csv" | "tsv") {
        let raw = std::fs::read_to_string(p).map_err(err_to_string)?;
        let delimiter = if ext == "tsv" { '\t' } else { ',' };
        let mut parsed = parse_delimited_rows(&raw, delimiter).into_iter();
        let mut headers = parsed.next().ok_or("file has no header")?;
        if let Some(first) = headers.first_mut() {
            *first = first.trim_start_matches('\u{feff}').to_string();
        }
        let rows = parsed.take(10_000).collect();
        (headers, rows)
    } else if matches!(ext.as_str(), "xlsx" | "xls" | "xlsb" | "ods") {
        let mut workbook = calamine::open_workbook_auto(p).map_err(err_to_string)?;
        let sheet_name = workbook
            .sheet_names()
            .first()
            .cloned()
            .ok_or("workbook has no sheets")?;
        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(err_to_string)?;
        let mut data = range
            .rows()
            .map(|row| row.iter().map(|cell| cell.to_string()).collect::<Vec<_>>());
        let headers = data.next().ok_or("worksheet has no header")?;
        (headers, data.collect())
    } else {
        return Err("supported finance formats: CSV, TSV, XLSX, XLS, XLSB and ODS".into());
    };
    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    require_object_exists(&conn, &parent_id)?;
    run_import_transaction(&conn, |conn| import_finance_rows(conn, headers, rows, &parent_id))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A test instance shares the real install's identifier, so WebView2 would
    // reuse its profile (%LOCALAPPDATA%\com.notible.app\EBWebView). While the
    // real app runs with other browser args, WebView2 refuses that profile and
    // the main window is dropped with no error. The sandbox sets its own folder.
    #[cfg(windows)]
    if let Some(dir) = sandbox::test_data_dir() {
        if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
            std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir.join("webview"));
        }
    }
    #[cfg(windows)]
    apply_ui_language_to_webview();
    tauri::Builder::default()
        // Plugin entry modules are served from their own scheme rather than a
        // `data:` URL, which `script-src 'self'` rejects in any packaged
        // build. A dedicated scheme is narrower than widening `script-src` to
        // `asset:`: the asset protocol shares one scope list with `$APPDATA/
        // media/**`, so allowing it here would make every pasted image file a
        // loadable script origin too.
        .register_uri_scheme_protocol("plugin", |ctx, request| {
            // `plugin:` is served from its own origin (`http://plugin.localhost`
            // on Windows), so a dynamic `import()` of it is a cross-origin
            // module fetch and the webview enforces CORS on it. Without an
            // `Access-Control-Allow-Origin` header the import rejects with
            // "Failed to fetch dynamically imported module" and no other
            // diagnostic. Every response below must carry the header,
            // including the error ones, or the failure is unreadable.
            let respond = |status: u16, content_type: &str, body: Vec<u8>| {
                tauri::http::Response::builder()
                    .status(status)
                    .header("Content-Type", content_type)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Cache-Control", "no-store")
                    .body(body)
                    .expect("plugin scheme response")
            };

            if request.method() == tauri::http::Method::OPTIONS {
                return respond(204, "text/plain", Vec::new());
            }

            let path = percent_encoding::percent_decode_str(
                request.uri().path().trim_start_matches('/'),
            )
            .decode_utf8_lossy()
            .into_owned();

            // The registry is the list of directories that are actually
            // installed plugins. Reading it here is what keeps `script-src`
            // from covering every folder the user has ever granted.
            let app = ctx.app_handle();
            let install_paths = app
                .try_state::<AppState>()
                .and_then(|state| {
                    let conn = state.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                    db::list_plugin_registry(&conn).ok()
                })
                .map(|entries| entries.into_iter().map(|entry| entry.install_path).collect::<Vec<_>>())
                .unwrap_or_default();

            let resolved = match files::resolve_plugin_script(app, &path, &install_paths) {
                Ok(resolved) => resolved,
                Err(error) => {
                    // Surfaced in the body and the log rather than swallowed:
                    // a bare 403 here is indistinguishable from a CSP block or
                    // a missing scheme registration.
                    eprintln!("plugin scheme refused {path}: {error}");
                    return respond(403, "text/plain", format!("{error}\npath: {path}").into_bytes());
                }
            };
            match std::fs::read(&resolved) {
                Ok(bytes) => respond(200, "text/javascript", bytes),
                Err(error) => {
                    eprintln!("plugin scheme could not read {}: {error}", resolved.display());
                    respond(404, "text/plain", format!("{error}").into_bytes())
                }
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // No launch args of our own to pass on relaunch — the app opens the
        // same way whether the user started it or the OS did.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        // Restores window size/position (and maximized/fullscreen state) on
        // launch and persists it on close, so an updater-triggered restart
        // doesn't snap the window back to the static default in
        // tauri.conf.json. Test instances keep their own file so closing one
        // never moves the real app's window.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filename(if sandbox::is_test_instance() {
                    ".window-state.sandbox.json"
                } else {
                    ".window-state.json"
                })
                .build(),
        )
        .setup(|app| {
            let dir = app_data_dir(app.handle()).expect("no app data dir");
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("notible.db");
            let conn = db::open(db_path.to_str().expect("db path not utf8"))
                .expect("failed to open database");
            // STORE-API (Hive #5): a store that can't be opened must not stop
            // the app; plugins then get a store that forgets on restart.
            let mut store = plugin_store::open(dir.join("plugin-store.db").to_str().expect("store path not utf8"))
                .unwrap_or_else(|e| {
                    eprintln!("plugin store unavailable, using memory: {e}");
                    plugin_store::open_in_memory().expect("in-memory plugin store")
                });
            // Reconcile must run before the backup rotates the epoch.
            if let Err(e) = plugin_store::workspace_epoch(&conn).and_then(|epoch| plugin_store::reconcile(&store, &epoch)) {
                // SYNC-NO-LOSS (Hive #14, F7): a store that may be stale is not used.
                plugin_store::fail_closed(&mut store, &format!("epoch check failed: {e}"));
            }
            match db::list_plugin_registry(&conn) {
                Ok(rows) => {
                    let ids: Vec<String> = rows.into_iter().map(|row| row.plugin_id).collect();
                    if let Err(e) = plugin_store::sweep(&store, &ids) {
                        eprintln!("plugin store sweep failed: {e}");
                    }
                }
                Err(e) => eprintln!("plugin store sweep skipped: {e}"),
            }
            // Automatic startup backup; keep the user's configured newest
            // count (defaults to 10). Non-fatal on error.
            if db_path.exists() {
                let keep = read_backup_retention(app.handle());
                match db::backup_db(&conn, &dir.join("backups"), keep) {
                    Ok(_) => {
                        if let Err(e) = plugin_store::rotate_epoch(&conn, &store) {
                            eprintln!("plugin store epoch rotation failed: {e}");
                        }
                    }
                    Err(e) => eprintln!("startup backup failed: {e}"),
                }
            }
            app.manage(AppState {
                conn: Mutex::new(conn),
            });
            app.manage(StoreState {
                conn: Mutex::new(store),
            });
            app.manage(PendingUpdate(Mutex::new(None)));
            app.manage(OfficialInstalls::default());
            app.manage(mcp_cleanup::McpCleanupState::new());

            if let Some((width, height)) = sandbox::window_size() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unmaximize();
                    let _ = window.set_size(tauri::LogicalSize::new(width, height));
                }
            }

            // English placeholder: the native tray is built here, before any
            // webview has loaded, so before anything can know the user's
            // chosen language. `set_tray_texts` (called from JS once i18n is
            // ready, and again on every language change) retexts these in
            // place — see TrayHandles.
            let show = MenuItem::with_id(app, "show", "Show Notible", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::with_id("notible-tray")
                .menu(&menu)
                .tooltip("Notible")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => request_quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            let tray = tray.build(app)?;
            app.manage(TrayHandles { show, quit, tray });
            Ok(())
        })
        .on_window_event(|window, event| {
            // The main window hides to the tray; any secondary window closes normally.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            quit_app,
            set_ui_language,
            search_objects_text,
            create_object,
            get_object,
            update_object,
            set_object_type,
            archive_object,
            list_objects,
            search_objects,
            find_objects_by_title,
            create_relation,
            delete_relation,
            create_gantt_dependency,
            delete_gantt_dependency,
            list_relations,
            list_relations_bulk,
            query_objects,
            list_data_sources,
            upsert_data_source,
            delete_data_source,
            move_object,
            list_types,
            upsert_type,
            get_backlinks,
            set_tags,
            list_all_tags,
            list_integration_events,
            trash_object,
            restore_object,
            list_trash,
            delete_object,
            mcp_cleanup::mcp_cleanup_heartbeat,
            mcp_cleanup::mcp_cleanup_list,
            mcp_cleanup::mcp_cleanup_reject,
            mcp_cleanup::mcp_cleanup_apply,
            mcp_cleanup::mcp_cleanup_undo,
            mcp_cleanup::mcp_cleanup_audit,
            mcp_cleanup::mcp_cleanup_scopes,
            mcp_cleanup::mcp_cleanup_set_scope,
            mcp_cleanup::mcp_cleanup_held,
            mcp_cleanup::mcp_settings_get,
            mcp_cleanup::mcp_settings_set,
            list_root_objects,
            backup_database,
            restore_database,
            backups_directory,
            list_backups,
            delete_backup,
            get_backup_retention,
            set_backup_retention,
            is_autostart_enabled,
            set_autostart,
            list_history,
            restore_version,
            get_history_entry,
            delete_history_entry,
            clear_history,
            write_export,
            save_export_binary,
            save_export_binary_as,
            write_xlsx,
            import_markdown,
            import_delimited,
            preview_tabular,
            import_mapped_tabular,
            import_finance_file,
            save_media,
            sweep_orphan_media,
            update_check,
            update_install,
            media_directory,
            pick_media_image,
            plugin_media_import_url,
            plugin_media_read,
            sync_media_missing,
            sync_media_read,
            sync_media_write,
            sandbox::sandbox_shared_available,
            sandbox::sandbox_shared_list,
            sandbox::sandbox_shared_read,
            sandbox::sandbox_shared_write,
            sandbox::sandbox_shared_delete,
            media_sharing_status,
            set_media_sharing,
            calendar_sharing_status,
            set_calendar_sharing,
            list_locales,
            install_locale,
            read_theme_asset,
            remove_locale,
            set_tray_texts,
            files::pick_folder,
            files::pick_file,
            files::list_granted_folders,
            files::revoke_granted_folder,
            files::read_dir_tree,
            files::read_file_preview,
            notifications::show_notification,
            extract_plugin_zip,
            install_plugin_zip,
            market_fetch,
            hash_plugin_package,
            calendar_oauth::calendar_oauth_status,
            calendar_oauth::calendar_connect,
            calendar_oauth::calendar_disconnect,
            calendar_oauth::calendar_list_sources,
            calendar_oauth::calendar_sync_project,
            ai::ai_provider_status,
            ai::ai_set_api_key,
            ai::ai_clear_api_key,
            ai::ai_provider_login,
            ai::ai_provider_install,
            ai::ai_configure_mcp,
            ai::ai_run_turn,
            mcp_info,
            list_plugin_registry,
            upsert_plugin_registry,
            grant_plugin_trust,
            grant_theme_trust,
            query_content_index,
            project_document,
            scaffold_plugin,
            export_plugin_devkit,
            set_plugin_registry_state,
            remove_plugin_registry,
            plugin_store_generation,
            plugin_store_get_many,
            plugin_store_set_many,
            plugin_store_delete_many,
            plugin_store_keys,
            plugin_store_delete_prefix,
            // cloud_auth_get/set are deliberately NOT registered. They read and
            // write the cloud session token in the OS keyring, and every
            // registered command is reachable from any code in the webview —
            // including a plugin, which is imported into the same realm. The
            // only consumer was src/lib/cloudSync.ts, which ships in the
            // frozen legacy app and not in the Core build. Exposing a keyring
            // reader to untrusted code for a feature the product does not ship
            // is not a trade worth making; re-register them behind a
            // Rust-side authenticated request command if cloud sync returns.
            cloud_auth::cloud_auth_clear,
            cloud_oauth::cloud_google_login,
            plugin_oauth::plugin_google_login,
            plugin_oauth::plugin_google_access_token,
            plugin_oauth::plugin_google_revoke,
            sync_conflict_list,
            sync_conflict_pair,
            sync_conflict_resolve,
            sync_conflict_undo,
            sync_conflict_descriptors,
            sync_export,
            sync_mark_outbox_attempts,
            sync_apply
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod sync_media_tests {
    use super::*;

    const UUID: &str = "1f2e3d4c-5b6a-4978-8899-aabbccddeeff";
    const PNG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

    /// The whole point of the name check: nothing a peer sends may reach a
    /// path outside `app_data/media`. `db::is_media_filename` is the gate, so
    /// it is tested here against the shapes a hostile peer would actually try.
    #[test]
    fn refuses_every_name_that_is_not_exactly_a_media_file() {
        let uuid = UUID;
        for hostile in [
            format!("../{uuid}.png"),
            format!("../../{uuid}.png"),
            format!("..\\{uuid}.png"),
            format!("sub/{uuid}.png"),
            format!("C:{uuid}.png"),
            format!("C:\\Windows\\System32\\{uuid}.png"),
            format!("\\\\server\\share\\{uuid}.png"),
            format!("/etc/{uuid}.png"),
            format!("{uuid}.png.part"),
            format!("{uuid}.exe"),
            format!("{uuid}.png.exe"),
            format!("{}.png", uuid.to_uppercase()),
            format!("{uuid}"),
            format!(".{uuid}.png"),
            "".to_string(),
            ".png".to_string(),
            format!("{uuid}.pn"),
            // A name that only differs after the UUID length is still wrong.
            format!("{uuid}0.png"),
        ] {
            assert!(
                !db::is_media_filename(&hostile),
                "must be refused: {hostile}"
            );
        }
        assert!(db::is_media_filename(&format!("{uuid}.png")));
        assert!(db::is_media_filename(&format!("{uuid}.jpeg")));
        assert!(db::is_media_filename(&format!("{uuid}.webp")));
    }

    /// Extension and contents must agree, or a `.png` is whatever the peer
    /// felt like sending.
    #[test]
    fn magic_bytes_must_match_the_extension() {
        let uuid = UUID;
        assert!(media_bytes_match_extension(&format!("{uuid}.png"), &PNG));
        assert!(media_bytes_match_extension(
            &format!("{uuid}.jpg"),
            &[0xFF, 0xD8, 0xFF, 0x00]
        ));
        assert!(media_bytes_match_extension(
            &format!("{uuid}.gif"),
            b"GIF89a....."
        ));
        assert!(media_bytes_match_extension(
            &format!("{uuid}.webp"),
            b"RIFF\x00\x00\x00\x00WEBPVP8 "
        ));

        // A PE executable renamed to .png, an HTML polyglot, an empty file,
        // and the one extension we refuse outright.
        assert!(!media_bytes_match_extension(&format!("{uuid}.png"), b"MZ\x90\x00"));
        assert!(!media_bytes_match_extension(
            &format!("{uuid}.png"),
            b"<html><script>fetch('https://evil')</script>"
        ));
        assert!(!media_bytes_match_extension(&format!("{uuid}.png"), b""));
        assert!(!media_bytes_match_extension(
            &format!("{uuid}.svg"),
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"><script/></svg>"
        ));
        // Right magic, wrong extension.
        assert!(!media_bytes_match_extension(&format!("{uuid}.jpg"), &PNG));
        // `webp` needs more than the RIFF header to be a webp.
        assert!(!media_bytes_match_extension(
            &format!("{uuid}.webp"),
            b"RIFF\x00\x00\x00\x00AVI "
        ));
    }

    #[test]
    fn media_dir_size_counts_files_and_ignores_directories() {
        let root = std::env::temp_dir().join(format!("notible-media-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join(".tmp")).unwrap();
        std::fs::write(root.join("a.bin"), vec![0u8; 10]).unwrap();
        std::fs::write(root.join("b.bin"), vec![0u8; 5]).unwrap();
        std::fs::write(root.join(".tmp").join("c.bin"), vec![0u8; 100]).unwrap();
        assert_eq!(media_dir_size(&root), 15, "staging must not count");
        std::fs::remove_dir_all(&root).unwrap();
    }
}

#[cfg(test)]
mod sync_apply_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sync_conflict_apply_pairs_copies_but_metadata_alone_or_stale_does_not() {
        let conn=db::open_in_memory().unwrap();
        let original="30000000-0000-4000-8000-000000000001";
        let copy="30000000-0000-4000-8000-000000000002";
        let d=json!({"originalId":original,"copyId":copy,"fields":["content"]});
        apply(&conn,json!({"objects":[obj(original,10,None)],"conflicts":[d]}));
        assert!(sync_conflicts::descriptors(&conn).unwrap().is_empty());
        // Stale original prevents pairing, but its recovery copy is still kept.
        apply(&conn,json!({"objects":[obj(copy,10,None)],"expected":{original:5,copy:null},"conflicts":[d]}));
        assert!(db::get_object(&conn,copy).unwrap().is_some());
        assert!(sync_conflicts::descriptors(&conn).unwrap().is_empty());
        apply(&conn,json!({"objects":[obj(copy,10,None)],"expected":{copy:10},"conflicts":[d]}));
        assert_eq!(sync_conflicts::descriptors(&conn).unwrap().len(),1);
        db::trash_object(&conn,copy).unwrap();
        apply(&conn,json!({"conflicts":[d]}));
        assert!(db::get_object(&conn,copy).unwrap().unwrap().trashed_at.is_some());
        let malformed=json!({"copyId":copy,"originalId":original,"fields":{}});
        apply(&conn,json!({"objects":[obj(copy,10,None)],"conflicts":[malformed]}));
        assert_eq!(sync_conflicts::descriptors(&conn).unwrap().len(),1);
    }

    fn obj(id: &str, updated_at: i64, parent: Option<&str>) -> serde_json::Value {
        json!({ "id": id, "type": "note", "title": id, "content": "\"\"", "props": "{}",
                "created_at": 1, "updated_at": updated_at, "archived_at": null, "trashed_at": null, "parent_id": parent })
    }

    fn apply(conn: &rusqlite::Connection, body: serde_json::Value) -> SyncApplyResult {
        let mut request = json!({ "cursor": 0, "objects": [], "relations": [], "tombstones": [], "relation_tombstones": [] });
        for (key, value) in body.as_object().unwrap() {
            request[key] = value.clone();
        }
        apply_sync_request(conn, &serde_json::from_value(request).unwrap()).unwrap()
    }

    fn parent(conn: &rusqlite::Connection, id: &str) -> Option<String> {
        db::get_object(conn, id).unwrap().unwrap().parent_id
    }

    fn in_relations(conn: &rusqlite::Connection, id: &str) -> usize {
        conn.query_row("SELECT COUNT(*) FROM relations WHERE from_id = ?1 AND kind = 'in'", [id], |row| row.get(0)).unwrap()
    }

    /// SYNC-NO-LOSS (Hive #14, F2): a row saved after the plan was made is
    /// refused, listed, and left as the user saved it.
    #[test]
    fn stale_row_is_refused() {
        let conn = db::open_in_memory().unwrap();
        apply(&conn, json!({ "objects": [obj("o", 10, None)] }));
        let result = apply(&conn, json!({ "objects": [obj("o", 20, None)], "expected": { "o": 5 } }));
        assert_eq!(result.stale_objects, vec!["o".to_string()]);
        assert_eq!(db::get_object(&conn, "o").unwrap().unwrap().updated_at, 10);
        let result = apply(&conn, json!({ "objects": [obj("n", 20, None)], "expected": { "n": 3 } }));
        assert_eq!(result.stale_objects, vec!["n".to_string()], "planned as existing, but it is not here");
        let result = apply(&conn, json!({ "objects": [obj("o", 20, None)], "expected": { "o": 10 } }));
        assert!(result.stale_objects.is_empty());
        assert_eq!(db::get_object(&conn, "o").unwrap().unwrap().updated_at, 20);
    }

    /// SYNC-NO-LOSS (Hive #14, F8): a new conflict copy lands where the merge
    /// put it, even with its parent later in the list.
    #[test]
    fn conflict_copy_gets_its_parent() {
        let conn = db::open_in_memory().unwrap();
        apply(&conn, json!({ "objects": [obj("copy", 5, Some("p1")), obj("p1", 1, None)], "expected": { "copy": null, "p1": null } }));
        assert_eq!(parent(&conn, "copy").as_deref(), Some("p1"));
    }

    /// SYNC-NO-LOSS (Hive #14, F8): concurrent moves end with exactly the
    /// merged parent, whatever `in` relations the peer still has.
    #[test]
    fn merged_parent_wins_over_peer_relations() {
        let conn = db::open_in_memory().unwrap();
        apply(&conn, json!({ "objects": [obj("p1", 1, None), obj("p2", 1, None), obj("o", 10, Some("p1"))], "expected": { "p1": null, "p2": null, "o": null } }));
        assert_eq!(parent(&conn, "o").as_deref(), Some("p1"));
        let peer_in_p2 = json!([{ "from_id": "o", "to_id": "p2", "kind": "in", "created_at": 9_999_999_999_999i64 }]);
        apply(&conn, json!({ "objects": [obj("o", 11, Some("p1"))], "relations": peer_in_p2, "expected": { "o": 10 } }));
        assert_eq!((parent(&conn, "o").as_deref(), in_relations(&conn, "o")), (Some("p1"), 1));
        apply(&conn, json!({ "objects": [obj("o", 12, Some("p2"))], "expected": { "o": 11 } }));
        assert_eq!((parent(&conn, "o").as_deref(), in_relations(&conn, "o")), (Some("p2"), 1));
        apply(&conn, json!({ "objects": [obj("o", 13, None)], "expected": { "o": 12 } }));
        assert_eq!((parent(&conn, "o"), in_relations(&conn, "o")), (None, 0));
    }

    /// Without `expected` (an older plugin, a plain newest-wins push) Core
    /// keeps the old behaviour: placement comes only from relations.
    #[test]
    fn no_expected_keeps_relation_placement() {
        let conn = db::open_in_memory().unwrap();
        apply(&conn, json!({ "objects": [obj("p1", 1, None), obj("o", 10, None)],
            "relations": [{ "from_id": "o", "to_id": "p1", "kind": "in", "created_at": 5 }] }));
        apply(&conn, json!({ "objects": [obj("o", 11, None)] }));
        assert_eq!(parent(&conn, "o").as_deref(), Some("p1"));
    }

    /// p1, p2, p3 and o (stamp 10) in p1, all placed by sync.
    fn tree(conn: &rusqlite::Connection) {
        apply(conn, json!({ "objects": [obj("p1", 1, None), obj("p2", 1, None), obj("p3", 1, None), obj("o", 10, Some("p1"))],
            "expected": { "p1": null, "p2": null, "p3": null, "o": null } }));
        assert_eq!(parent(conn, "o").as_deref(), Some("p1"));
    }

    fn trashed(conn: &rusqlite::Connection, id: &str) -> bool {
        db::get_object(conn, id).unwrap().unwrap().trashed_at.is_some()
    }

    /// SYNC-NO-LOSS (Hive #18, N1): the user moves the note after the export.
    /// The move leaves `updated_at` at 10, so the plan's `expected: 10` still
    /// matches; the export cursor is what shows the plan is stale. Nothing of
    /// the note is applied (row, placement, its relations), and the retry,
    /// planned against a fresh export, goes through.
    #[test]
    fn move_after_export_is_kept() {
        let conn = db::open_in_memory().unwrap();
        tree(&conn);
        let cursor = db::sync_export_mark(&conn).unwrap();
        db::move_object(&conn, "o", Some("p2")).unwrap();
        let peer_edge = json!([{ "from_id": "o", "to_id": "p3", "kind": "in", "created_at": 5 }]);
        let result = apply(&conn, json!({ "cursor": cursor, "objects": [obj("o", 20, Some("p1"))], "relations": peer_edge, "expected": { "o": 10 } }));
        assert_eq!(result.stale_objects, vec!["o".to_string()]);
        assert_eq!((parent(&conn, "o").as_deref(), in_relations(&conn, "o")), (Some("p2"), 1), "the move survives, no peer edge");
        assert_eq!(db::get_object(&conn, "o").unwrap().unwrap().updated_at, 10);

        let cursor = db::sync_export_mark(&conn).unwrap();
        let result = apply(&conn, json!({ "cursor": cursor, "objects": [obj("o", 20, Some("p2"))], "expected": { "o": 10 } }));
        assert!(result.stale_objects.is_empty(), "a plan made after the move applies");
        assert_eq!(db::get_object(&conn, "o").unwrap().unwrap().updated_at, 20);
    }

    /// SYNC-NO-LOSS (Hive #18, N1): trashing after the export; the planned row
    /// (not trashed) must not pull the note back out of the trash.
    #[test]
    fn trash_after_export_is_kept() {
        let conn = db::open_in_memory().unwrap();
        tree(&conn);
        let cursor = db::sync_export_mark(&conn).unwrap();
        db::trash_object(&conn, "o").unwrap();
        let result = apply(&conn, json!({ "cursor": cursor, "objects": [obj("o", 20, Some("p1"))], "expected": { "o": 10 } }));
        assert_eq!(result.stale_objects, vec!["o".to_string()]);
        assert!(trashed(&conn, "o"));
    }

    /// SYNC-NO-LOSS (Hive #18, N1): restoring after the export. Neither the
    /// planned row (still trashed) nor a peer's tombstone for it may undo it.
    #[test]
    fn restore_after_export_is_kept() {
        let conn = db::open_in_memory().unwrap();
        tree(&conn);
        db::trash_object(&conn, "o").unwrap();
        let cursor = db::sync_export_mark(&conn).unwrap();
        db::restore_object(&conn, "o").unwrap();
        let mut planned = obj("o", 20, Some("p1"));
        planned["trashed_at"] = json!(15);
        let result = apply(&conn, json!({ "cursor": cursor, "objects": [planned, obj("p3", 2, None)],
            "tombstones": [{ "object_id": "o", "deleted_at": 30 }], "expected": { "o": 10, "p3": 1 } }));
        assert_eq!(result.stale_objects, vec!["o".to_string()]);
        assert!(!trashed(&conn, "o"));
        assert!(db::get_sync_tombstone(&conn, "o").unwrap().is_none(), "the tombstone waits for the retry");
        assert_eq!(db::get_object(&conn, "p3").unwrap().unwrap().updated_at, 2, "the rest of the plan still applies");
    }

    /// Hive #19: a peer apply carrying only a tombstone (no rows, so
    /// `expected: {}`) must not delete a note restored after the export.
    #[test]
    fn tombstone_only_apply_after_restore_is_refused() {
        let conn = db::open_in_memory().unwrap();
        tree(&conn);
        db::trash_object(&conn, "o").unwrap();
        let cursor = db::sync_export_mark(&conn).unwrap();
        db::restore_object(&conn, "o").unwrap();
        let result = apply(&conn, json!({ "cursor": cursor, "tombstones": [{ "object_id": "o", "deleted_at": 30 }], "expected": {} }));
        assert_eq!(result.stale_objects, vec!["o".to_string()]);
        assert!(db::get_object(&conn, "o").unwrap().is_some_and(|item| item.trashed_at.is_none()), "still here, restored");
        assert!(db::get_sync_tombstone(&conn, "o").unwrap().is_none());
    }

    /// Hive #19: a relation-only apply must not undo a move made after the export.
    #[test]
    fn relation_only_apply_after_move_is_refused() {
        let conn = db::open_in_memory().unwrap();
        tree(&conn);
        let cursor = db::sync_export_mark(&conn).unwrap();
        db::move_object(&conn, "o", Some("p2")).unwrap();
        let result = apply(&conn, json!({ "cursor": cursor, "expected": {},
            "relations": [{ "from_id": "o", "to_id": "p3", "kind": "in", "created_at": far_future() }],
            "relation_tombstones": [{ "from_id": "o", "to_id": "p2", "kind": "in", "deleted_at": far_future() }] }));
        assert_eq!(result.stale_objects, vec!["o".to_string()]);
        assert_eq!((parent(&conn, "o").as_deref(), in_relations(&conn, "o")), (Some("p2"), 1));
        let result = apply(&conn, json!({ "cursor": db::sync_export_mark(&conn).unwrap(), "expected": {},
            "relations": [{ "from_id": "o", "to_id": "p3", "kind": "in", "created_at": far_future() }] }));
        assert!(result.stale_objects.is_empty(), "planned after the move, it applies");
        assert_eq!(in_relations(&conn, "o"), 2);
    }

    /// Hive #19: without `expected` (older callers, Teams, which does not read
    /// `staleObjects`) the request is applied unchecked, as before.
    #[test]
    fn no_expected_is_unchecked() {
        let conn = db::open_in_memory().unwrap();
        tree(&conn);
        db::trash_object(&conn, "o").unwrap();
        let cursor = db::sync_export_mark(&conn).unwrap();
        db::restore_object(&conn, "o").unwrap();
        let result = apply(&conn, json!({ "cursor": cursor, "tombstones": [{ "object_id": "o", "deleted_at": 30 }] }));
        assert!(result.stale_objects.is_empty());
        assert!(db::get_object(&conn, "o").unwrap().is_none());
    }

    fn far_future() -> i64 {
        chrono::Utc::now().timestamp_millis() + 1_000_000_000
    }

    /// SYNC-NO-LOSS (Hive #18, N2): a peer whose clock is far ahead created
    /// o's edge to p1. A merge moves o to p2: the tombstone for p1 must be
    /// later than that edge, or replaying the peer's old snapshot (here after
    /// a restart, from the file) brings p1 back as a second parent.
    #[test]
    fn ahead_clock_edge_stays_deleted_after_replay_and_restart() {
        let path = std::env::temp_dir().join(format!("notible-n2-{}.db", uuid::Uuid::new_v4()));
        let path = path.to_str().unwrap().to_string();
        let ahead = far_future();
        let old_snapshot = json!({ "objects": [obj("p1", 1, None), obj("p2", 1, None), obj("o", 10, None)],
            "relations": [{ "from_id": "o", "to_id": "p1", "kind": "in", "created_at": ahead }] });
        {
            let conn = db::open(&path).unwrap();
            apply(&conn, old_snapshot.clone());
            assert_eq!(parent(&conn, "o").as_deref(), Some("p1"));
            let cursor = db::sync_export_mark(&conn).unwrap();
            apply(&conn, json!({ "cursor": cursor, "objects": [obj("o", 11, Some("p2"))], "expected": { "o": 10 } }));
            assert_eq!((parent(&conn, "o").as_deref(), in_relations(&conn, "o")), (Some("p2"), 1));
            apply(&conn, old_snapshot.clone());
            assert_eq!((parent(&conn, "o").as_deref(), in_relations(&conn, "o")), (Some("p2"), 1), "replayed at once");
        }
        {
            let conn = db::open(&path).unwrap();
            apply(&conn, old_snapshot);
            assert_eq!((parent(&conn, "o").as_deref(), in_relations(&conn, "o")), (Some("p2"), 1), "replayed after a restart");
        }
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{path}{suffix}"));
        }
    }

    /// SYNC-NO-LOSS (Hive #18, N2): going back to a parent whose edge an
    /// ahead-clock peer deleted. Both a local move and a merge placement must
    /// stamp the new edge after that tombstone, so the tombstone neither hides
    /// it from peers nor deletes it again on replay.
    #[test]
    fn back_to_a_parent_deleted_by_an_ahead_clock() {
        let conn = db::open_in_memory().unwrap();
        tree(&conn);
        let peer_tombstone = json!([{ "from_id": "o", "to_id": "p2", "kind": "in", "deleted_at": far_future() }]);
        apply(&conn, json!({ "relation_tombstones": peer_tombstone.clone() }));
        db::move_object(&conn, "o", Some("p2")).unwrap();
        apply(&conn, json!({ "relation_tombstones": peer_tombstone.clone() }));
        assert_eq!((parent(&conn, "o").as_deref(), in_relations(&conn, "o")), (Some("p2"), 1), "local move");
        let exported = db::list_sync_relation_tombstones(&conn).unwrap();
        assert!(!exported.iter().any(|t| t.from_id == "o" && t.to_id == "p2"), "no tombstone shadows the live edge");

        let p3_tombstone = json!([{ "from_id": "o", "to_id": "p3", "kind": "in", "deleted_at": far_future() }]);
        apply(&conn, json!({ "relation_tombstones": p3_tombstone.clone() }));
        let cursor = db::sync_export_mark(&conn).unwrap();
        apply(&conn, json!({ "cursor": cursor, "objects": [obj("o", 11, Some("p3"))], "expected": { "o": 10 } }));
        apply(&conn, json!({ "relation_tombstones": p3_tombstone }));
        assert_eq!((parent(&conn, "o").as_deref(), in_relations(&conn, "o")), (Some("p3"), 1), "merge placement");
    }
}
