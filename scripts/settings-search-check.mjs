/**
 * Every Settings section has to be findable from the search box.
 *
 * SETTINGS_INDEX is written by hand — on purpose, because people search for
 * what they want ("dark", "kopia", "images") and not for our headings, so the
 * keywords cannot be scraped from the JSX. The cost of writing it by hand is
 * that it rots silently: a new section is added, nobody adds a row, and the
 * search quietly cannot reach it. Nothing about that failure is visible.
 *
 * This is the guard. It reads the two literals out of the source rather than
 * importing them, because CoreOnlyApp.tsx is .tsx and node's type stripping
 * does not load JSX.
 *
 * node scripts/settings-search-check.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = readFileSync(resolve(root, "src/core/app/CoreOnlyApp.tsx"), "utf8");

const unionMatch = /type CoreSettingsSection = ([^;]+);/u.exec(source);
assert.ok(unionMatch, "CoreSettingsSection union not found — did the type move or get renamed?");
const sections = [...unionMatch[1].matchAll(/"([a-z-]+)"/gu)].map((match) => match[1]);
assert.ok(sections.length >= 8, `only ${sections.length} settings sections parsed; the regex is probably wrong`);

const indexStart = source.indexOf("const SETTINGS_INDEX");
assert.ok(indexStart > 0, "SETTINGS_INDEX not found");
const indexBody = source.slice(indexStart, source.indexOf("\n];", indexStart));
const indexed = new Set([...indexBody.matchAll(/section:\s*"([a-z-]+)"/gu)].map((match) => match[1]));

// Sections that are a container for other plugins' panels rather than a
// destination of their own: there is nothing to describe and nothing a person
// would type to reach them by name.
const NOT_A_DESTINATION = new Set(["plugin-sections"]);

const missing = sections.filter((section) => !indexed.has(section) && !NOT_A_DESTINATION.has(section));
assert.deepEqual(missing, [], `these Settings sections cannot be found from search: ${missing.join(", ")}`);

const unknown = [...indexed].filter((section) => !sections.includes(section));
assert.deepEqual(unknown, [], `SETTINGS_INDEX points at sections that no longer exist: ${unknown.join(", ")}`);

// Every row needs the words people actually type, or it is only findable by
// its own heading — which is the thing that did not work before.
const rows = [...indexBody.matchAll(/label:\s*(?:tr\()?"([^"]+)"\)?,\s*hint:\s*(?:tr\()?"([^"]+)"\)?,\s*keywords:\s*"([^"]+)"/gu)];
assert.ok(rows.length >= indexed.size, "a SETTINGS_INDEX row is missing label, hint or keywords");
for (const [, label, hint, keywords] of rows) {
  assert.ok(hint.length > 3, `${label}: hint is too short to tell you where you are going`);
  assert.ok(keywords.split(" ").length >= 4, `${label}: too few keywords to be findable`);
  assert.ok(keywords === keywords.toLowerCase(), `${label}: keywords are matched lower-cased, so they must be written that way`);
}

console.log(`Settings search checks passed: ${sections.length} sections, ${rows.length} searchable rows.`);
