/**
 * Drives the Workbench example through the real loader and host.
 *
 * Workbench exists to prove the API works, so this proves Workbench loads —
 * including the parts Pomodoro does not touch: a declared stylesheet, all seven
 * slots, and the content index behind a permission.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ExtensionHost } from "../src/core/extensions/host.ts";
import { loadLocalPluginDirectory } from "../src/core/extensions/loader.ts";
import { LocalPluginManager } from "../src/core/extensions/manager.ts";
import { UI_SLOTS } from "../packages/plugin-api/src/index.ts";

const root = resolve("plugins/examples/workbench");
const reader = { readText: async (_root, path) => readFile(path, "utf8") };

const artifact = await loadLocalPluginDirectory(root, reader, true);
assert.equal(artifact.manifest.id, "example.workbench");
assert.equal(artifact.styles.length, 1, "the declared stylesheet must be read off disk");
assert.equal(artifact.styles[0].path, "theme.css");
assert.match(artifact.styles[0].css, /\.wb-panel/, "stylesheet contents must arrive, not just its name");

const applied = new Map();
const notices = [];
const indexed = [
  { object_id: "n1", kind: "heading", value: "Plan", level: 1, checked: null, line: 0 },
  { object_id: "n1", kind: "tag", value: "praca", level: null, checked: null, line: 1 },
  { object_id: "n2", kind: "task", value: "Zrobić", level: null, checked: true, line: 0 },
];

const host = new ExtensionHost(
  {
    objects: { get: async () => null, create: async () => ({}), update: async () => ({}), move: async () => ({}), trash: async () => null, query: async () => [] },
    index: {
      query: async () => indexed,
      forObject: async (id) => indexed.filter((entry) => entry.object_id === id),
    },
    relations: { list: async () => [], create: async () => ({}), delete: async () => true },
    types: { list: async () => [], upsert: async () => ({}) },
    dataSources: { list: async () => [], upsert: async () => ({}), delete: async () => true },
  },
  {
    notice: (pluginId, message) => { notices.push({ pluginId, message }); return { dispose() {} }; },
    modal: () => ({ dispose() {} }),
    menu: () => ({ dispose() {} }),
    suggest: async () => null,
  },
);

const manager = new LocalPluginManager(host, {
  apply: (pluginId, styles) => applied.set(pluginId, styles),
  remove: (pluginId) => applied.delete(pluginId),
});
await manager.install(artifact);

// Styles reach the sink on install.
assert.equal(applied.get("example.workbench")?.length, 1, "install must hand the stylesheet to Core");

const snapshot = host.getSnapshot("example.workbench")[0];
assert.deepEqual(
  Object.keys(snapshot.slots).sort(),
  [...UI_SLOTS].sort(),
  "Workbench must register every slot Core renders — that is the point of it",
);
assert.deepEqual(snapshot.commands.map((c) => c.id).sort(), ["menu", "modal", "outline", "report"]);
// The editor contract: one renderer, keyed by language.
assert.deepEqual(snapshot.codeBlocks.map((entry) => entry.id), ["workbench"]);
assert.equal(snapshot.settings.length, 1);
assert.equal(snapshot.settings[0].schema.sections[0].fields.length, 6, "one field per settings kind");

// The report command reads the content index through the permission-scoped API.
const report = await snapshot.commands.find((c) => c.id === "report").execute();
assert.equal(report.total, 3);
assert.equal(report.byKind.heading, 1);
assert.equal(report.byKind.task, 1);
assert.equal(report.done, 1);
assert.deepEqual(report.topTags, [["praca", 1]]);
assert.equal(notices.at(-1).pluginId, "example.workbench");

// A plugin without data.read must not reach the index at all.
const unprivileged = new ExtensionHost();
let denied = null;
let deniedDocument = null;
let deniedEditor = null;
await unprivileged.enable({
  manifest: { id: "example.nodata", name: "No data", version: "1.0.0", apiVersion: "0.1", permissions: [] },
  async onload(context) {
    try { await context.data.index.query(); } catch (error) { denied = error; }
    try { await context.data.document.get("anything"); } catch (error) { deniedDocument = error; }
    // The editor surface is gated too: a renderer runs inside the note the
    // user is reading, so it must cost a declared permission like any other.
    try { context.editor.registerCodeBlockRenderer("x", () => {}); } catch (error) { deniedEditor = error; }
  },
});
assert.match(String(denied), /lacks permission data\.read/);
assert.match(String(deniedDocument), /lacks permission data\.read/);
assert.match(String(deniedEditor), /editor\.extension/);

// Disabling takes the stylesheet down with it.
await manager.disable("example.workbench");
assert.equal(applied.has("example.workbench"), false, "a disabled theme must stop restyling the app");

console.log("Workbench example checks passed: styles, all 7 slots, content index and permission scoping.");
