import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compareCodeLines, splitComparisonSource } from "../plugins/builtin/editor-extensions.ts";

assert.deepEqual(splitComparisonSource("one\n=====\ntwo"), ["one", "two", true]);
assert.deepEqual(splitComparisonSource("one"), ["one", "", false]);
assert.deepEqual(compareCodeLines("same\nbefore\ngone", "same\nafter\nnew"), [
  { left: "same", right: "same", kind: "same" },
  { left: "before", right: "after", kind: "changed" },
  { left: "gone", right: "new", kind: "changed" },
]);
assert.deepEqual(compareCodeLines("same", "same\nadded"), [
  { left: "same", right: "same", kind: "same" },
  { right: "added", kind: "added" },
]);
assert.equal(compareCodeLines(Array.from({ length: 1001 }, (_, index) => String(index)).join("\n"), Array.from({ length: 1000 }, (_, index) => String(index)).join("\n")), null);

const css = readFileSync(fileURLToPath(new URL("../src/core/app/core-only.css", import.meta.url)), "utf8");
assert.match(css, /li:not\(\.is-empty\)::before\s*\{[^}]*counter-increment:\s*code-line/u, "line numbers must skip placeholder rows");
assert.match(css, /\.core-code-comparison\s*\{[^}]*container-type:\s*inline-size/u, "comparison block must establish an inline-size container");
assert.match(css, /@container\s*\(max-width:\s*620px\)/u, "comparison panes must stack from their container width");

console.log("Editor extensions checks passed: comparison split, alignment, marks, line numbers, container stacking and 2,000-line cap.");
