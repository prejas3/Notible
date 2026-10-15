-- Etap B: read side of the Plugin Market — authors, plugins, releases.
-- Additive. Safe to run against an existing D1 database; nothing existing is
-- altered. The submission / moderation / rating tables (Etapy C–F) land in a
-- later migration once the owner decisions in the handoff §15 are made.
-- Spec: 2026-09-09-plugin-market-etap-a-design.md (internal, not published) §4

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
  categories TEXT NOT NULL DEFAULT '[]',           -- JSON array of strings
  license TEXT NOT NULL DEFAULT '',
  -- draft: never listed. listed: public. delisted: hidden from search, existing
  -- installs unaffected (delisting is not revocation — see spec §3).
  publication_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (publication_status IN ('draft', 'listed', 'delisted')),
  reserved INTEGER NOT NULL DEFAULT 0,             -- 1 = builtin/official id, no takeover
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
  permissions TEXT NOT NULL DEFAULT '[]',          -- JSON array of strings
  changelog TEXT NOT NULL DEFAULT '',
  package_sha256 TEXT NOT NULL,
  package_size INTEGER NOT NULL,
  -- Immutable public object key, e.g. plugins/<id>/versions/<version>/<hash>.zip.
  object_key TEXT NOT NULL,
  -- URL of the signed update manifest (client still verifies Ed25519 + hash
  -- itself; the API never becomes the trust root).
  manifest_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'revoked')),
  published_at INTEGER,
  UNIQUE (plugin_id, version)
);
CREATE INDEX IF NOT EXISTS idx_market_releases_plugin_status
  ON market_releases(plugin_id, status, published_at);
