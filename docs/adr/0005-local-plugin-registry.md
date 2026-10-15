# ADR-0005: trwały lokalny rejestr pluginów

- Status: accepted for local implementation
- Date: 2026-08-07
- Scope: Core/plugin separation before Cloudflare

## Decision

SQLite stores plugin installation metadata and lifecycle state. Executable
plugin files are stored outside SQLite in a managed local directory.

Each installed version is a separate row identified by `(plugin_id, version)`.
The row stores:

- source (`builtin`, `local-file` or `package`);
- managed installation path;
- validated manifest JSON;
- whether the artifact was explicitly trusted/verified;
- lifecycle state (`active`, `disabled`, `installed`, `failed`);
- last error and timestamps.

Only one version of a plugin may be `active` at a time. Changing the active
version first disables the previous active row, then activates the candidate.
The live `ExtensionHost` remains in memory and owns registrations; SQLite is
the durable inventory and desired state, not a place to store executable code.

## Consequences

- Core can show installed versions and repair a failed plugin before loading it.
- Restart hydration can re-read the managed directory and recreate the live
  host state.
- Backup/restore can include plugin metadata without copying code into the
  workspace database.
- The ZIP installer can extract into a versioned directory and reuse the same
  manifest/entrypoint validator as a local folder.
- Cloudflare is not required for installation, lifecycle or rollback tests.

## Rejected alternatives

- Storing plugin code in SQLite: makes backup, execution and recovery harder.
- Storing only `active.json`: loses queryable lifecycle history and error state.
- Using localStorage as Core state: it is only a frontend preview fallback and
  is not authoritative in the desktop application.
