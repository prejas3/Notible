//! Community translations: reading locale files out of `app_data/locales`.
//!
//! The trust property that shapes this whole module: **a locale file is a file
//! a stranger wrote, that the user downloaded, and whose contents become the
//! application's own UI text.** Two consequences.
//!
//! First, this parses and validates in Rust and returns a typed structure. A
//! command that hands back the bytes of a file is a read primitive whatever
//! directory it is pointed at, and any code in the webview can call it —
//! plugin code included, since plugins are imported into the app's own realm.
//! Returning `{locale, name, strings}` instead of text is the difference
//! between a narrow command and a merely narrow-looking one.
//!
//! Second, the fixed directory is not the boundary by itself. `mklink /J`
//! needs no administrator rights, so the directory — or a single entry inside
//! it — can be pointed somewhere else entirely. Links are refused rather than
//! followed, the same rule `files::build_tree` already applies.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// Deliberately small. These bound what a hostile or merely broken file can
/// do to startup, and every one of them is a number the app can still start
/// with rather than a limit anybody would hit legitimately.
const MAX_FILES: usize = 64;
const MAX_FILE_BYTES: u64 = 256 * 1024;
const MAX_NAMESPACES: usize = 64;
const MAX_KEYS_PER_NAMESPACE: usize = 5_000;
/// A single label of a megabyte destroys the layout as effectively as any
/// injection would.
const MAX_STRING_CHARS: usize = 300;
const MAX_NAME_CHARS: usize = 60;
const MAX_META_CHARS: usize = 60;

/// One translation: a plain string, or the plural forms a language needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LocaleString {
    One(String),
    Plural(BTreeMap<String, String>),
}

impl LocaleString {
    fn within_limits(&self) -> bool {
        match self {
            LocaleString::One(value) => value.chars().count() <= MAX_STRING_CHARS,
            LocaleString::Plural(forms) => {
                !forms.is_empty()
                    && forms.len() <= 8
                    && forms
                        .values()
                        .all(|value| value.chars().count() <= MAX_STRING_CHARS)
            }
        }
    }
}

#[derive(Debug, Deserialize)]
struct RawLocale {
    locale: String,
    name: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    author: Option<String>,
    strings: BTreeMap<String, BTreeMap<String, LocaleString>>,
}

#[derive(Debug, Serialize)]
pub struct LocaleBundle {
    pub locale: String,
    pub name: String,
    /// Set by a language pack's author; lets the app tell an update from what is installed.
    pub version: Option<String>,
    pub author: Option<String>,
    pub strings: BTreeMap<String, BTreeMap<String, LocaleString>>,
    /// The file it came from, so the UI can say where a translation is from
    /// before the user activates it. A locale is *available* on being found
    /// and only *active* on being chosen — copying a file is not a ceremony.
    pub source: String,
    /// Reported rather than hidden: a translator needs to know their file was
    /// trimmed, and a user needs to know the list is not the whole file.
    pub dropped_keys: usize,
}

/// BCP-47-ish: what a language tag may look like before we accept it as a
/// directory-safe, `Intl`-safe identifier.
fn valid_tag(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 12
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
}

/// Namespaces a locale file may carry. `app` is Core and every builtin — one
/// product, released together. Anything else must look like a plugin id.
fn valid_namespace(value: &str) -> bool {
    value == "app"
        || (!value.is_empty()
            && value.len() <= 64
            && value
                .chars()
                .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || ch == '.'))
}

