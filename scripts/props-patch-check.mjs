// Hive #36 (PROPS-PATCH): the Properties panel writes only the keys the user
// changed onto the current props, never its whole (possibly stale) copy.
//   node --experimental-strip-types scripts/props-patch-check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergePropsEdit, parsePropsText } from "../plugins/builtin/props-patch.ts";

// The panel loaded {status, priority}; a plugin then added a number and a tag and set priority.
const base = { status: "todo", priority: "none" };
const fresh = { status: "todo", priority: "high", tags: ["projx"], schemaNumber: 2 };
// The user changes Status in the stale panel.
assert.deepEqual(mergePropsEdit(fresh, base, { ...base, status: "in-progress" }),
  { status: "in-progress", priority: "high", tags: ["projx"], schemaNumber: 2 }, "the edit lands, the outside change survives");
// A key the user changed wins over an outside change to the same key.
assert.deepEqual(mergePropsEdit({ status: "done" }, { status: "todo" }, { status: "blocked" }), { status: "blocked" }, "same key: the user's edit wins");
// Removing a field (custom field delete sets undefined / drops the key) removes it, nothing else.
assert.deepEqual(mergePropsEdit({ a: 1, b: 2, c: 3 }, { a: 1, b: 2 }, { a: 1 }), { a: 1, c: 3 }, "dropped key removed");
assert.deepEqual(mergePropsEdit({ a: 1, b: 2 }, { a: 1, b: 2 }, { a: 1, b: undefined }), { a: 1 }, "undefined value removed");
// Arrays and objects compare by value: re-setting the same tags is no change.
assert.deepEqual(mergePropsEdit({ tags: ["x", "y"] }, { tags: ["x"] }, { tags: ["x"] }), { tags: ["x", "y"] }, "unchanged array keeps the fresh value");
assert.deepEqual(mergePropsEdit({ tags: ["x", "y"] }, { tags: ["x"] }, { tags: ["x", "z"] }), { tags: ["x", "z"] }, "changed array takes the edit");
// Nothing changed: fresh as is.
assert.deepEqual(mergePropsEdit({ q: 1 }, { p: 1 }, { p: 1 }), { q: 1 }, "no edit, no write of stale keys");
assert.deepEqual(parsePropsText("{oops"), {});
assert.deepEqual(parsePropsText("[1]"), {});
assert.deepEqual(parsePropsText(null), {});

// The panel uses it for both writes and reloads on workspace changes.
const ui = readFileSync(new URL("../plugins/builtin/properties-ui.tsx", import.meta.url), "utf8");
assert.ok((ui.match(/mergePropsEdit\(/g) ?? []).length >= 1, "properties-ui saves through mergePropsEdit");
assert.ok(!/props: JSON\.stringify\(next\)/.test(ui), "no full-copy write left");
assert.ok(/workspace\.changed/.test(ui), "the panel reloads on workspace.changed");
console.log("props-patch check passed");
