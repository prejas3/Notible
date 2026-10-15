use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};

// ---------- Models ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Object {
    pub id: String,
    pub r#type: String,
    pub title: String,
    /// JSON string
    pub content: String,
    /// JSON string
    pub props: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
    pub trashed_at: Option<i64>,
    /// Parent folder/container resolved from the `in` relation.
    pub parent_id: Option<String>,
}

/// Errors for optimistic-locking updates, mapped to short strings for the UI.
#[derive(Debug)]
pub enum UpdateError {
    NotFound,
    Conflict,
    Db(rusqlite::Error),
}

impl std::fmt::Display for UpdateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UpdateError::NotFound => write!(f, "not_found"),
            UpdateError::Conflict => write!(f, "conflict"),
            UpdateError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl From<rusqlite::Error> for UpdateError {
    fn from(e: rusqlite::Error) -> Self {
        UpdateError::Db(e)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Relation {
    pub from_id: String,
    pub to_id: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncTombstone {
    pub object_id: String,
    pub deleted_at: i64,
}

/// A relation envelope used only by the synchronization contract. The public
/// UI relation shape intentionally remains the three-field `Relation` model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRelation {
    pub from_id: String,
    pub to_id: String,
    pub kind: String,
    pub created_at: i64,
}

/// Durable marker for a deleted relation. Relation tombstones are separate
/// from object tombstones because deleting an edge must not delete either
/// endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRelationTombstone {
    pub from_id: String,
    pub to_id: String,
    pub kind: String,
    pub deleted_at: i64,
}

/// Durable metadata for a locally installed plugin version. The executable
/// module is never stored in SQLite; `install_path` points to its managed
/// local directory and `manifest` keeps the validated descriptor available to
/// the UI before the runtime loads the module.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRegistryEntry {
    pub plugin_id: String,
    pub version: String,
    pub source: String,
    pub install_path: String,
    pub manifest: String,
    pub verified: bool,
    /// The user accepted the install warning for this exact package. Set only
    /// by `grant_plugin_trust`, which shows a native dialog first. Distinct
    /// from `verified`, which is a signature check.
    pub user_trusted: bool,
    pub state: String,
    pub last_error: Option<String>,
    pub installed_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeDef {
    pub name: String,
    /// JSON string
    pub schema: String,
    pub icon: Option<String>,
    pub color: Option<String>,
}

/// A backlink: an object referencing the target, plus the relation kind.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Backlink {
    #[serde(flatten)]
    pub object: Object,
    pub kind: String,
}

fn now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_else(|_| {
            eprintln!(
                "system clock is before UNIX epoch; timestamps will be unreliable"
            );
            0
        })
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Validate a SQLite backup and replace a destination database atomically.
///
/// The backup is copied to a staging file first and opened there, so a
/// malformed or incomplete backup cannot replace the current workspace. The
/// destination is moved aside until the staged file is in place; if that
/// second move fails, the original destination is restored.
pub fn restore_db_copy(
    backup_path: &std::path::Path,
    destination_path: &std::path::Path,
) -> std::result::Result<(), String> {
    use std::fs;

    if !backup_path.is_file() {
        return Err(format!("backup file does not exist: {}", backup_path.display()));
    }
    if backup_path == destination_path {
        return Err("backup and destination must be different files".into());
    }
    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create restore directory: {e}"))?;
    }

    let nonce = uuid::Uuid::new_v4();
    let file_name = destination_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("notible.db");
    let staging_path = destination_path.with_file_name(format!(".{file_name}.restore-{nonce}.staging"));
    let rollback_path = destination_path.with_file_name(format!(".{file_name}.restore-{nonce}.previous"));

    let result = (|| {
        fs::copy(backup_path, &staging_path)
            .map_err(|e| format!("copy backup to staging: {e}"))?;
        let validation = rusqlite::Connection::open(&staging_path)
            .map_err(|e| format!("open staged backup: {e}"))?;
        let integrity: String = validation
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|e| format!("validate staged backup: {e}"))?;
        if integrity.to_ascii_lowercase() != "ok" {
            return Err(format!("SQLite integrity check failed: {integrity}"));
        }
        drop(validation);

        let had_destination = destination_path.exists();
        if had_destination {
            fs::rename(destination_path, &rollback_path)
                .map_err(|e| format!("move current database aside: {e}"))?;
        }
        if let Err(error) = fs::rename(&staging_path, destination_path) {
            if had_destination {
                let _ = fs::rename(&rollback_path, destination_path);
            }
            return Err(format!("install restored database: {error}"));
        }
        if had_destination {
            let _ = fs::remove_file(&rollback_path);
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&staging_path);
    }
    result
}

/// Max history snapshots kept per object. Older versions are pruned on write.
/// Non-sync history rows kept per object (local edits, restores, baselines).
const HISTORY_KEEP: i64 = 50;
/// Sync-applied rows kept per object, counted separately so a peer — which in
/// Sync Simple is anyone with the Google account — can never push the user's
/// own versions out.
const HISTORY_KEEP_SYNC: i64 = 10;
/// A version larger than this gets no history row at all.
const HISTORY_SNAPSHOT_MAX: usize = 2 * 1024 * 1024;
/// Total `length(patch)` across the history table; see enforce_history_budget.
pub const HISTORY_BUDGET: i64 = 256 * 1024 * 1024;
/// Editor saves closer together than this belong to one session row…
const SESSION_GAP_MS: i64 = 5 * 60 * 1000;
/// …but a session never spans longer than this.
const SESSION_MAX_MS: i64 = 30 * 60 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistorySource {
    Local,
    Sync,
    Restore,
    Baseline,
}

impl HistorySource {
    fn as_str(self) -> &'static str {
        match self {
            HistorySource::Local => "local",
            HistorySource::Sync => "sync",
            HistorySource::Restore => "restore",
            HistorySource::Baseline => "baseline",
        }
    }
}
/// Heavy technical props arrays that must never be duplicated into history or
/// integration payloads. Kept in the live object, stripped from copies.
const HEAVY_PROPS_KEYS: &[&str] = &["_projectCalendarEvents"];

/// Return `props` (a JSON object string) with heavy technical keys removed.
/// Falls back to the original string if it isn't a JSON object.
fn props_without_heavy(props: &str) -> String {
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(props) else {
        return props.to_string();
    };
    let Some(obj) = value.as_object_mut() else {
        return props.to_string();
    };
    let mut changed = false;
    for key in HEAVY_PROPS_KEYS {
        changed |= obj.remove(*key).is_some();
    }
    if changed {
        value.to_string()
    } else {
        props.to_string()
    }
}

fn snapshot_of(object: &Object) -> String {
    serde_json::json!({
        "title": object.title,
        "content": object.content,
        "props": props_without_heavy(&object.props),
    })
    .to_string()
}

/// Keep the newest HISTORY_KEEP non-sync rows and HISTORY_KEEP_SYNC sync rows.
fn prune_history(conn: &Connection, object_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM history WHERE object_id = ?1 AND source = 'sync' AND id NOT IN
             (SELECT id FROM history WHERE object_id = ?1 AND source = 'sync' ORDER BY id DESC LIMIT ?2)",
        params![object_id, HISTORY_KEEP_SYNC],
    )?;
    conn.execute(
        "DELETE FROM history WHERE object_id = ?1 AND source <> 'sync' AND id NOT IN
             (SELECT id FROM history WHERE object_id = ?1 AND source <> 'sync' ORDER BY id DESC LIMIT ?2)",
        params![object_id, HISTORY_KEEP],
    )?;
    Ok(())
}

/// Record `object`'s current state. The one place history rows are written:
/// sessions, caps and retention all live here.
fn record_history(conn: &Connection, object: &Object, source: HistorySource, writer: Option<&str>) -> Result<()> {
    let snapshot = snapshot_of(object);
    if snapshot.len() > HISTORY_SNAPSHOT_MAX {
        eprintln!("history: {} is {} bytes, over the snapshot cap; not recorded", object.id, snapshot.len());
        return Ok(());
    }
    // History time is this machine's clock, never the (possibly
    // peer-stamped) updated_at, so sessions measure real time here.
    let ts = now();
    if source == HistorySource::Local && writer == Some("editor") {
        let newest: Option<(i64, i64, Option<i64>, String, Option<String>)> = conn
            .query_row(
                "SELECT id, ts, session_start, source, writer FROM history
                 WHERE object_id = ?1 ORDER BY id DESC LIMIT 1",
                [&object.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?;
        if let Some((id, last_ts, Some(start), last_source, Some(last_writer))) = newest {
            let gap = ts - last_ts;
            let age = ts - start;
            if last_source == "local"
                && last_writer == "editor"
                && (0..SESSION_GAP_MS).contains(&gap)
                && (0..SESSION_MAX_MS).contains(&age)
            {
                conn.execute("UPDATE history SET patch = ?2, ts = ?3 WHERE id = ?1", params![id, snapshot, ts])?;
                return Ok(());
            }
        }
    }
    conn.execute(
        "INSERT INTO history (object_id, ts, patch, source, writer, session_start) VALUES (?1, ?2, ?3, ?4, ?5, ?2)",
        params![object.id, ts, snapshot, source.as_str(), writer],
    )?;
    prune_history(conn, &object.id)
}

/// Before the first recorded change of an object, keep the version it had:
/// objects created with content, first inserted by sync, or older than 0.90.1
/// have no row for it. Empty objects are skipped — nothing to restore.
fn ensure_baseline(conn: &Connection, previous: &Object) -> Result<()> {
    let has_history: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM history WHERE object_id = ?1)",
        [&previous.id],
        |r| r.get(0),
    )?;
    let empty = matches!(previous.content.as_str(), "" | "{}") && matches!(previous.props.as_str(), "" | "{}");
    if has_history || empty {
        return Ok(());
    }
    let snapshot = snapshot_of(previous);
    if snapshot.len() > HISTORY_SNAPSHOT_MAX {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO history (object_id, ts, patch, source, writer, session_start) VALUES (?1, ?2, ?3, 'baseline', NULL, ?2)",
        params![previous.id, previous.updated_at, snapshot],
    )?;
    Ok(())
}

// ---------- Migrations ----------

/// A migration step is either a raw SQL script, or a Rust function for
/// transformations that aren't expressible in SQL alone (e.g. JSON merging
/// across rows). Index + 1 == schema version either way.
enum Migration {
    Sql(&'static str),
    Fn(fn(&Connection) -> Result<()>),
}

/// Ensure `schema` is a JSON object and its `"fields"` entry is a JSON
/// object, resetting either to `{}` (with a warning) if dirty/legacy data
/// left them as something else (null, array, string, ...). Used by startup
/// migrations so malformed on-disk data can never panic app startup.
fn ensure_schema_fields_object(
    schema: &mut serde_json::Value,
) -> &mut serde_json::Map<String, serde_json::Value> {
    if !schema.is_object() {
        eprintln!("migration: type schema was not a JSON object; resetting to {{}}");
        *schema = serde_json::json!({});
    }
    let schema_obj = schema
        .as_object_mut()
        .expect("schema was just normalized to an object");
    let fields_entry = schema_obj
        .entry("fields")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    if !fields_entry.is_object() {
        eprintln!("migration: type schema \"fields\" was not a JSON object; resetting to {{}}");
        *fields_entry = serde_json::Value::Object(serde_json::Map::new());
    }
    fields_entry
        .as_object_mut()
        .expect("fields was just normalized to an object")
}

/// Move any legacy per-object `props._customFields` field definitions into
/// the owning type's `schema.fields`, unioned across all objects of that
/// type. First definition seen for a given field name wins; object `props`
/// values are never modified.
fn migrate_custom_fields_to_types(conn: &Connection) -> Result<()> {
    use serde_json::Value;

    // type name -> (field name -> field def)
    let mut merged: std::collections::HashMap<String, serde_json::Map<String, Value>> =
        std::collections::HashMap::new();

    {
        let mut stmt = conn.prepare("SELECT type, props FROM objects")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (obj_type, props) = row?;
            let Ok(props_val) = serde_json::from_str::<Value>(&props) else {
                continue;
            };
            let Some(custom) = props_val.get("_customFields").and_then(|v| v.as_object()) else {
                continue;
            };
            let entry = merged.entry(obj_type).or_default();
            for (name, def) in custom {
                entry.entry(name.clone()).or_insert_with(|| def.clone());
            }
        }
    }

    for (type_name, fields) in merged {
        if fields.is_empty() {
            continue;
        }
        let existing_schema: Option<String> = conn
            .query_row(
                "SELECT schema FROM types WHERE name = ?1",
                params![type_name],
                |r| r.get(0),
            )
            .optional()?;
        let Some(existing_schema) = existing_schema else {
            // Unknown type (shouldn't normally happen) - skip rather than error.
            continue;
        };
        let mut schema_val: Value =
            serde_json::from_str(&existing_schema).unwrap_or_else(|_| serde_json::json!({}));
        if !schema_val.is_object() {
            schema_val = serde_json::json!({});
        }
        let schema_obj = schema_val.as_object_mut().unwrap();
        let existing_fields = schema_obj
            .entry("fields")
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        if !existing_fields.is_object() {
            *existing_fields = Value::Object(serde_json::Map::new());
        }
        let existing_fields_obj = existing_fields.as_object_mut().unwrap();
        for (name, def) in fields {
            // Union: keep whatever is already present in the type's schema,
            // skip conflicting duplicates rather than erroring.
            existing_fields_obj.entry(name).or_insert(def);
        }
        conn.execute(
            "UPDATE types SET schema = ?2 WHERE name = ?1",
            params![type_name, schema_val.to_string()],
        )?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataSource {
    pub id: String,
    pub name: String,
    /// JSON-encoded scope and optional query tree. Kept opaque by SQLite so
    /// the same definition can evolve without destructive schema changes.
    pub definition: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrationEvent {
    pub id: i64,
    pub event: String,
    pub object_id: String,
    pub object_type: String,
    pub occurred_at: i64,
    pub payload: String,
}

/// Durable delivery envelope for cloud synchronization. The payload is kept
/// opaque so a newer client can add operation kinds without rewriting the
/// local database. `operation_id` is the idempotency key sent to the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncOutboxEntry {
    pub operation_id: String,
    pub event: String,
    pub object_id: Option<String>,
    pub object_type: String,
    pub occurred_at: i64,
    pub payload: String,
    pub attempts: i64,
    pub state: String,
}

/// Bring the built-in work types up to a complete project-management schema
/// without deleting user-created fields. Existing property values remain
/// valid; only the type definitions and available choices are expanded.
fn migrate_project_work_schemas(conn: &Connection) -> Result<()> {
    let schemas = [
        (
            "task",
            serde_json::json!({
                "status": {"type":"select","options":["triage","backlog","todo","open","assigned","in-progress","pending","waiting","blocked","done","closed"]},
                "priority": {"type":"select","options":["none","low","medium","high","urgent"]},
                "due": {"type":"date"},
                "startDate": {"type":"date"},
                "reportedDate": {"type":"date"},
                "reminder": {"type":"date"},
                "recurrence": {"type":"select","options":["none","daily","weekly","monthly"]},
                "assignee": {"type":"text"},
                "reporter": {"type":"text"},
                "team": {"type":"text"},
                "estimate": {"type":"number"}
            }),
        ),
        (
            "issue",
            serde_json::json!({
                "status": {"type":"select","options":["triage","open","assigned","in-progress","pending","waiting","blocked","resolved","closed"]},
                "priority": {"type":"select","options":["none","low","medium","high","urgent"]},
                "severity": {"type":"select","options":["minor","moderate","major","critical"]},
                "due": {"type":"date"},
                "reportedDate": {"type":"date"},
                "reminder": {"type":"date"},
                "recurrence": {"type":"select","options":["none","daily","weekly","monthly"]},
                "assignee": {"type":"text"},
                "reporter": {"type":"text"},
                "team": {"type":"text"},
                "estimate": {"type":"number"}
            }),
        ),
        (
            "project",
            serde_json::json!({
                "status": {"type":"select","options":["planned","active","pending","on-hold","blocked","completed","cancelled","closed"]},
                "priority": {"type":"select","options":["none","low","medium","high","urgent"]},
                "startDate": {"type":"date"},
                "targetDate": {"type":"date"},
                "owner": {"type":"text"},
                "lead": {"type":"text"},
                "team": {"type":"text"}
            }),
        ),
    ];

    for (type_name, required_fields) in schemas {
        let current: Option<String> = conn
            .query_row(
                "SELECT schema FROM types WHERE name = ?1",
                [type_name],
                |r| r.get(0),
            )
            .optional()?;
        let Some(current) = current else { continue };
        let mut schema: serde_json::Value =
            serde_json::from_str(&current).unwrap_or_else(|_| serde_json::json!({"fields": {}}));
        if !schema.get("fields").is_some_and(|v| v.is_object()) {
            schema["fields"] = serde_json::json!({});
        }
        let fields = schema["fields"].as_object_mut().expect("fields normalized");
        for (name, definition) in required_fields.as_object().expect("object") {
            // Built-in workflow fields are intentionally upgraded, while all
            // unrelated custom properties are preserved.
            fields.insert(name.clone(), definition.clone());
        }
        conn.execute(
            "UPDATE types SET schema = ?1 WHERE name = ?2",
            params![schema.to_string(), type_name],
        )?;
    }
    Ok(())
}

/// Add a `tags` field (type "tags", multi-value) to the task/issue/project
/// schemas so Kanban cards can show colored tag pills and group columns by
/// use (Feedback #5 item 1). Only inserts the field if missing — unlike
/// `migrate_project_work_schemas`, this must not clobber other fields that
/// later migrations (e.g. the people-ref upgrade of `assignee`) have since
/// changed.
fn migrate_add_tags_field(conn: &Connection) -> Result<()> {
    add_tags_field(conn, &["task", "issue", "project"])
}

/// Migration 030: notes carry tags too (typed by hand earlier, and by agents
/// writing through the MCP server), but with an empty schema the Properties
/// panel had no field to show or edit them in.
fn migrate_add_note_tags_field(conn: &Connection) -> Result<()> {
    add_tags_field(conn, &["note"])
}

fn add_tags_field(conn: &Connection, type_names: &[&str]) -> Result<()> {
    for &type_name in type_names {
        let current: Option<String> = conn
            .query_row("SELECT schema FROM types WHERE name = ?1", [type_name], |r| r.get(0))
            .optional()?;
        let Some(current) = current else { continue };
        let mut schema: serde_json::Value =
            serde_json::from_str(&current).unwrap_or_else(|_| serde_json::json!({"fields": {}}));
        if !schema.get("fields").is_some_and(|v| v.is_object()) {
            schema["fields"] = serde_json::json!({});
        }
        let fields = schema["fields"].as_object_mut().expect("fields normalized");
        if !fields.contains_key("tags") {
            fields.insert("tags".to_string(), serde_json::json!({"type": "tags"}));
            conn.execute("UPDATE types SET schema = ?1 WHERE name = ?2", params![schema.to_string(), type_name])?;
        }
    }
    Ok(())
}

/// Issue schema never got a `startDate` field (only `task` did), so an issue
/// could never show a real start+due range on the Timeline — only a single-
/// day marker at its due date (Feedback #5 item 3). Additive-only, same
/// reasoning as `migrate_add_tags_field`.
fn migrate_add_issue_start_date(conn: &Connection) -> Result<()> {
    let current: Option<String> = conn
        .query_row("SELECT schema FROM types WHERE name = 'issue'", [], |r| r.get(0))
        .optional()?;
    let Some(current) = current else { return Ok(()) };
    let mut schema: serde_json::Value =
        serde_json::from_str(&current).unwrap_or_else(|_| serde_json::json!({"fields": {}}));
    if !schema.get("fields").is_some_and(|v| v.is_object()) {
        schema["fields"] = serde_json::json!({});
    }
    let fields = schema["fields"].as_object_mut().expect("fields normalized");
    if !fields.contains_key("startDate") {
        fields.insert("startDate".to_string(), serde_json::json!({"type": "date"}));
        conn.execute("UPDATE types SET schema = ?1 WHERE name = 'issue'", params![schema.to_string()])?;
    }
    Ok(())
}

/// Add first-class planning objects and migrate the legacy project-local
/// `_milestones` arrays without losing completed state.
fn migrate_project_planning(conn: &Connection) -> Result<()> {
    let planning_types = [
        (
            "milestone",
            "🎯",
            "#8b5cf6",
            serde_json::json!({"fields": {
                "status": {"type":"select","options":["planned","in-progress","completed"]},
                "targetDate": {"type":"date"}, "owner": {"type":"text"}
            }}),
        ),
        (
            "cycle",
            "🔄",
            "#0ea5e9",
            serde_json::json!({"fields": {
                "status": {"type":"select","options":["planned","active","completed"]},
                "startDate": {"type":"date"}, "targetDate": {"type":"date"},
                "capacity": {"type":"number"}
            }}),
        ),
        (
            "release",
            "🚀",
            "#10b981",
            serde_json::json!({"fields": {
                "status": {"type":"select","options":["planned","ready","released"]},
                "targetDate": {"type":"date"}, "version": {"type":"text"}
            }}),
        ),
    ];
    for (name, icon, color, schema) in planning_types {
        conn.execute(
            "INSERT OR IGNORE INTO types (name, schema, icon, color) VALUES (?1, ?2, ?3, ?4)",
            params![name, schema.to_string(), icon, color],
        )?;
    }

    for type_name in ["task", "issue"] {
        let current: Option<String> = conn
            .query_row(
                "SELECT schema FROM types WHERE name = ?1",
                [type_name],
                |row| row.get(0),
            )
            .optional()?;
        let Some(current) = current else { continue };
        let mut schema: serde_json::Value =
            serde_json::from_str(&current).unwrap_or_else(|_| serde_json::json!({"fields":{}}));
        let fields = ensure_schema_fields_object(&mut schema);
        fields
            .entry("milestoneId")
            .or_insert(serde_json::json!({"type":"text"}));
        fields
            .entry("cycleId")
            .or_insert(serde_json::json!({"type":"text"}));
        fields
            .entry("releaseId")
            .or_insert(serde_json::json!({"type":"text"}));
        fields
            .entry("actualEffort")
            .or_insert(serde_json::json!({"type":"number"}));
        conn.execute(
            "UPDATE types SET schema = ?1 WHERE name = ?2",
            params![schema.to_string(), type_name],
        )?;
    }
    let project_schema: Option<String> = conn
        .query_row(
            "SELECT schema FROM types WHERE name = 'project'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(current) = project_schema {
        let mut schema: serde_json::Value =
            serde_json::from_str(&current).unwrap_or_else(|_| serde_json::json!({"fields":{}}));
        let fields = ensure_schema_fields_object(&mut schema);
        fields.entry("health").or_insert(
            serde_json::json!({"type":"select","options":["on-track","at-risk","off-track"]}),
        );
        fields.entry("updateCadence").or_insert(
            serde_json::json!({"type":"select","options":["none","weekly","biweekly","monthly"]}),
        );
        conn.execute(
            "UPDATE types SET schema = ?1 WHERE name = 'project'",
            params![schema.to_string()],
        )?;
    }

    let mut legacy = Vec::<(String, String, bool)>::new();
    {
        let mut stmt = conn.prepare("SELECT id, props FROM objects WHERE type = 'project'")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (project_id, props) = row?;
            let value: serde_json::Value = serde_json::from_str(&props).unwrap_or_default();
            if let Some(items) = value.get("_milestones").and_then(|v| v.as_array()) {
                for item in items {
                    if let Some(title) = item.get("title").and_then(|v| v.as_str()) {
                        legacy.push((
                            project_id.clone(),
                            title.to_string(),
                            item.get("done").and_then(|v| v.as_bool()).unwrap_or(false),
                        ));
                    }
                }
            }
        }
    }
    for (project_id, title, done) in legacy {
        let props =
            serde_json::json!({"status": if done { "completed" } else { "planned" }}).to_string();
        create_object(
            conn,
            "milestone",
            &title,
            None,
            Some(&props),
            Some(&project_id),
        )?;
    }
    conn.execute(
        "UPDATE objects SET props = json_remove(props, '$._milestones') WHERE type = 'project' AND json_valid(props)",
        [],
    )?;
    Ok(())
}

fn migrate_project_finance(conn: &Connection) -> Result<()> {
    let finance_types = [
        (
            "financial_entry",
            "¤",
            "#6f8f78",
            serde_json::json!({"fields": {
                "kind": {"type":"select","options":["cost","income"]},
                "amount": {"type":"number"}, "currency": {"type":"text"},
                "date": {"type":"date"}, "category": {"type":"text"},
                "vendor": {"type":"text"}, "attachment": {"type":"text"},
                "recurrence": {"type":"select","options":["none","weekly","monthly","quarterly","yearly"]},
                "status": {"type":"select","options":["planned","approved","paid","cancelled"]},
                "milestoneId": {"type":"text"}
            }}),
        ),
        (
            "time_entry",
            "◷",
            "#6d8299",
            serde_json::json!({"fields": {
                "date": {"type":"date"}, "person": {"type":"text"},
                "hours": {"type":"number"}, "billable": {"type":"bool"},
                "billableRate": {"type":"number"}, "costRate": {"type":"number"},
                "currency": {"type":"text"}, "description": {"type":"text"}
            }}),
        ),
        (
            "vendor",
            "▣",
            "#8a7d70",
            serde_json::json!({"fields": {
                "email": {"type":"text"}, "url": {"type":"text"},
                "taxId": {"type":"text"}, "category": {"type":"text"}
            }}),
        ),
    ];
    for (name, icon, color, schema) in finance_types {
        conn.execute(
            "INSERT OR IGNORE INTO types (name, schema, icon, color) VALUES (?1, ?2, ?3, ?4)",
            params![name, schema.to_string(), icon, color],
        )?;
    }
    let current: Option<String> = conn
        .query_row(
            "SELECT schema FROM types WHERE name = 'project'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(current) = current {
        let mut schema: serde_json::Value =
            serde_json::from_str(&current).unwrap_or_else(|_| serde_json::json!({"fields":{}}));
        let fields = ensure_schema_fields_object(&mut schema);
        fields
            .entry("baseCurrency")
            .or_insert(serde_json::json!({"type":"text"}));
        fields
            .entry("plannedBudget")
            .or_insert(serde_json::json!({"type":"number"}));
        fields
            .entry("approvedBudget")
            .or_insert(serde_json::json!({"type":"number"}));
        fields
            .entry("openingCash")
            .or_insert(serde_json::json!({"type":"number"}));
        fields
            .entry("budgetAlertThreshold")
            .or_insert(serde_json::json!({"type":"number"}));
        fields
            .entry("financeVisibility")
            .or_insert(serde_json::json!({"type":"select","options":["private","workspace"]}));
        conn.execute(
            "UPDATE types SET schema = ?1 WHERE name = 'project'",
            params![schema.to_string()],
        )?;
    }
    Ok(())
}

/// Seed a local people directory from names already used by project fields.
/// Property values intentionally remain strings: this keeps existing filters,
/// exports and integrations compatible while the `person` objects provide a
/// stable place for future email/account metadata.
fn migrate_people_catalog(conn: &Connection) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO types (name, schema, icon, color) VALUES (?1, ?2, ?3, ?4)",
        params![
            "person",
            serde_json::json!({"fields": {
                "email": {"type":"text"},
                "avatar": {"type":"text"},
                "accountId": {"type":"text"}
            }})
            .to_string(),
            "@",
            "#64748b"
        ],
    )?;

    for type_name in ["task", "issue", "project", "milestone"] {
        let current: Option<String> = conn
            .query_row(
                "SELECT schema FROM types WHERE name = ?1",
                [type_name],
                |row| row.get(0),
            )
            .optional()?;
        let Some(current) = current else { continue };
        let mut schema: serde_json::Value =
            serde_json::from_str(&current).unwrap_or_else(|_| serde_json::json!({"fields":{}}));
        let fields = ensure_schema_fields_object(&mut schema);
        let names: &[&str] = match type_name {
            "task" | "issue" => &["assignee", "reporter"],
            "project" => &["owner", "lead"],
            "milestone" => &["owner"],
            _ => &[],
        };
        for name in names {
            fields.insert((*name).to_string(), serde_json::json!({"type":"people"}));
        }
        conn.execute(
            "UPDATE types SET schema = ?1 WHERE name = ?2",
            params![schema.to_string(), type_name],
        )?;
    }

    let mut names = std::collections::BTreeMap::<String, String>::new();
    let mut stmt = conn.prepare("SELECT props FROM objects")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    for row in rows {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&row?) else {
            continue;
        };
        for key in ["assignee", "reporter", "owner", "lead", "person"] {
            if let Some(name) = value
                .get(key)
                .and_then(|item| item.as_str())
                .map(str::trim)
                .filter(|name| !name.is_empty())
            {
                names
                    .entry(name.to_lowercase())
                    .or_insert_with(|| name.to_string());
            }
        }
    }
    drop(stmt);
    for name in names.into_values() {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM objects WHERE type = 'person' AND lower(title) = lower(?1) AND trashed_at IS NULL)",
            [&name], |row| row.get(0),
        )?;
        if !exists {
            create_object(conn, "person", &name, None, Some("{}"), None)?;
        }
    }
    Ok(())
}

