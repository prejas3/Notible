/**
 * Loads the Pomodoro example the way Notible loads any third-party package —
 * through the real directory loader and a real ExtensionHost — and drives it.
 *
 * This is the only automated cover the third-party plugin path has: it is the
 * one example package built entirely against the public contract, so if the
 * contract regresses, this is what notices.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ExtensionHost } from "../src/core/extensions/host.ts";
import { loadLocalPluginDirectory } from "../src/core/extensions/loader.ts";
import { LocalPluginManager } from "../src/core/extensions/manager.ts";

const root = resolve("plugins/examples/pomodoro");
const reader = { readText: async (_root, path) => readFile(path, "utf8") };

const artifact = await loadLocalPluginDirectory(root, reader, true);
assert.equal(artifact.manifest.id, "example.pomodoro");
assert.equal(artifact.manifest.entry, "main.js");
assert.deepEqual(artifact.manifest.permissions, ["workspace.ui"]);

const notices = [];
const host = new ExtensionHost(undefined, {
  notice: (pluginId, message) => { notices.push({ pluginId, message }); return { dispose() {} }; },
  modal: () => ({ dispose() {} }),
  menu: () => ({ dispose() {} }),
  suggest: async () => null,
});
const manager = new LocalPluginManager(host);
await manager.install(artifact);

const snapshot = host.getSnapshot("example.pomodoro")[0];
assert.deepEqual(snapshot.commands.map((command) => command.id).sort(), ["status", "toggle"]);
assert.deepEqual(Object.keys(snapshot.slots), ["workspace.sidebar"], "the timer must land in a slot Core actually renders");

const registration = snapshot.slots["workspace.sidebar"][0];
assert.equal(typeof registration.mount, "function", "a third-party surface must use the public mount contract");

// Drive the command, not the internals: this is what a user's keypress does.
const toggle = snapshot.commands.find((command) => command.id === "toggle");
assert.equal(toggle.execute().running, true, "first invocation starts the timer");
assert.equal(toggle.execute().running, false, "second invocation pauses it");

const status = snapshot.commands.find((command) => command.id === "status").execute();
assert.equal(status.phase, "work");
assert.equal(status.remaining, 25 * 60);
assert.equal(status.completed, 0);

// Mount against a real element. There is no DOM here, so this asserts the
// contract's shape — that mount is callable with a container and returns a
// disposable — rather than what it paints.
let mounted = null;
const fakeElement = {
  children: [],
  style: {},
  replaceChildren() { this.children = []; },
  append(...nodes) { this.children.push(...nodes); },
  addEventListener() {},
};
globalThis.document = {
  createElement: () => ({
    style: {},
    children: [],
    replaceChildren() { this.children = []; },
    append(...nodes) { this.children.push(...nodes); },
    addEventListener() {},
    set textContent(value) { this._text = value; },
    get textContent() { return this._text; },
  }),
};
try {
  mounted = registration.mount({
    container: fakeElement,
    plugin: null,
    theme: { mode: "paper", token: () => "" },
    openObject: async () => {},
    notifyChanged: () => {},
  });
  assert.equal(typeof mounted.dispose, "function", "mount must return a disposable");
  assert.equal(fakeElement.children.length, 1, "mount must render into the container it was given");
} finally {
  mounted?.dispose();
  delete globalThis.document;
}

// Skipping a phase is what fires the Core-owned toast.
snapshot.commands.find((command) => command.id === "status");
const before = notices.length;
host.getPluginContext("example.pomodoro").ui.notice("probe");
assert.equal(notices.length, before + 1);
assert.equal(notices[notices.length - 1].pluginId, "example.pomodoro", "the host must attribute the overlay to its caller");

// onunload must clear the interval, or the plugin keeps ticking after removal
// (and this script would never exit).
await manager.uninstall("example.pomodoro", artifact.manifest.version);
assert.equal(host.getSnapshot("example.pomodoro").length, 0);

console.log("Pomodoro example checks passed.");
