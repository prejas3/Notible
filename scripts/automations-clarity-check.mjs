import assert from "node:assert/strict";
import { describeRule, isUnusedValue, lastRunOf, operatorsFor } from "../plugins/builtin/automations-describe.ts";
import { parsePluginAutomationRules, previewRuleMatches, runDueDateReachedRules, runDueRecurringRules, runRuleNow } from "../plugins/builtin/automations.ts";

const NOW = new Date("2026-09-19T10:00:00");
const rec = (props, id = "x") => ({ id, type: "task", title: id, props: JSON.stringify(props), created_at: 0, updated_at: 0, parent_id: "P" });
const cond = (field, operator, value) => ({ kind: "group", combinator: "and", children: [{ kind: "condition", field, operator, value }] });
const mk = (trigger, conditions, actions = [{ id: "a1", type: "set_property", field: "status", value: "closed" }]) =>
  parsePluginAutomationRules([{ id: "r1", version: 2, name: "R", enabled: true, trigger, conditions, actions, stopOnError: true }])[0];
const count = (rule, records) => previewRuleMatches(rule, records, NOW).length;

// Date operators: lt/gt used to be numeric-only and silently false on dates.
const past = rec({ due: "2026-09-18" });
assert.equal(count(mk({ type: "manual" }, cond("due", "lt", "2026-09-19")), [past]), 1);
assert.equal(count(mk({ type: "manual" }, cond("due", "before", "2026-09-19")), [past]), 1);
assert.equal(count(mk({ type: "manual" }, cond("due", "after", "2026-09-19")), [past]), 0);
assert.equal(count(mk({ type: "manual" }, cond("due", "gt", "2026-09-01")), [past]), 1);
assert.equal(count(mk({ type: "manual" }, cond("due", "before", "2026-09-19")), [rec({})]), 0, "missing date never matches");
// Numbers still work; empty is not 0.
assert.equal(count(mk({ type: "manual" }, cond("n", "gt", "3")), [rec({ n: 5 })]), 1);
assert.equal(count(mk({ type: "manual" }, cond("n", "lt", "3")), [rec({})]), 0);

// Tags.
const tagged = rec({ tags: ["0.17 fix", "UI"] });
assert.equal(count(mk({ type: "manual" }, cond("tags", "has_tag", "0.17 fix")), [tagged]), 1);
assert.equal(count(mk({ type: "manual" }, cond("tags", "has_tag", "ui")), [tagged]), 1, "case-insensitive");
assert.equal(count(mk({ type: "manual" }, cond("tags", "has_tag", "0.17")), [tagged]), 0, "whole tag, not substring");
assert.equal(count(mk({ type: "manual" }, cond("tags", "not_has_tag", "bug")), [tagged]), 1);
assert.equal(count(mk({ type: "manual" }, cond("tags", "equals", "0.17 fix")), [rec({ tags: ["0.17 fix"] })]), 1, "legacy equals still works");

// Preview ignores the trigger event but honours the date and the property gate.
assert.equal(count(mk({ type: "date_reached", field: "due" }, undefined), [past, rec({ due: "2026-09-25" }, "future")]), 1);
assert.equal(count(mk({ type: "property_changed", field: "status", value: "done" }, undefined), [rec({ status: "done" }), rec({ status: "open" }, "o")]), 1);
assert.equal(count(mk({ type: "record_created" }, cond("status", "equals", "pending")), [rec({ status: "Pending" }), rec({ status: "done" }, "d")]), 1);

