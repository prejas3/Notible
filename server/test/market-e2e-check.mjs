// Offline end-to-end check for the market routes: the real Hono handlers from
// src/market.ts against a real in-memory SQLite loaded from schema.sql. No
// wrangler, no localhost, no network.
// node --experimental-strip-types server/test/market-e2e-check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { marketApp } from "../src/market.ts";

// --- minimal D1 adapter over node:sqlite --------------------------------
class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.binds = []; }
  bind(...values) { this.binds = values; return this; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.binds) }; }
  async first() { return this.db.prepare(this.sql).get(...this.binds) ?? null; }
  async run() { this.db.prepare(this.sql).run(...this.binds); return { success: true }; }
}
class FakeD1 {
  constructor(db) { this.db = db; }
  prepare(sql) { return new FakeStatement(this.db, sql); }
}

const schema = readFileSync(fileURLToPath(new URL("../schema.sql", import.meta.url)), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(schema);

const insertPlugin = db.prepare(
  `INSERT INTO market_plugins (id, owner_user_id, name, summary, categories, license, publication_status, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insertRelease = db.prepare(
  `INSERT INTO market_releases (id, plugin_id, version, channel, api_version, min_core_version, max_core_version, permissions, changelog, package_sha256, package_size, object_key, manifest_url, status, published_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

// D1 enforces foreign keys, and so does node:sqlite — seed the real owner row.
db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
  .run("u1", "ada@test", "x", 0);
db.prepare("INSERT INTO market_authors (user_id, public_name, bio, created_at) VALUES (?, ?, ?, ?)")
  .run("u1", "Ada", "builds things", 0);

// listed, updated_at 300, two published releases + one still pending
insertPlugin.run("acme.todo", "u1", "Todo", "task lists and reminders", '["productivity","tasks"]', "MIT", "listed", 0, 300);
insertRelease.run("r1", "acme.todo", "1.0.0", "stable", "1.10", "0.70.0", null, "[]", "first", "a".repeat(64), 1000, "k1", "https://u.test/acme.todo/1.0.0/manifest.json", "published", 100);
insertRelease.run("r2", "acme.todo", "1.2.0", "stable", "1.11", "0.79.0", null, '["data.read"]', "second", "b".repeat(64), 1200, "k2", "https://u.test/acme.todo/1.2.0/manifest.json", "published", 200);
insertRelease.run("r3", "acme.todo", "1.3.0", "stable", "1.12", "0.80.0", null, "[]", "unreviewed", "c".repeat(64), 1300, "k3", "https://u.test/acme.todo/1.3.0/manifest.json", "pending", null);

// two more listed plugins for pagination / sort
insertPlugin.run("beta.notes", "u1", "Notes", "quick notes", '["productivity"]', "GPL", "listed", 0, 200);
insertRelease.run("r4", "beta.notes", "0.9.0", "stable", "1.11", "0.75.0", null, "[]", "n", "d".repeat(64), 500, "k4", "https://u.test/beta.notes/0.9.0/manifest.json", "published", 150);
insertPlugin.run("gamma.calendar", "u1", "Calendar", "months and weeks", '["time"]', "MIT", "listed", 0, 100);

// invisible: draft + delisted
insertPlugin.run("secret.draft", "u1", "Draft", "not ready", "[]", "MIT", "draft", 0, 999);
insertPlugin.run("old.removed", "u1", "Removed", "was here", "[]", "MIT", "delisted", 0, 999);
insertRelease.run("r5", "old.removed", "2.0.0", "stable", "1.11", "0.70.0", null, "[]", "x", "e".repeat(64), 800, "k5", "https://u.test/old.removed/2.0.0/manifest.json", "published", 400);

const env = { DB: new FakeD1(db) };
const get = async (path) => {
  const res = await marketApp.request(path, {}, env);
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
};

// --- list: only listed plugins, newest published release as latestVersion ---
{
  const { body } = await get("/v1/market/plugins");
  const ids = body.items.map((p) => p.id);
  assert.deepEqual(ids, ["acme.todo", "beta.notes", "gamma.calendar"], "listed only, newest updated_at first");
  assert.ok(!ids.includes("secret.draft") && !ids.includes("old.removed"), "draft/delisted hidden");
  assert.equal(body.items[0].latestVersion, "1.2.0", "latest = newest PUBLISHED, not the pending 1.3.0");
  assert.equal(body.items[0].manifestUrl, "https://u.test/acme.todo/1.2.0/manifest.json", "card carries the newest published manifest URL");
  assert.equal(body.items[2].latestVersion, null, "plugin with no published release → null");
  assert.equal(body.items[2].manifestUrl, null, "no published release → manifestUrl null");
  assert.deepEqual(body.items[0].categories, ["productivity", "tasks"]);
  assert.equal(body.nextCursor, null, "single page → no cursor");
}

// --- search + category ------------------------------------------------
assert.deepEqual((await get("/v1/market/plugins?q=reminders")).body.items.map((p) => p.id), ["acme.todo"], "q matches summary");
assert.deepEqual((await get("/v1/market/plugins?q=notes")).body.items.map((p) => p.id), ["beta.notes"], "q matches name");
assert.deepEqual((await get("/v1/market/plugins?category=time")).body.items.map((p) => p.id), ["gamma.calendar"]);
assert.equal((await get("/v1/market/plugins?q=nothingmatches")).body.items.length, 0);

// --- sort=name -------------------------------------------------------
assert.deepEqual(
  (await get("/v1/market/plugins?sort=name")).body.items.map((p) => p.name),
  ["Calendar", "Notes", "Todo"],
  "sort=name is ascending by name",
);
assert.deepEqual(
  (await get("/v1/market/plugins?sort=%3BDROP%20TABLE")).body.items.map((p) => p.id),
  ["acme.todo", "beta.notes", "gamma.calendar"],
  "unknown sort falls back to recent, no SQL breakage",
);

// --- keyset pagination ---------------------------------------------
{
  const first = (await get("/v1/market/plugins?limit=2")).body;
  assert.deepEqual(first.items.map((p) => p.id), ["acme.todo", "beta.notes"]);
  assert.ok(first.nextCursor, "more pages → cursor present");
  const second = (await get(`/v1/market/plugins?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)).body;
  assert.deepEqual(second.items.map((p) => p.id), ["gamma.calendar"]);
  assert.equal(second.nextCursor, null, "last page → no cursor");
}

// --- detail --------------------------------------------------------
{
  const { status, body } = await get("/v1/market/plugins/acme.todo");
  assert.equal(status, 200);
  assert.equal(body.author.name, "Ada");
  assert.deepEqual(body.releases.map((r) => r.version), ["1.2.0", "1.0.0"], "published only, newest first");
  assert.ok(!body.releases.some((r) => r.version === "1.3.0"), "pending release excluded from detail");
  assert.equal(body.releases[0].manifestUrl, "https://u.test/acme.todo/1.2.0/manifest.json");
  assert.deepEqual(body.releases[0].permissions, ["data.read"]);
}
assert.equal((await get("/v1/market/plugins/secret.draft")).status, 404, "draft plugin detail → 404");
assert.equal((await get("/v1/market/plugins/old.removed")).status, 404, "delisted plugin detail → 404");
assert.equal((await get("/v1/market/plugins/does.not.exist")).status, 404);

// --- releases sub-route -----------------------------------------
{
  const { status, body } = await get("/v1/market/plugins/acme.todo/releases");
  assert.equal(status, 200);
  assert.deepEqual(body.items.map((r) => r.version), ["1.2.0", "1.0.0"]);
}
assert.equal((await get("/v1/market/plugins/secret.draft/releases")).status, 404);

// --- DB not configured -----------------------------------------
{
  const res = await marketApp.request("/v1/market/plugins", {}, {});
  assert.equal(res.status, 503, "no DB binding → 503, not a crash");
}

console.log("server market e2e check: OK");
