// Standalone package form of the Typewriter builtin (mirrors planning/index.js).
// The product-bundle form with the real React surfaces is plugins/builtin/typewriter.ts.
const NS = "notible.typewriter.";

const types = [
  { name: `${NS}manuscript`, icon: "book-text", color: "#7c4a3f",
    fields: { logline: { type: "text" }, wordTarget: { type: "number" }, deadline: { type: "date" }, font: { type: "select", options: ["serif", "sans", "mono"] } },
    behaviour: { container: true } },
  { name: `${NS}part`, icon: "book-copy", color: "#8a6d3b", fields: { synopsis: { type: "text" } }, behaviour: { container: true } },
  { name: `${NS}chapter`, icon: "book-marked", color: "#5c6f8a", fields: { synopsis: { type: "text" } }, behaviour: { container: true } },
  { name: `${NS}scene`, icon: "pen-line", color: "#7c4a3f",
    fields: { synopsis: { type: "text" }, status: { type: "select", options: ["idea", "draft", "revised", "final"] }, order: { type: "number" }, wordTarget: { type: "number" }, font: { type: "select", options: ["serif", "sans", "mono"] } } },
  { name: `${NS}character`, icon: "user", color: "#4a6fa5",
    fields: { fullName: { type: "text" }, aliases: { type: "text" }, oneLine: { type: "text" }, colour: { type: "select", options: ["red", "green", "blue", "violet", "amber"] }, related: { type: "text" } },
    behaviour: { treeHidden: true } },
  { name: `${NS}location`, icon: "map-pin", color: "#3d9970", fields: { oneLine: { type: "text" } }, behaviour: { treeHidden: true } },
  { name: `${NS}plotline`, icon: "spline", color: "#7b6d8d",
    fields: { kind: { type: "select", options: ["main", "subplot", "arc"] } }, behaviour: { treeHidden: true } },
  { name: `${NS}beat`, icon: "git-branch", color: "#6d7f8d",
    fields: { note: { type: "text" } }, behaviour: { treeHidden: true } },
  { name: `${NS}memo`, icon: "sticky-note", color: "#8d7b4a", fields: { oneLine: { type: "text" } }, behaviour: { treeHidden: true } },
];

async function install(context) {
  const existing = await context.data.types.list();
  for (const type of types) {
    const current = existing.find((candidate) => candidate.name === type.name);
    let schema = {};
    try { schema = current ? JSON.parse(current.schema) : {}; } catch { schema = {}; }
    const next = { ...schema, fields: { ...(schema.fields ?? {}), ...type.fields } };
    if (type.behaviour) next.behaviour = type.behaviour;
    await context.data.types.upsert(type.name, JSON.stringify(next), type.icon, type.color);
  }
  return { pluginId: context.manifest.id, typeCount: types.length, types: types.map((type) => type.name) };
}

export default {
  manifest: { id: "notible.typewriter", name: "Typewriter", version: "0.1.0", apiVersion: "0.1", permissions: ["data.read", "data.write", "relations.write", "workspace.ui", "editor.extension"], sync: "data" },
  onload(context) {
    context.commands.register({ id: "status", name: "Set up Typewriter", execute: () => install(context) });
    context.editor?.registerProseProfile?.(
      { types: [`${NS}part`, `${NS}chapter`, `${NS}scene`] },
      { dashList: false, focusMode: true, fontProp: "font", fontMap: { serif: "var(--notible-font-serif)", sans: "var(--notible-font-sans)", mono: "var(--notible-font-mono)" } },
    );
    context.views.register({ id: "surface", title: "Typewriter", render: { kind: "builtin-surface", capability: "typewriter" } });
    context.settings.register({ id: "settings", title: "Typewriter settings", render: { kind: "builtin-settings", capability: "typewriter" } });
    context.ui.registerSlot("workspace.sidebar", { id: "sidebar-entry", render: { kind: "builtin-sidebar-entry", capability: "typewriter" } });
  },
};
