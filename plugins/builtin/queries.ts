import type { PluginObject, PluginObjectQuery, PluginType } from "../../packages/plugin-api/src/index.ts";

/**
 * Embedded queries — parsing and resolution. No DOM here on purpose: the whole
 * query semantics has to be testable without a browser, because it is the part
 * a stranger's note gets to drive.
 *
 * The trust property that shapes this file: **a query is attacker-influenced
 * input.** Notes arrive by import, by sync from another device, by paste, and
 * by any plugin's `objects.create`. So nothing parsed here is ever spread into
 * an object handed to Core, and no string from a note is ever used as a
 * property name without first being matched against the type's own schema.
 */

/** Display cap. The fetch asks for far more so truncation can be detected. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
/** What we ask Core for. `query_objects` clamps to 5000 (src-tauri/src/lib.rs). */
export const FETCH_LIMIT = 1000;
/** More than a handful of types in one block is a scan, not a query. */
const MAX_TYPES = 4;
/** Columns every type has, whatever its schema says. */
const INTRINSIC_FIELDS = ["title", "updated"] as const;

export type QueryLayout = "table" | "list" | "count";

export interface DueFilter {
  operator: "<=" | "<" | ">=" | ">" | "none";
  /** Local calendar day, `YYYY-MM-DD`. Absent for `none`. */
  day?: string;
}

export interface EmbeddedQuery {
  types: string[];
  parentHere: boolean;
  /** Schema field -> accepted values, already lower-cased. OR within a field. */
  fields: Map<string, string[]>;
  due?: DueFilter;
  text?: string;
  sort?: { field: string; descending: boolean };
  limit: number;
  layout: QueryLayout;
  columns: string[];
}

export interface QueryError {
  /** The line as written, so the block can point at it. */
  line: string;
  message: string;
}

export type ParseResult =
  | { ok: true; query: EmbeddedQuery }
  | { ok: false; errors: QueryError[] };

/** Keys that mean something. Anything else is an error, never ignored — a
 * silently dropped filter is a query lying about the workspace. */
const KNOWN_KEYS = new Set(["type", "parent", "due", "text", "sort", "limit", "as", "fields"]);

/**
 * Property names that must never be read off a props object, whatever a
 * schema might claim. `__proto__`/`constructor`/`prototype` are JS plumbing
 * rather than data; `content` is the note body, and rendering that would put
 * the full text of every matching note inside a note somebody sent you.
 */
const FORBIDDEN_FIELDS = new Set(["__proto__", "constructor", "prototype", "content", "props"]);

