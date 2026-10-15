/**
 * Plugin API 1.12 — domain types + prose profile wiring, against the real
 * ExtensionHost / host.ts.
 *
 * The Rust `validate_type_namespace` (behaviour flags in a type's schema JSON
 * may only name a type prefixed with the calling plugin's id) is NOT exercised
 * here — it has its own `cargo test` (`behaviour_schema_requires_namespace_prefix`).
 */
import assert from "node:assert/strict";
import { ExtensionHost } from "../src/core/extensions/host.ts";

const disposableShape = (value, message) => {
  assert.equal(typeof value?.dispose, "function", message);
};

// A complete-enough DataApi mock. core-data-api.ts (the real implementation,
// including the listForObjects grouping) cannot be imported under node — it
// pulls "@tauri-apps/api/core" — so the grouping contract is mirrored here.
const upsertCalls = [];
const listForObjectsCalls = [];
const injectedDataApi = {
  objects: {
    get: async () => null,
    create: async (input) => input,
    update: async (id) => id,
    move: async () => null,
    trash: async () => null,
    query: async () => [],
  },
  relations: {
    list: async () => [],
    listForObjects: async (ids) => {
      listForObjectsCalls.push(ids);
      // Mirror core-data-api.ts: seed every requested id, then bucket a flat
      // relation list onto both endpoints.
      const flat = [
        { from_id: "a", to_id: "b", kind: "references" },
        { from_id: "c", to_id: "a", kind: "blocks" },
      ];
      const out = {};
      for (const id of ids) out[id] = [];
      for (const r of flat) {
        if (out[r.from_id]) out[r.from_id].push(r);
        if (r.to_id !== r.from_id && out[r.to_id]) out[r.to_id].push(r);
      }
      return out;
    },
    create: async (fromId, toId, kind) => ({ from_id: fromId, to_id: toId, kind }),
    delete: async () => true,
  },
  types: {
    list: async () => [],
    upsert: async (...args) => {
      upsertCalls.push(args);
      return { name: args[0], schema: args[1] ?? "{}", icon: null, color: null };
    },
  },
  dataSources: {
    list: async () => [],
    upsert: async (name, definition, id) => ({ id: id ?? "source-1", name, definition, created_at: 1, updated_at: 1 }),
    delete: async () => true,
  },
};

const host = new ExtensionHost(injectedDataApi);

// --- 1. editor.extension plugin can registerProseProfile -> Disposable ------
let editorCtx;
await host.enable({
  manifest: { id: "p.id", name: "Prose Plugin", version: "1.0.0", apiVersion: "1.12", permissions: ["editor.extension"] },
  onload(ctx) { editorCtx = ctx; },
});
const disposable = editorCtx.editor.registerProseProfile({ types: ["p.id.scene"] }, { dashList: false });
disposableShape(disposable, "registerProseProfile must return a Disposable");

// --- 2. a second call from the SAME plugin for the same match throws --------
assert.throws(
  () => editorCtx.editor.registerProseProfile({ types: ["p.id.scene"] }, { dashList: true }),
  /Duplicate registration/,
  "a repeat registration for the same type set must hit register()'s dup guard",
);

// --- 3. propEquals.key not prefixed with the calling plugin id throws -------
assert.throws(
  () => editorCtx.editor.registerProseProfile({ propEquals: { key: "notmine.x", value: "1" } }, { dashList: false }),
  /prefixed/,
  "a propEquals.key outside the plugin's namespace must be rejected",
);

// --- 4. a built-in type name is always refused -----------------------------
assert.throws(
  () => editorCtx.editor.registerProseProfile({ types: ["note"] }, { dashList: false }),
  /built-in type/,
  "BUILTIN_TYPE_NAMES must be refused",
);

// --- 5. getSnapshot surfaces the profile with a populated pluginName -------
const snap = host.getSnapshot("p.id")[0];
assert.equal(snap.proseProfiles.length, 1, "the one successful profile must be in the snapshot");
const entry = snap.proseProfiles[0];
assert.equal(entry.pluginId, "p.id");
assert.equal(entry.pluginName, "Prose Plugin", "pluginName must be resolved from the manifest, not the id");
assert.deepEqual(entry.match, { types: ["p.id.scene"] });
assert.deepEqual(entry.profile, { dashList: false });

// --- 6. a plugin WITHOUT editor.extension cannot registerProseProfile -----
let noPermCtx;
await host.enable({
  manifest: { id: "p.noperm", name: "No Perm", version: "1.0.0", apiVersion: "1.12", permissions: [] },
  onload(ctx) { noPermCtx = ctx; },
});
assert.throws(
  () => noPermCtx.editor.registerProseProfile({ types: ["p.noperm.x"] }, { dashList: false }),
  /editor\.extension/,
  "register()'s kind-gate must require editor.extension",
);

// --- 7. scopedDataApi.types.upsert injects the caller's manifest.id (5th) --
let dataCtx;
await host.enable({
  manifest: { id: "p.data", name: "Data Plugin", version: "1.0.0", apiVersion: "1.12", permissions: ["data.write", "data.read"] },
  onload(ctx) { dataCtx = ctx; },
});
upsertCalls.length = 0;
await dataCtx.data.types.upsert("p.data.book", JSON.stringify({ fields: {}, behaviour: { container: true } }), "icon", "color", "spoofed.id");
assert.equal(upsertCalls.length, 1, "the mock upsert must have been called once");
assert.equal(upsertCalls[0][4], "p.data", "the scoped wrapper must OVERRIDE the 5th arg with the calling plugin's id, not accept the spoofed value");

// --- 8. relations.listForObjects groups by id; data.read is required ------
listForObjectsCalls.length = 0;
const grouped = await dataCtx.data.relations.listForObjects(["a", "b", "c"]);
assert.deepEqual(listForObjectsCalls[0], ["a", "b", "c"], "ids pass through unchanged");
for (const id of ["a", "b", "c"]) {
  assert.ok(id in grouped, `every requested id must be a key (missing ${id})`);
}
assert.equal(grouped.a.length, 2, "id 'a' is on both a->b and c->a");
assert.equal(grouped.b.length, 1);

let readlessCtx;
await host.enable({
  manifest: { id: "p.readless", name: "Readless", version: "1.0.0", apiVersion: "1.12", permissions: [] },
  onload(ctx) { readlessCtx = ctx; },
});
await assert.rejects(
  () => readlessCtx.data.relations.listForObjects(["a"]),
  /lacks permission data\.read/,
  "listForObjects must be guarded by data.read",
);

console.log("Plugin domain-types + prose-profile checks passed.");
