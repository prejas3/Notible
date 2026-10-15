import assert from "node:assert/strict";
import { ExtensionHost } from "../src/core/extensions/host.ts";
import { BUILTIN_PLUGINS } from "../plugins/builtin/index.ts";

const objects = new Map(); const types = new Map(); const sources = new Map(); let nextId = 1;
const data = {
  objects: {
    get: async (id) => objects.get(id) ?? null,
    create: async (input) => { const object = { id: `object-${nextId++}`, type: input.type, title: input.title, content: input.content ?? "{}", props: input.props ?? "{}", created_at: 1, updated_at: 1, archived_at: null, trashed_at: null }; objects.set(object.id, object); return object; },
    update: async (id, patch) => { const current = objects.get(id); const object = { ...current, ...patch, updated_at: current.updated_at + 1 }; objects.set(id, object); return object; },
    trash: async () => null,
    query: async (query = {}) => [...objects.values()].filter((object) => !query.type || object.type === query.type).slice(0, query.limit ?? 5000),
  },
  relations: { list: async () => [], create: async () => ({ from_id: "a", to_id: "b", kind: "related" }), delete: async () => true },
  types: { list: async () => [...types.values()], upsert: async (name, schema, icon = null, color = null) => { const value = { name, schema, icon, color }; types.set(name, value); return value; } },
  dataSources: { list: async () => [...sources.values()], upsert: async (name, definition, id) => { const value = { id: id ?? `source-${sources.size + 1}`, name, definition, created_at: 1, updated_at: 1 }; sources.set(value.id, value); return value; }, delete: async (id) => sources.delete(id) },
};

const host = new ExtensionHost(data);
// Sequential, not Promise.all: some plugins now declare `dependencies`
// (e.g. work-models depends on notible.properties) which ExtensionHost
// enforces synchronously at the start of enable() — concurrent enabling
// would race a dependent's check against its dependency's still-pending
// onload(). Matrix's real batch-enable (matrix-controller.ts) is already
// sequential for the same reason; BUILTIN_PLUGINS is ordered dependencies-
// first to match.
const result = [];
for (const plugin of BUILTIN_PLUGINS) {
  await host.enable(plugin);
  result.push(plugin.manifest.id);
}
assert.equal(result.length, 14);
assert.equal(host.getSnapshot().length, 14);
const project = await data.objects.create({ type: "project", title: "Together", props: "{}" });
const container = await data.objects.create({ type: "folder", title: "Container", props: "{}" });
const inputs = {
  "notible.properties": undefined,
  "notible.work-models": undefined,
  "notible.views": { containerId: container.id },
  "notible.planning": undefined,
  "notible.automations": undefined,
  "notible.finance": undefined,
  "notible.calendar": { projectId: project.id, provider: "google", calendarId: "primary" },
  "notible.editor-extensions": { language: "typescript", source: "const x = 1;" },
  "notible.whiteboard": undefined,
  "notible.search": { query: "" },
  "notible.import-export": undefined,
  "notible.themes": { themeId: null },
};
for (const plugin of BUILTIN_PLUGINS) {
  const snapshot = host.getSnapshot(plugin.manifest.id)[0];
  const expectedCommands = plugin.manifest.id === "notible.work-models" ? 4 : plugin.manifest.id === "notible.whiteboard" || plugin.manifest.id === "notible.typewriter" ? 2 : 1;
  assert.equal(snapshot.commands.length, expectedCommands, `${plugin.manifest.id} command registration missing`);
  await snapshot.commands[0].execute(inputs[plugin.manifest.id]);
}
for (const plugin of [...BUILTIN_PLUGINS].reverse()) await host.disable(plugin.manifest.id);
assert.equal(host.getSnapshot().length, 0, "combined builtin disable must clean every registration");

console.log(`Builtin command together check passed: all ${BUILTIN_PLUGINS.length} plugins execute together and cleanly disable.`);
