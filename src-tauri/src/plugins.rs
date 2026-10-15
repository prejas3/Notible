//! Local plugin package extraction. The extractor never writes outside the
//! managed app-data plugin directory and requires a root-level plugin.json.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_ENTRIES: usize = 1_000;
const MAX_TOTAL_BYTES: usize = 50 * 1024 * 1024;
const MAX_FILE_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct ExtractedPlugin {
    pub plugin_id: String,
    pub version: String,
    pub install_path: String,
    pub manifest: String,
}

/// Hash the original ZIP before extraction. This is a plain package-integrity
/// digest surfaced by `hash_plugin_package` (e.g. for logs / diagnostics);
/// there is no signed manifest under the community market model, and opening an
/// archive is not trust evidence.
pub fn sha256_file(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("cannot read plugin package: {error}"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

/// One path component inside a plugin package.
///
/// The colon is rejected because of how `Path::join` behaves on Windows: a
/// component carrying a drive prefix **replaces** the base instead of
/// extending it, so `staging.join("C:/x.json")` is just `C:/x.json`. Without
/// this, a ZIP entry named after an absolute Windows path escaped the staging
/// directory and wrote anywhere the user could write — during extraction, so
/// before the trust dialog and regardless of its answer. Rejecting ':' also
/// covers NTFS alternate data streams (`plugin.json:hidden`).
fn safe_path_component(part: &str) -> bool {
    !part.is_empty()
        && part != "."
        && part != ".."
        && !part.contains(':')
        && !part.contains('\0')
}

fn safe_package_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    !normalized.is_empty()
        && !normalized.starts_with('/')
        && normalized.split('/').all(safe_path_component)
}

fn safe_component(value: &str) -> bool {
    !value.chars().any(|ch| matches!(ch, '/' | '\\')) && safe_path_component(value)
}

pub fn valid_plugin_id(value: &str) -> bool {
    let mut chars = value.chars();
    let first = chars.next();
    let last = value.chars().last();
    first.is_some_and(|ch| ch.is_ascii_lowercase())
        && last.is_some_and(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit())
        && value
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || ch == '.')
}

/// Extensions a theme pack may contain. Anything else — scripts, HTML, SVG (a
/// script origin the moment it is navigated to), archives — is refused at
/// extraction, in Rust, not merely ignored later by the CSS reader.
const THEME_FILE_EXTENSIONS: &[&str] = &["css", "png", "jpg", "jpeg", "webp", "gif", "woff2", "json", "md", "txt"];
/// One image or font in a theme pack. Larger files stay out of memory-hungry data: URIs.
pub const MAX_THEME_ASSET_BYTES: usize = 1400 * 1024;

fn theme_extension(name: &str) -> Option<String> {
    let file = name.rsplit('/').next().unwrap_or(name);
    file.rsplit_once('.').map(|(_, extension)| extension.to_ascii_lowercase())
}

/// A theme pack must declare styles, every declared style must be a .css file
/// in the package, and nothing but allow-listed file types may be present.
fn theme_package_is_acceptable(manifest: &serde_json::Value, files: &[(String, Vec<u8>)]) -> Result<(), String> {
    let styles = manifest
        .get("styles")
        .and_then(|value| value.as_array())
        .filter(|list| !list.is_empty())
        .ok_or("a theme pack must declare at least one stylesheet")?;
    for style in styles {
        let path = style.as_str().ok_or("a stylesheet path must be text")?;
        if !safe_package_path(path) || theme_extension(path).as_deref() != Some("css") {
            return Err(format!("a theme stylesheet must be a .css file inside the package: {path}"));
        }
        if !files.iter().any(|(name, _)| name == path) {
            return Err(format!("a theme stylesheet is missing from the package: {path}"));
        }
    }
    for (name, bytes) in files {
        match theme_extension(name) {
            Some(extension) if THEME_FILE_EXTENSIONS.contains(&extension.as_str()) => {}
            _ => return Err(format!("a theme pack may only contain styles, images and fonts: {name}")),
        }
        if !matches!(theme_extension(name).as_deref(), Some("css" | "json" | "md" | "txt")) && bytes.len() > MAX_THEME_ASSET_BYTES {
            return Err(format!("a theme asset is too large (over 1.4 MB): {name}"));
        }
    }
    Ok(())
}

