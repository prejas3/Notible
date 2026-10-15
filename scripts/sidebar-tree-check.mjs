import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expandSidebarTree, readSidebarTreeMode, saveSidebarTreeMode, SIDEBAR_TREE_MODE_KEY } from "../src/core/app/sidebar-tree.ts";

// Navigate across nested workspaces, projects and folders without losing
// existing user expansions. Auto reveals every ancestor, never the leaf.
const clickedOpen = new Set(["other-folder"]);
const path = ["workspace", "project", "folder"];
const auto = expandSidebarTree(clickedOpen, path, "auto");
assert.deepEqual([...auto], ["other-folder", ...path]);
assert.deepEqual([...clickedOpen], ["other-folder"], "do not mutate React state");
assert.equal(expandSidebarTree(auto, path, "auto"), auto, "already visible path is a no-op");
assert.equal(expandSidebarTree(clickedOpen, [], "auto"), clickedOpen, "top-level note changes nothing");

// Manual retains explicit expansions and collapses across repeated navigation,
// including a parent reveal requested by creation or moving an object.
assert.equal(expandSidebarTree(clickedOpen, path, "manual"), clickedOpen);
const collapsed = new Set(auto);
collapsed.delete("project");
for (const nextPath of [path, ["second-workspace", "second-project"], ["project"], []]) {
  assert.equal(expandSidebarTree(collapsed, nextPath, "manual"), collapsed);
}
assert.equal(collapsed.has("project"), false, "navigation never undoes a manual collapse");
const reopened = new Set(collapsed).add("project");
assert.equal(expandSidebarTree(reopened, path, "manual"), reopened, "manual clicks still take effect");
assert.ok(expandSidebarTree(collapsed, path, "auto").has("project"), "switching back to auto reveals the current path");

// Model a restart by reading only persisted storage, with no React state.
const stored = new Map([["notible-core-expanded", JSON.stringify([...collapsed])]]);
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
try {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  } });
  assert.equal(readSidebarTreeMode(), "auto", "existing users default to auto");
  stored.set(SIDEBAR_TREE_MODE_KEY, "unknown");
  assert.equal(readSidebarTreeMode(), "auto", "invalid preference falls back to auto");
  for (const mode of ["manual", "auto", "manual"]) {
    saveSidebarTreeMode(mode);
    assert.equal(readSidebarTreeMode(), mode, "preference survives a restart");
  }
  assert.deepEqual(JSON.parse(stored.get("notible-core-expanded")), [...collapsed], "changing mode preserves saved tree state");
  const restored = new Set(JSON.parse(stored.get("notible-core-expanded")));
  assert.equal(expandSidebarTree(restored, path, readSidebarTreeMode()), restored, "manual restart does not reveal ancestors");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("storage unavailable"); } });
  assert.equal(readSidebarTreeMode(), "auto");
  assert.doesNotThrow(() => saveSidebarTreeMode("manual"));
} finally {
  if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
  else delete globalThis.localStorage;
}

// Guard the shell wiring: every implicit expansion uses the policy, while
// clicks and expanded-id persistence keep their independent existing paths.
const app = readFileSync(new URL("../src/core/app/CoreOnlyApp.tsx", import.meta.url), "utf8");
assert.equal([...app.matchAll(/setExpandedIds\(/g)].length, 2, "only the policy and explicit tree toggle may write expandedIds");
assert.match(app, /expandSidebarTree\(current, ids, sidebarTreeModeRef\.current\)/);
assert.match(app, /revealInSidebar\(selectedPath\.map/);
assert.match(app, /\[selectedPath, sidebarTreeMode\]/);
assert.match(app, /useState<SidebarTreeMode>\(readSidebarTreeMode\)/);
assert.match(app, /saveSidebarTreeMode\(sidebarTreeMode\)/);
assert.match(app, /<Select id="core-sidebar-tree"/);
assert.match(app, /localStorage\.setItem\("notible-core-expanded", JSON\.stringify\(\[\.\.\.expandedIds\]\)\)/);
for (const locale of ["en", "pl"]) {
  const strings = JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8")).strings.app;
  for (const label of ["Sidebar tree", "Auto-expand to the open note", "Manual (only what I expand)"]) {
    assert.ok(strings[label], `${locale} translation missing: ${label}`);
  }
}
console.log("sidebar-tree-check: auto/manual navigation, manual collapse, restart persistence and shell wiring passed");
