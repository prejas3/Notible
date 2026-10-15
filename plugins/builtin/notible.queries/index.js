// Package form of the builtin, so it can be loaded through the same
// third-party path every other plugin uses. The product build runs the
// TypeScript in ../queries.plugin.ts; this mirror exists to prove the plugin
// is loadable as a plain package with nothing privileged in it.
export default {
  manifest: {
    id: "notible.queries",
    name: "Embedded queries",
    version: "0.1.0",
    apiVersion: "1.3",
    permissions: ["workspace.ui", "data.read", "editor.extension"],
  },
  onload(context) {
    context.commands.register({
      id: "status",
      name: "Inspect query block",
      execute: (input) => ({ source: String(input?.source ?? ""), ready: true }),
    });
    context.views.register({
      id: "surface",
      title: "Embedded queries",
      render: { kind: "builtin-surface", capability: "queries" },
    });
    context.settings.register({
      id: "settings",
      title: "Embedded queries settings",
      render: { kind: "builtin-settings", capability: "queries" },
    });
    context.editor.registerCodeBlockRenderer("notible", ({ container }) => {
      container.textContent = "Embedded query";
      return { dispose: () => container.replaceChildren() };
    });
    context.ui.registerSlot("workspace.sidebar", {
      id: "sidebar-entry",
      render: { kind: "builtin-sidebar-entry", capability: "queries" },
    });
  },
};
