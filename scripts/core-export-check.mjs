import assert from "node:assert/strict";
import { CORE_PRINT_DEFAULTS, normalizeCorePrintOptions, printableDocument } from "../src/core/app/corePrint.ts";

// Options coming back from localStorage are untrusted: clamp, don't trust.
assert.deepEqual(normalizeCorePrintOptions(null), CORE_PRINT_DEFAULTS);
assert.equal(normalizeCorePrintOptions({ fontPt: 999 }).fontPt, 20);
assert.equal(normalizeCorePrintOptions({ fontPt: "nonsense" }).fontPt, 7);
assert.equal(normalizeCorePrintOptions({ marginMm: -5 }).marginMm, 0);
assert.equal(normalizeCorePrintOptions({ date: true }).date, true);

const options = { ...CORE_PRINT_DEFAULTS, fontPt: 12, marginMm: 25, date: true, wideImages: true };
const html = printableDocument('Raport "Q3" <b>', '<p>Hi</p><img class="core-md-image" src="data:image/png;base64,AAA">', options, new Date(0));

// Options actually reach the stylesheet.
assert.match(html, /@page \{ margin: 25mm; \}/u);
assert.match(html, /font: 12pt\/1\.5/u);
assert.match(html, /img\.core-md-image \{ display: block; width: 100%;/u);
assert.ok(printableDocument("t", "", { ...options, wideImages: false }).includes("max-width: 100%"));
assert.ok(!printableDocument("t", "", { ...options, title: false, date: false }).includes("<h1 class=\"core-print-title\""));

// Title is escaped in both the <title> and the heading; body html is not touched.
assert.ok(!html.includes("<b>"));
assert.match(html, /Raport &quot;Q3&quot; &lt;b&gt;/u);
assert.ok(html.includes('src="data:image/png;base64,AAA"'));

// Editor-only chrome must not print.
assert.match(html, /\.core-code-toolbar[^{]*\{ display: none; \}/u);

console.log("print-check ok");

// --- Plugin-contributed right-click entries -------------------------------
const { objectMenuEntries, objectMenuMatches } = await import("../src/core/app/coreCommands.ts");

const command = (id, objectMenu) => ({ id, name: id, execute: () => {}, objectMenu });
const entries = objectMenuEntries([
  {
    pluginId: "demo",
    commands: [
      command("plain"),                                                   // no objectMenu → not in the menu
      command("bad", { objectTypes: ["note"] }),                          // no label → dropped
      command("empty", { label: "" }),                                    // empty label → dropped
      command("junk", { label: "Junk", objectTypes: "note" }),            // objectTypes not an array → shown everywhere
      command("notes", { label: "Export PDF", objectTypes: ["note", 7] }), // non-string types filtered out
      command("all", { label: "Anywhere" }),
    ],
  },
]);
assert.deepEqual(entries.map((entry) => entry.command.id), ["junk", "notes", "all"]);
assert.deepEqual(entries[1].types, ["note"]);
assert.equal(entries[0].types, undefined);

assert.equal(objectMenuMatches(entries[1], "note"), true);
assert.equal(objectMenuMatches(entries[1], "project"), false);
assert.equal(objectMenuMatches(entries[2], "project"), true);
assert.deepEqual(objectMenuEntries([]), []);

console.log("object-menu-check ok");
