//! STORE-API (Hive #5): `context.store`, a plugin-scoped key -> text store in
//! its own file (`plugin-store.db`), so backups never copy it and its writes
//! never block the main database.
//!
//! It holds data derived from the workspace database, so it is tied to it:
//! - `epoch`: equals the main DB's `workspace_epoch`. A mismatch at startup
//!   (a backup copied over the DB by hand) empties the store. Every backup
//!   rotates it, so no backup file carries a live epoch.
//! - `generation`: changes only when the store is emptied. Writers send it,
//!   so a cycle that started before a restore cannot write into the wiped
//!   store.
//!
//! Isolation is a convention: every plugin runs in Core's JS realm and can
//! call these commands with any id. This guards against accidents only.
use rusqlite::{params, Connection, OptionalExtension};
use std::time::Duration;

pub const VALUE_CAP: usize = 4 * 1024 * 1024;
pub const PLUGIN_CAP: i64 = 256 * 1024 * 1024;
pub const GLOBAL_CAP: i64 = 1024 * 1024 * 1024;
pub const KEY_MAX: usize = 512;
// ponytail: no built-in plugin uses the store yet; list ids here when one does.
pub const BUILTIN_IDS: &[&str] = &[];

type R<T> = Result<T, String>;
fn s<E: std::fmt::Display>(e: E) -> String { e.to_string() }

pub fn open(path: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(Duration::from_secs(5))?;
    init(&conn)?;
    Ok(conn)
}

pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    init(&conn)?;
    Ok(conn)
}

fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS plugin_store (
           plugin_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
           PRIMARY KEY (plugin_id, key)) WITHOUT ROWID;
         CREATE TABLE IF NOT EXISTS plugin_store_usage (plugin_id TEXT PRIMARY KEY, bytes INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS plugin_store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
}

