import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ExtensionHost } from "../src/core/extensions/host.ts";
import { BUILTIN_PLUGINS } from "../plugins/builtin/index.ts";

const domainIds = [
  "notible.work-models",
  "notible.views",
  "notible.finance",
  "notible.search",
  "notible.whiteboard",
  "notible.calendar",
  "notible.editor-extensions",
  "notible.import-export",
  "notible.themes",
];

const data = {
  objects: { get: async () => null, create: async (input) => ({ id: "object-1", ...input, content: input.content ?? "{}", props: input.props ?? "{}", created_at: 1, updated_at: 1, archived_at: null, trashed_at: null }), update: async () => null, move: async () => null, trash: async () => null, query: async () => [] },
  relations: { list: async () => [], create: async () => ({ from_id: "a", to_id: "b", kind: "related" }), delete: async () => true },
  types: { list: async () => [], upsert: async (name, schema, icon = null, color = null) => ({ name, schema, icon, color }) },
  dataSources: { list: async () => [], upsert: async (name, definition, id) => ({ id: id ?? "source-1", name, definition, created_at: 1, updated_at: 1 }), delete: async () => true },
};

for (const id of domainIds) {
  const plugin = BUILTIN_PLUGINS.find((candidate) => candidate.manifest.id === id);
  assert.ok(plugin, `Missing product plugin: ${id}`);
  const host = new ExtensionHost(data);
  for (const depId of Object.keys(plugin.manifest.dependencies ?? {})) {
    const dep = BUILTIN_PLUGINS.find((candidate) => candidate.manifest.id === depId);
    if (dep) await host.enable(dep);
  }
  await host.enable(plugin);
  const snapshot = host.getSnapshot(id)[0];
  assert.equal(typeof snapshot.views[0].render?.loader, "function", `${id} view must be lazy`);
  // A domain plugin whose configuration moved onto the object it configures
  // (0.55.0: calendar) has no settings panel left — the lazy surface it must
  // still expose is the view its tab mounts.
  // A declarative panel (`schema`, no `render`) has no code to lazy-load
  // (Hive #34, editor-extensions' Diagram appearance); a code panel still must be lazy.
  if (snapshot.settings.length > 0) {
    const settings = snapshot.settings[0];
    if (settings.schema && !settings.render) assert.ok(Array.isArray(settings.schema.sections), `${id} settings schema must have sections`);
    else assert.equal(typeof settings.render?.loader, "function", `${id} settings must be lazy`);
  }
  // notible.import-export is the exception named in builtin-plugin-isolation-check:
  // its feature became Core's in 0.55.0, so it has nothing left to configure.
  // Same rule as builtin-plugin-isolation-check: a code-block renderer has
  // nothing to configure, and import-export's feature became Core's in 0.55.0.
  else if (id !== "notible.import-export" && snapshot.codeBlocks.length === 0) assert.ok(snapshot.objectTabs.length > 0, `${id} has neither a settings panel nor an object tab`);
  await host.disable(id);
}

const ui = readFileSync(new URL("../plugins/builtin/domain-plugin-ui.tsx", import.meta.url), "utf8");
for (const id of domainIds.filter((candidate) => candidate !== "notible.views")) assert.ok(ui.includes(id), `Missing dedicated UI branch: ${id}`);
const viewsUi = readFileSync(new URL("../plugins/builtin/views-ui.tsx", import.meta.url), "utf8");
assert.ok(viewsUi.length > 200, "Views plugin surface must contain a real renderer");

// Whiteboard parity (2026-09-03): shape/section/image/table node kinds +
// Report / Create tasks / Export, matching the deleted legacy WhiteboardView.
const canvasUi = readFileSync(new URL("../plugins/builtin/canvas-ui.tsx", import.meta.url), "utf8");
for (const marker of ['kind: "shape"', 'kind: "section"', 'kind: "image"', 'kind: "table"', 'addShape', 'addSection', 'addImage', 'addTable', 'createTasksFromCards', 'exportBoardJson', 'boardReport', 'context.ui.exportFile']) {
  assert.ok(canvasUi.includes(marker), `canvas-ui.tsx (Whiteboard parity) is missing ${marker}`);
}
const whiteboardTypes = readFileSync(new URL("../plugins/builtin/whiteboard.ts", import.meta.url), "utf8");
assert.ok(whiteboardTypes.includes('"shape" | "section" | "image" | "table"'), "whiteboard.ts CanvasNode kind must include the new node kinds");
// `src/core/ui` is the sanctioned shared-control layer (API 1.11 UI
// baseline: <Select>/<Combobox>/<DatePicker>). Any OTHER `src/core/` reach
// into Core internals is still forbidden.
assert.ok(!ui.replaceAll("src/core/ui/", "").includes("src/core/"));
assert.ok(!ui.includes("src-tauri"));
assert.ok(!ui.toLocaleLowerCase().includes("sqlite"));
console.log("Domain plugin surface checks passed: Work Models, Views, Finance, Search, Whiteboard, Calendar, Editor, Import/Export and Themes have dedicated lazy UI branches.");
