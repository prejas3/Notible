# Notible local integration contract

Contract version: `1.1` (Notible `0.26.2`)

Sync wire contract: `0.2` — relation creation metadata and relation tombstones
are additive fields. Older clients may omit relation `created_at`; the server
normalizes that value to `0` during the compatibility window.

Notible keeps integration data local. The desktop frontend uses versioned Tauri commands, while external read-only clients use the bundled MCP server. Consumers should treat object `props` as an extensible JSON object and ignore keys they do not understand.

## Stable object shape

Every object exposes `id`, `type`, `title`, TipTap `content`, JSON `props`, `created_at`, `updated_at`, `archived_at`, and `trashed_at`. IDs are UUIDs. Timestamps are Unix milliseconds.

## Desktop command surface

The stable read commands are `get_object`, `query_objects`, `search_objects`, `list_types`, `list_relations`, `get_backlinks`, and `list_integration_events`. Mutating commands use complete JSON strings for `content` and `props`; `update_object` supports `expected_updated_at` for optimistic locking.

`list_integration_events(after, limit)` is the local webhook/outbox equivalent. It returns ordered `object.created`, `object.updated`, and `object.deleted` events. Persist the last processed numeric `id` and pass it as `after` on the next poll. Consumers must be idempotent.

## Sync relation contract

Cloud sync operates on logical records, not the SQLite database file. Relations
in the sync payload have `from_id`, `to_id`, `kind` and `created_at`. Deleted
relations are represented by `relation_tombstones` with the same identity and a
`deleted_at` timestamp. A relation is not recreated when its `created_at` is not
newer than the tombstone. Recreating the relation later creates a new timestamp.

Clients must persist relation tombstones and treat repeated delivery as
idempotent. Deleting an object also removes its touching relations; the object
tombstone remains the authoritative deletion marker for that object.

## MCP

Run `mcp-server/index.js` with `NOTIBLE_DB_PATH` pointing to `notible.db`. Available read-only tools are `search_notes`, `list_notes`, `get_note`, `list_types`, and `list_changes`. The MCP server never mutates the workspace.

Finance objects (`financial_entry`, `time_entry`, and `vendor`) are excluded from all MCP reads and the change stream by default. A user who explicitly wants to expose them can start the server with `NOTIBLE_INCLUDE_FINANCE=1`. This is a local permission boundary; integrations must never enable it silently.

## Import

Dropping `.md`, `.markdown`, or `.txt` files imports notes. Dropping `.csv` or `.tsv` files imports up to 10,000 task/issue rows into Triage. Recognized title columns are `title`, `name`, and `summary`; recognized type columns are `type`, `kind`, and `item type`. Remaining columns are preserved in `props`.

## Compatibility

Minor releases may add commands, event fields, object types, and property keys. Removing or changing an existing field requires a new major contract version.