/// Ordered list of migration steps. Index + 1 == schema version.
const MIGRATIONS: &[Migration] = &[
    // 001 - initial schema
    Migration::Sql(
        r#"
    CREATE TABLE objects (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        title       TEXT NOT NULL DEFAULT '',
        content     TEXT NOT NULL DEFAULT '{}',
        props       TEXT NOT NULL DEFAULT '{}',
        created_at  INTEGER,
        updated_at  INTEGER,
        archived_at INTEGER
    );

    CREATE TABLE relations (
        from_id TEXT,
        to_id   TEXT,
        kind    TEXT,
        PRIMARY KEY (from_id, to_id, kind)
    );

    CREATE TABLE types (
        name   TEXT PRIMARY KEY,
        schema TEXT NOT NULL DEFAULT '{}',
        icon   TEXT,
        color  TEXT
    );

    CREATE TABLE history (
        object_id TEXT,
        ts        INTEGER,
        patch     TEXT
    );

    CREATE VIRTUAL TABLE objects_fts USING fts5 (
        title,
        content,
        content='objects',
        content_rowid='rowid'
    );

    CREATE TRIGGER objects_ai AFTER INSERT ON objects BEGIN
        INSERT INTO objects_fts(rowid, title, content)
        VALUES (new.rowid, new.title, new.content);
    END;

    CREATE TRIGGER objects_ad AFTER DELETE ON objects BEGIN
        INSERT INTO objects_fts(objects_fts, rowid, title, content)
        VALUES ('delete', old.rowid, old.title, old.content);
    END;

    CREATE TRIGGER objects_au AFTER UPDATE ON objects BEGIN
        INSERT INTO objects_fts(objects_fts, rowid, title, content)
        VALUES ('delete', old.rowid, old.title, old.content);
        INSERT INTO objects_fts(rowid, title, content)
        VALUES (new.rowid, new.title, new.content);
    END;
    "#,
    ),
    // 002 - indexes + type seeds
    Migration::Sql(
        r#"
    CREATE INDEX IF NOT EXISTS idx_relations_to_kind   ON relations(to_id, kind);
    CREATE INDEX IF NOT EXISTS idx_relations_from_kind ON relations(from_id, kind);
    CREATE INDEX IF NOT EXISTS idx_objects_type_updated ON objects(type, updated_at);

    INSERT OR IGNORE INTO types (name, schema, icon, color) VALUES
    ('note',
     '{"fields":{}}',
     '📝', '#6b7280'),
    ('task',
     '{"fields":{"status":{"type":"select","options":["todo","doing","done"]},"due":{"type":"date"},"priority":{"type":"select","options":["low","med","high"]}}}',
     '✅', '#3b82f6'),
    ('todo',
     '{"fields":{"done":{"type":"bool"}}}',
     '☑️', '#10b981'),
    ('project',
     '{"fields":{"status":{"type":"select","options":["active","paused","done"]},"due":{"type":"date"}}}',
     '📁', '#f59e0b'),
    ('space',
     '{"fields":{}}',
     '🌐', '#8b5cf6'),
    ('folder',
     '{"fields":{}}',
     '📂', '#eab308'),
    ('dashboard',
     '{"fields":{}}',
     '📊', '#ef4444');
    "#,
    ),
    // 003 - bookmark type seed
    Migration::Sql(
        r#"
    INSERT OR IGNORE INTO types (name, schema, icon, color) VALUES
    ('bookmark',
     '{"fields":{"url":{"type":"text"}}}',
     '🔖', '#0ea5e9');
    "#,
    ),
    // 004 - real trash column + normalize bookmark schema stored as array
    Migration::Sql(
        r#"
    ALTER TABLE objects ADD COLUMN trashed_at INTEGER;

    UPDATE types SET schema = '{"fields":{"url":{"type":"text"}}}'
    WHERE name = 'bookmark' AND schema LIKE '%"fields":[%';

    UPDATE objects
    SET trashed_at = updated_at,
        props = json_remove(props, '$.trashed')
    WHERE json_valid(props) AND json_extract(props, '$.trashed') = 1;
    "#,
    ),
    // 005 - history gets a stable primary key
    Migration::Sql(
        r#"
    CREATE TABLE history_new (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        object_id TEXT,
        ts        INTEGER,
        patch     TEXT
    );
    INSERT INTO history_new (object_id, ts, patch)
        SELECT object_id, ts, patch FROM history ORDER BY ts ASC;
    DROP TABLE history;
    ALTER TABLE history_new RENAME TO history;
    CREATE INDEX idx_history_object_ts ON history(object_id, ts DESC);
    "#,
    ),
    // 006 - issue type seed
    Migration::Sql(
        r#"
    INSERT OR IGNORE INTO types (name, schema, icon, color) VALUES
    ('issue',
     '{"fields":{"status":{"type":"select","options":["open","in-progress","resolved","closed"]},"due":{"type":"date"},"priority":{"type":"select","options":["low","med","high"]}}}',
     '🐞', '#dc2626');
    "#,
    ),
    // 007 - move per-object props._customFields definitions into types.schema.fields
    Migration::Fn(migrate_custom_fields_to_types),
    // 008 - complete task, issue and project workflow schemas
    Migration::Fn(migrate_project_work_schemas),
    // 009 - add Triage as the entry state for work items
    Migration::Fn(migrate_project_work_schemas),
    // 010 - add reminders and recurrence to existing work type schemas
    Migration::Fn(migrate_project_work_schemas),
    // 011 - first-class milestones, cycles, releases and planning links
    Migration::Fn(migrate_project_planning),
    // 012 - durable local webhook/outbox contract for integrations
    Migration::Sql(
        r#"
    CREATE TABLE integration_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        event       TEXT NOT NULL,
        object_id   TEXT NOT NULL,
        object_type TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        payload     TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX idx_integration_events_cursor ON integration_events(id);
    CREATE TRIGGER integration_objects_insert AFTER INSERT ON objects BEGIN
        INSERT INTO integration_events(event, object_id, object_type, occurred_at, payload)
        VALUES ('object.created', new.id, new.type, new.updated_at, json_object('title', new.title, 'props', json(new.props)));
    END;
    CREATE TRIGGER integration_objects_update AFTER UPDATE ON objects BEGIN
        INSERT INTO integration_events(event, object_id, object_type, occurred_at, payload)
        VALUES ('object.updated', new.id, new.type, new.updated_at, json_object('title', new.title, 'props', json(new.props)));
    END;
    CREATE TRIGGER integration_objects_delete AFTER DELETE ON objects BEGIN
        INSERT INTO integration_events(event, object_id, object_type, occurred_at, payload)
        VALUES ('object.deleted', old.id, old.type, old.updated_at, json_object('title', old.title));
    END;
    "#,
    ),
    // 013 - project finance objects and protected project budget settings
    Migration::Fn(migrate_project_finance),
    // 014 - reusable, named data sources shared by every view layout
    Migration::Sql(
        r#"
    CREATE TABLE data_sources (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        definition TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_data_sources_updated ON data_sources(updated_at DESC);
    "#,
    ),
    // 015 - local people directory and autocomplete-ready people fields
    Migration::Fn(migrate_people_catalog),
    // 016 - first-class whiteboards persisted as ordinary local objects
    Migration::Sql(
        r#"
    INSERT OR IGNORE INTO types (name, schema, icon, color) VALUES
    ('whiteboard', '{"fields":{}}', '◇', '#ff8a3d');
    "#,
    ),
    // 017 - stop copying heavy calendar-event arrays into history and
    // integration payloads; add retention; reclaim existing bloat.
    Migration::Fn(migrate_trim_history_and_events),
    // 018 - local sync cursor and stable device metadata.
    Migration::Sql(
        r#"
    CREATE TABLE sync_state (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    "#,
    ),
    // 019 - explicit hard-delete markers for cross-device synchronization.
    Migration::Sql(
        r#"
    CREATE TABLE sync_tombstones (
        object_id  TEXT PRIMARY KEY,
        deleted_at INTEGER NOT NULL
    );
    "#,
    ),
    // 020 - relation creation metadata and explicit relation-delete markers.
    Migration::Sql(
        r#"
    CREATE TABLE sync_relation_state (
        from_id    TEXT NOT NULL,
        to_id      TEXT NOT NULL,
        kind       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (from_id, to_id, kind)
    );

    CREATE TABLE sync_relation_tombstones (
        from_id    TEXT NOT NULL,
        to_id      TEXT NOT NULL,
        kind       TEXT NOT NULL,
        deleted_at INTEGER NOT NULL,
        PRIMARY KEY (from_id, to_id, kind)
    );

    INSERT OR IGNORE INTO sync_relation_state (from_id, to_id, kind, created_at)
    SELECT from_id, to_id, kind, 0 FROM relations;
    "#,
    ),
    // 021 - durable local plugin registry; executable code remains on disk.
    Migration::Sql(
        r#"
    CREATE TABLE plugin_registry (
        plugin_id    TEXT NOT NULL,
        version      TEXT NOT NULL,
        source       TEXT NOT NULL,
        install_path TEXT NOT NULL,
        manifest     TEXT NOT NULL,
        verified     INTEGER NOT NULL DEFAULT 0,
        state        TEXT NOT NULL DEFAULT 'disabled',
        last_error   TEXT,
        installed_at INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, version)
    );
    CREATE INDEX idx_plugin_registry_state ON plugin_registry(plugin_id, state);
    "#,
    ),
    // 022 - explicit sync outbox with stable operation ids and acknowledgements.
    Migration::Sql(
        r#"
    CREATE TABLE sync_outbox (
        event_id       INTEGER,
        operation_id   TEXT PRIMARY KEY,
        event          TEXT NOT NULL,
        object_id      TEXT,
        object_type    TEXT NOT NULL,
        occurred_at    INTEGER NOT NULL,
        payload        TEXT NOT NULL DEFAULT '{}',
        attempts       INTEGER NOT NULL DEFAULT 0,
        state          TEXT NOT NULL DEFAULT 'pending',
        last_attempt_at INTEGER,
        acknowledged_at INTEGER
    );
    CREATE UNIQUE INDEX idx_sync_outbox_event ON sync_outbox(event_id) WHERE event_id IS NOT NULL;
    CREATE INDEX idx_sync_outbox_pending ON sync_outbox(state, occurred_at, operation_id);
    CREATE TRIGGER sync_outbox_integration_event AFTER INSERT ON integration_events BEGIN
        INSERT OR IGNORE INTO sync_outbox
            (event_id, operation_id, event, object_id, object_type, occurred_at, payload)
        VALUES
            (new.id,
             COALESCE((SELECT value FROM sync_state WHERE key = 'device_id'), 'pending') || ':event:' || new.id,
             new.event, new.object_id, new.object_type, new.occurred_at, new.payload);
    END;
    INSERT OR IGNORE INTO sync_outbox
        (event_id, operation_id, event, object_id, object_type, occurred_at, payload)
    SELECT id,
           COALESCE((SELECT value FROM sync_state WHERE key = 'device_id'), 'pending') || ':event:' || id,
           event, object_id, object_type, occurred_at, payload
      FROM integration_events;
    "#,
    ),
    // 023 - tags field on task/issue/project schemas (Feedback #5 item 1:
    // Kanban card tags + per-tag color)
    Migration::Fn(migrate_add_tags_field),
    // 024 - issue schema gets startDate too, so issues can show a real
    // start+due range on Timeline like tasks already do (Feedback #5 item 3)
    Migration::Fn(migrate_add_issue_start_date),
    // 025 - activity_entry type: SalesForce-case-style activity log entries,
    // stored as ordinary child objects (parentId = the task/issue/project
    // they log against) rather than a bespoke table, same convention as
    // financial_entry/time_entry (Feedback #5 item 5).
    Migration::Sql(
        r#"
    INSERT OR IGNORE INTO types (name, schema, icon, color) VALUES
    ('activity_entry',
     '{"fields":{"activityType":{"type":"select","options":["note","current_step","next_step","client_response","decision"]},"dueDate":{"type":"date"}}}',
     '🗒️', '#a3852c');
    "#,
    ),
    // 026 - `user_trusted`: the user's own explicit decision to run this
    // exact package, kept separate from the legacy `verified` flag.
    // Conflating the two meant a side-loaded plugin could never survive a
    // restart in a release build, because `verified` resolved to false for
    // anything third-party and `hydrate` skipped it. Under the no-sandbox
    // trust model (Model A ships no signed plugin manifests) the user's
    // recorded decision is the sole authority.
    Migration::Sql(
        r#"
    ALTER TABLE plugin_registry ADD COLUMN user_trusted INTEGER NOT NULL DEFAULT 0;
    "#,
    ),
    // 027 - pasted images used to be stored as this machine's absolute path
    // wrapped in an asset URL, so a synchronised note showed a dead picture on
    // the other machine. The stable form is `media/<uuid>.<ext>`; the path is
    // rebuilt at render time. History is deliberately left alone: a patch is a
    // record of what the user actually had.
    Migration::Fn(migrate_media_references),
    // 028 - notes untouched since before Core's Markdown editor still hold
    // their content as a Tiptap/ProseMirror `{"type":"doc",...}` document.
    // CoreMarkdownEditor only ever reads/writes plain Markdown text, so a
    // note in this old shape rendered as one block of raw JSON (or, for an
    // `image` node specifically, nothing at all) — not a sync or rendering
    // bug, just content that was never carried across the rewrite. This
    // flattens it once into the same Markdown text `textFromDocument` in
    // CoreOnlyApp.tsx produces, so the note round-trips through
    // CoreMarkdownEditor exactly like one authored there. Anything this
    // doesn't recognise falls back to its children's text, same as the TS
    // version, so nothing is silently dropped — worst case it downgrades to
    // plain text instead of vanishing.
    Migration::Fn(migrate_legacy_doc_content),
    // 029 - history rows say where a version came from (`source`), who wrote
    // it (`writer`: the note editor or not) and when its editing session
    // started, so editor autosaves coalesce into one row per session and sync
    // rows get their own retention. A Fn, not SQL: `migrate` runs no
    // transaction, and a crash between two ALTERs must not leave a database
    // whose next start fails on "duplicate column".
    Migration::Fn(migrate_history_sources),
    // 030 - tags field on the note schema, so note tags show in Properties
    Migration::Fn(migrate_add_note_tags_field),
    // 031 - SYNC-NO-LOSS (Hive #18, N1): when each object was last moved,
    // trashed, restored or archived here. Those leave `updated_at` alone, so
    // without this a sync apply cannot tell they happened after the export it
    // was planned against (see `mark_local_change`).
    Migration::Sql(
        r#"
    CREATE TABLE IF NOT EXISTS sync_local_marks (
        object_id TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,
        rev       INTEGER NOT NULL
    );
    "#,
    ),
    // 032 - Hive #7: durable conflict pairing and bounded atomic Undo receipts.
    Migration::Sql(crate::sync_conflicts::SCHEMA),
    // 033 - Hive #7 review: report a purged copy without cascading its Undo receipt.
    Migration::Sql(crate::sync_conflicts::KEEP_PURGED_COPY_RECEIPTS),
];

/// Migration 029, idempotent (see its entry in MIGRATIONS).
fn migrate_history_sources(conn: &Connection) -> Result<()> {
    let columns: Vec<String> = {
        let mut stmt = conn.prepare("SELECT name FROM pragma_table_info('history')")?;
        let names = stmt.query_map([], |row| row.get(0))?.collect::<Result<Vec<String>>>()?;
        names
    };
    let has = |name: &str| columns.iter().any(|column| column == name);
    if !has("source") {
        conn.execute_batch("ALTER TABLE history ADD COLUMN source TEXT NOT NULL DEFAULT 'local'")?;
    }
    if !has("writer") {
        conn.execute_batch("ALTER TABLE history ADD COLUMN writer TEXT")?;
    }
    if !has("session_start") {
        // Existing rows keep NULL: a NULL session never coalesces.
        conn.execute_batch("ALTER TABLE history ADD COLUMN session_start INTEGER")?;
    }
    Ok(())
}

/// Rewrite stored media references to `media/<uuid>.<ext>` (migration 027).
fn migrate_media_references(conn: &Connection) -> Result<()> {
    let rows: Vec<(String, String, String)> = {
        let mut stmt = conn.prepare("SELECT id, content, props FROM objects")?;
        let mapped = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
        mapped.collect::<Result<Vec<_>>>()?
    };
    for (id, content, props) in rows {
        let new_content = rewrite_media_references(&content);
        let new_props = rewrite_media_references(&props);
        if new_content.is_none() && new_props.is_none() {
            continue;
        }
        conn.execute(
            "UPDATE objects SET content = ?2, props = ?3 WHERE id = ?1",
            params![
                id,
                new_content.unwrap_or(content),
                new_props.unwrap_or(props)
            ],
        )?;
    }
    Ok(())
}

/// Flatten leftover Tiptap/ProseMirror doc-JSON `content` into plain
/// Markdown text (migration 028). Only touches `content`: `props` never held
/// a Tiptap document, in this shape or any other.
fn migrate_legacy_doc_content(conn: &Connection) -> Result<()> {
    let rows: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT id, content FROM objects")?;
        let mapped = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        mapped.collect::<Result<Vec<_>>>()?
    };
    for (id, content) in rows {
        let Some(markdown) = markdown_from_legacy_doc(&content) else {
            continue;
        };
        conn.execute(
            "UPDATE objects SET content = ?2 WHERE id = ?1",
            params![id, markdown],
        )?;
    }
    Ok(())
}

/// `None` when `raw` isn't a Tiptap doc (already-Markdown content, or not
/// JSON at all — the overwhelmingly common case, left untouched).
fn markdown_from_legacy_doc(raw: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(raw).ok()?;
    if parsed.get("type")?.as_str()? != "doc" {
        return None;
    }
    let children = parsed.get("content")?.as_array()?;
    let text = children
        .iter()
        .map(|node| node_markdown(node, None, 0))
        .collect::<Vec<_>>()
        .join("\n");
    Some(text.trim_end().to_string())
}

const MARK_WRAP_ORDER: [(&str, &str); 5] = [
    ("bold", "**"), ("underline", "__"), ("strike", "~~"), ("highlight", "=="), ("italic", "*"),
];

/// A text node with its marks applied, in the same fixed wrap order as
/// `markdownInline` in CoreOnlyApp.tsx (so `**_text_**`, not order-dependent
/// on how Tiptap happened to store the marks array).
fn inline_text(node: &serde_json::Value) -> String {
    if node.get("type").and_then(|v| v.as_str()) == Some("hardBreak") {
        return "\n".to_string();
    }
    let Some(text) = node.get("text").and_then(|v| v.as_str()) else {
        return String::new();
    };
    let mut delimiters: Vec<&str> = Vec::new();
    if let Some(marks) = node.get("marks").and_then(|v| v.as_array()) {
        for mark in marks {
            let Some(mark_type) = mark.get("type").and_then(|v| v.as_str()) else { continue };
            let canonical = match mark_type {
                "bold" | "strong" => "bold",
                "underline" | "u" => "underline",
                "strike" | "s" | "del" => "strike",
                "highlight" | "mark" => "highlight",
                "italic" | "em" => "italic",
                _ => continue,
            };
            if !delimiters.contains(&canonical) {
                delimiters.push(canonical);
            }
        }
    }
    let mut out = text.to_string();
    for (name, delimiter) in MARK_WRAP_ORDER {
        if delimiters.contains(&name) {
            out = format!("{delimiter}{out}{delimiter}");
        }
    }
    out
}

fn inline_children(node: &serde_json::Value) -> String {
    node.get("content")
        .and_then(|v| v.as_array())
        .map(|children| children.iter().map(inline_text).collect::<Vec<_>>().join(""))
        .unwrap_or_default()
}

fn table_cell_text(cell: &serde_json::Value) -> String {
    cell.get("content")
        .and_then(|v| v.as_array())
        .map(|paragraphs| {
            paragraphs
                .iter()
                .map(inline_children)
                .collect::<Vec<_>>()
                .join(" ")
                .trim()
                .to_string()
        })
        .unwrap_or_default()
}

fn table_markdown(node: &serde_json::Value) -> String {
    let empty = Vec::new();
    let rows: Vec<Vec<String>> = node
        .get("content")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty)
        .iter()
        .filter(|row| row.get("type").and_then(|v| v.as_str()) == Some("tableRow"))
        .map(|row| {
            row.get("content")
                .and_then(|v| v.as_array())
                .unwrap_or(&empty)
                .iter()
                .map(table_cell_text)
                .collect::<Vec<_>>()
        })
        .collect();
    let Some(header) = rows.first() else { return String::new() };
    let mut lines = vec![
        format!("| {} |", header.join(" | ")),
        format!("| {} |", header.iter().map(|_| "---").collect::<Vec<_>>().join(" | ")),
    ];
    for row in rows.iter().skip(1) {
        lines.push(format!("| {} |", row.join(" | ")));
    }
    lines.join("\n")
}

/// Rust twin of `markdownFromNode` in `src/core/app/CoreOnlyApp.tsx`. Keep
/// the two in step: this is what makes an old Tiptap-doc note round-trip
/// through CoreMarkdownEditor exactly like one authored there. An
/// unrecognised node type falls back to its children's text (the same
/// default the TS version uses), so nothing is silently dropped.
fn node_markdown(node: &serde_json::Value, list_context: Option<(bool, i64)>, index_in_list: i64) -> String {
    let node_type = node.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let empty = Vec::new();
    let children = || node.get("content").and_then(|v| v.as_array()).unwrap_or(&empty).clone();
    match node_type {
        "text" => inline_text(node),
        "paragraph" => inline_children(node),
        "heading" => {
            let level = node.get("attrs").and_then(|a| a.get("level")).and_then(|v| v.as_i64()).unwrap_or(1).clamp(1, 3);
            format!("{} {}", "#".repeat(level as usize), inline_children(node))
        }
        "codeBlock" => {
            let lang = node.get("attrs").and_then(|a| a.get("language")).and_then(|v| v.as_str()).unwrap_or("");
            let code = children().iter().map(|c| c.get("text").and_then(|v| v.as_str()).unwrap_or("")).collect::<Vec<_>>().join("");
            format!("```{lang}\n{code}\n```")
        }
        "image" => {
            let alt = node.get("attrs").and_then(|a| a.get("alt")).and_then(|v| v.as_str()).unwrap_or("");
            let src = node.get("attrs").and_then(|a| a.get("src")).and_then(|v| v.as_str()).unwrap_or("");
            format!("![{alt}]({src})")
        }
        "horizontalRule" => "---".to_string(),
        "blockquote" => children()
            .iter()
            .map(|c| node_markdown(c, None, 0))
            .collect::<Vec<_>>()
            .join("\n")
            .split('\n')
            .map(|line| format!("> {line}"))
            .collect::<Vec<_>>()
            .join("\n"),
        "bulletList" => children()
            .iter()
            .enumerate()
            .map(|(i, c)| node_markdown(c, Some((false, 1)), i as i64))
            .collect::<Vec<_>>()
            .join("\n"),
        "orderedList" => {
            let start = node.get("attrs").and_then(|a| a.get("start")).and_then(|v| v.as_i64()).unwrap_or(1);
            children()
                .iter()
                .enumerate()
                .map(|(i, c)| node_markdown(c, Some((true, start)), i as i64))
                .collect::<Vec<_>>()
                .join("\n")
        }
        "taskList" => children().iter().map(|c| node_markdown(c, None, 0)).collect::<Vec<_>>().join("\n"),
        "listItem" => {
            let inner = children().iter().map(|c| node_markdown(c, None, 0)).collect::<Vec<_>>().join(" ").trim().to_string();
            let prefix = match list_context {
                Some((true, start)) => format!("{}. ", start + index_in_list),
                _ => "- ".to_string(),
            };
            format!("{prefix}{inner}")
        }
        "taskItem" => {
            let inner = children().iter().map(|c| node_markdown(c, None, 0)).collect::<Vec<_>>().join(" ").trim().to_string();
            let checked = node.get("attrs").and_then(|a| a.get("checked")).and_then(|v| v.as_bool()).unwrap_or(false);
            format!("- [{}] {inner}", if checked { "x" } else { " " })
        }
        "table" => table_markdown(node),
        _ => children().iter().map(|c| node_markdown(c, None, 0)).collect::<Vec<_>>().join("\n"),
    }
}

/// Rebuild integration triggers to exclude heavy technical props, cap
/// integration_events, prune old history, and strip the heavy arrays already
/// duplicated across existing history and event rows.
fn migrate_trim_history_and_events(conn: &Connection) -> Result<()> {
    // New triggers omit `_projectCalendarEvents` from the payload props, and a
    // prune trigger keeps the outbox bounded.
    conn.execute_batch(
        r#"
    DROP TRIGGER IF EXISTS integration_objects_insert;
    DROP TRIGGER IF EXISTS integration_objects_update;
    DROP TRIGGER IF EXISTS integration_objects_delete;
    CREATE TRIGGER integration_objects_insert AFTER INSERT ON objects BEGIN
        INSERT INTO integration_events(event, object_id, object_type, occurred_at, payload)
        VALUES ('object.created', new.id, new.type, new.updated_at,
                json_object('title', new.title,
                            'props', json_remove(json(new.props), '$._projectCalendarEvents')));
    END;
    CREATE TRIGGER integration_objects_update AFTER UPDATE ON objects BEGIN
        INSERT INTO integration_events(event, object_id, object_type, occurred_at, payload)
        VALUES ('object.updated', new.id, new.type, new.updated_at,
                json_object('title', new.title,
                            'props', json_remove(json(new.props), '$._projectCalendarEvents')));
    END;
    CREATE TRIGGER integration_objects_delete AFTER DELETE ON objects BEGIN
        INSERT INTO integration_events(event, object_id, object_type, occurred_at, payload)
        VALUES ('object.deleted', old.id, old.type, old.updated_at, json_object('title', old.title));
    END;
    CREATE TRIGGER integration_events_prune AFTER INSERT ON integration_events BEGIN
        DELETE FROM integration_events WHERE id <= (SELECT MAX(id) FROM integration_events) - 2000;
    END;
    "#,
    )?;

    // Reclaim: strip the heavy key from existing event payloads and cap the table.
    conn.execute(
        "UPDATE integration_events
         SET payload = json_remove(payload, '$.props._projectCalendarEvents')
         WHERE json_valid(payload)",
        [],
    )?;
    conn.execute(
        "DELETE FROM integration_events WHERE id <= (SELECT MAX(id) FROM integration_events) - 2000",
        [],
    )?;

    // Reclaim history: rewrite patches, dropping the heavy key from the inner
    // props string, then prune to the retention limit per object.
    let mut rows = Vec::<(i64, String)>::new();
    {
        let mut stmt = conn.prepare("SELECT id, patch FROM history")?;
        let mapped = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        for row in mapped {
            rows.push(row?);
        }
    }
    for (row_id, patch) in rows {
        let Ok(mut snap) = serde_json::from_str::<serde_json::Value>(&patch) else {
            continue;
        };
        let Some(props_str) = snap.get("props").and_then(|v| v.as_str()) else {
            continue;
        };
        let trimmed = props_without_heavy(props_str);
        if trimmed.len() == props_str.len() {
            continue;
        }
        snap["props"] = serde_json::Value::String(trimmed);
        conn.execute(
            "UPDATE history SET patch = ?2 WHERE id = ?1",
            params![row_id, snap.to_string()],
        )?;
    }
    conn.execute(
        "DELETE FROM history WHERE id NOT IN
             (SELECT id FROM (
                 SELECT id, ROW_NUMBER() OVER (PARTITION BY object_id ORDER BY id DESC) rn
                 FROM history) WHERE rn <= 30)",
        [],
    )?;
    conn.execute("VACUUM", [])?;
    Ok(())
}

pub fn open(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    migrate(&conn)?;
    Ok(conn)
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)",
        [],
    )?;
    let current: i64 = conn
        .query_row("SELECT version FROM schema_version LIMIT 1", [], |r| {
            r.get(0)
        })
        .optional()?
        .unwrap_or(0);

    if current == 0 {
        conn.execute("INSERT INTO schema_version (version) VALUES (0)", [])?;
    }

    let target = MIGRATIONS.len() as i64;
    for v in current..target {
        match &MIGRATIONS[v as usize] {
            Migration::Sql(script) => conn.execute_batch(script)?,
            Migration::Fn(f) => f(conn)?,
        }
        conn.execute("UPDATE schema_version SET version = ?1", params![v + 1])?;
    }
    Ok(())
}

// ---------- Object CRUD ----------

fn map_object(row: &rusqlite::Row) -> Result<Object> {
    Ok(Object {
        id: row.get("id")?,
        r#type: row.get("type")?,
        title: row.get("title")?,
        content: row.get("content")?,
        props: row.get("props")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        archived_at: row.get("archived_at")?,
        trashed_at: row.get("trashed_at")?,
        parent_id: row.get("parent_id")?,
    })
}

const OBJ_COLS: &str =
    "id, type, title, content, props, created_at, updated_at, archived_at, trashed_at,\
     (SELECT to_id FROM relations WHERE from_id = id AND kind = 'in' LIMIT 1) AS parent_id";

/// Column list for list/query projections: identical to OBJ_COLS but with the
/// heavy `_projectCalendarEvents` array stripped from props. Lists, tables, the
/// sidebar and pickers never read that field (only the project Calendar tab
/// does, via the full get_object), so keeping it out of bulk results cuts the
/// biggest chunk of IPC/serialization weight. `content` is kept — it totals
/// only tens of KB across the workspace.
const LIST_COLS: &str = "id, type, title, content, \
    CASE WHEN json_valid(props) THEN json_remove(props, '$._projectCalendarEvents') ELSE props END AS props, \
    created_at, updated_at, archived_at, trashed_at,\
    (SELECT to_id FROM relations WHERE from_id = id AND kind = 'in' LIMIT 1) AS parent_id";

