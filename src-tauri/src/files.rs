//! Read-only access to user-linked project folders: folder picking,
//! directory trees and file previews.
//!
//! Containment is decided here, in Rust, against the folders the user chose
//! in a native picker — never against a root supplied by the caller. Any code
//! in the webview can call these commands directly (plugin code is imported
//! into the app's own realm), so the caller is not trusted to describe its
//! own boundary.

use base64::Engine;
use serde::Serialize;
use std::path::{Path, PathBuf};

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    ".next",
    "__pycache__",
    ".venv",
];
/// Hard cap on total entries returned by a tree read.
const MAX_TREE_ENTRIES: usize = 2000;
const DEFAULT_MAX_DEPTH: u32 = 8;
const DEFAULT_PREVIEW_BYTES: u64 = 256 * 1024; // 256 KB of text
const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024; // 8 MB

#[derive(Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

#[derive(Serialize)]
pub struct DirTree {
    pub root: String,
    pub children: Vec<FileNode>,
    /// True when the entry budget or depth limit cut the listing short.
    pub truncated: bool,
}

#[derive(Serialize)]
pub struct FilePreview {
    /// "text" | "image" | "binary"
    pub kind: String,
    /// Text content, or base64 data for images; empty for binary.
    pub content: String,
    pub truncated: bool,
    pub size: u64,
    /// Lowercased file extension, e.g. "rs", "png".
    pub ext: String,
}

fn canon(path: &str) -> Result<PathBuf, String> {
    std::fs::canonicalize(path).map_err(|e| format!("cannot access {path}: {e}"))
}

/// File where the roots the user has actually granted are recorded, one
/// canonical path per line.
fn granted_roots_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::app_data_dir(app)?.join("linked-folders.txt"))
}

fn granted_roots(app: &tauri::AppHandle) -> Vec<PathBuf> {
    granted_roots_path(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|body| {
            body.lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                // Re-canonicalize rather than trusting the stored text. The
                // file is not webview-writable today, but treating its
                // contents as already-validated would turn any future
                // arbitrary-write bug under app_data into full-disk read: a
                // single line `\\?\C:\` would otherwise grant the volume.
                .filter_map(|line| std::fs::canonicalize(line).ok())
                .filter(|path| path.is_absolute())
                .collect()
        })
        .unwrap_or_default()
}

/// Record a root the user chose in the native picker. This is the ONLY way a
/// path enters the grant list: it always costs a real folder-picker gesture,
/// so code running in the webview cannot grant itself anything.
fn grant_root(app: &tauri::AppHandle, root: &Path) -> Result<(), String> {
    let mut roots = granted_roots(app);
    if roots.iter().any(|existing| existing == root) {
        return Ok(());
    }
    roots.push(root.to_path_buf());
    let path = granted_roots_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = roots
        .iter()
        .map(|entry| entry.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(path, body).map_err(|e| e.to_string())
}

/// Directory holding extracted plugin packages. Always readable: it is
/// application-owned data, not the user's disk, and the plugin loader reads
/// `plugin.json` and the entry file through the same preview command.
fn plugin_install_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    crate::app_data_dir(app)
        .ok()
        .map(|dir| dir.join("plugins"))
        .and_then(|dir| std::fs::canonicalize(dir).ok())
}

/// Resolve `path` against the roots the user granted, instead of against a
/// root supplied by the caller.
///
/// The previous `ensure_under_root(root, path)` took BOTH sides from the
/// caller, so the containment check compared an attacker-chosen path against
/// an attacker-chosen root and passed unconditionally. Any code running in
/// the webview — including a plugin, which is imported into this same realm
/// and can call `invoke` directly — could read any file on the machine.
fn resolve_granted(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let target = canon(path)?;
    let mut allowed = granted_roots(app);
    if let Some(plugins) = plugin_install_dir(app) {
        allowed.push(plugins);
    }
    if allowed.iter().any(|root| target.starts_with(root)) {
        Ok(target)
    } else {
        Err("path is outside every folder you have linked".into())
    }
}

