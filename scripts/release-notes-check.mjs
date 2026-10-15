// Release notes for latest.json come only from the section of the version being released.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UPDATE_NOTES_LIMIT, releaseNotesSection, shortNotes } from "./release-notes.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const sample = "# Notes\n\n## 2.0.0\n\nNew thing.\n\n## 1.9.0\n\nOld thing.\n";

assert.equal(releaseNotesSection(sample, "2.0.0"), "New thing.", "the section of the requested version only");
assert.equal(releaseNotesSection(sample, "1.9.0"), "Old thing.", "an older version gets its own section");
assert.throws(() => releaseNotesSection(sample, "2.1.0"), /has no "## 2\.1\.0" section/, "a missing section fails loudly");
assert.throws(() => releaseNotesSection("## 2.0.0\n\n## 1.9.0\n\nOld.", "2.0.0"), /is empty/, "an empty section fails loudly");
assert.throws(() => releaseNotesSection("## 2.0.01\n\nX.\n", "2.0.0"), /has no/, "a longer version number is not a match");
assert.throws(() => releaseNotesSection("## 2.0.0 - Title\n\nX.\n", "2.0.0"), /has no/, "a title after the number is not a match");
assert.equal(releaseNotesSection("## 2.0.0\r\n\r\nNew.\r\n## 1.9.0\r\n", "2.0.0"), "New.", "CRLF line endings give the same section");

assert.equal(shortNotes("short"), "short", "text within the limit is kept as it is");
const long = Array.from({ length: 40 }, (_, index) => `- item ${index} ${"x".repeat(60)}`).join("\n");
const cut = shortNotes(long, 300);
assert.ok(cut.length <= 300, `cut text fits the limit (${cut.length})`);
assert.ok(cut.endsWith("…") && cut.split("\n").slice(0, -1).every((line) => long.split("\n").includes(line)), "a cut keeps whole lines and ends with …");
assert.ok(shortNotes("y".repeat(500) + " tail", 100).length <= 100, "one long line is cut at a word, still within the limit");
assert.ok(shortNotes("- line\n".repeat(2000)).length <= UPDATE_NOTES_LIMIT, "text over the default cap is still cut to it");

const real = readFileSync(new URL("../docs/RELEASE_NOTES.md", import.meta.url), "utf8");
const section = releaseNotesSection(real, pkg.version);
const current = shortNotes(section);
assert.ok(section.startsWith(current.replace(/\n…$/u, "")), "the shipped text is the start of this version's own section");
assert.ok(current.length <= UPDATE_NOTES_LIMIT, "the current release's notes fit the updater dialog");
assert.ok(!/^## /m.test(current), "the notes hold no other release heading");
assert.ok(!current.includes("0.77.5"), "the notes never carry the 0.77.5 changelog that latest.json shipped with");

console.log(`release-notes check: ok (${pkg.version}: ${current.length} characters)`);
