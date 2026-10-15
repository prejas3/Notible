const models = [
  { name: "task", icon: "✅", color: "#3b82f6", fields: { status: { type: "select", options: ["triage", "backlog", "todo", "open", "assigned", "in-progress", "pending", "waiting", "blocked", "done", "closed"] }, priority: { type: "select", options: ["none", "low", "medium", "high", "urgent"] }, due: { type: "date" }, startDate: { type: "date" }, reportedDate: { type: "date" }, reminder: { type: "date" }, recurrence: { type: "select", options: ["none", "daily", "weekly", "monthly"] }, assignee: { type: "text" }, reporter: { type: "text" }, team: { type: "text" }, estimate: { type: "number" }, milestoneId: { type: "text" }, cycleId: { type: "text" }, releaseId: { type: "text" }, deps: { type: "deps" } } },
  { name: "issue", icon: "🐞", color: "#b85c5c", fields: { status: { type: "select", options: ["triage", "open", "assigned", "in-progress", "pending", "waiting", "blocked", "resolved", "closed"] }, priority: { type: "select", options: ["none", "low", "medium", "high", "urgent"] }, severity: { type: "select", options: ["minor", "moderate", "major", "critical"] }, due: { type: "date" }, reportedDate: { type: "date" }, reminder: { type: "date" }, recurrence: { type: "select", options: ["none", "daily", "weekly", "monthly"] }, assignee: { type: "text" }, reporter: { type: "text" }, team: { type: "text" }, estimate: { type: "number" }, milestoneId: { type: "text" }, cycleId: { type: "text" }, releaseId: { type: "text" }, deps: { type: "deps" } } },
  { name: "project", icon: "📁", color: "#f59e0b", fields: { status: { type: "select", options: ["planned", "active", "pending", "on-hold", "blocked", "completed", "cancelled", "closed"] }, priority: { type: "select", options: ["none", "low", "medium", "high", "urgent"] }, startDate: { type: "date" }, targetDate: { type: "date" }, owner: { type: "text" }, lead: { type: "text" }, team: { type: "text" } } },
  { name: "milestone", icon: "🎯", color: "#8b5cf6", fields: { status: { type: "select", options: ["planned", "in-progress", "completed"] }, targetDate: { type: "date" }, owner: { type: "text" } } },
  { name: "cycle", icon: "🔄", color: "#0ea5e9", fields: { status: { type: "select", options: ["planned", "active", "completed"] }, startDate: { type: "date" }, targetDate: { type: "date" }, capacity: { type: "number" } } },
  { name: "release", icon: "🚀", color: "#10b981", fields: { status: { type: "select", options: ["planned", "ready", "released"] }, targetDate: { type: "date" }, version: { type: "text" } } },
];
async function install(context) {
  const existing = await context.data.types.list();
  for (const model of models) {
    const current = existing.find((candidate) => candidate.name === model.name);
    let schema = {};
    try { schema = current ? JSON.parse(current.schema) : {}; } catch { schema = {}; }
    await context.data.types.upsert(model.name, JSON.stringify({ ...schema, fields: { ...(schema.fields ?? {}), ...model.fields } }), current?.icon ?? model.icon, current?.color ?? model.color);
  }
  return { pluginId: context.manifest.id, modelCount: models.length, modelIds: models.map((model) => model.name) };
}
export default {
  manifest: { id: "notible.work-models", name: "Tasks, Issues and Projects", version: "0.1.0", apiVersion: "0.1", permissions: ["data.read", "data.write", "relations.write", "workspace.ui"], sync: "data" },
  onload(context) {
    context.commands.register({ id: "status", name: "Install work models", execute: () => install(context) });
    context.views.register({ id: "surface", title: "Work models", render: { kind: "builtin-surface", capability: "work-models" } });
    context.settings.register({ id: "settings", title: "Work models settings", render: { kind: "builtin-settings", capability: "work-models", modelCount: models.length } });
    context.ui.registerSlot("workspace.sidebar", { id: "sidebar-entry", render: { kind: "builtin-sidebar-entry", capability: "work-models" } });
  },
};
