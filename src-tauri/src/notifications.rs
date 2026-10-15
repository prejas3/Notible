//! Native OS notifications for plugins. The plugin API's `notifications`
//! permission and the "did this plugin declare it" check live in the host
//! (TypeScript); this command only wraps the OS call, the same split as
//! `pick_folder`/`pick_file` in files.rs.

use tauri_plugin_notification::NotificationExt;

#[tauri::command]
pub fn show_notification(app: tauri::AppHandle, title: String, body: Option<String>) -> Result<(), String> {
    let mut builder = app.notification().builder().title(title);
    if let Some(body) = body {
        builder = builder.body(body);
    }
    builder.show().map_err(|e| e.to_string())
}
