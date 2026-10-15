import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ExtensionHost } from "../src/core/extensions/host.ts";
import { loadPluginPackage } from "../src/core/extensions/package.ts";
import { createPlanningItem, installPlanning, planningPlugin, PLANNING_TYPE_DEFINITIONS } from "../plugins/builtin/planning.ts";
import { propertiesPlugin } from "../plugins/builtin/properties.ts";

function scenario() {
  const objects = new Map();
  const types = new Map();
  let nextId = 1;
  const data = {
    objects: {
      get: async (id) => objects.get(id) ?? null,
      create: async (input) => {
        const object = { id: `planning-${nextId++}`, type: input.type, title: input.title, content: input.content ?? "{}", props: input.props ?? "{}", parentId: input.parentId, created_at: nextId, updated_at: nextId, archived_at: null, trashed_at: null };
        objects.set(object.id, object);
        return object;
      },
      update: async (id, patch) => { const current = objects.get(id); const object = { ...current, ...patch, updated_at: current.updated_at + 1 }; objects.set(id, object); return object; },
      move: async (id, parentId) => { const current = objects.get(id); const object = { ...current, parentId, updated_at: current.updated_at + 1 }; objects.set(id, object); return object; },
      trash: async () => null,
      query: async (query = {}) => [...objects.values()].filter((object) => (!query.type || object.type === query.type) && (!query.parentId || object.parentId === query.parentId)).slice(0, query.limit ?? 5000),
    },
    relations: { list: async () => [], create: async () => ({ from_id: "a", to_id: "b", kind: "related" }), delete: async () => true },
    types: {
      list: async () => [...types.values()],
      upsert: async (name, schema, icon = null, color = null) => { const value = { name, schema, icon, color }; types.set(name, value); return value; },
    },
    dataSources: { list: async () => [], upsert: async (name, definition, id) => ({ id: id ?? "source-1", name, definition, created_at: 1, updated_at: 1 }), delete: async () => true },
  };
  return { data, objects, types };
}

const state = scenario();
const host = new ExtensionHost(state.data);
await host.enable(propertiesPlugin);
await host.enable(planningPlugin);
const snapshot = host.getSnapshot("notible.planning")[0];
assert.equal(typeof snapshot.views[0].render?.loader, "function");
// Planning has no Settings panel: it is configured on the project (its object
// tabs), not in a global settings section.
assert.equal(snapshot.settings.length, 0);
assert.ok(snapshot.objectTabs.length > 0);
// Container-modules inventory: planning tabs are project-scoped work surfaces.
// Timeline / Planning are project-only; Calendar also runs on a space. Finance is its own plugin's tab since 0.93.3 (D8).
assert.deepEqual(snapshot.objectTabs.map((tab) => tab.id).sort(), ["calendar", "milestones", "timeline"]);
for (const tab of snapshot.objectTabs) {
  assert.ok(tab.objectTypes.includes("project"), `planning tab "${tab.id}" must be offered on project`);
  const expected = tab.id === "calendar" ? ["project", "space"] : ["project"];
  assert.deepEqual([...tab.objectTypes].sort(), expected, `planning tab "${tab.id}" objectTypes`);
  assert.equal(typeof tab.description, "string", `planning tab "${tab.id}" must have a description`);
}

const firstInstall = await installPlanning(contextFor(planningPlugin, state.data));
assert.deepEqual(firstInstall.types, PLANNING_TYPE_DEFINITIONS.map((definition) => definition.name));
assert.equal(state.types.size, 3);

const customSchema = JSON.parse(state.types.get("cycle").schema);
customSchema.fields.customField = { type: "text" };
await state.data.types.upsert("cycle", JSON.stringify(customSchema), "custom", "#123456");
await installPlanning(contextFor(planningPlugin, state.data));
const preserved = JSON.parse(state.types.get("cycle").schema);
assert.deepEqual(preserved.fields.customField, { type: "text" });
assert.equal(state.types.get("cycle").icon, "custom");

for (const type of ["milestone", "cycle", "release"]) {
  const result = await createPlanningItem(contextFor(planningPlugin, state.data), { type, title: `${type} test`, props: { status: "planned" } });
  assert.equal(result.object.type, type);
}
for (const type of ["milestone", "cycle", "release"]) assert.equal((await state.data.objects.query({ type })).length, 1);
await host.disable("notible.planning");
assert.equal(host.getSnapshot("notible.planning").length, 0, "a disabled plugin leaves the snapshot entirely");

const ui = readFileSync(new URL("../plugins/builtin/planning-ui.tsx", import.meta.url), "utf8");
assert.ok(ui.includes("context.data.objects.query"));
assert.ok(ui.includes("context.data.objects.create") || ui.includes("createPlanningItem"));

// Gantt parity (2026-09-03): a bar can be moved AND resized from either edge.
const dashboard = readFileSync(new URL("../plugins/builtin/project-dashboard-ui.tsx", import.meta.url), "utf8");
for (const marker of ["pd-gantt-resize-start", "pd-gantt-resize-end", 'beginBarEdit(event, item, range, "start")', 'beginBarEdit(event, item, range, "end")']) {
  assert.ok(dashboard.includes(marker), `project-dashboard-ui Gantt must support edge-resize: missing ${marker}`);
}

// Finance parity (2026-09-03): rich summary, budget panel, weekly schedule,
// CSV/XLSX. XLSX export via the API 1.16 binary surface.
for (const marker of ["budgetAlertThreshold", "_resourceSchedule", "Export XLSX", "context.ui.exportBinary", "xlsxBytes", "financeCsv"]) {
  assert.ok(dashboard.includes(marker), `project-dashboard-ui Finance tab must include ${marker}`);
}
const financeSource = readFileSync(new URL("../plugins/builtin/finance.ts", import.meta.url), "utf8");
assert.ok(financeSource.includes("export function computeFinanceSummary"), "finance.ts must export computeFinanceSummary");
assert.ok(financeSource.includes("export function xlsxBytes"), "finance.ts must export the XLSX writer");
// `src/core/ui` is the sanctioned shared-control layer (API 1.11 UI
// baseline: <Select>/<Combobox>/<DatePicker>). Any OTHER `src/core/` reach
// into Core internals is still forbidden.
assert.ok(!ui.replaceAll("src/core/ui/", "").includes("src/core/"));
assert.ok(!ui.includes("src-tauri"));
assert.ok(!ui.includes("sqlite"));

const packageState = scenario();
const packaged = await loadPluginPackage({ readText: async (path) => readFileSync(new URL(`../plugins/builtin/notible.planning/${path}`, import.meta.url), "utf8") }, true, "builtin");
const packageHost = new ExtensionHost(packageState.data);
await packageHost.enable(packaged.plugin);
assert.equal((await packageHost.getSnapshot("notible.planning")[0].commands[0].execute()).typeCount, 3);
await packageHost.disable("notible.planning");

function contextFor(plugin, data) {
  return { manifest: plugin.manifest, permissions: { has: () => true, require: () => {} }, commands: { register: () => ({ dispose() {} }) }, views: { register: () => ({ dispose() {} }) }, settings: { register: () => ({ dispose() {} }) }, ui: { registerSlot: () => ({ dispose() {} }) }, events: { on: () => ({ dispose() {} }), emit: () => {} }, storage: { get: () => null, set: () => {}, delete: () => {}, keys: () => [] }, data };
}

console.log("Planning plugin checks passed: models, idempotent schema merge, CRUD surface, UI boundary and package entrypoint.");
