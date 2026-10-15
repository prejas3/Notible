import assert from "node:assert/strict";
import { ExtensionHost } from "../src/core/extensions/host.ts";
import { BUILTIN_PLUGINS } from "../src/product/builtin.ts";
import { applyPluginSelection } from "../src/product/matrix-controller.ts";

const host = new ExtensionHost();
const selected = ["notible.work-models"];
// work-models declares a dependency on notible.properties, which
// applyPluginSelection auto-includes — selecting a plugin implicitly selects
// what it needs.
const expected = [...selected, "notible.properties"];
assert.deepEqual((await applyPluginSelection(host, BUILTIN_PLUGINS, selected)).sort(), expected.sort());
assert.deepEqual(host.getSnapshot().map((item) => item.pluginId).sort(), expected.sort());
assert.ok(host.getSnapshot().every((item) => item.views.length === (item.pluginId === "notible.properties" ? 2 : 1) && item.settings.length === 1));
assert.equal(host.getSnapshot().find((item) => item.pluginId === "notible.work-models")?.commands.length, 4);
assert.deepEqual(await applyPluginSelection(host, BUILTIN_PLUGINS, []), []);
assert.equal(host.getSnapshot().length, 0);

// A third-party plugin must survive every Matrix operation. Selecting over the
// builtin catalog used to disable everything active that was not in the
// selection — which is every plugin the user installed themselves. Opening
// Plugin Matrix switched them off and their panels disappeared.
const thirdParty = {
  manifest: { id: "example.outsider", name: "Outsider", version: "1.0.0", apiVersion: "0.1", permissions: ["workspace.ui"] },
  onload(context) {
    context.ui.registerSlot("workspace.sidebar", { id: "panel", mount: () => ({ dispose() {} }) });
  },
};
await host.enable(thirdParty);
await applyPluginSelection(host, BUILTIN_PLUGINS, ["notible.work-models"]);
assert.ok(
  host.getSnapshot().some((item) => item.pluginId === "example.outsider"),
  "a selection over the builtin catalog must not disable a third-party plugin",
);
await applyPluginSelection(host, BUILTIN_PLUGINS, []);
assert.deepEqual(
  host.getSnapshot().map((item) => item.pluginId),
  ["example.outsider"],
  "clearing the builtin selection must leave third-party plugins alone",
);

console.log("Unified Test Host Matrix checks passed: Work Models loads with its dependency and cleans up to Core only.");
