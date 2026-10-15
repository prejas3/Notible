-- Notible Teams prototype. The server holds membership and ciphertext only;
-- see 2026-09-29-notible-teams-prototype-design.md (internal, not published).
CREATE TABLE users (
  id TEXT PRIMARY KEY,          -- Google `sub`
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,  -- SHA-256 of the bearer token
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,        -- fixed at creation
  owner_id TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE members (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id)
);
CREATE TABLE invites (
  token_hash TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by TEXT
);
CREATE TABLE items (
  space_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  author_id TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  PRIMARY KEY (space_id, item_key)
);
CREATE INDEX items_by_seq ON items (space_id, seq);
CREATE INDEX sessions_by_user ON sessions (user_id);
