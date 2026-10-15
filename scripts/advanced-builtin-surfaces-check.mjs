import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ExtensionHost } from "../src/core/extensions/host.ts";
import { loadPluginPackage } from "../src/core/extensions/package.ts";
import { whiteboardPlugin, ensureContainerBoard } from "../plugins/builtin/whiteboard.ts";
import { calendarPlugin } from "../plugins/builtin/calendar.ts";
import { aiPlugin } from "../plugins/builtin/ai.ts";
import { editorExtensionsPlugin } from "../plugins/builtin/editor-extensions.ts";
import { importExportPlugin } from "../plugins/builtin/import-export.ts";
import { themesPlugin } from "../plugins/builtin/themes.ts";

function scenario() {
  const objects = new Map(); let nextId = 1;
  const data = {
    objects: {
      get: async (id) => objects.get(id) ?? null,
      create: async (input) => { const object = { id: `object-${nextId++}`, type: input.type, title: input.title, content: input.content ?? "{}", props: input.props ?? "{}", created_at: 1, updated_at: 1, archived_at: null, trashed_at: null }; objects.set(object.id, object); return object; },
      update: async (id, patch) => { const current = objects.get(id); const object = { ...current, ...patch, updated_at: current.updated_at + 1 }; objects.set(id, object); return object; },
      trash: async () => null,
      query: async (query = {}) => [...objects.values()].filter((object) => !query.type || object.type === query.type).slice(0, query.limit ?? 5000),
    },
    relations: { list: async () => [], create: async () => ({ from_id: "a", to_id: "b", kind: "related" }), delete: async () => true },
    types: { list: async () => [], upsert: async (name, schema, icon = null, color = null) => ({ name, schema, icon, color }) },
    dataSources: { list: async () => [], upsert: async (name, definition, id) => ({ id: id ?? "source-1", name, definition, created_at: 1, updated_at: 1 }), delete: async () => true },
  };
  return { data, objects };
}

async function run(plugin) { const state = scenario(); const host = new ExtensionHost(state.data); await host.enable(plugin); return { state, host, command: host.getSnapshot(plugin.manifest.id)[0].commands[0] }; }

const whiteboard = await run(whiteboardPlugin);
const board = (await whiteboard.command.execute({ title: "Board" })).object;
assert.equal(JSON.parse(board.content).version, 1);
assert.equal((await whiteboard.command.execute({ objectId: board.id, document: { version: 1, nodes: [{ id: "n1" }], edges: [], viewport: { x: 1, y: 2, zoom: 1 } } })).object.id, board.id);
await whiteboard.host.disable(whiteboardPlugin.manifest.id);

// Container "Whiteboard" tab: ensureContainerBoard resolves a folder/project/
// space to ONE dedicated child board, created lazily, never duplicated.
{
  const rows = new Map(); let n = 1;
  const ctx = { data: { objects: {
    query: async ({ parentId, type }) => [...rows.values()].filter((r) => (!parentId || r.parentId === parentId) && (!type || r.type === type)),
    create: async (input) => { const r = { id: `b-${n++}`, ...input, updated_at: 1 }; rows.set(r.id, r); return r; },
  } } };
  const first = await ensureContainerBoard(ctx, "folder-1");
  assert.equal(rows.get(first).type, "whiteboard");
  assert.equal(rows.get(first).parentId, "folder-1");
  assert.equal(JSON.parse(rows.get(first).props)._containerBoard, true);
  assert.equal(await ensureContainerBoard(ctx, "folder-1"), first, "same container resolves to the same board");
  assert.notEqual(await ensureContainerBoard(ctx, "folder-2"), first, "a different container gets its own board");
  assert.equal([...rows.values()].filter((r) => r.parentId === "folder-1").length, 1, "no duplicate board");
}

const calendar = await run(calendarPlugin);
const project = await calendar.state.data.objects.create({ type: "project", title: "Project", props: "{}" });
assert.equal((await calendar.command.execute({ projectId: project.id, provider: "google", calendarId: "primary", calendarName: "Primary" })).config.connections.length, 1);
await calendar.host.disable(calendarPlugin.manifest.id);

const ai = await run(aiPlugin);
await ai.state.data.objects.create({ type: "task", title: "Urgent", props: JSON.stringify({ status: "open", priority: "urgent" }) });
await ai.state.data.objects.create({ type: "task", title: "Done", props: JSON.stringify({ status: "done", priority: "urgent" }) });
assert.equal((await ai.command.execute()).suggestions.length, 1);
await ai.host.disable(aiPlugin.manifest.id);

const editor = await run(editorExtensionsPlugin);
assert.deepEqual(await editor.command.execute({ language: "ts", source: "one\ntwo" }), { language: "plain", lines: 2, characters: 7 });
await editor.host.disable(editorExtensionsPlugin.manifest.id);

const transfer = await run(importExportPlugin);
await transfer.state.data.objects.create({ type: "note", title: "Export me", props: "{}" });
assert.equal((await transfer.command.execute()).count, 1);
assert.equal((await transfer.command.execute({ objects: [{ type: "note", title: "Imported", props: "{}" }] })).imported, 1);
await transfer.host.disable(importExportPlugin.manifest.id);

const themes = await run(themesPlugin);
assert.equal((await themes.command.execute({ themeId: null })).theme, null);
await themes.host.disable(themesPlugin.manifest.id);

for (const id of ["notible.whiteboard", "notible.calendar", "notible.ai", "notible.editor-extensions", "notible.import-export", "notible.themes"]) {
  const state = scenario(); const packaged = await loadPluginPackage({ readText: async (path) => readFileSync(new URL(`../plugins/builtin/${id}/${path}`, import.meta.url), "utf8") }, true, "builtin"); const host = new ExtensionHost(state.data); await host.enable(packaged.plugin); const command = host.getSnapshot(id)[0].commands[0];
  if (id === "notible.whiteboard") assert.equal((await command.execute()).object.type, "whiteboard");
  if (id === "notible.editor-extensions") assert.equal((await command.execute({ language: "python", source: "x" })).language, "python");
  if (id === "notible.themes") assert.equal((await command.execute({ themeId: null })).theme, null);
  if (id === "notible.import-export") assert.equal((await command.execute()).count, 0);
  await host.disable(id);
}

console.log("Whiteboard, Calendar, AI, Editor, Import/Export and Themes checks passed.");
