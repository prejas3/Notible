/**
 * Exporting and importing one object with its children.
 *
 * This lives in Core, not in a plugin, for the same reason "Print / Save as
 * PDF" does (0.49.0): it needs files, and the plugin API has no file access —
 * `filesystem.read`/`filesystem.write` were removed at 1.0 precisely because
 * they were declared with no API behind them.
 */
import assert from "node:assert/strict";
import { collectObjectTree, exportObjectTreeJson, importObjectTreeJson } from "../src/core/app/coreTransfer.ts";

const objects = [
  { id: "p", title: "Projekt", type: "project", parent_id: null, props: "{}", content: "" },
  { id: "a", title: "A", type: "note", parent_id: "p", props: "{}", content: "" },
  { id: "b", title: "B", type: "note", parent_id: "a", props: "{}", content: "" },
  { id: "z", title: "Obcy", type: "note", parent_id: null, props: "{}", content: "" },
];

// Parents before children, and nothing from outside the subtree.
assert.deepEqual(collectObjectTree("p", objects).map((object) => object.id), ["p", "a", "b"]);
assert.deepEqual(collectObjectTree("missing", objects), []);

const json = exportObjectTreeJson("p", objects);
assert.equal(JSON.parse(json).format, "notible-core-export");
assert.equal(JSON.parse(json).objects.length, 3);

// Import rebuilds the tree under the chosen parent, re-pointing parent_id at
// the NEW ids — otherwise children would attach to the originals and the copy
// would silently graft itself onto the source.
const created = [];
const api = { create: async (input) => { const id = `new-${created.length}`; created.push({ ...input, id }); return { id }; } };
assert.equal(await importObjectTreeJson(json, "target", api), 3);
// `parentId`, not `parent_id`: the real objects.create takes camelCase, and a
// snake_case key would type-check against a loose object and then quietly
// create every imported record at the top level.
assert.equal(created[0].parentId, "target");
assert.equal(created[1].parentId, created[0].id);
assert.equal(created[2].parentId, created[1].id);
assert.ok(!("parent_id" in created[0]), "objects.create takes parentId, never parent_id");
assert.equal(created[0].title, "Projekt");

// A file exported by the old plugin must still import.
assert.equal(await importObjectTreeJson(JSON.stringify({ format: "notible-plugin-export", objects: [objects[1]] }), null, api), 1);

// Garbage must not reach the database, and must not crash the app.
await assert.rejects(() => importObjectTreeJson("{}", "target", api), /format/i);
await assert.rejects(() => importObjectTreeJson("not json", "target", api), /JSON|format/i);
await assert.rejects(() => importObjectTreeJson(JSON.stringify({ format: "notible-core-export" }), "target", api), /format|objects/i);

console.log("core-transfer-check: ok (tree order, re-parenting, legacy format, malformed input rejected)");