fn build_tree(dir: &Path, depth: u32, budget: &mut usize, truncated: &mut bool) -> Vec<FileNode> {
    let mut entries: Vec<(String, PathBuf, bool)> = match std::fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                let file_type = e.file_type().ok()?;
                // Only the root is checked against the grant list, so a
                // reparse point inside a linked folder would otherwise walk
                // straight out of it — `mklink /J proj\x C:\Users\me\.ssh`
                // needs no admin rights and would list its whole contents.
                // Skip every link instead of following it.
                if file_type.is_symlink() {
                    return None;
                }
                Some((name, e.path(), file_type.is_dir()))
            })
            .collect(),
        Err(_) => return Vec::new(),
    };
    // Directories first, then files, both alphabetically (case-insensitive).
    entries.sort_by(|a, b| {
        b.2.cmp(&a.2)
            .then(a.0.to_lowercase().cmp(&b.0.to_lowercase()))
    });

    let mut nodes = Vec::new();
    for (name, path, is_dir) in entries {
        if *budget == 0 {
            *truncated = true;
            break;
        }
        *budget -= 1;
        let children = if is_dir {
            if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                Some(Vec::new()) // listed but not descended into
            } else if depth == 0 {
                *truncated = true;
                Some(Vec::new())
            } else {
                Some(build_tree(&path, depth - 1, budget, truncated))
            }
        } else {
            None
        };
        nodes.push(FileNode {
            name,
            path: path.to_string_lossy().into_owned(),
            is_dir,
            children,
        });
    }
    nodes
}

