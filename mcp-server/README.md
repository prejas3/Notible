# Notible MCP Server

An MCP server (stdio) that gives compatible models safe access to the local
Notible database (`%APPDATA%\com.notible.app\notible.db`). Reads never change
data. Edits to regular objects are two-step and recorded in history.

## Installation and configuration

Run `npm install` in the `mcp-server` folder, then add the server to your MCP
client configuration:

```json
{
  "mcpServers": {
    "notible": {
      "command": "node",
      "args": ["<path to Notible>\\mcp-server\\index.js"]
    }
  }
}
```

The optional `NOTIBLE_DB_PATH` environment variable points to a different database.
Notible shows a ready-made configuration for Claude Code, Codex and other
clients in Settings → MCP server → Connection.

## Settings (version 1.3.0)

What an AI may do beyond reading is set in Notible, Settings → MCP server,
and stored in the app's `mcp_settings` table on this device only (not synced).
The server reads it on every call; no MCP tool can change it, and the app
accepts changes only from its separate MCP settings window, which plugins
cannot reach.

- **Allow edits** (on by default, as before 1.3.0): `apply_object_update`,
  `create_object` and `undo_mcp_update`. Turned off, those calls are refused
  at once, and the tools are no longer listed after the client restarts.
  `propose_object_update` always works because it writes nothing.
- **Include finance data** (off by default): `financial_entry`, `time_entry`
  and `vendor` objects appear in reads. They can never be edited through MCP.

Environment variables can only narrow these: `NOTIBLE_MCP_APPROVAL_MODE=propose-only`
turns edits off (the in-app AI always sets it) and `NOTIBLE_INCLUDE_FINANCE=0`
hides finance. `NOTIBLE_INCLUDE_FINANCE=1` no longer turns finance on; use the switch.

In Hive the server is defined in `../.hive/mcp/notible.json` (using the bundled
`runtime/node.exe`), and the agent instructions live in the skill
`../.hive/skills/notible-worklog/SKILL.md`. Both are enabled in Hive.

`content` on write is plain Markdown. The server stores it in the app's format
(one paragraph per line, like `documentFromText` in Core).

## Tools

Read: `search_notes`, `list_notes`, `get_note`, `list_types`, `list_changes`.

Controlled writes:

- `propose_object_update` prepares a `before/after` preview without writing;
- `apply_object_update` applies an unexpired proposal and returns a `historyId`;
- `undo_mcp_update` restores the previous version, as long as the object has not changed since;
- `create_object` creates a task, issue or note after the `CREATE` confirmation.

Cleanup (move to Trash, approved by the user in Notible):

- `preview_trash_notes(ids, scopeId)` is read-only: for up to 20 exact note ids
  it returns titles, paths, versions, incoming links and why a note is
  excluded, plus a `previewId`. Only active notes without children qualify;
  notes marked "Protect from AI" and the note that opens on start never do.
- `request_trash_notes(previewId, reason)` sends the eligible notes to the
  running app as one request. Nothing is trashed by this call. With Notible
  closed it fails with `app_not_running` and queues nothing. One request can
  wait at a time, and there are at most 5 per hour across all MCP clients.
- `get_trash_request_status(requestId)` reports `pending`, `rejected`,
  `expired`, `conflict` or `applied`.

The user turns cleanup on per workspace or project in Settings → MCP server,
then approves or rejects each note there. Notible re-checks every note, makes
a backup, moves the approved ones to the Trash, and logs it. The user can
undo it for 24 hours. Requests expire after 15 minutes, or when the app quits
or a backup is restored. There is no tool to approve a request, delete
permanently or empty the Trash.

MCP does not edit projects, automations, team members or finance objects. It
offers no permanent deletion. Updates use optimistic locking, so they never
overwrite a newer change made in the app.

## Tests

Run `npm test` in the `mcp-server` folder.
