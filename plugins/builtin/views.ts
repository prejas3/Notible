import type { Disposable, PluginContext, PluginObject, ViewMount } from "../../packages/plugin-api/src/index.ts";
import { createBuiltinSurface } from "./scaffold.ts";

export type ViewLayout = "gallery" | "list" | "table" | "kanban" | "calendar";
export type PluginViewScope = { kind: "workspace" } | { kind: "container"; id: string } | { kind: "type"; type: string };
export interface PluginViewCondition { kind: "condition"; id?: string; field: string; operator: string; value?: string; }
export interface PluginViewQuery { kind: "group"; id?: string; combinator: "and" | "or"; children: Array<PluginViewCondition | PluginViewQuery>; }
export interface PluginViewDefinition {
  id: string;
  name: string;
  layout: ViewLayout;
  typeFilter?: string;
  query?: PluginViewQuery;
  dataSourceId?: string;
  source?: { version: 1; scope: PluginViewScope; query?: PluginViewQuery };
  /** Table layout state, persisted per view. Optional — absent means defaults. */
  columnSort?: { id: string; desc: boolean };
  columnWidths?: Record<string, number>;
  columnFilters?: Record<string, string>;
  /** Sort for the non-table layouts. Absent = manual/stored order. */
  sort?: { field: SortField; dir: "asc" | "desc" };
}

export type SortField = "title" | "created_at" | "updated_at" | "due" | "priority";

export const VIEW_LAYOUTS: ViewLayout[] = ["gallery", "list", "table", "kanban", "calendar"];

/** Container / structural types that are never list rows. A view with no
 * explicit `typeFilter` (a fresh "all types" view, or a legacy pack view that
 * predates typeFilter) still hides these — otherwise the Tasks board lists the
 * project's Whiteboard, sub-folders, etc. alongside its tasks. */
export const NON_RECORD_TYPES = new Set(["space", "project", "folder", "dashboard", "whiteboard"]);

export function passesTypeFilter(objectType: string, typeFilter?: string): boolean {
  return typeFilter ? objectType === typeFilter : !NON_RECORD_TYPES.has(objectType);
}

/** Layout name migration. Two retired names normalise to `gallery` on read and
 * re-save that way on the next edit — no forced rewrite:
 *   - `canvas` — a card grid, confusing next to the Whiteboard's canvas.
 *   - `form`   — a read-only prop dump; `+ New record` and the Properties
 *     panel cover it (removed in 0.78.9).
 * Any other unknown value also falls back to `gallery`. */
function normaliseLayout(value: unknown): ViewLayout {
  return VIEW_LAYOUTS.includes(value as ViewLayout) ? value as ViewLayout : "gallery";
}

/** Month grid (Monday-first) for the calendar layout. `month` is 0-indexed.
 * Only as many whole weeks as the month actually touches — 4 to 6, never a
 * fixed 6. Leading/trailing cells belong to the adjacent months and are
 * flagged `inMonth: false`. Pure — unit-tested in views-parity-check. */
