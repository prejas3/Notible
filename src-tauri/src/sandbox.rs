//! Disposable test instances (debug builds only).
//!
//! `NOTIBLE_TEST_APP_DATA_DIR` points a debug build at a throwaway workspace.
//! Such an instance must not reach anything the real install owns: the OS
//! keyring, the installed app (updater, autostart), the user's global
//! Claude/Codex config, or the real window-state file.
//!
//! `NOTIBLE_SANDBOX=1` on top of that marks an agent sandbox
//! (`scripts/cdp/sandbox.cjs`): native dialogs and pickers — which CDP cannot
//! click — are answered from files in `<data>/.sandbox/` instead of blocking.
//! Release builds compile all of this down to "not a test instance".

use sha2::Digest;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// RELEASE-SAFETY (Hive #15): bytes that exist only in an exe built with
/// debug-assertions. `scripts/debug-build-marker.cjs` looks for them: the
/// release build refuses to ship an exe that has them, and the sandbox refuses
/// a `NOTIBLE_SANDBOX_EXE` that lacks them.
#[cfg(debug_assertions)]
const DEBUG_BUILD_MARKER: &str = "NOTIBLE-DEBUG-ASSERTIONS-BUILD:5b1e9c";

/// The disposable data directory this debug build was started with, if any.
pub(crate) fn test_data_dir() -> Option<PathBuf> {
    // RELEASE-SAFETY (Hive #15): keeps the marker in the exe even under the linker's dead-code removal.
    #[cfg(debug_assertions)]
    std::hint::black_box(DEBUG_BUILD_MARKER);
    #[cfg(debug_assertions)]
    if let Ok(raw) = std::env::var("NOTIBLE_TEST_APP_DATA_DIR") {
        let value = raw.trim();
        if !value.is_empty() {
            return Some(PathBuf::from(value));
        }
    }
    None
}

pub(crate) fn is_test_instance() -> bool {
    test_data_dir().is_some()
}

/// Keyring service name; test instances get their own so they never read or
/// overwrite the real install's tokens and keys.
pub(crate) fn keyring_service(base: &str) -> String {
    if is_test_instance() {
        format!("{base}.sandbox")
    } else {
        base.to_string()
    }
}

fn control_dir() -> Option<PathBuf> {
    if std::env::var("NOTIBLE_SANDBOX").ok().as_deref() != Some("1") {
        return None;
    }
    Some(test_data_dir()?.join(".sandbox"))
}

/// In an agent sandbox, answer a native confirm from `dialog-answer.txt`
/// ("approve" unless it says "cancel") and log it to `dialogs.log`, so a
/// scenario can assert the dialog would have been shown.
pub(crate) fn dialog_answer(title: &str) -> Option<bool> {
    let dir = control_dir()?;
    let answer = std::fs::read_to_string(dir.join("dialog-answer.txt")).unwrap_or_default();
    let approved = answer.trim() != "cancel";
    if let Ok(mut log) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("dialogs.log"))
    {
        let verdict = if approved { "approve" } else { "cancel" };
        let _ = writeln!(log, "{verdict}\t{title}");
    }
    Some(approved)
}

/// In an agent sandbox, a file/folder picker returns the path written to
/// `next-pick.txt` (one-shot, consumed here); missing or empty = cancelled.
pub(crate) fn picked_path() -> Option<Option<String>> {
    let file = control_dir()?.join("next-pick.txt");
    let picked = std::fs::read_to_string(&file)
        .ok()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());
    let _ = std::fs::remove_file(&file);
    Some(picked)
}

/// In an agent sandbox, "Save as" writes here instead of asking.
pub(crate) fn exports_dir() -> Option<PathBuf> {
    Some(control_dir()?.join("exports"))
}