/// Validate and trim one parsed file. Returns `None` when the file is not a
/// locale at all; oversized *parts* are dropped and counted rather than
/// failing the whole file, so one bad key does not cost a user their language.
pub fn sanitize(raw: RawLocaleInput, source: String) -> Option<LocaleBundle> {
    let RawLocaleInput { locale, name, version, author, strings } = raw;
    let meta = |value: Option<String>| value.map(|text| text.trim().to_string()).filter(|text| !text.is_empty() && text.chars().count() <= MAX_META_CHARS);
    let (version, author) = (meta(version), meta(author));
    if !valid_tag(&locale) || name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return None;
    }
    let mut kept: BTreeMap<String, BTreeMap<String, LocaleString>> = BTreeMap::new();
    let mut dropped = 0usize;
    for (namespace, entries) in strings {
        if kept.len() >= MAX_NAMESPACES || !valid_namespace(&namespace) {
            dropped += entries.len();
            continue;
        }
        let mut namespace_entries = BTreeMap::new();
        for (key, value) in entries {
            if namespace_entries.len() >= MAX_KEYS_PER_NAMESPACE
                || key.is_empty()
                || key.chars().count() > MAX_STRING_CHARS
                || !value.within_limits()
            {
                dropped += 1;
                continue;
            }
            namespace_entries.insert(key, value);
        }
        if !namespace_entries.is_empty() {
            kept.insert(namespace, namespace_entries);
        }
    }
    if kept.is_empty() {
        return None;
    }
    Some(LocaleBundle { locale, name, version, author, strings: kept, source, dropped_keys: dropped })
}

/// The shape `sanitize` takes, exposed so tests can build one without JSON.
pub struct RawLocaleInput {
    pub locale: String,
    pub name: String,
    pub version: Option<String>,
    pub author: Option<String>,
    pub strings: BTreeMap<String, BTreeMap<String, LocaleString>>,
}

impl From<RawLocale> for RawLocaleInput {
    fn from(raw: RawLocale) -> Self {
        RawLocaleInput { locale: raw.locale, name: raw.name, version: raw.version, author: raw.author, strings: raw.strings }
    }
}

/// Read every locale file in `app_data/locales`.
///
/// A malformed or oversized file is skipped, never fatal: a broken translation
/// must not stop the application from starting.
pub fn read_locales(app_data_dir: &Path) -> Vec<LocaleBundle> {
    let dir = app_data_dir.join("locales");
    let Ok(metadata) = std::fs::symlink_metadata(&dir) else {
        return Vec::new();
    };
    // The directory itself being a link is the cheapest way to redirect this
    // command at somewhere else entirely.
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Vec::new();
    }
    let (Ok(canonical_dir), Ok(canonical_root)) = (dir.canonicalize(), app_data_dir.canonicalize())
    else {
        return Vec::new();
    };
    if !canonical_dir.starts_with(&canonical_root) {
        return Vec::new();
    }

    let Ok(entries) = std::fs::read_dir(&canonical_dir) else {
        return Vec::new();
    };
    let mut bundles = Vec::new();
    for entry in entries.flatten() {
        if bundles.len() >= MAX_FILES {
            break;
        }
        let Ok(file_type) = entry.file_type() else { continue };
        // No recursion and no links: only plain files directly in the folder.
        if file_type.is_symlink() || !file_type.is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        if entry.metadata().map(|value| value.len()).unwrap_or(u64::MAX) > MAX_FILE_BYTES {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        // serde_json enforces its own recursion limit, so a deeply nested
        // document cannot blow the stack here.
        let Ok(raw) = serde_json::from_str::<RawLocale>(&text) else { continue };
        let source = path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default();
        if let Some(bundle) = sanitize(raw.into(), source) {
            bundles.push(bundle);
        }
    }
    bundles.sort_by(|left, right| left.locale.cmp(&right.locale));
    bundles
}

/// What is written to disk: the *sanitised* data, never the downloaded text.
/// Whatever a pack contained beyond the accepted shape simply does not exist here.
#[derive(Serialize)]
struct StoredLocale<'a> {
    locale: &'a str,
    name: &'a str,
    version: &'a Option<String>,
    author: &'a Option<String>,
    strings: &'a BTreeMap<String, BTreeMap<String, LocaleString>>,
}

/// The folder for installed languages, created on demand and refused when it
/// is a link — the same rule the reader applies.
fn locales_dir_for_write(app_data_dir: &Path) -> Result<std::path::PathBuf, String> {
    let dir = app_data_dir.join("locales");
    match std::fs::symlink_metadata(&dir) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("the languages folder is not a plain folder".into());
            }
        }
        Err(_) => std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?,
    }
    Ok(dir)
}

