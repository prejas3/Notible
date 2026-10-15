// Runnable check for the Plugin Market read side (Etap B) — pure helpers only.
// No HTTP, no D1. node --experimental-strip-types server/test/market-check.mjs
import assert from "node:assert/strict";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  buildListSql,
  cursorForRow,
  decodeCursor,
  encodeCursor,
  parseListQuery,
  rowToCard,
  rowToReleaseSummary,
} from "../src/market.ts";

const query = (s) => parseListQuery(new URLSearchParams(s));

// --- parseListQuery ------------------------------------------------------
{
  const q = query("");
  assert.equal(q.limit, DEFAULT_LIMIT);
  assert.equal(q.sort, "recent");
  assert.equal(q.search, null);
  assert.equal(q.category, null);
  assert.equal(q.cursor, null);
}
assert.equal(query("limit=1000").limit, MAX_LIMIT, "limit clamped to MAX_LIMIT");
assert.equal(query("limit=0").limit, 1, "limit floored to 1");
assert.equal(query("limit=abc").limit, DEFAULT_LIMIT, "non-numeric limit → default");
assert.equal(query("sort=name").sort, "name");
assert.equal(query("sort=; DROP TABLE market_plugins").sort, "recent", "unknown sort → default, never interpolated");
assert.equal(query("q=" + "x".repeat(500)).search.length, 100, "search truncated to MAX_SEARCH_LEN");
assert.equal(query("category=Dev-Tools").category, "dev-tools", "category lowercased");
assert.equal(query("category=bad;drop").category, null, "category with punctuation rejected");

// --- cursor codec ------------------------------------------------------
{
  const c = { key: 1717171717, id: "abc-123" };
  assert.deepEqual(decodeCursor(encodeCursor(c)), c, "cursor round-trips");
  const named = { key: "Widget", id: "p9" };
  assert.deepEqual(decodeCursor(encodeCursor(named)), named, "string-key cursor round-trips");
}
for (const bad of [null, undefined, "", "!!!!", "e30", encodeCursor({ key: 1, id: "" }), btoa("[1,2,3]")]) {
  assert.equal(decodeCursor(bad), null, `malformed cursor ${JSON.stringify(bad)} → null`);
}
assert.equal(query("cursor=garbage").cursor, null, "garbage cursor param → null, not an error");

// --- buildListSql ----------------------------------------------------
{
  const { sql, binds } = buildListSql(query(""));
  assert.match(sql, /publication_status = 'listed'/, "only listed plugins");
  assert.match(sql, /ORDER BY p\.updated_at DESC, p\.id DESC/);
  assert.deepEqual(binds, [DEFAULT_LIMIT + 1], "fetches one row over the limit");
}
{
  const { sql, binds } = buildListSql(query("q=todo&category=productivity&sort=name&limit=10"));
  assert.match(sql, /p\.name LIKE '%' \|\| \? \|\| '%'/);
  assert.match(sql, /ORDER BY p\.name ASC, p\.id ASC/);
  assert.deepEqual(binds, ["todo", "todo", "productivity", 11]);
}
{
  // cursor present: keyset predicate + its binds, limit last
  const cur = encodeCursor({ key: 42, id: "p7" });
  const { sql, binds } = buildListSql(query(`cursor=${cur}`));
  assert.match(sql, /p\.updated_at < \? OR \(p\.updated_at = \? AND p\.id < \?\)/);
  assert.deepEqual(binds, [42, 42, "p7", DEFAULT_LIMIT + 1]);
}
{
  const { sql } = buildListSql(query("sort=name&cursor=" + encodeCursor({ key: "Zeta", id: "z1" })));
  assert.match(sql, /p\.name > \? OR \(p\.name = \? AND p\.id > \?\)/, "name sort uses ascending keyset");
}

// --- row mapping -----------------------------------------------------
{
  const card = rowToCard({
    id: "acme.todo", name: "Todo", summary: "Tasks", categories: '["productivity","tasks"]',
    license: "MIT", updated_at: 123, latest_version: "1.2.0",
    latest_manifest_url: "https://u.test/acme.todo/1.2.0/manifest.json",
  });
  assert.deepEqual(card, {
    id: "acme.todo", name: "Todo", summary: "Tasks", categories: ["productivity", "tasks"],
    license: "MIT", latestVersion: "1.2.0",
    manifestUrl: "https://u.test/acme.todo/1.2.0/manifest.json", updatedAt: 123,
  });
}
{
  const noRelease = rowToCard({ id: "x", name: "X", summary: "", categories: "not json", license: "", updated_at: 0, latest_version: null, latest_manifest_url: null });
  assert.deepEqual(noRelease.categories, [], "malformed categories JSON → []");
  assert.equal(noRelease.latestVersion, null, "no release → latestVersion null");
  assert.equal(noRelease.manifestUrl, null, "no release → manifestUrl null");
}
{
  const rel = rowToReleaseSummary({
    version: "1.0.0", channel: "stable", api_version: "1.11", min_core_version: "0.79.0",
    max_core_version: null, permissions: '["data.read"]', changelog: "first",
    package_sha256: "a".repeat(64), package_size: 2048,
    manifest_url: "https://updates.example/plugins/acme.todo/stable/manifest.json", published_at: 999,
  });
  assert.equal(rel.maxCoreVersion, null);
  assert.deepEqual(rel.permissions, ["data.read"]);
  assert.equal(rel.manifestUrl, "https://updates.example/plugins/acme.todo/stable/manifest.json");
  assert.equal(rel.publishedAt, 999);
}
assert.equal(rowToReleaseSummary({ version: "1", channel: "stable", api_version: "1", min_core_version: "1", max_core_version: null, permissions: "x", changelog: "", package_sha256: "", package_size: 0, manifest_url: "", published_at: null }).publishedAt, 0, "null published_at → 0");

// --- cursorForRow --------------------------------------------------
assert.deepEqual(cursorForRow({ id: "p1", name: "Alpha", updated_at: 555 }, "recent"), { key: 555, id: "p1" });
assert.deepEqual(cursorForRow({ id: "p1", name: "Alpha", updated_at: 555 }, "name"), { key: "Alpha", id: "p1" });

console.log("server market check: OK");
