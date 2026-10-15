// Embedded queries: the whole point of splitting queries.ts from the renderer
// is that this file can exercise the semantics without a DOM. A query is
// attacker-influenced input — it arrives inside a note, and notes come from
// import, sync, paste and any plugin's objects.create — so the allowlist tests
// below matter more than the feature tests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  columnsFor,
  coreQueryFor,
  FETCH_LIMIT,
  fieldValue,
  localDay,
  parseQuery,
  resolveQuery,
  schemaFieldsOf,
} from "../plugins/builtin/queries.ts";

const TYPES = [
  { name: "task", schema: JSON.stringify({ fields: { status: {}, priority: {}, due: {} } }), icon: null, color: null },
  { name: "note", schema: "not json at all", icon: null, color: null },
];
const known = schemaFieldsOf(TYPES, ["task"]);
const parse = (source, today = new Date(2026, 7, 19)) => parseQuery(source, known, today);

const object = (id, title, props, updated = Date.UTC(2026, 7, 1)) => ({
  id, type: "task", title, content: "", props: JSON.stringify(props),
  created_at: updated, updated_at: updated, archived_at: null, trashed_at: null, parent_id: null,
});

// ---------- schema fields ----------

assert.ok(known.has("status") && known.has("priority") && known.has("due"), "schema fields are usable");
assert.ok(known.has("title") && known.has("updated"), "intrinsic fields are always usable");
assert.ok(!known.has("owner"), "a field no listed type declares is not usable");
assert.ok(!schemaFieldsOf(TYPES, ["note"]).has("status"), "a type whose schema is not JSON contributes nothing");

// ---------- parsing ----------

const basic = parse("type: task\nstatus: open, in_progress\ndue: <= +7d\nsort: due\nas: table\nfields: title, status, due");
assert.ok(basic.ok, "a well-formed block parses");
assert.deepEqual(basic.query.types, ["task"]);
assert.deepEqual(basic.query.fields.get("status"), ["open", "in_progress"], "a comma list is an OR, lower-cased");
assert.deepEqual(basic.query.due, { operator: "<=", day: "2026-08-26" }, "+7d is seven local days ahead");
assert.deepEqual(basic.query.sort, { field: "due", descending: false });
assert.deepEqual(basic.query.columns, ["title", "status", "due"]);

assert.deepEqual(parse("type: task\ndue: < today").query.due, { operator: "<", day: "2026-08-19" });
assert.deepEqual(parse("type: task\ndue: >= 2026-09-01").query.due, { operator: ">=", day: "2026-09-01" });
assert.deepEqual(parse("type: task\ndue: none").query.due, { operator: "none" });
assert.equal(parse("type: task\ndue: soon").ok, false, "a due value that is not a form we defined is an error");

assert.equal(parse("status: open").ok, false, "type is required");
assert.equal(parse("type: a, b, c, d, e").ok, false, "more than four types is a scan, not a query");
assert.equal(parse("type: task\nsort: nonsense").ok, false, "cannot sort by a field the type does not have");
assert.equal(parse("type: task\nas: kanban").ok, false, "unknown layout is an error");
assert.equal(parse("type: task\ntype: note").ok, false, "a key set twice is an error");
assert.equal(parse("type: task\njust some prose").ok, false, "a line that is not key: value is an error");
assert.equal(parse("type: task\nlimit: 9999").query.limit, 200, "limit is clamped to the display cap");
assert.equal(parse("type: task\n# a comment\n\ntype2: x").ok, false, "comments and blanks skipped, unknown key still an error");

// An unknown key must be an error and never silently ignored: a dropped filter
// is the block quietly lying about the workspace.
const typo = parse("type: task\nstatuss: open");
assert.equal(typo.ok, false);
assert.match(typo.errors[0].message, /unknown key "statuss"/);
assert.match(typo.errors[0].message, /status/, "the error lists what this type actually has");

// ---------- the allowlist: what a hostile note may not reach ----------

for (const hostile of ["__proto__", "constructor", "prototype", "content", "props"]) {
  assert.equal(parse(`type: task\nfields: ${hostile}`).ok, false, `fields: ${hostile} is refused`);
  assert.equal(parse(`type: task\nsort: ${hostile}`).ok, false, `sort: ${hostile} is refused`);
  assert.equal(parse(`type: task\n${hostile}: x`).ok, false, `${hostile} as a filter is refused`);
}
assert.ok(!schemaFieldsOf([{ name: "task", schema: JSON.stringify({ fields: { __proto__: {}, content: {}, ok: {} } }), icon: null, color: null }], ["task"]).has("__proto__"),
  "even a type schema declaring __proto__ cannot make it usable");

// The query literal is built field by field. objects.query spreads its
// argument into invoke(), so a spread of parsed keys would let note text set
// includeArchived and surface objects the user deliberately hid.
const scoped = parse(["type: task", "parent: here"].join("\n")).query;
assert.deepEqual(coreQueryFor(scoped, "task", "parent-1"),
  { type: "task", limit: FETCH_LIMIT, parentId: "parent-1" }, "parent: here scopes to the note's container");
assert.deepEqual(Object.keys(coreQueryFor(parse("type: task").query, "task", "parent-1")).sort(), ["limit", "type"],
  "no parent: here means no parentId, even when the host offers one");
