import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ExtensionHost } from "../src/core/extensions/host.ts";
import { LocalPluginManager } from "../src/core/extensions/manager.ts";
import { hydrateActiveLocalPlugins } from "../src/core/extensions/hydrate.ts";

const root = resolve("plugins/examples/hello-plugin");
const reader = { readText: async (_root, path) => readFile(path, "utf8") };

async function restartCase(source) {
  const entries = [{
    plugin_id: "example.hello",
    version: "0.1.0",
    source,
    install_path: root,
    verified: true,
    state: "active",
  }];

  // The first process is gone; only the persisted registry entry survives.
  const host = new ExtensionHost();
  const manager = new LocalPluginManager(host);
  const hydrated = await hydrateActiveLocalPlugins(entries, reader, manager);
  assert.deepEqual(hydrated, { loaded: ["example.hello@0.1.0"], failed: [] });
  assert.equal(manager.list()[0].status, "active");
  assert.equal(host.getSnapshot("example.hello")[0].commands[0].id, "say-hello-local");

  const disabled = await manager.disable("example.hello");
  assert.equal(disabled?.status, "disabled");
  assert.deepEqual(host.getSnapshot("example.hello"), [], "a disabled plugin leaves the snapshot entirely");

  const v2 = {
    manifest: {
      id: "example.hello",
      name: "Hello plugin",
      version: "0.2.0",
      apiVersion: "0.1",
      permissions: ["workspace.ui"],
    },
    onload(context) {
      context.commands.register({ id: "say-hello-local", name: "Say hello v2", execute: () => "v2" });
    },
  };
  await manager.install({ manifest: v2.manifest, plugin: v2, source, verified: true });
  assert.equal(manager.list()[0].activeVersion, "0.2.0");
  assert.equal((await manager.uninstall("example.hello", "0.2.0"))?.activeVersion, "0.1.0");
  assert.equal(host.getSnapshot("example.hello")[0].commands[0].name, "Say hello (local)");
}

await restartCase("local-file");
await restartCase("package");

const mismatch = await hydrateActiveLocalPlugins([{
  plugin_id: "example.other",
  version: "0.1.0",
  source: "package",
  install_path: root,
  verified: true,
  state: "active",
}], reader, new LocalPluginManager(new ExtensionHost()));
assert.deepEqual(mismatch.loaded, []);
assert.match(mismatch.failed[0].error, /does not match artifact/);
console.log("Plugin restart and rollback checks passed.");
