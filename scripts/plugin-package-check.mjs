import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadPluginPackage } from "../src/core/extensions/package.ts";

const root = resolve("plugins/examples/hello-plugin");
const files = new Map([
  ["plugin.json", await readFile(resolve(root, "plugin.json"), "utf8")],
  ["index.js", await readFile(resolve(root, "index.js"), "utf8")],
]);
const artifact = await loadPluginPackage({
  readText: async (path) => files.get(path) ?? (() => { throw new Error(`missing package file: ${path}`); })(),
}, true);
assert.equal(artifact.manifest.id, "example.hello");
assert.equal(artifact.verified, true);

await assert.rejects(
  () => loadPluginPackage({
    readText: async (path) => path === "plugin.json"
      ? JSON.stringify({ ...artifact.manifest, entry: "../escape.js" })
      : "export default {};",
  }, true),
  /safe relative path/,
);
console.log("Plugin package checks passed.");