/// Every path the user has granted, for display in Settings.
///
/// Grants were permanent and invisible: the only record was a text file next to
/// the database, so a folder linked once stayed readable by every plugin
/// forever with nothing in the UI admitting it. Showing them is half the fix;
/// `revoke_granted_folder` is the other half.
#[tauri::command]
pub fn list_granted_folders(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    Ok(granted_roots(&app)
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

/// Drop one granted path. Anything under it stops resolving immediately.
///
/// The argument is compared against the canonicalized stored list, not used as
/// a path itself, so this cannot be turned into a write primitive: the worst a
/// caller can do is remove a grant, which only ever reduces access.
#[tauri::command]
pub fn revoke_granted_folder(app: tauri::AppHandle, path: String) -> Result<Vec<String>, String> {
    let remaining: Vec<PathBuf> = granted_roots(&app)
        .into_iter()
        .filter(|root| root.to_string_lossy() != path)
        .collect();
    let file = granted_roots_path(&app)?;
    let body = remaining
        .iter()
        .map(|entry| entry.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(file, body).map_err(|e| e.to_string())?;
    Ok(remaining.iter().map(|entry| entry.to_string_lossy().into_owned()).collect())
}

/// Open the native folder picker; returns the chosen path or None if cancelled.
#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = crate::sandbox::picked_path()
        .unwrap_or_else(|| app.dialog().file().blocking_pick_folder().map(|f| f.to_string()));
    let Some(chosen) = folder else { return Ok(None) };
    // Picking is the grant. Everything readable later traces back to this
    // gesture; see resolve_granted.
    let root = canon(&chosen)?;
    grant_root(&app, &root)?;
    Ok(Some(chosen))
}

/// Open the native file picker for a local plugin package.
#[tauri::command]
pub async fn pick_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file = crate::sandbox::picked_path().unwrap_or_else(|| {
        app.dialog()
            .file()
            .add_filter("Notible plugin package", &["zip"])
            .add_filter("Signed update manifest", &["json"])
            .blocking_pick_file()
            .map(|f| f.to_string())
    });
    let Some(chosen) = file else { return Ok(None) };
    // Same rule as pick_folder: choosing the file is the grant, and it
    // covers only that one file, not its directory.
    let path = canon(&chosen)?;
    grant_root(&app, &path)?;
    Ok(Some(chosen))
}

/// Resolve a single file the user granted, for reading.
///
/// `pick_file` grants exactly the file the user chose, so an import can name
/// that path and nothing else. Commands that took a caller-supplied path with
/// no check were a read primitive over the whole disk for any code in the
/// webview — which, under this app's trust model, is every installed plugin.
pub fn resolve_granted_file(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let resolved = resolve_granted(app, path)?;
    if !resolved.is_file() {
        return Err(format!("{} is not a file", resolved.display()));
    }
    Ok(resolved)
}

/// Resolve a path for the `plugin:` script protocol.
///
/// Same containment as every other plugin file read — the plugin install dir
/// plus the roots the user granted — with a JavaScript extension required on
/// top, so the scheme cannot be turned into a general file server for the
/// granted roots. This exists because `script-src 'self'` refuses the
/// `data:` URL the loader used to import plugin entries from, which made
/// third-party plugins fail to load in every packaged build.
/// Resolve a directory the user granted, for writing into. Same containment
/// as every read; the picker gesture remains the only way a path gets here.
pub fn resolve_granted_dir(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let resolved = resolve_granted(app, path)?;
    if !resolved.is_dir() {
        return Err(format!("{} is not a directory", resolved.display()));
    }
    Ok(resolved)
}

pub fn resolve_plugin_script(
    app: &tauri::AppHandle,
    path: &str,
    install_paths: &[String],
) -> Result<PathBuf, String> {
    let resolved = resolve_granted(app, path)?;
    let extension = resolved
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !matches!(extension, "js" | "mjs") {
        return Err("plugin scripts must be .js or .mjs".into());
    }

    // Containment is not enough on its own here, because `script-src` names
    // this scheme: anything it will serve, the CSP will execute. Resolving
    // against the whole grant list meant every `.js` under any folder the
    // user ever picked — node_modules, cloned repos, files written by other
    // programs — was a script origin.
    //
    // So a script must additionally live under the plugin install directory
    // or under a directory the registry records as an installed plugin's
    // root. Those are exactly the places our own loader builds URLs for.
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(dir) = plugin_install_dir(app) {
        roots.push(dir);
    }
    for install_path in install_paths {
        if let Ok(root) = std::fs::canonicalize(install_path) {
            roots.push(root);
        }
    }
    if !roots.iter().any(|root| resolved.starts_with(root)) {
        return Err("plugin scripts must live inside an installed plugin".into());
    }
    Ok(resolved)
}

/// Recursively list a linked folder. Skips node_modules/.git/target/dot-dirs
/// and caps the payload at MAX_TREE_ENTRIES entries.
#[tauri::command]
pub fn read_dir_tree(
    app: tauri::AppHandle,
    path: String,
    max_depth: Option<u32>,
) -> Result<DirTree, String> {
    let root = resolve_granted(&app, &path)?;
    if !root.is_dir() {
        return Err("not a directory".into());
    }
    let depth = max_depth.unwrap_or(DEFAULT_MAX_DEPTH).min(16);
    let mut budget = MAX_TREE_ENTRIES;
    let mut truncated = false;
    let children = build_tree(&root, depth, &mut budget, &mut truncated);
    Ok(DirTree {
        root: root.to_string_lossy().into_owned(),
        children,
        truncated,
    })
}

/// Read a preview of a file under a linked root. Text files return up to
/// `max_bytes` of UTF-8; images return base64; everything else is "binary".
#[tauri::command]
pub fn read_file_preview(
    app: tauri::AppHandle,
    path: String,
    max_bytes: Option<u64>,
) -> Result<FilePreview, String> {
    let file = resolve_granted(&app, &path)?;
    let meta = std::fs::metadata(&file).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    let size = meta.len();
    let ext = file
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    let is_image = matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico"
    );
    if is_image {
        if size > MAX_IMAGE_BYTES {
            return Ok(FilePreview {
                kind: "binary".into(),
                content: String::new(),
                truncated: false,
                size,
                ext,
            });
        }
        let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
        return Ok(FilePreview {
            kind: "image".into(),
            content: base64::engine::general_purpose::STANDARD.encode(bytes),
            truncated: false,
            size,
            ext,
        });
    }

    let limit = max_bytes
        .unwrap_or(DEFAULT_PREVIEW_BYTES)
        .min(2 * 1024 * 1024);
    let mut bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    let truncated = (bytes.len() as u64) > limit;
    if truncated {
        bytes.truncate(limit as usize);
    }
    // Heuristic: NUL bytes mean binary.
    if bytes.contains(&0) {
        return Ok(FilePreview {
            kind: "binary".into(),
            content: String::new(),
            truncated: false,
            size,
            ext,
        });
    }
    let content = String::from_utf8_lossy(&bytes).into_owned();
    Ok(FilePreview {
        kind: "text".into(),
        content,
        truncated,
        size,
        ext,
    })
}