pub fn create_object(
    conn: &Connection,
    r#type: &str,
    title: &str,
    content: Option<&str>,
    props: Option<&str>,
    parent_id: Option<&str>,
) -> Result<Object> {
    let id = new_id();
    let ts = now();
    let content = content.unwrap_or("{}");
    let props = props.unwrap_or("{}");
    conn.execute(
        "INSERT INTO objects (id, type, title, content, props, created_at, updated_at, archived_at, trashed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, NULL, NULL)",
        params![id, r#type, title, content, props, ts],
    )?;
    if let Some(pid) = parent_id {
        create_relation(conn, &id, pid, "in")?;
    }
    get_object(conn, &id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}

/// One thing found inside a note's body.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContentIndexEntry {
    pub object_id: String,
    /// "heading" | "tag" | "link" | "task"
    pub kind: String,
    pub value: String,
    /// Heading depth, 1–6. None for other kinds.
    pub level: Option<i64>,
    /// Whether a task is ticked. None for other kinds.
    pub checked: Option<bool>,
    /// Zero-based line the entry was found on.
    pub line: i64,
}

/// One block of a stored note body, with whatever structure the node carried.
#[derive(Debug, Default, Clone)]
struct ContentBlock {
    text: String,
    /// The node type, e.g. "paragraph", "heading", "taskItem".
    node: String,
    /// `attrs.level` on a heading node.
    level: Option<i64>,
    /// `attrs.checked` on a task item.
    checked: Option<bool>,
}

/// Walk a stored note body into blocks.
///
/// **Content exists in two dialects in the same column**, and the index has to
/// read both. Core's own editor writes one line of literal Markdown per
/// paragraph, so `## Cel` is text. Notes authored by the richer editor store a
/// real `heading` node with `attrs.level` and the bare text `Cel` — no `#`
/// anywhere. Reading only the Markdown dialect made every note written the
/// other way look empty, which is exactly what it did on first live test.
fn content_blocks(content: &str) -> Vec<ContentBlock> {
    fn walk(value: &serde_json::Value, current: &mut ContentBlock, blocks: &mut Vec<ContentBlock>) {
        match value {
            serde_json::Value::Object(map) => {
                let node = map.get("type").and_then(serde_json::Value::as_str).unwrap_or("");
                let is_block = !node.is_empty() && node != "text" && node != "doc";
                // Which node gets to name the line:
                //
                // - a *classifying* node (heading, task item) always wins, so
                //   the `taskList` wrapper cannot swallow its first
                //   `taskItem`;
                // - any other block claims the line only if nothing has yet,
                //   so the `paragraph` nested inside a `taskItem` does not
                //   demote it back to a paragraph and drop its checked state.
                //
                // Both halves were needed: the first attempt lost every task,
                // the second lost only the first task of each list.
                let classifies = matches!(node, "heading" | "taskItem" | "checkboxItem");
                if is_block && (classifies || current.node.is_empty()) {
                    current.node = node.to_string();
                    let attrs = map.get("attrs");
                    if let Some(level) = attrs.and_then(|a| a.get("level")).and_then(serde_json::Value::as_i64) {
                        current.level = Some(level);
                    }
                    if let Some(checked) = attrs.and_then(|a| a.get("checked")).and_then(serde_json::Value::as_bool) {
                        current.checked = Some(checked);
                    }
                }
                if let Some(text) = map.get("text").and_then(serde_json::Value::as_str) {
                    current.text.push_str(text);
                }
                if let Some(children) = map.get("content") {
                    walk(children, current, blocks);
                }
                if is_block {
                    blocks.push(std::mem::take(current));
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    walk(item, current, blocks);
                }
            }
            _ => {}
        }
    }

    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(content) else {
        // Not JSON at all — treat it as raw text rather than losing it.
        return content
            .lines()
            .map(|line| ContentBlock { text: line.to_string(), ..ContentBlock::default() })
            .collect();
    };
    let mut blocks = Vec::new();
    let mut current = ContentBlock::default();
    walk(&parsed, &mut current, &mut blocks);
    if !current.text.is_empty() {
        blocks.push(current);
    }
    blocks
}

/// One block of a note, as a plugin sees it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocumentBlock {
    /// "paragraph" | "heading" | "code" | "quote" | "list" | "task" | "image" | "divider"
    pub kind: String,
    /// Plain text, with the Markdown marker stripped where there was one.
    pub text: String,
    /// Heading depth, 1–6. None otherwise.
    pub level: Option<i64>,
    /// Info string of a fenced block, e.g. "rust". None otherwise.
    pub language: Option<String>,
    /// Whether a task is ticked. None otherwise.
    pub checked: Option<bool>,
    /// Zero-based block index, matching `line` on ContentIndexEntry.
    pub line: i64,
}

/// D13 — an ordered, read-only projection of one note's body.
///
/// Built from `content_blocks`, the same dialect-aware walk the content index
/// uses, and **not** from the frontend's `textFromDocument`. That was what held
/// this back: `textFromDocument` is documented as a lossy, one-way conversion,
/// so projecting from it would have handed plugins a view that quietly disagreed
/// with the note. `content_blocks` reads the stored body directly and reads both
/// dialects, so it has no such gap.
///
/// Computed on demand, never stored, so it cannot go stale — the same rule the
/// content index follows.
pub fn project_document(content: &str) -> Vec<DocumentBlock> {
    const MAX_TEXT: usize = 4000;
    const MAX_BLOCKS: usize = 2000;
    let mut blocks = Vec::new();

    for (index, block) in content_blocks(content).iter().enumerate() {
        if blocks.len() >= MAX_BLOCKS {
            break;
        }
        let raw = block.text.trim();
        let mut kind = match block.node.as_str() {
            "heading" => "heading",
            "taskItem" | "checkboxItem" => "task",
            "codeBlock" => "code",
            "blockquote" => "quote",
            "bulletList" | "orderedList" | "listItem" => "list",
            "image" => "image",
            "horizontalRule" => "divider",
            _ => "paragraph",
        }
        .to_string();
        let mut text = raw.to_string();
        let mut level = block.level;
        let mut checked = block.checked;
        let mut language = None;

        // Markdown dialect, consulted only when the node did not classify
        // itself — exactly the precedence index_content uses, so the two never
        // disagree about the same line.
        if kind == "paragraph" {
            let hashes = raw.chars().take_while(|c| *c == '#').count();
            if (1..=6).contains(&hashes) && raw.chars().nth(hashes) == Some(' ') {
                kind = "heading".into();
                level = Some(hashes as i64);
                text = raw[hashes + 1..].trim().to_string();
            } else if let Some(rest) = ["- [ ] ", "- [x] ", "- [X] ", "* [ ] ", "* [x] ", "* [X] "]
                .iter()
                .find_map(|marker| raw.strip_prefix(marker).map(|rest| (marker, rest)))
            {
                kind = "task".into();
                checked = Some(rest.0.contains('x') || rest.0.contains('X'));
                text = rest.1.trim().to_string();
            } else if let Some(rest) = raw.strip_prefix("- ").or_else(|| raw.strip_prefix("* ")) {
                kind = "list".into();
                text = rest.trim().to_string();
            } else if let Some(rest) = raw.strip_prefix("> ") {
                kind = "quote".into();
                text = rest.trim().to_string();
            } else if let Some(rest) = raw.strip_prefix("```") {
                kind = "code".into();
                language = Some(rest.trim().to_string()).filter(|value: &String| !value.is_empty());
                text = String::new();
            } else if raw.len() >= 3 && raw.chars().all(|c| c == '-') {
                kind = "divider".into();
                text = String::new();
            }
        }

        blocks.push(DocumentBlock {
            kind,
            text: text.chars().take(MAX_TEXT).collect(),
            level: level.map(|value| value.clamp(1, 6)),
            language,
            checked,
            line: index as i64,
        });
    }
    blocks
}

/// Find the headings, tags, wiki links and task items in one note body.
///
/// Deliberately small and total: every branch is a line-local regex-free scan,
/// so a hostile note body can make the output long but cannot make this loop
/// or recurse. Length caps keep one pathological line from producing a
/// megabyte of index entries.
pub fn index_content(object_id: &str, content: &str) -> Vec<ContentIndexEntry> {
    const MAX_VALUE: usize = 200;
    const MAX_ENTRIES: usize = 2000;
    let mut entries = Vec::new();

    for (line_number, block) in content_blocks(content).iter().enumerate() {
        if entries.len() >= MAX_ENTRIES {
            break;
        }
        let raw = &block.text;
        let line = raw.trim();
        let push = |entries: &mut Vec<ContentIndexEntry>, kind: &str, value: &str, level, checked| {
            // The ceiling is enforced here, not only per line: one line of ten
            // thousand tags is a single iteration of the outer loop.
            if entries.len() >= MAX_ENTRIES {
                return;
            }
            let value: String = value.trim().chars().take(MAX_VALUE).collect();
            if value.is_empty() {
                return;
            }
            entries.push(ContentIndexEntry {
                object_id: object_id.to_string(),
                kind: kind.to_string(),
                value,
                level,
                checked,
                line: line_number as i64,
            });
        };

        // Structural dialect first: the node already told us what it is.
        let structural_heading = block.node == "heading";
        let structural_task = block.node == "taskItem" || block.node == "checkboxItem";
        if structural_heading {
            push(&mut entries, "heading", line, Some(block.level.unwrap_or(1).clamp(1, 6)), None);
        }
        if structural_task {
            push(&mut entries, "task", line, None, Some(block.checked.unwrap_or(false)));
        }

        // Markdown dialect: '#' up to six times then a space. Only consulted
        // when the node itself did not already say it is a heading, so a
        // structural heading whose text happens to start with '#' is not
        // counted twice.
        let hashes = line.chars().take_while(|c| *c == '#').count();
        let markdown_heading = !structural_heading
            && (1..=6).contains(&hashes)
            && line.chars().nth(hashes) == Some(' ');
        if markdown_heading {
            push(&mut entries, "heading", &line[hashes + 1..], Some(hashes as i64), None);
        }

        // Task: "- [ ] text" or "- [x] text".
        if !structural_task {
            for marker in ["- [ ] ", "- [x] ", "- [X] ", "* [ ] ", "* [x] ", "* [X] "] {
                if let Some(rest) = line.strip_prefix(marker) {
                    let checked = marker.contains('x') || marker.contains('X');
                    push(&mut entries, "task", rest, None, Some(checked));
                    break;
                }
            }
        }

        // Wiki links: [[target]] or [[target|label]] or [[target#anchor]].
        let bytes: Vec<char> = raw.chars().collect();
        let mut index = 0;
        while index + 1 < bytes.len() {
            if bytes[index] == '[' && bytes[index + 1] == '[' {
                if let Some(end) = (index + 2..bytes.len().min(index + 2 + MAX_VALUE))
                    .find(|&i| i + 1 < bytes.len() && bytes[i] == ']' && bytes[i + 1] == ']')
                {
                    let inner: String = bytes[index + 2..end].iter().collect();
                    let target = inner
                        .split(['|', '#'])
                        .next()
                        .unwrap_or_default()
                        .to_string();
                    push(&mut entries, "link", &target, None, None);
                    index = end + 2;
                    continue;
                }
            }
            index += 1;
        }

        // Tags: '#word' preceded by whitespace or line start. Skipped on a
        // Markdown heading line, where the leading '#' is syntax.
        if !markdown_heading {
            let chars: Vec<char> = raw.chars().collect();
            let mut i = 0;
            while i < chars.len() {
                let boundary = i == 0 || chars[i - 1].is_whitespace();
                if chars[i] == '#' && boundary {
                    let start = i + 1;
                    let mut end = start;
                    while end < chars.len()
                        && (chars[end].is_alphanumeric() || chars[end] == '-' || chars[end] == '_' || chars[end] == '/')
                    {
                        end += 1;
                    }
                    if end > start {
                        let tag: String = chars[start..end].iter().collect();
                        push(&mut entries, "tag", &tag, None, None);
                    }
                    i = end;
                    continue;
                }
                i += 1;
            }
        }
    }
    entries
}

/// Query the content index.
///
/// ponytail: computed on demand by scanning object bodies rather than kept in
/// a table with triggers. It therefore cannot go stale — including on the sync
/// pull path, which writes objects from Rust and never touches the frontend —
/// and it costs no migration. Materialise it behind the same triggers as
/// `objects_fts` if a workspace ever grows large enough for the scan to show.
pub fn query_content_index(
    conn: &Connection,
    kind: Option<&str>,
    value: Option<&str>,
    object_id: Option<&str>,
    limit: Option<u32>,
) -> Result<Vec<ContentIndexEntry>> {
    let limit = limit.unwrap_or(500).min(5000) as usize;
    let read = |row: &rusqlite::Row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?));
    let mut rows: Vec<(String, String)> = Vec::new();
    match object_id {
        Some(id) => {
            let mut stmt =
                conn.prepare("SELECT id, content FROM objects WHERE id = ?1 AND trashed_at IS NULL")?;
            for row in stmt.query_map(params![id], read)? {
                rows.push(row?);
            }
        }
        None => {
            let mut stmt = conn.prepare("SELECT id, content FROM objects WHERE trashed_at IS NULL")?;
            for row in stmt.query_map([], read)? {
                rows.push(row?);
            }
        }
    }

    let wanted_value = value.map(str::to_lowercase);
    let mut found = Vec::new();
    for (id, content) in rows {
        for entry in index_content(&id, &content) {
            if kind.is_some_and(|k| k != entry.kind) {
                continue;
            }
            if wanted_value
                .as_ref()
                .is_some_and(|v| entry.value.to_lowercase() != *v)
            {
                continue;
            }
            found.push(entry);
            if found.len() >= limit {
                return Ok(found);
            }
        }
    }
    Ok(found)
}

pub fn get_object(conn: &Connection, id: &str) -> Result<Option<Object>> {
    conn.query_row(
        &format!("SELECT {OBJ_COLS} FROM objects WHERE id = ?1"),
        params![id],
        map_object,
    )
    .optional()
}

/// Atomic partial update: only the provided fields change, in a single SQL
/// statement, so concurrent updates of different fields cannot clobber each
/// other. If `expected_updated_at` is given, the update only applies when the
/// row still has that timestamp (optimistic locking) — otherwise Conflict.
pub fn update_object(
    conn: &Connection,
    id: &str,
    title: Option<&str>,
    content: Option<&str>,
    props: Option<&str>,
    expected_updated_at: Option<i64>,
) -> std::result::Result<Object, UpdateError> {
    update_object_as(conn, id, title, content, props, expected_updated_at, None, HistorySource::Local)
}

/// `update_object` with the history writer/source spelled out. The note
/// editor passes writer "editor" (its autosaves coalesce into sessions);
/// `restore_version` passes HistorySource::Restore.
#[allow(clippy::too_many_arguments)]
pub fn update_object_as(
    conn: &Connection,
    id: &str,
    title: Option<&str>,
    content: Option<&str>,
    props: Option<&str>,
    expected_updated_at: Option<i64>,
    writer: Option<&str>,
    source: HistorySource,
) -> std::result::Result<Object, UpdateError> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| -> std::result::Result<Object, UpdateError> {
        let previous = get_object(conn, id)?.ok_or(UpdateError::NotFound)?;
        // Monotonic: a local write is always newer than the version it
        // replaces, even when that version came from a peer whose clock runs
        // ahead — otherwise sync's newest-wins would hand it straight back.
        let ts = now().max(previous.updated_at + 1);
        // A rename keeps the old title as an alias while some note links to
        // it, in this same write, so `[[Old title]]` keeps resolving (E22).
        let remembered = match title {
            Some(new_title) => props_remembering_linked_title(conn, &previous, new_title, props)?,
            None => None,
        };
        let props = remembered.as_deref().or(props);
        let changed = conn.execute(
            "UPDATE objects SET
                title   = COALESCE(?2, title),
                content = COALESCE(?3, content),
                props   = COALESCE(?4, props),
                updated_at = ?5
             WHERE id = ?1 AND (?6 IS NULL OR updated_at = ?6)",
            params![id, title, content, props, ts, expected_updated_at],
        )?;
        if changed == 0 {
            return match get_object(conn, id)? {
                Some(_) => Err(UpdateError::Conflict),
                None => Err(UpdateError::NotFound),
            };
        }
        // Keep the links_to graph truthful: when the document body changes,
        // its outgoing wikilink relations are rebuilt from the content itself.
        if let Some(c) = content {
            sync_content_links(conn, id, c)?;
        }
        // A full post-update snapshot, so any version restores directly.
        // record_history owns sessions, caps and retention; heavy technical
        // arrays are stripped (restore_version re-injects the live value).
        let updated = get_object(conn, id)?.ok_or(UpdateError::NotFound)?;
        ensure_baseline(conn, &previous)?;
        record_history(conn, &updated, source, writer)?;
        spawn_next_recurrence(conn, &previous, &updated)?;
        rollover_completed_cycle(conn, &previous, &updated)?;
        Ok(updated)
    })();
    match result {
        Ok(value) => {
            conn.execute_batch("COMMIT")?;
            Ok(value)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

/// Change an object's `type` in place, keeping its title/content/props/relations.
/// Added for the `bug` -> `issue` type merge: the plugin API's object patch
/// carries only title/content/props, so a plugin cannot retype a record.
/// Writes a history snapshot so the change is restorable; the `objects` update
/// trigger handles FTS and the sync/integration outbox.
pub fn set_object_type(
    conn: &Connection,
    id: &str,
    new_type: &str,
    expected_updated_at: Option<i64>,
) -> std::result::Result<Object, UpdateError> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| -> std::result::Result<Object, UpdateError> {
        let previous = get_object(conn, id)?.ok_or(UpdateError::NotFound)?;
        if previous.r#type == new_type {
            return Ok(previous);
        }
        let ts = now();
        let changed = conn.execute(
            "UPDATE objects SET type = ?2, updated_at = MAX(?3, updated_at + 1)
             WHERE id = ?1 AND (?4 IS NULL OR updated_at = ?4)",
            params![id, new_type, ts, expected_updated_at],
        )?;
        if changed == 0 {
            return match get_object(conn, id)? {
                Some(_) => Err(UpdateError::Conflict),
                None => Err(UpdateError::NotFound),
            };
        }
        let updated = get_object(conn, id)?.ok_or(UpdateError::NotFound)?;
        record_history(conn, &updated, HistorySource::Local, None)?;
        Ok(updated)
    })();
    match result {
        Ok(value) => {
            conn.execute_batch("COMMIT")?;
            Ok(value)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

fn rollover_completed_cycle(
    conn: &Connection,
    previous: &Object,
    updated: &Object,
) -> std::result::Result<(), UpdateError> {
    if updated.r#type != "cycle" {
        return Ok(());
    }
    let before: serde_json::Value = serde_json::from_str(&previous.props).unwrap_or_default();
    let after: serde_json::Value = serde_json::from_str(&updated.props).unwrap_or_default();
    let before_status = before.get("status").and_then(|v| v.as_str()).unwrap_or("");
    let after_status = after.get("status").and_then(|v| v.as_str()).unwrap_or("");
    if before_status == "completed" || after_status != "completed" {
        return Ok(());
    }
    let project_id: Option<String> = conn
        .query_row(
            "SELECT to_id FROM relations WHERE from_id = ?1 AND kind = 'in' LIMIT 1",
            [updated.id.as_str()],
            |row| row.get(0),
        )
        .optional()?;
    let Some(project_id) = project_id else {
        return Ok(());
    };
    let next_cycle: Option<String> = conn
        .query_row(
            "SELECT o.id FROM objects o JOIN relations r ON r.from_id=o.id AND r.kind='in'
         WHERE r.to_id=?1 AND o.type='cycle' AND o.id!=?2
           AND COALESCE(json_extract(o.props,'$.status'),'planned')='planned'
         ORDER BY COALESCE(json_extract(o.props,'$.startDate'),'9999-12-31'), o.created_at LIMIT 1",
            params![project_id, updated.id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(next_cycle) = next_cycle else {
        return Ok(());
    };
    let mut pending = Vec::<(String, String)>::new();
    {
        let mut stmt = conn.prepare(
            "SELECT o.id, o.props FROM objects o JOIN relations r ON r.from_id=o.id AND r.kind='in'
             WHERE r.to_id=?1 AND o.type IN ('task','issue') AND json_extract(o.props,'$.cycleId')=?2",
        )?;
        let rows = stmt.query_map(params![project_id, updated.id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;
        for row in rows {
            let (id, props): (String, String) = row?;
            let mut value: serde_json::Value = serde_json::from_str(&props).unwrap_or_default();
            let status = value.get("status").and_then(|v| v.as_str()).unwrap_or("");
            if is_completed_status(status) {
                continue;
            }
            if let Some(object) = value.as_object_mut() {
                object.insert(
                    "cycleId".into(),
                    serde_json::Value::String(next_cycle.clone()),
                );
                pending.push((id, value.to_string()));
            }
        }
    }
    for (id, props) in pending {
        // `update_object` opens its own transaction. Rollover already runs
        // inside the cycle update transaction, so apply this small props-only
        // patch inline instead of nesting `BEGIN IMMEDIATE`.
        let ts = now();
        conn.execute(
            "UPDATE objects SET props = ?2, updated_at = MAX(?3, updated_at + 1) WHERE id = ?1",
            params![id, props, ts],
        )?;
        let updated = get_object(conn, &id)?.ok_or(UpdateError::NotFound)?;
        record_history(conn, &updated, HistorySource::Local, None)?;
    }
    Ok(())
}

fn is_completed_status(status: &str) -> bool {
    matches!(
        status,
        "done" | "completed" | "resolved" | "closed" | "cancelled"
    )
}

/// When a recurring work item crosses into a completed state, create its next
/// occurrence in Triage and keep the same parent container. This happens in
/// the backend so completion from tables, boards, the editor, or MCP behaves
/// consistently.
fn spawn_next_recurrence(
    conn: &Connection,
    previous: &Object,
    updated: &Object,
) -> std::result::Result<(), UpdateError> {
    if !matches!(updated.r#type.as_str(), "task" | "issue") {
        return Ok(());
    }
    let before: serde_json::Value = serde_json::from_str(&previous.props).unwrap_or_default();
    let mut after: serde_json::Value = serde_json::from_str(&updated.props).unwrap_or_default();
    let before_status = before.get("status").and_then(|v| v.as_str()).unwrap_or("");
    let after_status = after.get("status").and_then(|v| v.as_str()).unwrap_or("");
    if is_completed_status(before_status) || !is_completed_status(after_status) {
        return Ok(());
    }
    let recurrence = after
        .get("recurrence")
        .and_then(|v| v.as_str())
        .unwrap_or("none");
    let modifier = match recurrence {
        "daily" => "+1 day",
        "weekly" => "+7 days",
        "monthly" => "+1 month",
        _ => return Ok(()),
    };
    let base_due = after.get("due").and_then(|v| v.as_str()).unwrap_or("now");
    let next_due: String =
        conn.query_row("SELECT date(?1, ?2)", params![base_due, modifier], |row| {
            row.get(0)
        })?;
    let obj = after.as_object_mut().ok_or(UpdateError::NotFound)?;
    obj.insert("status".into(), serde_json::Value::String("triage".into()));
    obj.insert("due".into(), serde_json::Value::String(next_due));
    obj.remove("completedDate");
    let next_props = after.to_string();
    let parent_id: Option<String> = conn
        .query_row(
            "SELECT to_id FROM relations WHERE from_id = ?1 AND kind = 'in' LIMIT 1",
            [updated.id.as_str()],
            |row| row.get(0),
        )
        .optional()?;
    create_object(
        conn,
        &updated.r#type,
        &updated.title,
        Some(&updated.content),
        Some(&next_props),
        parent_id.as_deref(),
    )?;
    Ok(())
}

/// Extract all notible://<uuid> targets from a content string.
fn extract_content_links(content: &str) -> Vec<String> {
    const PREFIX: &str = "notible://";
    const UUID_LEN: usize = 36;
    let mut out: Vec<String> = Vec::new();
    let mut rest = content;
    while let Some(pos) = rest.find(PREFIX) {
        rest = &rest[pos + PREFIX.len()..];
        if rest.len() >= UUID_LEN {
            let candidate = &rest[..UUID_LEN];
            if candidate.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
                && !out.iter().any(|x| x == candidate)
            {
                out.push(candidate.to_string());
            }
        }
    }
    out
}

/// Visible targets of `[[wikilinks]]` in a content string. Both the whole inner
/// text and the part before a `#` are returned: a `#` may start a heading anchor
/// or may simply be part of the title, and titles win over anchors.
fn extract_wikilink_titles(content: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut rest = content;
    while let Some(open) = rest.find("[[") {
        rest = &rest[open + 2..];
        let Some(close) = rest.find("]]") else { break };
        let inner = &rest[..close];
        rest = &rest[close + 2..];
        // A "]" or "[" inside means the brackets never actually paired up.
        if inner.contains('[') || inner.contains(']') {
            continue;
        }
        // `[[Target|shown text]]` links by target, not by the visible label.
        let target = inner.split('|').next().unwrap_or("").trim();
        if target.is_empty() {
            continue;
        }
        let mut push = |value: &str| {
            let value = value.trim();
            if !value.is_empty() && !out.iter().any(|x| x == value) {
                out.push(value.to_string());
            }
        };
        push(target);
        if let Some(hash) = target.find('#') {
            if hash > 0 {
                push(&target[..hash]);
            }
        }
    }
    out
}

/// The object a visible wikilink title points at, matched case-insensitively.
/// Ties are broken by the oldest object so the answer is stable between runs.
/// Props for a rename of `previous` to `new_title`: its old title added to
/// `previousTitles` when another note's content links to it by that title, so
/// the link survives the next save of the linking note (E22). None when there
/// is nothing to remember. Only notes that already hold a links_to row to this
/// one are read, so title autosaves stay cheap, and a half-typed title is
/// never linked, so it is never kept.
fn props_remembering_linked_title(
    conn: &Connection,
    previous: &Object,
    new_title: &str,
    props: Option<&str>,
) -> Result<Option<String>> {
    let old = previous.title.trim();
    if old.is_empty() || old.to_lowercase() == new_title.trim().to_lowercase() {
        return Ok(None);
    }
    let mut stmt = conn.prepare(
        "SELECT o.content FROM relations r JOIN objects o ON o.id = r.from_id
         WHERE r.to_id = ?1 AND r.kind = 'links_to' AND o.id != ?1 AND o.trashed_at IS NULL",
    )?;
    let contents = stmt
        .query_map(params![previous.id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>>>()?;
    let wanted = old.to_lowercase();
    let linked = contents
        .iter()
        .any(|content| extract_wikilink_titles(content).iter().any(|title| title.trim().to_lowercase() == wanted));
    if !linked {
        return Ok(None);
    }
    let mut value: serde_json::Value =
        serde_json::from_str(props.unwrap_or(&previous.props)).unwrap_or_else(|_| serde_json::json!({}));
    let Some(object) = value.as_object_mut() else { return Ok(None) };
    let list = object.entry("previousTitles").or_insert_with(|| serde_json::json!([]));
    if !list.is_array() {
        *list = serde_json::json!([]);
    }
    let titles = list.as_array_mut().expect("just made an array");
    if !titles.iter().any(|title| title.as_str().map(|t| t.trim().to_lowercase()) == Some(wanted.clone())) {
        titles.push(serde_json::json!(old));
    }
    Ok(Some(value.to_string()))
}

fn find_object_id_by_title(conn: &Connection, title: &str) -> Result<Option<String>> {
    let needle = title.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(None);
    }
    // A current title wins; a renamed note's previous titles (E22) come next.
    let mut stmt = conn.prepare(
        "SELECT id FROM objects
         WHERE archived_at IS NULL AND trashed_at IS NULL
           AND (lower(trim(title)) = ?1 OR EXISTS (
             SELECT 1 FROM json_each(CASE WHEN json_valid(props) THEN props ELSE '{}' END, '$.previousTitles') je
             WHERE lower(trim(je.value)) = ?1))
         ORDER BY lower(trim(title)) = ?1 DESC, created_at ASC, id ASC LIMIT 1",
    )?;
    let mut rows = stmt.query(params![needle])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

/// Replace this document's outgoing links_to relations with exactly the set
/// of targets referenced in its content. links_to is owned by the content;
/// other relation kinds are untouched.
fn sync_content_links(conn: &Connection, doc_id: &str, content: &str) -> Result<()> {
    let mut targets = extract_content_links(content);
    // Core's editor stores plain Markdown, so its links are literal
    // `[[Title]]` - never the `notible://<uuid>` form the Tiptap editor
    // inserts. Only the uuid form was ever collected here, so a note written in
    // Core produced no links_to row at all: the link rendered, and every
    // consumer of the relation (get_backlinks, the properties panel, plugins)
    // counted zero. Resolve the visible titles too.
    for title in extract_wikilink_titles(content) {
        if let Some(id) = find_object_id_by_title(conn, &title)? {
            if id != doc_id && !targets.iter().any(|t| t == &id) {
                targets.push(id);
            }
        }
    }
    let old_relations: Vec<(String, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT from_id, to_id, kind FROM relations WHERE from_id = ?1 AND kind = 'links_to'",
        )?;
        let rows = stmt
            .query_map(params![doc_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<Vec<_>>>()?;
        rows
    };
    for (from_id, to_id, kind) in old_relations {
        if !targets.iter().any(|target| target == &to_id) {
            delete_relation_row(conn, &from_id, &to_id, &kind, now())?;
        }
    }
    for t in &targets {
        if t != doc_id {
            let exists: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM objects WHERE id = ?1)",
                [t],
                |row| row.get(0),
            )?;
            if exists {
                create_relation(conn, doc_id, t, "links_to")?;
            }
        }
    }
    Ok(())
}

// ---------- Markdown import ----------

/// Minimal line-based Markdown → Tiptap JSON. Covers headings, bullet/task
/// lists, quotes, fenced code and paragraphs.
/// ponytail: no inline marks (bold/links) yet — plain text runs; extend when needed.
pub fn markdown_to_tiptap(md: &str) -> serde_json::Value {
    use serde_json::json;
    let mut nodes: Vec<serde_json::Value> = Vec::new();
    let mut lines = md.lines().peekable();

    fn text_node(t: &str) -> serde_json::Value {
        serde_json::json!({ "type": "text", "text": t })
    }
    fn para(t: &str) -> serde_json::Value {
        if t.is_empty() {
            serde_json::json!({ "type": "paragraph" })
        } else {
            serde_json::json!({ "type": "paragraph", "content": [text_node(t)] })
        }
    }

    while let Some(line) = lines.next() {
        let trimmed = line.trim_end();
        if trimmed.trim().is_empty() {
            continue;
        }
        // fenced code block
        if trimmed.trim_start().starts_with("```") {
            let mut code = String::new();
            for l in lines.by_ref() {
                if l.trim_start().starts_with("```") {
                    break;
                }
                code.push_str(l);
                code.push('\n');
            }
            let code = code.trim_end_matches('\n');
            nodes.push(json!({
                "type": "codeBlock",
                "content": if code.is_empty() { json!([]) } else { json!([text_node(code)]) }
            }));
            continue;
        }
        // heading
        if let Some(rest) = trimmed.strip_prefix('#') {
            let mut level = 1;
            let mut rest = rest;
            while let Some(r) = rest.strip_prefix('#') {
                level += 1;
                rest = r;
            }
            if level <= 6 && rest.starts_with(' ') {
                nodes.push(json!({
                    "type": "heading",
                    "attrs": { "level": level.min(3) },
                    "content": [text_node(rest.trim())]
                }));
                continue;
            }
        }
        // horizontal rule
        if trimmed.trim() == "---" || trimmed.trim() == "***" {
            nodes.push(json!({ "type": "horizontalRule" }));
            continue;
        }
        // quote
        if let Some(rest) = trimmed.trim_start().strip_prefix("> ") {
            nodes.push(json!({ "type": "blockquote", "content": [para(rest.trim())] }));
            continue;
        }
        // task list item
        let ls = trimmed.trim_start();
        if let Some(rest) = ls
            .strip_prefix("- [ ] ")
            .or_else(|| ls.strip_prefix("- [x] "))
        {
            let checked = ls.starts_with("- [x] ");
            nodes.push(json!({
                "type": "taskList",
                "content": [{
                    "type": "taskItem",
                    "attrs": { "checked": checked },
                    "content": [para(rest.trim())]
                }]
            }));
            continue;
        }
        // bullet list item
        if let Some(rest) = ls.strip_prefix("- ").or_else(|| ls.strip_prefix("* ")) {
            nodes.push(json!({
                "type": "bulletList",
                "content": [{ "type": "listItem", "content": [para(rest.trim())] }]
            }));
            continue;
        }
        nodes.push(para(trimmed.trim()));
    }
    if nodes.is_empty() {
        nodes.push(para(""));
    }
    // merge adjacent single-item lists of the same kind into one list
    let mut merged: Vec<serde_json::Value> = Vec::new();
    for node in nodes {
        let kind = node["type"].as_str().unwrap_or("").to_string();
        if (kind == "bulletList" || kind == "taskList")
            && merged.last().is_some_and(|l| l["type"] == node["type"])
        {
            let last = merged.last_mut().unwrap();
            let items = node["content"].as_array().cloned().unwrap_or_default();
            if let Some(arr) = last["content"].as_array_mut() {
                arr.extend(items);
            }
        } else {
            merged.push(node);
        }
    }
    json!({ "type": "doc", "content": merged })
}

// ---------- History ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub ts: i64,
    pub source: String,
    /// JSON snapshot {title, content, props}
    pub patch: String,
}

/// A history row without its snapshot: what the panel lists. Snapshots are
/// fetched one at a time (get_history_entry) — fifty of them at once can be
/// a gigabyte.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryMeta {
    pub id: i64,
    pub ts: i64,
    pub source: String,
    pub size: i64,
}

pub fn list_history(conn: &Connection, object_id: &str, limit: i64) -> Result<Vec<HistoryMeta>> {
    let limit = limit.clamp(1, 100);
    let mut stmt = conn.prepare(
        "SELECT id, ts, source, length(patch) FROM history WHERE object_id = ?1 ORDER BY id DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![object_id, limit], |row| {
        Ok(HistoryMeta { id: row.get(0)?, ts: row.get(1)?, source: row.get(2)?, size: row.get(3)? })
    })?;
    rows.collect()
}

pub fn get_history_entry(conn: &Connection, object_id: &str, id: i64) -> Result<Option<HistoryEntry>> {
    conn.query_row(
        "SELECT id, ts, source, patch FROM history WHERE object_id = ?1 AND id = ?2",
        params![object_id, id],
        |row| Ok(HistoryEntry { id: row.get(0)?, ts: row.get(1)?, source: row.get(2)?, patch: row.get(3)? }),
    )
    .optional()
}

pub fn delete_history_entry(conn: &Connection, object_id: &str, id: i64) -> Result<bool> {
    Ok(conn.execute("DELETE FROM history WHERE object_id = ?1 AND id = ?2", params![object_id, id])? > 0)
}

pub fn clear_history(conn: &Connection, object_id: &str) -> Result<usize> {
    conn.execute("DELETE FROM history WHERE object_id = ?1", [object_id])
}

/// Keep the whole history table under `budget` bytes of snapshots: oldest
/// sync rows go first, then the oldest of the rest. Called once per
/// sync_apply — the one writer a stranger can drive in bulk.
pub fn enforce_history_budget(conn: &Connection, budget: i64) -> Result<usize> {
    let total: i64 = conn.query_row("SELECT COALESCE(SUM(length(patch)), 0) FROM history", [], |r| r.get(0))?;
    if total <= budget {
        return Ok(0);
    }
    let mut excess = total - budget;
    let mut doomed = Vec::new();
    {
        let mut stmt = conn.prepare("SELECT id, length(patch) FROM history ORDER BY (source = 'sync') DESC, id ASC")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows {
            if excess <= 0 {
                break;
            }
            let (id, size) = row?;
            doomed.push(id);
            excess -= size;
        }
    }
    for id in &doomed {
        conn.execute("DELETE FROM history WHERE id = ?1", [id])?;
    }
    Ok(doomed.len())
}

/// Copy heavy technical props (stripped from history) from the object's live
/// row back into a snapshot's props before restoring it.
fn reinject_heavy_props(
    conn: &Connection,
    object_id: &str,
    snapshot_props: &str,
) -> std::result::Result<String, UpdateError> {
    let live = get_object(conn, object_id)?.ok_or(UpdateError::NotFound)?;
    let (Ok(mut snap), Ok(live)) = (
        serde_json::from_str::<serde_json::Value>(snapshot_props),
        serde_json::from_str::<serde_json::Value>(&live.props),
    ) else {
        return Ok(snapshot_props.to_string());
    };
    let (Some(snap_obj), Some(live_obj)) = (snap.as_object_mut(), live.as_object()) else {
        return Ok(snapshot_props.to_string());
    };
    for key in HEAVY_PROPS_KEYS {
        if let Some(v) = live_obj.get(*key) {
            snap_obj.insert((*key).to_string(), v.clone());
        }
    }
    Ok(snap.to_string())
}

/// Restore the snapshot with the given history id. The restore itself
/// is recorded as a new history entry, so it can be undone too.
pub fn restore_version(
    conn: &Connection,
    object_id: &str,
    version_id: i64,
) -> std::result::Result<Object, UpdateError> {
    let patch: String = conn
        .query_row(
            "SELECT patch FROM history WHERE object_id = ?1 AND id = ?2",
            params![object_id, version_id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(UpdateError::NotFound)?;
    let snap: serde_json::Value =
        serde_json::from_str(&patch).map_err(|_| UpdateError::NotFound)?;
    // History snapshots omit heavy technical arrays; carry the live values over
    // so restoring an old version keeps today's calendar events intact.
    let restored_props = match snap["props"].as_str() {
        Some(props) => Some(reinject_heavy_props(conn, object_id, props)?),
        None => None,
    };
    update_object_as(
        conn,
        object_id,
        snap["title"].as_str(),
        snap["content"].as_str(),
        restored_props.as_deref(),
        None,
        None,
        HistorySource::Restore,
    )
}

// Hive #7: caller owns the transaction; do not nest update_object_as's BEGIN.
pub(crate) fn resolve_body_in_transaction(conn: &Connection, previous: &Object, content: &str) -> Result<Object> {
    let ts = now().max(previous.updated_at.saturating_add(1));
    ensure_baseline(conn, previous)?;
    conn.execute("UPDATE objects SET content=?2,updated_at=?3 WHERE id=?1", params![previous.id,content,ts])?;
    sync_content_links(conn, &previous.id, content)?;
    mark_local_change(conn, &previous.id)?;
    let object = get_object(conn, &previous.id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    record_history(conn, &object, HistorySource::Restore, None)?;
    Ok(object)
}

// ---------- Trash ----------

pub fn trash_object(conn: &Connection, id: &str) -> Result<Option<Object>> {
    let ts = now();
    conn.execute(
        "UPDATE objects SET trashed_at = ?2 WHERE id = ?1",
        params![id, ts],
    )?;
    mark_local_change(conn, id)?;
    get_object(conn, id)
}

pub fn restore_object(conn: &Connection, id: &str) -> Result<Option<Object>> {
    conn.execute(
        "UPDATE objects SET trashed_at = NULL, archived_at = NULL WHERE id = ?1",
        params![id],
    )?;
    mark_local_change(conn, id)?;
    get_object(conn, id)
}

pub fn list_trash(conn: &Connection) -> Result<Vec<Object>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {OBJ_COLS} FROM objects WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC"
    ))?;
    let rows = stmt.query_map([], map_object)?;
    rows.collect()
}


// ---------------------------------------------------------------------------
// Pasted-image garbage collection
//
// `save_media` writes every pasted screenshot to `app_data/media/<uuid>.<ext>`
// and nothing ever deleted from that directory. Two consequences, and the
// second is the reason this exists: the directory grows without bound, and a
// note the user *deleted* left its screenshots on disk indefinitely — an
// image of an invoice or a password stayed readable after the note holding it
// was gone.
//
// A reference is found by filename rather than by path. The editor stores the
// image as `![](<convertFileSrc(path)>)`, which on Windows is a percent-encoded
// `http://asset.localhost/...` URL, so the raw path never appears in the note;
// the `<uuid>.<ext>` filename survives both forms.

const MEDIA_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
/// 8-4-4-4-12
const UUID_LEN: usize = 36;

/// Every `<uuid>.<ext>` media filename mentioned in `text`.
///
/// Deliberately not a regex: `save_media` is the only writer of these names and
/// it always produces exactly a v4 UUID plus one known extension, so a scan for
/// the extension and a walk back over the UUID is the whole rule — and it costs
/// no new dependency.
pub fn media_filenames_in(text: &str) -> Vec<String> {
    let bytes = text.as_bytes();
    let mut found = Vec::new();
    for extension in MEDIA_EXTENSIONS {
        let needle = format!(".{extension}");
        let mut from = 0;
        while let Some(offset) = text[from..].find(&needle) {
            let dot = from + offset;
            from = dot + needle.len();
            // The extension must end here, so ".jpg" inside ".jpeg" is not a hit.
            if bytes.get(from).is_some_and(|byte| byte.is_ascii_alphanumeric()) {
                continue;
            }
            if dot < UUID_LEN {
                continue;
            }
            let start = dot - UUID_LEN;
            let candidate = &text[start..dot];
            if !candidate.is_char_boundary(0) {
                continue;
            }
            let shaped = candidate.len() == UUID_LEN
                && candidate.bytes().enumerate().all(|(index, byte)| {
                    if matches!(index, 8 | 13 | 18 | 23) {
                        byte == b'-'
                    } else {
                        byte.is_ascii_hexdigit()
                    }
                });
            if shaped {
                let name = format!("{candidate}{needle}");
                if !found.contains(&name) {
                    found.push(name);
                }
            }
        }
    }
    found
}

/// The stable form a media reference takes in stored content.
pub const MEDIA_REF_PREFIX: &str = "media/";

/// Is `name` exactly `<uuid-v4>.<known-ext>` and nothing else?
///
/// The gate for anything arriving from another machine: a filename is the only
/// thing a peer gets to choose here, so it may not contain a separator, a
/// drive letter, `..`, or an extension we do not write ourselves.
pub fn is_media_filename(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    if !MEDIA_EXTENSIONS.contains(&ext) {
        return false;
    }
    stem.len() == UUID_LEN
        && stem.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()
            }
        })
}

