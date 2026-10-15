import type { PluginContext, PluginType } from "../../packages/plugin-api/src/index.ts";
import { createBuiltinSurface } from "./scaffold.ts";
import { NEW_PROJECT_PROPS } from "./task-statuses.ts";

export interface WorkModelDefinition {
  name: string;
  icon: string;
  color: string;
  fields: Record<string, { type: string; options?: string[] }>;
}

export const WORK_MODEL_DEFINITIONS: WorkModelDefinition[] = [
  { name: "task", icon: "✅", color: "#3b82f6", fields: {
    status: { type: "select", options: ["triage", "backlog", "todo", "open", "assigned", "in-progress", "pending", "waiting", "blocked", "done", "closed"] },
    priority: { type: "select", options: ["none", "low", "medium", "high", "urgent"] }, due: { type: "date" }, startDate: { type: "date" }, reportedDate: { type: "date" }, reminder: { type: "date" }, recurrence: { type: "select", options: ["none", "daily", "weekly", "monthly"] }, assignee: { type: "text" }, reporter: { type: "text" }, team: { type: "text" }, estimate: { type: "number" }, milestoneId: { type: "text" }, cycleId: { type: "text" }, releaseId: { type: "text" }, deps: { type: "deps" },
  } },
  { name: "issue", icon: "🐞", color: "#b85c5c", fields: {
    status: { type: "select", options: ["triage", "open", "assigned", "in-progress", "pending", "waiting", "blocked", "resolved", "closed"] }, priority: { type: "select", options: ["none", "low", "medium", "high", "urgent"] }, severity: { type: "select", options: ["minor", "moderate", "major", "critical"] }, due: { type: "date" }, reportedDate: { type: "date" }, reminder: { type: "date" }, recurrence: { type: "select", options: ["none", "daily", "weekly", "monthly"] }, assignee: { type: "text" }, reporter: { type: "text" }, team: { type: "text" }, estimate: { type: "number" }, milestoneId: { type: "text" }, cycleId: { type: "text" }, releaseId: { type: "text" }, deps: { type: "deps" },
  } },
  { name: "project", icon: "📁", color: "#f59e0b", fields: {
    status: { type: "select", options: ["planned", "active", "pending", "on-hold", "blocked", "completed", "cancelled", "closed"] }, priority: { type: "select", options: ["none", "low", "medium", "high", "urgent"] }, startDate: { type: "date" }, targetDate: { type: "date" }, owner: { type: "text" }, lead: { type: "text" }, team: { type: "text" },
  } },
  { name: "milestone", icon: "🎯", color: "#8b5cf6", fields: { status: { type: "select", options: ["planned", "in-progress", "completed"] }, targetDate: { type: "date" }, owner: { type: "text" } } },
  { name: "cycle", icon: "🔄", color: "#0ea5e9", fields: { status: { type: "select", options: ["planned", "active", "completed"] }, startDate: { type: "date" }, targetDate: { type: "date" }, capacity: { type: "number" } } },
  { name: "release", icon: "🚀", color: "#10b981", fields: { status: { type: "select", options: ["planned", "ready", "released"] }, targetDate: { type: "date" }, version: { type: "text" } } },
];

function mergeSchema(existing: PluginType | undefined, incoming: WorkModelDefinition): string {
  let schema: { fields?: Record<string, unknown> } = {};
  try { schema = existing ? JSON.parse(existing.schema) as { fields?: Record<string, unknown> } : {}; } catch { schema = {}; }
  return JSON.stringify({ ...schema, fields: { ...(schema.fields ?? {}), ...incoming.fields } });
}

export async function installWorkModels(context: PluginContext) {
  const existing = await context.data.types.list();
  for (const model of WORK_MODEL_DEFINITIONS) {
    const current = existing.find((candidate) => candidate.name === model.name);
    await context.data.types.upsert(model.name, mergeSchema(current, model), current?.icon ?? model.icon, current?.color ?? model.color);
  }
  return { pluginId: context.manifest.id, modelCount: WORK_MODEL_DEFINITIONS.length, modelIds: WORK_MODEL_DEFINITIONS.map((model) => model.name) };
}

/**
 * `bug` was a near-duplicate of `issue` seeded by the old Development work
 * pack. C2 of the boundary closure merges them: every `bug` record becomes an
 * `issue` (props are kept verbatim — they render fine under the issue schema,
 * which is a superset), and any container view filtering on `"bug"` is
 * rewritten to `"issue"`. Runs fire-and-forget on activation; idempotent and
 * a cheap no-op once there is nothing left of type `bug`.
 */
