import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FileText, ListChecks, Bug, Folder, LayoutDashboard, BookText, BookCopy, BookMarked, PenLine, User, MapPin, Spline, GitBranch, CircleDashed, ChevronsUp, ChevronUp, Minus, ChevronDown, MoreHorizontal } from "lucide-react";
import "./surface.css";
import "./views-ui.css";
import type {
  PluginContext,
  PluginDataSource,
  PluginObject,
  PluginType,
} from "../../packages/plugin-api/src/index.ts";
import {
  VIEW_LAYOUTS,
  viewsFromObject,
  passesTypeFilter,
  monthGrid,
  parseDelimited,
  objectsToCsv,
  type PluginViewCondition,
  type PluginViewDefinition,
  type PluginViewQuery,
  type PluginViewScope,
  type SortField,
  type ViewLayout,
} from "./views.ts";
import { tagColor } from "./PropertiesEditor.tsx";
import { isSimpleStatusSet, shownStatuses, statusChoices } from "./task-statuses.ts";
import { appLocale } from "./app-locale.ts";
import { PluginI18nProvider, useT } from "./i18n.tsx";
import { Select, DatePicker, formatDate } from "../../src/core/ui/index.ts";
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, flexRender, type ColumnDef, type SortingState, type ColumnFiltersState, type ColumnSizingState } from "@tanstack/react-table";

interface HostBridge {
  openObject(id: string): Promise<void>;
  notifyChanged(): void;
}

interface Props { context: unknown; host?: HostBridge; initialContainerId?: string; }

