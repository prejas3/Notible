import assert from "node:assert/strict";
import { moduleId, availableModules, defaultModules, filterTabsByModules, normaliseModules, offeredModules } from "../src/product/container-modules.ts";

const snapshot = [
  { pluginId: "notible.views", objectTabs: [
    { id: "tasks", label: "Tasks", description: "A board of this container's tasks.", objectTypes: ["project", "folder"], defaultFor: ["project"] },
    { id: "table", label: "Table", description: "A flat cross-container list.", objectTypes: ["space"] },
    { id: "overview", label: "Overview", description: "Projects, deadlines, recent activity.", objectTypes: ["space"], defaultFor: ["space"] },
  ] },
  { pluginId: "notible.planning", objectTabs: [
    { id: "finance", label: "Finance", description: "Budget, cost and time tracking.", objectTypes: ["project"] },
  ] },
  { pluginId: "notible.automations", objectTabs: [
    { id: "automations", label: "Automations", description: "Rules that react to record changes.", objectTypes: ["project", "folder", "space"], defaultFor: ["project"] },
  ] },
];

// moduleId
assert.equal(moduleId("notible.views", "tasks"), "notible.views:tasks");

// availableModules: kind gate
const forProject = availableModules(snapshot, "project");
assert.deepEqual(forProject.map((r) => r.id).sort(), ["notible.automations:automations", "notible.planning:finance", "notible.views:tasks"]);
assert.equal(forProject.find((r) => r.id === "notible.views:tasks").defaultForKind, true);
assert.equal(forProject.find((r) => r.id === "notible.planning:finance").defaultForKind, false);
const forSpace = availableModules(snapshot, "space");
assert.deepEqual(forSpace.map((r) => r.id).sort(), ["notible.automations:automations", "notible.views:overview", "notible.views:table"]);

// defaultModules
assert.deepEqual(defaultModules(snapshot, "project").sort(), ["notible.automations:automations", "notible.views:tasks"]);
assert.deepEqual(defaultModules(snapshot, "space"), ["notible.views:overview"]);

// filterTabsByModules
const items = [
  { pluginId: "notible.views", tab: { id: "tasks" } },
  { pluginId: "notible.planning", tab: { id: "finance" } },
  { pluginId: "notible.automations", tab: { id: "automations" } },
];
assert.deepEqual(filterTabsByModules(items, undefined).map((i) => i.tab.id), ["tasks", "finance", "automations"], "no _modules → unchanged");
assert.deepEqual(filterTabsByModules(items, []).map((i) => i.tab.id), ["tasks", "finance", "automations"], "empty _modules → unchanged");
assert.deepEqual(filterTabsByModules(items, ["notible.views:tasks", "notible.automations:automations"]).map((i) => i.tab.id), ["tasks", "automations"]);
assert.deepEqual(filterTabsByModules(items, ["notible.gone:ghost"]).map((i) => i.tab.id), [], "unknown ids → nothing matches, no throw");

// R4 (0.93.3). Rows follow the tab order, whatever order the plugins loaded in.
{
  const snap = [
    { pluginId: "notible.finance", objectTabs: [{ id: "finance", label: "Finance", objectTypes: ["project"], order: 4 }] },
    { pluginId: "notible.views", objectTabs: [{ id: "tasks", label: "Tasks", objectTypes: ["project"], order: 0 }] },
  ];
  assert.deepEqual(availableModules(snap, "project").map((row) => row.label), ["Tasks", "Finance"]);
}
// D8: Finance moved from Planning to its own plugin; a project that chose the old id keeps its tab.
assert.deepEqual(normaliseModules(["notible.planning:finance", "notible.views:tasks"]), ["notible.finance:finance", "notible.views:tasks"]);
assert.deepEqual(filterTabsByModules([{ pluginId: "notible.finance", tab: { id: "finance" } }], ["notible.planning:finance"]).length, 1);
// D3: plugins that are off are offered; running ones are not.
assert.deepEqual(offeredModules([{ pluginId: "notible.finance" }], "project").map((offer) => offer.pluginId), ["notible.planning", "notible.automations"]);
assert.deepEqual(offeredModules([], "space").map((offer) => offer.pluginId), ["notible.planning"]);

console.log("container-modules-check: ok");