function splitList(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

/** Local calendar day of a Date, `YYYY-MM-DD`. Local, not UTC: "due today"
 * means the user's today, and a UTC comparison is off by a day either side
 * depending on the offset. */
export function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `today`, `+7d`, `-3d` or `2026-09-01` -> a local calendar day. */
function resolveDay(token: string, today: Date): string | null {
  const value = token.trim().toLowerCase();
  if (value === "today") return localDay(today);
  const relative = /^([+-])(\d{1,4})d$/u.exec(value);
  if (relative) {
    const shifted = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    shifted.setDate(shifted.getDate() + Number(relative[2]) * (relative[1] === "-" ? -1 : 1));
    return localDay(shifted);
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  return null;
}

function parseDue(value: string, today: Date): DueFilter | null {
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === "none") return { operator: "none" };
  const match = /^(<=|>=|<|>)\s*(.+)$/u.exec(trimmed);
  if (!match) return null;
  const day = resolveDay(match[2], today);
  return day ? { operator: match[1] as DueFilter["operator"], day } : null;
}

/**
 * Which names a block may use as a column or a sort key.
 *
 * Only fields the type itself declares, plus the intrinsic ones. This is the
 * whole defence against `fields: __proto__` and friends: an unknown name never
 * reaches a property read, it becomes a parse error the user can see.
 */
export function schemaFieldsOf(types: PluginType[], wanted: string[]): Set<string> {
  const names = new Set<string>(INTRINSIC_FIELDS);
  for (const type of types) {
    if (!wanted.includes(type.name)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(type.schema) as unknown;
    } catch {
      continue;
    }
    const fields = (parsed as { fields?: Record<string, unknown> } | null)?.fields;
    if (!fields || typeof fields !== "object") continue;
    for (const name of Object.keys(fields)) {
      if (!FORBIDDEN_FIELDS.has(name)) names.add(name);
    }
  }
  return names;
}

/**
 * Parse a block body. `known` is the set of usable field names, from
 * `schemaFieldsOf`; pass an empty set and only the intrinsic ones are allowed.
 */
export function parseQuery(source: string, known: Set<string>, today = new Date()): ParseResult {
  const errors: QueryError[] = [];
  const seen = new Map<string, string>();

  for (const raw of source.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) {
      errors.push({ line, message: 'expected "key: value"' });
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (seen.has(key)) {
      errors.push({ line, message: `"${key}" is set twice` });
      continue;
    }
    if (!KNOWN_KEYS.has(key) && !known.has(key)) {
      errors.push({
        line,
        message: known.size > 0
          ? `unknown key "${key}" — this type has: ${[...known].sort().join(", ")}`
          : `unknown key "${key}"`,
      });
      continue;
    }
    seen.set(key, value);
  }

  const query: EmbeddedQuery = {
    types: [],
    parentHere: false,
    fields: new Map(),
    limit: DEFAULT_LIMIT,
    layout: "table",
    columns: [],
  };

  const types = splitList(seen.get("type") ?? "");
  if (types.length === 0) {
    errors.push({ line: "type:", message: "type is required — a query with no type reads the whole workspace" });
  } else if (types.length > MAX_TYPES) {
    errors.push({ line: `type: ${seen.get("type")}`, message: `at most ${MAX_TYPES} types per block` });
  } else {
    query.types = types;
  }

  const parent = seen.get("parent");
  if (parent !== undefined) {
    // Only "here". Resolving a title would need an untyped scan of the whole
    // workspace — the exact thing `type` is required to prevent — and titles
    // are ambiguous anyway.
    if (parent.trim().toLowerCase() !== "here") {
      errors.push({ line: `parent: ${parent}`, message: 'parent accepts only "here"' });
    } else {
      query.parentHere = true;
    }
  }

  const due = seen.get("due");
  if (due !== undefined) {
    const parsed = parseDue(due, today);
    if (!parsed) errors.push({ line: `due: ${due}`, message: 'expected "none" or an operator, e.g. "<= +7d", "< today", ">= 2026-09-01"' });
    else query.due = parsed;
  }

  const text = seen.get("text");
  if (text) query.text = text.toLowerCase();

  const sort = seen.get("sort");
  if (sort !== undefined) {
    const parts = sort.trim().split(/\s+/u);
    const field = (parts[0] ?? "").toLowerCase();
    const direction = (parts[1] ?? "asc").toLowerCase();
    if (!known.has(field)) errors.push({ line: `sort: ${sort}`, message: `cannot sort by "${field}"` });
    else if (direction !== "asc" && direction !== "desc") errors.push({ line: `sort: ${sort}`, message: 'direction must be "asc" or "desc"' });
    else query.sort = { field, descending: direction === "desc" };
  }

  const limit = seen.get("limit");
  if (limit !== undefined) {
    const value = Number(limit);
    if (!Number.isFinite(value) || value < 1) errors.push({ line: `limit: ${limit}`, message: "limit must be a positive number" });
    else query.limit = Math.min(Math.floor(value), MAX_LIMIT);
  }

  const layout = seen.get("as");
  if (layout !== undefined) {
    const value = layout.trim().toLowerCase();
    if (value !== "table" && value !== "list" && value !== "count") errors.push({ line: `as: ${layout}`, message: 'as must be "table", "list" or "count"' });
    else query.layout = value;
  }

  const columns = splitList(seen.get("fields") ?? "").map((name) => name.toLowerCase());
  for (const name of columns) {
    if (!known.has(name)) errors.push({ line: `fields: ${seen.get("fields")}`, message: `unknown column "${name}"` });
  }
  query.columns = columns.length > 0 ? columns.filter((name) => known.has(name)) : [];

  // Anything left is a schema field used as a filter.
  for (const [key, value] of seen) {
    if (KNOWN_KEYS.has(key)) continue;
    query.fields.set(key, splitList(value).map((entry) => entry.toLowerCase()));
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, query };
}

/**
 * The literal handed to `objects.query`, built field by field.
 *
 * Never a spread of parsed keys: `dataApi.objects.query` spreads its argument
 * straight into `invoke` (src/core/data/core-data-api.ts), so a spread would
 * let note text set `includeArchived` and surface objects the user hid.
 */
export function coreQueryFor(query: EmbeddedQuery, type: string, parentId?: string): PluginObjectQuery {
  const literal: PluginObjectQuery = { type, limit: FETCH_LIMIT };
  if (query.parentHere && parentId) literal.parentId = parentId;
  return literal;
}

function propsOf(object: PluginObject): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(object.props) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

/** Read one field, by a name already checked against the type's schema. */
export function fieldValue(object: PluginObject, props: Record<string, unknown>, name: string): string {
  if (name === "title") return object.title;
  if (name === "updated") return localDay(new Date(object.updated_at));
  // An own property, never `in`: an inherited slot is not this object's data,
  // and the name reaching here came out of a note. (`hasOwnProperty.call`
  // rather than `Object.hasOwn` only because the project targets ES2021.)
  if (!Object.prototype.hasOwnProperty.call(props, name)) return "";
  const value = props[name];
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** A stored date reduced to a local calendar day, or "" if it is not one. */
function dayOf(value: string): string {
  if (!value) return "";
  const iso = /^(\d{4}-\d{2}-\d{2})/u.exec(value);
  if (iso) return iso[1];
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? localDay(new Date(time)) : "";
}

export interface ResolveResult {
  objects: PluginObject[];
  /** Matched before `limit` was applied. */
  matched: number;
  /** A type came back at the fetch cap, so the workspace has more than we saw. */
  truncated: boolean;
  /** Objects whose props would not parse. Reported, never silently dropped. */
  unreadable: number;
}

/**
 * Filter, sort and cut. `fetched` is everything the queries came back with.
 *
 * `truncated` is the honest half: `query_objects` orders by `updated_at DESC`
 * and caps the row count, so a large workspace hands back the most recently
 * edited slice — a task due tomorrow but untouched for a month is simply not
 * in it. Rendering that as a complete answer would be the block lying.
 */
export function resolveQuery(query: EmbeddedQuery, fetched: PluginObject[], truncated: boolean): ResolveResult {
  let unreadable = 0;
  const matched: Array<{ object: PluginObject; props: Record<string, unknown> }> = [];

  for (const object of fetched) {
    const props = propsOf(object);
    if (props === null) {
      unreadable += 1;
      continue;
    }
    let keep = true;
    for (const [name, accepted] of query.fields) {
      const value = fieldValue(object, props, name).toLowerCase();
      if (!accepted.includes(value)) { keep = false; break; }
    }
    if (keep && query.due) {
      const day = dayOf(fieldValue(object, props, "due") || fieldValue(object, props, "targetDate"));
      if (query.due.operator === "none") keep = day === "";
      else if (day === "") keep = false;
      else if (query.due.operator === "<=") keep = day <= query.due.day!;
      else if (query.due.operator === "<") keep = day < query.due.day!;
      else if (query.due.operator === ">=") keep = day >= query.due.day!;
      else keep = day > query.due.day!;
    }
    if (keep && query.text && !object.title.toLowerCase().includes(query.text)) keep = false;
    if (keep) matched.push({ object, props });
  }

  if (query.sort) {
    const { field, descending } = query.sort;
    matched.sort((left, right) => {
      const a = fieldValue(left.object, left.props, field);
      const b = fieldValue(right.object, right.props, field);
      // Missing values last in both directions: an empty due date is not
      // "earliest", it is "unknown", and burying it is the honest default.
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return descending ? b.localeCompare(a) : a.localeCompare(b);
    });
  }

  return {
    objects: matched.slice(0, query.limit).map((entry) => entry.object),
    matched: matched.length,
    truncated,
    unreadable,
  };
}

/** Columns to draw: what the block asked for, or a sensible default that only
 * mentions fields this type actually has. */
export function columnsFor(query: EmbeddedQuery, known: Set<string>): string[] {
  if (query.columns.length > 0) return query.columns;
  return ["title", "status", "due"].filter((name) => known.has(name));
}