export function monthGrid(year: number, month: number): Array<{ iso: string; inMonth: boolean }> {
  const lead = (new Date(year, month, 1).getDay() || 7) - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((lead + daysInMonth) / 7) * 7;
  const cells: Array<{ iso: string; inMonth: boolean }> = [];
  for (let i = 0; i < cellCount; i++) {
    const d = new Date(year, month, 1 - lead + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    cells.push({ iso, inMonth: d.getMonth() === month && d.getFullYear() === year });
  }
  return cells;
}

function readProps(value: string): Record<string, unknown> {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

export function viewsFromObject(object: PluginObject): PluginViewDefinition[] {
  const raw = readProps(object.props)._views;
  if (Array.isArray(raw)) return raw
    .filter((value): value is PluginViewDefinition => !!value && typeof value === "object" && typeof (value as PluginViewDefinition).id === "string" && typeof (value as PluginViewDefinition).layout === "string")
    .map((value) => ({ ...value, layout: normaliseLayout(value.layout) }));
  // A project with no explicit _views renders one Kanban of its tasks — the
  // "Tasks" module's default surface. Editing or adding views behaves like any
  // container and persists to _views on first change (tolerant read, no write).
  if (object.type === "project") {
    return [{ id: "tasks", name: "Tasks", layout: "kanban", typeFilter: "task" }];
  }
  let layout: ViewLayout = "gallery";
  try {
    const stored = localStorage.getItem(`notible.containerView.${object.id}`);
    layout = normaliseLayout(stored);
  } catch { /* localStorage is optional in Core/test environments */ }
  return [{ id: "default", name: "Main", layout }];
}

export async function ensureDefaultView(context: PluginContext, input?: unknown) {
  const value = input && typeof input === "object" ? input as { containerId?: unknown; layout?: unknown; name?: unknown } : {};
  if (typeof value.containerId !== "string" || !value.containerId) throw new Error("containerId is required");
  const current = await context.data.objects.get(value.containerId);
  if (!current) throw new Error(`Container not found: ${value.containerId}`);
  const props = readProps(current.props);
  const views = Array.isArray(props._views) ? viewsFromObject(current) : [];
  if (views.length > 0) return { pluginId: context.manifest.id, containerId: current.id, created: false, views };
  const layout = normaliseLayout(value.layout);
  const next = [{ id: "default", name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : "Main", layout }];
  await context.data.objects.update(current.id, { props: JSON.stringify({ ...props, _views: next }) }, current.updated_at);
  return { pluginId: context.manifest.id, containerId: current.id, created: true, views: next };
}

/**
 * The dashboard is loaded on first mount, not imported at module scope.
 *
 * Two reasons, and both matter: its implementation pulls in a stylesheet,
 * which the headless check scripts cannot import; and a workspace surface
 * nobody opens should not cost anything. This is also the pattern a
 * third-party plugin would use to keep its entry module small — `mount` may
 * return its disposable asynchronously as long as it returns one.
 */
const mountWorkspaceDashboard: ViewMount = (context) => {
  let disposed = false;
  let inner: Disposable | void;
  void import("./workspace-dashboard-ui.ts").then((module) => {
    if (disposed) return;
    inner = module.mountWorkspaceDashboard(context);
  });
  return {
    dispose: () => {
      disposed = true;
      inner?.dispose();
    },
  };
};

export const viewsPlugin = createBuiltinSurface({
  manifest: { id: "notible.views", name: "Views and Dashboards", version: "0.1.0", apiVersion: "0.1", entry: "index.ts", description: "Persisted list, table, kanban, calendar, gallery and form view definitions.", permissions: ["data.read", "data.write", "workspace.ui"] },
  capability: "views",
  commandName: "Ensure default view",
  viewTitle: "Views",
  // No Settings panel: views are created and edited on the container they
  // belong to (the folder Table tab / workspace Dashboard tab below), not in
  // a global settings section. The 2 object tabs satisfy the surface check.
  onCommand: ensureDefaultView,
  viewRender: (context) => ({ kind: "react-loader", loader: () => import("./views-ui"), context }),
  // A workspace has no status/priority/due of its own, so table/kanban/
  // calendar/form over it were meaningless. It gets its own dashboard —
  // projects with progress, deadlines, open tasks from note bodies and
  // recent objects — and that dashboard is written against the PUBLIC plugin
  // contract (`mount`), not Core's privileged React path. See
  // workspace-dashboard-ui.ts for why.
  extraViews: [{ id: "workspace-dashboard", title: "Workspace dashboard", mount: mountWorkspaceDashboard }],

  objectTabs: [
    { id: "tasks", label: "Tasks", description: "A board of this project's tasks; add list, calendar or filtered views alongside it.", objectTypes: ["project", "folder"], defaultFor: ["project", "folder"], order: 0, viewId: "surface" },
    { id: "table", label: "Table", description: "A flat table of everything across this workspace's containers.", objectTypes: ["space"], order: 1, viewId: "surface" },
    { id: "overview", label: "Overview", description: "Projects with open/closed counts, this week's work and recent activity.", objectTypes: ["space"], defaultFor: ["space"], order: 0, viewId: "workspace-dashboard" },
  ],
});

// ---------------------------------------------------------------------------
// CSV helpers (Views table import/export). Pure; unit-tested in
// scripts/views-parity-check.mjs.

const CSV_BUILTIN_COLUMNS = ["title", "type", "status", "priority", "due", "tags"] as const;
const CSV_HIDDEN_KEYS = new Set(["icon", "color", "favorite", "_views", "_customFields", "trashed"]);

/** RFC-4180-ish parser. Separator is a tab when line 1 has more tabs than
 * commas, else a comma. `""` inside a quoted field is a literal quote; a
 * newline inside quotes is kept. Rows are padded / truncated to header width. */
export function parseDelimited(text: string): { headers: string[]; rows: string[][] } {
  const firstBreak = text.search(/\r?\n/);
  const firstLine = text.slice(0, firstBreak === -1 ? text.length : firstBreak);
  const sep = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === sep) { record.push(field); field = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field); field = "";
      records.push(record); record = [];
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || record.length > 0) { record.push(field); records.push(record); }
  while (records.length > 0 && records[records.length - 1].every((cell) => cell === "")) records.pop();
  const headers = records.shift() ?? [];
  const rows = records.map((r) => {
    const out = r.slice(0, headers.length);
    while (out.length < headers.length) out.push("");
    return out;
  });
  return { headers, rows };
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** `["title","type","status","priority","due","tags", ...customKeys]` header,
 * one CRLF-terminated row per object. `extraFields` overrides the discovered
 * custom keys. Values with a comma / quote / newline are quoted. */
export function objectsToCsv(objects: PluginObject[], extraFields?: string[]): string {
  const parsed = objects.map((object) => readProps(object.props));
  const custom = extraFields ?? [...new Set(parsed.flatMap((p) => Object.keys(p)))]
    .filter((k) => !CSV_BUILTIN_COLUMNS.includes(k as (typeof CSV_BUILTIN_COLUMNS)[number]) && !CSV_HIDDEN_KEYS.has(k) && !k.startsWith("_"))
    .sort();
  const header = [...CSV_BUILTIN_COLUMNS, ...custom];
  const lines = [header.map(csvCell).join(",")];
  objects.forEach((object, index) => {
    const p = parsed[index];
    const tags = Array.isArray(p.tags) ? (p.tags as unknown[]).filter((t): t is string => typeof t === "string").join("; ") : "";
    const row = [
      object.title ?? "",
      object.type ?? "",
      typeof p.status === "string" ? p.status : "",
      typeof p.priority === "string" ? p.priority : "",
      typeof p.due === "string" ? p.due : "",
      tags,
      ...custom.map((k) => { const v = p[k]; return v == null ? "" : String(v); }),
    ];
    lines.push(row.map(csvCell).join(","));
  });
  return lines.join("\r\n") + "\r\n";
}
