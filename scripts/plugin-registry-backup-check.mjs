import assert from "node:assert/strict";
import { createPluginRegistryBackup, restorePluginRegistryBackup } from "../src/core/extensions/registry.ts";

const entries = [{
  plugin_id: "example.hello",
  version: "0.1.0",
  source: "package",
  install_path: "app_data/plugins/example.hello/versions/0.1.0",
  manifest: JSON.stringify({ id: "example.hello", version: "0.1.0" }),
  verified: true,
  state: "active",
  last_error: null,
  installed_at: 100,
  updated_at: 200,
}];

const backup = createPluginRegistryBackup(entries);
const restored = restorePluginRegistryBackup(backup);
assert.deepEqual(restored, entries);
assert.equal(backup.includes("index.js"), false, "registry backup stores metadata, not plugin code");
await assert.rejects(
  async () => restorePluginRegistryBackup(backup.replace('"verified": true', '"verified": false')),
  /unverified plugin cannot be active/,
);
await assert.rejects(
  async () => restorePluginRegistryBackup(backup.replace('"version": "0.1.0"', '"version": "9.9.9"')),
  /does not match registry key/,
);
console.log("Plugin registry backup/restore checks passed.");