/// In an agent sandbox, the window size a scenario asked for
/// (`sandbox.cjs start <name> --size 1460x740`). It is applied to the native
/// window: resizing over CDP (`Browser.setWindowBounds`) only resizes the
/// WebView, so the page renders larger or smaller than the window around it.
pub(crate) fn window_size() -> Option<(f64, f64)> {
    control_dir()?;
    let raw = std::env::var("NOTIBLE_SANDBOX_WINDOW_SIZE").ok()?;
    let (width, height) = raw.trim().split_once('x')?;
    Some((width.parse().ok()?, height.parse().ok()?))
}

// ------------------------------------------------------------ shared sync folder
// SYNC-TRANSPORT (Hive #9, hardened in #17): two agent sandboxes sync through
// one local folder instead of Google Drive, so a CDP script can test sync end
// to end.
//
// This is a file door for plugin code (any plugin with `data.sync`, or any
// script in the webview calling the command directly), so it is shut in layers:
// - the gate (`shared_config`): release builds refuse at compile time (cfg!),
//   it needs an agent sandbox (debug build + NOTIBLE_TEST_APP_DATA_DIR +
//   NOTIBLE_SANDBOX=1), and NOTIBLE_SANDBOX_SHARED_DIR must be exactly
//   `<sandboxes root>/.shared/<name>`, where the root is the one the sandbox's
//   own data dir lives in (`<root>/<sandbox>/data`, see sandbox.cjs);
// - containment (`SharedDir::open`): `.shared` and the folder are opened as
//   handles that refuse reparse points (junctions, symlinks) and, held without
//   FILE_SHARE_DELETE, cannot be renamed or swapped for a link while a command
//   uses them; the resolved folder must still be `<real root>/.shared/<name>`;
// - names: one flat file name, no separators, no "..", no device names;
// - files: opened without following links, regular files only, reads stop at
//   64 MiB + 1 byte, temp files get a random name and are created exclusively;
// - budget: at most 20000 files and 1 GiB in the folder, checked under a lock
//   file so two sandboxes writing at once cannot both slip past it.
//
// ponytail: a hard link planted inside the folder is still read through. Only
// something that can already write the sandbox tree can plant one, and every
// write replaces the directory entry (rename), so it is never written through.

const SHARED_MAX_BYTES: u64 = 64 * 1024 * 1024;
const SHARED_MAX_FILES: usize = 20_000;
const SHARED_MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const SHARED_LOCK: &str = ".lock";
const SHARED_REFUSED: &str = "The shared sync folder exists only in agent sandboxes.";

/// The gate: the shared folder and the sandboxes' root it must sit in, from
/// the environment (`env` is `std::env::var` outside tests).
fn shared_config(env: impl Fn(&str) -> Option<String>) -> Result<(PathBuf, PathBuf), String> {
    let refused = || SHARED_REFUSED.to_string();
    if cfg!(not(debug_assertions)) || cfg!(not(windows)) {
        return Err(refused());
    }
    let set = |key: &str| env(key).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let data = PathBuf::from(set("NOTIBLE_TEST_APP_DATA_DIR").ok_or_else(refused)?);
    if set("NOTIBLE_SANDBOX").as_deref() != Some("1") {
        return Err(refused());
    }
    let dir = PathBuf::from(set("NOTIBLE_SANDBOX_SHARED_DIR").ok_or_else(refused)?);
    let root = data.parent().and_then(|sandbox| sandbox.parent()).ok_or_else(refused)?;
    let name = dir.file_name().ok_or_else(refused)?;
    if !dir.is_absolute() || dir != root.join(".shared").join(name) {
        return Err(refused());
    }
    Ok((dir, root.to_path_buf()))
}

