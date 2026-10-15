import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ExtensionHost } from "../src/core/extensions/host.ts";
import { loadPluginPackage } from "../src/core/extensions/package.ts";
import { workModelsPlugin, WORK_MODEL_DEFINITIONS, migrateBugToIssue } from "../plugins/builtin/work-models.ts";
import { propertiesPlugin } from "../plugins/builtin/properties.ts";

function scenario() {
  const types = new Map([
    ["task", { name: "task", schema: JSON.stringify({ fields: { custom: { type: "text" } } }), icon: "legacy", color: "legacy" }],
  ]);
  const records = [];
  const data = {
    objects: { get: async () => null, create: async (input) => { const object = { id: `object-${records.length + 1}`, ...input, props: input.props ?? "{}", created_at: 1, updated_at: 1, archived_at: null, trashed_at: null }; records.push(object); return object; }, update: async () => null, trash: async () => null, query: async () => [] },
    relations: { list: async () => [], create: async () => ({ from_id: "a", to_id: "b", kind: "related" }), delete: async () => true },
    types: {
      list: async () => [...types.values()],
      upsert: async (name, schema, icon = null, color = null) => {
        const value = { name, schema, icon, color };
        types.set(name, value);
        return value;
      },
    },
    dataSources: { list: async () => [], upsert: async () => ({ id: "source-1", name: "source", definition: "{}", created_at: 1, updated_at: 1 }), delete: async () => true },
  };
  return { data, types, records };
}

function assertInstalled(state, result) {
  assert.equal(result.pluginId, "notible.work-models");
  assert.equal(result.modelCount, WORK_MODEL_DEFINITIONS.length);
  assert.deepEqual(result.modelIds, WORK_MODEL_DEFINITIONS.map((model) => model.name));
  assert.equal(state.types.size, WORK_MODEL_DEFINITIONS.length);
  assert.match(state.types.get("task").schema, /custom/);
  for (const model of WORK_MODEL_DEFINITIONS) {
    const installed = state.types.get(model.name);
    assert.ok(installed, `missing model: ${model.name}`);
    const schema = JSON.parse(installed.schema);
    for (const field of Object.keys(model.fields)) assert.ok(schema.fields[field], `${model.name} missing field ${field}`);
  }
}

const state = scenario();
const host = new ExtensionHost(state.data);
await host.enable(propertiesPlugin);
await host.enable(workModelsPlugin);
const snapshot = host.getSnapshot("notible.work-models");
assert.equal(snapshot.length, 1);
assert.equal(snapshot[0].commands.length, 4);
assert.equal(snapshot[0].views.length, 1);
assert.equal(snapshot[0].settings.length, 1);
assert.deepEqual(workModelsPlugin.manifest.permissions, ["data.read", "data.write", "relations.write", "workspace.ui"]);
const command = snapshot[0].commands[0];
assertInstalled(state, await command.execute());
const createProject = snapshot[0].commands.find((candidate) => candidate.id === "create-project");
assert.ok(createProject);
const project = await createProject.execute("Launch project");
assert.equal(project.type, "project");
assert.equal(project.title, "Launch project");
assert.equal(state.records.length, 1);
// create-project forwards a _modules list into the new project's props.
const withModules = await createProject.execute({ title: "Scoped", modules: ["notible.views:tasks", "notible.planning:finance"] });
assert.equal(withModules.type, "project");
assert.deepEqual(JSON.parse(withModules.props)._modules, ["notible.views:tasks", "notible.planning:finance"]);
// omitting modules leaves no _modules key.
const noModules = await createProject.execute({ title: "Plain" });
assert.equal(JSON.parse(noModules.props)._modules, undefined);
const firstSchemas = new Map([...state.types].map(([name, value]) => [name, value.schema]));
assertInstalled(state, await command.execute());
for (const [name, schema] of firstSchemas) assert.equal(state.types.get(name).schema, schema, `reapply drifted ${name}`);
await host.disable("notible.work-models");
assert.equal(host.getSnapshot("notible.work-models").length, 0, "a disabled plugin leaves the snapshot entirely");

const packaged = await loadPluginPackage({
  readText: async (path) => readFileSync(new URL(`../plugins/builtin/notible.work-models/${path}`, import.meta.url), "utf8"),
}, true, "builtin");
assert.equal(packaged.plugin.manifest.id, "notible.work-models");
const packageState = scenario();
const packageHost = new ExtensionHost(packageState.data);
await packageHost.enable(packaged.plugin);
assertInstalled(packageState, await packageHost.getSnapshot("notible.work-models")[0].commands[0].execute());
await packageHost.disable("notible.work-models");

// --- C2: migrateBugToIssue round-trip + idempotency -----------------------
function bugScenario() {
  const objects = new Map([
    ["bug-1", { id: "bug-1", type: "bug", title: "Crash on save", props: "{}", updated_at: 1 }],
    ["folder-1", { id: "folder-1", type: "folder", title: "Dev", props: JSON.stringify({ _views: [{ id: "v1", name: "Bugs", layout: "table", typeFilter: "bug" }] }), updated_at: 1 }],
    ["note-1", { id: "note-1", type: "note", title: "unrelated", props: "{}", updated_at: 1 }],
  ]);
  return {
    objects: {
      query: async ({ type } = {}) => [...objects.values()].filter((o) => (type ? o.type === type : true)),
      setType: async (id, newType, expected) => {
        const o = objects.get(id);
        if (expected !== undefined && o.updated_at !== expected) throw new Error("conflict");
        const next = { ...o, type: newType, updated_at: o.updated_at + 1 };
        objects.set(id, next);
        return next;
      },
      update: async (id, patch, expected) => {
        const o = objects.get(id);
        if (expected !== undefined && o.updated_at !== expected) throw new Error("conflict");
        const next = { ...o, ...patch, updated_at: o.updated_at + 1 };
        objects.set(id, next);
        return next;
      },
    },
    _objects: objects,
  };
}

const bugCtx = bugScenario();
const first = await migrateBugToIssue({ data: bugCtx });
assert.equal(first.retyped, 1, "one bug retyped");
assert.equal(first.viewsRewritten, 1, "one stale view rewritten");
assert.equal(bugCtx._objects.get("bug-1").type, "issue", "bug object is now an issue");
assert.match(bugCtx._objects.get("folder-1").props, /"typeFilter":"issue"/, "view filter rewritten to issue");
const second = await migrateBugToIssue({ data: bugCtx });
assert.deepEqual(second, { retyped: 0, viewsRewritten: 0 }, "second run is a no-op");

console.log("Work Models plugin checks passed: manifest, registrations, six-model DataApi install, idempotent reapply, bug->issue migration and packaged entrypoint.");
