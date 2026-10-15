import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ExtensionHost } from "../src/core/extensions/host.ts";
import { loadPluginPackage } from "../src/core/extensions/package.ts";
import { automationsPlugin, executeAutomationRule, isRecurringDue, listAutomationRules, parsePluginAutomationRules, pluginAutomationExecutionKey, pluginAutomationMatches, upsertAutomationRules } from "../plugins/builtin/automations.ts";

// automationsOnActivate's listeners are async fire-and-forget (host.emit does
// not await them), so a test that emits an event needs to give the resulting
// promise chain a tick to actually reach the object.update it ends in.
function flush() { return new Promise((resolve) => setTimeout(resolve, 20)); }

function scenario() {
  const objects = new Map();
  const relations = [];
  let nextId = 1;
  const data = {
    objects: {
      get: async (id) => objects.get(id) ?? null,
      // parent_id is the real PluginObject field name; parentId is kept
      // alongside it only because the query filter below already relied on it.
      create: async (input) => { const object = { id: `automation-${nextId++}`, type: input.type, title: input.title, content: input.content ?? "{}", props: input.props ?? "{}", parentId: input.parentId, parent_id: input.parentId ?? null, created_at: 1, updated_at: 1, archived_at: null, trashed_at: null }; objects.set(object.id, object); return object; },
      update: async (id, patch) => { const current = objects.get(id); const object = { ...current, ...patch, updated_at: current.updated_at + 1 }; objects.set(id, object); return object; },
      move: async (id, parentId) => { const current = objects.get(id); const object = { ...current, parentId, parent_id: parentId, updated_at: current.updated_at + 1 }; objects.set(id, object); return object; },
      trash: async () => null,
      query: async (query = {}) => [...objects.values()].filter((object) => (!query.type || object.type === query.type) && (!query.parentId || object.parentId === query.parentId)).slice(0, query.limit ?? 5000),
    },
    relations: { list: async () => relations, create: async (fromId, toId, kind) => { const relation = { from_id: fromId, to_id: toId, kind }; relations.push(relation); return relation; }, delete: async () => true },
    types: { list: async () => [{ name: "task", schema: "{}", icon: "✓", color: "#000" }], upsert: async (name, schema, icon = null, color = null) => ({ name, schema, icon, color }) },
    dataSources: { list: async () => [], upsert: async (name, definition, id) => ({ id: id ?? "source-1", name, definition, created_at: 1, updated_at: 1 }), delete: async () => true },
  };
  return { data, objects };
}

function context(plugin, data, notifyCalls = []) {
  return { manifest: plugin.manifest, permissions: { has: () => true, require: () => {} }, data, commands: { register: () => ({ dispose() {} }) }, views: { register: () => ({ dispose() {} }) }, settings: { register: () => ({ dispose() {} }) }, ui: { registerSlot: () => ({ dispose() {} }) }, events: { on: () => ({ dispose() {} }), emit: () => {} }, scheduler: { every: () => ({ dispose() {} }) }, notifications: { show: async (options) => { notifyCalls.push(options); } }, storage: { get: () => null, set: () => {}, delete: () => {}, keys: () => [] } };
}

const state = scenario();
const host = new ExtensionHost(state.data);
await host.enable(automationsPlugin);
const contextValue = context(automationsPlugin, state.data);
const container = await state.data.objects.create({ type: "project", title: "Automation workspace", props: "{}" });
const target = await state.data.objects.create({ type: "task", title: "Open task", props: JSON.stringify({ status: "open" }), parentId: container.id });
const rule = { id: "rule-status", version: 2, name: "Close task", enabled: true, trigger: { type: "manual" }, conditions: { kind: "group", combinator: "and", children: [{ kind: "condition", field: "status", operator: "equals", value: "open" }] }, actions: [{ id: "action-status", type: "set_property", field: "status", value: "done" }], stopOnError: true };
assert.equal((await upsertAutomationRules(contextValue, { objectId: container.id, rules: [rule] })).ruleCount, 1);
assert.equal((await listAutomationRules(contextValue)).length, 1);
const parsed = parsePluginAutomationRules([rule])[0];
assert.equal(pluginAutomationMatches(parsed, target, "manual"), true);
assert.ok(pluginAutomationExecutionKey(parsed, target, "manual").startsWith("rule-status:automation-"));
assert.equal(pluginAutomationMatches(parsed, target, "record_created"), false);
assert.equal(parsed.actions.length, 1);
// Since 0.55.0 automations live on the project as a tab, not as a panel in
// Settings that first asks which project you meant. The lazy plugin-owned
// surface is still the thing being asserted — only where it mounts changed.
const automationsSnapshot = host.getSnapshot(automationsPlugin.manifest.id)[0];
assert.equal(automationsSnapshot.settings.length, 0);
assert.deepEqual(automationsSnapshot.objectTabs.map((tab) => [tab.id, tab.objectTypes]), [["automations", ["project", "folder", "space"]]]);
assert.equal(automationsSnapshot.views.find((view) => view.id === "surface").render.loader instanceof Function, true);

