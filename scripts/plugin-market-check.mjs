/**
 * Runnable check for the plugin market's silent-failure surfaces: the catalog
 * validator that stands between a downloaded JSON file and the installer, the
 * build-market-catalog generator, and GitHub-release resolution.
 *
 * node --experimental-strip-types scripts/plugin-market-check.mjs
 */
import assert from "node:assert/strict";
import { validatePluginCatalog } from "../src/core/extensions/update.ts";
// --- v2 catalog validator (Model A) ---------------------------------------
const entry = (over = {}) => ({
  id: "somedevs.kanban",
  name: "Kanban",
  author: "SomeDevs",
  description: "A board view.",
  repo: "somedevs/notible-kanban",
  minCoreVersion: "0.79.0",
  apiVersion: "1.11",
  ...over,
});
const catalog = (over = {}) => ({ schemaVersion: 2, generatedAt: "2026-09-09T10:00:00.000Z", plugins: [entry()], ...over });

validatePluginCatalog(catalog());
validatePluginCatalog(catalog({ plugins: [] }));

const rejects = (value, pattern, why) => assert.throws(() => validatePluginCatalog(value), pattern, why);
rejects(catalog({ schemaVersion: 1 }), /unsupported plugin catalog schema/, "the old signed v1 file must be refused, not guessed at");
rejects(catalog({ schemaVersion: 3 }), /unsupported plugin catalog schema/);
rejects(catalog({ generatedAt: "yesterday" }), /ISO date/);
rejects(catalog({ plugins: {} }), /must be an array/);
rejects(catalog({ extra: 1 }), /unexpected fields: extra/);
rejects(catalog({ plugins: [entry({ id: "NotValid" })] }), /invalid entry\.id/);
rejects(catalog({ plugins: [entry({ id: "nodot" })] }), /invalid entry\.id/, "id must be namespaced");
rejects(catalog({ plugins: [entry({ repo: "not-a-repo" })] }), /entry\.repo/);
rejects(catalog({ plugins: [entry({ repo: "https://github.com/a/b" })] }), /entry\.repo/, "repo is owner/name, not a URL");
rejects(catalog({ plugins: [entry({ repo: "a/.." })] }), /"\." or "\.\."/, "'.'/'..' path segments in repo are refused");
rejects(catalog({ plugins: [entry({ repo: "../evil" })] }), /"\." or "\.\."/);
rejects(catalog({ plugins: [entry({ name: "" })] }), /entry\.name/);
rejects(catalog({ plugins: [entry({ author: "" })] }), /entry\.author/);
rejects(catalog({ plugins: [entry({ minCoreVersion: "1.2" })] }), /entry\.minCoreVersion/);
rejects(catalog({ plugins: [entry({ apiVersion: "1" })] }), /entry\.apiVersion/);
rejects(catalog({ plugins: [entry({ extra: 1 })] }), /unexpected fields: extra/);
rejects(catalog({ plugins: [entry(), entry()] }), /duplicate catalog entry/);
// RESERVED_CATALOG_IDS is intentionally empty under Model A (the catalog is
// owner-merged by PR), so a first-party id like notible.graph must validate —
// the owner relists the built-in plugins that way.
validatePluginCatalog(catalog({ plugins: [entry({ id: "notible.graph" })] }));

// --- resolveGithubRelease -------------------------------------------------
import { resolveGithubRelease } from "../src/core/app/marketSource.ts";

const ghSource = { id: "somedevs.kanban", name: "Kanban", author: "SomeDevs", description: "", releaseBase: "https://github.com/somedevs/notible-kanban/releases/latest/download" };
const goodManifest = { id: "somedevs.kanban", name: "Kanban", version: "1.4.0", apiVersion: "1.11", minCoreVersion: "0.79.0", entry: "main.js" };

const withFetch = async (impl, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
};
const jsonResponse = (body) => ({ ok: true, headers: { get: () => null }, body: null, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer });

await withFetch(async (url) => {
  assert.equal(url, "https://github.com/somedevs/notible-kanban/releases/latest/download/plugin.json");
  return jsonResponse(goodManifest);
}, async () => {
  const { manifest, zipUrl } = await resolveGithubRelease(ghSource);
  assert.equal(manifest.version, "1.4.0");
  assert.equal(manifest.maxCoreVersion, null);
  assert.equal(zipUrl, "https://github.com/somedevs/notible-kanban/releases/latest/download/somedevs.kanban.zip");
});

await withFetch(async () => jsonResponse({ ...goodManifest, id: "someone.else" }), async () => {
  await assert.rejects(resolveGithubRelease(ghSource), /different plugin id|does not match/);
});
await withFetch(async () => jsonResponse({ id: "somedevs.kanban" }), async () => {
  await assert.rejects(resolveGithubRelease(ghSource), /version|apiVersion|minCoreVersion/);
});
await withFetch(async () => jsonResponse({ ...goodManifest, version: "banana" }), async () => {
  await assert.rejects(resolveGithubRelease(ghSource), /semantic version/, "a non-semver release version is not installable");
});
await withFetch(async () => ({ ok: false, status: 404 }), async () => {
  await assert.rejects(resolveGithubRelease(ghSource), /404/);
});

console.log("Plugin market check passed.");
