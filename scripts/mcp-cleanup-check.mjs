// MCP-CLEANUP (Hive #22): approving an AI cleanup must not run while the open
// note has unsaved or unsaveable text. The rules themselves are tested in
// Rust (src-tauri/src/mcp_cleanup.rs) and mcp-server/test.js.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { settleDrafts } from "../src/core/app/settleDrafts.ts";

const noWait = async () => {};
const FAIL = "could not be saved";

/** The panel's order: settle the drafts, and only then ask Rust to apply. */
async function approve(state) {
  let applied = false;
  try {
    await settleDrafts(state, FAIL, 100, noWait);
    applied = true;
  } catch (error) {
    return { applied, error: error.message };
  }
  return { applied };
}

// Nothing unsaved: goes ahead without saving.
let saves = 0;
assert.deepEqual(await approve({ busy: () => false, dirty: () => false, save: async () => { saves += 1; return true; } }), { applied: true });
assert.equal(saves, 0);

// Unsaved text that saves: saved first, then goes ahead.
let dirty = true;
assert.deepEqual(await approve({ busy: () => false, dirty: () => dirty, save: async () => { dirty = false; return true; } }), { applied: true });

// A save in flight that finishes: waits for it.
let busyTicks = 3;
assert.deepEqual(await approve({ busy: () => busyTicks-- > 0, dirty: () => false, save: async () => true }), { applied: true });

// The save fails: blocked, nothing applied.
assert.deepEqual(await approve({ busy: () => false, dirty: () => true, save: async () => false }), { applied: false, error: FAIL });

// A save that never settles (stuck in flight): blocked instead of going ahead after a timeout.
assert.deepEqual(await approve({ busy: () => true, dirty: () => true, save: async () => true }), { applied: false, error: FAIL });

// The draft stays dirty although each save "succeeds" (typing keeps going): blocked.
assert.deepEqual(await approve({ busy: () => false, dirty: () => true, save: async () => true }), { applied: false, error: FAIL });

// Wiring: the panel settles before the apply call, and the app hands it the strict flush.
const panel = readFileSync(new URL("../src/core/app/McpCleanupPanel.tsx", import.meta.url), "utf8");
assert.ok(panel.indexOf("await flush();") > 0 && panel.indexOf("await flush();") < panel.indexOf('invoke<ApplyOutcome>("mcp_cleanup_apply"'), "flush runs before mcp_cleanup_apply");
const app = readFileSync(new URL("../src/core/app/CoreOnlyApp.tsx", import.meta.url), "utf8");
assert.match(app, /<McpCleanupPanel .*flush=\{flushPendingSaveStrict\}/, "the panel gets the strict flush");
assert.match(app, /lastSaveFailedRef\.current = true;\s*showError\(value\);/, "a failed save is recorded for the strict flush");

console.log("mcp-cleanup check: ok");