/// Install a language pack from its downloaded text. The text is parsed,
/// validated and re-serialised; the file name is derived from the validated
/// language tag, never from anything the pack says about paths. English is the
/// source language and cannot be replaced.
pub fn install_locale(app_data_dir: &Path, text: &str) -> Result<LocaleBundle, String> {
    if text.len() as u64 > MAX_FILE_BYTES {
        return Err("that language file is too large".into());
    }
    let raw: RawLocale = serde_json::from_str(text).map_err(|_| "that is not a language file".to_string())?;
    let file_name = format!("{}.json", raw.locale);
    let bundle = sanitize(raw.into(), file_name.clone()).ok_or_else(|| "that language file is not valid".to_string())?;
    if bundle.locale.eq_ignore_ascii_case("en") {
        return Err("English is built in and cannot be replaced".into());
    }
    let stored = serde_json::to_string_pretty(&StoredLocale {
        locale: &bundle.locale,
        name: &bundle.name,
        version: &bundle.version,
        author: &bundle.author,
        strings: &bundle.strings,
    })
    .map_err(|error| error.to_string())?;
    let dir = locales_dir_for_write(app_data_dir)?;
    let target = dir.join(&file_name);
    // Write beside, then rename: a crash mid-write must leave the old language, not half a file.
    let temp = dir.join(format!(".{}.tmp", bundle.locale));
    std::fs::write(&temp, stored).map_err(|error| error.to_string())?;
    std::fs::rename(&temp, &target).map_err(|error| error.to_string())?;
    Ok(bundle)
}