// relation_changed: the rule's own relation/change/targetId filters, exposed
// in the editor since before any relation event existed to check them
// against, must now actually gate the match — not just record_created and
// property_changed silently passing everything through.
const relationRule = parsePluginAutomationRules([{ id: "rule-relation", version: 2, name: "Relation rule", enabled: true, trigger: { type: "relation_changed", relation: "blocks", change: "added" }, actions: [] }])[0];
assert.equal(pluginAutomationMatches(relationRule, target, "relation_changed", undefined, new Date(), { relation: "blocks", change: "added", targetId: "x" }), true);
assert.equal(pluginAutomationMatches(relationRule, target, "relation_changed", undefined, new Date(), { relation: "blocks", change: "removed", targetId: "x" }), false, "change filter must reject a non-matching change");
assert.equal(pluginAutomationMatches(relationRule, target, "relation_changed", undefined, new Date(), { relation: "related", change: "added", targetId: "x" }), false, "relation-kind filter must reject a non-matching relation");
// Two different relation changes on the same object between property
// updates share one `updated_at` — the execution key must still tell them
// apart, or the second would be wrongly deduped as a repeat of the first.
const keyA = pluginAutomationExecutionKey(relationRule, target, "relation_changed", new Date(), { relation: "blocks", change: "added", targetId: "x" });
const keyB = pluginAutomationExecutionKey(relationRule, target, "relation_changed", new Date(), { relation: "blocks", change: "added", targetId: "y" });
assert.notEqual(keyA, keyB, "distinct relation targets must not collide on one execution key");

// End-to-end: automationsOnActivate wires object.created/object.updated/
// relation.created/relation.deleted against the host's real event bus in
// onActivate, so a plugin that never opens its own Automations panel still
// reacts to what Core would emit while the app is simply running.
const bgContainer = await state.data.objects.create({ type: "project", title: "Background workspace", props: "{}" });
await upsertAutomationRules(contextValue, { objectId: bgContainer.id, rules: [
  { id: "rule-created", version: 2, name: "On create", enabled: true, trigger: { type: "record_created" }, actions: [{ id: "a1", type: "set_property", field: "seen", value: "yes" }], stopOnError: true },
  { id: "rule-status", version: 2, name: "On status change", enabled: true, trigger: { type: "property_changed", field: "status", value: "done" }, actions: [{ id: "a2", type: "history_note", value: "closed" }], stopOnError: true },
  { id: "rule-blocked", version: 2, name: "On block", enabled: true, trigger: { type: "relation_changed", change: "added" }, actions: [{ id: "a3", type: "history_note", value: "blocked" }], stopOnError: true },
] });

const bgTask = await state.data.objects.create({ type: "task", title: "Background task", props: JSON.stringify({ status: "open" }), parentId: bgContainer.id });
host.emit("object.created", { id: bgTask.id, type: "task" });
await flush();
let bgContainerNow = await state.data.objects.get(bgContainer.id);
let bgLog = JSON.parse(bgContainerNow.props)._automationLog ?? [];
assert.ok(bgLog.some((entry) => entry.ruleId === "rule-created" && entry.status === "success"), "record_created rule must have run in the background");
let bgTaskNow = await state.data.objects.get(bgTask.id);
assert.equal(JSON.parse(bgTaskNow.props).seen, "yes", "record_created rule's action must have applied");

await state.data.objects.update(bgTask.id, { props: JSON.stringify({ status: "done" }) });
host.emit("object.updated", { id: bgTask.id, type: "task" });
await flush();
bgContainerNow = await state.data.objects.get(bgContainer.id);
bgLog = JSON.parse(bgContainerNow.props)._automationLog ?? [];
assert.ok(bgLog.some((entry) => entry.ruleId === "rule-status" && entry.status === "success"), "property_changed rule must have run in the background");

