import type { PluginContext, PluginType } from "../../packages/plugin-api/src/index.ts";
import { createBuiltinSurface } from "./scaffold.ts";

export interface PlanningTypeDefinition { name: string; icon: string; color: string; fields: Record<string, { type: string; options?: string[] }>; }

export const PLANNING_TYPE_DEFINITIONS: PlanningTypeDefinition[] = [
  { name: "milestone", icon: "🎯", color: "#8b5cf6", fields: { status: { type: "select", options: ["planned", "in-progress", "completed"] }, targetDate: { type: "date" }, owner: { type: "text" } } },
  { name: "cycle", icon: "🔄", color: "#0ea5e9", fields: { status: { type: "select", options: ["planned", "active", "completed"] }, startDate: { type: "date" }, targetDate: { type: "date" }, capacity: { type: "number" } } },
  { name: "release", icon: "🚀", color: "#10b981", fields: { status: { type: "select", options: ["planned", "ready", "released"] }, targetDate: { type: "date" }, version: { type: "text" } } },
];

function mergeSchema(existing: PluginType | undefined, incoming: PlanningTypeDefinition): string {
  let schema: { fields?: Record<string, unknown> } = {};
  try { schema = existing ? JSON.parse(existing.schema) as { fields?: Record<string, unknown> } : {}; } catch { schema = {}; }
  return JSON.stringify({ ...schema, fields: { ...(schema.fields ?? {}), ...incoming.fields } });
}

export async function installPlanning(context: PluginContext) {
  const existing = await context.data.types.list();
  for (const definition of PLANNING_TYPE_DEFINITIONS) {
    const current = existing.find((candidate) => candidate.name === definition.name);
    await context.data.types.upsert(definition.name, mergeSchema(current, definition), current?.icon ?? definition.icon, current?.color ?? definition.color);
  }
  return { pluginId: context.manifest.id, typeCount: PLANNING_TYPE_DEFINITIONS.length, types: PLANNING_TYPE_DEFINITIONS.map((definition) => definition.name) };
}

export async function createPlanningItem(context: PluginContext, input?: unknown) {
  const value = input && typeof input === "object" ? input as { type?: unknown; title?: unknown; props?: unknown; parentId?: unknown } : {};
  const type = PLANNING_TYPE_DEFINITIONS.some((definition) => definition.name === value.type) ? String(value.type) : "milestone";
  const title = typeof value.title === "string" && value.title.trim() ? value.title.trim() : "Planning item";
  const props = value.props && typeof value.props === "object" ? JSON.stringify(value.props) : "{}";
  const object = await context.data.objects.create({ type, title, props, parentId: typeof value.parentId === "string" ? value.parentId : undefined });
  return { pluginId: context.manifest.id, object };
}

export const planningPlugin = createBuiltinSurface({
  manifest: { id: "notible.planning", name: "Planning", version: "0.1.0", apiVersion: "0.1", entry: "index.ts", description: "A timeline, milestones and a calendar for projects.", permissions: ["data.read", "data.write", "relations.write", "workspace.ui"], sync: "data", dependencies: { "notible.properties": "0.1.0" } },
  capability: "planning",
  commandName: "Install planning models",
  viewTitle: "Planning",
  // No Settings panel: planning is configured on the project (the Planning /
  // Timeline / Calendar tabs below), so a separate settings section only
  // repeated the description. The four object tabs satisfy the surface check.
  onCommand: async (context, input) => input && typeof input === "object" && "title" in input ? createPlanningItem(context, input) : installPlanning(context),
  viewRender: (context) => ({ kind: "react-loader", loader: () => import("./planning-ui"), context }),
  extraViews: [
    { id: "project-dashboard", title: "Project dashboard", render: (context) => ({ kind: "react-loader", loader: () => import("./project-dashboard-ui"), context }) },
  ],
  // Four project work surfaces mounting one view with a different `tab` prop,
  // instead of the dashboard drawing its own second row of tabs under Core's.
  // One strip, one mechanism — the project screen had two levels of navigation
  // doing the same job.
  //
  // Timeline and Planning are `project`-only; Calendar is also
  // offered on a workspace (`space`). The dashboard queries children and works
  // on `containerId`, so a container with no dated records just shows the
  // "nothing yet" state.
  objectTabs: [
    { id: "timeline", label: "Timeline", description: "A Gantt timeline of dated tasks, milestones and cycles.", objectTypes: ["project"], order: 1, viewId: "project-dashboard", viewProps: { tab: "timeline" } },
    { id: "milestones", label: "Planning", description: "Milestones, cycles and releases for this project.", objectTypes: ["project"], order: 2, viewId: "project-dashboard", viewProps: { tab: "milestones" } },
    { id: "calendar", label: "Calendar", description: "A month calendar of dated records, with external calendar sync.", objectTypes: ["project", "space"], order: 3, viewId: "project-dashboard", viewProps: { tab: "calendar" } },
  ],
});
