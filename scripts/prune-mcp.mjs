// Slim mcp-server/node_modules before bundling: strips files that are never
// touched at runtime (the MCP server runs prebuilt JS + a prebuilt .node).
// Idempotent — safe to run before every `tauri build`.
// ponytail: prunes only known compile-time/dev artifacts, keeps all *.js / *.node / package.json / LICENSE.
import { readdirSync, statSync, rmSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "mcp-server", "node_modules");

// Whole directories that only matter for building/testing/docs.
const DROP_DIRS = new Set(["test", "tests", "docs", "example", "examples", ".github", "coverage", "man"]);
// File extensions with no runtime role for a JS server.
const DROP_EXTS = new Set([".md", ".markdown", ".map", ".ts", ".flow", ".d.ts"]);
// better-sqlite3 ships the C amalgamation (deps/) and C++ sources (src/) used
// only to compile; the prebuilt binary lives in build/Release.
const DROP_PATHS = [
  join(root, "better-sqlite3", "deps"),
  join(root, "better-sqlite3", "src"),
];

let freed = 0;
function sizeOf(path) {
  const st = statSync(path);
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0);
}
function drop(path) {
  try { freed += sizeOf(path); rmSync(path, { recursive: true, force: true }); } catch { /* already gone */ }
}
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    let st;
    try { st = statSync(path); } catch { continue; }
    if (st.isDirectory()) {
      if (DROP_DIRS.has(name)) { drop(path); continue; }
      walk(path);
    } else if (DROP_EXTS.has(extname(name)) && basename(name) !== "LICENSE.md") {
      drop(path);
    }
  }
}

for (const path of DROP_PATHS) drop(path);
walk(root);
console.log(`prune-mcp: freed ~${(freed / 1024 / 1024).toFixed(1)} MB`);
