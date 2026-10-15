-- F1: stable operation ids make retries and duplicate deliveries harmless.
-- Safe to run against an existing D1 database.
CREATE TABLE IF NOT EXISTS sync_operations (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  event TEXT NOT NULL,
  object_id TEXT,
  object_type TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  received_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, operation_id)
);
CREATE INDEX IF NOT EXISTS idx_sync_operations_workspace_received
  ON sync_operations(workspace_id, received_at);
