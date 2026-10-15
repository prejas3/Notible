// SYNC-MERGE-A (Hive #5): copy plugins/shared/sync-merge.js into both Sync
// plugins. A relative import would break the dev-mock data: loader and the
// Reload cache-buster, and add a second file to the market package.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const OPEN = "// <sync-merge>\n";
const CLOSE = "// </sync-merge>";
const TARGETS = ["plugins/notible-sync/main.js", "plugins/notible-sync-simple/main.js"];

export function sourceBlock() {
  return readFileSync(root + "plugins/shared/sync-merge.js", "utf8").replace(/\r\n/g, "\n");
}

export function inlinedBlock(text) {
  const start = text.indexOf(OPEN);
  const end = text.indexOf(CLOSE);
  if (start < 0 || end < start) throw new Error("sync-merge markers missing");
  return text.slice(start + OPEN.length, end);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const block = sourceBlock();
  for (const target of TARGETS) {
    const text = readFileSync(root + target, "utf8").replace(/\r\n/g, "\n");
    const start = text.indexOf(OPEN) + OPEN.length;
    const end = start + inlinedBlock(text).length;
    writeFileSync(root + target, text.slice(0, start) + block + text.slice(end));
    console.log(`inlined into ${target}`);
  }
}
