-- Run once with: wrangler d1 execute notible-sync --remote --file=./schema.sql
-- Sync keeps independent records and propagates explicit hard deletes as tombstones.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject),
  UNIQUE (provider, user_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS sync_objects (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  props TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  trashed_at INTEGER,
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS idx_sync_objects_updated ON sync_objects(workspace_id, updated_at);

CREATE TABLE IF NOT EXISTS sync_relations (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (workspace_id, from_id, to_id, kind)
);

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

CREATE TABLE IF NOT EXISTS sync_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  object_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  changed_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_changes_workspace ON sync_changes(workspace_id, seq);

CREATE TABLE IF NOT EXISTS sync_tombstones (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  object_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, object_id)
);

-- Idempotency ledger for offline/retried sync deliveries. Operation ids are
-- scoped to a workspace so two devices can never suppress each other.
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

-- Plugin Market, read side (Etap B). Also in migrations/0004-market-core.sql
-- for existing databases. Write/moderation tables (Etapy C-F) land later.
CREATE TABLE IF NOT EXISTS market_authors (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  public_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS market_plugins (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  categories TEXT NOT NULL DEFAULT '[]',
  license TEXT NOT NULL DEFAULT '',
  publication_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (publication_status IN ('draft', 'listed', 'delisted')),
  reserved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_market_plugins_listed
  ON market_plugins(publication_status, updated_at);

CREATE TABLE IF NOT EXISTS market_releases (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL REFERENCES market_plugins(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'stable',
  api_version TEXT NOT NULL,
  min_core_version TEXT NOT NULL,
  max_core_version TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  changelog TEXT NOT NULL DEFAULT '',
  package_sha256 TEXT NOT NULL,
  package_size INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  manifest_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'revoked')),
  published_at INTEGER,
  UNIQUE (plugin_id, version)
);
CREATE INDEX IF NOT EXISTS idx_market_releases_plugin_status
  ON market_releases(plugin_id, status, published_at);
