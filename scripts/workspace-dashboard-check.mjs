// Guards the one thing that actually broke: the workspace dashboard's list of
// "closed" statuses drifting away from the status options the builtin type
// schemas ship, which left items closed as e.g. "closed" counted as overdue
// for ever. Source-level on purpose — the view module imports CSS, so it
// cannot be imported from node.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync("plugins/builtin/workspace-dashboard-ui.ts", "utf8");
const listed = view.match(/const DONE_STATUSES = new Set\(\[([\s\S]*?)\]\)/);
assert.ok(listed, "DONE_STATUSES literal not found");
const closed = new Set([...listed[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));

// Every status option any builtin type offers that means "no longer open".
const MEANS_CLOSED = /^(done|completed?|closed|resolved|cancell?ed|archived)$/;
const schemas = ["work-models.ts", "planning.ts", "finance.ts"]
  .map((file) => readFileSync(`plugins/builtin/${file}`, "utf8"))
  .join("\n");
const options = [...schemas.matchAll(/status: \{ type: "select", options: \[([^\]]*)\]/g)]
  .flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((option) => option[1]));
assert.ok(options.length > 0, "no status option lists found in the builtin schemas");

for (const option of options) {
  if (!MEANS_CLOSED.test(option)) continue;
  assert.ok(closed.has(option), `status "${option}" is shipped by a builtin type but the workspace dashboard still counts it as open`);
}

// isDone normalises before the lookup, so the set itself must stay normalised.
for (const status of closed) assert.equal(status, status.trim().toLowerCase().replace(/[\s_]+/g, "-"));

// CONFLICT-COPY-HIDE (Hive #1): the title pattern must match what Sync and
// Teams actually write, and the filter must be applied to `everything`.
const pattern = view.match(/export const isConflictCopy = .*?\/(.+?)\/\.test/);
assert.ok(pattern, "isConflictCopy not found");
const isCopy = (title) => new RegExp(pattern[1]).test(title);
for (const file of ["plugins/notible-sync/main.js", "plugins/notible-sync-simple/main.js", "plugins/notible-teams/main.js"]) {
  assert.match(readFileSync(file, "utf8"), /\(conflict copy/, `${file} no longer writes "(conflict copy" -- update isConflictCopy`);
}
assert.ok(isCopy("Notible (conflict copy, Alex Doe)"));
assert.ok(isCopy("Plan (conflict copy)"));
assert.ok(isCopy("Plan (conflict copy — Laptop, 03.10.2026"), "truncated Sync title");
assert.ok(!isCopy("Notible"));
assert.ok(!isCopy("Resolving a conflict copy storm"));
assert.match(view, /descendantsOf\(containerId\)\)\.filter\(\(object\) => !isConflictCopy\(object\.title\)\)/, "dashboard no longer filters conflict copies");

console.log(`workspace-dashboard check ok (${closed.size} closed statuses, ${options.length} schema options)`);