await state.data.relations.create(bgTask.id, "some-other-id", "blocks");
host.emit("relation.created", { fromId: bgTask.id, toId: "some-other-id", kind: "blocks" });
await flush();
bgContainerNow = await state.data.objects.get(bgContainer.id);
bgLog = JSON.parse(bgContainerNow.props)._automationLog ?? [];
assert.ok(bgLog.some((entry) => entry.ruleId === "rule-blocked" && entry.status === "success"), "relation_changed rule must have run in the background");

await host.disable(automationsPlugin.manifest.id);

// First edit after launch: a record that already existed before the plugin
// activated (no object.created event to seed the "before" snapshot) must
// still fire a property_changed rule on its very first object.updated — the
// activate-time propsCache seed is what makes this work. Regression guard for
// "the automation only runs from the second edit on".
{
  const s = scenario();
  const h = new ExtensionHost(s.data);
  const preContainer = await s.data.objects.create({ type: "project", title: "Pre-existing", props: "{}" });
  const preTask = await s.data.objects.create({ type: "task", title: "Old task", props: JSON.stringify({ status: "open" }), parentId: preContainer.id });
  await upsertAutomationRules(context(automationsPlugin, s.data), { objectId: preContainer.id, rules: [
    { id: "rule-first-edit", version: 2, name: "On status", enabled: true, trigger: { type: "property_changed", field: "status", value: "done" }, actions: [{ id: "a", type: "history_note", value: "closed" }], stopOnError: true },
  ] });
  await h.enable(automationsPlugin);
  await flush(); // let the activate-time propsCache seed query resolve
  await s.data.objects.update(preTask.id, { props: JSON.stringify({ status: "done" }) });
  h.emit("object.updated", { id: preTask.id, type: "task" });
  await flush();
  const log = JSON.parse((await s.data.objects.get(preContainer.id)).props)._automationLog ?? [];
  assert.ok(log.some((entry) => entry.ruleId === "rule-first-edit" && entry.status === "success"), "property_changed must fire on the FIRST edit of a pre-existing record");
  await h.disable(automationsPlugin.manifest.id);
}

// isRecurringDue: pure date math, no host needed.
const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-06-15T09:00:00"); // a Monday
assert.equal(isRecurringDue({ type: "recurring" }, undefined, now), true, "never run and no startDate must be due immediately");
assert.equal(isRecurringDue({ type: "recurring", startDate: "2026-07-01" }, undefined, now), false, "a future startDate must not be due yet");
assert.equal(isRecurringDue({ type: "recurring", frequency: "daily", interval: 1 }, now.getTime(), now), false, "already run today must not be due again the same day");
assert.equal(isRecurringDue({ type: "recurring", frequency: "daily", interval: 1 }, now.getTime() - DAY, now), true, "daily interval 1, one day since last run, must be due");
assert.equal(isRecurringDue({ type: "recurring", frequency: "daily", interval: 3 }, now.getTime() - DAY, now), false, "daily interval 3, only one day since last run, must not be due yet");
assert.equal(isRecurringDue({ type: "recurring", frequency: "weekly", interval: 1 }, now.getTime() - 7 * DAY, now), true, "weekly interval 1, one week since last run, must be due");
assert.equal(isRecurringDue({ type: "recurring", frequency: "weekly", interval: 1 }, now.getTime() - 3 * DAY, now), false, "weekly interval 1, three days since last run, must not be due yet");
assert.equal(isRecurringDue({ type: "recurring", frequency: "monthly", interval: 1, dayOfMonth: 15 }, new Date("2026-05-15T09:00:00").getTime(), now), true, "monthly on the 15th, exactly one month later, must be due");
assert.equal(isRecurringDue({ type: "recurring", frequency: "monthly", interval: 1, dayOfMonth: 15 }, new Date("2026-05-15T09:00:00").getTime(), new Date("2026-06-10T09:00:00")), false, "monthly interval not yet elapsed (before this month's 15th) must not be due");
// 2026-06-20 is a Saturday; weekendPolicy "skip" must push the daily-interval-5 occurrence to Monday the 22nd.
assert.equal(isRecurringDue({ type: "recurring", frequency: "daily", interval: 5, weekendPolicy: "skip" }, new Date("2026-06-15T09:00:00").getTime(), new Date("2026-06-20T09:00:00")), false, "weekendPolicy skip must hold a Saturday occurrence back");
assert.equal(isRecurringDue({ type: "recurring", frequency: "daily", interval: 5, weekendPolicy: "skip" }, new Date("2026-06-15T09:00:00").getTime(), new Date("2026-06-22T09:00:00")), true, "weekendPolicy skip must fire on the following Monday");

