//! Hive #7: durable copy pairing and Core-only atomic resolution/recovery.
use crate::db::{self, Object};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Descriptor {
    pub original_id: String,
    pub copy_id: String,
    pub fields: Vec<String>,
}

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS sync_conflicts (
 copy_id TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,
 original_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
 fields TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_conflicts_original ON sync_conflicts(original_id);
CREATE TABLE IF NOT EXISTS sync_conflict_undo (
 token TEXT PRIMARY KEY, original_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
 copy_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
 content TEXT NOT NULL, original_stamp TEXT NOT NULL, copy_stamp TEXT NOT NULL
);";

// Hive #7 review, F2: retain the bounded receipt when its copy is purged, so
// Undo can explain the missing copy instead of losing the receipt silently.
pub const KEEP_PURGED_COPY_RECEIPTS: &str = "
BEGIN IMMEDIATE;
CREATE TABLE sync_conflict_undo_with_missing_copy (
 token TEXT PRIMARY KEY, original_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
 copy_id TEXT NOT NULL,
 content TEXT NOT NULL, original_stamp TEXT NOT NULL, copy_stamp TEXT NOT NULL
);
INSERT INTO sync_conflict_undo_with_missing_copy(rowid,token,original_id,copy_id,content,original_stamp,copy_stamp)
 SELECT rowid,token,original_id,copy_id,content,original_stamp,copy_stamp FROM sync_conflict_undo;
DROP TABLE sync_conflict_undo;
ALTER TABLE sync_conflict_undo_with_missing_copy RENAME TO sync_conflict_undo;
COMMIT;
";

pub fn descriptors(conn: &Connection) -> rusqlite::Result<Vec<Descriptor>> {
    let mut stmt =
        conn.prepare("SELECT original_id, copy_id, fields FROM sync_conflicts ORDER BY copy_id")?;
    let rows = stmt.query_map([], |r| {
        Ok(Descriptor {
            original_id: r.get(0)?,
            copy_id: r.get(1)?,
            fields: serde_json::from_str(&r.get::<_, String>(2)?).unwrap_or_default(),
        })
    })?;
    rows.collect()
}
pub fn active_descriptors(conn: &Connection) -> rusqlite::Result<Vec<Descriptor>> {
    let mut stmt=conn.prepare("SELECT c.original_id,c.copy_id,c.fields FROM sync_conflicts c
        JOIN objects o ON o.id=c.original_id JOIN objects p ON p.id=c.copy_id
        WHERE o.trashed_at IS NULL AND o.archived_at IS NULL AND p.trashed_at IS NULL AND p.archived_at IS NULL")?;
    let rows = stmt.query_map([], |r| {
        Ok(Descriptor {
            original_id: r.get(0)?,
            copy_id: r.get(1)?,
            fields: serde_json::from_str(&r.get::<_, String>(2)?).unwrap_or_default(),
        })
    })?;
    rows.collect()
}

/// Invalid metadata is ignored independently of the ordinary no-loss copy.
/// Pairing is immutable. Field sets can only widen (a replay cannot claim that
/// an unresolved property conflict became safe to throw away).
pub fn register(conn: &Connection, value: &serde_json::Value) -> rusqlite::Result<bool> {
    let Ok(mut d) = serde_json::from_value::<Descriptor>(value.clone()) else {
        return Ok(false);
    };
    if uuid::Uuid::parse_str(&d.original_id).is_err()
        || uuid::Uuid::parse_str(&d.copy_id).is_err()
        || d.original_id == d.copy_id
        || d.fields.is_empty()
        || d.fields.len() > 7
        || d.fields.iter().any(|f| {
            ![
                "content",
                "title",
                "props",
                "parent_id",
                "type",
                "archived_at",
                "trashed_at",
            ]
            .contains(&f.as_str())
        })
    {
        return Ok(false);
    }
    let Some(original) = db::get_object(conn, &d.original_id)? else {
        return Ok(false);
    };
    let Some(copy) = db::get_object(conn, &d.copy_id)? else {
        return Ok(false);
    };
    if original.r#type != copy.r#type {
        return Ok(false);
    }
    let old: Option<(String, String)> = conn
        .query_row(
            "SELECT original_id,fields FROM sync_conflicts WHERE copy_id=?1",
            [&d.copy_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((id, fields)) = old {
        if id != d.original_id {
            return Ok(false);
        }
        d.fields
            .extend(serde_json::from_str::<Vec<String>>(&fields).unwrap_or_default());
    }
    d.fields.sort();
    d.fields.dedup();
    conn.execute(
        "INSERT INTO sync_conflicts(copy_id,original_id,fields) VALUES(?1,?2,?3)
        ON CONFLICT(copy_id) DO UPDATE SET fields=excluded.fields",
        params![
            d.copy_id,
            d.original_id,
            serde_json::to_string(&d.fields).unwrap()
        ],
    )?;
    Ok(true)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub descriptor: Descriptor,
    pub title: String,
    pub copy_title: String,
    pub created_at: i64,
}
pub fn queue(conn: &Connection, offset: i64) -> rusqlite::Result<Vec<QueueItem>> {
    let mut stmt = conn.prepare("SELECT c.original_id,c.copy_id,c.fields,o.title,p.title,p.created_at FROM sync_conflicts c
        JOIN objects o ON o.id=c.original_id JOIN objects p ON p.id=c.copy_id
        WHERE p.trashed_at IS NULL AND p.archived_at IS NULL AND o.trashed_at IS NULL AND o.archived_at IS NULL
        ORDER BY p.created_at,c.copy_id LIMIT 50 OFFSET ?1")?;
    let rows = stmt.query_map([offset.max(0)], |r| {
        Ok(QueueItem {
            title: r.get(3)?,
            copy_title: r.get(4)?,
            created_at: r.get(5)?,
            descriptor: Descriptor {
                original_id: r.get(0)?,
                copy_id: r.get(1)?,
                fields: serde_json::from_str(&r.get::<_, String>(2)?).unwrap_or_default(),
            },
        })
    })?;
    rows.collect()
}
fn stamp(conn: &Connection, object: &Object) -> rusqlite::Result<String> {
    let bytes = serde_json::to_vec(&(object, db::local_mark(conn, &object.id)?)).unwrap();
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pair {
    pub original: Object,
    pub copy: Object,
    pub descriptor: Option<Descriptor>,
    pub original_stamp: String,
    pub copy_stamp: String,
}
pub fn pair(conn: &Connection, copy_id: &str, original_id: Option<&str>) -> Result<Pair, String> {
    let descriptor = descriptors(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|d| d.copy_id == copy_id);
    let id = descriptor
        .as_ref()
        .map(|d| d.original_id.as_str())
        .or(original_id)
        .ok_or("unlinked")?;
    if id == copy_id {
        return Err("invalid_pair".into());
    }
    let original = db::get_object(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or("not_found")?;
    let copy = db::get_object(conn, copy_id)
        .map_err(|e| e.to_string())?
        .ok_or("not_found")?;
    if original.trashed_at.is_some()
        || copy.trashed_at.is_some()
        || original.archived_at.is_some()
        || copy.archived_at.is_some()
        || original.r#type != copy.r#type
    {
        return Err("unavailable".into());
    }
    Ok(Pair {
        original_stamp: stamp(conn, &original).map_err(|e| e.to_string())?,
        copy_stamp: stamp(conn, &copy).map_err(|e| e.to_string())?,
        original,
        copy,
        descriptor,
    })
}

pub fn flat(content: &str) -> bool {
    if content == "" || content == "{}" {
        return true;
    }
    if content.len() > 2_000_000 {
        return false;
    }
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(content) else {
        return false;
    };
    let Some(root) = doc.as_object() else {
        return false;
    };
    let Some(lines) = doc["content"].as_array() else {
        return false;
    };
    doc["type"] == "doc"
        && root.len() == 2
        && lines.len() <= 20_000
        && lines.iter().all(|line| {
            let Some(p) = line.as_object() else {
                return false;
            };
            if line["type"] != "paragraph" || p.keys().any(|k| k != "type" && k != "content") {
                return false;
            }
            match p.get("content") {
                None => true,
                Some(v) => v.as_array().is_some_and(|parts| {
                    parts.len() <= 1
                        && parts.iter().all(|t| {
                            t.as_object().is_some_and(|o| {
                                o.len() == 2
                                    && t["type"] == "text"
                                    && t["text"]
                                        .as_str()
                                        .is_some_and(|s| !s.contains('\n') && !s.contains('\r'))
                            })
                        })
                }),
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn body(text: &str) -> String {
        json!({"type":"doc","content":text.split('\n').map(|s|if s.is_empty(){json!({"type":"paragraph"})}else{json!({"type":"paragraph","content":[{"type":"text","text":s}]})}).collect::<Vec<_>>()}).to_string()
    }
    fn setup() -> (Connection, Object, Object) {
        let c = db::open_in_memory().unwrap();
        let a = db::create_object(&c, "note", "Same title", Some(&body("current")), None, None)
            .unwrap();
        let b =
            db::create_object(&c, "note", "Same title", Some(&body("saved")), None, None).unwrap();
        assert!(register(
            &c,
            &json!({"originalId":a.id,"copyId":b.id,"fields":["content"]})
        )
        .unwrap());
        (c, a, b)
    }
    fn request(c: &Connection, b: &Object) -> Resolution {
        let p = pair(c, &b.id, None).unwrap();
        Resolution {
            copy_id: b.id.clone(),
            original_id: p.original.id,
            original_stamp: p.original_stamp,
            copy_stamp: p.copy_stamp,
            content: body("chosen"),
        }
    }
    #[test]
    fn sync_conflict_atomic_save_history_trash_and_undo() {
        let (c, a, b) = setup();
        let r = resolve(&c, &request(&c, &b)).unwrap();
        assert!(r.copy_trashed);
        assert!(queue(&c, 0).unwrap().is_empty());
        assert_eq!(r.original.title, a.title);
        assert_eq!(r.original.props, a.props);
        assert!(db::list_history(&c, &a.id, 100).unwrap().len() >= 2);
        let u = undo(&c, &r.undo_token).unwrap();
        assert!(!u.kept_newer);
        assert!(!u.copy_missing);
        assert_eq!(u.original.unwrap().content, a.content);
        assert_eq!(queue(&c, 0).unwrap().len(), 1);
        assert!(undo(&c, &r.undo_token).is_err());
    }
    #[test]
    fn sync_conflict_stale_content_move_trash_restore_and_copy() {
        for mode in 0..5 {
            let (c, a, b) = setup();
            let req = request(&c, &b);
            match mode {
                0 => {
                    db::update_object(&c, &a.id, None, Some(&body("newer")), None, None).unwrap();
                }
                1 => {
                    db::mark_local_change(&c, &a.id).unwrap();
                }
                2 => {
                    db::trash_object(&c, &a.id).unwrap();
                }
                3 => {
                    db::trash_object(&c, &b.id).unwrap();
                    db::restore_object(&c, &b.id).unwrap();
                }
                _ => {
                    db::update_object(&c, &b.id, Some("renamed"), None, None, None).unwrap();
                }
            }
            assert!(resolve(&c, &req).is_err(), "mode {mode}");
            assert!(db::get_object(&c, &b.id)
                .unwrap()
                .unwrap()
                .trashed_at
                .is_none());
        }
    }
    #[test]
    fn sync_conflict_rollback_includes_original_and_history() {
        let (c, a, b) = setup();
        c.execute_batch("CREATE TRIGGER fail_copy BEFORE UPDATE OF trashed_at ON objects BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
        assert!(resolve(&c, &request(&c, &b)).is_err());
        assert_eq!(
            db::get_object(&c, &a.id).unwrap().unwrap().content,
            a.content
        );
        assert!(db::get_object(&c, &b.id)
            .unwrap()
            .unwrap()
            .trashed_at
            .is_none());
        assert!(db::list_history(&c, &a.id, 100).unwrap().is_empty());
    }
    #[test]
    fn sync_conflict_undo_keeps_newer_edits_and_restores_copy() {
        let (c, a, b) = setup();
        let r = resolve(&c, &request(&c, &b)).unwrap();
        db::update_object(&c, &a.id, None, Some(&body("later work")), None, None).unwrap();
        let u = undo(&c, &r.undo_token).unwrap();
        assert!(u.kept_newer);
        assert!(!u.copy_missing);
        assert!(u.original.is_none());
        assert!(u.copy_restored);
        assert_eq!(
            db::get_object(&c, &a.id).unwrap().unwrap().content,
            body("later work")
        );
    }
    #[test]
    fn sync_conflict_undo_reports_a_purged_copy_without_claiming_newer_edits() {
        let (c, a, b) = setup();
        let r = resolve(&c, &request(&c, &b)).unwrap();
        assert!(db::delete_object(&c, &b.id).unwrap());
        let u = undo(&c, &r.undo_token).unwrap();
        assert!(u.copy_missing);
        assert!(!u.kept_newer);
        assert!(!u.copy_restored);
        assert!(u.original.is_none());
        assert_eq!(
            db::get_object(&c, &a.id).unwrap().unwrap().content,
            r.original.content
        );
        assert!(db::list_history(&c, &a.id, 100).unwrap().iter().any(|h| {
            let entry = db::get_history_entry(&c, &a.id, h.id).unwrap().unwrap();
            let patch: serde_json::Value = serde_json::from_str(&entry.patch).unwrap();
            patch["content"] == a.content
        }));
        assert!(undo(&c, &r.undo_token).is_err());
    }
    #[test]
    fn sync_conflict_receipt_upgrade_preserves_order_and_the_ten_receipt_limit() {
        let path = std::env::temp_dir().join(format!(
            "notible-conflict-upgrade-{}.db",
            uuid::Uuid::new_v4()
        ));
        let (original_id, copy_id, token, oldest_token, rowid);
        {
            let c = db::open(path.to_str().unwrap()).unwrap();
            c.execute_batch("DROP TABLE sync_conflict_undo;").unwrap();
            c.execute_batch(SCHEMA).unwrap(); // The previous version's copy FK.
            c.execute("UPDATE schema_version SET version=32", [])
                .unwrap();
            let a = db::create_object(&c, "note", "a", Some(&body("current")), None, None).unwrap();
            let mut first = String::new();
            let mut last = String::new();
            let mut latest_copy = String::new();
            for i in 0..10 {
                let b =
                    db::create_object(&c, "note", "b", Some(&body("saved")), None, None).unwrap();
                register(
                    &c,
                    &json!({"originalId":a.id,"copyId":b.id,"fields":["content"]}),
                )
                .unwrap();
                last = resolve(&c, &request(&c, &b)).unwrap().undo_token;
                if i == 0 {
                    first = last.clone();
                }
                latest_copy = b.id;
            }
            rowid = c
                .query_row(
                    "SELECT rowid FROM sync_conflict_undo WHERE token=?1",
                    [&last],
                    |r| r.get::<_, i64>(0),
                )
                .unwrap();
            (original_id, copy_id, token, oldest_token) = (a.id, latest_copy, last, first);
        }
        {
            let c = db::open(path.to_str().unwrap()).unwrap();
            assert_eq!(
                c.query_row(
                    "SELECT rowid FROM sync_conflict_undo WHERE token=?1",
                    [&token],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
                rowid
            );
            let b = db::create_object(&c, "note", "b", Some(&body("saved")), None, None).unwrap();
            register(
                &c,
                &json!({"originalId":original_id,"copyId":b.id,"fields":["content"]}),
            )
            .unwrap();
            resolve(&c, &request(&c, &b)).unwrap();
            assert_eq!(
                c.query_row("SELECT COUNT(*) FROM sync_conflict_undo", [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                10
            );
            assert!(undo(&c, &oldest_token).is_err());
            db::delete_object(&c, &copy_id).unwrap();
            assert!(undo(&c, &token).unwrap().copy_missing);
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn sync_conflict_mixed_fields_and_manual_pair_keep_copy() {
        for mixed in [true, false] {
            let (c, a, b) = setup();
            if mixed {
                register(
                    &c,
                    &json!({"originalId":a.id,"copyId":b.id,"fields":["title"]}),
                )
                .unwrap();
            } else {
                c.execute("DELETE FROM sync_conflicts", []).unwrap();
            }
            let p = pair(&c, &b.id, Some(&a.id)).unwrap();
            let req = Resolution {
                copy_id: b.id.clone(),
                original_id: a.id,
                original_stamp: p.original_stamp,
                copy_stamp: p.copy_stamp,
                content: body("chosen"),
            };
            assert!(!resolve(&c, &req).unwrap().copy_trashed);
            assert!(db::get_object(&c, &b.id)
                .unwrap()
                .unwrap()
                .trashed_at
                .is_none());
        }
    }
    #[test]
    fn sync_conflict_metadata_replay_cannot_repoint_or_narrow() {
        let (c, a, b) = setup();
        let other = db::create_object(&c, "note", "Same title", None, None, None).unwrap();
        assert!(!register(
            &c,
            &json!({"originalId":other.id,"copyId":b.id,"fields":["content"]})
        )
        .unwrap());
        register(
            &c,
            &json!({"originalId":a.id,"copyId":b.id,"fields":["props"]}),
        )
        .unwrap();
        register(
            &c,
            &json!({"originalId":a.id,"copyId":b.id,"fields":["content"]}),
        )
        .unwrap();
        let d = descriptors(&c).unwrap();
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].fields, vec!["content", "props"]);
        db::trash_object(&c, &b.id).unwrap();
        register(
            &c,
            &json!({"originalId":a.id,"copyId":b.id,"fields":["content"]}),
        )
        .unwrap();
        assert!(queue(&c, 0).unwrap().is_empty());
    }
    #[test]
    fn sync_conflict_bad_metadata_and_rich_body_are_refused() {
        let (c, a, b) = setup();
        for bad in [
            json!(null),
            json!({"originalId":a.id,"copyId":b.id,"fields":[]}),
            json!({"originalId":a.id,"copyId":a.id,"fields":["content"]}),
            json!({"originalId":"no","copyId":b.id,"fields":["content"]}),
            json!({"originalId":a.id,"copyId":b.id,"fields":["execute"]}),
        ] {
            assert!(!register(&c, &bad).unwrap());
        }
        for text in [
            "malformed",
            r#"{"type":"doc","content":[{"type":"heading"}]}"#,
            r#"{"type":"doc","content":[{"type":"paragraph","attrs":{}}]}"#,
        ] {
            let mut req = request(&c, &b);
            req.content = text.into();
            assert!(resolve(&c, &req).is_err());
        }
        assert!(!flat(&"x".repeat(2_000_001)));
    }
    #[test]
    fn sync_conflict_paginated_queue_has_no_loss() {
        let (c, a, _) = setup();
        for _ in 0..53 {
            let b = db::create_object(&c, "note", "Same title", None, None, None).unwrap();
            register(
                &c,
                &json!({"originalId":a.id,"copyId":b.id,"fields":["content"]}),
            )
            .unwrap();
        }
        assert_eq!(queue(&c, 0).unwrap().len(), 50);
        assert_eq!(queue(&c, 50).unwrap().len(), 4);
    }
    #[test]
    fn sync_conflict_descriptors_and_undo_survive_database_reopen() {
        let path =
            std::env::temp_dir().join(format!("notible-conflict-{}.db", uuid::Uuid::new_v4()));
        let token;
        {
            let c = db::open(path.to_str().unwrap()).unwrap();
            let a = db::create_object(&c, "note", "a", Some(&body("current")), None, None).unwrap();
            let b = db::create_object(&c, "note", "b", Some(&body("saved")), None, None).unwrap();
            register(
                &c,
                &json!({"originalId":a.id,"copyId":b.id,"fields":["content"]}),
            )
            .unwrap();
            token = resolve(&c, &request(&c, &b)).unwrap().undo_token;
        }
        {
            let c = db::open(path.to_str().unwrap()).unwrap();
            assert_eq!(descriptors(&c).unwrap().len(), 1);
            assert!(undo(&c, &token).unwrap().copy_restored);
        }
        std::fs::remove_file(path).unwrap();
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    pub copy_id: String,
    pub original_id: String,
    pub original_stamp: String,
    pub copy_stamp: String,
    pub content: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub original: Object,
    pub undo_token: String,
    pub copy_trashed: bool,
}

fn transaction<T>(conn: &Connection, run: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;
    match run() {
        Ok(v) => {
            if let Err(e) = conn.execute_batch("COMMIT") {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(e.to_string());
            }
            Ok(v)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}
pub fn resolve(conn: &Connection, request: &Resolution) -> Result<Saved, String> {
    transaction(conn, || {
        let p = pair(conn, &request.copy_id, Some(&request.original_id))?;
        if p.original.id != request.original_id
            || p.original_stamp != request.original_stamp
            || p.copy_stamp != request.copy_stamp
        {
            return Err("conflict".into());
        }
        if !flat(&p.original.content) || !flat(&p.copy.content) || !flat(&request.content) {
            return Err("unsupported".into());
        }
        let old = p.original.content.clone();
        let original = db::resolve_body_in_transaction(conn, &p.original, &request.content)
            .map_err(|e| e.to_string())?;
        let copy_trashed = p
            .descriptor
            .as_ref()
            .is_some_and(|d| d.fields == ["content"]);
        if copy_trashed {
            db::trash_object(conn, &p.copy.id).map_err(|e| e.to_string())?;
        }
        let copy = db::get_object(conn, &p.copy.id)
            .map_err(|e| e.to_string())?
            .ok_or("not_found")?;
        let token = uuid::Uuid::new_v4().to_string();
        // Bounded, durable Undo receipts; older recovery remains in history/Trash.
        conn.execute("DELETE FROM sync_conflict_undo WHERE rowid NOT IN (SELECT rowid FROM sync_conflict_undo ORDER BY rowid DESC LIMIT 9)",[]).map_err(|e|e.to_string())?;
        conn.execute("INSERT INTO sync_conflict_undo(token,original_id,copy_id,content,original_stamp,copy_stamp) VALUES(?1,?2,?3,?4,?5,?6)",
            params![token,original.id,copy.id,old,stamp(conn,&original).map_err(|e|e.to_string())?,stamp(conn,&copy).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        Ok(Saved {
            original,
            undo_token: token,
            copy_trashed,
        })
    })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Undone {
    pub original: Option<Object>,
    pub copy_restored: bool,
    pub kept_newer: bool,
    pub copy_missing: bool,
}
pub fn undo(conn: &Connection, token: &str) -> Result<Undone, String> {
    transaction(conn, || {
        let receipt:Option<(String,String,String,String,String)>=conn.query_row("SELECT original_id,copy_id,content,original_stamp,copy_stamp FROM sync_conflict_undo WHERE token=?1",[token],
            |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(|e|e.to_string())?;
        let (id, copy_id, body, os, cs) = receipt.ok_or("not_found")?;
        let original = db::get_object(conn, &id).map_err(|e| e.to_string())?;
        let copy = db::get_object(conn, &copy_id).map_err(|e| e.to_string())?;
        let copy_missing = copy.is_none();
        let unchanged = original
            .as_ref()
            .is_some_and(|o| stamp(conn, o).ok().as_ref() == Some(&os))
            && copy
                .as_ref()
                .is_some_and(|o| stamp(conn, o).ok().as_ref() == Some(&cs));
        let restored = if unchanged {
            Some(
                db::resolve_body_in_transaction(conn, original.as_ref().unwrap(), &body)
                    .map_err(|e| e.to_string())?,
            )
        } else {
            None
        };
        let copy_restored = copy.as_ref().is_some_and(|c| c.trashed_at.is_some());
        if copy_restored {
            db::restore_object(conn, &copy_id).map_err(|e| e.to_string())?;
        }
        conn.execute("DELETE FROM sync_conflict_undo WHERE token=?1", [token])
            .map_err(|e| e.to_string())?;
        Ok(Undone {
            original: restored,
            copy_restored,
            kept_newer: !unchanged && !copy_missing,
            copy_missing,
        })
    })
}
