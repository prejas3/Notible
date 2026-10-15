import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ExtensionHost } from "../src/core/extensions/host.ts";
import { loadLocalPluginDirectory } from "../src/core/extensions/loader.ts";
import { LocalPluginManager } from "../src/core/extensions/manager.ts";

const root = resolve("plugins/examples/hello-plugin");
const reader = { readText: async (_root, path) => readFile(path, "utf8") };
const artifact = await loadLocalPluginDirectory(root, reader, true);
assert.equal(artifact.manifest.id, "example.hello");
assert.equal(artifact.manifest.entry, "index.js");
assert.equal(artifact.verified, true);

const host = new ExtensionHost();
const manager = new LocalPluginManager(host);
await manager.install(artifact);
assert.equal(host.getSnapshot("example.hello")[0].commands[0].id, "say-hello-local");

await assert.rejects(
  () => loadLocalPluginDirectory(root, reader, false).then((candidate) => new LocalPluginManager(new ExtensionHost()).install(candidate)),
  /not verified/,
);
await assert.rejects(
  () => loadLocalPluginDirectory(root, { readText: async () => JSON.stringify({ ...artifact.manifest, entry: "../outside.js" }) }, true),
  /must stay inside/,
);

console.log("Local plugin loader checks passed.");
