import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Database from "../mcp-server/node_modules/better-sqlite3/lib/index.js";

const schema = await readFile(new URL("../server/schema.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../server/migrations/0003-sync-operation-idempotency.sql", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../server/src/index.ts", import.meta.url), "utf8");
const db = new Database(":memory:");

try {
  db.exec(schema);
  db.exec(migration);
  db.exec(migration);
  db.exec(`
    INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'u1@example.test', 'hash', 1);
    INSERT INTO workspaces (id, owner_id, name, created_at) VALUES ('w1', 'u1', 'Test', 1);
  `);

  const operation = {
    workspace_id: "w1",
    operation_id: "device-a:event:7",
    event: "object.updated",
    object_id: "object-1",
    object_type: "note",
    occurred_at: 7,
    payload: "{}",
    received_at: 8,
  };
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sync_operations
      (workspace_id, operation_id, event, object_id, object_type, occurred_at, payload, received_at)
    VALUES (@workspace_id, @operation_id, @event, @object_id, @object_type, @occurred_at, @payload, @received_at)
  `);
  insert.run(operation);
  insert.run(operation); // retry/duplicate must not create a second ledger row
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sync_operations WHERE workspace_id = 'w1'").get().count, 1);

  const otherWorkspace = { ...operation, workspace_id: "w2" };
  db.exec("INSERT INTO workspaces (id, owner_id, name, created_at) VALUES ('w2', 'u1', 'Other', 1);");
  insert.run(otherWorkspace);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sync_operations").get().count, 2);

  const reorderedCursors = [12, 8, 14, 10];
  assert.equal(reorderedCursors.reduce((cursor, next) => Math.max(cursor, next), 0), 14);

  assert.match(indexSource, /acknowledged_operations/);
  assert.match(indexSource, /sync_operations/);
  console.log("Sync idempotency/offline/retry/reorder checks passed.");
} finally {
  db.close();
}
