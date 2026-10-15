// UI baseline check — two halves:
//  1. pure-logic asserts for src/core/ui/logic.ts
//  2. a repo lint: no raw <select> / <input type=date> / <datalist> outside
//     src/core/ui/ (see docs/ui-baseline.md). This half is a LINT, not a
//     security or completeness gate — a sufficiently indirect dynamic input
//     type still slips through.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  parseDate, formatDate, clampDate, withTime, normaliseTime, monthGrid,
  placePopover, filterOptions, nextOptionIndex, truncateOptions,
} from "../src/core/ui/logic.ts";

// ---------------------------------------------------------------- 1. logic
assert.equal(parseDate("27.08.2026", "pl"), "2026-08-27", "pl parse");
assert.equal(parseDate("2026-08-27", "en"), "2026-08-27", "iso passthrough");
assert.equal(parseDate("2026-13-40", "en"), null, "invalid -> null");
assert.equal(parseDate("31.02.2026", "pl"), null, "impossible day -> null");
assert.equal(parseDate("", "pl"), "", "empty -> empty");
assert.equal(formatDate("2026-08-27", "pl"), "27.08.2026", "pl format");
assert.equal(formatDate("2026-08-27T09:30", "pl"), "27.08.2026", "format strips time");
assert.equal(formatDate("", "pl"), "", "format empty");
assert.equal(parseDate(formatDate("2026-08-27", "pl"), "pl"), "2026-08-27", "pl round-trip");
assert.equal(clampDate("2026-01-01", "2026-06-01", undefined), "2026-06-01", "clamp min");
assert.equal(clampDate("2027-01-01", undefined, "2026-12-31"), "2026-12-31", "clamp max");
assert.equal(clampDate("2026-07-01", "2026-06-01", "2026-12-31"), "2026-07-01", "in range");
assert.equal(withTime("2026-08-27", "09:30"), "2026-08-27T09:30", "withTime");
assert.equal(withTime("2026-08-27T00:00", ""), "2026-08-27", "withTime clears");
assert.equal(normaliseTime("9:5"), null, "one-digit minutes -> null");
assert.equal(normaliseTime("9:05"), "09:05", "pads the hour");
assert.equal(normaliseTime("23:59"), "23:59", "upper bound ok");
assert.equal(normaliseTime("99:99"), null, "out-of-range rejected");
assert.equal(normaliseTime("24:00"), null, "hour 24 rejected");
assert.equal(normaliseTime(""), null, "empty -> null");

// placePopover keeps a tall panel reachable in a short viewport (was top=-100)
const shortWin = placePopover(
  { top: 120, left: 50, bottom: 150, right: 250, width: 200, height: 30 },
  { width: 200, height: 300 }, { width: 1000, height: 200 });
assert.ok(shortWin.top >= 8, `popover top must stay on-screen, got ${shortWin.top}`);
assert.ok(shortWin.maxHeight != null, "a panel taller than the viewport must get a maxHeight");
assert.ok(shortWin.top + shortWin.maxHeight <= 200 - 8, "panel must fit inside the bottom gutter");
assert.ok(shortWin.maxHeight >= 64, "maxHeight never collapses the panel to nothing");

// a panel that fits gets no maxHeight (existing behaviour, CSS cap untouched)
const roomy = placePopover(
  { top: 100, left: 50, bottom: 130, right: 250, width: 200, height: 30 },
  { width: 200, height: 150 }, { width: 1000, height: 800 });
assert.equal(roomy.maxHeight, undefined, "no maxHeight when the panel already fits");

const grid = monthGrid(2026, 8);
assert.equal(grid.length, 42, "month grid is 6x7");
assert.equal(grid.filter(Boolean).length, 31, "August has 31 days");
const firstIdx = grid.indexOf("2026-08-01");
assert.ok(firstIdx >= 0 && firstIdx <= 6, "the 1st sits in the first week row");
assert.equal(grid[firstIdx + 1], "2026-08-02", "days are consecutive");
assert.ok(grid.slice(0, firstIdx).every((c) => c === null), "leading cells are padding");

const below = placePopover(
  { top: 100, left: 50, bottom: 130, right: 250, width: 200, height: 30 },
  { width: 200, height: 150 }, { width: 1000, height: 800 });
assert.equal(below.placement, "bottom", "fits below");
assert.equal(below.top, 130, "bottom placement sits at anchor.bottom");
const above = placePopover(
  { top: 700, left: 50, bottom: 740, right: 250, width: 200, height: 40 },
  { width: 200, height: 150 }, { width: 1000, height: 800 });
assert.equal(above.placement, "top", "flips above when bottom overflows");
assert.equal(above.top, 550, "top placement = anchor.top - panel.height");
const clamped = placePopover(
  { top: 100, left: 950, bottom: 130, right: 990, width: 40, height: 30 },
  { width: 200, height: 100 }, { width: 1000, height: 800 });
assert.equal(clamped.left, 1000 - 200 - 8, "left clamps to viewport gutter");

assert.deepEqual(
  filterOptions([{ label: "Alpha" }, { label: "Echo" }], "lph").map((o) => o.label),
  ["Alpha"], "filter is case-insensitive substring");
assert.deepEqual(
  filterOptions([{ label: "Alpha" }, { label: "Echo" }], "E").map((o) => o.label),
  ["Echo"], "filter matches the other option too");
assert.equal(filterOptions([{ label: "x" }], "").length, 1, "empty query -> all");
assert.equal(nextOptionIndex([{}, { disabled: true }, {}], 0, 1), 2, "skip disabled");
assert.equal(nextOptionIndex([{}, {}, {}], 2, 1), 0, "wrap forward");
assert.equal(nextOptionIndex([{}, {}, {}], 0, -1), 2, "wrap back");
assert.equal(nextOptionIndex([{ disabled: true }, { disabled: true }], 0, 1), 0, "all disabled -> stay");
assert.equal(truncateOptions(Array.from({ length: 600 }, (_, i) => i)).length, 500, "cap 500");
assert.equal(truncateOptions([1, 2, 3]).length, 3, "under cap -> untouched");

console.log("ui-baseline logic: OK");

// ------------------------------------------------------------------ 2. lint
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const RAW = [/<select[\s>]/, /type=["']date["']/, /\?\s*["']date["']/, /["']date["']\s*:/, /<datalist[\s>]/];
const ALLOW = ["src/core/ui/"];
const IGNORE = ["src/components/"];

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(tsx?|jsx?)$/.test(entry) && !/\.d\.ts$/.test(entry)) acc.push(p);
  }
  return acc;
}

const hits = [];
const ledger = [];
for (const scanRoot of ["plugins/builtin", "src/core"]) {
  for (const file of walk(resolve(root, scanRoot))) {
    const rel = file.replace(/\\/g, "/").slice(root.replace(/\\/g, "/").length + 1);
    if (ALLOW.some((a) => rel.includes(a))) continue;
    const src = stripComments(readFileSync(file, "utf8"));
    if (!RAW.some((re) => re.test(src))) continue;
    if (IGNORE.some((i) => rel.includes(i))) ledger.push(rel);
    else hits.push(rel);
  }
}

if (ledger.length) console.log("ui-baseline: skipped (legacy tree, not migrated):\n  " + ledger.join("\n  "));
if (hits.length) {
  console.error(
    "ui-baseline lint FAIL — raw <select> / <input type=date> / <datalist> outside src/core/ui:\n  " +
    hits.join("\n  ") +
    "\n\nUse <Select> / <Combobox> / <DatePicker> from src/core/ui (see docs/ui-baseline.md).",
  );
  process.exit(1);
}
console.log("ui-baseline lint: OK");
