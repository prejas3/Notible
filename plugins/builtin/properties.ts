import { createBuiltinSurface } from "./scaffold.ts";

/**
 * Foundational plugin: the real Properties editor (status/priority/assignee/
 * dates/etc, driven by a record's actual type schema) shown next to a note
 * when it has one. Domain plugins that create typed records (work-models,
 * finance, planning, ...) declare a dependency on this instead of each
 * rolling their own ad hoc property form — see plugins/builtin/work-models.ts
 * etc. for the `dependencies: { "notible.properties": "0.1.0" }` entries.
 */
export const propertiesPlugin = createBuiltinSurface({
  manifest: {
    id: "notible.properties",
    name: "Properties",
    version: "0.1.0",
    apiVersion: "0.1",
    entry: "index.ts",
    description: "A right-side properties editor for any typed record — status, priority, assignee, dates and every other schema field.",
    permissions: ["data.read", "data.write", "workspace.ui"],
  },
  capability: "properties",
  commandName: "Show properties status",
  viewTitle: "Properties",
  settingsTitle: "Properties settings",
  viewRender: (context) => ({ kind: "react-loader", loader: () => import("./properties-ui"), context }),
  settingsRender: (context) => ({ kind: "react-loader", loader: () => import("./properties-ui"), context }),
  extraViews: [
    { id: "panel", title: "Properties panel", render: (context) => ({ kind: "react-loader", loader: () => import("./properties-ui"), context }) },
  ],
});