/// The MIME type for an asset, decided from the file's real leading bytes and
/// never from its name alone: a renamed script is not an image.
pub fn sniff_theme_asset(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"wOF2") {
        Some("font/woff2")
    } else {
        None
    }
}

/// Read one asset of an installed theme pack as a data: URI. The caller names
/// the plugin; the install directory comes from the registry, never from the
/// caller. The path is checked component by component, resolved (so links and
/// junctions are followed *before* the containment test) and must stay inside
/// that directory.
pub fn read_theme_asset(install_path: &Path, relative: &str) -> Result<String, String> {
    if !safe_package_path(relative) {
        return Err("that is not a path inside the theme".into());
    }
    let extension = theme_extension(relative).ok_or("that file has no extension")?;
    if !["png", "jpg", "jpeg", "webp", "gif", "woff2"].contains(&extension.as_str()) {
        return Err("a theme can only load png, jpg, webp, gif or woff2 files".into());
    }
    let root = std::fs::canonicalize(install_path).map_err(|_| "the theme is not installed".to_string())?;
    let resolved = std::fs::canonicalize(root.join(relative.replace('\\', "/"))).map_err(|_| "that theme file does not exist".to_string())?;
    if !resolved.starts_with(&root) {
        return Err("that path leaves the theme".into());
    }
    let metadata = std::fs::metadata(&resolved).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() as usize > MAX_THEME_ASSET_BYTES {
        return Err("that theme file is not a plain file under 1.4 MB".into());
    }
    let bytes = std::fs::read(&resolved).map_err(|error| error.to_string())?;
    let mime = sniff_theme_asset(&bytes).ok_or("that file is not really an image or font")?;
    use base64::Engine as _;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

pub fn extract_plugin_zip(
    app_data_dir: &Path,
    archive_path: &str,
    // When the package came from a signed update manifest, the id and version
    // that manifest declares. The trust decision (signature, pinned key) was
    // made against those, so the ZIP's own plugin.json must not install under a
    // different identity. `None` for the developer directory/ZIP path.
    expected_id: Option<&str>,
    expected_version: Option<&str>,
) -> Result<ExtractedPlugin, String> {
    let archive_file = std::fs::File::open(archive_path)
        .map_err(|e| format!("cannot open plugin package: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(archive_file).map_err(|e| format!("invalid plugin ZIP: {e}"))?;
    let mut seen = HashSet::new();
    let mut files = Vec::new();
    let mut total = 0usize;

    if archive.len() > MAX_ENTRIES {
        return Err(format!(
            "plugin package has too many entries (max {MAX_ENTRIES})"
        ));
    }
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|e| format!("cannot read plugin ZIP entry: {e}"))?;
        let name = file.name().replace('\\', "/");
        if file.is_dir() {
            continue;
        }
        if !safe_package_path(&name) || !seen.insert(name.clone()) {
            return Err(format!("unsafe or duplicate plugin ZIP path: {name}"));
        }
        let size = file.size() as usize;
        if size > MAX_FILE_BYTES || total.saturating_add(size) > MAX_TOTAL_BYTES {
            return Err("plugin package exceeds the local size limit".into());
        }
        let mut bytes = Vec::with_capacity(size.min(MAX_FILE_BYTES));
        let mut limited = file.take((MAX_FILE_BYTES + 1) as u64);
        limited
            .read_to_end(&mut bytes)
            .map_err(|e| format!("cannot extract plugin ZIP entry: {e}"))?;
        if bytes.len() > MAX_FILE_BYTES || total.saturating_add(bytes.len()) > MAX_TOTAL_BYTES {
            return Err("plugin package exceeds the local size limit".into());
        }
        total += bytes.len();
        files.push((name, bytes));
    }

    let manifest_bytes = files
        .iter()
        .find(|(name, _)| name == "plugin.json")
        .map(|(_, bytes)| bytes)
        .ok_or("plugin package has no root-level plugin.json")?;
    let manifest_value: serde_json::Value = serde_json::from_slice(manifest_bytes)
        .map_err(|e| format!("plugin.json is not valid JSON: {e}"))?;
    let plugin_id = manifest_value
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("plugin.json has no id")?;
    let version = manifest_value
        .get("version")
        .and_then(|v| v.as_str())
        .ok_or("plugin.json has no version")?;
    // A theme pack is styles and assets only: no entry, and a strict file
    // allow-list below. Code plus the theme flag is refused, so the flag can
    // never be used to slip a script past the lighter install path.
    let is_theme = manifest_value.get("theme").is_some_and(|value| value.is_object());
    let declared_entry = manifest_value.get("entry").and_then(|v| v.as_str());
    let entry: Option<&str> = match (is_theme, declared_entry) {
        (true, Some(_)) => return Err("a theme pack cannot contain code (entry)".into()),
        (true, None) => None,
        (false, None) => return Err("plugin.json has no entry".into()),
        (false, Some(entry)) => Some(entry),
    };
    if !valid_plugin_id(plugin_id) || !safe_component(version) || entry.is_some_and(|value| !safe_package_path(value)) {
        return Err("plugin.json contains an unsafe id, version or entry path".into());
    }
    if is_theme {
        theme_package_is_acceptable(&manifest_value, &files)?;
    }
    if let Some(expected) = expected_id {
        if plugin_id != expected {
            return Err(format!(
                "package plugin.json id {plugin_id} does not match the signed manifest id {expected}"
            ));
        }
    }
    if let Some(expected) = expected_version {
        if version != expected {
            return Err(format!(
                "package plugin.json version {version} does not match the signed manifest version {expected}"
            ));
        }
    }
    if let Some(entry) = entry {
        if !files.iter().any(|(name, _)| name == entry) {
            return Err(format!("plugin entry is missing from package: {entry}"));
        }
    }

    let versions_dir = app_data_dir
        .join("plugins")
        .join(plugin_id)
        .join("versions");
    std::fs::create_dir_all(&versions_dir)
        .map_err(|e| format!("cannot create plugin directory: {e}"))?;
    let destination = versions_dir.join(version);
    if destination.exists() {
        return Err(format!(
            "plugin version is already installed: {plugin_id}@{version}"
        ));
    }
    let staging = versions_dir.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staging)
        .map_err(|e| format!("cannot create plugin staging directory: {e}"))?;
    let write_result = (|| {
        for (name, bytes) in &files {
            let target = staging.join(name);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(target, bytes)?;
        }
        std::fs::rename(&staging, &destination)
    })();
    if let Err(error) = write_result {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("cannot commit plugin package: {error}"));
    }

    Ok(ExtractedPlugin {
        plugin_id: plugin_id.to_string(),
        version: version.to_string(),
        install_path: PathBuf::from(destination).to_string_lossy().into_owned(),
        manifest: String::from_utf8_lossy(manifest_bytes).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A ZIP entry naming an absolute Windows path used to escape the staging
    /// directory entirely, because `Path::join` treats a drive-prefixed
    /// component as a replacement rather than a suffix. The write happened
    /// during extraction — before the trust dialog and whatever the user
    /// answered — so this was an arbitrary file write reachable by getting
    /// someone to pick a crafted .zip.
    #[test]
    fn package_paths_cannot_escape_the_staging_directory() {
        for escape in [
            "C:/Users/me/evil.js",
            "C:evil.js",
            "C:\\Users\\me\\evil.js",
            "sub/C:/evil.js",
            "plugin.json:stream",
            "../outside.js",
            "/absolute.js",
            "",
        ] {
            assert!(!safe_package_path(escape), "must be refused: {escape}");
        }
        for allowed in ["plugin.json", "main.js", "locales/pl.json", "a/b/c.txt"] {
            assert!(safe_package_path(allowed), "must be allowed: {allowed}");
        }

        // The version string builds a directory name the same way, through
        // safe_component, which had the same hole.
        for escape in ["C:evil", "C:/evil", "..", ".", "", "a/b"] {
            assert!(!safe_component(escape), "version must be refused: {escape}");
        }
        assert!(safe_component("1.0.0"));

        // The property all of this exists to guarantee, stated directly.
        let staging = std::path::Path::new("/stage");
        for name in ["plugin.json", "locales/pl.json", "a/b/c.txt"] {
            assert!(safe_package_path(name) && staging.join(name).starts_with(staging), "{name} escaped staging");
        }
    }

    #[test]
    fn extracts_real_plugin_zip_into_versioned_staging() {
        let root = std::env::temp_dir().join(format!("notible-plugin-zip-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let archive_path = root.join("example.hello.zip");
        let archive_file = std::fs::File::create(&archive_path).unwrap();
        let mut archive = zip::ZipWriter::new(archive_file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        archive.start_file("plugin.json", options).unwrap();
        archive
            .write_all(
                br#"{"id":"example.hello","name":"Hello","version":"0.1.0","apiVersion":"0.1","entry":"index.js"}"#,
            )
            .unwrap();
        archive.start_file("index.js", options).unwrap();
        archive.write_all(b"export default {};\n").unwrap();
        archive.finish().unwrap();

        let extracted = extract_plugin_zip(
            &root,
            archive_path.to_str().unwrap(),
            Some("example.hello"),
            Some("0.1.0"),
        )
        .unwrap();
        let package_hash = sha256_file(archive_path.to_str().unwrap()).unwrap();
        assert_eq!(package_hash.len(), 64);
        assert_eq!(package_hash, sha256_file(archive_path.to_str().unwrap()).unwrap());
        let staged = std::path::PathBuf::from(&extracted.install_path);
        assert_eq!(extracted.plugin_id, "example.hello");
        assert_eq!(extracted.version, "0.1.0");
        assert!(staged.join("plugin.json").is_file());
        assert!(staged.join("index.js").is_file());
        assert_eq!(staged, root.join("plugins/example.hello/versions/0.1.0"));

        let _ = std::fs::remove_dir_all(root);
    }

    /// A signed manifest for one plugin must not be able to install a package
    /// whose own plugin.json claims a different id — the pinned-key trust
    /// decision was made against the manifest id, audit finding Etap A.5.
    #[test]
    fn extract_rejects_manifest_id_mismatch() {
        let root = std::env::temp_dir().join(format!("notible-plugin-zip-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let archive_path = root.join("mismatch.zip");
        let archive_file = std::fs::File::create(&archive_path).unwrap();
        let mut archive = zip::ZipWriter::new(archive_file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        archive.start_file("plugin.json", options).unwrap();
        archive
            .write_all(
                br#"{"id":"attacker.evil","name":"Evil","version":"0.1.0","apiVersion":"0.1","entry":"index.js"}"#,
            )
            .unwrap();
        archive.start_file("index.js", options).unwrap();
        archive.write_all(b"export default {};\n").unwrap();
        archive.finish().unwrap();

        let result = extract_plugin_zip(
            &root,
            archive_path.to_str().unwrap(),
            Some("example.hello"),
            Some("0.1.0"),
        );
        assert!(result.unwrap_err().contains("does not match the signed manifest id"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn extract_accepts_matching_unsigned_zip() {
        let root = std::env::temp_dir().join(format!("notible-unsigned-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let archive_path = root.join("p.zip");
        let file = std::fs::File::create(&archive_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("plugin.json", opts).unwrap();
        zip.write_all(br#"{"id":"somedevs.kanban","name":"Kanban","version":"1.4.0","apiVersion":"1.11","entry":"main.js"}"#).unwrap();
        zip.start_file("main.js", opts).unwrap();
        zip.write_all(b"export default {};\n").unwrap();
        zip.finish().unwrap();

        let extracted = extract_plugin_zip(
            &root, archive_path.to_str().unwrap(), Some("somedevs.kanban"), Some("1.4.0"),
        ).unwrap();
        assert_eq!(extracted.plugin_id, "somedevs.kanban");
        assert_eq!(extracted.version, "1.4.0");
        let _ = std::fs::remove_dir_all(root);
    }

    fn theme_zip(dir: &Path, name: &str, manifest: &str, extra: &[(&str, &[u8])]) -> String {
        let path = dir.join(name);
        let file = std::fs::File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("plugin.json", opts).unwrap();
        zip.write_all(manifest.as_bytes()).unwrap();
        for (file_name, bytes) in extra {
            zip.start_file(*file_name, opts).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn a_theme_pack_installs_without_an_entry_and_only_with_allowed_files() {
        let root = std::env::temp_dir().join(format!("notible-theme-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let manifest = r#"{"id":"acme.glass","name":"Glass","version":"1.0.0","apiVersion":"1.17","styles":["theme.css"],"theme":{"name":"Glass","mode":"dark"}}"#;
        let ok = theme_zip(&root, "ok.zip", manifest, &[("theme.css", b"body{}"), ("bg.png", b"\x89PNG\r\n\x1a\nrest")]);
        let extracted = extract_plugin_zip(&root, &ok, Some("acme.glass"), Some("1.0.0")).unwrap();
        assert!(std::path::PathBuf::from(&extracted.install_path).join("theme.css").is_file());

        // A script inside a theme pack is refused, whatever it is called.
        let script = theme_zip(&root, "script.zip", &manifest.replace("acme.glass", "acme.evil"), &[("theme.css", b"body{}"), ("x.js", b"alert(1)")]);
        assert!(extract_plugin_zip(&root, &script, None, None).unwrap_err().contains("only contain styles"));
        // SVG is a script origin waiting to happen: refused too.
        let svg = theme_zip(&root, "svg.zip", &manifest.replace("acme.glass", "acme.svg"), &[("theme.css", b"body{}"), ("a.svg", b"<svg/>")]);
        assert!(extract_plugin_zip(&root, &svg, None, None).is_err());
        // Code plus the theme flag is refused outright.
        let both = theme_zip(&root, "both.zip", r#"{"id":"acme.both","name":"B","version":"1.0.0","apiVersion":"1.17","entry":"m.js","styles":["theme.css"],"theme":{"name":"B","mode":"light"}}"#, &[("theme.css", b"body{}"), ("m.js", b"1")]);
        assert!(extract_plugin_zip(&root, &both, None, None).unwrap_err().contains("cannot contain code"));
        // No entry and no theme flag is still not a package.
        let plain = theme_zip(&root, "plain.zip", r#"{"id":"acme.plain","name":"P","version":"1.0.0","apiVersion":"1.17","styles":["theme.css"]}"#, &[("theme.css", b"body{}")]);
        assert!(extract_plugin_zip(&root, &plain, None, None).unwrap_err().contains("no entry"));
        // A theme must actually ship its stylesheet.
        let empty = theme_zip(&root, "empty.zip", &manifest.replace("acme.glass", "acme.empty"), &[]);
        assert!(extract_plugin_zip(&root, &empty, None, None).is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn theme_assets_are_read_only_inside_the_theme_and_only_if_really_images() {
        let root = std::env::temp_dir().join(format!("notible-theme-asset-{}", uuid::Uuid::new_v4()));
        let theme = root.join("theme");
        std::fs::create_dir_all(theme.join("img")).unwrap();
        std::fs::write(theme.join("img").join("bg.png"), b"\x89PNG\r\n\x1a\nabc").unwrap();
        std::fs::write(theme.join("fake.png"), b"<script>alert(1)</script>").unwrap();
        std::fs::write(root.join("secret.png"), b"\x89PNG\r\n\x1a\nsecret").unwrap();
        let uri = read_theme_asset(&theme, "img/bg.png").unwrap();
        assert!(uri.starts_with("data:image/png;base64,"));
        assert!(read_theme_asset(&theme, "fake.png").is_err(), "a renamed script is not an image");
        assert!(read_theme_asset(&theme, "../secret.png").is_err(), "no way out of the theme");
        assert!(read_theme_asset(&theme, "C:/x.png").is_err());
        assert!(read_theme_asset(&theme, "img/bg.svg").is_err(), "svg is not served");
        assert!(read_theme_asset(&theme, "missing.png").is_err());
        assert!(read_theme_asset(&theme, "theme.css").is_err(), "only images and fonts");
        assert_eq!(sniff_theme_asset(b"wOF2abcd"), Some("font/woff2"));
        assert_eq!(sniff_theme_asset(b"MZ..."), None);
        let _ = std::fs::remove_dir_all(root);
    }
}
