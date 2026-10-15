/**
 * Kontrakt `registerObjectTab` (API 1.5).
 *
 * Pilnuje czterech rzeczy, z których żadna nie jest widoczna w typach:
 * typ obiektu jest walidowany w runtimie (unia TS nie waliduje nic — patrz
 * `data.sync` w 0.48.0), `order` jest obcinany, rejestracja UI wymaga
 * `workspace.ui`, a nieobsługiwany typ jest raportowany i pomijany zamiast
 * wywalać cały plugin.
 */
import assert from "node:assert/strict";
import { ExtensionHost } from "../src/core/extensions/host.ts";
import { OBJECT_TAB_TYPES } from "../packages/plugin-api/src/index.ts";

const errors = [];
const host = new ExtensionHost();
host.onError((error) => errors.push(error.message));

const plugin = (id, tabs, permissions = ["workspace.ui"]) => ({
  manifest: { id, name: id, version: "1.0.0", apiVersion: "1.5", permissions },
  onload(context) { for (const tab of tabs) context.views.registerObjectTab(tab); },
});

// 1. Zwykła rejestracja przechodzi i widać ją w snapshocie.
await host.enable(plugin("a.plugin", [{ id: "auto", label: "Automatyzacje", objectTypes: ["project"], mount: () => {} }]));
assert.deepEqual(host.getSnapshot("a.plugin")[0].objectTabs.map((tab) => tab.id), ["auto"]);

// 2. Typ bez powierzchni kontenera jest raportowany i pomijany — nie rzuca,
//    bo rzut w onload zabiera cały plugin, a nie jedną zakładkę.
await host.enable(plugin("b.plugin", [{ id: "x", label: "X", objectTypes: ["task"], mount: () => {} }]));
assert.deepEqual(host.getSnapshot("b.plugin")[0].objectTabs, []);
assert.ok(errors.some((text) => text.includes("task")), "unsupported object type must be reported");

// 2b. Namespaced typ pluginu (`plugin.ns.type` z `behaviour.container`) jest
//     akceptowany — Core montuje dla niego powierzchnię kontenera. Bare "task"
//     wyżej dalej odpada, bo nie ma kropki.
await host.enable(plugin("b2.plugin", [{ id: "m", label: "M", objectTypes: ["notible.typewriter.manuscript"], mount: () => {} }]));
assert.deepEqual(host.getSnapshot("b2.plugin")[0].objectTabs.map((tab) => tab.id), ["m"]);

// 3. `order` obcinany do 0-100: bez tego `order: -999999` otwiera cudzą
//    zakładkę domyślnie, przed wbudowanym dashboardem.
await host.enable(plugin("c.plugin", [{ id: "greedy", label: "G", objectTypes: ["project"], order: -999999, mount: () => {} }]));
assert.equal(host.getSnapshot("c.plugin")[0].objectTabs[0].order, 0);
await host.enable(plugin("c2.plugin", [{ id: "big", label: "B", objectTypes: ["project"], order: 10_000, mount: () => {} }]));
assert.equal(host.getSnapshot("c2.plugin")[0].objectTabs[0].order, 100);

// 4. Rejestracja UI wymaga workspace.ui — i tu brak uprawnienia zabiera CAŁY
//    plugin (tak działa `permissions.require` od 1.0), inaczej niż zły typ
//    obiektu wyżej, który zabiera jedną zakładkę. Dwa różne zachowania dla
//    dwóch różnych błędów: uprawnienia to deklaracja autora, typ to literówka.
await assert.rejects(
  () => host.enable(plugin("d.plugin", [{ id: "n", label: "N", objectTypes: ["project"], mount: () => {} }], [])),
  /lacks permission workspace\.ui/,
);
assert.deepEqual(host.getSnapshot("d.plugin")[0]?.objectTabs ?? [], []);

// 4b. Zakładka może nazywać się tak samo jak widok, który montuje —
//     rejestracje dzielą jedną przestrzeń nazw, a "canvas"+"canvas" to
//     naturalna nazwa, nie błąd autora.
await host.enable({
  manifest: { id: "e.plugin", name: "e", version: "1.0.0", apiVersion: "1.5", permissions: ["workspace.ui"] },
  onload(context) {
    context.views.register({ id: "canvas", title: "Canvas", render: {} });
    context.views.registerObjectTab({ id: "canvas", label: "Board", objectTypes: ["whiteboard"], mount: () => {} });
  },
});
assert.deepEqual(host.getSnapshot("e.plugin")[0].objectTabs.map((tab) => tab.id), ["canvas"]);
assert.deepEqual(host.getSnapshot("e.plugin")[0].views.map((view) => view.id), ["canvas"]);

// 5. Kontrakt zna dokładnie te typy, które Core umie zamontować
//    (CONTAINER_TYPES + whiteboard + table w CoreOnlyApp — patrz
//    hasContainerSurface).
assert.deepEqual([...OBJECT_TAB_TYPES], ["space", "folder", "project", "whiteboard", "table"]);

console.log(`object-tabs-check: ok (validation, order clamp, permission, ${errors.length} reported)`);
