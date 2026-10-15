import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ExtensionHost } from "../src/core/extensions/host.ts";
import { loadPluginPackage } from "../src/core/extensions/package.ts";
import { planningPlugin } from "../plugins/builtin/planning.ts";
import { automationsPlugin } from "../plugins/builtin/automations.ts";
import { parsePluginAutomationRules, pluginAutomationMatches } from "../plugins/builtin/automations.ts";
import { financePlugin } from "../plugins/builtin/finance.ts";
import { searchPlugin } from "../plugins/builtin/search.ts";
import { propertiesPlugin } from "../plugins/builtin/properties.ts";

function scenario() {
  const objects = new Map();
  const types = new Map();
  let nextId = 1;
  const data = {
    objects: {
      get: async (id) => objects.get(id) ?? null,
      create: async (input) => { const object = { id: `object-${nextId++}`, type: input.type, title: input.title, content: input.content ?? "{}", props: input.props ?? "{}", created_at: 1, updated_at: 1, archived_at: null, trashed_at: null }; objects.set(object.id, object); return object; },
      update: async (id, patch) => { const current = objects.get(id); const object = { ...current, ...patch, updated_at: current.updated_at + 1 }; objects.set(id, object); return object; },
      trash: async () => null,
      query: async (query = {}) => [...objects.values()].filter((object) => (!query.type || object.type === query.type) && (!query.parentId || object.parentId === query.parentId)).slice(0, query.limit ?? 5000),
    },
    relations: { list: async () => [], create: async () => ({ from_id: "a", to_id: "b", kind: "related" }), delete: async () => true },
    types: { list: async () => [...types.values()], upsert: async (name, schema, icon = null, color = null) => { const value = { name, schema, icon, color }; types.set(name, value); return value; } },
    dataSources: { list: async () => [], upsert: async (name, definition, id) => ({ id: id ?? "source-1", name, definition, created_at: 1, updated_at: 1 }), delete: async () => true },
  };
  return { data, objects, types };
}

async function runProduct(plugin) {
  const state = scenario();
  const host = new ExtensionHost(state.data);
  if (plugin.manifest.dependencies?.["notible.properties"]) await host.enable(propertiesPlugin);
  await host.enable(plugin);
  return { state, host, command: host.getSnapshot(plugin.manifest.id)[0].commands[0] };
}

const planning = await runProduct(planningPlugin);
assert.equal((await planning.command.execute()).typeCount, 3);
assert.equal((await planning.command.execute({ type: "cycle", title: "Sprint 1" })).object.type, "cycle");
await planning.host.disable(planningPlugin.manifest.id);

const automations = await runProduct(automationsPlugin);
const automationObject = await automations.state.data.objects.create({ type: "folder", title: "Rules", props: "{}" });
const rule = { id: "rule-1", version: 2, name: "Open urgent", enabled: true, trigger: { type: "property_changed", field: "priority", value: "urgent" }, actions: [{ id: "action-1", type: "set_property", field: "status", value: "open" }], stopOnError: true };
assert.equal((await automations.command.execute({ objectId: automationObject.id, rules: [rule] })).ruleCount, 1);
assert.equal((await automations.command.execute()).automations.length, 1);
const pluginRules = parsePluginAutomationRules([rule]);
assert.equal(pluginRules.length, 1);
assert.equal(pluginAutomationMatches(pluginRules[0], { id: "sample", type: "task", title: "Urgent", content: "{}", props: JSON.stringify({ priority: "urgent" }), created_at: 1, updated_at: 1, archived_at: null, trashed_at: null }, "property_changed", { priority: "urgent" }), true);
await automations.host.disable(automationsPlugin.manifest.id);

const finance = await runProduct(financePlugin);
assert.equal((await finance.command.execute()).typeCount, 3);
await finance.state.data.objects.create({ type: "financial_entry", title: "Hosting", props: JSON.stringify({ kind: "cost", amount: 100, status: "paid" }) });
await finance.state.data.objects.create({ type: "time_entry", title: "Work", props: JSON.stringify({ hours: 2, costRate: 20, billable: true, billableRate: 80 }) });
const summary = await finance.command.execute({ parentId: undefined });
assert.equal(summary.actualCost, 100);
assert.equal(summary.timeCost, 40);
assert.equal(summary.billableRevenue, 160);
await finance.host.disable(financePlugin.manifest.id);

const search = await runProduct(searchPlugin);
await search.state.data.objects.create({ type: "note", title: "Alpha note", props: "{}" });
assert.equal((await search.command.execute({ query: "alpha" })).count, 1);
await search.host.disable(searchPlugin.manifest.id);

for (const [id, expected] of [["notible.planning", 3], ["notible.automations", 0], ["notible.finance", 3], ["notible.search", 1]]) {
  const state = scenario();
  const packaged = await loadPluginPackage({ readText: async (path) => readFileSync(new URL(`../plugins/builtin/${id}/${path}`, import.meta.url), "utf8") }, true, "builtin");
  const host = new ExtensionHost(state.data);
  await host.enable(packaged.plugin);
  let result;
  if (id === "notible.planning" || id === "notible.finance") result = await host.getSnapshot(id)[0].commands[0].execute();
  else if (id === "notible.automations") result = await host.getSnapshot(id)[0].commands[0].execute();
  else { await state.data.objects.create({ type: "note", title: "Alpha note", props: "{}" }); result = await host.getSnapshot(id)[0].commands[0].execute({ query: "alpha" }); }
  assert.equal(id === "notible.automations" ? result.automations.length : id === "notible.search" ? result.count : id === "notible.planning" || id === "notible.finance" ? result.typeCount : -1, expected);
  await host.disable(id);
}

console.log("Planning, Automations, Finance and Search checks passed: product and package surfaces use public DataApi.");