function localISODate(d = new Date()): string {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function readProps(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function propsOf(object: PluginObject): Record<string, unknown> {
  return readProps(object.props);
}

function textProp(object: PluginObject, key: string): string {
  const value = propsOf(object)[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function tagsOf(object: PluginObject): string[] {
  const value = propsOf(object).tags;
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
}

function dateOf(object: PluginObject): string {
  return textProp(object, "due") || textProp(object, "targetDate") || textProp(object, "date");
}

function excerptOf(object: PluginObject): string {
  try {
    const document = JSON.parse(object.content) as { content?: unknown[] };
    const parts: string[] = [];
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const node = value as { type?: string; text?: string; content?: unknown[] };
      if (node.type === "text" && typeof node.text === "string") parts.push(node.text);
      node.content?.forEach(walk);
    };
    walk(document);
    return parts.join(" ").trim().slice(0, 120);
  } catch {
    return "";
  }
}

// Same lucide vocabulary the rest of the app draws for these types — keyed by
// the type's schema `icon` name (plugin types) and by the bare type name (core
// types). Anything unknown falls back to a neutral dashed circle, never an emoji.
const TYPE_ICONS: Record<string, typeof FileText> = {
  "book-text": BookText, "book-copy": BookCopy, "book-marked": BookMarked,
  "pen-line": PenLine, user: User, "map-pin": MapPin, spline: Spline, "git-branch": GitBranch,
  task: ListChecks, issue: Bug, note: FileText, page: FileText, project: Folder, dashboard: LayoutDashboard,
};

function TypeIcon({ type, iconName }: { type: string; iconName?: string }) {
  const Glyph = TYPE_ICONS[iconName ?? ""] ?? TYPE_ICONS[type] ?? CircleDashed;
  return <Glyph size={15} strokeWidth={1.75} aria-hidden="true" />;
}

// Same "urgent/high reads as heaviest" convention the priority chip already
// uses (`.is-priority` in MetaRow) — matched by name, not by the schema's
// option order, since a project may list priorities in any order.
function PriorityIcon({ value }: { value: string }) {
  const lower = value.toLowerCase();
  if (lower === "urgent" || lower === "critical") return <ChevronsUp size={14} aria-hidden="true" />;
  if (lower === "high") return <ChevronUp size={14} aria-hidden="true" />;
  if (lower === "low") return <ChevronDown size={14} aria-hidden="true" />;
  return <Minus size={14} aria-hidden="true" />;
}

function labelOf(value: string): string {
  if (!value) return "Untitled";
  // Namespaced plugin types arrive as "notible.typewriter.chapter" — show the
  // leaf ("Chapter"), not the raw dotted id with its first letter capitalised.
  const base = value.includes(".") ? value.slice(value.lastIndexOf(".") + 1) : value;
  if (base.toLowerCase() === "todo") return "To do";
  const spaced = base.replaceAll(/[-_]/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function fieldValue(object: PluginObject, field: string): unknown {
  if (field === "title") return object.title;
  if (field === "type") return object.type;
  if (field === "created_at") return new Date(object.created_at).toISOString().slice(0, 10);
  if (field === "updated_at") return new Date(object.updated_at).toISOString().slice(0, 10);
  return propsOf(object)[field];
}

function scalar(value: unknown): string {
  if (Array.isArray(value)) return value.map(scalar).join(", ");
  if (value == null) return "";
  return String(value);
}

function matchesCondition(object: PluginObject, condition: PluginViewCondition): boolean {
  const rawActual = fieldValue(object, condition.field);
  const actual = scalar(rawActual).toLocaleLowerCase();
  const expected = String(condition.value ?? "").toLocaleLowerCase();
  const today = localISODate();
  const actualDate = actual.slice(0, 10);
  const dateValue = condition.value ?? "";
  const numericActual = Number(rawActual);
  const numericExpected = Number(condition.value);
  switch (condition.operator) {
    case "equals": return actual === expected;
    case "not_equals": return actual !== expected;
    case "contains": return actual.includes(expected);
    case "not_contains": return !actual.includes(expected);
    case "empty": return actual.length === 0;
    case "not_empty": return actual.length > 0;
    case "overdue": return actual !== "" && actualDate < today;
    case "today": return actualDate === today;
    case "this_week": {
      if (!actualDate) return false;
      const date = new Date(`${actualDate}T00:00:00`);
      const start = new Date();
      const day = start.getDay() || 7;
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - day + 1);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return date >= start && date < end;
    }
    case "last_30_days": {
      if (!actualDate) return false;
      const date = new Date(`${actualDate}T00:00:00`);
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 29);
      return date >= start && date <= new Date();
    }
    case "gt": return Number.isFinite(numericActual) && Number.isFinite(numericExpected) ? numericActual > numericExpected : actual > expected;
    case "gte": return Number.isFinite(numericActual) && Number.isFinite(numericExpected) ? numericActual >= numericExpected : actual >= expected;
    case "lt": return Number.isFinite(numericActual) && Number.isFinite(numericExpected) ? numericActual < numericExpected : actual < expected;
    case "lte": return Number.isFinite(numericActual) && Number.isFinite(numericExpected) ? numericActual <= numericExpected : actual <= expected;
    case "date_equals": return actualDate === dateValue.slice(0, 10);
    default: return true;
  }
}

function matchesQuery(object: PluginObject, query?: PluginViewQuery): boolean {
  if (!query || query.children.length === 0) return true;
  const results = query.children.map((child) => "field" in child
    ? matchesCondition(object, child)
    : matchesQuery(object, child));
  return query.combinator === "or" ? results.some(Boolean) : results.every(Boolean);
}

type QueryOperator = "equals" | "not_equals" | "contains" | "not_contains" | "empty" | "not_empty" | "today" | "this_week" | "last_30_days" | "overdue" | "gt" | "gte" | "lt" | "lte" | "date_equals";
type QueryFieldKind = "text" | "number" | "date" | "boolean" | "tags";
interface QueryField { id: string; label: string; kind: QueryFieldKind; }

const OPERATOR_LABELS: Record<QueryOperator, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "does not contain",
  empty: "is empty",
  not_empty: "is not empty",
  today: "is today",
  this_week: "is this week",
  last_30_days: "is in the last 30 days",
  overdue: "is overdue",
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  date_equals: "is on",
};

const VALUELESS_OPERATORS = new Set<QueryOperator>(["empty", "not_empty", "today", "this_week", "last_30_days", "overdue"]);

function queryId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function isCondition(value: PluginViewCondition | PluginViewQuery): value is PluginViewCondition {
  return value.kind === "condition";
}

function withQueryIds(query: PluginViewQuery): PluginViewQuery {
  return {
    ...query,
    id: query.id ?? queryId("group"),
    children: query.children.map((child) => isCondition(child)
      ? { ...child, id: child.id ?? queryId("condition") }
      : withQueryIds(child)),
  };
}

function replaceQueryNode(root: PluginViewQuery, id: string, replacement: PluginViewCondition | PluginViewQuery): PluginViewQuery {
  if (root.id === id) return replacement as PluginViewQuery;
  return { ...root, children: root.children.map((child) => isCondition(child)
    ? child.id === id ? replacement as PluginViewCondition : child
    : replaceQueryNode(child, id, replacement)) };
}

function removeQueryNode(root: PluginViewQuery, id: string): PluginViewQuery {
  return { ...root, children: root.children.filter((child) => child.id !== id).map((child) => isCondition(child) ? child : removeQueryNode(child, id)) };
}

function operatorsForField(field: QueryField): QueryOperator[] {
  if (field.kind === "date") return ["date_equals", "not_equals", "today", "this_week", "last_30_days", "overdue", "gt", "lt", "empty", "not_empty"];
  if (field.kind === "number") return ["equals", "not_equals", "gt", "gte", "lt", "lte", "empty", "not_empty"];
  if (field.kind === "boolean") return ["equals", "not_equals", "empty", "not_empty"];
  return ["equals", "not_equals", "contains", "not_contains", "empty", "not_empty"];
}

function fieldKind(value: unknown, field: string): QueryFieldKind {
  if (field === "created_at" || field === "updated_at" || field === "due" || field === "targetDate" || field === "date") return "date";
  if (field === "tags") return "tags";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "text";
}

function inferFields(objects: PluginObject[]): QueryField[] {
  const fields = new Map<string, QueryField>([
    ["title", { id: "title", label: "Title", kind: "text" }],
    ["type", { id: "type", label: "Type", kind: "text" }],
    ["created_at", { id: "created_at", label: "Created", kind: "date" }],
    ["updated_at", { id: "updated_at", label: "Updated", kind: "date" }],
    ["status", { id: "status", label: "Status", kind: "text" }],
    ["priority", { id: "priority", label: "Priority", kind: "text" }],
    ["due", { id: "due", label: "Due", kind: "date" }],
    ["tags", { id: "tags", label: "Tags", kind: "tags" }],
  ]);
  for (const object of objects) {
    for (const [key, value] of Object.entries(propsOf(object))) {
      if (!fields.has(key)) fields.set(key, { id: key, label: labelOf(key), kind: fieldKind(value, key) });
    }
  }
  return [...fields.values()];
}

function QueryConditionEditor({ condition, fields, onChange, onRemove }: { condition: PluginViewCondition; fields: QueryField[]; onChange: (next: PluginViewCondition) => void; onRemove: () => void }) {
  const t = useT();
  const field = fields.find((candidate) => candidate.id === condition.field) ?? fields[0];
  const operators = field ? operatorsForField(field) : ["equals"] as QueryOperator[];
  const operator = operators.includes(condition.operator as QueryOperator) ? condition.operator as QueryOperator : operators[0];
  return <div className="plugin-query-row">
    <Select ariaLabel={t("Filter field")} value={field?.id ?? ""} onChange={(next) => { const nextField = fields.find((candidate) => candidate.id === next) ?? field; const nextOperators = nextField ? operatorsForField(nextField) : operators; onChange({ ...condition, field: next, operator: nextOperators[0], value: undefined }); }} options={fields.map((candidate) => ({ value: candidate.id, label: candidate.label }))} />
    <Select ariaLabel={t("Filter operator")} value={operator} onChange={(next) => onChange({ ...condition, operator: next as QueryOperator, value: VALUELESS_OPERATORS.has(next as QueryOperator) ? undefined : condition.value })} options={operators.map((candidate) => ({ value: candidate, label: OPERATOR_LABELS[candidate] }))} />
    {!VALUELESS_OPERATORS.has(operator) && (field?.kind === "date"
      ? <DatePicker ariaLabel={t("Filter value")} value={condition.value ?? ""} onChange={(next) => onChange({ ...condition, value: next })} />
      : <input aria-label={t("Filter value")} type={field?.kind === "number" ? "number" : "text"} value={condition.value ?? ""} onChange={(event) => onChange({ ...condition, value: event.target.value })} placeholder={t("Value")} />)}
    <button type="button" className="btn-icon" onClick={onRemove} aria-label={t("Remove filter")}>×</button>
  </div>;
}

function QueryGroupEditor({ group, fields, depth, onChange, onRemove }: { group: PluginViewQuery; fields: QueryField[]; depth: number; onChange: (next: PluginViewQuery) => void; onRemove?: () => void }) {
  const t = useT();
  const updateChild = (id: string, next: PluginViewCondition | PluginViewQuery) => onChange(replaceQueryNode(group, id, next));
  return <section className="plugin-query-group" style={{ marginLeft: Math.min(depth, 3) * 12 }}>
    <div className="plugin-query-group-header"><Select ariaLabel={t("Filter combinator")} value={group.combinator} onChange={(next) => onChange({ ...group, combinator: next as "and" | "or" })} options={[{ value: "and", label: t("All conditions") }, { value: "or", label: t("Any condition") }]} />{onRemove && <button type="button" className="btn-icon" onClick={onRemove} aria-label={t("Remove group")}>×</button>}</div>
    {group.children.map((child) => isCondition(child)
      ? <QueryConditionEditor key={child.id} condition={child} fields={fields} onChange={(next) => updateChild(child.id ?? "", next)} onRemove={() => onChange(removeQueryNode(group, child.id ?? ""))} />
      : <QueryGroupEditor key={child.id} group={child} fields={fields} depth={depth + 1} onChange={(next) => updateChild(child.id ?? "", next)} onRemove={() => onChange(removeQueryNode(group, child.id ?? ""))} />)}
    <div className="plugin-query-actions"><button type="button" onClick={() => onChange({ ...group, children: [...group.children, { kind: "condition", id: queryId("condition"), field: fields[0]?.id ?? "title", operator: operatorsForField(fields[0] ?? { id: "title", label: "Title", kind: "text" })[0] }] })}>+ Condition</button><button type="button" onClick={() => onChange({ ...group, children: [...group.children, { kind: "group", id: queryId("group"), combinator: "and", children: [] }] })}>+ Group</button></div>
  </section>;
}

function PluginQueryBuilder({ query, fields, onApply, onClose }: { query?: PluginViewQuery; fields: QueryField[]; onApply: (next?: PluginViewQuery) => void; onClose: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<PluginViewQuery>(() => withQueryIds(query ?? { kind: "group", combinator: "and", children: [] }));
  return <div className="plugin-query-builder" role="dialog" aria-label={t("View filters")}><div className="plugin-query-builder-header"><strong>{t("Filters")}</strong><button type="button" className="btn-icon" onClick={onClose} aria-label={t("Close filters")}>×</button></div><p className="plugin-query-help">{t("Build a nested query using public plugin data. Empty groups do not filter records.")}</p><QueryGroupEditor group={draft} fields={fields} depth={0} onChange={setDraft} /><div className="plugin-query-footer"><button type="button" onClick={() => onApply(undefined)}>{t("Clear")}</button><button type="button" className="btn-primary" onClick={() => onApply(draft.children.length > 0 ? draft : undefined)}>{t("Apply filters")}</button></div></div>;
}

function parseSource(record: PluginDataSource | undefined): { scope?: PluginViewScope; query?: PluginViewQuery } | null {
  if (!record) return null;
  try {
    const parsed = JSON.parse(record.definition) as { scope?: PluginViewScope; query?: PluginViewQuery };
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function recordsForView(
  context: PluginContext,
  containerId: string,
  view: PluginViewDefinition | undefined,
  dataSources: PluginDataSource[],
): Promise<PluginObject[]> {
  const source = parseSource(dataSources.find((record) => record.id === view?.dataSourceId));
  const scope = source?.scope ?? view?.source?.scope ?? { kind: "container", id: containerId };
  const raw = scope.kind === "container"
    ? await context.data.objects.query({ parentId: scope.id, limit: 5000 })
    : scope.kind === "type"
      ? await context.data.objects.query({ type: scope.type, limit: 5000 })
      : await context.data.objects.query({ limit: 5000 });
  const query = view?.query ?? source?.query ?? view?.source?.query;
  return raw.filter((object) => passesTypeFilter(object.type, view?.typeFilter) && matchesQuery(object, query));
}

export function selectOptions(types: PluginType[], typeName: string, field: string): string[] {
  const type = types.find((candidate) => candidate.name === typeName);
  if (!type) return [];
  try {
    const schema = JSON.parse(type.schema) as unknown;
    const fields = schema && typeof schema === "object" && !Array.isArray(schema)
      ? (schema as { fields?: Record<string, { options?: unknown }> }).fields
      : undefined;
    const options = fields?.[field]?.options;
    return Array.isArray(options) ? options.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function dateLabel(value: string): string {
  if (!value) return "No date";
  // The same format the date picker shows and accepts (R4 T10).
  // A full timestamp (e.g. toISOString(), which is UTC) is shown as its local day.
  const parsed = value.length > 10 ? new Date(value) : null;
  const day = parsed && !Number.isNaN(parsed.getTime()) ? localISODate(parsed) : value.slice(0, 10);
  return formatDate(day, appLocale().startsWith("pl") ? "pl" : "en") || value;
}

function ViewsTable({ objects, view, statusOptions, priorityOptions, onOpenObject, onUpdateProp, onCreate, onPersistView }: {
  objects: PluginObject[];
  view: PluginViewDefinition;
  statusOptions: string[];
  priorityOptions: string[];
  onOpenObject: (id: string) => void;
  onUpdateProp: (id: string, key: string, value: string) => void;
  onCreate: (type?: string) => void;
  onPersistView: (patch: Partial<PluginViewDefinition>) => void;
}) {
  const t = useT();
  const [sorting, setSorting] = useState<SortingState>(view.columnSort ? [{ id: view.columnSort.id, desc: view.columnSort.desc }] : []);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    Object.entries(view.columnFilters ?? {}).map(([id, value]) => ({ id, value })),
  );
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({ ...(view.columnWidths ?? {}) });
  const mixedTypes = useMemo(() => new Set(objects.map((object) => object.type)).size > 1, [objects]);

  // Debounced flush of the three grid-state pieces back to _views — but only
  // when they differ from what the view already stores. Without the guard this
  // effect re-ran every render (onPersistView is a fresh closure from the
  // parent), and each flush persisted → re-rendered → re-flushed: a ~400ms
  // write loop that showed up as flickering toolbar buttons and silent saves.
  const persistRef = useRef(onPersistView);
  persistRef.current = onPersistView;
  useEffect(() => {
    const next = {
      columnSort: sorting[0] ? { id: sorting[0].id, desc: !!sorting[0].desc } : undefined,
      columnWidths: Object.keys(columnSizing).length > 0 ? columnSizing : undefined,
      columnFilters: columnFilters.length > 0
        ? Object.fromEntries(columnFilters.map((f) => [f.id, String(f.value ?? "")]))
        : undefined,
    };
    const current = { columnSort: view.columnSort, columnWidths: view.columnWidths, columnFilters: view.columnFilters };
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    const handle = setTimeout(() => persistRef.current(next), 400);
    return () => clearTimeout(handle);
  }, [sorting, columnFilters, columnSizing, view.columnSort, view.columnWidths, view.columnFilters]);

  const columns = useMemo<ColumnDef<PluginObject>[]>(() => [
    { id: "title", header: t("Title"), accessorFn: (o) => o.title || "", size: view.columnWidths?.title ?? 220,
      cell: (ctx) => <button type="button" className="plugin-view-link" onClick={() => onOpenObject(ctx.row.original.id)}>{ctx.getValue<string>() || t("Untitled")}</button> },
    { id: "type", header: t("Type"), accessorFn: (o) => labelOf(o.type), size: view.columnWidths?.type ?? 110 },
    { id: "status", header: t("Status"), accessorFn: (o) => textProp(o, "status"), size: view.columnWidths?.status ?? 130,
      cell: (ctx) => <Select value={ctx.getValue<string>()} ariaLabel={t("Status")} onChange={(next) => onUpdateProp(ctx.row.original.id, "status", next)} options={statusChoices(statusOptions, ctx.getValue<string>()).map((v) => ({ value: v, label: labelOf(v) }))} /> },
    { id: "priority", header: t("Priority"), accessorFn: (o) => textProp(o, "priority"), size: view.columnWidths?.priority ?? 120,
      cell: (ctx) => <Select value={ctx.getValue<string>()} ariaLabel={t("Priority")} onChange={(next) => onUpdateProp(ctx.row.original.id, "priority", next)} options={priorityOptions.map((v) => ({ value: v, label: labelOf(v) }))} /> },
    { id: "due", header: t("Due"), accessorFn: (o) => dateOf(o).slice(0, 10), size: view.columnWidths?.due ?? 140,
      sortingFn: (a, b, id) => { const x = String(a.getValue(id) ?? ""); const y = String(b.getValue(id) ?? ""); return !x && !y ? 0 : !x ? 1 : !y ? -1 : x.localeCompare(y); },
      filterFn: (row, id, value) => dateLabel(String(row.getValue(id) ?? "")).toLowerCase().includes(String(value).toLowerCase()),
      cell: (ctx) => <DatePicker value={ctx.getValue<string>()} ariaLabel={t("Due")} onChange={(next) => onUpdateProp(ctx.row.original.id, "due", next)} /> },
    { id: "tags", header: t("Tags"), accessorFn: (o) => tagsOf(o).join(", "), size: view.columnWidths?.tags ?? 160 },
  ], [statusOptions, priorityOptions, onOpenObject, onUpdateProp, view.columnWidths, t]);

  const table = useReactTable({
    data: objects,
    columns,
    state: { sorting, columnFilters, columnSizing, columnVisibility: { type: mixedTypes } },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    defaultColumn: {
      filterFn: (row, columnId, value) => String(row.getValue(columnId) ?? "").toLowerCase().includes(String(value).toLowerCase()),
    },
  });

  if (objects.length === 0) {
    return <div className="plugin-view-empty"><p>{t("Nothing here yet.")}</p><button type="button" className="btn-primary" onClick={() => onCreate()}>{t("Add the first one")}</button></div>;
  }

  return <div className="plugin-view-table-wrap" style={{ overflowX: "auto" }}>
    <table className="plugin-view-table" style={{ width: table.getCenterTotalSize(), minWidth: "100%" }}>
      <thead>
        {table.getHeaderGroups().map((hg) => <tr key={hg.id}>
          {hg.headers.map((header) => <th key={header.id} style={{ width: header.getSize(), position: "relative" }}>
            <button type="button" className="plugin-view-th-sort" onClick={header.column.getToggleSortingHandler()}>
              {flexRender(header.column.columnDef.header, header.getContext())}
              <span aria-hidden="true">{header.column.getIsSorted() === "asc" ? " ▲" : header.column.getIsSorted() === "desc" ? " ▼" : ""}</span>
            </button>
            <span onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()}
              className={`plugin-view-col-resize${header.column.getIsResizing() ? " is-resizing" : ""}`} />
          </th>)}
        </tr>)}
        <tr className="plugin-view-filter-row">
          {table.getHeaderGroups()[0].headers.filter((header) => header.column.getIsVisible()).map((header) => {
            const id = header.column.id;
            const val = String(header.column.getFilterValue() ?? "");
            const opts = id === "status" ? statusOptions : id === "priority" ? priorityOptions : null;
            return <th key={id}>{opts
              ? <Select value={val} ariaLabel={t("Filter column")} placeholder={t("Any")} onChange={(next) => header.column.setFilterValue(next || undefined)} options={[{ value: "", label: t("Any") }, ...opts.map((v) => ({ value: v, label: labelOf(v) }))]} />
              : <input className="plugin-view-filter-input" value={val} placeholder={t("Filter…")} onChange={(e) => header.column.setFilterValue(e.target.value || undefined)} />}</th>;
          })}
        </tr>
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => <tr key={row.id}>
          {row.getVisibleCells().map((cell) => <td key={cell.id} style={{ width: cell.column.getSize() }}>{flexRender(cell.column.columnDef.cell ?? ((c) => c.getValue()), cell.getContext())}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>;
}

function CsvImportPanel({ containerId, types, context, onClose, onImported }: {
  containerId: string;
  types: PluginType[];
  context: PluginContext;
  onClose: () => void;
  onImported: () => void;
}) {
  const t = useT();
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [objectType, setObjectType] = useState("task");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function normalise(header: string): string {
    return header.trim().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").toLowerCase() || "value";
  }

  async function onFile(file: File) {
    try {
      const p = parseDelimited(await file.text());
      setParsed(p);
      let titleTaken = false;
      setMapping(p.headers.map((h) => {
        const n = normalise(h);
        if (!titleTaken && ["title", "name", "summary", "nazwa", "tytul", "tytuł"].includes(n)) { titleTaken = true; return "__title"; }
        return n;
      }));
      setError("");
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
  }

  async function run() {
    if (!parsed) return;
    setBusy(true);
    try {
      let count = 0;
      for (const row of parsed.rows) {
        const titleIndex = mapping.indexOf("__title");
        const title = ((titleIndex >= 0 ? row[titleIndex] : "") || row.find((cell) => cell.trim()) || "").trim();
        if (!title) continue;
        const props: Record<string, string> = {};
        mapping.forEach((target, i) => {
          if (target === "__title" || target === "__skip") return;
          const cell = (row[i] ?? "").trim();
          if (cell) props[target] = cell;
        });
        await context.data.objects.create({ type: objectType, title, props: JSON.stringify(props), parentId: containerId });
        count += 1;
      }
      context.ui.notice(t("Imported {count} records", { count: String(count) }));
      onImported();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally { setBusy(false); }
  }

  return <div className="plugin-view-import" role="dialog" aria-label={t("Import CSV")}>
    <div className="plugin-view-import-head"><strong>{t("Import CSV")}</strong><button type="button" className="btn-icon" onClick={onClose} aria-label={t("Close")}>×</button></div>
    {!parsed && <label className="plugin-view-import-file">
      <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); }} />
      <span>{t("Choose a .csv or .tsv file")}</span>
    </label>}
    {parsed && <>
      <label className="plugin-view-import-type">{t("Create as")} <Select value={objectType} ariaLabel={t("Object type")} onChange={setObjectType}
        options={types.filter((type) => !["space", "dashboard"].includes(type.name)).map((type) => ({ value: type.name, label: labelOf(type.name) }))} /></label>
      <div className="plugin-view-import-map">
        {parsed.headers.map((header, index) => <label key={index}><span>{header}</span>
          <Select value={mapping[index] ?? "__skip"} ariaLabel={t("Map column")}
            onChange={(next) => setMapping((current) => current.map((value, other) => other === index ? next : value))}
            options={[{ value: "__title", label: t("Title") }, { value: "__skip", label: t("Skip") },
              ...[...new Set(parsed.headers.map(normalise))].map((name) => ({ value: name, label: name }))]} /></label>)}
      </div>
      <p className="plugin-view-import-count">{t("{n} rows", { n: String(parsed.rows.length) })}</p>
      {error && <p className="plugin-view-import-error">{error}</p>}
      <div className="plugin-view-import-actions">
        <button type="button" onClick={() => { setParsed(null); setError(""); }}>{t("Back")}</button>
        <button type="button" className="btn-primary" disabled={busy || !mapping.includes("__title")} onClick={() => void run()}>{t("Import")}</button>
      </div>
    </>}
    {error && !parsed && <p className="plugin-view-import-error">{error}</p>}
  </div>;
}

/** Shared field vocabulary — the same status / priority / due / tags line
 * every layout draws, so a record reads the same in List, Gallery, Kanban and
 * the calendar's expanded day. Renders nothing when the record has none set. */
const FINISHED = new Set(["done", "closed", "resolved", "completed", "released"]);
const isFinished = (object: PluginObject) => FINISHED.has(textProp(object, "status").toLowerCase());
/** "None" is the absence of a priority, not a priority: no chip for it (T4). */
const hasPriority = (value: string) => Boolean(value) && value.toLowerCase() !== "none";

function StatusDot({ value }: { value: string }) {
  if (!value) return null;
  return <span className="plugin-view-status"><span className="plugin-view-status-dot" style={{ background: tagColor(value) }} aria-hidden="true" />{labelOf(value)}</span>;
}

function MetaRow({ object }: { object: PluginObject }) {
  const status = textProp(object, "status");
  const priority = textProp(object, "priority");
  const due = dateOf(object);
  const tags = tagsOf(object);
  if (!status && !priority && !due && tags.length === 0) return null;
  const priorityLower = priority.toLowerCase();
  return <div className="plugin-view-meta">
    <StatusDot value={status} />
    {hasPriority(priority) && <span className={`plugin-view-meta-chip${priorityLower === "urgent" || priorityLower === "high" ? " is-priority" : ""}`}>{labelOf(priority)}</span>}
    {due && <span className="plugin-view-meta-chip">{dateLabel(due)}</span>}
    {tags.map((tag) => <span key={tag} className="plugin-view-tag" style={{ background: tagColor(tag) }}>{tag}</span>)}
  </div>;
}

export function ViewContent({
  layout,
  objects,
  view,
  statusOptions,
  priorityOptions,
  onOpenObject,
  onUpdateProp,
  onCreate,
  onPersistView,
  typeIcons,
  onRename,
  onTrash,
  creating,
  onQuickCreate,
}: {
  layout: ViewLayout;
  objects: PluginObject[];
  /** type name → schema `icon` name, for the List/Gallery row glyph. */
  typeIcons?: Record<string, string>;
  /** Required for the table layout (grid state persistence); other layouts ignore it. */
  view?: PluginViewDefinition;
  statusOptions: string[];
  priorityOptions: string[];
  onOpenObject: (id: string) => void;
  onUpdateProp: (id: string, key: string, value: string) => void;
  /** `date` prefills the new-record form's due date (calendar: click an empty
   * day); `status` prefills it for the Kanban column's own "+" button. */
  onCreate: (type?: string, date?: string, status?: string) => void;
  onPersistView?: (patch: Partial<PluginViewDefinition>) => void;
  /** Card/row menu: rename in place and move to trash (T4). */
  onRename?: (id: string, title: string) => void;
  onTrash?: (id: string) => void;
  /** The quick-add form is open above: no "Nothing here yet" under it (T3). */
  creating?: boolean;
  /** Create a record without the form: the calendar's own "new task" box (T9). */
  onQuickCreate?: (title: string, fields: Record<string, string>) => void;
}) {
  const t = useT();
  const [renamingCard, setRenamingCard] = useState<string | null>(null);
  /** A card or row title, or the box that renames it. */
  const titleOf = (object: PluginObject, className: string) => renamingCard === object.id
    ? <input className="plugin-view-rename" autoFocus defaultValue={object.title} aria-label={t("Rename")}
        onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.currentTarget.value = object.title; event.currentTarget.blur(); } }}
        onBlur={(event) => { const next = event.currentTarget.value.trim(); setRenamingCard(null); if (next && next !== object.title) onRename?.(object.id, next); }} />
    : <strong className={className}>{object.title || t("Untitled")}</strong>;
  // Right-click menu for Kanban cards under a project — the same "act on this
  // item without opening it" affordance the sidebar rows have (Feedback
  // 27.08 pt 13). Actions run through the props this component already gets.
  const [cardMenu, setCardMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // The menu itself carries only two entries — Status and Priority — each
  // opening a flyout of concrete values on hover, instead of one flat list.
  const [cardSub, setCardSub] = useState<"status" | "priority" | "due" | null>(null);
  const openCardMenu = (id: string, x: number, y: number) => { setCardMenu({ id, x, y }); setCardSub(null); };
  // Shared by both Kanban cards and List rows — same "act on this item
  // without opening it" menu, just triggered by right-click in one layout
  // and a visible "…" button in the other.
  const menuObject = cardMenu ? objects.find((object) => object.id === cardMenu.id) : undefined;
  const closeCardMenu = () => { setCardMenu(null); setCardSub(null); };
  useEffect(() => {
    if (!cardMenu) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setCardMenu(null); setCardSub(null); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cardMenu]);
  const cardMenuNode = cardMenu && menuObject && <>
    <div className="plugin-view-menu-backdrop" onClick={closeCardMenu} onContextMenu={(event) => { event.preventDefault(); closeCardMenu(); }} />
    <div className={`plugin-view-menu${cardMenu.x > window.innerWidth - 420 ? " flips-left" : ""}`} role="menu" style={{ left: Math.min(cardMenu.x, window.innerWidth - 200), top: Math.min(cardMenu.y, window.innerHeight - 250) }}>
      <button type="button" role="menuitem" onMouseEnter={() => setCardSub(null)} onClick={() => { onOpenObject(menuObject.id); closeCardMenu(); }}>{t("Open")}</button>
      {onRename && <button type="button" role="menuitem" onMouseEnter={() => setCardSub(null)} onClick={() => { setRenamingCard(menuObject.id); closeCardMenu(); }}>{t("Rename")}</button>}
      <div className="plugin-view-submenu" onMouseEnter={() => setCardSub("status")}>
        <button type="button" className="plugin-view-submenu-trigger" aria-haspopup="true" aria-expanded={cardSub === "status"} onClick={() => setCardSub("status")}>{t("Status")}<span aria-hidden="true">›</span></button>
        {cardSub === "status" && <div className="plugin-view-submenu-panel" role="menu">
          {statusChoices(statusOptions, textProp(menuObject, "status")).map((value) => <button type="button" role="menuitemradio" aria-checked={value.toLowerCase() === textProp(menuObject, "status").toLowerCase()} key={`s-${value}`} onClick={() => { onUpdateProp(menuObject.id, "status", value); closeCardMenu(); }}>{labelOf(value)}</button>)}
        </div>}
      </div>
      <div className="plugin-view-submenu" onMouseEnter={() => setCardSub("priority")}>
        <button type="button" className="plugin-view-submenu-trigger" aria-haspopup="true" aria-expanded={cardSub === "priority"} onClick={() => setCardSub("priority")}>{t("Priority")}<span aria-hidden="true">›</span></button>
        {cardSub === "priority" && <div className="plugin-view-submenu-panel" role="menu">
          {priorityOptions.map((value) => <button type="button" role="menuitemradio" aria-checked={value.toLowerCase() === textProp(menuObject, "priority").toLowerCase()} key={`p-${value}`} onClick={() => { onUpdateProp(menuObject.id, "priority", value); closeCardMenu(); }}>{labelOf(value)}</button>)}
        </div>}
      </div>
      <div className="plugin-view-submenu" onMouseEnter={() => setCardSub("due")}>
        <button type="button" className="plugin-view-submenu-trigger" aria-haspopup="true" aria-expanded={cardSub === "due"} onClick={() => setCardSub("due")}>{t("Due date")}<span aria-hidden="true">›</span></button>
        {cardSub === "due" && <div className="plugin-view-submenu-panel plugin-view-due-panel" role="menu">
          <DatePicker value={textProp(menuObject, "due").slice(0, 10)} ariaLabel={t("Due date")} onChange={(next) => { onUpdateProp(menuObject.id, "due", next); closeCardMenu(); }} />
          {textProp(menuObject, "due") && <button type="button" onClick={() => { onUpdateProp(menuObject.id, "due", ""); closeCardMenu(); }}>{t("No due date")}</button>}
        </div>}
      </div>
      {onTrash && <button type="button" role="menuitem" className="is-danger" onMouseEnter={() => setCardSub(null)} onClick={() => { onTrash(menuObject.id); closeCardMenu(); }}>{t("Move to trash")}</button>}
    </div>
  </>;

  // Kanban card drag-to-column. HTML5 drag-and-drop is inert inside the Tauri
  // webview (dragDropEnabled), so this is a pointer drag: arm on pointerdown,
  // start once the pointer moves past a small threshold, drop onto whatever
  // rendered column is under the pointer at pointerup.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<string | null>(null);
  // Tracks the pointer while a card is armed so the ghost preview below can
  // follow it — separate from dropCol, which only changes when the column
  // under the pointer changes.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragArm = useRef<{ id: string; x: number; y: number } | null>(null);
  const didDrag = useRef(false);
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const arm = dragArm.current;
      if (!arm) return;
      if (!didDrag.current) {
        if (Math.hypot(event.clientX - arm.x, event.clientY - arm.y) < 5) return;
        didDrag.current = true;
        setDragId(arm.id);
      }
      setDragPos({ x: event.clientX, y: event.clientY });
      const under = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const day = under?.closest<HTMLElement>("[data-cal-day]")?.dataset.calDay;
      const col = under?.closest<HTMLElement>("[data-kanban-col]");
      setDropCol(day ? `day:${day}` : col?.dataset.kanbanCol ?? null);
    };
    const onUp = () => {
      const arm = dragArm.current;
      dragArm.current = null;
      if (arm && didDrag.current && dropCol !== null) {
        if (dropCol.startsWith("day:")) onUpdateProp(arm.id, "due", dropCol.slice(4));
        else onUpdateProp(arm.id, "status", dropCol === "__none__" ? "" : dropCol);
      }
      setDragId(null);
      setDropCol(null);
      setDragPos(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // The webview fires pointercancel instead of pointerup when a drag-like
    // gesture is interrupted (text selection, gesture arbitration). Without
    // this the drag silently never commits and the arm ref stays stuck.
    window.addEventListener("pointercancel", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp); };
  }, [dropCol, onUpdateProp]);

  // Calendar layout state — the month on screen and which day is expanded past
  // its 3-chip cap. Declared unconditionally (hooks can't sit inside the
  // per-layout branches below).
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [calExpanded, setCalExpanded] = useState<string | null>(null);
  // The day whose "new task" box is open (double-click a day).
  const [calAdding, setCalAdding] = useState<string | null>(null);
  // List layout: which status groups are collapsed. Not persisted — a fresh
  // view always opens fully expanded, same as the calendar's day cap resets.
  const [collapsedListGroups, setCollapsedListGroups] = useState<Set<string>>(new Set());
  // Kanban layout: which columns are collapsed to just their header bar, and
  // which column's "…" menu is open. Same not-persisted rule as the list groups.
  const [collapsedKanbanCols, setCollapsedKanbanCols] = useState<Set<string>>(new Set());
  const [kanbanColMenu, setKanbanColMenu] = useState<string | null>(null);
  useEffect(() => {
    if (!kanbanColMenu) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setKanbanColMenu(null); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [kanbanColMenu]);
  // Moving a wide Kanban sideways. The board has a fixed height and each
  // column scrolls inside it (the natural-height board of
  // 0.91.3 kept growing and pushed its scrollbar below the window), so the
  // board's own scrollbar always sits in view. On top of it:
  //   - horizontal wheel / trackpad swipe and Shift+wheel scroll the board;
  //   - dragging the board's empty background pans it, for mice with neither.
  // A callback ref (state), not useRef: the board element is replaced when the
  // view changes, and a listener on the old one silently stops working.
  const [kanbanBoard, setKanbanBoard] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const board = kanbanBoard;
    if (!board) return;
    // Fill the window below where the board starts (title, tabs and toolbar
    // above it differ per page), so its sideways scrollbar is on screen. The
    // CSS height is only the fallback until this runs.
    const fit = () => {
      let scroller: HTMLElement | null = board.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      // Where the board's top is with the page scrolled back to the start.
      const restingTop = board.getBoundingClientRect().top + (scroller?.scrollTop ?? 0);
      board.style.height = `${Math.max(320, Math.round(window.innerHeight - restingTop - 24))}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    const onWheel = (event: WheelEvent) => {
      if (board.scrollWidth <= board.clientWidth) return;
      const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const dx = sideways ? event.deltaX : event.shiftKey ? event.deltaY : 0;
      if (!dx) return; // plain vertical wheel: let the page scroll
      event.preventDefault();
      board.scrollLeft += dx;
    };
    let pan: { x: number; left: number; id: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || board.scrollWidth <= board.clientWidth) return;
      if ((event.target as HTMLElement).closest(".plugin-view-kanban-card, button, input, select, textarea, a, [role=menu]")) return;
      pan = { x: event.clientX, left: board.scrollLeft, id: event.pointerId };
      board.setPointerCapture(event.pointerId);
      board.classList.add("is-panning");
    };
    const onPointerMove = (event: PointerEvent) => {
      if (pan && event.pointerId === pan.id) board.scrollLeft = pan.left - (event.clientX - pan.x);
    };
    const endPan = (event: PointerEvent) => {
      if (!pan || event.pointerId !== pan.id) return;
      pan = null;
      board.classList.remove("is-panning");
    };
    board.addEventListener("wheel", onWheel, { passive: false });
    board.addEventListener("pointerdown", onPointerDown);
    board.addEventListener("pointermove", onPointerMove);
    board.addEventListener("pointerup", endPan);
    board.addEventListener("pointercancel", endPan);
    return () => {
      window.removeEventListener("resize", fit);
      board.removeEventListener("wheel", onWheel);
      board.removeEventListener("pointerdown", onPointerDown);
      board.removeEventListener("pointermove", onPointerMove);
      board.removeEventListener("pointerup", endPan);
      board.removeEventListener("pointercancel", endPan);
    };
  }, [kanbanBoard]);

  if (objects.length === 0 && (layout !== "kanban" || statusOptions.length > 6)) {
    if (creating) return null;
    return <div className="plugin-view-empty"><p>{t("Nothing here yet.")}</p><button type="button" className="btn-primary" onClick={() => onCreate()}>{t("Add the first one")}</button></div>;
  }

  if (layout === "table") {
    if (!view || !onPersistView) return null;
    return <ViewsTable objects={objects} view={view} statusOptions={statusOptions} priorityOptions={priorityOptions} onOpenObject={onOpenObject} onUpdateProp={onUpdateProp} onCreate={onCreate} onPersistView={onPersistView} />;
  }

  // Shared by Kanban (columns) and List (collapsible groups): schema statuses
  // that are in use, PLUS any status actually stored on a record that the
  // schema doesn't list (e.g. "Resolved" typed in Properties before it was
  // added to the type) — those used to collapse into "No status"; now each
  // gets its own group. Schema order first (the project's own lifecycle
  // order), then extras in first-seen order, then "No status" if anything is
  // unstatused.
  const groupByStatus = (everyStatus = false) => {
    const schemaByLower = new Map(statusOptions.map((status) => [status.toLowerCase(), status]));
    const seen = new Map<string, string>(); // lowercase key -> display label
    for (const object of objects) {
      const raw = textProp(object, "status").trim();
      if (raw) seen.set(raw.toLowerCase(), schemaByLower.get(raw.toLowerCase()) ?? raw);
    }
    const colFor = (raw: string) => raw.trim() ? seen.get(raw.trim().toLowerCase()) ?? "__none__" : "__none__";
    const schemaCols = everyStatus ? statusOptions : statusOptions.filter((status) => seen.has(status.toLowerCase()));
    const extraCols = [...seen.values()].filter((label) => !schemaByLower.has(label.toLowerCase()));
    const hasUnstatused = objects.some((object) => !textProp(object, "status").trim());
    const columns = [...schemaCols, ...extraCols, ...(hasUnstatused ? ["__none__"] : [])];
    const grouped = new Map(columns.map((column) => [column, [] as PluginObject[]]));
    objects.forEach((object) => { grouped.get(colFor(textProp(object, "status")))?.push(object); });
    return { columns, grouped };
  };

  if (layout === "kanban") {
    // Empty columns only on a short, simple workflow (a new project's four). With all 11 statuses a
    // row of empty columns pushed the ones holding the work off screen (0.94.0).
    const { columns, grouped } = groupByStatus(statusOptions.length <= 6);
    return <><div className="plugin-view-kanban" ref={setKanbanBoard}>{columns.map((column) => {
      const items = grouped.get(column) ?? [];
      const isDropTarget = dragId !== null && dropCol === column;
      const isCollapsed = collapsedKanbanCols.has(column);
      const toggleCollapsed = () => setCollapsedKanbanCols((current) => {
        const next = new Set(current);
        if (next.has(column)) next.delete(column); else next.add(column);
        return next;
      });
      return <section key={column} data-kanban-col={column} className={`plugin-view-kanban-col${isDropTarget ? " is-drop-target" : ""}${isCollapsed ? " is-collapsed" : ""}`}>
        <strong className="plugin-view-kanban-head">
          <span title={column.toLowerCase() === "triage" ? t("New work nobody has sorted yet") : undefined}>{column === "__none__" ? t("No status") : labelOf(column)}</span>
          <span className="plugin-view-kanban-count">{items.length}</span>
          <span className="plugin-view-kanban-head-actions">
            <button type="button" className="plugin-view-kanban-head-btn" aria-label={t("Add to {column}", { column: column === "__none__" ? t("No status") : labelOf(column) })} onClick={() => onCreate(undefined, undefined, column === "__none__" ? undefined : column)}>+</button>
            <span className="plugin-view-submenu">
              <button type="button" className="plugin-view-kanban-head-btn" aria-haspopup="true" aria-expanded={kanbanColMenu === column} onClick={() => setKanbanColMenu((current) => current === column ? null : column)}>…</button>
              {kanbanColMenu === column && <div className="plugin-view-submenu-panel" role="menu" style={{ left: "auto", right: 0, top: "100%", marginLeft: 0, marginTop: 3 }}>
                <button type="button" onClick={() => { toggleCollapsed(); setKanbanColMenu(null); }}>{isCollapsed ? t("Expand column") : t("Collapse column")}</button>
              </div>}
            </span>
          </span>
        </strong>
        {isCollapsed ? null : items.map((object) => {
          const priority = textProp(object, "priority");
          const due = dateOf(object);
          const tags = tagsOf(object);
          return <article key={object.id} className={`plugin-view-kanban-card${object.id === dragId ? " is-dragging" : ""}${isFinished(object) ? " is-finished" : ""}`}
            onPointerDown={(event) => { if (event.button !== 0 || renamingCard === object.id) return; event.preventDefault(); dragArm.current = { id: object.id, x: event.clientX, y: event.clientY }; didDrag.current = false; }}
            onClick={() => { if (didDrag.current) { didDrag.current = false; return; } if (renamingCard !== object.id) onOpenObject(object.id); }}
            onContextMenu={(event) => { event.preventDefault(); openCardMenu(object.id, event.clientX, event.clientY); }}>
            <div className="plugin-view-kanban-card-head">
              <span className="plugin-view-type-icon"><TypeIcon type={object.type} iconName={typeIcons?.[object.type]} /></span>
              {titleOf(object, "plugin-view-kanban-card-title")}
            </div>
            {(hasPriority(priority) || due) && <div className="plugin-view-meta">
              {hasPriority(priority) && <span className={`plugin-view-meta-chip${priority.toLowerCase() === "urgent" || priority.toLowerCase() === "high" ? " is-priority" : ""}`}>{labelOf(priority)}</span>}
              {due && <span className="plugin-view-meta-chip">{dateLabel(due)}</span>}
            </div>}
            {tags.length > 0 && <div className="plugin-view-kanban-tags">{tags.map((tag) => <span key={tag} className="plugin-view-tag" style={{ background: tagColor(tag) }}>{tag}</span>)}</div>}
          </article>;
        })}
      </section>;
    })}
      {dragId && dragPos && (() => {
        const dragged = objects.find((object) => object.id === dragId);
        if (!dragged) return null;
        return <article className="plugin-view-kanban-card plugin-view-kanban-ghost" style={{ left: dragPos.x + 14, top: dragPos.y + 10 }}>
          <div className="plugin-view-kanban-card-head">
            <span className="plugin-view-type-icon"><TypeIcon type={dragged.type} iconName={typeIcons?.[dragged.type]} /></span>
            <strong className="plugin-view-kanban-card-title">{dragged.title || "Untitled"}</strong>
          </div>
        </article>;
      })()}
      {kanbanColMenu && <div className="plugin-view-menu-backdrop" onClick={() => setKanbanColMenu(null)} />}
      {cardMenuNode}
    </div></>;
  }

  if (layout === "calendar") {
    const cells = monthGrid(calMonth.y, calMonth.m);
    const byDay = new Map<string, PluginObject[]>();
    objects.forEach((object) => { const key = dateOf(object).slice(0, 10); if (key) byDay.set(key, [...(byDay.get(key) ?? []), object]); });
    const undated = objects.filter((object) => !dateOf(object).slice(0, 10));
    const today = localISODate();
    const monthLabel = new Date(calMonth.y, calMonth.m, 1).toLocaleDateString(appLocale(), { month: "long", year: "numeric" });
    const shiftMonth = (delta: number) => setCalMonth(({ y, m }) => { const d = new Date(y, m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
    const weekdays = [t("Mon"), t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat"), t("Sun")];
    return <div className="plugin-view-cal">
      <div className="plugin-view-cal-head">
        <button type="button" className="btn-icon" onClick={() => shiftMonth(-1)} aria-label={t("Previous month")}>‹</button>
        <strong>{monthLabel}</strong>
        <button type="button" className="btn-icon" onClick={() => shiftMonth(1)} aria-label={t("Next month")}>›</button>
        <button type="button" onClick={() => { const d = new Date(); setCalMonth({ y: d.getFullYear(), m: d.getMonth() }); }}>{t("Today")}</button>
      </div>
      <div className="plugin-view-cal-grid">
        {weekdays.map((day) => <div key={day} className="plugin-view-cal-weekday">{day}</div>)}
        {cells.map((cell) => {
          const items = byDay.get(cell.iso) ?? [];
          const expanded = calExpanded === cell.iso;
          const shown = expanded ? items : items.slice(0, 3);
          return <div key={cell.iso} data-cal-day={cell.iso}
            className={`plugin-view-cal-cell${cell.inMonth ? "" : " is-out"}${cell.iso === today ? " is-today" : ""}${dragId !== null && dropCol === `day:${cell.iso}` ? " is-drop-target" : ""}`}
            title={t("Double-click to add a task on this day")}
            onDoubleClick={(event) => { if ((event.target as HTMLElement).closest(".plugin-view-cal-chip, .plugin-view-cal-more, input")) return; if (onQuickCreate) setCalAdding(cell.iso); else onCreate(undefined, cell.iso); }}>
            <span className="plugin-view-cal-daynum">{cell.iso === today ? <span className="plugin-view-cal-today">{Number(cell.iso.slice(8, 10))}</span> : Number(cell.iso.slice(8, 10))}</span>
            {shown.map((object) => <button type="button" key={object.id} className={`plugin-view-cal-chip${object.id === dragId ? " is-dragging" : ""}`}
              style={{ borderInlineStartColor: tagColor(textProp(object, "status") || object.type) }}
              onPointerDown={(event) => { if (event.button !== 0) return; dragArm.current = { id: object.id, x: event.clientX, y: event.clientY }; didDrag.current = false; }}
              onClick={() => { if (didDrag.current) { didDrag.current = false; return; } onOpenObject(object.id); }}>{object.title || t("Untitled")}</button>)}
            {calAdding === cell.iso && <input className="plugin-view-cal-new" autoFocus placeholder={t("New task…")} aria-label={t("New task on {date}", { date: dateLabel(cell.iso) })}
              onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setCalAdding(null); } if (event.key === "Enter") { const title = event.currentTarget.value.trim(); setCalAdding(null); if (title) onQuickCreate?.(title, { due: cell.iso }); } }}
              onBlur={(event) => { const title = event.currentTarget.value.trim(); setCalAdding(null); if (title) onQuickCreate?.(title, { due: cell.iso }); }} />}
            {items.length > 3 && !expanded && <button type="button" className="plugin-view-cal-more" onClick={() => setCalExpanded(cell.iso)}>+{items.length - 3} {t("more")}</button>}
            {expanded && <button type="button" className="plugin-view-cal-more" onClick={() => setCalExpanded(null)}>{t("Show less")}</button>}
          </div>;
        })}
      </div>
      {undated.length > 0 && <details className="plugin-view-cal-undated">
        <summary>{t("No date")} ({undated.length})</summary>
        {undated.map((object) => <button type="button" key={object.id} className="plugin-view-row" onClick={() => onOpenObject(object.id)}>{object.title || t("Untitled")}</button>)}
      </details>}
    </div>;
  }

  // Gallery: a type icon, the title, an optional body excerpt and the shared
  // MetaRow, stacked into a card. List gets its own tabular row below —
  // aligned Status/Priority/Due columns don't fit the same markup.
  if (layout === "gallery") {
    const galleryRow = (object: PluginObject) => {
      const excerpt = excerptOf(object);
      return <article key={object.id} className="plugin-view-card" onClick={() => onOpenObject(object.id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onOpenObject(object.id); }}>
        <div className="plugin-view-row-main">
          <span className="plugin-view-type-icon"><TypeIcon type={object.type} iconName={typeIcons?.[object.type]} /></span>
          <strong className="plugin-view-row-title">{object.title || t("Untitled")}</strong>
        </div>
        {excerpt && <small className="plugin-view-excerpt">{excerpt}</small>}
        <MetaRow object={object} />
      </article>;
    };
    return <div className="plugin-view-gallery">{objects.map(galleryRow)}</div>;
  }

  // List groups by status — same lifecycle order and "No status" catch-all as
  // the Kanban columns, rendered as collapsible sections. Each row is a fixed
  // grid (Task | Status | Priority | Due date | …) with one header printed
  // once above every group, so the columns line up down the whole list.
  const { columns, grouped } = groupByStatus();
  const toggleGroup = (column: string) => setCollapsedListGroups((current) => {
    const next = new Set(current);
    if (next.has(column)) next.delete(column); else next.add(column);
    return next;
  });
  const listRow = (object: PluginObject) => {
    const status = textProp(object, "status");
    const priority = textProp(object, "priority");
    const due = dateOf(object);
    return <div key={object.id} className={`plugin-view-list-row${isFinished(object) ? " is-finished" : ""}`} onClick={() => { if (renamingCard !== object.id) onOpenObject(object.id); }} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onOpenObject(object.id); }}>
      <div className="plugin-view-list-row-task">
        <div className="plugin-view-row-main">
          <span className="plugin-view-type-icon"><TypeIcon type={object.type} iconName={typeIcons?.[object.type]} /></span>
          {titleOf(object, "plugin-view-row-title")}
        </div>
        {excerptOf(object) && <small className="plugin-view-excerpt">{excerptOf(object)}</small>}
      </div>
      {status ? <span className="plugin-view-list-status-pill" style={{ background: `color-mix(in srgb, ${tagColor(status)} 16%, transparent)`, color: tagColor(status) }}><span className="plugin-view-status-dot" style={{ background: tagColor(status) }} aria-hidden="true" />{labelOf(status)}</span> : <span />}
      {hasPriority(priority) ? <span className="plugin-view-list-priority"><PriorityIcon value={priority} />{labelOf(priority)}</span> : <span />}
      <span className="plugin-view-list-due">{due ? dateLabel(due) : ""}</span>
      <button type="button" className="plugin-view-list-row-menu" aria-label={t("Row actions")} onClick={(event) => { event.stopPropagation(); openCardMenu(object.id, event.clientX, event.clientY); }}>
        <MoreHorizontal size={14} aria-hidden="true" />
      </button>
    </div>;
  };
  return <div className="plugin-view-list">
    <div className="plugin-view-list-header">
      <span>{t("Task")}</span><span>{t("Status")}</span><span>{t("Priority")}</span><span>{t("Due date")}</span><span />
    </div>
    {columns.map((column) => {
      const items = grouped.get(column) ?? [];
      if (items.length === 0) return null;
      const collapsed = collapsedListGroups.has(column);
      return <section key={column} className="plugin-view-list-group">
        <button type="button" className="plugin-view-list-group-head" aria-expanded={!collapsed} onClick={() => toggleGroup(column)}>
          <span className="plugin-view-list-group-chevron" aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
          <span>{column === "__none__" ? t("No status") : labelOf(column)}</span>
          <span className="plugin-view-list-group-count">{items.length}</span>
        </button>
        {!collapsed && items.map(listRow)}
      </section>;
    })}
    {cardMenuNode}
  </div>;
}

function ViewsPluginViewInner({ context: rawContext, host, initialContainerId }: Props) {
  const t = useT();
  const context = rawContext as PluginContext;
  const [containerId, setContainerId] = useState(initialContainerId ?? "");
  const [container, setContainer] = useState<PluginObject | null>(null);
  const [objects, setObjects] = useState<PluginObject[]>([]);
  const [views, setViews] = useState<PluginViewDefinition[]>([]);
  const [activeId, setActiveId] = useState("default");
  const [types, setTypes] = useState<PluginType[]>([]);
  const [dataSources, setDataSources] = useState<PluginDataSource[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pickableContainers, setPickableContainers] = useState<PluginObject[]>([]);

  // Views are per-project too. Opened from Settings with no target project,
  // offer a real picker instead of a raw id box.
  useEffect(() => {
    if (initialContainerId) return;
    void Promise.all([context.data.objects.query({ type: "project", limit: 200 }), context.data.objects.query({ type: "folder", limit: 200 })])
      .then(([projects, folders]) => setPickableContainers([...projects, ...folders]))
      .catch(() => setPickableContainers([]));
  }, [context, initialContainerId]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newType, setNewType] = useState("task");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newDue, setNewDue] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [newPriority, setNewPriority] = useState("");
  const newTitleRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [queryOpen, setQueryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Import and export are rare: one "⋯" menu, so the toolbar stops wrapping (V-SURFACES-05).
  const [moreOpen, setMoreOpen] = useState(false);
  // The last deleted view, for Undo (T8). Cleared after a few seconds.
  const [deletedView, setDeletedView] = useState<{ view: PluginViewDefinition; index: number } | null>(null);
  useEffect(() => {
    if (!deletedView) return;
    const timer = window.setTimeout(() => setDeletedView(null), 8000);
    return () => window.clearTimeout(timer);
  }, [deletedView]);

  const active = useMemo(() => views.find((view) => view.id === activeId) ?? views[0], [activeId, views]);
  const typeFilter = active?.typeFilter ?? "";
  // No typeFilter → this is the tasks board; read task's schema, not whatever
  // type happens to sort first in types.list() (that gave Kanban the wrong
  // status set, so every card fell into "No status").
  const statusOptions = useMemo(() => selectOptions(types, typeFilter || "task", "status"), [typeFilter, types]);
  const priorityOptions = useMemo(() => selectOptions(types, typeFilter || "task", "priority"), [typeFilter, types]);
  // D2: a new project shows four task statuses; "All statuses" in ⋯ shows every one.
  const containerProps = useMemo(() => container ? propsOf(container) : {}, [container]);
  const simpleStatuses = isSimpleStatusSet(containerProps);
  const shownStatusOptions = useMemo(() => shownStatuses(statusOptions, containerProps, typeFilter || "task"), [statusOptions, containerProps, typeFilter]);
  const offersStatusSet = Boolean(initialContainerId) && (typeFilter || "task") === "task";
  const queryFields = useMemo(() => inferFields(objects), [objects]);
  const typeIcons = useMemo(() => Object.fromEntries(types.map((type) => [type.name, type.icon ?? ""])), [types]);
  // Mounted as a project/container tab (initialContainerId set) → this is a
  // task board, not the full cross-workspace engine. Offer only task-shaped
  // types plus whatever the container already holds; the Source selector and
  // the long "any registered type" list belong to Settings → Views only.
  const pickableTypes = useMemo(() => {
    const usable = types.filter((type) => !["space", "dashboard"].includes(type.name));
    if (!initialContainerId) return usable;
    const allowed = new Set(["task", "issue", "note", ...objects.map((object) => object.type)]);
    return usable.filter((type) => allowed.has(type.name));
  }, [types, objects, initialContainerId]);

  async function refreshRecords(nextView = active, nextSources = dataSources, nextContainerId = container?.id) {
    if (!nextContainerId) return;
    setLoading(true);
    try {
      setObjects(await recordsForView(context, nextContainerId, nextView, nextSources));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }

  async function load(requestedId = containerId) {
    setError("");
    const id = requestedId.trim();
    if (!id) { setError("Container id is required"); return; }
    setLoading(true);
    try {
      const [current, nextTypes, nextSources] = await Promise.all([
        context.data.objects.get(id),
        context.data.types.list(),
        context.data.dataSources.list(),
      ]);
      if (!current) throw new Error("Container not found");
      const nextViews = viewsFromObject(current);
      let nextActiveId = nextViews.some((view) => view.id === activeId) ? activeId : nextViews[0].id;
      if (!nextViews.some((view) => view.id === activeId)) {
        try {
          const stored = localStorage.getItem(`notible.activeView.${current.id}`);
          if (stored && nextViews.some((view) => view.id === stored)) nextActiveId = stored;
        } catch { /* localStorage is optional in Core/test environments */ }
      }
      const nextActive = nextViews.find((view) => view.id === nextActiveId);
      setContainer(current); setTypes(nextTypes); setDataSources(nextSources); setViews(nextViews); setActiveId(nextActiveId);
      setObjects(await recordsForView(context, current.id, nextActive, nextSources));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      setContainer(null); setObjects([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!initialContainerId) return;
    setContainerId(initialContainerId);
    void load(initialContainerId);
    // The host changes this only when a different container is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContainerId]);

  // One save at a time: two in flight (delete, then Undo) could land in the wrong order.
  const persistQueue = useRef<Promise<void>>(Promise.resolve());
  function persistViews(next: PluginViewDefinition[]) {
    const run = persistQueue.current.then(() => persistViewsNow(next));
    persistQueue.current = run.catch(() => {});
    return run;
  }
  async function persistViewsNow(next: PluginViewDefinition[]) {
    if (!container) return;
    try {
      const current = await context.data.objects.get(container.id) ?? container;
      const updated = await context.data.objects.update(current.id, { props: JSON.stringify({ ...propsOf(current), _views: next }) }, current.updated_at);
      setContainer(updated); setViews(next);
      const nextActive = next.find((view) => view.id === activeId) ?? next[0];
      await refreshRecords(nextActive, dataSources, updated.id);
      host?.notifyChanged();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  async function updateProp(id: string, key: string, value: string) {
    const object = objects.find((candidate) => candidate.id === id);
    if (!object) return;
    const props = { ...propsOf(object) };
    if (value) props[key] = value; else delete props[key];
    try {
      const updated = await context.data.objects.update(id, { props: JSON.stringify(props) }, object.updated_at);
      setObjects((current) => current.map((candidate) => candidate.id === id ? updated : candidate));
      host?.notifyChanged();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  async function setStatusSet(simple: boolean) {
    if (!container) return;
    try {
      const current = await context.data.objects.get(container.id) ?? container;
      const updated = await context.data.objects.update(current.id, { props: JSON.stringify({ ...propsOf(current), statusSet: simple ? "simple" : "all" }) }, current.updated_at);
      setContainer(updated);
      host?.notifyChanged();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  async function quickCreate(title: string, fields: Record<string, string>) {
    if (!container) return;
    const type = typeFilter || "task";
    try {
      const status = shownStatuses(selectOptions(types, type, "status"), containerProps, type)[0] ?? "";
      const priority = selectOptions(types, type, "priority")[0] ?? "";
      await context.data.objects.create({ type, title, content: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }), parentId: container.id, props: JSON.stringify({ status, priority, ...fields }) });
      await refreshRecords();
      host?.notifyChanged();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  async function renameRecord(id: string, title: string) {
    const object = objects.find((candidate) => candidate.id === id);
    if (!object) return;
    try {
      const updated = await context.data.objects.update(id, { title }, object.updated_at);
      setObjects((current) => current.map((candidate) => candidate.id === id ? updated : candidate));
      host?.notifyChanged();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  async function trashRecord(id: string) {
    try {
      await context.data.objects.trash(id);
      setObjects((current) => current.filter((candidate) => candidate.id !== id));
      context.ui.notice(t("Moved to trash. Restore it from Settings → Recovery."));
      host?.notifyChanged();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  async function handleExportCsv() {
    try {
      const csv = objectsToCsv(objects);
      const name = `${(active?.name || "view").replace(/[^\p{L}\p{N}_-]+/gu, "-")}.csv`;
      const path = await context.ui.exportFile(name, csv);
      context.ui.notice(t("Exported to {path}", { path }));
    } catch (value) {
      context.ui.notice(t("Export failed: {message}", { message: value instanceof Error ? value.message : String(value) }));
    }
  }

  async function createRecord(event: FormEvent) {
    event.preventDefault();
    if (!container || !newTitle.trim()) return;
    // "Create and add another" keeps the form open for the next one (T3).
    const again = ((event.nativeEvent as SubmitEvent).submitter as HTMLElement | null)?.dataset.again === "1";
    try {
      const newStatusOptions = shownStatuses(selectOptions(types, newType, "status"), containerProps, newType);
      const newPriorityOptions = selectOptions(types, newType, "priority");
      const status = newStatus || newStatusOptions[0] || "";
      // Core validates `content` as JSON (require_json), so a plain textarea
      // string can't go through raw — wrap it in a ProseMirror doc, same shape
      // as core-data-api's createNote. Empty stays a single empty paragraph.
      const body = newContent.trim();
      const content = JSON.stringify({ type: "doc", content: [body ? { type: "paragraph", content: [{ type: "text", text: body }] } : { type: "paragraph" }] });
      await context.data.objects.create({ type: newType, title: newTitle.trim(), content, parentId: container.id, props: JSON.stringify({ status, priority: newPriority || newPriorityOptions[0] || "", due: newDue }) });
      setNewTitle(""); setNewContent("");
      if (again) newTitleRef.current?.focus();
      else { setNewDue(""); setNewStatus(""); setNewPriority(""); setNewOpen(false); }
      await refreshRecords();
      host?.notifyChanged();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  function chooseView(id: string) {
    setActiveId(id);
    const next = views.find((view) => view.id === id);
    void refreshRecords(next);
    try { if (container) localStorage.setItem(`notible.activeView.${container.id}`, id); } catch { /* optional */ }
  }

  function applyQuery(nextQuery?: PluginViewQuery) {
    if (!active) return;
    setQueryOpen(false);
    const persistedQuery = nextQuery ?? { kind: "group" as const, combinator: "and" as const, children: [] };
    void persistViews(views.map((view) => view.id === active.id ? { ...view, query: persistedQuery } : view));
  }

  useEffect(() => { setContainer(null); setViews([]); setObjects([]); }, [containerId]);

  // Search narrows every layout (Kanban/List/Gallery/Table) by title; Sort
  // reorders the non-table layouts only — Table already sorts via its own
  // column headers, so imposing a second ordering on top of that one would
  // just fight it. CSV export and the raw `objects.length` in the summary
  // deliberately stay unfiltered — a search is a view convenience, not a
  // narrower data scope.
  // Sort is saved on the view (like the Table's column sort), so it survives
  // switching views and restarting the app.
  const sortField = active?.sort?.field ?? "";
  const sortDir = active?.sort?.dir ?? "asc";
  const setSort = (field: SortField | "", dir: "asc" | "desc") => {
    if (!active) return;
    void persistViews(views.map((view) => view.id === active.id ? { ...view, sort: field ? { field, dir } : undefined } : view));
  };
  const visibleObjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q ? objects.filter((object) => (object.title || "").toLowerCase().includes(q)) : objects;
    if (sortField && active?.layout !== "table") {
      const rank = (value: string) => { const i = priorityOptions.findIndex((option) => option.toLowerCase() === value.toLowerCase()); return i === -1 ? priorityOptions.length : i; };
      list = [...list].sort((a, b) => {
        let cmp = 0;
        if (sortField === "title") cmp = (a.title || "").localeCompare(b.title || "");
        else if (sortField === "due") {
          const da = dateOf(a), db = dateOf(b);
          cmp = (da ? new Date(da).getTime() : Infinity) - (db ? new Date(db).getTime() : Infinity);
        } else if (sortField === "priority") cmp = rank(textProp(a, "priority")) - rank(textProp(b, "priority"));
        else cmp = (a[sortField] ?? 0) - (b[sortField] ?? 0);
        return sortDir === "asc" ? cmp : -cmp;
      });
    } else if (!sortField && active?.layout !== "table") {
      // Manual: the order things were added, so a new task lands at the bottom, not the top (T10).
      list = [...list].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
    }
    return list;
  }, [objects, search, sortField, sortDir, active?.layout, priorityOptions]);

  return <article className="plugin-domain-view" data-plugin-view="notible.views">
    {!initialContainerId && <>
      <h2 className="settings-h2">{t("Views and Dashboards")}</h2>
      <div className="plugin-view-load-row"><Select value={containerId} ariaLabel={t("Project")} placeholder={t("Choose a project or folder…")} onChange={(next) => setContainerId(next)} options={pickableContainers.map((candidate) => ({ value: candidate.id, label: candidate.title || "Untitled" }))} /><button type="button" className="btn-primary" onClick={() => void load()} disabled={loading || !containerId}>{t("Open views")}</button></div>
    </>}
    {error && <div role="alert" className="plugin-view-error">{error}</div>}
    {container && <>
      <div className="plugin-view-tabs" role="tablist">{views.map((view) => <div key={view.id} className={`plugin-view-tab${view.id === active?.id ? " active" : ""}`} role="tab" aria-selected={view.id === active?.id} onClick={() => chooseView(view.id)}>{renamingId === view.id ? <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onBlur={() => { const name = renameValue.trim(); setRenamingId(null); if (name && name !== view.name) void persistViews(views.map((candidate) => candidate.id === view.id ? { ...candidate, name } : candidate)); }} onFocus={(event) => event.currentTarget.select()} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenamingId(null); }} onClick={(event) => event.stopPropagation()} aria-label={t("View name")} /> : <button type="button" onDoubleClick={(event) => { event.stopPropagation(); setRenamingId(view.id); setRenameValue(view.name); }}>{view.name} · {view.layout}</button>}{views.length > 1 && <button type="button" className="plugin-view-tab-delete" onClick={(event) => { event.stopPropagation(); if (view.id === active?.id && views.length > 1) chooseView(views.find((candidate) => candidate.id !== view.id)?.id ?? ""); setDeletedView({ view, index: views.indexOf(view) }); void persistViews(views.filter((candidate) => candidate.id !== view.id)); }} aria-label={t("Delete view {name}", { name: view.name })} title={t("Delete view")}>×</button>}</div>)}<button type="button" onClick={() => { const created = { id: queryId("view"), name: t("New view"), layout: "table" as const }; setActiveId(created.id); setRenamingId(created.id); setRenameValue(created.name); void persistViews([...views, created]); }}>+ {t("New view")}</button><button type="button" onClick={() => { if (!active) return; const copy = { ...active, id: queryId("view"), name: `${active.name} copy` }; setActiveId(copy.id); void persistViews([...views, copy]); }}>{t("Duplicate view")}</button></div>
      <div className="plugin-view-toolbar">{!initialContainerId && <span className="plugin-view-picker"><Select ariaLabel={t("Source")} value={active?.dataSourceId ? `saved:${active.dataSourceId}` : active?.source?.scope.kind === "workspace" ? "workspace" : active?.source?.scope.kind === "type" ? `type:${active.source.scope.type}` : "current"} onChange={(value) => { if (!active) return; const source = value === "workspace" ? { version: 1 as const, scope: { kind: "workspace" as const } } : value.startsWith("type:") ? { version: 1 as const, scope: { kind: "type" as const, type: value.slice(5) } } : value.startsWith("saved:") ? undefined : { version: 1 as const, scope: { kind: "container" as const, id: container.id } }; void persistViews(views.map((view) => view.id === active.id ? { ...view, source, dataSourceId: value.startsWith("saved:") ? value.slice(6) : undefined } : view)); }} options={[{ value: "current", label: t("Current container") }, { value: "workspace", label: t("Entire workspace") }, ...types.map((type) => ({ value: `type:${type.name}`, label: labelOf(type.name) })), ...dataSources.map((source) => ({ value: `saved:${source.id}`, label: source.name }))]} /></span>}<span className="plugin-view-picker plugin-view-labelled"><span className="plugin-view-sort-label">{t("Showing")}</span><Select ariaLabel={t("Showing")} value={typeFilter} placeholder={t("All types")} onChange={(next) => { if (!active) return; void persistViews(views.map((view) => view.id === active.id ? { ...view, typeFilter: next || undefined } : view)); }} options={[{ value: "", label: t("All types") }, ...pickableTypes.map((type) => ({ value: type.name, label: labelOf(type.name) }))]} /></span><span className="plugin-view-layouts" title={t("Changes how this view shows its items")}>{VIEW_LAYOUTS.map((layout) => <button type="button" key={layout} className={active?.layout === layout ? "active" : ""} onClick={() => { if (!active) return; void persistViews(views.map((view) => view.id === active.id ? { ...view, layout } : view)); }}>{labelOf(layout)}</button>)}</span><input type="search" className="plugin-view-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Search…")} aria-label={t("Search")} />{active?.layout !== "table" && <span className="plugin-view-sort"><span className="plugin-view-sort-label">{t("Sort")}</span><Select ariaLabel={t("Sort by")} value={sortField} placeholder={t("Sort")} onChange={(next) => setSort(next as SortField | "", next === "created_at" || next === "updated_at" ? "desc" : "asc")} options={[{ value: "", label: t("Manual") }, { value: "title", label: t("Title") }, { value: "created_at", label: t("Created") }, { value: "updated_at", label: t("Updated") }, { value: "due", label: t("Due date") }, { value: "priority", label: t("Priority") }]} />{sortField && <button type="button" className="plugin-view-sort-dir" aria-label={sortDir === "asc" ? t("Ascending") : t("Descending")} onClick={() => setSort(sortField, sortDir === "asc" ? "desc" : "asc")}>{sortDir === "asc" ? "↑" : "↓"}</button>}</span>}<button type="button" className={active && (active.query ? active.query.children.length > 0 : (active.source?.query?.children.length ?? 0) > 0) ? "active" : ""} onClick={() => setQueryOpen((current) => !current)}>{t("Filters")}</button><button type="button" className="btn-primary" onClick={() => setNewOpen((current) => !current)}>+ New</button><span className="plugin-view-more"><button type="button" className={moreOpen || importOpen ? "active" : ""} aria-expanded={moreOpen} aria-label={t("More actions")} title={t("More actions")} onClick={() => setMoreOpen((current) => !current)}>⋯</button>{moreOpen && <span className="plugin-view-more-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setMoreOpen(false); void handleExportCsv(); }}>{t("Export CSV")}</button><button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setImportOpen((current) => !current); }}>{t("Import CSV")}</button>{offersStatusSet && <button type="button" role="menuitemcheckbox" aria-checked={!simpleStatuses} onClick={() => { setMoreOpen(false); void setStatusSet(!simpleStatuses); }}>{simpleStatuses ? t("Show all 11 statuses") : t("Show 4 statuses")}</button>}</span>}</span></div>
      {queryOpen && active && <PluginQueryBuilder query={active.query ?? active.source?.query} fields={queryFields} onApply={applyQuery} onClose={() => setQueryOpen(false)} />}
      {importOpen && container && <CsvImportPanel containerId={container.id} types={types} context={context} onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); void refreshRecords(); host?.notifyChanged(); }} />}
      {newOpen && (() => {
        const statusChoicesForNew = shownStatuses(selectOptions(types, newType, "status"), containerProps, newType);
        const priorityChoicesForNew = selectOptions(types, newType, "priority");
        return <form className="plugin-view-create-form" onSubmit={(event) => void createRecord(event)} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setNewOpen(false); } }}>
          <label className="plugin-view-create-title">{t("Title")} <input ref={newTitleRef} autoFocus required value={newTitle} onChange={(event) => setNewTitle(event.target.value)} /></label>
          {pickableTypes.length > 1 && <label>{t("Type")} <Select ariaLabel={t("Type")} value={newType} onChange={(next) => { setNewType(next); setNewStatus(""); setNewPriority(""); }} options={pickableTypes.map((type) => ({ value: type.name, label: labelOf(type.name) }))} /></label>}
          {statusChoicesForNew.length > 0 && <label>{t("Status")} <Select ariaLabel={t("Status")} value={newStatus || statusChoicesForNew[0]} onChange={(next) => setNewStatus(next)} options={statusChoicesForNew.map((value) => ({ value, label: labelOf(value) }))} /></label>}
          {priorityChoicesForNew.length > 0 && <label>{t("Priority")} <Select ariaLabel={t("Priority")} value={newPriority || priorityChoicesForNew[0]} onChange={(next) => setNewPriority(next)} options={priorityChoicesForNew.map((value) => ({ value, label: labelOf(value) }))} /></label>}
          <label>{t("Due")} <DatePicker value={newDue} ariaLabel={t("Due")} onChange={(next) => setNewDue(next)} /></label>
          <label className="plugin-view-create-content">{t("Notes")} <textarea value={newContent} placeholder={t("Optional")} onChange={(event) => setNewContent(event.target.value)} rows={2} /></label>
          <div className="plugin-view-create-actions">
            <button type="submit" className="btn-primary">{t("Create")}</button>
            <button type="submit" data-again="1">{t("Create and add another")}</button>
            <button type="button" onClick={() => setNewOpen(false)}>{t("Cancel")}</button>
          </div>
        </form>;
      })()}
      {deletedView && <div className="plugin-view-undo" role="status">{t("Deleted view {name}", { name: deletedView.view.name })}<button type="button" onClick={() => { const restored = views.filter((view) => view.id !== deletedView.view.id); restored.splice(Math.min(deletedView.index, restored.length), 0, deletedView.view); setDeletedView(null); setActiveId(deletedView.view.id); void persistViews(restored); }}>{t("Undo")}</button></div>}
      <div className="plugin-view-summary">{loading ? t("Loading…") : search ? `${visibleObjects.length} / ${t("{count} items", { count: objects.length })}` : t("{count} items", { count: objects.length })} · {active?.name ?? t("No view")}</div>
      {active && <div key={active.layout} className="plugin-view-content-fade"><ViewContent layout={active.layout} objects={visibleObjects} view={active} typeIcons={typeIcons} statusOptions={shownStatusOptions.length > 0 ? shownStatusOptions : ["todo", "doing", "done"]} priorityOptions={priorityOptions.length > 0 ? priorityOptions : ["low", "medium", "high"]} onOpenObject={(id) => void host?.openObject(id)} onUpdateProp={(id, key, value) => void updateProp(id, key, value)} onCreate={(type, date, status) => { if (type) setNewType(type); if (date) setNewDue(date); setNewStatus(status ?? ""); setNewOpen(true); }} onPersistView={(patch) => { if (active) void persistViews(views.map((view) => view.id === active.id ? { ...view, ...patch } : view)); }} onRename={(id, title) => void renameRecord(id, title)} onTrash={(id) => void trashRecord(id)} creating={newOpen} onQuickCreate={(title, fields) => void quickCreate(title, fields)} /></div>}
    </>}
  </article>;
}

/** Translation for every component below, from the plugin's own context. The
 * provider has to sit outside the component that consumes it, so the surface
 * proper is `ViewsPluginViewInner`. */
export default function ViewsPluginView(props: Props) {
  return <PluginI18nProvider context={props.context as PluginContext}><ViewsPluginViewInner {...props} /></PluginI18nProvider>;
}
