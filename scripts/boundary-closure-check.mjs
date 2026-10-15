// scripts/boundary-closure-check.mjs
// ponytail: fixture round-trip parity check, not a full render diff. The legacy
// ContainerView builds its view list inline, so there is no pure legacy function
// to diff against — instead we assert the plugin resolver (viewsFromObject)
// preserves every seeded _views field. Upgrade path: if visual regressions slip
// through, extend the fixture set, not the harness.
// Run: node --experimental-strip-types scripts/boundary-closure-check.mjs
import assert from "node:assert/strict";
import { viewsFromObject } from "../plugins/builtin/views.ts";

function fixtureContainer() {
  return {
    id: "fx-container",
    type: "collection",
    props: JSON.stringify({
      _views: [
        { id: "v-table", name: "Table", layout: "table", columns: ["title", "status", "priority"] },
        { id: "v-kanban", name: "Board", layout: "kanban", groupBy: "status" },
        { id: "v-form", name: "Intake", layout: "form" },
      ],
      _automations: [{ id: "a1", when: "status_changed", to: "done", then: "notify" }],
      _automationLog: [],
      _dataSource: { type: "children" },
    }),
  };
}

function fixtureProject() {
  return {
    id: "fx-project",
    type: "project",
    props: JSON.stringify({ _projectCalendars: [], _projectCalendarEvents: [] }),
  };
}

// Parity claim 1: plugin resolver preserves every seeded view id + layout + extras.
{
  const resolved = viewsFromObject(fixtureContainer());
  const ids = resolved.map((v) => v.id).sort();
  assert.deepEqual(ids, ["v-form", "v-kanban", "v-table"], "view ids must round-trip");

  const table = resolved.find((v) => v.id === "v-table");
  assert.equal(table.layout, "table", "table layout must round-trip");
  assert.deepEqual(table.columns, ["title", "status", "priority"], "table columns must round-trip");

  const kanban = resolved.find((v) => v.id === "v-kanban");
  assert.equal(kanban.groupBy, "status", "kanban groupBy must round-trip");

  const form = resolved.find((v) => v.id === "v-form");
  assert.equal(form.layout, "gallery", "retired 'form' layout normalises to gallery on read");
}

// Parity claim 2: a project with no _views resolves to a single Tasks kanban
// (tolerant fallback, no migration). Previously Overview(form) + Issues(table).
{
  const resolved = viewsFromObject(fixtureProject());
  assert.deepEqual(
    resolved.map((v) => ({ id: v.id, layout: v.layout, typeFilter: v.typeFilter ?? null })),
    [{ id: "tasks", layout: "kanban", typeFilter: "task" }],
    "project with no _views must resolve to a single Tasks kanban",
  );
}

// Parity claim 3: a project that already has _views keeps them verbatim.
{
  const seeded = { id: "fx-project-2", type: "project", props: JSON.stringify({ _views: [{ id: "board", name: "Board", layout: "kanban" }] }) };
  const resolved = viewsFromObject(seeded);
  assert.deepEqual(resolved.map((v) => v.id), ["board"], "seeded project _views must round-trip");
}

console.log("boundary-closure-check: OK");
