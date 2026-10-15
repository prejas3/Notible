// Audit of Core's own clickable controls: geometry divergence and the layout
// shape that makes a control change size with application state.
//
// This exists because of a real report: in Settings → Updates the buttons grew
// when an update was found. The cause was not the container growing — a second
// button crowded the row, flex shrank both (`flex-shrink: 1` is the default),
// their labels wrapped to two lines, and `min-block-size` let them grow from
// 36px to ~52px. Height was the symptom; wrapping was the mechanism.
//
// A REPORT, not a gate. Static analysis cannot know which control ever lands
// in a crowded row, so failing the build on every candidate would be noise.
// What it can do is put the numbers in front of a person: run
// `npm run audit:controls`, read the top of the list, decide.
//
// Scope note: `plugins/builtin` went through this in 0.50.0 and now shares
// `surface.css`. Core never did, and keeps its own `.core-button*` set.
import { readFileSync } from "node:fs";

const CSS_PATH = "src/core/app/core-only.css";
// Comments are stripped before parsing: this file explains itself heavily, and
// a comment sitting above a rule otherwise lands in the reported selector and
// makes the output unreadable.
const css = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ selector: match[1].trim().replace(/\s+/g, " "), body: match[2] }))
  // A comment before a rule is captured into the selector; keep the last line,
  // which is the selector proper.
  .map((rule) => ({ ...rule, selector: rule.selector.split("\n").pop().trim() }))
  .filter((rule) => !rule.selector.startsWith("@") && !rule.selector.startsWith("*/"));

/**
 * The LAST declaration wins, not the first: rules of equal specificity resolve
 * by order, so a later grouped rule overrides an earlier one. Reading the first
 * match reported a value the browser does not use — and showed a unification as
 * if it had never happened.
 */
const declaration = (body, property) => {
  const matches = [...body.matchAll(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`, "g"))];
  return matches.length > 0 ? matches[matches.length - 1][1].trim() : null;
};

/**
 * Declarations reach a selector from every rule that names it, not only from
 * the rule that first defined it — a grouped rule elsewhere in the file counts.
 *
 * The first version of this audit read each rule's own body, and so reported
 * "30 of 31 missing" immediately after a grouped rule had fixed all of them.
 * A metric that cannot see the fix is worse than no metric: it would have sent
 * someone to re-fix work already done, or taught them to ignore the number.
 */
const declarationsFor = (selector) => rules
  .filter((rule) => rule.selector.split(",").map((part) => part.trim()).includes(selector))
  .map((rule) => rule.body)
  .join(";");

const controls = rules
  .flatMap((rule) => rule.selector.split(",").map((part) => part.trim()).map((selector) => ({ selector, body: rule.body })))
  .filter((rule) => /cursor:\s*pointer/.test(rule.body) && /padding|border-radius/.test(rule.body))
  .filter((rule, index, all) => all.findIndex((other) => other.selector === rule.selector) === index)
  .map((rule) => ({ selector: rule.selector, body: declarationsFor(rule.selector) }));

const grouped = (property) => {
  const buckets = new Map();
  for (const control of controls) {
    const value = declaration(control.body, property);
    if (!value) continue;
    if (!buckets.has(value)) buckets.set(value, []);
    buckets.get(value).push(control.selector);
  }
  return [...buckets.entries()].sort((left, right) => right[1].length - left[1].length);
};

console.log(`Core control audit — ${CSS_PATH}`);
console.log(`${controls.length} clickable controls\n`);

for (const [property, label] of [["border-radius", "shape"], ["padding", "size"]]) {
  const buckets = grouped(property);
  console.log(`${property}: ${buckets.length} distinct values (${label})`);
  for (const [value, selectors] of buckets) {
    const marker = selectors.length === 1 ? "  (one-off)" : "";
    console.log(`  ${value.padEnd(22)} ×${String(selectors.length).padEnd(3)} ${selectors.slice(0, 3).join(", ")}${marker}`);
  }
  console.log("");
}

// The wrap risk. A control whose label may wrap can grow taller the moment
// anything crowds its row — which is exactly what the Updates section did.
const wrapRisk = controls.filter((control) => !/white-space:\s*nowrap/.test(control.body));
console.log(`white-space: nowrap missing on ${wrapRisk.length} of ${controls.length} controls`);
console.log("  A label that can wrap can make its control grow when the row gets crowded.");
for (const control of wrapRisk.slice(0, 12)) console.log(`  - ${control.selector}`);
if (wrapRisk.length > 12) console.log(`  … and ${wrapRisk.length - 12} more`);
console.log("");

// The other half: a flex row that lets its children shrink is where that
// wrapping gets triggered.
const flexRows = rules.filter((rule) =>
  /display:\s*flex/.test(rule.body) && !/flex-direction:\s*column/.test(rule.body));
const pinned = flexRows.filter((rule) => /flex:\s*none|flex-shrink:\s*0/.test(rule.body));
console.log(`flex rows: ${flexRows.length}, of which ${pinned.length} pin their children`);
console.log("  A row that neither pins children nor allows wrapping resolves crowding by squeezing.");
