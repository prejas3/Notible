import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const builtinRoot = resolve(root, "plugins/builtin");
const fail = (message) => { console.error(`typewriter check FAILED: ${message}`); process.exit(1); };

// --- pure model helpers ---------------------------------------------------
const { wordCount, aggregateSubtree, singletonRepair, wordsPerDay, wordsWrittenOn, writingStreak, buildHeatmapWeeks, inManuscript, sceneReadingRank, renumberFootnotes } =
  await import(pathToFileURL(join(builtinRoot, "typewriter-model.ts")).href);

assert.equal(wordCount([{ text: "one two three" }, { text: "  " }, { text: "four" }]), 4);
assert.equal(wordCount([]), 0);
assert.equal(wordCount([{ text: "# Heading here" }]), 2, "strips a leading '# '");
assert.equal(wordCount([{ text: "- a dialogue line" }]), 3, "strips a leading '- '");

const rows = [
  { id: "m", parentId: null, words: 0 },
  { id: "c1", parentId: "m", words: 0 },
  { id: "s1", parentId: "c1", words: 100 },
  { id: "s2", parentId: "c1", words: 250 },
  { id: "s3", parentId: "m", words: 40 },
];
assert.deepEqual(aggregateSubtree(rows, "m"), { words: 390, scenes: 3 });
assert.deepEqual(aggregateSubtree(rows, "c1"), { words: 350, scenes: 2 });
assert.deepEqual(aggregateSubtree([
  { id: "empty-chapter", parentId: "book", words: 0, isScene: false },
  { id: "chapter", parentId: "book", words: 100, isScene: false },
  { id: "empty-scene", parentId: "chapter", words: 0, isScene: true },
], "book"), { words: 100, scenes: 1 }, "empty chapters are not scenes; chapter prose still contributes words");

assert.deepEqual(
  singletonRepair([{ toId: "z" }, { toId: "a" }, { toId: "m" }]),
  { keep: { toId: "a" }, drop: [{ toId: "m" }, { toId: "z" }] },
);
assert.deepEqual(singletonRepair([]), { keep: null, drop: [] });

assert.equal(wordsPerDay(0, 0, "2026-08-27", "2026-08-27"), null);
assert.equal(wordsPerDay(9000, 10000, "2026-08-27", "2026-08-27"), 0, "deadline today -> 0");
assert.equal(wordsPerDay(0, 8500, "2026-09-06", "2026-08-27"), 850, "8500 / 10 days");
assert.equal(wordsPerDay(10000, 8000, "2026-12-01", "2026-08-27"), 0, "already over target");

// wordsWrittenOn / writingStreak: cumulative daily totals -> deltas -> streak.
{
  const log = { "2026-09-20": 1000, "2026-09-21": 1400, "2026-09-22": 1400 };
  assert.equal(wordsWrittenOn(log, "2026-09-21"), 400);
  assert.equal(wordsWrittenOn(log, "2026-09-22"), 0, "flat day counts as zero, not null");
  assert.equal(wordsWrittenOn(log, "2026-09-20"), null, "no prior day to diff against");
  assert.equal(wordsWrittenOn(log, "2026-09-19"), null, "no entry that day at all");
  assert.equal(writingStreak(log, "2026-09-21"), 1, "one day of growth");
  assert.equal(writingStreak(log, "2026-09-22"), 0, "today is flat -> streak broken");
  assert.equal(writingStreak({}, "2026-09-22"), 0, "empty log");
  assert.equal(
    writingStreak({ "2026-09-20": 100, "2026-09-21": 200, "2026-09-22": 350 }, "2026-09-22"),
    2,
    "two consecutive growing days",
  );
  assert.equal(
    writingStreak({ "2026-09-18": 100, "2026-09-20": 300, "2026-09-21": 400, "2026-09-22": 500 }, "2026-09-22"),
    2,
    "gap on the 19th stops the streak from reaching the 18th",
  );
}

// buildHeatmapWeeks: column-major Mon..Sun weeks ending on today's week.
{
  // 2026-09-22 is a Tuesday, so its week runs Mon 2026-09-21 .. Sun 2026-09-27.
  const oneWeek = buildHeatmapWeeks({}, "2026-09-22", 1);
  assert.equal(oneWeek.length, 1);
  assert.equal(oneWeek[0].length, 7);
  assert.equal(oneWeek[0][0].date, "2026-09-21", "column starts on Monday");
  assert.equal(oneWeek[0][6].date, "2026-09-27", "column ends on Sunday");
  assert.equal(oneWeek[0][0].words, null, "no log entry -> null, not zero");

  const twoWeeks = buildHeatmapWeeks(
    { "2026-09-13": 100, "2026-09-14": 250 },
    "2026-09-22",
    2,
  );
  assert.equal(twoWeeks.length, 2);
  assert.equal(twoWeeks[0][0].date, "2026-09-14", "older week is first (oldest-first)");
  assert.equal(twoWeeks[0][0].words, 150, "matches wordsWrittenOn for that date");
}

assert.equal(inManuscript(JSON.stringify({ "tw.manuscriptId": "m1" }), "m1"), true);
assert.equal(inManuscript(JSON.stringify({ "tw.manuscriptId": "other" }), "m1"), false);
assert.equal(inManuscript("not json", "m1"), false);