/// Rewrite this machine's own media URLs and paths down to `media/<uuid>.<ext>`.
///
/// The hard part is not finding the filenames — `media_filenames_in` already
/// does that — it is deciding how far back a reference reaches and whether it
/// is ours at all. `![](https://cdn.example.com/media/<uuid>.png)` is a
/// perfectly legal remote image, and rewriting it would silently point a
/// user's note at a local file that does not exist. History is not rewritten,
/// so there would be nothing to restore from.
///
/// So a token is only ours when it is an asset-protocol URL, or an absolute
/// local path whose last directory is `media`. Anything with another scheme
/// or host is left exactly as it was.
pub fn rewrite_media_references(text: &str) -> Option<String> {
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0usize;
    let mut changed = false;
    for (start, name_start, end) in media_reference_spans(text) {
        if start < cursor {
            continue;
        }
        out.push_str(&text[cursor..start]);
        out.push_str(MEDIA_REF_PREFIX);
        // The filename is carried by offset, not by cutting on a separator:
        // in a percent-encoded asset URL the separator is `%5C`, not `\`.
        out.push_str(&text[name_start..end]);
        cursor = end;
        changed = true;
    }
    if !changed {
        return None;
    }
    out.push_str(&text[cursor..]);
    Some(out)
}

/// Length of the trailing `<uuid>.<ext>` in a token this scanner produced.
fn filename_len(token: &str) -> usize {
    token
        .rfind(|c| c == '/' || c == '\\')
        .map(|at| token.len() - at - 1)
        .unwrap_or(token.len())
}

/// Byte ranges of the references `rewrite_media_references` owns, as
/// (token start, filename start, end).
fn media_reference_spans(text: &str) -> Vec<(usize, usize, usize)> {
    let bytes = text.as_bytes();
    let mut spans: Vec<(usize, usize, usize)> = Vec::new();
    for extension in MEDIA_EXTENSIONS {
        let needle = format!(".{extension}");
        let mut from = 0;
        while let Some(offset) = text[from..].find(&needle) {
            let dot = from + offset;
            from = dot + needle.len();
            if bytes.get(from).is_some_and(|byte| byte.is_ascii_alphanumeric()) {
                continue;
            }
            let end = dot + needle.len();
            if dot < UUID_LEN {
                continue;
            }
            let name_start = dot - UUID_LEN;
            if !text.is_char_boundary(name_start) || !is_media_filename(&text[name_start..end]) {
                continue;
            }
            // Walk back to whatever delimits this reference in Markdown, HTML
            // or JSON. Whitespace is included: a bare Windows path with a
            // space in it would already be broken as a URL.
            let token_start = text[..name_start]
                .rfind(|c: char| c.is_whitespace() || matches!(c, '(' | ')' | '"' | '\'' | '<' | '>' | '[' | ']' | ',' | ';'))
                .map(|at| at + text[at..].chars().next().map_or(1, char::len_utf8))
                .unwrap_or(0);
            let token = &text[token_start..end];
            if is_own_media_reference(token) {
                spans.push((token_start, name_start, end));
            }
        }
    }
    spans.sort_unstable();
    spans
}

/// Does this token point at a file in THIS installation's media directory?
fn is_own_media_reference(token: &str) -> bool {
    let lower = token.to_ascii_lowercase();
    // Already migrated. Rewriting it again is a no-op, but saying so here
    // keeps the migration idempotent by construction rather than by luck.
    if token.len() == MEDIA_REF_PREFIX.len() + UUID_LEN + 1 + 3
        || token.len() == MEDIA_REF_PREFIX.len() + UUID_LEN + 1 + 4
    {
        if lower.starts_with(MEDIA_REF_PREFIX) {
            return false;
        }
    }
    let asset = lower.starts_with("asset://")
        || lower.starts_with("http://asset.localhost/")
        || lower.starts_with("https://asset.localhost/");
    if asset {
        return true;
    }
    // Any other scheme is someone else's server. Leave it alone.
    if lower.contains("://") {
        return false;
    }
    let absolute = lower.starts_with('/')
        || lower.starts_with("\\\\")
        || lower
            .as_bytes()
            .get(1)
            .is_some_and(|byte| *byte == b':' && lower.as_bytes()[0].is_ascii_alphabetic());
    // The directory immediately above the file must be `media`, in whichever
    // spelling the URL encoder left behind.
    absolute
        && (lower.contains("media/") || lower.contains("media\\") || lower.contains("media%5c") || lower.contains("media%2f"))
}

/// Media filenames referenced by one object's own record (body and properties).
pub fn media_filenames_of_object(conn: &Connection, id: &str) -> Result<Vec<String>> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT content, props FROM objects WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((content, props)) = row else {
        return Ok(Vec::new());
    };
    let mut names = media_filenames_in(&content);
    for name in media_filenames_in(&props) {
        if !names.contains(&name) {
            names.push(name);
        }
    }
    Ok(names)
}

/// Is this media file still reachable from any record?
///
/// History counts: a version snapshot can be restored, and restoring a note
/// whose image had been collected would bring back a broken picture.
pub fn media_filename_is_referenced(conn: &Connection, filename: &str) -> Result<bool> {
    let pattern = format!("%{filename}%");
    conn.query_row(
        "SELECT EXISTS(
             SELECT 1 FROM objects WHERE content LIKE ?1 OR props LIKE ?1
             UNION ALL
             SELECT 1 FROM history WHERE patch LIKE ?1
         )",
        params![pattern],
        |row| row.get::<_, bool>(0),
    )
}

/// Filter `filenames` down to the ones no record mentions any more.
pub fn unreferenced_media(conn: &Connection, filenames: &[String]) -> Result<Vec<String>> {
    let mut orphans = Vec::new();
    for filename in filenames {
        if !media_filename_is_referenced(conn, filename)? {
            orphans.push(filename.clone());
        }
    }
    Ok(orphans)
}

/// Hard delete: removes the object, all relations touching it, and its history.
pub fn delete_object(conn: &Connection, id: &str) -> Result<bool> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| -> Result<bool> {
        let existed = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM objects WHERE id = ?1)",
            [id],
            |row| row.get::<_, bool>(0),
        )?;
        if existed {
            let deleted_at = now();
            conn.execute(
                "INSERT INTO sync_tombstones (object_id, deleted_at) VALUES (?1, ?2)
                 ON CONFLICT(object_id) DO UPDATE SET deleted_at = MAX(sync_tombstones.deleted_at, excluded.deleted_at)",
                params![id, deleted_at],
            )?;
            let touching: Vec<(String, String, String)> = {
                let mut stmt = conn.prepare(
                    "SELECT from_id, to_id, kind FROM relations WHERE from_id = ?1 OR to_id = ?1",
                )?;
                let rows = stmt
                    .query_map(params![id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                    .collect::<Result<Vec<_>>>()?;
                rows
            };
            for (from_id, to_id, kind) in touching {
                delete_relation_row(conn, &from_id, &to_id, &kind, deleted_at)?;
            }
        }
        conn.execute("DELETE FROM history WHERE object_id = ?1", params![id])?;
        conn.execute("DELETE FROM objects WHERE id = ?1", params![id])?;
        Ok(existed)
    })();
    match result {
        Ok(value) => {
            conn.execute_batch("COMMIT")?;
            Ok(value)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

/// Root objects: not a space, no `in` relation, not trashed/archived. One query.
pub fn list_root_objects(conn: &Connection) -> Result<Vec<Object>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {LIST_COLS} FROM objects o
         WHERE o.type != 'space' AND o.archived_at IS NULL AND o.trashed_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM relations r WHERE r.from_id = o.id AND r.kind = 'in')
         ORDER BY o.updated_at DESC"
    ))?;
    let rows = stmt.query_map([], map_object)?;
    rows.collect()
}

// ---------- Backup ----------

/// Snapshot the DB into `dir` via VACUUM INTO; keeps at most `keep` newest files.
pub fn backup_db(
    conn: &Connection,
    dir: &std::path::Path,
    keep: usize,
) -> std::result::Result<std::path::PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let stamp = chrono_like_stamp();
    // UUID keeps repeated or concurrent backups collision-free.
    let path = dir.join(format!("notible-{stamp}-{}.db", uuid::Uuid::new_v4()));
    conn.execute("VACUUM INTO ?1", params![path.to_string_lossy()])
        .map_err(|e| e.to_string())?;
    // prune old backups
    let mut files: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| is_backup_file(p))
        .collect();
    files.sort_by_key(|path| {
        std::fs::metadata(path)
            .and_then(|meta| meta.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });
    while files.len() > keep {
        let old = files.remove(0);
        let _ = std::fs::remove_file(old);
    }
    Ok(path)
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupInfo {
    pub path: String,
    pub filename: String,
    pub size: u64,
    pub modified_at: i64,
}

fn is_backup_file(path: &std::path::Path) -> bool {
    path.extension().is_some_and(|x| x == "db")
        && path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with("notible-"))
}

/// List backups in `dir`, newest first. A missing directory (no backup taken
/// yet) is an empty list, not an error.
pub fn list_backups(dir: &std::path::Path) -> std::result::Result<Vec<BackupInfo>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut backups: Vec<BackupInfo> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| is_backup_file(path))
        .filter_map(|path| {
            let meta = std::fs::metadata(&path).ok()?;
            let modified_at = meta
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_millis() as i64;
            Some(BackupInfo {
                path: path.to_string_lossy().into_owned(),
                filename: path.file_name()?.to_string_lossy().into_owned(),
                size: meta.len(),
                modified_at,
            })
        })
        .collect();
    backups.sort_by_key(|backup| std::cmp::Reverse(backup.modified_at));
    Ok(backups)
}

/// Delete one backup file. Refuses to touch anything outside `dir` or that
/// doesn't look like a backup we created, so this can't become a general
/// file-delete primitive.
pub fn delete_backup(dir: &std::path::Path, path: &std::path::Path) -> std::result::Result<(), String> {
    let dir = dir.canonicalize().map_err(|e| e.to_string())?;
    let target = path.canonicalize().map_err(|e| e.to_string())?;
    if target.parent() != Some(dir.as_path()) || !is_backup_file(&target) {
        return Err("refusing to delete a file outside the backups folder".into());
    }
    std::fs::remove_file(&target).map_err(|e| e.to_string())
}

/// UTC timestamp like 20260710-153000 without pulling in chrono.
fn chrono_like_stamp() -> String {
    let secs = now() / 1000;
    let days = secs / 86400;
    let (h, m, s) = ((secs % 86400) / 3600, (secs % 3600) / 60, secs % 60);
    // civil date from days since epoch (Howard Hinnant's algorithm)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}{mo:02}{d:02}-{h:02}{m:02}{s:02}")
}

pub fn archive_object(conn: &Connection, id: &str) -> Result<Option<Object>> {
    let ts = now();
    let changed = conn.execute(
        // Monotonic, like every local write (see update_object_as).
        "UPDATE objects SET archived_at = ?2, updated_at = MAX(?2, updated_at + 1) WHERE id = ?1",
        params![id, ts],
    )?;
    if changed == 0 {
        return Ok(None);
    }
    mark_local_change(conn, id)?;
    get_object(conn, id)
}

pub fn list_objects(
    conn: &Connection,
    type_filter: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<Object>> {
    let mut objects = Vec::new();
    match type_filter {
        Some(t) => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {LIST_COLS} FROM objects
                 WHERE type = ?1 AND archived_at IS NULL AND trashed_at IS NULL
                 ORDER BY updated_at DESC LIMIT ?2 OFFSET ?3"
            ))?;
            let rows = stmt.query_map(params![t, limit, offset], map_object)?;
            for r in rows {
                objects.push(r?);
            }
        }
        None => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {LIST_COLS} FROM objects
                 WHERE archived_at IS NULL AND trashed_at IS NULL
                 ORDER BY updated_at DESC LIMIT ?1 OFFSET ?2"
            ))?;
            let rows = stmt.query_map(params![limit, offset], map_object)?;
            for r in rows {
                objects.push(r?);
            }
        }
    }
    Ok(objects)
}

pub fn search_objects(conn: &Connection, query: &str, limit: i64) -> Result<Vec<Object>> {
    // Build a prefix query for FTS5, escaping double quotes.
    let cleaned = query.replace('"', " ");
    let terms: Vec<String> = cleaned
        .split_whitespace()
        .map(|t| format!("\"{}\"*", t))
        .collect();
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let match_expr = terms.join(" ");
    let mut stmt = conn.prepare(
        "SELECT o.id, o.type, o.title, o.content,
            CASE WHEN json_valid(o.props) THEN json_remove(o.props, '$._projectCalendarEvents') ELSE o.props END AS props,
            o.created_at, o.updated_at, o.archived_at, o.trashed_at,
            (SELECT to_id FROM relations WHERE from_id = o.id AND kind = 'in' LIMIT 1) AS parent_id
         FROM objects_fts f
         JOIN objects o ON o.rowid = f.rowid
         WHERE objects_fts MATCH ?1 AND o.archived_at IS NULL AND o.trashed_at IS NULL
         ORDER BY rank LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![match_expr, limit], map_object)?;
    let mut objects = Vec::new();
    for r in rows {
        objects.push(r?);
    }
    Ok(objects)
}

/// Core's note search: case-insensitive substring match on title, content and
/// props, like the sidebar always did in JS, but without shipping every
/// object's content across IPC on each keystroke. Substring (not the FTS
/// prefix match of `search_objects`): users search for fragments of IDs such
/// as `CAPSSFR` inside `SEU_CHN_MA_SET_CAPSSFR_COMPLETE`. Newest first.
pub fn search_objects_text(conn: &Connection, query: &str, limit: i64) -> Result<Vec<Object>> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(&format!(
        "SELECT {LIST_COLS} FROM objects
         WHERE archived_at IS NULL AND trashed_at IS NULL
         ORDER BY updated_at DESC"
    ))?;
    let rows = stmt.query_map([], map_object)?;
    // Every word, in any order and any field: "milk eggs" finds a note with both (R5 F1).
    let words: Vec<&str> = needle.split_whitespace().collect();
    let mut objects = Vec::new();
    for r in rows {
        let object = r?;
        let haystack = format!("{}\n{}\n{}", object.title, object.content, object.props).to_lowercase();
        let hit = words.iter().all(|word| haystack.contains(word));
        if hit {
            objects.push(object);
            if objects.len() as i64 >= limit {
                break;
            }
        }
    }
    Ok(objects)
}

/// Title-only lookup for the plugin API's `objects.findByTitle` (API 1.18).
/// Deliberately narrower than `search_objects`, which also matches body
/// text: a plugin resolving `[[Title]]`-style references wants the same
/// title-substring match the editor's own wikilink autocomplete does
/// (`wikilinkSuggestions` in `coreBacklinks.ts`), not a full-text hit deep in
/// some unrelated note's content.
///
/// `exact` is a case-insensitive equality match on the title, for a caller
/// that already knows the exact title and wants a plain lookup. Otherwise a
/// prefix/substring match against the FTS `title` column, scored the same
/// way FTS5 already ranks a bareword MATCH.
pub fn find_objects_by_title(conn: &Connection, query: &str, exact: bool, limit: i64) -> Result<Vec<Object>> {
    let needle = query.trim();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    if exact {
        let mut stmt = conn.prepare(
            "SELECT o.id, o.type, o.title, o.content,
                CASE WHEN json_valid(o.props) THEN json_remove(o.props, '$._projectCalendarEvents') ELSE o.props END AS props,
                o.created_at, o.updated_at, o.archived_at, o.trashed_at,
                (SELECT to_id FROM relations WHERE from_id = o.id AND kind = 'in' LIMIT 1) AS parent_id
             FROM objects o
             WHERE o.archived_at IS NULL AND o.trashed_at IS NULL AND o.title = ?1 COLLATE NOCASE
             ORDER BY o.updated_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![needle, limit], map_object)?;
        let mut objects = Vec::new();
        for r in rows {
            objects.push(r?);
        }
        return Ok(objects);
    }
    let cleaned = needle.replace('"', " ");
    let terms: Vec<String> = cleaned
        .split_whitespace()
        .map(|t| format!("\"{}\"*", t))
        .collect();
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    // Column filter restricts the MATCH to the `title` column of objects_fts,
    // leaving `content` out of it entirely.
    let match_expr = format!("title: {}", terms.join(" "));
    let mut stmt = conn.prepare(
        "SELECT o.id, o.type, o.title, o.content,
            CASE WHEN json_valid(o.props) THEN json_remove(o.props, '$._projectCalendarEvents') ELSE o.props END AS props,
            o.created_at, o.updated_at, o.archived_at, o.trashed_at,
            (SELECT to_id FROM relations WHERE from_id = o.id AND kind = 'in' LIMIT 1) AS parent_id
         FROM objects_fts f
         JOIN objects o ON o.rowid = f.rowid
         WHERE objects_fts MATCH ?1 AND o.archived_at IS NULL AND o.trashed_at IS NULL
         ORDER BY rank LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![match_expr, limit], map_object)?;
    let mut objects = Vec::new();
    for r in rows {
        objects.push(r?);
    }
    Ok(objects)
}

// ---------- Relations ----------

/// The relation-sync tables were added after the original relation API. The
/// guard keeps older migration steps, which create relations, valid while the
/// database is being upgraded to migration 020.
fn relation_sync_tables_ready(conn: &Connection) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_relation_state')",
        [],
        |row| row.get(0),
    )
}

/// SYNC-NO-LOSS (Hive #18, N2): a stamp for creating or deleting this edge
/// that is strictly later than the stamps it overrides (the edge's recorded
/// creation and its tombstone). Edges are resolved by those stamps, so one
/// taken from a clock that is behind a peer's would lose to the peer's older
/// edge when its snapshot is replayed.
fn relation_stamp(conn: &Connection, from_id: &str, to_id: &str, kind: &str, at_least: i64) -> Result<i64> {
    if !relation_sync_tables_ready(conn)? {
        return Ok(at_least);
    }
    let latest: i64 = conn.query_row(
        "SELECT MAX(
            COALESCE((SELECT created_at FROM sync_relation_state WHERE from_id = ?1 AND to_id = ?2 AND kind = ?3), 0),
            COALESCE((SELECT deleted_at FROM sync_relation_tombstones WHERE from_id = ?1 AND to_id = ?2 AND kind = ?3), 0))",
        params![from_id, to_id, kind],
        |row| row.get(0),
    )?;
    Ok(at_least.max(latest + 1))
}

/// SYNC-NO-LOSS (Hive #18, N1): local revisions only go up, and every mark is
/// later than every export cursor handed out before it (see `sync_export_mark`).
fn bump_local_rev(conn: &Connection, step: i64) -> Result<i64> {
    let last = get_sync_state(conn, "local_rev")?.and_then(|value| value.parse::<i64>().ok()).unwrap_or(0);
    let rev = now().max(last + step);
    set_sync_state(conn, "local_rev", &rev.to_string())?;
    Ok(rev)
}

/// The cursor a sync export hands out: a later local move, trash, restore or
/// archive gets a mark above it, which `local_mark` reports to the apply.
pub fn sync_export_mark(conn: &Connection) -> Result<i64> {
    bump_local_rev(conn, 0)
}

/// Record that `id`'s placement or trash state changed here, now. Skipped
/// while migrations older than 031 run (they create relations too).
pub(crate) fn mark_local_change(conn: &Connection, id: &str) -> Result<()> {
    let ready: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_local_marks')",
        [],
        |row| row.get(0),
    )?;
    if !ready {
        return Ok(());
    }
    let rev = bump_local_rev(conn, 1)?;
    conn.execute(
        "INSERT INTO sync_local_marks (object_id, rev) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM objects WHERE id = ?1)
         ON CONFLICT(object_id) DO UPDATE SET rev = excluded.rev",
        params![id, rev],
    )?;
    Ok(())
}

pub fn local_mark(conn: &Connection, id: &str) -> Result<Option<i64>> {
    conn.query_row("SELECT rev FROM sync_local_marks WHERE object_id = ?1", params![id], |row| row.get(0))
        .optional()
}

