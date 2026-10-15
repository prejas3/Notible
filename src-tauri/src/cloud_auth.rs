use keyring::Entry;

const SERVICE: &str = "com.notible.cloud";
const ACCOUNT: &str = "session";

fn entry() -> Result<Entry, String> {
    Entry::new(&crate::sandbox::keyring_service(SERVICE), ACCOUNT).map_err(|e| format!("secure cloud session store unavailable: {e}"))
}

// Not registered in the invoke handler — see the note beside
// cloud_auth_clear in lib.rs. Kept compiling so the frozen legacy app
// and a future Rust-side cloud request path can still use them.
#[allow(dead_code)]
#[tauri::command]
pub fn cloud_auth_get() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("secure cloud session read failed: {error}")),
    }
}

// Not registered in the invoke handler — see the note beside
// cloud_auth_clear in lib.rs. Kept compiling so the frozen legacy app
// and a future Rust-side cloud request path can still use them.
#[allow(dead_code)]
#[tauri::command]
pub fn cloud_auth_set(token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("cloud session token cannot be empty".into());
    }
    entry()?.set_password(&token).map_err(|e| format!("secure cloud session write failed: {e}"))
}

#[tauri::command]
pub fn cloud_auth_clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("secure cloud session removal failed: {error}")),
    }
}
