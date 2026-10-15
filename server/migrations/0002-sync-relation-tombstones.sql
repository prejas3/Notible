-- F1: relation creation metadata and explicit relation-delete markers.
-- Safe to run against an existing D1 database. The existing sync_relations
-- table is intentionally not altered; state lives in a companion table.

CREATE TABLE IF NOT EXISTS sync_relation_state (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, from_id, to_id, kind)
);

INSERT OR IGNORE INTO sync_relation_state (workspace_id, from_id, to_id, kind, created_at)
SELECT workspace_id, from_id, to_id, kind, 0 FROM sync_relations;

CREATE TABLE IF NOT EXISTS sync_relation_tombstones (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, from_id, to_id, kind)
);