export async function migrateBugToIssue(
  context: PluginContext,
): Promise<{ retyped: number; viewsRewritten: number }> {
  const bugs = await context.data.objects.query({ type: "bug", limit: 5000 });
  const containers = await context.data.objects.query({ limit: 5000 });
  const staleViews = containers.filter((object) => viewsMentionBug(object.props));
  if (bugs.length === 0 && staleViews.length === 0) return { retyped: 0, viewsRewritten: 0 };

  let retyped = 0;
  for (const bug of bugs) {
    try {
      await context.data.objects.setType(bug.id, "issue", bug.updated_at);
      retyped += 1;
    } catch { /* a concurrent edit bumped updated_at; the next activation retries */ }
  }

  let viewsRewritten = 0;
  for (const object of staleViews) {
    try {
      const props = JSON.parse(object.props) as Record<string, unknown>;
      props._views = rewriteBugInViews(props._views);
      await context.data.objects.update(object.id, { props: JSON.stringify(props) }, object.updated_at);
      viewsRewritten += 1;
    } catch { /* parse or conflict — retried next activation */ }
  }
  return { retyped, viewsRewritten };
}

function viewsMentionBug(rawProps: string): boolean {
  try {
    const views = (JSON.parse(rawProps) as { _views?: unknown })._views;
    return Array.isArray(views) && JSON.stringify(views).includes('"bug"');
  } catch { return false; }
}

/** Replace `"bug"` with `"issue"` in `typeFilter` and any query condition value. */
function rewriteBugInViews(views: unknown): unknown {
  if (!Array.isArray(views)) return views;
  const swap = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(swap);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([key, value]) => {
        if ((key === "typeFilter" || key === "value") && value === "bug") return [key, "issue"];
        return [key, swap(value)];
      }));
    }
    return node;
  };
  return views.map(swap);
}

function parseWorkRecordInput(input: unknown): { title?: string; parentId?: string; modules?: string[] } {
  // The free-text command palette passes a plain string title; the "+" menu
  // (driven generically by CommandRegistration.creates) passes a structured
  // { title?, parentId? } object so the new object can be nested under the
  // currently-selected folder/project, matching addNote()/addFolder().
  if (typeof input === "string") return { title: input.trim() || undefined };
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    return {
      title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : undefined,
      parentId: typeof record.parentId === "string" && record.parentId ? record.parentId : undefined,
      modules: Array.isArray(record.modules) && record.modules.every((m) => typeof m === "string")
        ? record.modules as string[]
        : undefined,
    };
  }
  return {};
}

async function createWorkRecord(context: PluginContext, type: "project" | "task" | "issue", input?: unknown) {
  const parsed = parseWorkRecordInput(input);
  const title = parsed.title ?? (type === "project" ? "New project" : `New ${type}`);
  const props: Record<string, unknown> = { status: type === "project" ? "planned" : "todo", priority: "none" };
  if (type === "project") Object.assign(props, NEW_PROJECT_PROPS);
  if (type === "project" && parsed.modules) props._modules = parsed.modules;
  return context.data.objects.create({
    type,
    title,
    parentId: parsed.parentId,
    props: JSON.stringify(props),
  });
}

export const workModelsPlugin = createBuiltinSurface({
  manifest: {
    id: "notible.work-models", name: "Tasks, Issues and Projects", version: "0.1.0", apiVersion: "0.1", entry: "index.ts",
    description: "Core work objects and project workflows.", permissions: ["data.read", "data.write", "relations.write", "workspace.ui"], sync: "data",
    dependencies: { "notible.properties": "0.1.0" },
  },
  capability: "work-models",
  commandName: "Install work models",
  viewTitle: "Work models",
  settingsTitle: "Work models settings",
  onCommand: installWorkModels,
  // Re-apply the type schemas on every activation, not just when someone
  // finds the "Install work models" button. `mergeSchema` only adds keys, so
  // this is idempotent — and it means a schema addition (e.g. `deps` for
  // dependencies) lands automatically on upgrade instead of silently
  // missing until the button is pressed.
  onActivate: (context) => {
    void installWorkModels(context)
      .then(() => migrateBugToIssue(context))
      .catch(() => {});
  },
  commands: [
    { id: "create-project", name: "Create project", description: "A project with its own tasks board.", creates: { objectType: "project", label: "Project", icon: "📁" }, execute: (context, input) => createWorkRecord(context, "project", input) },
    { id: "create-task", name: "Create task", description: "A task with status, priority and due date.", creates: { objectType: "task", label: "Task", icon: "✅" }, execute: (context, input) => createWorkRecord(context, "task", input) },
    { id: "create-issue", name: "Create issue", description: "An issue to track a bug or problem.", creates: { objectType: "issue", label: "Issue", icon: "🐞" }, execute: (context, input) => createWorkRecord(context, "issue", input) },
  ],
  viewRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
  settingsRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
});
