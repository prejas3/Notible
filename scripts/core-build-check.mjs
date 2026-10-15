import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(root, "dist-core");
assert(existsSync(resolve(output, "index.html")), "Core build must emit index.html for Tauri asset loading");
const files = readdirSync(resolve(output, "assets"));
assert(files.length > 0, "Core build must emit an asset bundle");
const source = files.map((file) => readFileSync(resolve(output, "assets", file), "utf8")).join("\n");
for (const forbidden of ["App.tsx", "plugins/builtin", "src/lib/api", "builtin-domain-ui"]) {
  assert(!source.includes(forbidden), `Core artifact contains forbidden domain dependency: ${forbidden}`);
}
console.log(`Core build checks passed: ${files.length} assets, no builtin/domain bundle references.`);