// sceneReadingRank: chapter order, then scene order within, then loose last.
{
  const containers = [
    { id: "m", parentId: null, order: 0 },
    { id: "c2", parentId: "m", order: 200 },
    { id: "c1", parentId: "m", order: 100 },
  ];
  const scenes = [
    { id: "s-c2-a", parentId: "c2", order: 100 },
    { id: "s-c1-b", parentId: "c1", order: 200 },
    { id: "s-c1-a", parentId: "c1", order: 100 },
    { id: "loose", parentId: "gone", order: 5 },
  ];
  const rank = sceneReadingRank(scenes, containers);
  assert.deepEqual(
    [...rank.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id),
    ["s-c1-a", "s-c1-b", "s-c2-a", "loose"],
  );
}
{
  // Compile: two scenes that each start their notes at [^1] must not collide.
  const { scenes, notes } = renumberFootnotes([
    ["Rain fell.[^1] Then wind.[^2]", "", "[^1]: Chronicle, p. 4", "[^2]: Diary"],
    ["Dawn.[^1]", "Again.[^1]", "[^1]: Source https://example.org/a"],
    ["No notes here."],
  ]);
  assert.deepEqual(scenes[0], ["Rain fell.[^1] Then wind.[^2]", ""]);
  assert.deepEqual(scenes[1], ["Dawn.[^3]", "Again.[^3]"], "same label reused in one scene stays one note");
  assert.deepEqual(scenes[2], ["No notes here."]);
  assert.deepEqual(notes, ["[^1]: Chronicle, p. 4", "[^2]: Diary", "[^3]: Source https://example.org/a"]);
  assert.deepEqual(renumberFootnotes([["Orphan.[^9]"]]).notes, ["[^1]:"], "a marker without a definition still gets a numbered (empty) note");
}
console.log("typewriter model helpers OK");

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// --- lint: the Typewriter plugin never touches HTML sinks -------------------
const SINKS = [
  /\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML/, /dangerouslySetInnerHTML/,
  /parseFromString\s*\(/, /createContextualFragment/, /\.setHTML\s*\(/, /<iframe[^>]*srcdoc/,
  /\[[^\]]*HTML[^\]]*\]\s*=/,
];
const RAW_CONTROLS = [/<select[\s>]/, /type=["']date["']/, /<datalist[\s>]/];

const codeFiles = readdirSync(builtinRoot)
  .filter((name) => /^typewriter.*\.(ts|tsx)$/.test(name))
  .map((name) => join(builtinRoot, name));
if (codeFiles.length === 0) fail("no plugins/builtin/typewriter*.{ts,tsx} files found");

for (const file of codeFiles) {
  const source = stripComments(readFileSync(file, "utf8"));
  for (const pattern of SINKS) {
    if (pattern.test(source)) fail(`${file} matches HTML sink ${pattern}`);
  }
  for (const pattern of RAW_CONTROLS) {
    if (pattern.test(source)) fail(`${file} uses a raw form control ${pattern} — import from src/core/ui`);
  }
}

// --- lint: typewriter.css uses only var(--notible-*) colours ---------------
const cssPath = join(builtinRoot, "typewriter.css");
const css = stripComments(readFileSync(cssPath, "utf8"));
for (const line of css.split("\n")) {
  if (/box-shadow\s*:/.test(line)) continue; // translucent black shadows are allowed
  const colour = line.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  if (colour) fail(`typewriter.css colour literal "${colour[0]}" — use var(--notible-*)`);
}

// --- regression: manuscript rows keep one typographic system and useful meters
const manuscriptUi = readFileSync(join(builtinRoot, "typewriter-ui.tsx"), "utf8");
const typewriterPlugin = readFileSync(join(builtinRoot, "typewriter.ts"), "utf8");
for (const status of ["Idea", "Draft", "Revised", "Final"]) {
  if (!manuscriptUi.includes(`label: t("${status}")`)) {
    fail(`scene status ${status} is not presented through a capitalised translation`);
  }
}
if (!manuscriptUi.includes('className="tw-row-meter"')) {
  fail("manuscript rows no longer render the word progress meter");
}
for (const kind of ["part", "chapter", "scene"]) {
  const selector = `.tw-row[data-tw-kind="${kind}"] .tw-row-title`;
  const start = css.indexOf(`${selector} {`);
  const rule = start >= 0 ? css.slice(start, css.indexOf("}", start)) : "";
  if (!rule.includes("font-family: var(--notible-font-serif)")) {
    fail(`${selector} does not use the shared Typewriter serif family`);
  }
}
// Core fades every container slot in; a second Typewriter-side fade made tab switches blink.
if (css.includes("@keyframes tw-page-turn-in")) fail("Typewriter must not stack its own page fade on Core's slot fade");
if (!typewriterPlugin.includes('{ types: [`${NS}part`, `${NS}chapter`, `${NS}scene`] }')) {
  fail("focus mode is not registered for every manuscript writing level");
}

// --- lint: every literal className is defined in an imported stylesheet ----
// (builtin-surface-style-check only scans *-ui.tsx / ^[A-Z]*.tsx; typewriter-
//  codex.tsx matches neither, so cover it here.)
const classesInCss = (css) => new Set([...css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));
const known = new Set([
  ...classesInCss(readFileSync(join(builtinRoot, "typewriter.css"), "utf8")),
  ...classesInCss(readFileSync(join(builtinRoot, "surface.css"), "utf8")),
]);
for (const file of codeFiles) {
  const source = readFileSync(file, "utf8");
  for (const [, value] of source.matchAll(/className="([^"{]+)"/g)) {
    for (const cls of value.trim().split(/\s+/)) {
      if (!known.has(cls)) fail(`${file}: .${cls} is not defined in typewriter.css or surface.css`);
    }
  }
}

// The guard must still be able to fail.
if (!SINKS.some((p) => p.test('el.innerHTML = x'))) fail("sink guard is disarmed");

console.log(`typewriter check OK (${codeFiles.length} source files linted)`);