/// Remove an installed language by its tag. Only a plain file named after a
/// valid tag inside the languages folder can be removed.
pub fn remove_locale(app_data_dir: &Path, tag: &str) -> Result<(), String> {
    if !valid_tag(tag) {
        return Err("that is not a language tag".into());
    }
    let target = app_data_dir.join("locales").join(format!("{tag}.json"));
    let metadata = std::fs::symlink_metadata(&target).map_err(|_| "that language is not installed".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("that language is not a plain file".into());
    }
    std::fs::remove_file(&target).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(pairs: &[(&str, &str, &str)]) -> BTreeMap<String, BTreeMap<String, LocaleString>> {
        let mut out: BTreeMap<String, BTreeMap<String, LocaleString>> = BTreeMap::new();
        for (namespace, key, value) in pairs {
            out.entry((*namespace).into())
                .or_default()
                .insert((*key).into(), LocaleString::One((*value).into()));
        }
        out
    }

    fn input(locale: &str, name: &str, pairs: &[(&str, &str, &str)]) -> RawLocaleInput {
        RawLocaleInput { locale: locale.into(), name: name.into(), version: None, author: None, strings: strings(pairs) }
    }

    #[test]
    fn accepts_a_plain_translation() {
        let bundle = sanitize(input("pl", "Polski", &[("app", "Close", "Zamknij")]), "pl.json".into()).unwrap();
        assert_eq!(bundle.locale, "pl");
        assert_eq!(bundle.strings["app"].len(), 1);
        assert_eq!(bundle.dropped_keys, 0);
    }

    /// A namespace that is neither `app` nor a plugin id has no meaning, and
    /// accepting one would be a place to smuggle strings past the rule that a
    /// plugin may only translate itself.
    #[test]
    fn refuses_nonsense_namespaces_and_tags() {
        let odd = sanitize(input("pl", "Polski", &[("../etc", "Close", "x")]), "pl.json".into());
        assert!(odd.is_none(), "a path-like namespace must not survive");
        assert!(sanitize(input("../pl", "Polski", &[("app", "a", "b")]), "x".into()).is_none());
        assert!(sanitize(input("pl", "", &[("app", "a", "b")]), "x".into()).is_none());
    }

    /// One oversized entry must cost that entry, not the whole language.
    #[test]
    fn oversized_strings_are_dropped_and_counted() {
        let huge = "x".repeat(MAX_STRING_CHARS + 1);
        let bundle = sanitize(
            input("pl", "Polski", &[("app", "Close", "Zamknij"), ("app", "Big", huge.as_str())]),
            "pl.json".into(),
        )
        .unwrap();
        assert_eq!(bundle.strings["app"].len(), 1, "the good key survives");
        assert_eq!(bundle.dropped_keys, 1, "the bad one is reported, not hidden");
    }

    #[test]
    fn plural_forms_survive_and_are_bounded() {
        let mut forms = BTreeMap::new();
        forms.insert("one".to_string(), "element".to_string());
        forms.insert("many".to_string(), "elementów".to_string());
        assert!(LocaleString::Plural(forms).within_limits());
        let mut huge = BTreeMap::new();
        huge.insert("one".to_string(), "x".repeat(MAX_STRING_CHARS + 1));
        assert!(!LocaleString::Plural(huge).within_limits());
        assert!(!LocaleString::Plural(BTreeMap::new()).within_limits());
    }

    /// A missing folder is the normal case, not an error: most users will
    /// never install a translation.
    #[test]
    fn a_missing_locales_folder_is_empty_not_fatal() {
        let temp = std::env::temp_dir().join(format!("notible-locales-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp).unwrap();
        assert!(read_locales(&temp).is_empty());
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn reads_a_real_folder_and_skips_what_it_should() {
        let temp = std::env::temp_dir().join(format!("notible-locales-{}", uuid::Uuid::new_v4()));
        let locales = temp.join("locales");
        std::fs::create_dir_all(&locales).unwrap();
        std::fs::write(
            locales.join("pl.json"),
            r#"{"locale":"pl","name":"Polski","strings":{"app":{"Close":"Zamknij"}}}"#,
        )
        .unwrap();
        // Not JSON by extension, not a locale by content, and a nested folder:
        // all three must be ignored rather than break the read.
        std::fs::write(locales.join("notes.txt"), "ignored").unwrap();
        std::fs::write(locales.join("broken.json"), "{ not json").unwrap();
        std::fs::create_dir_all(locales.join("nested")).unwrap();
        std::fs::write(
            locales.join("nested").join("de.json"),
            r#"{"locale":"de","name":"Deutsch","strings":{"app":{"Close":"Schliessen"}}}"#,
        )
        .unwrap();

        let bundles = read_locales(&temp);
        assert_eq!(bundles.len(), 1, "only the one valid top-level locale");
        assert_eq!(bundles[0].locale, "pl");
        assert_eq!(bundles[0].source, "pl.json");
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn installs_a_pack_from_text_and_removes_it_again() {
        let temp = std::env::temp_dir().join(format!("notible-locales-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp).unwrap();
        let text = r#"{"locale":"de","name":"Deutsch","version":"1.2.0","author":"A. Author","strings":{"app":{"Close":"Schliessen"}},"extra":"ignored"}"#;
        let bundle = install_locale(&temp, text).unwrap();
        assert_eq!(bundle.locale, "de");
        assert_eq!(bundle.version.as_deref(), Some("1.2.0"));
        let read = read_locales(&temp);
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].author.as_deref(), Some("A. Author"));
        // What is on disk is the sanitised form: the unknown field is gone.
        let stored = std::fs::read_to_string(temp.join("locales").join("de.json")).unwrap();
        assert!(!stored.contains("extra"));
        remove_locale(&temp, "de").unwrap();
        assert!(read_locales(&temp).is_empty());
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn refuses_english_bad_tags_and_junk() {
        let temp = std::env::temp_dir().join(format!("notible-locales-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp).unwrap();
        let english = r#"{"locale":"en","name":"English","strings":{"app":{"a":"b"}}}"#;
        assert!(install_locale(&temp, english).is_err(), "English is the source language");
        assert!(install_locale(&temp, "{ nope").is_err());
        let traversal = r#"{"locale":"../x","name":"X","strings":{"app":{"a":"b"}}}"#;
        assert!(install_locale(&temp, traversal).is_err(), "the tag becomes a file name, so it must be safe");
        assert!(remove_locale(&temp, "../x").is_err());
        assert!(remove_locale(&temp, "de").is_err(), "removing what is not installed is an error");
        let _ = std::fs::remove_dir_all(&temp);
    }
}
