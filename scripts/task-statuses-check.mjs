// R4 T2 (repair plan D2): which task statuses a project shows.
//   node --experimental-strip-types scripts/task-statuses-check.mjs
import assert from "node:assert/strict";
import { NEW_PROJECT_PROPS, SIMPLE_TASK_STATUSES, shownStatuses, statusChoices } from "../plugins/builtin/task-statuses.ts";
import { WORK_MODEL_DEFINITIONS } from "../plugins/builtin/work-models.ts";

const all = WORK_MODEL_DEFINITIONS.find((model) => model.name === "task").fields.status.options;
assert.equal(all.length, 11, "the Task type keeps all 11 statuses (no data change)");
for (const status of SIMPLE_TASK_STATUSES) assert.ok(all.includes(status), `${status} is a real task status`);

// A new project shows four; one made before (no mark) or switched to "all" shows eleven.
assert.deepEqual(shownStatuses(all, { ...NEW_PROJECT_PROPS }, "task"), ["todo", "in-progress", "blocked", "done"]);
assert.deepEqual(shownStatuses(all, {}, "task"), all);
assert.deepEqual(shownStatuses(all, undefined, "task"), all);
assert.deepEqual(shownStatuses(all, { statusSet: "all" }, "task"), all);
// Only tasks: issues keep their own lifecycle.
const issue = WORK_MODEL_DEFINITIONS.find((model) => model.name === "issue").fields.status.options;
assert.deepEqual(shownStatuses(issue, { ...NEW_PROJECT_PROPS }, "issue"), issue);
// A schema without those statuses falls back to its own list.
assert.deepEqual(shownStatuses(["a", "b"], { ...NEW_PROJECT_PROPS }, "task"), ["a", "b"]);

// A picker still offers a record's own status when it is outside the shown set.
assert.deepEqual(statusChoices(["todo", "done"], "triage"), ["todo", "done", "triage"]);
assert.deepEqual(statusChoices(["todo", "done"], "Done"), ["todo", "done"]);
assert.deepEqual(statusChoices(["todo", "done"], ""), ["todo", "done"]);

console.log("task-statuses-check: ok");
