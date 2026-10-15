// scripts/views-parity-check.mjs
// ponytail: pure CSV parser/serializer + column-state round-trip. No React.
// Run: node --experimental-strip-types scripts/views-parity-check.mjs
import assert from "node:assert/strict";
import { parseDelimited, objectsToCsv, viewsFromObject, passesTypeFilter, monthGrid, VIEW_LAYOUTS } from "../plugins/builtin/views.ts";

// parseDelimited
{
  const p = parseDelimited('a,b,c\n1,"x,y",3\r\n"he said ""hi""",,z\n');
  assert.deepEqual(p.headers, ["a", "b", "c"]);
  assert.deepEqual(p.rows, [["1", "x,y", "3"], ['he said "hi"', "", "z"]]);

  const tsv = parseDelimited("a\tb\tc\n1\t2\t3");
  assert.deepEqual(tsv.headers, ["a", "b", "c"], "tab-separated auto-detected");

  const ragged = parseDelimited("a,b,c\n1,2");
  assert.deepEqual(ragged.rows, [["1", "2", ""]], "short rows padded to header width");

  const multiline = parseDelimited('a,b\n"line1\nline2",x\n');
  assert.deepEqual(multiline.rows, [["line1\nline2", "x"]], "newline inside quotes kept");
}

// objectsToCsv + round-trip
{
  const objs = [
    { id: "1", type: "task", title: "Plain", props: JSON.stringify({ status: "open", priority: "high", due: "2026-01-02", tags: ["a", "b"], notes: "no comma" }) },
    { id: "2", type: "task", title: 'Has, comma "and" quote', props: JSON.stringify({ status: "done", notes: "multi\nline" }) },
  ];
  const csv = objectsToCsv(objs);
  const head = csv.trim().split("\r\n")[0];
  assert.deepEqual(head.split(",").slice(0, 6), ["title", "type", "status", "priority", "due", "tags"]);
  assert.ok(head.includes("notes"), "custom prop key in header");

  const back = parseDelimited(csv);
  assert.equal(back.rows.length, 2);
  const row0 = Object.fromEntries(back.headers.map((h, i) => [h, back.rows[0][i]]));
  assert.equal(row0.title, "Plain");
  assert.equal(row0.status, "open");
  assert.equal(row0.tags, "a; b");
  const row1 = Object.fromEntries(back.headers.map((h, i) => [h, back.rows[1][i]]));
  assert.equal(row1.title, 'Has, comma "and" quote', "comma+quote round-trips through quoting");
  assert.equal(row1.notes, "multi\nline", "embedded newline round-trips");
}

// column state round-trips through viewsFromObject
{
  const container = {
    id: "c1", type: "collection",
    props: JSON.stringify({ _views: [{
      id: "v", name: "V", layout: "table",
      columnSort: { id: "status", desc: true },
      columnWidths: { title: 240, status: 90 },
      columnFilters: { priority: "high" },
    }] }),
  };
  const [v] = viewsFromObject(container);
  assert.deepEqual(v.columnSort, { id: "status", desc: true });
  assert.deepEqual(v.columnWidths, { title: 240, status: 90 });
  assert.deepEqual(v.columnFilters, { priority: "high" });
}

// passesTypeFilter: explicit filter is exact; no filter hides structural types
{
  assert.equal(passesTypeFilter("task", "task"), true);
  assert.equal(passesTypeFilter("issue", "task"), false);
  assert.equal(passesTypeFilter("whiteboard", "whiteboard"), true, "explicit filter still lets structural types through");
  assert.equal(passesTypeFilter("task", undefined), true, "records show with no filter");
  assert.equal(passesTypeFilter("whiteboard", undefined), false, "whiteboard hidden from an unfiltered view");
  assert.equal(passesTypeFilter("folder", undefined), false);
}

// a project with no _views defaults to a task Kanban
{
  const [v] = viewsFromObject({ id: "p1", type: "project", props: "{}" });
  assert.equal(v.layout, "kanban");
  assert.equal(v.typeFilter, "task", "default project view is scoped to tasks");
}

// retired layouts normalise to gallery on read (no DB rewrite)
{
  assert.ok(!VIEW_LAYOUTS.includes("form"), "form is gone from the layout list");
  assert.equal(VIEW_LAYOUTS.length, 5);
  const container = { id: "c", type: "collection", props: JSON.stringify({ _views: [
    { id: "a", name: "A", layout: "form" },
    { id: "b", name: "B", layout: "canvas" },
    { id: "c", name: "C", layout: "table" },
  ] }) };
  const [a, b, c] = viewsFromObject(container);
  assert.equal(a.layout, "gallery", "form -> gallery");
  assert.equal(b.layout, "gallery", "canvas -> gallery");
  assert.equal(c.layout, "table", "known layout untouched");
}

// monthGrid: Monday-first, whole weeks only (not a fixed 6), month flagged
{
  const sep = monthGrid(2026, 8); // September 2026: Tue 1st, 30 days -> 5 weeks
  assert.equal(sep.length, 35, "Sep 2026 spans 5 weeks, not 6");
  assert.equal(sep.length % 7, 0);
  assert.equal(new Date(sep[0].iso + "T00:00:00").getDay(), 1, "first cell is a Monday");
  assert.equal(sep[0].iso, "2026-08-31");
  assert.equal(sep[sep.length - 1].iso, "2026-10-04");
  assert.equal(sep.filter((cell) => cell.inMonth).length, 30, "September has 30 days");
  assert.ok(!sep[0].inMonth && !sep[sep.length - 1].inMonth, "padded on both ends");

  // A month that starts Saturday and runs 31 days needs 6 weeks.
  const may = monthGrid(2026, 4); // May 2026 starts Fri 1st -> check width is a week multiple
  assert.equal(may.length % 7, 0);
  assert.ok(may.length >= 35 && may.length <= 42);
  assert.equal(may.filter((cell) => cell.inMonth).length, 31);
}

console.log("views-parity-check: OK");
