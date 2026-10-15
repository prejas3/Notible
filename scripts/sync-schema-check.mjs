import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Database from "../mcp-server/node_modules/better-sqlite3/lib/index.js";

const schema = await readFile(new URL("../server/schema.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../server/migrations/0002-sync-relation-tombstones.sql", import.meta.url), "utf8");
const db = new Database(":memory:");

try {
  db.exec(schema);
  db.exec("DROP TABLE sync_relation_tombstones; DROP TABLE sync_relation_state;");
  db.exec(`
    INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'u1@example.test', 'hash', 1);
    INSERT INTO workspaces (id, owner_id, name, created_at) VALUES ('w1', 'u1', 'Test', 1);
    INSERT INTO sync_relations (workspace_id, from_id, to_id, kind) VALUES ('w1', 'a', 'b', 'links_to');
  `);
  db.exec(migration);
  db.exec(migration);

  const state = db.prepare(
    "SELECT created_at FROM sync_relation_state WHERE workspace_id = ? AND from_id = ? AND to_id = ? AND kind = ?",
  ).get("w1", "a", "b", "links_to");
  assert.deepEqual(state, { created_at: 0 });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sync_relation_tombstones").get().count, 0);
  console.log("Sync schema migration checks passed.");
} finally {
  db.close();
}