/// One flat file name: `[A-Za-z0-9]` first, then `[A-Za-z0-9._-]`, at most
/// 160 characters, and not a Windows device name (`nul.json` opens NUL).
fn shared_name_ok(name: &str) -> bool {
    let mut chars = name.chars();
    let first_ok = chars.next().is_some_and(|c| c.is_ascii_alphanumeric());
    let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
    let device = matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || ((stem.starts_with("com") || stem.starts_with("lpt")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit());
    first_ok
        && name.len() <= 160
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && !name.contains("..")
        && !device
}

#[cfg(windows)]
mod nofollow {
    use std::fs::{File, Metadata, OpenOptions};
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use std::path::Path;

    const FILE_READ_ATTRIBUTES: u32 = 0x80;
    const FILE_SHARE_READ: u32 = 0x1;
    const FILE_SHARE_WRITE: u32 = 0x2;
    const FILE_SHARE_DELETE: u32 = 0x4;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

    fn is_link(meta: &Metadata) -> bool {
        meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }

    /// A handle on a real directory (not a junction or link) that also keeps
    /// it from being renamed or deleted until dropped.
    pub fn pin_dir(path: &Path) -> Result<File, String> {
        let dir = OpenOptions::new()
            .access_mode(FILE_READ_ATTRIBUTES)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        let meta = dir.metadata().map_err(|e| e.to_string())?;
        if is_link(&meta) || !meta.is_dir() {
            return Err(format!("{} is a link, not a folder", path.display()));
        }
        Ok(dir)
    }

    /// A regular file opened for reading without following a link at `path`.
    pub fn open_file(path: &Path) -> std::io::Result<File> {
        let file = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        let meta = file.metadata()?;
        if is_link(&meta) || !meta.is_file() {
            return Err(std::io::Error::other("not a regular file"));
        }
        Ok(file)
    }

    /// The lock file, itself never followed through a link.
    pub fn open_lock(path: &Path) -> std::io::Result<File> {
        OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
    }
}

#[cfg(not(windows))]
mod nofollow {
    // The gate refuses off Windows (sandboxes are WebView2-only); these keep it compiling.
    use std::fs::File;
    use std::path::Path;
    pub fn pin_dir(_: &Path) -> Result<File, String> { Err(super::SHARED_REFUSED.into()) }
    pub fn open_file(_: &Path) -> std::io::Result<File> { Err(std::io::Error::other(super::SHARED_REFUSED)) }
    pub fn open_lock(_: &Path) -> std::io::Result<File> { Err(std::io::Error::other(super::SHARED_REFUSED)) }
}

/// The shared folder, contained: valid while it lives (see the pins).
struct SharedDir {
    path: PathBuf,
    _pins: (std::fs::File, std::fs::File),
}

impl SharedDir {
    fn from_env() -> Result<SharedDir, String> {
        let (dir, root) = shared_config(|key| std::env::var(key).ok())?;
        SharedDir::open(&dir, &root)
    }

    fn open(dir: &Path, root: &Path) -> Result<SharedDir, String> {
        let shared = root.join(".shared");
        let name = dir.file_name().ok_or(SHARED_REFUSED)?;
        // `.shared` is pinned before the folder is created in it, so a junction
        // there can never make create_dir land outside.
        let make = |path: &Path| match std::fs::create_dir(path) {
            Err(e) if e.kind() != std::io::ErrorKind::AlreadyExists => Err(format!("{}: {e}", path.display())),
            _ => Ok(()),
        };
        make(&shared)?;
        let outer = nofollow::pin_dir(&shared)?;
        make(&shared.join(name))?;
        let inner = nofollow::pin_dir(&shared.join(name))?;
        let real_root = root.canonicalize().map_err(|e| e.to_string())?;
        let real_dir = shared.join(name).canonicalize().map_err(|e| e.to_string())?;
        if real_dir != real_root.join(".shared").join(name) {
            return Err(format!("{} resolves outside the sandboxes' root", dir.display()));
        }
        Ok(SharedDir { path: shared.join(name), _pins: (outer, inner) })
    }

    fn file(&self, name: &str) -> Result<PathBuf, String> {
        if !shared_name_ok(name) {
            return Err(format!("not a shared-folder file name: {name:?}"));
        }
        Ok(self.path.join(name))
    }

    /// The whole file, refused past 64 MiB by bytes actually read (a sparse or
    /// growing file cannot outrun a size checked up front).
    fn read(&self, name: &str) -> Result<Vec<u8>, String> {
        let file = nofollow::open_file(&self.file(name)?).map_err(|e| format!("{name}: {e}"))?;
        let mut bytes = Vec::new();
        file.take(SHARED_MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > SHARED_MAX_BYTES {
            return Err(format!("{name} is larger than the shared folder allows (max 64 MB)"));
        }
        Ok(bytes)
    }

    fn list(&self) -> Result<Vec<SharedFile>, String> {
        let mut files = Vec::new();
        for entry in std::fs::read_dir(&self.path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !shared_name_ok(&name) || nofollow::open_file(&entry.path()).is_err() {
                continue; // dot-files (temp, lock), links, folders
            }
            if files.len() >= SHARED_MAX_FILES {
                // An error, not a cut-off list: sync would read a short list as
                // files missing on the other side.
                return Err("more than 20000 files in the shared folder".into());
            }
            // ponytail: hashes every file on every list; fine within the 1 GiB
            // budget, cache by (size, mtime, file id) if sandboxes ever grow.
            let digest = sha2::Sha256::digest(self.read(&name)?);
            let modified = digest.iter().map(|b| format!("{b:02x}")).collect();
            files.push(SharedFile { name, modified });
        }
        Ok(files)
    }

    /// Written to a randomly named dot-file first and renamed, so the other
    /// sandbox never reads half a snapshot (dot-files are not valid names, so
    /// list skips them). With `if_absent`, an existing file is left alone and
    /// false comes back; the lock makes "check, then rename" atomic.
    fn write(&self, name: &str, bytes: &[u8], if_absent: bool) -> Result<bool, String> {
        let path = self.file(name)?;
        if bytes.len() as u64 > SHARED_MAX_BYTES {
            return Err("file too large for the shared folder (max 64 MB)".into());
        }
        let lock = nofollow::open_lock(&self.path.join(SHARED_LOCK)).map_err(|e| e.to_string())?;
        lock.lock().map_err(|e| e.to_string())?; // released when `lock` drops
        if if_absent && std::fs::symlink_metadata(&path).is_ok() {
            return Ok(false);
        }
        let (mut count, mut total) = (0usize, 0u64);
        for entry in std::fs::read_dir(&self.path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_name() == SHARED_LOCK || entry.file_name() == name {
                continue;
            }
            count += 1;
            total += entry.metadata().map_or(0, |m| m.len());
        }
        if count >= SHARED_MAX_FILES {
            return Err("the shared folder is full (20000 files)".into());
        }
        if total + bytes.len() as u64 > SHARED_MAX_TOTAL_BYTES {
            return Err("the shared folder is full (1 GB)".into());
        }
        let temp = self.path.join(format!(".{name}.{:032x}.tmp", rand::random::<u128>()));
        let written = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .and_then(|mut file| file.write_all(bytes))
            .and_then(|_| std::fs::rename(&temp, &path));
        written.map_err(|e| {
            let _ = std::fs::remove_file(&temp);
            e.to_string()
        })?;
        Ok(true)
    }

    fn delete(&self, name: &str) -> Result<(), String> {
        match std::fs::remove_file(self.file(name)?) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }
}

#[derive(serde::Serialize)]
pub(crate) struct SharedFile {
    name: String,
    /// The revision: SHA-256 of the content, so it changes exactly when the
    /// bytes do (an mtime can repeat, e.g. in FAT's two-second steps).
    modified: String,
}

#[tauri::command]
pub(crate) fn sandbox_shared_available() -> bool {
    SharedDir::from_env().is_ok()
}

#[tauri::command]
pub(crate) fn sandbox_shared_list() -> Result<Vec<SharedFile>, String> {
    SharedDir::from_env()?.list()
}

#[tauri::command]
pub(crate) fn sandbox_shared_read(name: String) -> Result<String, String> {
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(SharedDir::from_env()?.read(&name)?))
}

/// True when written; false only with `if_absent` and the file already there.
#[tauri::command]
pub(crate) fn sandbox_shared_write(name: String, data_base64: String, if_absent: Option<bool>) -> Result<bool, String> {
    use base64::Engine;
    let dir = SharedDir::from_env()?;
    if data_base64.len() as u64 > SHARED_MAX_BYTES / 3 * 4 + 4 {
        return Err("file too large for the shared folder (max 64 MB)".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(&data_base64).map_err(|e| e.to_string())?;
    dir.write(&name, &bytes, if_absent.unwrap_or(false))
}

#[tauri::command]
pub(crate) fn sandbox_shared_delete(name: String) -> Result<(), String> {
    SharedDir::from_env()?.delete(&name)
}

#[cfg(test)]
mod shared_folder_tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn names_stay_inside_the_folder() {
        for ok in ["device-abc.json", "m.4f6c-1.png.bin", "notible-sync-key.json", "A_b-1"] {
            assert!(shared_name_ok(ok), "{ok}");
        }
        for bad in ["", ".hidden", ".lock", "../x", "..", "a/b", r"a\b", "C:x", "a..b", "nul", "NUL.json", "com1.txt", "lpt9", "x".repeat(161).as_str(), "a b", "é"] {
            assert!(!shared_name_ok(bad), "{bad}");
        }
    }

    /// Tests never run inside an agent sandbox, so every command is refused.
    #[test]
    fn refused_outside_a_sandbox() {
        assert!(!sandbox_shared_available());
        assert!(sandbox_shared_list().is_err());
        assert!(sandbox_shared_read("device-a.json".into()).is_err());
        assert!(sandbox_shared_write("device-a.json".into(), String::new(), None).is_err());
        assert!(sandbox_shared_delete("device-a.json".into()).is_err());
    }

    /// A fresh `<temp>/<root>` holding one sandbox's data dir, removed on drop.
    struct Root(PathBuf);
    impl Root {
        fn new(tag: &str) -> Root {
            let root = std::env::temp_dir().join(format!("notible-shared-{tag}-{:x}", rand::random::<u64>()));
            std::fs::create_dir_all(root.join("sb").join("data")).unwrap();
            Root(root)
        }
        /// A complete, valid sandbox environment pointing at `.shared/<name>`.
        fn env(&self, name: &str) -> HashMap<&'static str, String> {
            HashMap::from([
                ("NOTIBLE_TEST_APP_DATA_DIR", self.0.join("sb").join("data").display().to_string()),
                ("NOTIBLE_SANDBOX", "1".to_string()),
                ("NOTIBLE_SANDBOX_SHARED_DIR", self.0.join(".shared").join(name).display().to_string()),
            ])
        }
        fn dir(&self, name: &str) -> SharedDir {
            SharedDir::open(&self.0.join(".shared").join(name), &self.0).unwrap()
        }
    }
    impl Drop for Root {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn gate(env: &HashMap<&'static str, String>) -> Result<(PathBuf, PathBuf), String> {
        shared_config(|key| env.get(key).cloned())
    }

    /// The real (release) build refuses even with a complete, valid sandbox
    /// environment. `npm test` runs `cargo test --release`, so this is what it checks.
    #[cfg(not(debug_assertions))]
    #[test]
    fn release_build_refuses_even_with_sandbox_env() {
        let root = Root::new("release");
        assert_eq!(gate(&root.env("pair")).err().as_deref(), Some(SHARED_REFUSED));
        assert!(!root.0.join(".shared").exists(), "nothing was created");
    }

    /// The same environment opens in a debug build, and each missing or
    /// wrong piece is refused on its own.
    #[cfg(all(debug_assertions, windows))]
    #[test]
    fn debug_sandbox_gate() {
        let root = Root::new("gate");
        let valid = root.env("pair");
        let (dir, at) = gate(&valid).expect("a valid sandbox environment opens");
        assert!(SharedDir::open(&dir, &at).is_ok());
        for key in ["NOTIBLE_TEST_APP_DATA_DIR", "NOTIBLE_SANDBOX", "NOTIBLE_SANDBOX_SHARED_DIR"] {
            let mut env = valid.clone();
            env.remove(key);
            assert_eq!(gate(&env).err().as_deref(), Some(SHARED_REFUSED), "without {key}");
        }
        let wrong = |key, value: String| {
            let mut env = valid.clone();
            env.insert(key, value);
            gate(&env).err()
        };
        assert!(wrong("NOTIBLE_SANDBOX", "0".into()).is_some());
        assert!(wrong("NOTIBLE_SANDBOX_SHARED_DIR", root.0.join("elsewhere").join("pair").display().to_string()).is_some(), "not in .shared");
        assert!(wrong("NOTIBLE_SANDBOX_SHARED_DIR", std::env::temp_dir().join(".shared").join("pair").display().to_string()).is_some(), "another root's .shared");
        assert!(wrong("NOTIBLE_SANDBOX_SHARED_DIR", ".shared/pair".into()).is_some(), "relative");
    }

    #[cfg(windows)]
    fn junction(link: &Path, target: &Path) {
        let ok = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .unwrap()
            .status
            .success();
        assert!(ok, "mklink /J {} failed", link.display());
    }

    #[cfg(windows)]
    #[test]
    fn io_round_trip_and_digest_revision() {
        let root = Root::new("io");
        let dir = root.dir("pair");
        assert!(dir.write("device-a.json", b"one", false).unwrap());
        assert_eq!(dir.read("device-a.json").unwrap(), b"one");
        let revs = |dir: &SharedDir| dir.list().unwrap().into_iter().map(|f| (f.name, f.modified)).collect::<Vec<_>>();
        let first = revs(&dir);
        assert_eq!(first.len(), 1, "temp and lock files are not listed");
        // Same length, same mtime forced back: the revision still changes.
        let mtime = std::fs::metadata(dir.path.join("device-a.json")).unwrap().modified().unwrap();
        assert!(dir.write("device-a.json", b"two", false).unwrap());
        std::fs::File::options().write(true).open(dir.path.join("device-a.json")).unwrap().set_modified(mtime).unwrap();
        assert_ne!(revs(&dir), first, "a different content is a different revision");
        assert!(dir.write("device-a.json", b"one", false).unwrap());
        assert_eq!(revs(&dir), first, "the revision is the content's");
        dir.delete("device-a.json").unwrap();
        dir.delete("device-a.json").unwrap();
        assert!(dir.list().unwrap().is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn if_absent_keeps_the_first_writer() {
        let root = Root::new("absent");
        let dir = root.dir("pair");
        assert!(dir.write("workspace-key.txt", b"key A", true).unwrap());
        assert!(!dir.write("workspace-key.txt", b"key B", true).unwrap());
        assert_eq!(dir.read("workspace-key.txt").unwrap(), b"key A");
        assert!(dir.write("workspace-key.txt", b"key C", false).unwrap(), "an ordinary write still replaces");
        // Eight writers racing on one new name: exactly one creates it.
        let path = dir.path.clone();
        drop(dir);
        let racers: Vec<_> = (0..8)
            .map(|i| {
                let (root, path) = (root.0.clone(), path.clone());
                std::thread::spawn(move || SharedDir::open(&path, &root).unwrap().write("race.txt", format!("{i}").as_bytes(), true).unwrap())
            })
            .collect();
        let created = racers.into_iter().map(|t| t.join().unwrap()).filter(|c| *c).count();
        assert_eq!(created, 1);
    }

    #[cfg(windows)]
    #[test]
    fn junction_at_the_root_is_refused() {
        let root = Root::new("junction");
        let outside = Root::new("outside");
        std::fs::create_dir_all(outside.0.join("pair")).unwrap();
        // `.shared` itself a junction, then `.shared/<name>` a junction.
        junction(&root.0.join(".shared"), &outside.0);
        assert!(SharedDir::open(&root.0.join(".shared").join("pair"), &root.0).is_err());
        std::fs::remove_dir(root.0.join(".shared")).unwrap();
        std::fs::create_dir(root.0.join(".shared")).unwrap();
        junction(&root.0.join(".shared").join("pair"), &outside.0.join("pair"));
        assert!(SharedDir::open(&root.0.join(".shared").join("pair"), &root.0).is_err());
        assert_eq!(std::fs::read_dir(outside.0.join("pair")).unwrap().count(), 0, "nothing landed outside");
    }

    #[cfg(windows)]
    #[test]
    fn leaf_link_is_not_followed() {
        let root = Root::new("leaf");
        let dir = root.dir("pair");
        let secret = root.0.join("secret.txt");
        std::fs::write(&secret, b"outside").unwrap();
        // A file symlink needs Developer Mode or admin; without either, a
        // junction under the file name is the unprivileged equivalent.
        if std::os::windows::fs::symlink_file(&secret, dir.path.join("safe.json")).is_err() {
            junction(&dir.path.join("safe.json"), &root.0.join("sb"));
        }
        assert!(dir.read("safe.json").is_err(), "read refuses a link");
        assert!(dir.list().unwrap().is_empty(), "list skips it");
        assert_eq!(std::fs::read(&secret).unwrap(), b"outside");
    }

    #[cfg(windows)]
    #[test]
    fn pre_planted_temp_file_is_not_written_through() {
        let root = Root::new("temp");
        let dir = root.dir("pair");
        let victim = root.0.join("victim.txt");
        std::fs::write(&victim, b"keep me").unwrap();
        // The old predictable temp name, hard-linked to a file outside.
        std::fs::hard_link(&victim, dir.path.join(format!(".device-a.json.{}.tmp", std::process::id()))).unwrap();
        assert!(dir.write("device-a.json", b"snapshot", false).unwrap());
        assert_eq!(std::fs::read(&victim).unwrap(), b"keep me");
        assert_eq!(dir.read("device-a.json").unwrap(), b"snapshot");
    }

    #[cfg(windows)]
    #[test]
    fn reads_and_budget_are_bounded() {
        let root = Root::new("limits");
        let dir = root.dir("pair");
        let exact = vec![7u8; SHARED_MAX_BYTES as usize];
        assert!(dir.write("big.bin", &exact, false).unwrap(), "exactly 64 MiB is allowed");
        assert_eq!(dir.read("big.bin").unwrap().len(), exact.len());
        assert!(dir.write("bigger.bin", &vec![0; SHARED_MAX_BYTES as usize + 1], false).is_err());
        // A planted sparse file far over the limit: refused, not loaded.
        std::fs::File::create(dir.path.join("sparse.bin")).unwrap().set_len(8 * SHARED_MAX_BYTES).unwrap();
        assert!(dir.read("sparse.bin").unwrap_err().contains("larger"));
        assert!(dir.list().is_err(), "a list will not hash past the limit either");
        std::fs::remove_file(dir.path.join("sparse.bin")).unwrap();
        // The total: 15 more 64 MiB files fill 1 GiB, the next byte is refused.
        for i in 0..15 {
            std::fs::File::create(dir.path.join(format!("f{i}.bin"))).unwrap().set_len(SHARED_MAX_BYTES).unwrap();
        }
        assert!(dir.write("one-more.bin", b"x", false).unwrap_err().contains("1 GB"));
        assert!(dir.write("big.bin", &exact, false).unwrap(), "replacing a file does not count it twice");
        // The count: a folder at 20000 entries takes no new name.
        for i in 0..15 {
            std::fs::remove_file(dir.path.join(format!("f{i}.bin"))).unwrap();
        }
        for i in 0..SHARED_MAX_FILES - 1 {
            std::fs::File::create(dir.path.join(format!("n{i}"))).unwrap();
        }
        assert!(dir.write("new.bin", b"x", false).unwrap_err().contains("20000"));
        assert!(dir.write("n0", b"x", false).unwrap(), "an existing name can still be replaced");
    }
}