// End-to-end: automationsOnActivate's own periodic check (not an event) picks
// up a due recurring rule immediately on activation, runs it against the
// container itself (there is no per-record target for a schedule), and
// records lastRunAt so the same day doesn't fire twice.
const recurringContainer = await state.data.objects.create({ type: "project", title: "Scheduled workspace", props: JSON.stringify({ _automations: [
  { id: "rule-recurring", version: 2, name: "Weekly digest", enabled: true, trigger: { type: "recurring", frequency: "weekly", interval: 1 }, actions: [{ id: "a4", type: "history_note", value: "digest" }], stopOnError: true },
] }) });
await host.enable(automationsPlugin);
await flush();
let recurringContainerNow = await state.data.objects.get(recurringContainer.id);
let recurringProps = JSON.parse(recurringContainerNow.props);
assert.ok((recurringProps._automationLog ?? []).some((entry) => entry.ruleId === "rule-recurring" && entry.status === "success"), "recurring rule must have run on activation");
const persistedRule = parsePluginAutomationRules(recurringProps._automations).find((candidate) => candidate.id === "rule-recurring");
assert.ok(typeof persistedRule.lastRunAt === "number", "lastRunAt must be persisted after a recurring run");
await host.disable(automationsPlugin.manifest.id);

// notify: the one action that reaches the user outside the app window. Must
// call context.notifications.show with {{today}} substituted, the same as
// set_property/set_reminder already do — and, since a plugin cannot show a
// notification without asking, must declare the `notifications` permission.
{
  const notifyState = scenario();
  const notifyCalls = [];
  const notifyContext = context(automationsPlugin, notifyState.data, notifyCalls);
  const notifyObject = await notifyState.data.objects.create({ type: "task", title: "Renew passport", props: "{}" });
  const notifyRule = { id: "rule-notify", version: 2, name: "Reminder", enabled: true, trigger: { type: "manual" }, actions: [{ id: "a-notify", type: "notify", title: "Due {{today}}", body: "Renew passport" }], stopOnError: true };
  const result = await executeAutomationRule(notifyContext, notifyRule, notifyObject, "manual", null, new Set());
  assert.equal(result.status, "success", "notify action must succeed");
  assert.equal(notifyCalls.length, 1, "notify action must call context.notifications.show exactly once");
  assert.ok(notifyCalls[0].title.startsWith("Due "), "notify title's {{today}} must be substituted");
  assert.equal(notifyCalls[0].body, "Renew passport");
  assert.ok(automationsPlugin.manifest.permissions.includes("notifications"), "automations manifest must declare the notifications permission it uses");
}

// stopOnError: previously typed, defaulted, exposed nowhere in the UI, and
// never actually read — one shared try/catch around the whole action loop
// meant a later action's failure always discarded every already-applied
// set_property change (never written, since the single `update` happened
// only after the loop) while leaving create_record/add_relation/move_record
// side effects from earlier actions in place, uncorrected. Now each action
// runs in its own try/catch, whatever ran is persisted regardless of where a
// later action fails, and stopOnError only decides whether the *rest* of the
// actions still get a chance to run.
{
  const failState = scenario();
  const failContext = context(automationsPlugin, failState.data);
  const failObject = await failState.data.objects.create({ type: "task", title: "Partial failure", props: "{}" });
  const failRule = {
    id: "rule-fail", version: 2, name: "Stops on error", enabled: true, trigger: { type: "manual" },
    actions: [
      { id: "a1", type: "set_property", field: "seen", value: "yes" },
      { id: "a2", type: "add_relation", relation: "blocks", targetId: "" }, // falsy targetId: a silent no-op, not a thrown error — use move_record instead to force a real throw
      { id: "a3", type: "move_record", targetId: "does-not-exist" },
      { id: "a4", type: "set_property", field: "afterFailure", value: "should-not-run" },
    ],
    stopOnError: true,
  };
  failState.data.objects.move = async () => { throw new Error("target container not found"); };
  const result = await executeAutomationRule(failContext, failRule, failObject, "manual", null, new Set());
  assert.equal(result.status, "error", "a failing action must mark the run as error");
  assert.ok(result.message.includes("stopped on first error"), "message must say the rule stopped early");
  const afterFail = await failState.data.objects.get(failObject.id);
  assert.equal(JSON.parse(afterFail.props).seen, "yes", "an action that ran before the failure must still be persisted, not discarded");
  assert.equal(JSON.parse(afterFail.props).afterFailure, undefined, "an action after the failure must not have run when stopOnError is true");
}
{
  const continueState = scenario();
  const continueContext = context(automationsPlugin, continueState.data);
  const continueObject = await continueState.data.objects.create({ type: "task", title: "Keep going", props: "{}" });
  continueState.data.objects.move = async () => { throw new Error("target container not found"); };
  const continueRule = {
    id: "rule-continue", version: 2, name: "Keeps going", enabled: true, trigger: { type: "manual" },
    actions: [
      { id: "a1", type: "set_property", field: "before", value: "yes" },
      { id: "a2", type: "move_record", targetId: "does-not-exist" },
      { id: "a3", type: "set_property", field: "after", value: "yes" },
    ],
    stopOnError: false,
  };
  const result = await executeAutomationRule(continueContext, continueRule, continueObject, "manual", null, new Set());
  assert.equal(result.status, "error", "still an error overall");
  assert.ok(!result.message.includes("stopped on first error"), "must not claim it stopped early when stopOnError is false");
  const afterContinue = await continueState.data.objects.get(continueObject.id);
  assert.equal(JSON.parse(afterContinue.props).before, "yes");
  assert.equal(JSON.parse(afterContinue.props).after, "yes", "an action after the failure must still run when stopOnError is false");
}