assert.deepEqual(Object.keys(coreQueryFor(scoped, "task", undefined)).sort(), ["limit", "type"],
  "parent: here with no host id degrades to unscoped rather than undefined");
assert.equal(parse("type: task\nincludeArchived: true").ok, false, "includeArchived is not a key a note may use");
assert.equal(parse("type: task\nparent: Some Project").ok, false, 'parent accepts only "here" — a title lookup would be an untyped scan');

// ---------- resolution ----------

const fetched = [
  object("a", "Draft the brief", { status: "open", due: "2026-08-18", priority: "high" }),
  object("b", "Review with client", { status: "open", due: "2026-08-22" }),
  object("c", "Old thing", { status: "done", due: "2026-08-01" }),
  object("d", "No date", { status: "in_progress" }),
  object("e", "Far future", { status: "open", due: "2026-12-01" }),
];

const open = resolveQuery(parse("type: task\nstatus: open, in_progress").query, fetched, false);
assert.deepEqual(open.objects.map((entry) => entry.id), ["a", "b", "d", "e"], "status is an OR over the listed values");

const week = resolveQuery(parse("type: task\ndue: <= +7d").query, fetched, false);
assert.deepEqual(week.objects.map((entry) => entry.id), ["a", "b", "c"], "<= +7d includes past and the boundary day");
assert.deepEqual(resolveQuery(parse("type: task\ndue: >= 2026-08-22").query, fetched, false).objects.map((entry) => entry.id),
  ["b", "e"], ">= includes the boundary day");
assert.deepEqual(resolveQuery(parse("type: task\ndue: none").query, fetched, false).objects.map((entry) => entry.id),
  ["d"], "none matches a missing date");
assert.deepEqual(resolveQuery(parse("type: task\ntext: REVIEW").query, fetched, false).objects.map((entry) => entry.id),
  ["b"], "text matches the title case-insensitively");

// Sorting: missing values last in BOTH directions. An empty due date is not
// "earliest", it is unknown, and burying it is the honest default.
assert.deepEqual(resolveQuery(parse("type: task\nsort: due").query, fetched, false).objects.map((entry) => entry.id),
  ["c", "a", "b", "e", "d"]);
assert.deepEqual(resolveQuery(parse("type: task\nsort: due desc").query, fetched, false).objects.map((entry) => entry.id),
  ["e", "b", "a", "c", "d"]);

// limit is applied after sorting, not before.
const limited = resolveQuery(parse("type: task\nsort: due\nlimit: 2").query, fetched, false);
assert.deepEqual(limited.objects.map((entry) => entry.id), ["c", "a"]);
assert.equal(limited.matched, 5, "matched counts everything, so the block can say 2 of 5");

// Malformed props is counted and reported, never silently dropped.
const broken = resolveQuery(parse("type: task").query, [...fetched, { ...object("f", "Broken", {}), props: "{oops" }], false);
assert.equal(broken.unreadable, 1);
assert.equal(broken.objects.length, 5, "the unreadable object is not rendered as if it matched");

// Truncation is carried through, so the renderer can say the workspace has
// more than the query could see rather than showing a confident wrong table.
assert.equal(resolveQuery(parse("type: task").query, fetched, true).truncated, true);

// ---------- day handling ----------

assert.equal(localDay(new Date(2026, 0, 5)), "2026-01-05", "single digits are padded");
{
  // A date-only string must not shift by a timezone offset: the block is about
  // calendar days, and 2026-08-18 is the 18th wherever the user is.
  const late = object("z", "Late", { due: "2026-08-18" }, Date.UTC(2026, 7, 18, 23, 30));
  const props = JSON.parse(late.props);
  assert.equal(fieldValue(late, props, "due"), "2026-08-18");
  assert.deepEqual(resolveQuery(parse("type: task\ndue: <= 2026-08-18").query, [late], false).objects.length, 1);
  assert.deepEqual(resolveQuery(parse("type: task\ndue: < 2026-08-18").query, [late], false).objects.length, 0);
}
assert.equal(fieldValue(object("y", "Y", {}), Object.create({ inherited: "nope" }), "inherited"), "",
  "an inherited slot is not this object's data");

// ---------- columns ----------

assert.deepEqual(columnsFor(parse("type: task").query, known), ["title", "status", "due"]);
assert.deepEqual(columnsFor(parse("type: task").query, new Set(["title", "updated"])), ["title"],
  "the default only names fields the type actually has");

// ---------- the renderer may not build HTML from strings ----------

// Comments are stripped first: the file's own doc comment names these APIs to
// explain why it does not use them, and a guard that trips on its own
// documentation is a guard people delete.
const renderer = readFileSync("plugins/builtin/queries-render.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
for (const forbidden of ["innerHTML", "outerHTML", "insertAdjacentHTML", "srcdoc", "Function(", "eval("]) {
  assert.ok(!renderer.includes(forbidden),
    `queries-render.ts must not use ${forbidden} — object titles come from notes a stranger can write`);
}
// And the guard must actually be able to fail.
assert.ok(/\/\*[\s\S]*?\*\//.test(readFileSync("plugins/builtin/queries-render.ts", "utf8")), "renderer still carries its doc comment");
assert.ok("const x = a.innerHTML;".replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").includes("innerHTML"),
  "stripping comments must not strip real code");

console.log("embedded queries checks passed");