fn meta(store: &Connection, key: &str) -> R<Option<String>> {
    store
        .query_row("SELECT value FROM plugin_store_meta WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .map_err(s)
}

fn set_meta(store: &Connection, key: &str, value: &str) -> R<()> {
    store
        .execute(
            "INSERT INTO plugin_store_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map(|_| ())
        .map_err(s)
}

fn new_token() -> String { uuid::Uuid::new_v4().to_string() }

/// Ok(false) = really not registered; Err = the query itself failed.
pub fn is_registered(main: &Connection, plugin_id: &str) -> R<bool> {
    if BUILTIN_IDS.contains(&plugin_id) {
        return Ok(true);
    }
    let found: Option<i64> = main
        .query_row("SELECT 1 FROM plugin_registry WHERE plugin_id = ?1 LIMIT 1", [plugin_id], |r| r.get(0))
        .optional()
        .map_err(s)?;
    Ok(found.is_some())
}

pub fn ensure_registered(main: &Connection, plugin_id: &str) -> R<()> {
    if is_registered(main, plugin_id)? {
        Ok(())
    } else {
        Err(format!("plugin {plugin_id} is not registered"))
    }
}

pub fn generation(store: &Connection) -> R<String> {
    if let Some(g) = meta(store, "generation")? {
        return Ok(g);
    }
    let g = new_token();
    set_meta(store, "generation", &g)?;
    Ok(g)
}

fn check_generation(store: &Connection, sent: &str) -> R<()> {
    if generation(store)? == sent {
        Ok(())
    } else {
        Err("the plugin store was reset (a backup was restored); reload Notible".into())
    }
}

fn check_key(key: &str) -> R<()> {
    if key.is_empty() || key.len() > KEY_MAX || key.contains('\0') {
        return Err(format!("store key must be 1-{KEY_MAX} bytes without NUL"));
    }
    Ok(())
}

fn row_bytes(tx: &Connection, plugin_id: &str, key: &str) -> R<i64> {
    tx.query_row(
        "SELECT length(CAST(key AS BLOB)) + length(CAST(value AS BLOB)) FROM plugin_store
         WHERE plugin_id = ?1 AND key = ?2",
        params![plugin_id, key],
        |r| r.get(0),
    )
    .optional()
    .map(|v| v.unwrap_or(0))
    .map_err(s)
}

fn plugin_usage(conn: &Connection, plugin_id: &str) -> R<i64> {
    conn.query_row("SELECT bytes FROM plugin_store_usage WHERE plugin_id = ?1", [plugin_id], |r| r.get(0))
        .optional()
        .map(|v| v.unwrap_or(0))
        .map_err(s)
}

fn add_usage(tx: &Connection, plugin_id: &str, delta: i64) -> R<()> {
    tx.execute(
        "INSERT INTO plugin_store_usage (plugin_id, bytes) VALUES (?1, ?2)
         ON CONFLICT(plugin_id) DO UPDATE SET bytes = bytes + excluded.bytes",
        params![plugin_id, delta],
    )
    .map(|_| ())
    .map_err(s)
}

pub fn get_many(store: &Connection, plugin_id: &str, keys: &[String]) -> R<Vec<Option<String>>> {
    let mut stmt = store
        .prepare_cached("SELECT value FROM plugin_store WHERE plugin_id = ?1 AND key = ?2")
        .map_err(s)?;
    keys.iter()
        .map(|k| stmt.query_row(params![plugin_id, k], |r| r.get(0)).optional().map_err(s))
        .collect()
}

pub fn set_many(store: &Connection, plugin_id: &str, generation: &str, entries: &[(String, String)]) -> R<()> {
    check_generation(store, generation)?;
    for (k, v) in entries {
        check_key(k)?;
        if v.len() > VALUE_CAP {
            return Err(format!("store value for \"{k}\" is over 4 MB"));
        }
    }
    let tx = store.unchecked_transaction().map_err(s)?;
    let mut delta = 0i64;
    for (k, v) in entries {
        delta -= row_bytes(&tx, plugin_id, k)?;
        tx.execute(
            "INSERT INTO plugin_store (plugin_id, key, value) VALUES (?1, ?2, ?3)
             ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value",
            params![plugin_id, k, v],
        )
        .map_err(s)?;
        delta += (k.len() + v.len()) as i64;
    }
    if delta > 0 {
        if plugin_usage(&tx, plugin_id)? + delta > PLUGIN_CAP {
            return Err("the plugin store is full for this plugin (256 MB)".into());
        }
        let total: i64 = tx
            .query_row("SELECT COALESCE(SUM(bytes), 0) FROM plugin_store_usage", [], |r| r.get(0))
            .map_err(s)?;
        if total + delta > GLOBAL_CAP {
            return Err("the plugin store is full (1 GB for all plugins)".into());
        }
    }
    add_usage(&tx, plugin_id, delta)?;
    tx.commit().map_err(s)
}

pub fn delete_many(store: &Connection, plugin_id: &str, generation: &str, keys: &[String]) -> R<()> {
    check_generation(store, generation)?;
    let tx = store.unchecked_transaction().map_err(s)?;
    let mut delta = 0i64;
    for k in keys {
        delta -= row_bytes(&tx, plugin_id, k)?;
        tx.execute("DELETE FROM plugin_store WHERE plugin_id = ?1 AND key = ?2", params![plugin_id, k])
            .map_err(s)?;
    }
    add_usage(&tx, plugin_id, delta)?;
    tx.commit().map_err(s)
}

// Never LIKE: `_` and `%` in a prefix are literal.
const PREFIX: &str = "plugin_id = ?1 AND key >= ?2 AND substr(key, 1, length(?2)) = ?2";

pub fn keys(store: &Connection, plugin_id: &str, prefix: &str) -> R<Vec<String>> {
    let mut stmt = store
        .prepare(&format!("SELECT key FROM plugin_store WHERE {PREFIX} ORDER BY key"))
        .map_err(s)?;
    let rows = stmt.query_map(params![plugin_id, prefix], |r| r.get(0)).map_err(s)?;
    rows.collect::<rusqlite::Result<Vec<String>>>().map_err(s)
}

pub fn delete_prefix(store: &Connection, plugin_id: &str, generation: &str, prefix: &str) -> R<usize> {
    if prefix.is_empty() {
        return Err("deletePrefix needs a non-empty prefix".into());
    }
    check_generation(store, generation)?;
    let tx = store.unchecked_transaction().map_err(s)?;
    let bytes: i64 = tx
        .query_row(
            &format!("SELECT COALESCE(SUM(length(CAST(key AS BLOB)) + length(CAST(value AS BLOB))), 0) FROM plugin_store WHERE {PREFIX}"),
            params![plugin_id, prefix],
            |r| r.get(0),
        )
        .map_err(s)?;
    let n = tx
        .execute(&format!("DELETE FROM plugin_store WHERE {PREFIX}"), params![plugin_id, prefix])
        .map_err(s)?;
    add_usage(&tx, plugin_id, -bytes)?;
    tx.commit().map_err(s)?;
    Ok(n)
}

pub fn delete_plugin(store: &Connection, plugin_id: &str) -> R<()> {
    let tx = store.unchecked_transaction().map_err(s)?;
    tx.execute("DELETE FROM plugin_store WHERE plugin_id = ?1", [plugin_id]).map_err(s)?;
    tx.execute("DELETE FROM plugin_store_usage WHERE plugin_id = ?1", [plugin_id]).map_err(s)?;
    tx.commit().map_err(s)
}

/// Startup: rows of plugins no longer installed (crash mid-uninstall, a
/// restored DB without them).
pub fn sweep(store: &Connection, registered: &[String]) -> R<usize> {
    let mut stmt = store
        .prepare("SELECT plugin_id FROM plugin_store_usage UNION SELECT DISTINCT plugin_id FROM plugin_store")
        .map_err(s)?;
    let ids = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(s)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(s)?;
    let orphans: Vec<_> = ids
        .into_iter()
        .filter(|id| !registered.contains(id) && !BUILTIN_IDS.contains(&id.as_str()))
        .collect();
    for id in &orphans {
        delete_plugin(store, id)?;
    }
    Ok(orphans.len())
}

pub fn wipe(store: &Connection) -> R<()> {
    wipe_to(store, None)
}

/// SYNC-NO-LOSS (Hive #14, F7): rows, usage, generation (and the epoch, when
/// given) change in one transaction. A wipe cut off halfway must not leave
/// some of a plugin's rows -- the sync lineage -- behind a fresh generation.
fn wipe_to(store: &Connection, epoch: Option<&str>) -> R<()> {
    store.execute_batch("BEGIN IMMEDIATE").map_err(s)?;
    let result = store
        .execute_batch("DELETE FROM plugin_store; DELETE FROM plugin_store_usage;")
        .map_err(s)
        .and_then(|_| set_meta(store, "generation", &new_token()))
        .and_then(|_| epoch.map_or(Ok(()), |e| set_meta(store, "epoch", e)));
    match result {
        Ok(()) => store.execute_batch("COMMIT").map_err(s),
        Err(e) => {
            let _ = store.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

/// SYNC-NO-LOSS (Hive #14, F7): a store that could not be checked or emptied
/// is not used. Plugins get an empty in-memory store (it forgets on restart,
/// and sync re-seeds), and the stale file is wiped by the next good startup,
/// since its epoch no longer matches. Later rotations write to the memory
/// store, so they cannot bless the stale file.
pub fn fail_closed(store: &mut Connection, why: &str) {
    eprintln!("plugin store unusable ({why}); using an empty in-memory store");
    *store = open_in_memory().expect("in-memory plugin store");
}

pub fn workspace_epoch(main: &Connection) -> R<String> {
    if let Some(e) = crate::db::get_sync_state(main, "workspace_epoch").map_err(s)? {
        return Ok(e);
    }
    let e = new_token();
    crate::db::set_sync_state(main, "workspace_epoch", &e).map_err(s)?;
    Ok(e)
}

/// Startup: wipe when the store was filled under another database.
pub fn reconcile(store: &Connection, epoch: &str) -> R<bool> {
    if meta(store, "epoch")?.as_deref() == Some(epoch) {
        return Ok(false);
    }
    wipe_to(store, Some(epoch))?;
    Ok(true)
}

/// After every successful backup, and after a restore (with `wipe`).
pub fn rotate_epoch(main: &Connection, store: &Connection) -> R<()> {
    let e = new_token();
    crate::db::set_sync_state(main, "workspace_epoch", &e).map_err(s)?;
    set_meta(store, "epoch", &e)
}

#[cfg(test)]
fn usage(store: &Connection, plugin_id: &str) -> i64 { plugin_usage(store, plugin_id).unwrap() }

#[cfg(test)]
mod tests {
    use super::*;

    fn main_db() -> Connection {
        let main = crate::db::open_in_memory().unwrap();
        crate::db::upsert_plugin_registry(&main, "p", "1.0.0", "package", "plugins/p", r#"{"id":"p","version":"1.0.0"}"#, true).unwrap();
        main
    }
    fn kv(k: &str, v: &str) -> (String, String) { (k.to_string(), v.to_string()) }

    /// SYNC-NO-LOSS (Hive #14, F7): a wipe that fails halfway changes
    /// nothing (no rows gone behind a fresh generation, no blessed epoch),
    /// and a store that fails its check is swapped for an empty one.
    #[test]
    fn failed_wipe_changes_nothing_and_fails_closed() {
        let main = main_db();
        let mut st = open_in_memory().unwrap();
        let g = generation(&st).unwrap();
        set_many(&st, "p", &g, &[kv("lineage", "old")]).unwrap();
        set_meta(&st, "epoch", "stale").unwrap();
        st.execute_batch("CREATE TEMP TRIGGER boom BEFORE DELETE ON plugin_store_usage BEGIN SELECT RAISE(ABORT, 'disk full'); END;").unwrap();
        let epoch = workspace_epoch(&main).unwrap();
        assert!(reconcile(&st, &epoch).is_err());
        assert!(wipe(&st).is_err());
        assert_eq!(get_many(&st, "p", &["lineage".into()]).unwrap(), vec![Some("old".into())], "all or nothing");
        assert_eq!(generation(&st).unwrap(), g);
        assert_eq!(meta(&st, "epoch").unwrap().as_deref(), Some("stale"));
        fail_closed(&mut st, "test");
        assert_eq!(get_many(&st, "p", &["lineage".into()]).unwrap(), vec![None]);
        rotate_epoch(&main, &st).unwrap();
        assert!(!reconcile(&st, &workspace_epoch(&main).unwrap()).unwrap());
    }

    #[test]
    fn unregistered_plugin_is_refused() {
        let main = main_db();
        assert!(ensure_registered(&main, "p").is_ok());
        let err = ensure_registered(&main, "ghost").unwrap_err();
        assert!(err.contains("is not registered"), "{err}");
    }

    #[test]
    fn round_trip_and_usage_is_exact() {
        let s = open_in_memory().unwrap();
        let g = generation(&s).unwrap();
        set_many(&s, "p", &g, &[kv("a", "xyz"), kv("b", "ż")]).unwrap();
        assert_eq!(get_many(&s, "p", &["a".into(), "c".into()]).unwrap(), vec![Some("xyz".into()), None]);
        assert_eq!(usage(&s, "p"), 1 + 3 + 1 + 2); // bytes: "a"+"xyz", "b"+"ż"
        set_many(&s, "p", &g, &[kv("a", "x")]).unwrap();
        assert_eq!(usage(&s, "p"), 1 + 1 + 1 + 2);
        delete_many(&s, "p", &g, &["a".into()]).unwrap();
        assert_eq!(usage(&s, "p"), 1 + 2);
    }

    #[test]
    fn caps_reject_whole_batch_without_truncating() {
        let s = open_in_memory().unwrap();
        let g = generation(&s).unwrap();
        let big = "x".repeat(VALUE_CAP + 1);
        let err = set_many(&s, "p", &g, &[kv("ok", "1"), ("big".into(), big)]).unwrap_err();
        assert!(err.contains("4 MB"), "{err}");
        assert_eq!(get_many(&s, "p", &["ok".into()]).unwrap(), vec![None]);
        assert_eq!(usage(&s, "p"), 0);
        assert!(set_many(&s, "p", &g, &[kv("", "v")]).is_err());
        assert!(set_many(&s, "p", &g, &[kv(&"k".repeat(KEY_MAX + 1), "v")]).is_err());
        assert!(set_many(&s, "p", &g, &[kv("a\0b", "v")]).is_err());
        // Per-plugin cap: pretend the plugin is almost full.
        s.execute("INSERT INTO plugin_store_usage (plugin_id, bytes) VALUES ('p', ?1)", [PLUGIN_CAP - 2]).unwrap();
        let err = set_many(&s, "p", &g, &[kv("a", "bc")]).unwrap_err();
        assert!(err.contains("256 MB"), "{err}");
        assert_eq!(usage(&s, "p"), PLUGIN_CAP - 2);
    }

    #[test]
    fn global_cap_counts_every_plugin() {
        let s = open_in_memory().unwrap();
        let g = generation(&s).unwrap();
        s.execute("INSERT INTO plugin_store_usage (plugin_id, bytes) VALUES ('other', ?1)", [GLOBAL_CAP - 2]).unwrap();
        let err = set_many(&s, "p", &g, &[kv("a", "bc")]).unwrap_err();
        assert!(err.contains("1 GB"), "{err}");
    }

    #[test]
    fn prefix_is_literal_and_empty_prefix_refused() {
        let s = open_in_memory().unwrap();
        let g = generation(&s).unwrap();
        set_many(&s, "p", &g, &[kv("a_1", "1"), kv("ab1", "2"), kv("a%", "3"), kv("b", "4")]).unwrap();
        assert_eq!(keys(&s, "p", "a_").unwrap(), vec!["a_1".to_string()]);
        assert_eq!(keys(&s, "p", "a%").unwrap(), vec!["a%".to_string()]);
        assert_eq!(keys(&s, "p", "").unwrap().len(), 4);
        assert!(delete_prefix(&s, "p", &g, "").is_err());
        assert_eq!(delete_prefix(&s, "p", &g, "a").unwrap(), 3);
        assert_eq!(usage(&s, "p"), 2);
    }

    #[test]
    fn stale_generation_is_rejected_after_wipe() {
        let s = open_in_memory().unwrap();
        let g = generation(&s).unwrap();
        set_many(&s, "p", &g, &[kv("a", "1")]).unwrap();
        wipe(&s).unwrap();
        assert_eq!(keys(&s, "p", "").unwrap(), Vec::<String>::new());
        assert_eq!(usage(&s, "p"), 0);
        assert!(set_many(&s, "p", &g, &[kv("a", "1")]).unwrap_err().contains("reset"));
        assert!(delete_prefix(&s, "p", &g, "a").is_err());
        let g2 = generation(&s).unwrap();
        assert_ne!(g, g2);
        set_many(&s, "p", &g2, &[kv("a", "1")]).unwrap();
    }

    #[test]
    fn epoch_mismatch_wipes_and_backup_rotation_kills_old_epoch() {
        let main = main_db();
        let s = open_in_memory().unwrap();
        let e = workspace_epoch(&main).unwrap();
        assert_eq!(workspace_epoch(&main).unwrap(), e, "epoch is stable");
        assert!(reconcile(&s, &e).unwrap(), "first sight records the epoch");
        let g = generation(&s).unwrap();
        set_many(&s, "p", &g, &[kv("a", "1")]).unwrap();
        assert!(!reconcile(&s, &e).unwrap(), "same epoch keeps rows");
        assert_eq!(keys(&s, "p", "").unwrap().len(), 1);
        // A backup taken now carries `e`; rotation makes `e` dead.
        rotate_epoch(&main, &s).unwrap();
        let live = workspace_epoch(&main).unwrap();
        assert_ne!(live, e);
        assert!(!reconcile(&s, &live).unwrap(), "rotation updates both sides");
        assert_eq!(generation(&s).unwrap(), g, "rotation keeps the generation");
        // The backup copied over the DB by hand: startup sees `e` again.
        assert!(reconcile(&s, &e).unwrap());
        assert_eq!(keys(&s, "p", "").unwrap().len(), 0);
    }

    #[test]
    fn delete_plugin_and_sweep() {
        let s = open_in_memory().unwrap();
        let g = generation(&s).unwrap();
        set_many(&s, "p", &g, &[kv("a", "1")]).unwrap();
        set_many(&s, "orphan", &g, &[kv("a", "1")]).unwrap();
        assert_eq!(sweep(&s, &["p".to_string()]).unwrap(), 1);
        assert_eq!(keys(&s, "orphan", "").unwrap().len(), 0);
        assert_eq!(usage(&s, "orphan"), 0);
        delete_plugin(&s, "p").unwrap();
        assert_eq!(keys(&s, "p", "").unwrap().len(), 0);
    }

    #[test]
    fn backup_contains_no_store_rows() {
        let main = main_db();
        let dir = std::env::temp_dir().join(format!("notible-test-{}", uuid::Uuid::new_v4()));
        let path = crate::db::backup_db(&main, &dir, 3).unwrap();
        let copy = Connection::open(&path).unwrap();
        let n: i64 = copy
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'plugin_store%'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        drop(copy);
        let _ = std::fs::remove_dir_all(dir);
    }
}