// Rate-limit breaker: previously tripped silently (return false, nothing
// logged) — indistinguishable from "the automation just stopped working".
// Drive more than RATE_LIMIT_MAX_RUNS genuine property_changed events on one
// record within the window (each with a real, test-driven diff, so this does
// not depend on any rule's own action output ping-ponging in a realistic
// way) and confirm the breaker both stops processing AND leaves exactly the
// kind of explanatory log entry a user could find and understand.
{
  const loopState = scenario();
  const loopHost = new ExtensionHost(loopState.data);
  const loopContainer = await loopState.data.objects.create({ type: "project", title: "Loop workspace", props: "{}" });
  const loopTask = await loopState.data.objects.create({ type: "task", title: "Loop task", props: JSON.stringify({ n: "0" }), parentId: loopContainer.id });
  await loopHost.enable(automationsPlugin);
  await flush(); // let the activate-time propsCache seed see n:"0"
  for (let i = 1; i <= 12; i += 1) {
    await loopState.data.objects.update(loopTask.id, { props: JSON.stringify({ n: String(i) }) });
    loopHost.emit("object.updated", { id: loopTask.id, type: "task" });
    await flush();
  }
  const loopLog = JSON.parse((await loopState.data.objects.get(loopContainer.id)).props)._automationLog ?? [];
  const trips = loopLog.filter((entry) => entry.ruleId === "_rate_limit");
  assert.ok(trips.length >= 1, "12 rapid property changes on one record must leave at least one rate-limit log entry, not fail silently");
  assert.ok(trips[0].message.includes("trigger loop"), "the log entry must explain what happened");
  await loopHost.disable(automationsPlugin.manifest.id);
}

const ui = readFileSync(new URL("../plugins/builtin/automations-ui.tsx", import.meta.url), "utf8");
assert.ok(ui.includes("Stop on first error"), "the stopOnError field must be reachable from the UI, not just the data model");
assert.ok(ui.includes("directly inside this project or folder"), "the record_created/property_changed/relation_changed scope must be explained near the Trigger picker");
assert.ok(!ui.includes("Only for records directly"), "the scope hint must use the app's own vocabulary (notes/tasks), not internal jargon like \"records\"");
assert.ok(ui.includes("Execution log"));
assert.ok(ui.includes("Run this rule"));
// Status/priority values are picked from a shared Combobox (values already in
// use, free text still allowed), not typed into a bare unstyled <input>.
assert.ok(ui.includes("Combobox"), "property/action value must use the shared Combobox control");
// `src/core/ui` is the sanctioned shared-control layer (API 1.11 UI
// baseline: <Select>/<Combobox>/<DatePicker>). Any OTHER `src/core/` reach
// into Core internals is still forbidden.
assert.ok(!ui.replaceAll("src/core/ui/", "").includes("src/core/"));
assert.ok(!ui.includes("src-tauri"));
const packaged = await loadPluginPackage({ readText: async (path) => readFileSync(new URL(`../plugins/builtin/notible.automations/${path}`, import.meta.url), "utf8") }, true, "builtin");
assert.equal(packaged.plugin.manifest.id, "notible.automations");
console.log("Automations plugin checks passed: rule CRUD, nested conditions, matching, execution identity, relation-event filtering/dedup, background record_created/property_changed/relation_changed wiring, recurring due-date math (daily/weekly/monthly/weekend-skip), recurring end-to-end on activation, custom settings/view surface and package boundary.");
