// Puts the pinned Node runtime at mcp-server/runtime/node.exe, where the
// installer bundle (tauri.conf.json bundle.resources) and src-tauri/src/ai.rs
// expect it. The file is git-ignored; version and hash live in
// mcp-server/runtime/README.md and must be changed together with these lines.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION = "v24.21.0";
const SHA256 = "ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32";
const target = fileURLToPath(new URL("../mcp-server/runtime/node.exe", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (existsSync(target) && sha(readFileSync(target)) === SHA256) {
  console.log(`node runtime ${VERSION} already in place`);
  process.exit(0);
}
const url = `https://nodejs.org/dist/${VERSION}/win-x64/node.exe`;
console.log(`downloading ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
const bytes = Buffer.from(await res.arrayBuffer());
const got = sha(bytes);
if (got !== SHA256) throw new Error(`SHA-256 mismatch: expected ${SHA256}, got ${got}`);
writeFileSync(`${target}.part`, bytes);
renameSync(`${target}.part`, target);
console.log(`node runtime ${VERSION} written to mcp-server/runtime/node.exe`);