// Run now applies to every matching record and logs once per record.
const objects = new Map();
let n = 1;
const put = (o) => { objects.set(o.id, o); return o; };
put({ id: "P", type: "project", title: "P", props: "{}", created_at: 1, updated_at: 1, parent_id: null });
const context = {
  data: {
    objects: {
      get: async (id) => objects.get(id) ?? null,
      update: async (id, patch) => { const cur = objects.get(id); const next = { ...cur, ...patch, updated_at: cur.updated_at + 1 }; objects.set(id, next); return next; },
      create: async (i) => put({ id: `o${n++}`, type: i.type, title: i.title, props: i.props ?? "{}", created_at: 1, updated_at: 1, parent_id: i.parentId ?? null }),
      query: async (q = {}) => [...objects.values()].filter((o) => !q.parentId || o.parent_id === q.parentId),
    },
    relations: { create: async () => ({}) },
  },
  notifications: { show: async () => {} },
};
const t1 = put({ ...rec({ status: "pending", due: "2026-09-18" }, "t1") });
const t2 = put({ ...rec({ status: "pending", due: "2026-09-10" }, "t2") });
const t3 = put({ ...rec({ status: "done", due: "2026-09-10" }, "t3") });
const rule = mk({ type: "date_reached", field: "due" }, cond("status", "equals", "pending"));
const matches = previewRuleMatches(rule, [t1, t2, t3], NOW);
assert.deepEqual(matches.map((m) => m.id), ["t1", "t2"]);
const logs = await runRuleNow(context, "P", rule, matches);
assert.equal(logs.length, 2);
assert.equal(JSON.parse(objects.get("t1").props).status, "closed");
assert.equal(JSON.parse(objects.get("t2").props).status, "closed");
assert.equal(JSON.parse(objects.get("t3").props).status, "done");
assert.equal(JSON.parse(objects.get("P").props)._automationLog.length, 2);
assert.equal(previewRuleMatches(rule, [objects.get("t1"), objects.get("t2"), objects.get("t3")], NOW).length, 0, "nothing left to apply");

// Recurring with target "records" acts on matching child records; the rule itself is left alone.
const R = put({ id: "R", type: "project", title: "R", props: "{}", created_at: 1, updated_at: 1, parent_id: null });
put({ ...rec({ status: "pending" }, "r1"), parent_id: "R" });
put({ ...rec({ status: "done" }, "r2"), parent_id: "R" });
const recurring = mk({ type: "recurring", frequency: "daily", interval: 1, target: "records" }, cond("status", "equals", "pending"));
objects.set("R", { ...R, props: JSON.stringify({ _automations: [recurring] }) });
await runDueRecurringRules(context, new Map(), new Set());
assert.equal(JSON.parse(objects.get("r1").props).status, "closed");
assert.equal(JSON.parse(objects.get("r2").props).status, "done");
assert.equal(JSON.parse(objects.get("R").props)._automations[0].trigger.target, "records");

// Operators offered per field type.
assert.deepEqual(operatorsFor("date"), ["before", "after", "today", "overdue", "empty"]);
assert.deepEqual(operatorsFor("tags"), ["has_tag", "not_has_tag", "empty", "not_empty"]);
assert.ok(operatorsFor("date", "gte").includes("gte"), "a saved legacy operator stays selectable");

// The rule reads as one sentence.
const labels = { due: "Due", status: "Status", tags: "Tags" };
const d = { t: (key, values) => key.replace(/\{(\w+)\}/g, (w, k) => String(values?.[k] ?? w)), fieldLabel: (id) => labels[id] ?? id };
const sentence = describeRule(mk({ type: "date_reached", field: "due" }, {
  kind: "group", combinator: "and", children: [
    { kind: "condition", field: "status", operator: "equals", value: "Pending" },
    { kind: "condition", field: "tags", operator: "has_tag", value: "0.17 fix" },
  ],
}), d);
assert.equal(sentence, "When Due arrives or has passed, only if Status is Pending and Tags has tag 0.17 fix: set Status to closed.");
assert.equal(describeRule(mk({ type: "manual" }, undefined, [{ id: "n", type: "notify", title: "Hi" }]), d), 'When you press Run: send notification "Hi".');
assert.equal(describeRule(mk({ type: "recurring", frequency: "weekly", interval: 2 }, undefined), d), "Every 2 weeks: set Status to closed.");

// Unused-value warning only for small closed sets.
assert.equal(isUnusedValue("resolved", ["pending", "done", "closed"]), true);
assert.equal(isUnusedValue("Closed", ["pending", "done", "closed"]), false);
assert.equal(isUnusedValue("{{today}}", ["a"]), false);
assert.equal(isUnusedValue("x", []), false, "no data, no opinion");

// Last-run state comes from the log.
assert.equal(lastRunOf("r1", []), null);
const at = 1_800_000_000_000;
const entry = (status, occurredAt, ruleId = "r1") => ({ id: `${occurredAt}${status}`, ruleId, ruleName: "R", objectId: "x", objectTitle: "x", event: "manual", status, message: "", occurredAt, executionKey: "k" });
assert.deepEqual(lastRunOf("r1", [entry("success", at), entry("success", at - 5), entry("error", at - 9), entry("success", at - 3_600_000), entry("success", at, "other")]), { at, ok: 2, failed: 1 });