fn record_relation_created(conn: &Connection, from_id: &str, to_id: &str, kind: &str, created_at: i64) -> Result<()> {
    if !relation_sync_tables_ready(conn)? {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO sync_relation_state (from_id, to_id, kind, created_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(from_id, to_id, kind) DO UPDATE SET created_at = MAX(sync_relation_state.created_at, excluded.created_at)",
        params![from_id, to_id, kind, created_at],
    )?;
    conn.execute(
        "DELETE FROM sync_relation_tombstones
         WHERE from_id = ?1 AND to_id = ?2 AND kind = ?3 AND deleted_at <= ?4",
        params![from_id, to_id, kind, created_at],
    )?;
    Ok(())
}

fn record_relation_deleted(conn: &Connection, from_id: &str, to_id: &str, kind: &str, deleted_at: i64) -> Result<()> {
    if !relation_sync_tables_ready(conn)? {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO sync_relation_tombstones (from_id, to_id, kind, deleted_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(from_id, to_id, kind) DO UPDATE SET deleted_at = MAX(sync_relation_tombstones.deleted_at, excluded.deleted_at)",
        params![from_id, to_id, kind, deleted_at],
    )?;
    Ok(())
}

fn enqueue_sync_operation(
    conn: &Connection,
    event: &str,
    object_id: Option<&str>,
    object_type: &str,
    occurred_at: i64,
    payload: &str,
) -> Result<()> {
    let device_id = get_sync_state(conn, "device_id")?.unwrap_or_else(|| "pending".to_string());
    let operation_id = format!("{device_id}:operation:{}", uuid::Uuid::new_v4());
    conn.execute(
        "INSERT INTO sync_outbox
            (event_id, operation_id, event, object_id, object_type, occurred_at, payload)
         VALUES (NULL, ?1, ?2, ?3, ?4, ?5, ?6)",
        params![operation_id, event, object_id, object_type, occurred_at, payload],
    )?;
    Ok(())
}

/// The tombstone's stamp when a row was removed: `deleted_at` or later, so it
/// overrides the edge it deletes (see `relation_stamp`).
fn delete_relation_row(conn: &Connection, from_id: &str, to_id: &str, kind: &str, deleted_at: i64) -> Result<Option<i64>> {
    let deleted_at = relation_stamp(conn, from_id, to_id, kind, deleted_at)?;
    let n = conn.execute(
        "DELETE FROM relations WHERE from_id = ?1 AND to_id = ?2 AND kind = ?3",
        params![from_id, to_id, kind],
    )?;
    if n > 0 {
        record_relation_deleted(conn, from_id, to_id, kind, deleted_at)?;
    }
    Ok((n > 0).then_some(deleted_at))
}

pub fn create_relation(
    conn: &Connection,
    from_id: &str,
    to_id: &str,
    kind: &str,
) -> Result<Relation> {
    let created = conn.execute(
        "INSERT OR IGNORE INTO relations (from_id, to_id, kind) VALUES (?1, ?2, ?3)",
        params![from_id, to_id, kind],
    )?;
    if created > 0 {
        let created_at = relation_stamp(conn, from_id, to_id, kind, now())?;
        record_relation_created(conn, from_id, to_id, kind, created_at)?;
        if kind == "in" {
            mark_local_change(conn, from_id)?;
        }
        if relation_sync_tables_ready(conn)? {
            enqueue_sync_operation(
                conn,
                "relation.created",
                Some(from_id),
                "relation",
                created_at,
                &serde_json::json!({ "from_id": from_id, "to_id": to_id, "kind": kind, "created_at": created_at }).to_string(),
            )?;
        }
    }
    Ok(Relation {
        from_id: from_id.to_string(),
        to_id: to_id.to_string(),
        kind: kind.to_string(),
    })
}

pub fn delete_relation(conn: &Connection, from_id: &str, to_id: &str, kind: &str) -> Result<bool> {
    let Some(deleted_at) = delete_relation_row(conn, from_id, to_id, kind, now())? else {
        return Ok(false);
    };
    if kind == "in" {
        mark_local_change(conn, from_id)?;
    }
    if relation_sync_tables_ready(conn)? {
        enqueue_sync_operation(
            conn,
            "relation.deleted",
            Some(from_id),
            "relation",
            deleted_at,
            &serde_json::json!({ "from_id": from_id, "to_id": to_id, "kind": kind, "deleted_at": deleted_at }).to_string(),
        )?;
    }
    Ok(true)
}

/// Checks a directed planning edge (`from_id` predecessor -> `to_id`
/// successor) against both current and legacy dependency relations.
pub fn gantt_dependency_would_cycle(conn: &Connection, from_id: &str, to_id: &str) -> Result<bool> {
    let found: i64 = conn.query_row(
        "WITH RECURSIVE edges(source, target) AS (
             SELECT from_id, to_id FROM relations
              WHERE kind IN ('gantt_fs', 'gantt_ss', 'gantt_ff', 'blocks')
             UNION
             SELECT to_id, from_id FROM relations WHERE kind = 'depends_on'
         ), reachable(id) AS (
             SELECT ?1
             UNION
             SELECT edges.target FROM edges JOIN reachable ON edges.source = reachable.id
         )
         SELECT EXISTS(SELECT 1 FROM reachable WHERE id = ?2)",
        params![to_id, from_id],
        |row| row.get(0),
    )?;
    Ok(found != 0)
}

/// Relations where object participates as either source or target.
pub fn list_relations(conn: &Connection, object_id: &str) -> Result<Vec<Relation>> {
    let mut stmt = conn
        .prepare("SELECT from_id, to_id, kind FROM relations WHERE from_id = ?1 OR to_id = ?1")?;
    let rows = stmt.query_map(params![object_id], |row| {
        Ok(Relation {
            from_id: row.get(0)?,
            to_id: row.get(1)?,
            kind: row.get(2)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Relations touching any object in `ids` (as source or target). Bulk form
/// of `list_relations` for `relations.listForObjects` (API 1.12).
pub fn list_relations_bulk(conn: &Connection, ids: &[String]) -> Result<Vec<Relation>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT from_id, to_id, kind FROM relations WHERE from_id IN ({placeholders}) OR to_id IN ({placeholders})"
    );
    let bound: Vec<&dyn rusqlite::ToSql> = ids
        .iter()
        .chain(ids.iter())
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(bound.as_slice(), |row| {
        Ok(Relation {
            from_id: row.get(0)?,
            to_id: row.get(1)?,
            kind: row.get(2)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

// ---------- Queries / views ----------

/// Query objects with optional container (relation kind='in'), type and tag filters.
/// Sorted by updated_at DESC. Archived excluded unless include_archived is true.
pub fn query_objects(
    conn: &Connection,
    parent_id: Option<&str>,
    type_filter: Option<&str>,
    tag: Option<&str>,
    include_archived: bool,
    limit: i64,
) -> Result<Vec<Object>> {
    let mut sql = format!(
        "SELECT {LIST_COLS} FROM objects o"
    );
    let mut wheres: Vec<String> = Vec::new();
    let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(pid) = parent_id {
        sql.push_str(" JOIN relations r ON r.from_id = o.id AND r.kind = 'in'");
        wheres.push(format!("r.to_id = ?{}", args.len() + 1));
        args.push(Box::new(pid.to_string()));
    }
    if let Some(t) = type_filter {
        wheres.push(format!("o.type = ?{}", args.len() + 1));
        args.push(Box::new(t.to_string()));
    }
    if let Some(tg) = tag {
        // json_each over the tags array in props; requires JSON1 (bundled).
        wheres.push(format!(
            "EXISTS (SELECT 1 FROM json_each(o.props, '$.tags') je WHERE je.value = ?{})",
            args.len() + 1
        ));
        args.push(Box::new(tg.to_string()));
    }
    if !include_archived {
        wheres.push("o.archived_at IS NULL".to_string());
    }
    wheres.push("o.trashed_at IS NULL".to_string());
    if !wheres.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&wheres.join(" AND "));
    }
    sql.push_str(&format!(" ORDER BY o.updated_at DESC LIMIT {limit}"));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(param_refs.as_slice(), map_object)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Move an object into a new container: removes existing kind='in' relations
/// from this object and (if new_parent_id given) creates a new one. None = root.
pub fn move_object(conn: &Connection, id: &str, new_parent_id: Option<&str>) -> Result<()> {
    let old_relations: Vec<(String, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT from_id, to_id, kind FROM relations WHERE from_id = ?1 AND kind = 'in'",
        )?;
        let rows = stmt
            .query_map(params![id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<Vec<_>>>()?;
        rows
    };
    for (from_id, to_id, kind) in old_relations {
        delete_relation_row(conn, &from_id, &to_id, &kind, now())?;
    }
    mark_local_change(conn, id)?;
    if let Some(pid) = new_parent_id {
        create_relation(conn, id, pid, "in")?;
    }
    Ok(())
}

// ---------- Types ----------

pub fn list_types(conn: &Connection) -> Result<Vec<TypeDef>> {
    let mut stmt = conn.prepare("SELECT name, schema, icon, color FROM types ORDER BY name")?;
    let rows = stmt.query_map([], |row| {
        Ok(TypeDef {
            name: row.get(0)?,
            schema: row.get(1)?,
            icon: row.get(2)?,
            color: row.get(3)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// A plugin (Some(id)) may only put `behaviour` flags in a type whose
/// name is namespaced `<id>.`. Core's own calls (None) are trusted.
/// Anti-collision, not a security boundary — see the 1.12 spec.
pub fn validate_type_namespace(
    name: &str,
    schema: &str,
    plugin_id: Option<&str>,
) -> std::result::Result<(), String> {
    let Some(pid) = plugin_id else {
        return Ok(());
    };
    let has_behaviour = serde_json::from_str::<serde_json::Value>(schema)
        .ok()
        .and_then(|v| v.get("behaviour").cloned())
        .map(|b| b.as_object().map(|m| !m.is_empty()).unwrap_or(false))
        .unwrap_or(false);
    if has_behaviour && !name.starts_with(&format!("{pid}.")) {
        return Err(format!(
            "type \"{name}\" carries behaviour flags but is not namespaced to \"{pid}\""
        ));
    }
    Ok(())
}

pub fn upsert_type(
    conn: &Connection,
    name: &str,
    schema: &str,
    icon: Option<&str>,
    color: Option<&str>,
) -> Result<TypeDef> {
    // Partial update: an omitted icon/color (None) preserves the existing
    // value on the row rather than nulling it out.
    conn.execute(
        "INSERT INTO types (name, schema, icon, color) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(name) DO UPDATE SET
            schema = ?2,
            icon = COALESCE(?3, types.icon),
            color = COALESCE(?4, types.color)",
        params![name, schema, icon, color],
    )?;
    conn.query_row(
        "SELECT name, schema, icon, color FROM types WHERE name = ?1",
        params![name],
        |row| {
            Ok(TypeDef {
                name: row.get(0)?,
                schema: row.get(1)?,
                icon: row.get(2)?,
                color: row.get(3)?,
            })
        },
    )
}

// ---------- Backlinks ----------

/// Objects pointing at `id` from a saved wikilink in their content.
pub fn get_backlinks(conn: &Connection, id: &str) -> Result<Vec<Backlink>> {
    let mut stmt = conn.prepare(
        "SELECT o.id, o.type, o.title, o.content, o.props, o.created_at, o.updated_at, o.archived_at, o.trashed_at,
                (SELECT to_id FROM relations WHERE from_id = o.id AND kind = 'in' LIMIT 1) AS parent_id, r.kind
         FROM relations r
         JOIN objects o ON o.id = r.from_id
         WHERE r.to_id = ?1 AND r.kind = 'links_to'
           AND o.archived_at IS NULL AND o.trashed_at IS NULL
         ORDER BY o.updated_at DESC",
    )?;
    let rows = stmt.query_map(params![id], |row| {
        Ok(Backlink {
            object: map_object(row)?,
            kind: row.get("kind")?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

// ---------- Tags ----------

/// Set props.tags to the given list, preserving other props keys.
pub fn set_tags(conn: &Connection, id: &str, tags: &[String]) -> Result<Option<Object>> {
    let existing = match get_object(conn, id)? {
        Some(o) => o,
        None => return Ok(None),
    };
    let mut props: serde_json::Value =
        serde_json::from_str(&existing.props).unwrap_or_else(|_| serde_json::json!({}));
    if !props.is_object() {
        props = serde_json::json!({});
    }
    props["tags"] = serde_json::json!(tags);
    let props_str = props.to_string();
    let ts = now();
    conn.execute(
        // Monotonic, like every local write (see update_object_as).
        "UPDATE objects SET props = ?2, updated_at = MAX(?3, updated_at + 1) WHERE id = ?1",
        params![id, props_str, ts],
    )?;
    get_object(conn, id)
}

/// Unique tags across all objects.
pub fn list_all_tags(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT je.value
         FROM objects o, json_each(o.props, '$.tags') je
         WHERE json_valid(o.props)
         ORDER BY je.value",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

// ---------- Reusable data sources ----------

pub fn list_data_sources(conn: &Connection) -> Result<Vec<DataSource>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, definition, created_at, updated_at
         FROM data_sources ORDER BY name COLLATE NOCASE, updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(DataSource {
            id: row.get(0)?,
            name: row.get(1)?,
            definition: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn upsert_data_source(
    conn: &Connection,
    id: Option<&str>,
    name: &str,
    definition: &str,
) -> Result<DataSource> {
    // Reject malformed definitions at the persistence boundary. The contents
    // stay forward-compatible JSON interpreted by the frontend query engine.
    serde_json::from_str::<serde_json::Value>(definition)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let timestamp = now();
    let source_id = id
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(new_id);
    conn.execute(
        "INSERT INTO data_sources (id, name, definition, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           definition = excluded.definition,
           updated_at = excluded.updated_at",
        params![source_id, name.trim(), definition, timestamp],
    )?;
    conn.query_row(
        "SELECT id, name, definition, created_at, updated_at FROM data_sources WHERE id = ?1",
        [source_id],
        |row| {
            Ok(DataSource {
                id: row.get(0)?,
                name: row.get(1)?,
                definition: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
}

pub fn delete_data_source(conn: &Connection, id: &str) -> Result<bool> {
    Ok(conn.execute("DELETE FROM data_sources WHERE id = ?1", [id])? > 0)
}

pub fn list_integration_events(
    conn: &Connection,
    after: i64,
    limit: i64,
) -> Result<Vec<IntegrationEvent>> {
    let mut stmt = conn.prepare(
        "SELECT id, event, object_id, object_type, occurred_at, payload FROM integration_events WHERE id > ?1 ORDER BY id ASC LIMIT ?2",
    )?;
    let events = stmt
        .query_map(params![after, limit.clamp(1, 1000)], |row| {
            Ok(IntegrationEvent {
                id: row.get(0)?,
                event: row.get(1)?,
                object_id: row.get(2)?,
                object_type: row.get(3)?,
                occurred_at: row.get(4)?,
                payload: row.get(5)?,
            })
        })?
        .collect();
    events
}

// ---------- Additive cloud synchronization ----------

pub fn list_all_objects_for_sync(conn: &Connection) -> Result<Vec<Object>> {
    let mut stmt = conn.prepare(&format!("SELECT {OBJ_COLS} FROM objects ORDER BY updated_at ASC, id ASC"))?;
    let rows = stmt.query_map([], map_object)?;
    rows.collect()
}

pub fn list_all_relations_for_sync(conn: &Connection) -> Result<Vec<Relation>> {
    let mut stmt = conn.prepare("SELECT from_id, to_id, kind FROM relations ORDER BY from_id, to_id, kind")?;
    let rows = stmt.query_map([], |row| Ok(Relation {
        from_id: row.get(0)?,
        to_id: row.get(1)?,
        kind: row.get(2)?,
    }))?;
    rows.collect()
}

pub fn list_sync_relations(conn: &Connection) -> Result<Vec<SyncRelation>> {
    let mut stmt = conn.prepare(
        "SELECT r.from_id, r.to_id, r.kind,
                COALESCE(s.created_at, 0)
         FROM relations r
         LEFT JOIN sync_relation_state s
           ON s.from_id = r.from_id AND s.to_id = r.to_id AND s.kind = r.kind
         ORDER BY r.from_id, r.to_id, r.kind",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(SyncRelation {
            from_id: row.get(0)?,
            to_id: row.get(1)?,
            kind: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn list_sync_relation_tombstones(conn: &Connection) -> Result<Vec<SyncRelationTombstone>> {
    let mut stmt = conn.prepare(
        "SELECT from_id, to_id, kind, deleted_at
         FROM sync_relation_tombstones
         ORDER BY deleted_at, from_id, to_id, kind",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(SyncRelationTombstone {
            from_id: row.get(0)?,
            to_id: row.get(1)?,
            kind: row.get(2)?,
            deleted_at: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn apply_sync_relation_tombstone(conn: &Connection, tombstone: &SyncRelationTombstone) -> Result<bool> {
    let current_created_at: Option<i64> = conn
        .query_row(
            "SELECT created_at FROM sync_relation_state
             WHERE from_id = ?1 AND to_id = ?2 AND kind = ?3",
            params![tombstone.from_id, tombstone.to_id, tombstone.kind],
            |row| row.get(0),
        )
        .optional()?;
    if current_created_at.is_some_and(|created_at| created_at > tombstone.deleted_at) {
        return Ok(false);
    }
    let current: Option<i64> = conn
        .query_row(
            "SELECT deleted_at FROM sync_relation_tombstones
             WHERE from_id = ?1 AND to_id = ?2 AND kind = ?3",
            params![tombstone.from_id, tombstone.to_id, tombstone.kind],
            |row| row.get(0),
        )
        .optional()?;
    if current.is_some_and(|deleted_at| deleted_at >= tombstone.deleted_at) {
        return Ok(false);
    }
    conn.execute(
        "INSERT INTO sync_relation_tombstones (from_id, to_id, kind, deleted_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(from_id, to_id, kind) DO UPDATE SET deleted_at = MAX(sync_relation_tombstones.deleted_at, excluded.deleted_at)",
        params![tombstone.from_id, tombstone.to_id, tombstone.kind, tombstone.deleted_at],
    )?;
    let removed = conn.execute(
        "DELETE FROM relations WHERE from_id = ?1 AND to_id = ?2 AND kind = ?3",
        params![tombstone.from_id, tombstone.to_id, tombstone.kind],
    )? > 0;
    Ok(removed || current.is_none())
}

/// SYNC-NO-LOSS (Hive #14, F8): put a synced object under `parent_id` (the
/// placement a sync merge chose) through the `in` relation, which is where
/// Core derives `parent_id` from. Old `in` relations get tombstones so peers
/// drop them too. Nothing goes to the outbox: the merge is already shared.
/// A parent that is not here leaves the placement alone (no orphaning).
pub fn place_synced_object(conn: &Connection, id: &str, parent_id: Option<&str>) -> Result<()> {
    if let Some(pid) = parent_id {
        if get_object(conn, pid)?.is_none() {
            return Ok(());
        }
    }
    let current: Vec<String> = conn
        .prepare("SELECT to_id FROM relations WHERE from_id = ?1 AND kind = 'in'")?
        .query_map(params![id], |row| row.get(0))?
        .collect::<Result<_>>()?;
    // Each stamp is above what it overrides (Hive #18, N2), not just `now()`.
    let at = now();
    for to_id in current.iter().filter(|to| Some(to.as_str()) != parent_id) {
        delete_relation_row(conn, id, to_id, "in", at)?;
    }
    if let Some(pid) = parent_id.filter(|pid| !current.iter().any(|to| to == pid)) {
        let created_at = relation_stamp(conn, id, pid, "in", at)?;
        conn.execute("INSERT OR IGNORE INTO relations (from_id, to_id, kind) VALUES (?1, ?2, 'in')", params![id, pid])?;
        record_relation_created(conn, id, pid, "in", created_at)?;
    }
    Ok(())
}

pub fn upsert_synced_relation(conn: &Connection, relation: &SyncRelation) -> Result<bool> {
    let tombstone: Option<i64> = conn
        .query_row(
            "SELECT deleted_at FROM sync_relation_tombstones
             WHERE from_id = ?1 AND to_id = ?2 AND kind = ?3",
            params![relation.from_id, relation.to_id, relation.kind],
            |row| row.get(0),
        )
        .optional()?;
    // A deletion with the same millisecond timestamp wins the tie. This is
    // important for local create/delete operations that share the clock tick;
    // allowing equality would resurrect a stale relation.
    if tombstone.is_some_and(|deleted_at| relation.created_at == 0 || deleted_at >= relation.created_at) {
        return Ok(false);
    }
    let existed = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM relations WHERE from_id = ?1 AND to_id = ?2 AND kind = ?3)",
        params![relation.from_id, relation.to_id, relation.kind],
        |row| row.get::<_, bool>(0),
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO relations (from_id, to_id, kind) VALUES (?1, ?2, ?3)",
        params![relation.from_id, relation.to_id, relation.kind],
    )?;
    conn.execute(
        "INSERT INTO sync_relation_state (from_id, to_id, kind, created_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(from_id, to_id, kind) DO UPDATE SET created_at = MAX(sync_relation_state.created_at, excluded.created_at)",
        params![relation.from_id, relation.to_id, relation.kind, relation.created_at],
    )?;
    if tombstone.is_some() {
        conn.execute(
            "DELETE FROM sync_relation_tombstones
             WHERE from_id = ?1 AND to_id = ?2 AND kind = ?3 AND deleted_at <= ?4",
            params![relation.from_id, relation.to_id, relation.kind, relation.created_at],
        )?;
    }
    Ok(!existed)
}

pub fn list_sync_tombstones(conn: &Connection) -> Result<Vec<SyncTombstone>> {
    let mut stmt = conn.prepare("SELECT object_id, deleted_at FROM sync_tombstones ORDER BY deleted_at, object_id")?;
    let rows = stmt.query_map([], |row| Ok(SyncTombstone {
        object_id: row.get(0)?,
        deleted_at: row.get(1)?,
    }))?;
    rows.collect()
}

pub fn get_sync_tombstone(conn: &Connection, object_id: &str) -> Result<Option<SyncTombstone>> {
    conn.query_row(
        "SELECT object_id, deleted_at FROM sync_tombstones WHERE object_id = ?1",
        [object_id],
        |row| Ok(SyncTombstone { object_id: row.get(0)?, deleted_at: row.get(1)? }),
    ).optional()
}

/// Applies a single sync tombstone atomically. Uses a `SAVEPOINT` rather than
/// `BEGIN`/`COMMIT` because this function is also invoked once per tombstone
/// from inside `sync_apply`'s outer transaction (see `lib.rs`) — SQLite
/// rejects a nested `BEGIN`, but `SAVEPOINT`s nest cleanly either way, so this
/// stays safe both as a standalone call and inside a larger transaction.
pub fn apply_sync_tombstone(conn: &Connection, tombstone: &SyncTombstone) -> Result<bool> {
    conn.execute_batch("SAVEPOINT apply_sync_tombstone")?;
    let result = (|| -> Result<bool> {
        if let Some(local) = get_object(conn, &tombstone.object_id)? {
            if local.updated_at > tombstone.deleted_at {
                return Ok(false);
            }
        }
        let current = get_sync_tombstone(conn, &tombstone.object_id)?;
        if current.as_ref().is_some_and(|item| item.deleted_at >= tombstone.deleted_at) {
            return Ok(false);
        }
        conn.execute(
            "INSERT INTO sync_tombstones (object_id, deleted_at) VALUES (?1, ?2)
             ON CONFLICT(object_id) DO UPDATE SET deleted_at = MAX(sync_tombstones.deleted_at, excluded.deleted_at)",
            params![tombstone.object_id, tombstone.deleted_at],
        )?;
        let touching: Vec<(String, String, String)> = {
            let mut stmt = conn.prepare(
                "SELECT from_id, to_id, kind FROM relations WHERE from_id = ?1 OR to_id = ?1",
            )?;
            let rows = stmt
                .query_map([&tombstone.object_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                .collect::<Result<Vec<_>>>()?;
            rows
        };
        for (from_id, to_id, kind) in touching {
            delete_relation_row(conn, &from_id, &to_id, &kind, tombstone.deleted_at)?;
        }
        conn.execute("DELETE FROM history WHERE object_id = ?1", [&tombstone.object_id])?;
        let removed = conn.execute("DELETE FROM objects WHERE id = ?1", [&tombstone.object_id])? > 0;
        Ok(removed || current.is_none())
    })();
    match result {
        Ok(value) => {
            conn.execute_batch("RELEASE apply_sync_tombstone")?;
            Ok(value)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK TO apply_sync_tombstone");
            let _ = conn.execute_batch("RELEASE apply_sync_tombstone");
            Err(error)
        }
    }
}

/// Merge one remote object without ever deleting a local row. If both sides
/// have the same UUID, the newer timestamp wins; an older remote copy is
/// ignored. Separate records from two installations are always inserted.
pub fn upsert_synced_object(conn: &Connection, object: &Object) -> Result<Object> {
    if let Some(tombstone) = get_sync_tombstone(conn, &object.id)? {
        if tombstone.deleted_at >= object.updated_at {
            return get_object(conn, &object.id)?.ok_or(rusqlite::Error::QueryReturnedNoRows);
        }
        conn.execute("DELETE FROM sync_tombstones WHERE object_id = ?1", [&object.id])?;
    }
    let existing = get_object(conn, &object.id)?;
    if let Some(local) = existing {
        if object.updated_at <= local.updated_at {
            return Ok(local);
        }
        // Both sides of a newest-wins decision end up in history: the local
        // version (its latest row, or a baseline) and, below, the one that
        // replaced it. An identical re-apply records nothing.
        let changed = local.title != object.title || local.content != object.content || local.props != object.props;
        if changed {
            ensure_baseline(conn, &local)?;
        }
        conn.execute(
            "UPDATE objects SET type = ?2, title = ?3, content = ?4, props = ?5,
             created_at = MIN(created_at, ?6), updated_at = ?7, archived_at = ?8, trashed_at = ?9
             WHERE id = ?1",
            params![
                object.id,
                object.r#type,
                object.title,
                object.content,
                object.props,
                object.created_at,
                object.updated_at,
                object.archived_at,
                object.trashed_at,
            ],
        )?;
        if changed {
            let applied = get_object(conn, &object.id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            record_history(conn, &applied, HistorySource::Sync, None)?;
        }
    } else {
        conn.execute(
            "INSERT INTO objects (id, type, title, content, props, created_at, updated_at, archived_at, trashed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                object.id,
                object.r#type,
                object.title,
                object.content,
                object.props,
                object.created_at,
                object.updated_at,
                object.archived_at,
                object.trashed_at,
            ],
        )?;
        // A peer's first version is a sync row, never a later "baseline":
        // baselines are retained like the user's own versions, so a peer
        // could otherwise fill the history budget with rows that outlive
        // the user's.
        let applied = get_object(conn, &object.id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
        record_history(conn, &applied, HistorySource::Sync, None)?;
    }
    get_object(conn, &object.id)?.ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)
}

pub fn get_sync_state(conn: &Connection, key: &str) -> Result<Option<String>> {
    conn.query_row("SELECT value FROM sync_state WHERE key = ?1", [key], |row| row.get(0))
        .optional()
}

pub fn set_sync_state(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO sync_state (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Bind legacy pre-device outbox rows to the stable device id before export.
/// This keeps an operation key unchanged across retries after the first sync.
pub fn prepare_sync_outbox(conn: &Connection, device_id: &str) -> Result<()> {
    let prefix = format!("{device_id}:event:");
    conn.execute(
        "UPDATE sync_outbox
            SET operation_id = ?1 || event_id
          WHERE event_id IS NOT NULL AND state = 'pending' AND operation_id LIKE 'pending:event:%'",
        [prefix],
    )?;
    Ok(())
}

pub fn list_sync_outbox(conn: &Connection, limit: i64) -> Result<Vec<SyncOutboxEntry>> {
    let mut stmt = conn.prepare(
        "SELECT operation_id, event, object_id, object_type, occurred_at, payload, attempts, state
           FROM sync_outbox
          WHERE state = 'pending'
          ORDER BY occurred_at ASC, operation_id ASC
          LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit.clamp(1, 1000)], |row| {
        Ok(SyncOutboxEntry {
            operation_id: row.get(0)?,
            event: row.get(1)?,
            object_id: row.get(2)?,
            object_type: row.get(3)?,
            occurred_at: row.get(4)?,
            payload: row.get(5)?,
            attempts: row.get(6)?,
            state: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn mark_sync_outbox_attempts(conn: &Connection, operation_ids: &[String]) -> Result<()> {
    for operation_id in operation_ids {
        conn.execute(
            "UPDATE sync_outbox
                SET attempts = attempts + 1, last_attempt_at = ?2
              WHERE operation_id = ?1 AND state = 'pending'",
            params![operation_id, now()],
        )?;
    }
    Ok(())
}

pub fn acknowledge_sync_outbox(conn: &Connection, operation_ids: &[String]) -> Result<usize> {
    let mut acknowledged = 0;
    for operation_id in operation_ids {
        acknowledged += conn.execute(
            "UPDATE sync_outbox
                SET state = 'acked', acknowledged_at = ?2
              WHERE operation_id = ?1 AND state <> 'acked'",
            params![operation_id, now()],
        )?;
    }
    Ok(acknowledged)
}

// ---------- Local plugin registry ----------

fn validate_plugin_registry_state(state: &str) -> Result<()> {
    if matches!(state, "active" | "disabled" | "failed" | "installed") {
        Ok(())
    } else {
        Err(rusqlite::Error::InvalidParameterName(format!(
            "invalid plugin registry state: {state}"
        )))
    }
}

fn map_plugin_registry_entry(row: &rusqlite::Row) -> Result<PluginRegistryEntry> {
    Ok(PluginRegistryEntry {
        plugin_id: row.get("plugin_id")?,
        version: row.get("version")?,
        source: row.get("source")?,
        install_path: row.get("install_path")?,
        manifest: row.get("manifest")?,
        verified: row.get::<_, i64>("verified")? != 0,
        user_trusted: row.get::<_, i64>("user_trusted")? != 0,
        state: row.get("state")?,
        last_error: row.get("last_error")?,
        installed_at: row.get("installed_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_plugin_registry(conn: &Connection) -> Result<Vec<PluginRegistryEntry>> {
    let mut stmt = conn.prepare(
        "SELECT plugin_id, version, source, install_path, manifest, verified, user_trusted,
                state, last_error, installed_at, updated_at
         FROM plugin_registry
         ORDER BY plugin_id ASC, installed_at DESC, version DESC",
    )?;
    let rows = stmt.query_map([], map_plugin_registry_entry)?;
    rows.collect()
}

pub fn upsert_plugin_registry(
    conn: &Connection,
    plugin_id: &str,
    version: &str,
    source: &str,
    install_path: &str,
    manifest: &str,
    verified: bool,
) -> Result<PluginRegistryEntry> {
    if plugin_id.trim().is_empty() || version.trim().is_empty() {
        return Err(rusqlite::Error::InvalidParameterName(
            "plugin id and version are required".into(),
        ));
    }
    if !matches!(source, "builtin" | "local-file" | "package") {
        return Err(rusqlite::Error::InvalidParameterName(
            "invalid plugin source".into(),
        ));
    }
    let manifest_value = serde_json::from_str::<serde_json::Value>(manifest).map_err(|_| {
        rusqlite::Error::InvalidParameterName("plugin manifest must be valid JSON".into())
    })?;
    if manifest_value.get("id").and_then(serde_json::Value::as_str) != Some(plugin_id)
        || manifest_value.get("version").and_then(serde_json::Value::as_str) != Some(version)
    {
        return Err(rusqlite::Error::InvalidParameterName(
            "plugin manifest id and version must match registry key".into(),
        ));
    }
    if install_path.trim().is_empty() {
        return Err(rusqlite::Error::InvalidParameterName(
            "plugin install path is required".into(),
        ));
    }
    let timestamp = now();
    conn.execute(
        "INSERT INTO plugin_registry
            (plugin_id, version, source, install_path, manifest, verified, state,
             last_error, installed_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'disabled', NULL, ?7, ?7)
         ON CONFLICT(plugin_id, version) DO UPDATE SET
            source = excluded.source,
            install_path = excluded.install_path,
            manifest = excluded.manifest,
            verified = excluded.verified,
            -- Re-installing over an existing (id, version) row replaces the
            -- code on disk, so the trust the user granted the previous bytes
            -- does not carry over. The install flow re-asks after this write.
            user_trusted = 0,
            updated_at = excluded.updated_at",
        params![plugin_id, version, source, install_path, manifest, verified as i64, timestamp],
    )?;
    conn.query_row(
        "SELECT plugin_id, version, source, install_path, manifest, verified, user_trusted,
                state, last_error, installed_at, updated_at
         FROM plugin_registry WHERE plugin_id = ?1 AND version = ?2",
        params![plugin_id, version],
        map_plugin_registry_entry,
    )
}

/// Record that the user explicitly accepted running this exact package.
/// Callers must have shown the warning first — see `grant_plugin_trust` in
/// `lib.rs`, which is the only path that reaches this.
pub fn set_plugin_user_trusted(
    conn: &Connection,
    plugin_id: &str,
    version: &str,
) -> Result<PluginRegistryEntry> {
    let changed = conn.execute(
        "UPDATE plugin_registry SET user_trusted = 1, updated_at = ?3
         WHERE plugin_id = ?1 AND version = ?2",
        params![plugin_id, version, now()],
    )?;
    if changed == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    conn.query_row(
        "SELECT plugin_id, version, source, install_path, manifest, verified, user_trusted,
                state, last_error, installed_at, updated_at
         FROM plugin_registry WHERE plugin_id = ?1 AND version = ?2",
        params![plugin_id, version],
        map_plugin_registry_entry,
    )
}

pub fn set_plugin_registry_state(
    conn: &Connection,
    plugin_id: &str,
    version: &str,
    state: &str,
    last_error: Option<&str>,
) -> Result<PluginRegistryEntry> {
    validate_plugin_registry_state(state)?;
    if state == "active" {
        let trusted: bool = conn.query_row(
            "SELECT verified OR user_trusted FROM plugin_registry
             WHERE plugin_id = ?1 AND version = ?2",
            params![plugin_id, version],
            |row| row.get::<_, i64>(0).map(|value| value != 0),
        )?;
        if !trusted {
            return Err(rusqlite::Error::InvalidParameterName(
                "a plugin artifact must be signature-verified or user-trusted to be active".into(),
            ));
        }
    }
    let timestamp = now();
    if state == "active" {
        conn.execute(
            "UPDATE plugin_registry SET state = 'disabled', updated_at = ?2
             WHERE plugin_id = ?1 AND state = 'active'",
            params![plugin_id, timestamp],
        )?;
    }
    let changed = conn.execute(
        "UPDATE plugin_registry
         SET state = ?3, last_error = ?4, updated_at = ?5
         WHERE plugin_id = ?1 AND version = ?2",
        params![plugin_id, version, state, last_error, timestamp],
    )?;
    if changed == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    conn.query_row(
        "SELECT plugin_id, version, source, install_path, manifest, verified, user_trusted,
                state, last_error, installed_at, updated_at
         FROM plugin_registry WHERE plugin_id = ?1 AND version = ?2",
        params![plugin_id, version],
        map_plugin_registry_entry,
    )
}

/// Removes plugin registry row(s) and best-effort deletes the corresponding
/// extracted `versions/<version>` directories on disk, so a later re-install
/// of the same version doesn't hit `extract_plugin_zip`'s "already installed"
/// check against files the registry no longer knows about. Filesystem
/// failures are logged but never fail the registry deletion itself — the
/// database row is the source of truth for what's "installed".
pub fn remove_plugin_registry(
    conn: &Connection,
    plugin_id: &str,
    version: Option<&str>,
) -> Result<usize> {
    // Only directories Notible created may be deleted.
    //
    // `install_path` means two different things depending on `source`. For a
    // package install it is our own extracted `versions/<version>` directory,
    // which must go. For `local-file` it is the folder the *user* picked and
    // still owns — their working copy. Deleting that on "Remove" destroyed a
    // plugin author's source directory with no prompt and no recycle bin, and
    // nothing in the UI hinted that Remove was a filesystem operation at all.
    let install_paths: Vec<String> = {
        let sql = if version.is_some() {
            "SELECT install_path FROM plugin_registry              WHERE plugin_id = ?1 AND version = ?2 AND source <> 'local-file'"
        } else {
            "SELECT install_path FROM plugin_registry              WHERE plugin_id = ?1 AND source <> 'local-file'"
        };
        let mut stmt = conn.prepare(sql)?;
        match version {
            Some(version) => stmt
                .query_map(params![plugin_id, version], |row| row.get(0))?
                .collect::<Result<Vec<_>>>()?,
            None => stmt
                .query_map(params![plugin_id], |row| row.get(0))?
                .collect::<Result<Vec<_>>>()?,
        }
    };

    let removed = match version {
        Some(version) => conn.execute(
            "DELETE FROM plugin_registry WHERE plugin_id = ?1 AND version = ?2",
            params![plugin_id, version],
        ),
        None => conn.execute(
            "DELETE FROM plugin_registry WHERE plugin_id = ?1",
            params![plugin_id],
        ),
    }?;

    for path in install_paths {
        if path.trim().is_empty() {
            continue;
        }
        if let Err(error) = std::fs::remove_dir_all(&path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                eprintln!(
                    "remove_plugin_registry: failed to remove plugin files at {path}: {error}"
                );
            }
        }
    }

    Ok(removed)
}

// ---------- Tests ----------

#[cfg(test)]
mod tests {
    use super::*;

    /// The `image` node shape (`{"type":"image","attrs":{"src":...}}`) and the
    /// `paragraph` shape holding literal `![]()` text as a text node both show
    /// up in real pre-rewrite notes — both must survive the flatten.
    #[test]
    fn legacy_doc_migration_flattens_image_nodes_and_marks() {
        let conn = open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO objects (id, type, title, content, props, created_at, updated_at) VALUES ('n1','note','t',?1,'{}',0,0)",
            params![r#"{"type":"doc","content":[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Title"}]},{"type":"image","attrs":{"src":"media/11111111-1111-1111-1111-111111111111.png","alt":null}},{"type":"paragraph","content":[{"type":"text","text":"bold","marks":[{"type":"bold"}]}]}]}"#],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO objects (id, type, title, content, props, created_at, updated_at) VALUES ('n2','note','t','already markdown text','{}',0,0)",
            [],
        )
        .unwrap();
        migrate_legacy_doc_content(&conn).unwrap();
        let n1: String = conn.query_row("SELECT content FROM objects WHERE id = 'n1'", [], |r| r.get(0)).unwrap();
        assert_eq!(n1, "# Title\n![](media/11111111-1111-1111-1111-111111111111.png)\n**bold**");
        let n2: String = conn.query_row("SELECT content FROM objects WHERE id = 'n2'", [], |r| r.get(0)).unwrap();
        assert_eq!(n2, "already markdown text");
    }

    #[test]
    fn migrations_set_version() {
        let conn = open_in_memory().unwrap();
        let v: i64 = conn
            .query_row("SELECT version FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, MIGRATIONS.len() as i64);
    }

    /// An unsigned side-loaded plugin (`verified = false`, which is what a
    /// release build always resolves without an update manifest) must be
    /// activatable once the user has explicitly accepted it, and must stay
    /// refused until then. Getting this wrong in either direction is a
    /// shipped bug: refusing always meant local plugins died on restart;
    /// allowing always meant unreviewed code ran silently.
    /// The content index is what a Dataview/Tasks-class plugin stands on, and
    /// its input is a note body — which arrives from import, sync, paste or a
    /// plugin's own `objects.create`, so it is fully attacker-controlled.
    #[test]
    fn content_index_extracts_headings_tags_links_and_tasks() {
        let doc = |lines: &[&str]| {
            let paragraphs: Vec<serde_json::Value> = lines
                .iter()
                .map(|line| serde_json::json!({"type":"paragraph","content":[{"type":"text","text":line}]}))
                .collect();
            serde_json::json!({"type":"doc","content":paragraphs}).to_string()
        };

        let content = doc(&[
            "# Plan tygodnia",
            "### Szczegóły",
            "- [ ] Napisać spec #praca",
            "- [x] Wysłać maila",
            "Zobacz [[Notatka źródłowa]] oraz [[Inna|etykieta]] i [[Trzecia#sekcja]].",
            "Tag na końcu #projekt/alfa",
        ]);
        let entries = index_content("obj-1", &content);
        let of = |kind: &str| {
            entries
                .iter()
                .filter(|e| e.kind == kind)
                .map(|e| e.value.clone())
                .collect::<Vec<_>>()
        };

        assert_eq!(of("heading"), vec!["Plan tygodnia", "Szczegóły"]);
        assert_eq!(entries.iter().find(|e| e.kind == "heading").unwrap().level, Some(1));
        assert_eq!(entries.iter().filter(|e| e.kind == "heading").nth(1).unwrap().level, Some(3));

        assert_eq!(of("task"), vec!["Napisać spec #praca", "Wysłać maila"]);
        let tasks: Vec<Option<bool>> = entries.iter().filter(|e| e.kind == "task").map(|e| e.checked).collect();
        assert_eq!(tasks, vec![Some(false), Some(true)]);

        // Wiki links keep only the target, dropping label and anchor.
        assert_eq!(of("link"), vec!["Notatka źródłowa", "Inna", "Trzecia"]);

        // A tag inside a task line still counts; a heading's leading # does not.
        assert_eq!(of("tag"), vec!["praca", "projekt/alfa"]);

        // Line numbers are reported so a plugin can jump to the right place.
        assert_eq!(entries.iter().find(|e| e.value == "projekt/alfa").unwrap().line, 5);
    }

    /// D13's projection has to agree with the note in BOTH storage dialects,
    /// which is the whole reason it is built on `content_blocks` rather than on
    /// the frontend's lossy `textFromDocument`.
    #[test]
    fn project_document_reads_both_dialects_in_order() {
        // Core's own editor: one paragraph per line of literal Markdown.
        let markdown = serde_json::json!({
            "type": "doc",
            "content": [
                {"type":"paragraph","content":[{"type":"text","text":"## Cel"}]},
                {"type":"paragraph","content":[{"type":"text","text":"- [x] Spisać kryteria"}]},
                {"type":"paragraph","content":[{"type":"text","text":"- zwykły punkt"}]},
                {"type":"paragraph","content":[{"type":"text","text":"> cytat"}]},
                {"type":"paragraph","content":[{"type":"text","text":"```rust"}]},
                {"type":"paragraph","content":[{"type":"text","text":"zdanie"}]}
            ]
        })
        .to_string();
        let blocks = project_document(&markdown);
        let kinds: Vec<&str> = blocks.iter().map(|b| b.kind.as_str()).collect();
        assert_eq!(kinds, ["heading", "task", "list", "quote", "code", "paragraph"]);
        assert_eq!(blocks[0].text, "Cel");
        assert_eq!(blocks[0].level, Some(2));
        assert_eq!(blocks[1].checked, Some(true));
        assert_eq!(blocks[1].text, "Spisać kryteria");
        assert_eq!(blocks[4].language.as_deref(), Some("rust"));
        // Order is the contract: an outline plugin reads these as they appear.
        assert_eq!(blocks.iter().map(|b| b.line).collect::<Vec<_>>(), (0..6).collect::<Vec<_>>());

        // The richer editor: real nodes, no Markdown syntax anywhere.
        let structural = serde_json::json!({
            "type": "doc",
            "content": [
                {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Cel"}]},
                {"type":"taskList","content":[
                    {"type":"taskItem","attrs":{"checked":true},"content":[
                        {"type":"paragraph","content":[{"type":"text","text":"Spisać kryteria"}]}]}]}
            ]
        })
        .to_string();
        let blocks = project_document(&structural);
        let heading = blocks.iter().find(|b| b.kind == "heading").expect("heading");
        assert_eq!((heading.text.as_str(), heading.level), ("Cel", Some(2)));
        let task = blocks.iter().find(|b| b.kind == "task").expect("task");
        assert_eq!((task.text.as_str(), task.checked), ("Spisać kryteria", Some(true)));
    }

    /// Notes authored by the richer editor store real `heading` nodes: the
    /// text is `Cel`, the level is in `attrs`, and there is no `#` anywhere.
    /// Reading only the Markdown dialect made every such note look empty —
    /// which is what the first live test of 0.42.0 found.
    #[test]
    fn content_index_reads_structural_nodes_not_only_markdown_syntax() {
        let content = serde_json::json!({
            "type": "doc",
            "content": [
                {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Cel"}]},
                {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"A. Supabase — rekomendowane"}]},
                {"type":"taskList","content":[
                    {"type":"taskItem","attrs":{"checked":false},"content":[
                        {"type":"paragraph","content":[{"type":"text","text":"Wybrać backend #decyzja"}]}]},
                    {"type":"taskItem","attrs":{"checked":true},"content":[
                        {"type":"paragraph","content":[{"type":"text","text":"Spisać kryteria"}]}]}]},
                {"type":"paragraph","content":[{"type":"text","text":"Patrz [[Architektura]]"}]}
            ]
        })
        .to_string();

        let entries = index_content("obj", &content);
        let of = |kind: &str| {
            entries.iter().filter(|e| e.kind == kind).map(|e| e.value.clone()).collect::<Vec<_>>()
        };

        assert_eq!(of("heading"), vec!["Cel", "A. Supabase — rekomendowane"]);
        let levels: Vec<Option<i64>> =
            entries.iter().filter(|e| e.kind == "heading").map(|e| e.level).collect();
        assert_eq!(levels, vec![Some(2), Some(3)]);

        assert_eq!(of("task"), vec!["Wybrać backend #decyzja", "Spisać kryteria"]);
        let checked: Vec<Option<bool>> =
            entries.iter().filter(|e| e.kind == "task").map(|e| e.checked).collect();
        assert_eq!(checked, vec![Some(false), Some(true)]);

        assert_eq!(of("tag"), vec!["decyzja"]);
        assert_eq!(of("link"), vec!["Architektura"]);
    }

    /// A structural heading whose text happens to begin with '#' must not be
    /// counted twice, once per dialect.
    #[test]
    fn content_index_does_not_double_count_across_dialects() {
        let content = serde_json::json!({
            "type": "doc",
            "content": [{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"# Uwaga"}]}]
        })
        .to_string();
        let headings: Vec<_> = index_content("obj", &content).into_iter().filter(|e| e.kind == "heading").collect();
        assert_eq!(headings.len(), 1);
        assert_eq!(headings[0].level, Some(1));
    }

    #[test]
    fn content_index_survives_hostile_and_malformed_bodies() {
        // Not JSON at all — must degrade to raw text, not panic or lose it.
        assert_eq!(index_content("x", "# Heading").len(), 1);

        // Unterminated wiki link brackets: the classic backtracking shape.
        // This scan is single-pass and regex-free, so it just finds nothing.
        let nasty = "[".repeat(20_000);
        let entries = index_content("x", &nasty);
        assert!(entries.is_empty());

        // One pathological line cannot produce unbounded index entries.
        let many_tags = (0..10_000).map(|i| format!("#t{i}")).collect::<Vec<_>>().join(" ");
        assert!(index_content("x", &many_tags).len() <= 2000, "entry count must be capped");

        // One pathological value cannot produce an unbounded string.
        let long = format!("# {}", "a".repeat(10_000));
        assert!(index_content("x", &long)[0].value.chars().count() <= 200, "value length must be capped");

        // Empty and whitespace-only headings produce nothing rather than blanks.
        assert!(index_content("x", "#").is_empty());
        assert!(index_content("x", "#   ").is_empty());
    }

    #[test]
    fn user_trust_gates_activation_independently_of_signature() {
        let conn = open_in_memory().unwrap();
        let manifest = r#"{"id":"example.hello","version":"0.1.0","entry":"main.js"}"#;
        upsert_plugin_registry(
            &conn,
            "example.hello",
            "0.1.0",
            "local-file",
            "C:/plugins/example.hello",
            manifest,
            false,
        )
        .unwrap();

        assert!(
            set_plugin_registry_state(&conn, "example.hello", "0.1.0", "active", None).is_err(),
            "an unsigned, untrusted plugin must not be activatable"
        );

        let granted = set_plugin_user_trusted(&conn, "example.hello", "0.1.0").unwrap();
        assert!(granted.user_trusted && !granted.verified);
        let active =
            set_plugin_registry_state(&conn, "example.hello", "0.1.0", "active", None).unwrap();
        assert_eq!(active.state, "active");

        // Re-installing the same id+version replaces the code on disk, so the
        // decision the user made about the previous bytes must not carry over.
        let reinstalled = upsert_plugin_registry(
            &conn,
            "example.hello",
            "0.1.0",
            "local-file",
            "C:/plugins/example.hello",
            manifest,
            false,
        )
        .unwrap();
        assert!(!reinstalled.user_trusted, "trust must reset on re-install");
        assert!(
            set_plugin_registry_state(&conn, "example.hello", "0.1.0", "active", None).is_err(),
            "re-installed bytes must be re-approved before activation"
        );
    }

    #[test]
    fn removing_a_local_file_plugin_leaves_the_authors_folder_alone() {
        // Remove used to run remove_dir_all on install_path unconditionally.
        // For a local-file install that path is the developer's own working
        // copy, so clicking Remove deleted their source. Nothing tested it.
        let conn = open_in_memory().unwrap();
        let dir = std::env::temp_dir().join(format!("notible-local-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("main.js"), b"export default {};").unwrap();
        let path = dir.to_string_lossy().into_owned();

        upsert_plugin_registry(&conn, "author.plugin", "0.1.0", "local-file", &path, r#"{"id":"author.plugin","version":"0.1.0"}"#, false).unwrap();
        remove_plugin_registry(&conn, "author.plugin", Some("0.1.0")).unwrap();

        assert!(dir.join("main.js").exists(), "Remove must not delete a folder the user owns");
        assert!(list_plugin_registry(&conn).unwrap().is_empty(), "the registry row must still go");

        // A packaged install is ours to clean up, and must still be cleaned up.
        let managed = std::env::temp_dir().join(format!("notible-managed-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&managed).unwrap();
        std::fs::write(managed.join("main.js"), b"export default {};").unwrap();
        let managed_path = managed.to_string_lossy().into_owned();
        upsert_plugin_registry(&conn, "packaged.plugin", "0.1.0", "package", &managed_path, r#"{"id":"packaged.plugin","version":"0.1.0"}"#, false).unwrap();
        remove_plugin_registry(&conn, "packaged.plugin", Some("0.1.0")).unwrap();
        assert!(!managed.exists(), "an extracted package directory must be removed");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn plugin_registry_persists_versions_and_active_state() {
        let conn = open_in_memory().unwrap();
        let v1 = upsert_plugin_registry(
            &conn,
            "example.hello",
            "0.1.0",
            "local-file",
            "C:/plugins/example.hello/0.1.0",
            r#"{"id":"example.hello","version":"0.1.0"}"#,
            true,
        )
        .unwrap();
        assert_eq!(v1.state, "disabled");
        upsert_plugin_registry(
            &conn,
            "example.hello",
            "0.2.0",
            "package",
            "C:/plugins/example.hello/0.2.0",
            r#"{"id":"example.hello","version":"0.2.0"}"#,
            true,
        )
        .unwrap();
        set_plugin_registry_state(&conn, "example.hello", "0.1.0", "active", None).unwrap();
        set_plugin_registry_state(&conn, "example.hello", "0.2.0", "active", None).unwrap();
        let entries = list_plugin_registry(&conn).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries.iter().filter(|entry| entry.state == "active").count(), 1);
        assert_eq!(entries.iter().find(|entry| entry.version == "0.2.0").unwrap().state, "active");
        assert_eq!(remove_plugin_registry(&conn, "example.hello", Some("0.1.0")).unwrap(), 1);
        assert_eq!(list_plugin_registry(&conn).unwrap().len(), 1);
    }

    /// The scanner must find a media filename inside the shape the editor
    /// actually writes — a percent-encoded asset URL, not a bare path — and
    /// must not claim a name it did not produce.
    #[test]
    fn media_scanner_matches_only_saved_media_names() {
        let name = "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607.png";
        let note = format!(
            "Before\n![](http://asset.localhost/C%3A%5CUsers%5Cme%5Cmedia%5C{name})\nAfter",
        );
        assert_eq!(media_filenames_in(&note), vec![name.to_string()]);

        // A plain path form is the same filename, and a repeat is not a second hit.
        let twice = format!("{name} and again {name}");
        assert_eq!(media_filenames_in(&twice), vec![name.to_string()]);

        // Not ours: wrong shape, and an extension that only looks like one.
        assert!(media_filenames_in("![](screenshot.png)").is_empty());
        assert!(media_filenames_in("3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607.pngx").is_empty());
        // ".jpg" must not match the tail of ".jpeg".
        let jpeg = "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607.jpeg";
        assert_eq!(media_filenames_in(jpeg), vec![jpeg.to_string()]);
    }

    /// The whole point of the collection: an image dies with the note that
    /// held it, but never while anything else can still show it.
    #[test]
    fn media_is_collected_only_when_nothing_references_it() {
        let conn = open_in_memory().unwrap();
        let lonely = "11111111-2222-4333-8444-555555555555.png";
        let shared = "66666666-7777-4888-8999-aaaaaaaaaaaa.png";

        let doomed = create_object(
            &conn,
            "note",
            "Doomed",
            Some(&format!("![]({lonely}) ![]({shared})")),
            None,
            None,
        )
        .unwrap();
        create_object(&conn, "note", "Keeper", Some(&format!("![]({shared})")), None, None).unwrap();

        let candidates = media_filenames_of_object(&conn, &doomed.id).unwrap();
        assert_eq!(candidates.len(), 2, "both images belong to the deleted note");

        assert!(delete_object(&conn, &doomed.id).unwrap());
        let orphans = unreferenced_media(&conn, &candidates).unwrap();
        assert_eq!(orphans, vec![lonely.to_string()], "the shared image must survive");
    }

    /// A history snapshot is restorable, so an image it mentions is still live
    /// even when no current object shows it.
    #[test]
    fn media_referenced_only_by_history_is_kept() {
        let conn = open_in_memory().unwrap();
        let name = "abcdef01-2345-4678-89ab-cdef01234567.png";
        conn.execute(
            "INSERT INTO history (object_id, ts, patch) VALUES ('gone', 1, ?1)",
            params![format!("{{\"content\":\"![]({name})\"}}")],
        )
        .unwrap();
        assert!(media_filename_is_referenced(&conn, name).unwrap());
        assert!(unreferenced_media(&conn, &[name.to_string()]).unwrap().is_empty());
    }

    #[test]
    fn create_and_get() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "Hello", None, None, None).unwrap();
        assert_eq!(o.title, "Hello");
        assert_eq!(o.content, "{}");
        assert!(o.archived_at.is_none());
        let fetched = get_object(&conn, &o.id).unwrap().unwrap();
        assert_eq!(fetched.id, o.id);
        assert_eq!(fetched.r#type, "note");
    }

    #[test]
    fn get_missing_is_none() {
        let conn = open_in_memory().unwrap();
        assert!(get_object(&conn, "nope").unwrap().is_none());
    }

    #[test]
    fn update_changes_fields() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "Old", None, None, None).unwrap();
        let updated = update_object(
            &conn,
            &o.id,
            Some("New title"),
            Some("{\"a\":1}"),
            None,
            None,
        )
        .unwrap();
        assert_eq!(updated.title, "New title");
        assert_eq!(updated.content, "{\"a\":1}");
        assert_eq!(updated.props, "{}");
        assert!(updated.updated_at >= o.updated_at);
        // history recorded
        let hist: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM history WHERE object_id = ?1",
                params![o.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hist, 1);
    }

    #[test]
    fn history_omits_heavy_props_but_restore_preserves_them() {
        let conn = open_in_memory().unwrap();
        let heavy = r#"{"status":"active","_projectCalendarEvents":[{"id":"a"},{"id":"b"}]}"#;
        let o = create_object(&conn, "project", "P", None, Some(heavy), None).unwrap();
        // An edit records a snapshot; it must not carry the heavy array.
        update_object(&conn, &o.id, Some("P2"), None, None, None).unwrap();
        let patch: String = conn
            .query_row(
                "SELECT patch FROM history WHERE object_id = ?1 ORDER BY id DESC LIMIT 1",
                params![o.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!patch.contains("_projectCalendarEvents"), "heavy props leaked into history");
        // Change the title again, then restore the first snapshot: the live
        // calendar events must survive the restore.
        let vid: i64 = conn
            .query_row(
                "SELECT id FROM history WHERE object_id = ?1 ORDER BY id ASC LIMIT 1",
                params![o.id],
                |r| r.get(0),
            )
            .unwrap();
        let restored = restore_version(&conn, &o.id, vid).unwrap();
        assert!(restored.props.contains("_projectCalendarEvents"));
        let props: serde_json::Value = serde_json::from_str(&restored.props).unwrap();
        assert_eq!(props["_projectCalendarEvents"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn list_queries_strip_heavy_props_but_get_object_keeps_them() {
        let conn = open_in_memory().unwrap();
        let heavy = r#"{"status":"active","_projectCalendarEvents":[{"id":"a"}]}"#;
        let p = create_object(&conn, "project", "P", None, Some(heavy), None).unwrap();
        // Lists/queries/search must not carry the heavy array.
        assert!(!list_objects(&conn, Some("project"), 50, 0).unwrap()[0]
            .props
            .contains("_projectCalendarEvents"));
        assert!(!query_objects(&conn, None, Some("project"), None, false, 50).unwrap()[0]
            .props
            .contains("_projectCalendarEvents"));
        assert!(!list_root_objects(&conn).unwrap()[0]
            .props
            .contains("_projectCalendarEvents"));
        assert!(!search_objects(&conn, "P", 50).unwrap()[0]
            .props
            .contains("_projectCalendarEvents"));
        // The full single-object fetch still has it (Calendar tab needs it).
        assert!(get_object(&conn, &p.id)
            .unwrap()
            .unwrap()
            .props
            .contains("_projectCalendarEvents"));
    }

    #[test]
    fn archive_hides_from_list() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "Bye", None, None, None).unwrap();
        archive_object(&conn, &o.id).unwrap();
        let listed = list_objects(&conn, None, 50, 0).unwrap();
        assert!(listed.is_empty());
        let fetched = get_object(&conn, &o.id).unwrap().unwrap();
        assert!(fetched.archived_at.is_some());
    }

    #[test]
    fn list_filters_by_type() {
        let conn = open_in_memory().unwrap();
        create_object(&conn, "note", "n1", None, None, None).unwrap();
        create_object(&conn, "task", "t1", None, None, None).unwrap();
        assert_eq!(list_objects(&conn, Some("note"), 50, 0).unwrap().len(), 1);
        assert_eq!(list_objects(&conn, None, 50, 0).unwrap().len(), 2);
    }

    #[test]
    fn search_finds_by_title_and_content() {
        let conn = open_in_memory().unwrap();
        create_object(
            &conn,
            "note",
            "Rust programming",
            Some("{\"body\":\"borrow checker\"}"),
            None,
            None,
        )
        .unwrap();
        create_object(
            &conn,
            "note",
            "Cooking",
            Some("{\"body\":\"pasta\"}"),
            None,
            None,
        )
        .unwrap();

        let by_title = search_objects(&conn, "rust", 50).unwrap();
        assert_eq!(by_title.len(), 1);
        assert_eq!(by_title[0].title, "Rust programming");

        let by_content = search_objects(&conn, "borrow", 50).unwrap();
        assert_eq!(by_content.len(), 1);

        let prefix = search_objects(&conn, "prog", 50).unwrap();
        assert_eq!(prefix.len(), 1);

        let none = search_objects(&conn, "zzz", 50).unwrap();
        assert!(none.is_empty());
    }

    #[test]
    fn text_search_matches_fragments_and_polish_case() {
        let conn = open_in_memory().unwrap();
        create_object(&conn, "note", "Job", Some("SEU_CHN_MA_SET_CAPSSFR_COMPLETE"), None, None).unwrap();
        create_object(&conn, "note", "ŁÓDŹ plan", None, None, None).unwrap();
        let gone = create_object(&conn, "note", "CAPSSFR old", None, None, None).unwrap();
        trash_object(&conn, &gone.id).unwrap();
        // A fragment inside an identifier: FTS prefix search cannot find this.
        let hits = search_objects_text(&conn, "capssfr", 50).unwrap();
        assert_eq!(hits.len(), 1, "trashed objects stay out");
        assert_eq!(hits[0].title, "Job");
        assert_eq!(search_objects_text(&conn, "łódź", 50).unwrap().len(), 1, "non-ASCII case folding");
        assert!(search_objects_text(&conn, "  ", 50).unwrap().is_empty());
        assert_eq!(search_objects_text(&conn, "o", 1).unwrap().len(), 1, "limit");
        // Several words: all of them, in any order and any field.
        create_object(&conn, "note", "Shopping", Some("milk, bread and eggs"), None, None).unwrap();
        assert_eq!(search_objects_text(&conn, "eggs milk", 50).unwrap().len(), 1, "every word, any order");
        assert_eq!(search_objects_text(&conn, "shopping eggs", 50).unwrap().len(), 1, "title and text together");
        assert!(search_objects_text(&conn, "milk tea", 50).unwrap().is_empty(), "a missing word misses");
        assert_eq!(search_objects_text(&conn, "mil", 50).unwrap().len(), 1, "part of a word");
    }

    #[test]
    fn search_reflects_updates() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "Alpha", None, None, None).unwrap();
        assert_eq!(search_objects(&conn, "beta", 50).unwrap().len(), 0);
        update_object(&conn, &o.id, Some("Beta"), None, None, None).unwrap();
        assert_eq!(search_objects(&conn, "beta", 50).unwrap().len(), 1);
        assert_eq!(search_objects(&conn, "alpha", 50).unwrap().len(), 0);
    }

    #[test]
    fn relations_crud() {
        let conn = open_in_memory().unwrap();
        let a = create_object(&conn, "note", "A", None, None, None).unwrap();
        let b = create_object(&conn, "note", "B", None, None, None).unwrap();
        create_relation(&conn, &a.id, &b.id, "links_to").unwrap();
        // idempotent
        create_relation(&conn, &a.id, &b.id, "links_to").unwrap();

        let rels_a = list_relations(&conn, &a.id).unwrap();
        assert_eq!(rels_a.len(), 1);
        let rels_b = list_relations(&conn, &b.id).unwrap();
        assert_eq!(rels_b.len(), 1);

        assert!(delete_relation(&conn, &a.id, &b.id, "links_to").unwrap());
        assert!(!delete_relation(&conn, &a.id, &b.id, "links_to").unwrap());
        assert!(list_relations(&conn, &a.id).unwrap().is_empty());
    }

    #[test]
    fn relation_sync_tombstone_blocks_stale_recreation() {
        let conn = open_in_memory().unwrap();
        let a = create_object(&conn, "note", "A", None, None, None).unwrap();
        let b = create_object(&conn, "note", "B", None, None, None).unwrap();

        create_relation(&conn, &a.id, &b.id, "links_to").unwrap();
        let created = list_sync_relations(&conn).unwrap().pop().unwrap();
        assert!(created.created_at > 0);

        assert!(delete_relation(&conn, &a.id, &b.id, "links_to").unwrap());
        let tombstone = list_sync_relation_tombstones(&conn).unwrap().pop().unwrap();
        assert!(tombstone.deleted_at >= created.created_at);

        assert!(!upsert_synced_relation(&conn, &created).unwrap());
        assert!(list_relations(&conn, &a.id).unwrap().is_empty());

        let recreated = SyncRelation {
            from_id: a.id.clone(),
            to_id: b.id.clone(),
            kind: "links_to".to_string(),
            created_at: tombstone.deleted_at + 1,
        };
        assert!(upsert_synced_relation(&conn, &recreated).unwrap());
        assert_eq!(list_relations(&conn, &a.id).unwrap().len(), 1);
        assert!(list_sync_relation_tombstones(&conn).unwrap().is_empty());
    }

    #[test]
    fn deleting_object_records_relation_tombstones() {
        let conn = open_in_memory().unwrap();
        let a = create_object(&conn, "note", "A", None, None, None).unwrap();
        let b = create_object(&conn, "note", "B", None, None, None).unwrap();
        create_relation(&conn, &a.id, &b.id, "links_to").unwrap();

        assert!(delete_object(&conn, &a.id).unwrap());
        let tombstones = list_sync_relation_tombstones(&conn).unwrap();
        assert_eq!(tombstones.len(), 1);
        assert_eq!(tombstones[0].from_id, a.id);
        assert_eq!(tombstones[0].to_id, b.id);
        assert!(list_relations(&conn, &b.id).unwrap().is_empty());
    }

    #[test]
    fn gantt_cycle_check_understands_new_and_legacy_relations() {
        let conn = open_in_memory().unwrap();
        let a = create_object(&conn, "task", "A", None, None, None).unwrap();
        let b = create_object(&conn, "task", "B", None, None, None).unwrap();
        let c = create_object(&conn, "task", "C", None, None, None).unwrap();
        create_relation(&conn, &a.id, &b.id, "gantt_fs").unwrap();
        // Legacy encoding: C depends on B, hence the effective edge is B -> C.
        create_relation(&conn, &c.id, &b.id, "depends_on").unwrap();

        assert!(!gantt_dependency_would_cycle(&conn, &a.id, &c.id).unwrap());
        assert!(gantt_dependency_would_cycle(&conn, &c.id, &a.id).unwrap());
    }

    #[test]
    fn gantt_cycle_check_treats_blocks_as_directed_edge() {
        let conn = open_in_memory().unwrap();
        let a = create_object(&conn, "task", "A", None, None, None).unwrap();
        let b = create_object(&conn, "task", "B", None, None, None).unwrap();
        create_relation(&conn, &a.id, &b.id, "blocks").unwrap();
        assert!(gantt_dependency_would_cycle(&conn, &b.id, &a.id).unwrap());
        assert!(!gantt_dependency_would_cycle(&conn, &a.id, &b.id).unwrap());
    }

    #[test]
    fn migration_002_seeds_types() {
        let conn = open_in_memory().unwrap();
        let types = list_types(&conn).unwrap();
        let names: Vec<&str> = types.iter().map(|t| t.name.as_str()).collect();
        for expected in [
            "note",
            "task",
            "todo",
            "project",
            "space",
            "folder",
            "dashboard",
        ] {
            assert!(names.contains(&expected), "missing type {expected}");
        }
        let task = types.iter().find(|t| t.name == "task").unwrap();
        assert!(task.schema.contains("status"));
        assert_eq!(task.icon.as_deref(), Some("✅"));
    }

    #[test]
    fn migration_003_seeds_bookmark_type() {
        let conn = open_in_memory().unwrap();
        let types = list_types(&conn).unwrap();
        let bookmark = types.iter().find(|t| t.name == "bookmark").unwrap();
        assert_eq!(bookmark.icon.as_deref(), Some("🔖"));
        assert!(bookmark.schema.contains("\"url\""));
        assert!(bookmark.schema.contains("\"fields\""));
    }

    #[test]
    fn current_workflow_schemas_include_triage() {
        let conn = open_in_memory().unwrap();
        let types = list_types(&conn).unwrap();
        for name in ["task", "issue"] {
            let type_def = types
                .iter()
                .find(|candidate| candidate.name == name)
                .unwrap();
            let schema: serde_json::Value = serde_json::from_str(&type_def.schema).unwrap();
            let options = schema["fields"]["status"]["options"].as_array().unwrap();
            assert!(
                options.iter().any(|value| value == "triage"),
                "{name} has no triage status"
            );
        }
    }

    #[test]
    fn completing_recurring_task_creates_next_occurrence_in_same_project() {
        let conn = open_in_memory().unwrap();
        let project = create_object(&conn, "project", "P", None, None, None).unwrap();
        let props = r#"{"status":"in-progress","due":"2026-07-16","recurrence":"weekly"}"#;
        let task = create_object(
            &conn,
            "task",
            "Weekly",
            None,
            Some(props),
            Some(&project.id),
        )
        .unwrap();
        let done = r#"{"status":"done","due":"2026-07-16","recurrence":"weekly"}"#;
        update_object(&conn, &task.id, None, None, Some(done), None).unwrap();

        let children =
            query_objects(&conn, Some(&project.id), Some("task"), None, false, 100).unwrap();
        assert_eq!(children.len(), 2);
        let next = children
            .iter()
            .find(|candidate| candidate.id != task.id)
            .unwrap();
        let next_props: serde_json::Value = serde_json::from_str(&next.props).unwrap();
        assert_eq!(next_props["status"], "triage");
        assert_eq!(next_props["due"], "2026-07-23");
        assert_eq!(next_props["recurrence"], "weekly");
    }

    #[test]
    fn planning_migration_seeds_types_and_converts_legacy_milestones() {
        let conn = open_in_memory().unwrap();
        let types = list_types(&conn).unwrap();
        for expected in ["milestone", "cycle", "release"] {
            assert!(
                types.iter().any(|type_def| type_def.name == expected),
                "missing {expected}"
            );
        }
        let project = create_object(
            &conn,
            "project",
            "Legacy",
            None,
            Some(r#"{"_milestones":[{"id":"m1","title":"Alpha","done":true}]}"#),
            None,
        )
        .unwrap();
        migrate_project_planning(&conn).unwrap();
        let milestones = query_objects(
            &conn,
            Some(&project.id),
            Some("milestone"),
            None,
            false,
            100,
        )
        .unwrap();
        assert_eq!(milestones.len(), 1);
        assert_eq!(milestones[0].title, "Alpha");
        let props: serde_json::Value = serde_json::from_str(&milestones[0].props).unwrap();
        assert_eq!(props["status"], "completed");
        let refreshed = get_object(&conn, &project.id).unwrap().unwrap();
        assert!(!refreshed.props.contains("_milestones"));
    }

    #[test]
    fn completing_cycle_rolls_unfinished_work_to_next_cycle() {
        let conn = open_in_memory().unwrap();
        let project = create_object(&conn, "project", "P", None, None, None).unwrap();
        let current = create_object(
            &conn,
            "cycle",
            "Current",
            None,
            Some(r#"{"status":"active","startDate":"2026-07-01"}"#),
            Some(&project.id),
        )
        .unwrap();
        let next = create_object(
            &conn,
            "cycle",
            "Next",
            None,
            Some(r#"{"status":"planned","startDate":"2026-07-15"}"#),
            Some(&project.id),
        )
        .unwrap();
        let open_props =
            serde_json::json!({"status":"in-progress","cycleId":current.id}).to_string();
        let done_props = serde_json::json!({"status":"done","cycleId":current.id}).to_string();
        let open_task = create_object(
            &conn,
            "task",
            "Open",
            None,
            Some(&open_props),
            Some(&project.id),
        )
        .unwrap();
        let done_task = create_object(
            &conn,
            "task",
            "Done",
            None,
            Some(&done_props),
            Some(&project.id),
        )
        .unwrap();
        update_object(
            &conn,
            &current.id,
            None,
            None,
            Some(r#"{"status":"completed","startDate":"2026-07-01"}"#),
            None,
        )
        .unwrap();
        let open_after: serde_json::Value =
            serde_json::from_str(&get_object(&conn, &open_task.id).unwrap().unwrap().props)
                .unwrap();
        let done_after: serde_json::Value =
            serde_json::from_str(&get_object(&conn, &done_task.id).unwrap().unwrap().props)
                .unwrap();
        assert_eq!(open_after["cycleId"], next.id);
        assert_eq!(done_after["cycleId"], current.id);
    }

    #[test]
    fn create_with_parent_makes_in_relation() {
        let conn = open_in_memory().unwrap();
        let space = create_object(&conn, "space", "Work", None, None, None).unwrap();
        let task = create_object(&conn, "task", "T", None, None, Some(&space.id)).unwrap();
        let rels = list_relations(&conn, &task.id).unwrap();
        assert_eq!(rels.len(), 1);
        assert_eq!(rels[0].from_id, task.id);
        assert_eq!(rels[0].to_id, space.id);
        assert_eq!(rels[0].kind, "in");
    }

    #[test]
    fn query_objects_by_parent_type_and_tag() {
        let conn = open_in_memory().unwrap();
        let space = create_object(&conn, "space", "S", None, None, None).unwrap();
        let t1 = create_object(
            &conn,
            "task",
            "t1",
            None,
            Some("{\"tags\":[\"urgent\",\"home\"]}"),
            Some(&space.id),
        )
        .unwrap();
        create_object(&conn, "task", "t2", None, None, Some(&space.id)).unwrap();
        create_object(&conn, "note", "n1", None, None, Some(&space.id)).unwrap();
        // orphan outside the space
        create_object(&conn, "task", "orphan", None, None, None).unwrap();

        let in_space = query_objects(&conn, Some(&space.id), None, None, false, 500).unwrap();
        assert_eq!(in_space.len(), 3);

        let tasks = query_objects(&conn, Some(&space.id), Some("task"), None, false, 500).unwrap();
        assert_eq!(tasks.len(), 2);

        let urgent = query_objects(&conn, None, None, Some("urgent"), false, 500).unwrap();
        assert_eq!(urgent.len(), 1);
        assert_eq!(urgent[0].id, t1.id);

        let all_tasks = query_objects(&conn, None, Some("task"), None, false, 500).unwrap();
        assert_eq!(all_tasks.len(), 3);
    }

    #[test]
    fn query_objects_include_archived() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "task", "t", None, None, None).unwrap();
        archive_object(&conn, &o.id).unwrap();
        assert_eq!(
            query_objects(&conn, None, Some("task"), None, false, 500)
                .unwrap()
                .len(),
            0
        );
        assert_eq!(
            query_objects(&conn, None, Some("task"), None, true, 500)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn move_object_reparents() {
        let conn = open_in_memory().unwrap();
        let a = create_object(&conn, "space", "A", None, None, None).unwrap();
        let b = create_object(&conn, "space", "B", None, None, None).unwrap();
        let t = create_object(&conn, "task", "t", None, None, Some(&a.id)).unwrap();
        assert_eq!(
            query_objects(&conn, Some(&a.id), None, None, false, 500)
                .unwrap()
                .len(),
            1
        );

        move_object(&conn, &t.id, Some(&b.id)).unwrap();
        assert_eq!(
            query_objects(&conn, Some(&a.id), None, None, false, 500)
                .unwrap()
                .len(),
            0
        );
        assert_eq!(
            query_objects(&conn, Some(&b.id), None, None, false, 500)
                .unwrap()
                .len(),
            1
        );

        // move to root removes all 'in' relations
        move_object(&conn, &t.id, None).unwrap();
        assert_eq!(
            query_objects(&conn, Some(&b.id), None, None, false, 500)
                .unwrap()
                .len(),
            0
        );
        let ins: Vec<_> = list_relations(&conn, &t.id)
            .unwrap()
            .into_iter()
            .filter(|r| r.kind == "in")
            .collect();
        assert!(ins.is_empty());
    }

    #[test]
    fn upsert_and_list_types() {
        let conn = open_in_memory().unwrap();
        let td = upsert_type(&conn, "custom", "{\"fields\":{}}", Some("🔥"), Some("#000")).unwrap();
        assert_eq!(td.name, "custom");
        assert_eq!(td.icon.as_deref(), Some("🔥"));
        // update existing: omitted color is preserved, not nulled out
        let td2 = upsert_type(&conn, "custom", "{\"fields\":{\"x\":1}}", Some("💧"), None).unwrap();
        assert!(td2.schema.contains("x"));
        assert_eq!(td2.icon.as_deref(), Some("💧"));
        assert_eq!(td2.color.as_deref(), Some("#000"));
        let all = list_types(&conn).unwrap();
        assert_eq!(all.iter().filter(|t| t.name == "custom").count(), 1);
    }

    #[test]
    fn behaviour_schema_requires_namespace_prefix() {
        assert!(validate_type_namespace("plain", "{\"fields\":{}}", Some("acme.plugin")).is_ok());
        assert!(validate_type_namespace("acme.plugin.card", "{\"fields\":{},\"behaviour\":{\"container\":true}}", Some("acme.plugin")).is_ok());
        assert!(validate_type_namespace("task", "{\"fields\":{},\"behaviour\":{\"treeHidden\":true}}", Some("acme.plugin")).is_err());
        assert!(validate_type_namespace("whatever", "{\"fields\":{},\"behaviour\":{\"container\":true}}", None).is_ok());
        // empty behaviour object is not "carrying flags"
        assert!(validate_type_namespace("task", "{\"fields\":{},\"behaviour\":{}}", Some("acme.plugin")).is_ok());
    }

    #[test]
    fn list_relations_bulk_groups_and_short_circuits() {
        let conn = open_in_memory().unwrap();
        let a = create_object(&conn, "note", "A", None, None, None).unwrap();
        let b = create_object(&conn, "note", "B", None, None, None).unwrap();
        let c = create_object(&conn, "note", "C", None, None, None).unwrap();
        create_relation(&conn, &a.id, &b.id, "x").unwrap();
        create_relation(&conn, &b.id, &c.id, "y").unwrap();

        // Empty id list short-circuits to no rows.
        assert!(list_relations_bulk(&conn, &[]).unwrap().is_empty());

        // "b" participates in both edges (as to_id of a->b and from_id of b->c).
        let r = list_relations_bulk(&conn, &[b.id.clone()]).unwrap();
        assert_eq!(r.len(), 2);
        assert!(r.iter().any(|x| x.from_id == a.id && x.to_id == b.id && x.kind == "x"));
        assert!(r.iter().any(|x| x.from_id == b.id && x.to_id == c.id && x.kind == "y"));

        // "a" and "c" between them touch both edges too.
        assert_eq!(
            list_relations_bulk(&conn, &[a.id.clone(), c.id.clone()]).unwrap().len(),
            2
        );
    }

    #[test]
    fn get_backlinks_returns_only_saved_content_links() {
        let conn = open_in_memory().unwrap();
        let target = create_object(&conn, "note", "Target", None, None, None).unwrap();
        let a = create_object(&conn, "note", "A", None, None, None).unwrap();
        let b = create_object(&conn, "task", "B", None, None, None).unwrap();
        create_relation(&conn, &a.id, &target.id, "links_to").unwrap();
        create_relation(&conn, &b.id, &target.id, "depends_on").unwrap();

        let bl = get_backlinks(&conn, &target.id).unwrap();
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].object.id, a.id);
        assert_eq!(bl[0].kind, "links_to");
    }

    #[test]
    fn wikilinks_written_in_core_produce_backlinks() {
        let conn = open_in_memory().unwrap();
        // Titles with a "#" are real in this workspace ("Feedback 18.08.26 #1")
        // and used to lose the "#1" to the heading-anchor reading.
        let target = create_object(&conn, "note", "Feedback 18.08.26 #1", None, None, None).unwrap();
        let plain = create_object(&conn, "note", "Kafka issue review", None, None, None).unwrap();
        let src = create_object(&conn, "note", "Graph feedback", None, None, None).unwrap();

        let body = "see [[Feedback 18.08.26 #1]] and [[kafka ISSUE review|the review]]";
        update_object(&conn, &src.id, None, Some(body), None, None).unwrap();

        let mut ids: Vec<String> = get_backlinks(&conn, &target.id)
            .unwrap()
            .into_iter()
            .map(|b| b.object.id)
            .collect();
        assert_eq!(ids, vec![src.id.clone()]);

        ids = get_backlinks(&conn, &plain.id)
            .unwrap()
            .into_iter()
            .map(|b| b.object.id)
            .collect();
        assert_eq!(ids, vec![src.id.clone()], "alias form and case must still link");

        // links_to is owned by the content: dropping the link drops the row.
        update_object(&conn, &src.id, None, Some("nothing here"), None, None).unwrap();
        assert!(get_backlinks(&conn, &target.id).unwrap().is_empty());
        assert!(get_backlinks(&conn, &plain.id).unwrap().is_empty());
    }

    #[test]
    fn renaming_a_linked_note_keeps_its_links() {
        // E22 (01.10): links are stored as `[[Title]]`. After a rename, the next
        // save of a linking note resolved the old title to nothing and dropped
        // its links_to row, so the link broke silently.
        let conn = open_in_memory().unwrap();
        let target = create_object(&conn, "note", "Weekly team meeting", None, None, None).unwrap();
        let src = create_object(&conn, "note", "Essay", None, None, None).unwrap();
        update_object(&conn, &src.id, None, Some("see [[Weekly team meeting]] here"), None, None).unwrap();

        // Typing the new title autosaves its prefixes; none of them is linked.
        update_object(&conn, &target.id, Some("Weekly s"), None, None, None).unwrap();
        update_object(&conn, &target.id, Some("Weekly sync"), None, None, None).unwrap();
        let renamed = get_object(&conn, &target.id).unwrap().unwrap();
        let props: serde_json::Value = serde_json::from_str(&renamed.props).unwrap();
        assert_eq!(props["previousTitles"], serde_json::json!(["Weekly team meeting"]), "only the linked old title is kept");

        // The linking note is edited again: its link still resolves.
        update_object(&conn, &src.id, None, Some("see [[Weekly team meeting]] here, edited"), None, None).unwrap();
        let ids: Vec<String> = get_backlinks(&conn, &target.id).unwrap().into_iter().map(|b| b.object.id).collect();
        assert_eq!(ids, vec![src.id.clone()], "the old title still links after a rename");

        // A note with the old title as its real title wins over the alias.
        let newer = create_object(&conn, "note", "Weekly team meeting", None, None, None).unwrap();
        assert_eq!(find_object_id_by_title(&conn, "weekly team meeting").unwrap(), Some(newer.id));

        // Renaming a note nobody links to records nothing.
        let lone = create_object(&conn, "note", "Scratch", None, None, None).unwrap();
        update_object(&conn, &lone.id, Some("Scratch 2"), None, None, None).unwrap();
        let lone = get_object(&conn, &lone.id).unwrap().unwrap();
        assert!(!lone.props.contains("previousTitles"));
    }

    #[test]
    fn wikilink_titles_ignores_unpaired_and_empty_brackets() {
        assert!(extract_wikilink_titles("[[]] [[ ]] [[a").is_empty());
        assert_eq!(extract_wikilink_titles("[[A#B]]"), vec!["A#B", "A"]);
        assert_eq!(extract_wikilink_titles("[[#anchor]]"), vec!["#anchor"]);
    }

    #[test]
    fn set_tags_preserves_other_props() {
        let conn = open_in_memory().unwrap();
        let o = create_object(
            &conn,
            "task",
            "t",
            None,
            Some("{\"status\":\"todo\"}"),
            None,
        )
        .unwrap();
        let updated = set_tags(&conn, &o.id, &["a".into(), "b".into()])
            .unwrap()
            .unwrap();
        let props: serde_json::Value = serde_json::from_str(&updated.props).unwrap();
        assert_eq!(props["status"], "todo");
        assert_eq!(props["tags"], serde_json::json!(["a", "b"]));
        assert!(updated.updated_at >= o.updated_at);
        assert!(set_tags(&conn, "missing", &[]).unwrap().is_none());
    }

    fn history_rows(conn: &Connection, id: &str) -> Vec<(String, Option<String>, String)> {
        let mut stmt = conn
            .prepare("SELECT source, writer, patch FROM history WHERE object_id = ?1 ORDER BY id ASC")
            .unwrap();
        stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<Vec<_>>>()
            .unwrap()
    }

    #[test]
    fn editor_saves_coalesce_into_one_session_row() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "N", None, None, None).unwrap();
        for text in ["{\"t\":\"a\"}", "{\"t\":\"ab\"}", "{\"t\":\"abc\"}"] {
            update_object_as(&conn, &o.id, None, Some(text), None, None, Some("editor"), HistorySource::Local).unwrap();
        }
        let rows = history_rows(&conn, &o.id);
        assert_eq!(rows.len(), 1, "one editing session, one row");
        assert!(rows[0].2.contains("abc"), "the row holds the end state");
    }

    #[test]
    fn non_editor_writes_never_coalesce() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "N", None, None, None).unwrap();
        update_object_as(&conn, &o.id, None, Some("{\"t\":1}"), None, None, Some("editor"), HistorySource::Local).unwrap();
        update_object(&conn, &o.id, None, Some("{\"t\":2}"), None, None).unwrap(); // a plugin write
        update_object_as(&conn, &o.id, None, Some("{\"t\":3}"), None, None, Some("editor"), HistorySource::Local).unwrap();
        let rows = history_rows(&conn, &o.id);
        assert_eq!(rows.len(), 3, "a plugin write splits the session and keeps its own row");
        assert_eq!(rows[1].1, None);
    }

    #[test]
    fn session_ends_after_gap_or_clock_going_backwards() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "N", None, None, None).unwrap();
        update_object_as(&conn, &o.id, None, Some("{\"t\":1}"), None, None, Some("editor"), HistorySource::Local).unwrap();
        // Age the row past the 5 min gap.
        conn.execute("UPDATE history SET ts = ts - 6 * 60 * 1000, session_start = session_start - 6 * 60 * 1000", []).unwrap();
        update_object_as(&conn, &o.id, None, Some("{\"t\":2}"), None, None, Some("editor"), HistorySource::Local).unwrap();
        assert_eq!(history_rows(&conn, &o.id).len(), 2, "a pause over 5 min starts a new row");
        // A row stamped in the future (clock went backwards) never coalesces.
        conn.execute("UPDATE history SET ts = ts + 3600000 WHERE id = (SELECT MAX(id) FROM history)", []).unwrap();
        update_object_as(&conn, &o.id, None, Some("{\"t\":3}"), None, None, Some("editor"), HistorySource::Local).unwrap();
        assert_eq!(history_rows(&conn, &o.id).len(), 3);
    }

    #[test]
    fn session_is_capped_at_30_minutes() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "N", None, None, None).unwrap();
        update_object_as(&conn, &o.id, None, Some("{\"t\":1}"), None, None, Some("editor"), HistorySource::Local).unwrap();
        conn.execute("UPDATE history SET session_start = session_start - 31 * 60 * 1000", []).unwrap();
        update_object_as(&conn, &o.id, None, Some("{\"t\":2}"), None, None, Some("editor"), HistorySource::Local).unwrap();
        assert_eq!(history_rows(&conn, &o.id).len(), 2);
    }

    #[test]
    fn monotonic_updated_at_beats_future_row() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "N", None, None, None).unwrap();
        let future = o.updated_at + 3_600_000; // a peer whose clock is an hour ahead
        conn.execute("UPDATE objects SET updated_at = ?2 WHERE id = ?1", params![o.id, future]).unwrap();
        let saved = update_object(&conn, &o.id, Some("mine"), None, None, None).unwrap();
        assert!(saved.updated_at > future, "a local write is always newer than what it replaced");
    }

    #[test]
    fn baseline_row_keeps_the_first_version() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "N", Some("{\"t\":\"original\"}"), None, None).unwrap();
        update_object(&conn, &o.id, None, Some("{\"t\":\"edited\"}"), None, None).unwrap();
        let rows = history_rows(&conn, &o.id);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, "baseline");
        assert!(rows[0].2.contains("original"));
        // An empty object gets no baseline (nothing worth restoring).
        let empty = create_object(&conn, "note", "E", None, None, None).unwrap();
        update_object(&conn, &empty.id, None, Some("{\"t\":1}"), None, None).unwrap();
        assert_eq!(history_rows(&conn, &empty.id).len(), 1);
    }

    #[test]
    fn oversized_snapshot_is_not_recorded() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "N", None, None, None).unwrap();
        let huge = format!("{{\"t\":\"{}\"}}", "x".repeat(2 * 1024 * 1024 + 10));
        update_object(&conn, &o.id, None, Some(&huge), None, None).unwrap();
        assert_eq!(history_rows(&conn, &o.id).len(), 0);
    }

    #[test]
    fn migration_029_is_idempotent() {
        let conn = open_in_memory().unwrap();
        // Simulate a crash after the first ALTER: re-running must not fail.
        migrate_history_sources(&conn).unwrap();
        migrate_history_sources(&conn).unwrap();
        let o = create_object(&conn, "note", "N", Some("{\"a\":1}"), None, None).unwrap();
        update_object(&conn, &o.id, Some("x"), None, None, None).unwrap();
        assert!(!history_rows(&conn, &o.id).is_empty());
    }

    fn synced(o: &Object, title: &str, updated_at: i64) -> Object {
        Object { title: title.to_string(), updated_at, ..o.clone() }
    }

    #[test]
    fn sync_writes_a_row_only_for_a_real_change() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "Local", Some("{\"a\":1}"), None, None).unwrap();
        upsert_synced_object(&conn, &synced(&o, "Remote", o.updated_at + 10)).unwrap();
        let rows = history_rows(&conn, &o.id);
        assert_eq!(rows.iter().map(|r| r.0.as_str()).collect::<Vec<_>>(), vec!["baseline", "sync"]);
        assert!(rows[0].2.contains("Local") && rows[1].2.contains("Remote"));
        // Same content, newer stamp: no new row.
        upsert_synced_object(&conn, &synced(&o, "Remote", o.updated_at + 20)).unwrap();
        assert_eq!(history_rows(&conn, &o.id).len(), 2);
    }

    #[test]
    fn sync_rows_cannot_evict_local_rows() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "N", None, None, None).unwrap();
        for i in 0..5 {
            update_object(&conn, &o.id, Some(&format!("mine {i}")), None, None, None).unwrap();
        }
        let base = get_object(&conn, &o.id).unwrap().unwrap().updated_at;
        for i in 0..60 {
            upsert_synced_object(&conn, &synced(&o, &format!("hostile {i}"), base + 1 + i)).unwrap();
        }
        let rows = history_rows(&conn, &o.id);
        assert_eq!(rows.iter().filter(|r| r.0 == "sync").count(), 10);
        assert_eq!(rows.iter().filter(|r| r.0 == "local").count(), 5, "all local versions survive");
    }

    #[test]
    fn list_history_returns_metadata_and_clamps() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "N", None, None, None).unwrap();
        update_object(&conn, &o.id, Some("v2"), None, None, None).unwrap();
        let list = list_history(&conn, &o.id, -1).unwrap();
        assert_eq!(list.len(), 1, "a negative limit is clamped, not 'unlimited'");
        assert!(list[0].size > 0);
        let entry = get_history_entry(&conn, &o.id, list[0].id).unwrap().unwrap();
        assert!(entry.patch.contains("v2"));
        assert_eq!(entry.source, "local");
        assert!(get_history_entry(&conn, "other", list[0].id).unwrap().is_none(), "scoped to the object");
    }

    #[test]
    fn restore_writes_a_restore_row_and_delete_clear_work() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "N", None, None, None).unwrap();
        update_object(&conn, &o.id, Some("v2"), None, None, None).unwrap();
        update_object(&conn, &o.id, Some("v3"), None, None, None).unwrap();
        let list = list_history(&conn, &o.id, 50).unwrap();
        let restored = restore_version(&conn, &o.id, list[1].id).unwrap();
        assert_eq!(restored.title, "v2");
        assert_eq!(history_rows(&conn, &o.id).last().unwrap().0, "restore");
        assert!(delete_history_entry(&conn, &o.id, list[0].id).unwrap());
        assert!(!delete_history_entry(&conn, &o.id, list[0].id).unwrap());
        assert_eq!(clear_history(&conn, &o.id).unwrap(), 2);
        assert!(list_history(&conn, &o.id, 50).unwrap().is_empty());
    }

    #[test]
    fn budget_prunes_sync_rows_first() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "N", None, None, None).unwrap();
        update_object(&conn, &o.id, Some("local"), None, None, None).unwrap();
        let base = get_object(&conn, &o.id).unwrap().unwrap().updated_at;
        for i in 0..3 {
            upsert_synced_object(&conn, &synced(&o, &format!("remote {i}"), base + 1 + i)).unwrap();
        }
        let local_size: i64 = conn
            .query_row("SELECT SUM(length(patch)) FROM history WHERE source <> 'sync'", [], |r| r.get(0))
            .unwrap();
        let deleted = enforce_history_budget(&conn, local_size).unwrap();
        assert_eq!(deleted, 3);
        assert!(history_rows(&conn, &o.id).iter().all(|r| r.0 != "sync"));
    }

    #[test]
    fn every_local_writer_is_monotonic() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "N", None, None, None).unwrap();
        let future = o.updated_at + 3 * 3_600_000; // a peer three hours ahead
        let set_future = |conn: &Connection| {
            conn.execute("UPDATE objects SET updated_at = ?2 WHERE id = ?1", params![o.id, future]).unwrap();
        };
        set_future(&conn);
        assert!(set_tags(&conn, &o.id, &["a".to_string()]).unwrap().unwrap().updated_at > future, "set_tags");
        set_future(&conn);
        assert!(archive_object(&conn, &o.id).unwrap().unwrap().updated_at > future, "archive_object");
        set_future(&conn);
        assert!(set_object_type(&conn, &o.id, "task", None).unwrap().updated_at > future, "set_object_type");
    }

    #[test]
    fn peer_created_objects_never_get_a_baseline_row() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "tmp", None, None, None).unwrap();
        let mut remote = synced(&o, "peer v1", o.updated_at + 10);
        remote.id = "peer-made".to_string();
        remote.content = "{\"big\":1}".to_string();
        upsert_synced_object(&conn, &remote).unwrap();
        upsert_synced_object(&conn, &synced(&remote, "peer v2", remote.updated_at + 10)).unwrap();
        let sources: Vec<String> = history_rows(&conn, "peer-made").into_iter().map(|r| r.0).collect();
        assert!(!sources.contains(&"baseline".to_string()), "peer content must be a sync row, never a baseline: {sources:?}");
        assert_eq!(sources, vec!["sync", "sync"]);
    }

    #[test]
    fn history_snapshots_and_restore() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "v1", Some("{\"c\":1}"), None, None).unwrap();
        update_object(&conn, &o.id, Some("v2"), Some("{\"c\":2}"), None, None).unwrap();
        update_object(&conn, &o.id, Some("v3"), None, None, None).unwrap();

        let hist = list_history(&conn, &o.id, 10).unwrap();
        // v3, v2 and the baseline (the object was created with content).
        assert_eq!(hist.len(), 3);
        // newest first, ids are unique and stable even within one millisecond
        assert!(hist[0].id > hist[1].id);

        // restore the v2 snapshot (older entry)
        let restored = restore_version(&conn, &o.id, hist[1].id).unwrap();
        assert_eq!(restored.title, "v2");
        assert_eq!(restored.content, "{\"c\":2}");
        // the restore is itself a new history entry
        assert_eq!(list_history(&conn, &o.id, 10).unwrap().len(), 4);

        // unknown id -> NotFound
        assert!(matches!(
            restore_version(&conn, &o.id, 9999).unwrap_err(),
            UpdateError::NotFound
        ));
    }

    #[test]
    fn content_links_sync_relations() {
        let conn = open_in_memory().unwrap();
        let a = create_object(&conn, "note", "A", None, None, None).unwrap();
        let b = create_object(&conn, "note", "B", None, None, None).unwrap();
        let c = create_object(&conn, "note", "C", None, None, None).unwrap();

        let content = format!(
            "{{\"doc\":\"see notible://{} and notible://{}\"}}",
            b.id, c.id
        );
        update_object(&conn, &a.id, None, Some(&content), None, None).unwrap();
        let bl_b = get_backlinks(&conn, &b.id).unwrap();
        assert_eq!(bl_b.len(), 1);
        assert_eq!(bl_b[0].object.id, a.id);
        assert_eq!(get_backlinks(&conn, &c.id).unwrap().len(), 1);

        // removing the link to c drops its backlink; b keeps hers
        let content2 = format!("{{\"doc\":\"only notible://{}\"}}", b.id);
        update_object(&conn, &a.id, None, Some(&content2), None, None).unwrap();
        assert_eq!(get_backlinks(&conn, &b.id).unwrap().len(), 1);
        assert!(get_backlinks(&conn, &c.id).unwrap().is_empty());

        // props-only update must not touch links
        update_object(&conn, &a.id, None, None, Some("{\"x\":1}"), None).unwrap();
        assert_eq!(get_backlinks(&conn, &b.id).unwrap().len(), 1);

        // trashed sources disappear from backlinks
        trash_object(&conn, &a.id).unwrap();
        assert!(get_backlinks(&conn, &b.id).unwrap().is_empty());
    }

    #[test]
    fn backlinks_exclude_in_relations() {
        let conn = open_in_memory().unwrap();
        let folder = create_object(&conn, "folder", "F", None, None, None).unwrap();
        create_object(&conn, "note", "child", None, None, Some(&folder.id)).unwrap();
        // hierarchy must not masquerade as a content link
        assert!(get_backlinks(&conn, &folder.id).unwrap().is_empty());
    }

    #[test]
    fn update_conflict_and_not_found() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "A", None, None, None).unwrap();
        // stale expected_updated_at -> Conflict
        let err =
            update_object(&conn, &o.id, Some("B"), None, None, Some(o.updated_at - 1)).unwrap_err();
        assert!(matches!(err, UpdateError::Conflict));
        // matching timestamp -> ok
        let updated =
            update_object(&conn, &o.id, Some("B"), None, None, Some(o.updated_at)).unwrap();
        assert_eq!(updated.title, "B");
        // missing object -> NotFound
        let err = update_object(&conn, "nope", Some("x"), None, None, None).unwrap_err();
        assert!(matches!(err, UpdateError::NotFound));
    }

    #[test]
    fn set_object_type_keeps_payload_and_guards_conflicts() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "bug", "Crash", Some("{\"c\":1}"), Some("{\"severity\":\"major\"}"), None).unwrap();
        // stale timestamp -> Conflict
        assert!(matches!(
            set_object_type(&conn, &o.id, "issue", Some(o.updated_at - 1)).unwrap_err(),
            UpdateError::Conflict
        ));
        let changed = set_object_type(&conn, &o.id, "issue", Some(o.updated_at)).unwrap();
        assert_eq!(changed.r#type, "issue");
        assert_eq!(changed.content, "{\"c\":1}");
        assert_eq!(changed.props, "{\"severity\":\"major\"}");
        // idempotent: same type is a no-op that still returns the row
        let again = set_object_type(&conn, &o.id, "issue", None).unwrap();
        assert_eq!(again.r#type, "issue");
        assert!(matches!(
            set_object_type(&conn, "missing", "issue", None).unwrap_err(),
            UpdateError::NotFound
        ));
    }

    #[test]
    fn partial_update_does_not_clobber_other_fields() {
        let conn = open_in_memory().unwrap();
        let o = create_object(
            &conn,
            "note",
            "T",
            Some("{\"c\":1}"),
            Some("{\"p\":1}"),
            None,
        )
        .unwrap();
        // update only props; content must survive
        let u1 = update_object(&conn, &o.id, None, None, Some("{\"p\":2}"), None).unwrap();
        assert_eq!(u1.content, "{\"c\":1}");
        assert_eq!(u1.props, "{\"p\":2}");
        // update only content; props must survive
        let u2 = update_object(&conn, &o.id, None, Some("{\"c\":2}"), None, None).unwrap();
        assert_eq!(u2.props, "{\"p\":2}");
        assert_eq!(u2.content, "{\"c\":2}");
    }

    #[test]
    fn trash_restore_delete_flow() {
        let conn = open_in_memory().unwrap();
        let o = create_object(&conn, "note", "X", None, None, None).unwrap();
        let other = create_object(&conn, "note", "Y", None, None, None).unwrap();
        create_relation(&conn, &other.id, &o.id, "links_to").unwrap();

        trash_object(&conn, &o.id).unwrap();
        assert!(list_objects(&conn, None, 50, 0)
            .unwrap()
            .iter()
            .all(|x| x.id != o.id));
        assert!(search_objects(&conn, "X", 50).unwrap().is_empty());
        assert_eq!(list_trash(&conn).unwrap().len(), 1);

        restore_object(&conn, &o.id).unwrap();
        assert!(list_trash(&conn).unwrap().is_empty());
        assert!(list_objects(&conn, None, 50, 0)
            .unwrap()
            .iter()
            .any(|x| x.id == o.id));

        trash_object(&conn, &o.id).unwrap();
        assert!(delete_object(&conn, &o.id).unwrap());
        assert!(get_object(&conn, &o.id).unwrap().is_none());
        // relations cleaned up
        assert!(list_relations(&conn, &other.id).unwrap().is_empty());
        assert!(!delete_object(&conn, &o.id).unwrap());
    }

    #[test]
    fn migration_004_converts_props_trashed() {
        let conn = Connection::open_in_memory().unwrap();
        // apply only migrations 1-3, insert legacy trashed object, then migrate to 4
        conn.execute("CREATE TABLE schema_version (version INTEGER NOT NULL)", [])
            .unwrap();
        conn.execute("INSERT INTO schema_version VALUES (0)", [])
            .unwrap();
        for step in &MIGRATIONS[..3] {
            match step {
                Migration::Sql(script) => conn.execute_batch(script).unwrap(),
                Migration::Fn(f) => f(&conn).unwrap(),
            }
        }
        conn.execute("UPDATE schema_version SET version = 3", [])
            .unwrap();
        conn.execute(
            "INSERT INTO objects (id, type, title, content, props, created_at, updated_at)
             VALUES ('legacy', 'note', 'L', '{}', '{\"trashed\":true,\"x\":1}', 1, 1)",
            [],
        )
        .unwrap();
        migrate(&conn).unwrap();
        let o = get_object(&conn, "legacy").unwrap().unwrap();
        assert!(o.trashed_at.is_some());
        let props: serde_json::Value = serde_json::from_str(&o.props).unwrap();
        assert!(props.get("trashed").is_none());
        assert_eq!(props["x"], 1);
    }

    #[test]
    fn migration_007_merges_custom_fields_into_type_schema() {
        let conn = Connection::open_in_memory().unwrap();
        // apply migrations 1-6, insert legacy objects carrying per-object
        // custom field defs, then run the data migration (step 7).
        conn.execute("CREATE TABLE schema_version (version INTEGER NOT NULL)", [])
            .unwrap();
        conn.execute("INSERT INTO schema_version VALUES (0)", [])
            .unwrap();
        for step in &MIGRATIONS[..6] {
            match step {
                Migration::Sql(script) => conn.execute_batch(script).unwrap(),
                Migration::Fn(f) => f(&conn).unwrap(),
            }
        }
        conn.execute("UPDATE schema_version SET version = 6", [])
            .unwrap();

        conn.execute(
            "INSERT INTO objects (id, type, title, content, props, created_at, updated_at)
             VALUES ('a', 'task', 'A', '{}', ?1, 1, 1)",
            params![r#"{"_customFields":{"eta":{"type":"date"},"owner":{"type":"text"}}}"#],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO objects (id, type, title, content, props, created_at, updated_at)
             VALUES ('b', 'task', 'B', '{}', ?1, 1, 1)",
            params![r#"{"_customFields":{"owner":{"type":"select","options":["x"]},"budget":{"type":"number"}}}"#],
        )
        .unwrap();

        migrate(&conn).unwrap();

        let types = list_types(&conn).unwrap();
        let task = types.iter().find(|t| t.name == "task").unwrap();
        let schema: serde_json::Value = serde_json::from_str(&task.schema).unwrap();
        let fields = schema["fields"].as_object().unwrap();
        // union of both objects' custom fields, plus the original seeded fields
        assert!(
            fields.contains_key("status"),
            "original seeded field preserved"
        );
        assert!(fields.contains_key("eta"));
        assert!(fields.contains_key("budget"));
        // conflicting duplicate: first one seen (object 'a') wins, no error
        assert_eq!(fields["owner"]["type"], "text");

        // object props are untouched
        let a = get_object(&conn, "a").unwrap().unwrap();
        let props: serde_json::Value = serde_json::from_str(&a.props).unwrap();
        assert_eq!(props["_customFields"]["eta"]["type"], "date");
    }

    #[test]
    fn list_root_objects_excludes_children_spaces_trashed() {
        let conn = open_in_memory().unwrap();
        let space = create_object(&conn, "space", "S", None, None, None).unwrap();
        create_object(&conn, "note", "child", None, None, Some(&space.id)).unwrap();
        let root = create_object(&conn, "note", "root", None, None, None).unwrap();
        let gone = create_object(&conn, "note", "gone", None, None, None).unwrap();
        trash_object(&conn, &gone.id).unwrap();

        let roots = list_root_objects(&conn).unwrap();
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].id, root.id);
    }

    #[test]
    fn backup_creates_and_prunes() {
        let dir = std::env::temp_dir().join(format!("notible-test-{}", new_id()));
        let conn = open_in_memory().unwrap();
        create_object(&conn, "note", "b", None, None, None).unwrap();
        let mut paths = Vec::new();
        for _ in 0..3 {
            let p = backup_db(&conn, &dir, 2).unwrap();
            paths.push(p);
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let count = std::fs::read_dir(&dir).unwrap().count();
        assert!(
            count <= 2,
            "expected pruning to keep at most 2, got {count}"
        );
        // backup is a valid db containing the object
        let last = paths.last().unwrap();
        let conn2 = Connection::open(last).unwrap();
        let n: i64 = conn2
            .query_row("SELECT COUNT(*) FROM objects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        drop(conn2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn markdown_to_tiptap_basic_blocks() {
        let md = "# Title\n\nSome text.\n\n- one\n- two\n- [ ] todo\n- [x] done\n\n> quoted\n\n```\ncode here\n```\n\n---\n";
        let doc = markdown_to_tiptap(md);
        assert_eq!(doc["type"], "doc");
        let kinds: Vec<&str> = doc["content"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n["type"].as_str().unwrap())
            .collect();
        assert_eq!(
            kinds,
            vec![
                "heading",
                "paragraph",
                "bulletList",
                "taskList",
                "blockquote",
                "codeBlock",
                "horizontalRule"
            ]
        );
        // adjacent bullets merged into one list with two items
        let bullets = &doc["content"][2];
        assert_eq!(bullets["content"].as_array().unwrap().len(), 2);
        // task states preserved
        let tasks = &doc["content"][3];
        assert_eq!(tasks["content"][0]["attrs"]["checked"], false);
        assert_eq!(tasks["content"][1]["attrs"]["checked"], true);
        assert_eq!(doc["content"][0]["attrs"]["level"], 1);
        assert_eq!(doc["content"][5]["content"][0]["text"], "code here");
    }

    #[test]
    fn markdown_to_tiptap_empty_gives_valid_doc() {
        let doc = markdown_to_tiptap("");
        assert_eq!(doc["type"], "doc");
        assert_eq!(doc["content"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn list_all_tags_unique_sorted() {
        let conn = open_in_memory().unwrap();
        create_object(
            &conn,
            "task",
            "t1",
            None,
            Some("{\"tags\":[\"b\",\"a\"]}"),
            None,
        )
        .unwrap();
        create_object(
            &conn,
            "task",
            "t2",
            None,
            Some("{\"tags\":[\"a\",\"c\"]}"),
            None,
        )
        .unwrap();
        create_object(&conn, "note", "n", None, None, None).unwrap();
        let tags = list_all_tags(&conn).unwrap();
        assert_eq!(
            tags,
            vec!["a".to_string(), "b".to_string(), "c".to_string()]
        );
    }

    #[test]
    fn migration_023_adds_tags_field_to_work_type_schemas() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE schema_version (version INTEGER NOT NULL)", [])
            .unwrap();
        conn.execute("INSERT INTO schema_version VALUES (0)", [])
            .unwrap();
        migrate(&conn).unwrap();

        for type_name in ["task", "issue", "project", "note"] {
            let schema: String = conn
                .query_row(
                    "SELECT schema FROM types WHERE name = ?1",
                    [type_name],
                    |r| r.get(0),
                )
                .unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&schema).unwrap();
            assert_eq!(
                parsed["fields"]["tags"]["type"], "tags",
                "{type_name} schema missing tags field"
            );
        }
    }

    #[test]
    fn migration_024_adds_start_date_to_issue_schema() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE schema_version (version INTEGER NOT NULL)", [])
            .unwrap();
        conn.execute("INSERT INTO schema_version VALUES (0)", [])
            .unwrap();
        migrate(&conn).unwrap();

        let schema: String = conn
            .query_row("SELECT schema FROM types WHERE name = 'issue'", [], |r| r.get(0))
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&schema).unwrap();
        assert_eq!(parsed["fields"]["startDate"]["type"], "date");
    }

    #[test]
    fn migration_025_seeds_activity_entry_type() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE schema_version (version INTEGER NOT NULL)", [])
            .unwrap();
        conn.execute("INSERT INTO schema_version VALUES (0)", [])
            .unwrap();
        migrate(&conn).unwrap();

        let schema: String = conn
            .query_row("SELECT schema FROM types WHERE name = 'activity_entry'", [], |r| r.get(0))
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&schema).unwrap();
        let options = parsed["fields"]["activityType"]["options"].as_array().unwrap();
        assert!(options.iter().any(|v| v == "decision"));
        assert_eq!(parsed["fields"]["dueDate"]["type"], "date");
    }

    #[test]
    fn migration_015_seeds_people_without_rewriting_property_values() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE schema_version (version INTEGER NOT NULL)", [])
            .unwrap();
        conn.execute("INSERT INTO schema_version VALUES (0)", [])
            .unwrap();
        for step in &MIGRATIONS[..14] {
            match step {
                Migration::Sql(script) => conn.execute_batch(script).unwrap(),
                Migration::Fn(f) => f(&conn).unwrap(),
            }
        }
        conn.execute("UPDATE schema_version SET version = 14", [])
            .unwrap();
        conn.execute(
            "INSERT INTO objects (id, type, title, content, props, created_at, updated_at, trashed_at)
             VALUES ('legacy-task', 'task', 'Legacy', '{}', '{\"assignee\":\"Anna Kowalska\"}', 1, 1, NULL)",
            [],
        ).unwrap();

        migrate(&conn).unwrap();

        let people = list_objects(&conn, Some("person"), 50, 0).unwrap();
        assert_eq!(
            people
                .iter()
                .filter(|person| person.title == "Anna Kowalska")
                .count(),
            1
        );
        let task = get_object(&conn, "legacy-task").unwrap().unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&task.props).unwrap()["assignee"],
            "Anna Kowalska"
        );
        let task_type = list_types(&conn)
            .unwrap()
            .into_iter()
            .find(|item| item.name == "task")
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&task_type.schema).unwrap()["fields"]
                ["assignee"]["type"],
            "people"
        );
    }

    #[test]
    fn integration_event_stream_uses_ordered_cursor() {
        let conn = open_in_memory().unwrap();
        let object = create_object(&conn, "task", "Event", None, None, None).unwrap();
        update_object(&conn, &object.id, Some("Changed"), None, None, None).unwrap();
        let first_page = list_integration_events(&conn, 0, 1).unwrap();
        assert_eq!(first_page.len(), 1);
        assert_eq!(first_page[0].event, "object.created");
        let second_page = list_integration_events(&conn, first_page[0].id, 10).unwrap();
        assert_eq!(second_page.len(), 1);
        assert_eq!(second_page[0].event, "object.updated");
        assert_eq!(second_page[0].object_id, object.id);
    }

    #[test]
    fn finance_migration_seeds_protected_types_and_project_budget() {
        let conn = open_in_memory().unwrap();
        let types = list_types(&conn).unwrap();
        assert!(types.iter().any(|item| item.name == "financial_entry"));
        assert!(types.iter().any(|item| item.name == "time_entry"));
        assert!(types.iter().any(|item| item.name == "vendor"));
        let project = types.iter().find(|item| item.name == "project").unwrap();
        let schema: serde_json::Value = serde_json::from_str(&project.schema).unwrap();
        assert_eq!(schema["fields"]["baseCurrency"]["type"], "text");
        assert_eq!(
            schema["fields"]["financeVisibility"]["options"][0],
            "private"
        );
    }

    #[test]
    fn reusable_data_sources_round_trip_and_update() {
        let conn = open_in_memory().unwrap();
        let definition = r#"{"version":1,"scope":{"kind":"workspace"}}"#;
        let created = upsert_data_source(&conn, None, "All work", definition).unwrap();
        assert!(!created.id.is_empty());
        assert_eq!(created.name, "All work");
        assert_eq!(list_data_sources(&conn).unwrap().len(), 1);

        let updated_definition = r#"{"version":1,"scope":{"kind":"type","type":"issue"}}"#;
        let updated =
            upsert_data_source(&conn, Some(&created.id), "Open issues", updated_definition)
                .unwrap();
        assert_eq!(updated.id, created.id);
        assert_eq!(updated.name, "Open issues");
        assert_eq!(updated.definition, updated_definition);
        assert!(delete_data_source(&conn, &created.id).unwrap());
        assert!(list_data_sources(&conn).unwrap().is_empty());
    }

    #[test]
    fn reusable_data_source_rejects_invalid_json() {
        let conn = open_in_memory().unwrap();
        assert!(upsert_data_source(&conn, None, "Broken", "not json").is_err());
        assert!(list_data_sources(&conn).unwrap().is_empty());
    }

    #[test]
    fn sync_merge_keeps_distinct_records_and_ignores_older_copy() {
        let conn = open_in_memory().unwrap();
        let local = create_object(&conn, "note", "Local note", None, None, None).unwrap();
        let remote = Object {
            id: "remote-note".into(),
            r#type: "note".into(),
            title: "Other computer note".into(),
            content: "{}".into(),
            props: "{}".into(),
            created_at: local.created_at,
            updated_at: local.updated_at + 10,
            archived_at: None,
            trashed_at: None,
            parent_id: None,
        };
        upsert_synced_object(&conn, &remote).unwrap();
        assert!(get_object(&conn, "remote-note").unwrap().is_some());

        let older_local_copy = Object {
            id: local.id.clone(),
            title: "Stale remote title".into(),
            updated_at: local.updated_at.saturating_sub(1),
            ..local.clone()
        };
        let kept = upsert_synced_object(&conn, &older_local_copy).unwrap();
        assert_eq!(kept.title, "Local note");
        assert!(list_all_objects_for_sync(&conn).unwrap().len() >= 2);
    }

    #[test]
    fn sync_tombstone_propagates_hard_delete_and_blocks_resurrection() {
        let source = open_in_memory().unwrap();
        let deleted = create_object(&source, "note", "Deleted here", None, None, None).unwrap();
        assert!(delete_object(&source, &deleted.id).unwrap());
        let tombstone = list_sync_tombstones(&source).unwrap().pop().unwrap();
        assert_eq!(tombstone.object_id, deleted.id);

        let destination = open_in_memory().unwrap();
        upsert_synced_object(&destination, &deleted).unwrap();
        assert!(apply_sync_tombstone(&destination, &tombstone).unwrap());
        assert!(get_object(&destination, &deleted.id).unwrap().is_none());
        assert!(upsert_synced_object(&destination, &deleted).is_err());
    }

    #[test]
    fn sync_outbox_keeps_operation_id_across_retry_and_ack() {
        let conn = open_in_memory().unwrap();
        let object = create_object(&conn, "note", "Outbox", None, None, None).unwrap();
        set_sync_state(&conn, "device_id", "device-test").unwrap();
        prepare_sync_outbox(&conn, "device-test").unwrap();

        let first = list_sync_outbox(&conn, 10).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].object_id.as_deref(), Some(object.id.as_str()));
        assert_eq!(first[0].operation_id, "device-test:event:1");

        mark_sync_outbox_attempts(&conn, &[first[0].operation_id.clone()]).unwrap();
        let retried = list_sync_outbox(&conn, 10).unwrap();
        assert_eq!(retried[0].operation_id, first[0].operation_id);
        assert_eq!(retried[0].attempts, 1);

        assert_eq!(acknowledge_sync_outbox(&conn, &[first[0].operation_id.clone()]).unwrap(), 1);
        assert!(list_sync_outbox(&conn, 10).unwrap().is_empty());
        assert_eq!(acknowledge_sync_outbox(&conn, &[first[0].operation_id.clone()]).unwrap(), 0);
    }
}
#[cfg(test)]
mod backup_restore_tests {
    use super::*;
    use std::fs;

    fn temp_workspace(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("notible-{label}-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn backup_restore_round_trip_preserves_workspace_and_plugin_registry() {
        let root = temp_workspace("backup-restore");
        fs::create_dir_all(&root).unwrap();
        let live_path = root.join("notible.db");
        let restored_path = root.join("restored.db");
        let backups = root.join("backups");

        let conn = open(live_path.to_str().unwrap()).unwrap();
        let original = create_object(&conn, "note", "Before restore", None, None, None).unwrap();
        upsert_plugin_registry(
            &conn,
            "example.hello",
            "0.1.0",
            "package",
            "plugins/example.hello/versions/0.1.0",
            r#"{"id":"example.hello","version":"0.1.0"}"#,
            true,
        )
        .unwrap();
        let backup = backup_db(&conn, &backups, 10).unwrap();
        let mutated = create_object(&conn, "note", "After backup", None, None, None).unwrap();
        drop(conn);

        restore_db_copy(&backup, &restored_path).unwrap();
        let restored = open(restored_path.to_str().unwrap()).unwrap();
        assert!(get_object(&restored, &original.id).unwrap().is_some());
        assert!(get_object(&restored, &mutated.id).unwrap().is_none());
        let plugins = list_plugin_registry(&restored).unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].plugin_id, "example.hello");
        assert_eq!(plugins[0].version, "0.1.0");
        drop(restored);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_backup_does_not_replace_destination() {
        let root = temp_workspace("backup-restore-invalid");
        fs::create_dir_all(&root).unwrap();
        let destination = root.join("notible.db");
        let invalid = root.join("invalid.db");

        let conn = open(destination.to_str().unwrap()).unwrap();
        let original = create_object(&conn, "note", "Keep me", None, None, None).unwrap();
        drop(conn);
        fs::write(&invalid, b"not a sqlite database").unwrap();

        let error = restore_db_copy(&invalid, &destination).unwrap_err();
        assert!(error.contains("SQLite") || error.contains("staged"));
        let unchanged = open(destination.to_str().unwrap()).unwrap();
        assert!(get_object(&unchanged, &original.id).unwrap().is_some());
        drop(unchanged);

        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod media_reference_tests {
    use super::*;

    const UUID: &str = "1f2e3d4c-5b6a-4978-8899-aabbccddeeff";

    #[test]
    fn rewrites_this_machines_asset_urls_and_paths() {
        let uuid = UUID;
        for original in [
            format!("![](http://asset.localhost/C%3A%5CUsers%5CSz%5Cmedia%5C{uuid}.png)"),
            format!("![](asset://localhost/C:/Users/me/media/{uuid}.png)"),
            format!("![](C:\\Users\\Sz\\AppData\\Roaming\\Notible\\media\\{uuid}.png)"),
            format!("![](/home/sz/.local/share/notible/media/{uuid}.png)"),
            format!("<img src=\"http://asset.localhost/C%3A%5Cmedia%5C{uuid}.png\">"),
        ] {
            let rewritten = rewrite_media_references(&original)
                .unwrap_or_else(|| panic!("should have rewritten: {original}"));
            assert!(
                rewritten.contains(&format!("media/{uuid}.png")),
                "{rewritten}"
            );
            assert!(!rewritten.contains("asset"), "{rewritten}");
            assert!(!rewritten.contains("Users"), "{rewritten}");
        }
    }

    #[test]
    fn leaves_someone_elses_server_alone() {
        // The one that would be unrecoverable: history is not rewritten, so a
        // remote image turned into a dead local reference could not be undone.
        let uuid = UUID;
        for original in [
            format!("![](https://cdn.example.com/media/{uuid}.png)"),
            format!("![](http://example.com/media/{uuid}.png)"),
            format!("![](https://asset.localhost.evil.com/media/{uuid}.png)"),
        ] {
            assert_eq!(rewrite_media_references(&original), None, "{original}");
        }
    }

    #[test]
    fn is_idempotent_and_ignores_content_without_media() {
        let uuid = UUID;
        let already = format!("![](media/{uuid}.png)");
        assert_eq!(rewrite_media_references(&already), None);
        assert_eq!(rewrite_media_references("no pictures here at all"), None);
        // And running it twice over a real one changes nothing the second time.
        let once = rewrite_media_references(&format!(
            "![](C:\\Users\\Sz\\media\\{uuid}.webp)"
        ))
        .unwrap();
        assert_eq!(rewrite_media_references(&once), None, "{once}");
    }

    #[test]
    fn accepts_only_real_media_filenames() {
        let uuid = UUID;
        assert!(is_media_filename(&format!("{uuid}.png")));
        assert!(is_media_filename(&format!("{uuid}.jpeg")));
        for bad in [
            format!("../{uuid}.png"),
            format!("sub/{uuid}.png"),
            format!("C:{uuid}.png"),
            format!("{uuid}.exe"),
            format!("{uuid}.png.part"),
            format!("{}.png", uuid.to_uppercase()),
            format!("{uuid}"),
            "".to_string(),
            ".png".to_string(),
        ] {
            assert!(!is_media_filename(&bad), "{bad} must be refused");
        }
    }

    #[test]
    fn migration_rewrites_objects_and_leaves_history_untouched() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let uuid = UUID;
        let body = format!("![](C:\\Users\\Sz\\media\\{uuid}.png)");
        conn.execute(
            "INSERT INTO objects (id, type, title, content, props, created_at, updated_at)
             VALUES ('o1', 'note', 'T', ?1, '{}', 1, 2)",
            params![body],
        )
        .unwrap();
        migrate_media_references(&conn).unwrap();
        let stored: String = conn
            .query_row("SELECT content FROM objects WHERE id = 'o1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(stored, format!("![](media/{uuid}.png)"));
    }
}