// Execution log: every entry says where it came from, how long it took and what each step did.
put({ ...rec({ status: "pending", due: "2026-09-18" }, "L1"), parent_id: "P" });
put({ ...rec({ status: "pending", due: "2026-09-18" }, "L2"), parent_id: "P" });
const logRule = mk({ type: "date_reached", field: "due" }, cond("status", "equals", "pending"));
const logEntries = await runRuleNow(context, "P", logRule, [objects.get("L1"), objects.get("L2")]);
assert.equal(logEntries[0].source, "run-now");
assert.ok(logEntries[0].runId && logEntries[0].runId === logEntries[1].runId, "one run, one runId");
assert.equal(logEntries[0].objectType, "task");
assert.equal(logEntries[0].containerId, "P");
assert.equal(typeof logEntries[0].durationMs, "number");
assert.equal(typeof logEntries[0].startedAt, "number");
assert.equal(logEntries[0].steps.length, 1);
assert.equal(logEntries[0].steps[0].status, "ok");
assert.equal(logEntries[0].steps[0].detail, "status: pending → closed");

// A failing action carries its error name, message and a short stack; stopOnError skips the rest.
const failing = { ...context, data: { ...context.data, objects: { ...context.data.objects, create: async () => { throw new Error("disk full"); } } } };
const twoActions = [{ id: "f1", type: "create_record", objectType: "task", title: "x" }, { id: "f2", type: "set_property", field: "status", value: "closed" }];
put({ ...rec({ status: "pending" }, "F1"), parent_id: "P" });
const [failed] = await runRuleNow(failing, "P", mk({ type: "manual" }, undefined, twoActions), [objects.get("F1")]);
assert.equal(failed.status, "error");
assert.equal(failed.steps[0].status, "error");
assert.equal(failed.steps[0].error.name, "Error");
assert.match(failed.steps[0].error.message, /disk full/);
assert.ok(failed.steps[0].error.stack.length <= 400);
assert.equal(failed.steps[1].status, "skipped", "stopOnError skips the rest");
assert.ok(failed.ruleSnapshot?.actions?.length === 2, "error entries keep the rule as it was run");
const tolerant = mk({ type: "manual" }, undefined, twoActions); tolerant.stopOnError = false;
put({ ...rec({ status: "pending" }, "F2"), parent_id: "P" });
const [kept] = await runRuleNow(failing, "P", tolerant, [objects.get("F2")]);
assert.deepEqual(kept.steps.map((step) => step.status), ["error", "ok"]);

// A container whose records cannot be read used to fail silently; now the log says so.
put({ id: "BAD", type: "project", title: "BAD", props: JSON.stringify({ _automations: [mk({ type: "date_reached", field: "due" }, undefined)] }), created_at: 1, updated_at: 1, parent_id: null });
const brokenQuery = { ...context, data: { ...context.data, objects: { ...context.data.objects, query: async (q = {}) => { if (q.parentId === "BAD") throw new Error("query failed"); return context.data.objects.query(q); } } } };
await runDueDateReachedRules(brokenQuery, new Map(), new Set());
const badLog = JSON.parse(objects.get("BAD").props)._automationLog;
assert.equal(badLog[0].status, "error");
assert.equal(badLog[0].source, "schedule");
assert.match(badLog[0].message, /query failed/);

// The 15-minute check meets a reached due date again every time; the repeat must
// not rewrite the project (each rewrite became a sync conflict copy).
put({ id: "DUE", type: "project", title: "DUE", props: JSON.stringify({ _automations: [mk({ type: "date_reached", field: "due" }, undefined, [{ id: "n1", type: "history_note", value: "due" }])] }), created_at: 1, updated_at: 1, parent_id: null });
put({ ...rec({ due: "2020-01-01" }, "D1"), parent_id: "DUE" });
await runDueDateReachedRules(context, new Map(), new Set());
const afterFirst = objects.get("DUE").props;
assert.equal(JSON.parse(afterFirst)._automationLog.length, 1, "first check runs and logs");
await runDueDateReachedRules(context, new Map(), new Set());
assert.equal(objects.get("DUE").props, afterFirst, "a repeat check leaves the project untouched");

console.log("automations-clarity-check: ok");
