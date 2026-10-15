import assert from "node:assert/strict";
import { ExtensionHost, MIN_SCHEDULER_INTERVAL_MS } from "../src/core/extensions/host.ts";
import { isApiVersionCompatible, validatePluginManifest } from "../packages/plugin-api/src/index.ts";
import { helloPlugin } from "../plugins/examples/hello-plugin.ts";
import { PluginManifestError } from "../src/core/extensions/manifest.ts";
import { LocalPluginManager } from "../src/core/extensions/manager.ts";

const host = new ExtensionHost();
let loaded = false;
let unloaded = false;
let observed = 0;
let hostChanges = 0;
const runtimeErrors = [];

const plugin = {
  manifest: { id: "example.plugin", name: "Example", version: "1.0.0", apiVersion: "0.1", permissions: ["workspace.ui"] },
  async onload(ctx) {
    loaded = true;
    ctx.commands.register({ id: "hello", name: "Hello", execute: () => "hello" });
    ctx.views.register({ id: "view", title: "Example view", render: {} });
    ctx.settings.register({ id: "settings", title: "Example settings", render: {} });
    ctx.ui.registerSlot("editor.toolbar", { id: "action", render: {} });
    ctx.events.on("object.created", () => { observed += 1; });
    ctx.storage.set("counter", 1);
  },
  onunload() {
    unloaded = true;
  },
};

const hostChangeSubscription = host.onChange(() => { hostChanges += 1; });
const hostErrorSubscription = host.onError((error) => runtimeErrors.push(error));
await host.enable(plugin);
assert.equal(loaded, true);
assert.deepEqual(host.getSnapshot("example.plugin").map((item) => ({
  pluginId: item.pluginId,
  commands: item.commands.map((value) => value.id),
  views: item.views.map((value) => value.id),
  settings: item.settings.map((value) => value.id),
  slots: Object.fromEntries(Object.entries(item.slots).map(([key, values]) => [key, values.map((value) => value.id)])),
})), [{
  pluginId: "example.plugin",
  commands: ["hello"],
  views: ["view"],
  settings: ["settings"],
  slots: { "editor.toolbar": ["action"] },
}]);
host.emit("object.created", { id: "one" });
assert.equal(observed, 1);
assert.equal(await host.disable("example.plugin"), true);
assert.equal(hostChanges, 2, "host consumers must be notified after enable and disable");
hostChangeSubscription.dispose();

const injectedDataApi = {
  media: { read: async (ref) => `global:${ref}`, readOwned: async (pluginId, ref) => { if (ref !== "media/owned.png") throw new Error("not owned"); return `${pluginId}:${ref}`; }, pickImageForPlugin: async (pluginId) => `picked:${pluginId}`, importImageForPlugin: async (pluginId, url) => `imported:${pluginId}:${url}` },
  objects: { get: async () => null, create: async (input) => input, update: async (id) => id, trash: async () => null, query: async () => [] },
  relations: { list: async () => [], create: async (fromId, toId, kind) => ({ from_id: fromId, to_id: toId, kind }), delete: async () => true },
  types: { list: async () => [], upsert: async (name) => ({ name, schema: "{}", icon: null, color: null }) },
  dataSources: { list: async () => [], upsert: async (name, definition, id) => ({ id: id ?? "source-1", name, definition, created_at: 1, updated_at: 1 }), delete: async () => true },
};
let receivedDataApi;
const dataHost = new ExtensionHost(injectedDataApi);
await dataHost.enable({
  manifest: { id: "example.data", name: "Data", version: "1.0.0", apiVersion: "0.1", permissions: ["data.read"] },
  async onload(context) { receivedDataApi = context.data; assert.equal(await context.data.objects.get("missing"), null); },
});
assert.notEqual(receivedDataApi, injectedDataApi, "plugins must receive a permission-scoped DataApi");
await assert.rejects(() => receivedDataApi.objects.create({ type: "note", title: "blocked" }), /lacks permission data.write/);
assert.equal(unloaded, true);
const mediaHost = new ExtensionHost(injectedDataApi);
let mediaContext;
mediaHost.setUserGestureCheck(() => false);
await mediaHost.enable({
  manifest: { id: "example.media", name: "Media", version: "1.0.0", apiVersion: "0.1", permissions: ["media.write"] },
  async onload(context) { mediaContext = context; },
});
assert.equal(await mediaContext.data.media.read("media/owned.png"), "example.media:media/owned.png");
await assert.rejects(() => mediaContext.data.media.read("media/other.png"), /not owned/);
await assert.rejects(() => mediaContext.data.media.pickImage(), /only works right after the user clicks/);
mediaHost.setUserGestureCheck(() => true);
assert.equal(await mediaContext.data.media.pickImage(), "picked:example.media");
// API 1.28: importImageFromUrl needs media.write + network + declared hosts (Rust re-checks all of it).
await assert.rejects(() => mediaContext.data.media.importImageFromUrl("https://covers.openlibrary.org/a.jpg"), /lacks permission network/);
await mediaHost.disable("example.media");
for (const [id, permissions, networkHosts, expected] of [
  ["example.nowrite", ["network"], ["covers.openlibrary.org"], /lacks permission media.write/],
  ["example.nohosts", ["network", "media.write"], undefined, /declares no networkHosts/],
]) {
  let importContext;
  await mediaHost.enable({ manifest: { id, name: id, version: "1.0.0", apiVersion: "1.28", permissions, networkHosts }, async onload(context) { importContext = context; } });
  await assert.rejects(() => importContext.data.media.importImageFromUrl("https://covers.openlibrary.org/a.jpg"), expected);
  await mediaHost.disable(id);
}
let importer;
await mediaHost.enable({ manifest: { id: "example.import", name: "Import", version: "1.0.0", apiVersion: "1.28", permissions: ["network", "media.write"], networkHosts: ["covers.openlibrary.org"] }, async onload(context) { importer = context; } });
assert.equal(await importer.data.media.importImageFromUrl("https://covers.openlibrary.org/a.jpg"), "imported:example.import:https://covers.openlibrary.org/a.jpg");
await mediaHost.disable("example.import");
await assert.rejects(() => mediaHost.enable({ manifest: { id: "example.hostsnonet", name: "X", version: "1.0.0", apiVersion: "1.28", permissions: ["media.write"], networkHosts: ["a.example.org"] }, onload() {} }), /needs the network permission/);
await assert.rejects(() => mediaHost.enable({ manifest: { id: "example.badhost", name: "X", version: "1.0.0", apiVersion: "1.28", permissions: ["network"], networkHosts: ["https://a.example.org"] }, onload() {} }), /networkHosts must be/);
// A disabled plugin is absent from the snapshot, not present-but-empty. The
// old expectation here was a phantom entry: getSnapshot(id) built a record for
// any id it was handed, whether or not that plugin was enabled.
assert.deepEqual(host.getSnapshot("example.plugin"), []);
assert.deepEqual(host.getSnapshot("never.installed"), []);
host.emit("object.created", { id: "two" });
assert.equal(observed, 1, "disabling a plugin must remove its event handlers");

// providedTypes: a plugin's data.types.upsert calls surface in its snapshot,
// and vanish when it is disabled (so Core can hide a stranded type's objects).
const typeHost = new ExtensionHost(injectedDataApi);
await typeHost.enable({
  manifest: { id: "example.types", name: "Types", version: "1.0.0", apiVersion: "0.1", permissions: ["data.read", "data.write"] },
  async onload(context) {
    await context.data.types.upsert("example.types.thing", "{}");
    await context.data.types.upsert("example.types.thing", "{}"); // idempotent
    await context.data.types.upsert("example.types.other", "{}");
  },
});
assert.deepEqual(
  typeHost.getSnapshot("example.types")[0].providedTypes,
  ["example.types.other", "example.types.thing"],
  "providedTypes lists every type the plugin upserted, sorted, de-duped",
);
await typeHost.disable("example.types");
assert.deepEqual(typeHost.getSnapshot("example.types"), [], "a disabled plugin provides no types");

await host.enable(plugin);
assert.equal(host.getSnapshot("example.plugin")[0].commands[0].id, "hello");
assert.equal(await host.disable("example.plugin"), true);

await assert.rejects(
  () => host.enable({
    manifest: { id: "broken.plugin", name: "Broken", version: "1.0.0", apiVersion: "0.1", permissions: ["workspace.ui"] },
    onload(ctx) {
      ctx.commands.register({ id: "one", name: "One", execute: () => null });
      throw new Error("intentional load failure");
    },
  }),
  /intentional load failure/,
);
// A plugin whose onload threw is not enabled, so it is absent entirely —
// including the registration it managed to make before throwing.
assert.deepEqual(host.getSnapshot("broken.plugin"), []);
assert.deepEqual(runtimeErrors.map((error) => ({ pluginId: error.pluginId, phase: error.phase, message: error.message })), [
  { pluginId: "broken.plugin", phase: "load", message: "intentional load failure" },
]);
hostErrorSubscription.dispose();

const permissionHost = new ExtensionHost();
// C8: registering UI (a view here) still requires workspace.ui.
await assert.rejects(
  () => permissionHost.enable({
    manifest: { id: "example.no-ui", name: "No UI", version: "1.0.0", apiVersion: "0.1" },
    onload(context) {
      assert.equal(context.permissions.has("workspace.ui"), false);
      assert.throws(() => context.permissions.require("workspace.ui"), /lacks permission workspace.ui/);
      context.views.register({ id: "blocked", title: "Blocked", render: {} });
    },
  }),
  /lacks permission workspace.ui/,
);

// C8: a plugin that registers only headless commands must not be forced to
// declare workspace.ui just to load.
const commandOnlyHost = new ExtensionHost();
await commandOnlyHost.enable({
  manifest: { id: "example.commands-only", name: "Commands only", version: "1.0.0", apiVersion: "0.1" },
  onload(context) {
    context.commands.register({ id: "no-ui-command", name: "No UI command", execute: () => "ok" });
  },
});
assert.equal(commandOnlyHost.getSnapshot("example.commands-only")[0].commands[0].id, "no-ui-command");
await commandOnlyHost.disable("example.commands-only");

const commandHost = new ExtensionHost();
const commandErrors = [];
commandHost.onError((error) => commandErrors.push(error));
await commandHost.enable({
  manifest: { id: "example.error", name: "Error fixture", version: "1.0.0", apiVersion: "0.1", permissions: ["workspace.ui"] },
  onload(context) {
    context.commands.register({ id: "fail", name: "Fail", execute: () => { throw new Error("command failure"); } });
  },
});
assert.throws(() => commandHost.getSnapshot("example.error")[0].commands[0].execute(), /command failure/);
assert.deepEqual(commandErrors.map((error) => ({ pluginId: error.pluginId, phase: error.phase, message: error.message })), [
  { pluginId: "example.error", phase: "command", message: "command failure" },
]);
await commandHost.disable("example.error");

const fixtureHost = new ExtensionHost();
await fixtureHost.enable(helloPlugin);
assert.deepEqual(fixtureHost.getSnapshot("example.hello").map((item) => ({
  commands: item.commands.map((value) => value.id),
  views: item.views.map((value) => value.id),
  slots: Object.fromEntries(Object.entries(item.slots).map(([key, values]) => [key, values.map((value) => value.id)])),
})), [{
  commands: ["say-hello"],
  views: ["hello-view"],
  slots: { "editor.toolbar": ["hello-action"] },
}]);
await fixtureHost.disable("example.hello");

await assert.rejects(
  () => fixtureHost.enable({
    manifest: { id: "Invalid ID", name: "Invalid", version: "1.0.0", apiVersion: "0.1" },
    onload() {},
  }),
  (error) => error instanceof PluginManifestError && error.manifestId === "Invalid ID",
);

const oldVersion = {
  manifest: { id: "example.replace", name: "Replace fixture", version: "1.0.0", apiVersion: "0.1", permissions: ["workspace.ui"] },
  onload(ctx) {
    ctx.commands.register({ id: "version", name: "Version 1", execute: () => "1" });
  },
};
const brokenVersion = {
  manifest: { id: "example.replace", name: "Replace fixture", version: "2.0.0", apiVersion: "0.1", permissions: ["workspace.ui"] },
  onload() {
    throw new Error("broken replacement");
  },
};
await fixtureHost.enable(oldVersion);
assert.deepEqual(await fixtureHost.replace(brokenVersion), { replaced: false, rolledBack: true });
assert.deepEqual(fixtureHost.getSnapshot("example.replace")[0].commands.map((value) => value.id), ["version"]);
assert.equal((await fixtureHost.replace({
  manifest: { id: "example.replace", name: "Replace fixture", version: "2.0.0", apiVersion: "0.1", permissions: ["workspace.ui"] },
  onload(ctx) {
    ctx.commands.register({ id: "version", name: "Version 2", execute: () => "2" });
  },
})).replaced, true);
assert.equal(fixtureHost.getSnapshot("example.replace")[0].commands[0].name, "Version 2");
await fixtureHost.disable("example.replace");

const managerHost = new ExtensionHost();
const manager = new LocalPluginManager(managerHost);
const managerV1 = {
  manifest: { id: "example.managed", name: "Managed fixture", version: "1.0.0", apiVersion: "0.1", permissions: ["workspace.ui"] },
  onload(ctx) { ctx.commands.register({ id: "version", name: "Managed v1", execute: () => "1" }); },
};
const managerBrokenV2 = {
  manifest: { id: "example.managed", name: "Managed fixture", version: "2.0.0", apiVersion: "0.1", permissions: ["workspace.ui"] },
  onload() { throw new Error("broken managed version"); },
};
const managerV3 = {
  manifest: { id: "example.managed", name: "Managed fixture", version: "3.0.0", apiVersion: "0.1", permissions: ["workspace.ui"] },
  onload(ctx) { ctx.commands.register({ id: "version", name: "Managed v3", execute: () => "3" }); },
};
await manager.install({ manifest: managerV1.manifest, plugin: managerV1, source: "local-file", verified: true });
const failedInstall = await manager.install({ manifest: managerBrokenV2.manifest, plugin: managerBrokenV2, source: "local-file", verified: true });
assert.deepEqual(failedInstall, { id: "example.managed", activeVersion: "1.0.0", installedVersions: ["1.0.0"], status: "failed", source: "local-file" });
assert.equal((await manager.install({ manifest: managerV3.manifest, plugin: managerV3, source: "local-file", verified: true })).activeVersion, "3.0.0");
assert.equal(managerHost.getSnapshot("example.managed")[0].commands[0].name, "Managed v3");
assert.equal((await manager.uninstall("example.managed"))?.activeVersion, "1.0.0");
await assert.rejects(
  () => manager.install({
    manifest: { ...managerV3.manifest, version: "4.0.0" },
    plugin: { ...managerV3, manifest: { ...managerV3.manifest, version: "4.0.0" } },
    source: "local-file",
    verified: false,
  }),
  /not verified/,
);

// Dependency enforcement: a plugin declaring `dependencies` cannot enable
// before its dependency, and the dependency cannot disable while depended on.
const depHost = new ExtensionHost();
const base = { manifest: { id: "example.base", name: "Base", version: "1.0.0", apiVersion: "0.1", permissions: [] }, onload() {} };
const dependent = { manifest: { id: "example.dependent", name: "Dependent", version: "1.0.0", apiVersion: "0.1", permissions: [], dependencies: { "example.base": "1.0.0" } }, onload() {} };
await assert.rejects(() => depHost.enable(dependent), /requires example.base/);
await depHost.enable(base);
await depHost.enable(dependent);
await assert.rejects(() => depHost.disable("example.base"), /required by example.dependent/);
await depHost.disable("example.dependent");
assert.equal(await depHost.disable("example.base"), true);

// An unknown slot name renders nowhere, so it is reported and skipped rather
// than thrown: throwing happens inside onload and would take the whole plugin
// down, including its valid registrations.
const slotHost = new ExtensionHost();
const slotErrors = [];
slotHost.onError((error) => slotErrors.push(error));
await slotHost.enable({
  manifest: { id: "example.slots", name: "Slots", version: "1.0.0", apiVersion: "0.1", permissions: ["workspace.ui"] },
  onload(ctx) {
    ctx.ui.registerSlot("workspace.sidebar", { id: "good", render: {} });
    ctx.ui.registerSlot("nope.invented", { id: "bad", render: {} });
  },
});
const slotSnapshot = slotHost.getSnapshot().find((entry) => entry.pluginId === "example.slots");
assert.deepEqual(Object.keys(slotSnapshot.slots), ["workspace.sidebar"], "unknown slot must not reach the snapshot");
assert.equal(slotSnapshot.commands.length, 0);
assert.equal(slotErrors.length, 1, "unknown slot must be reported");
assert.match(slotErrors[0].message, /unknown UI slot "nope\.invented"/);

// Overlays are Core-owned, so a host with no shell attached must fail loudly
// rather than silently swallow a modal the user never sees.
const overlayHost = new ExtensionHost();
let overlayError = null;
await overlayHost.enable({
  manifest: { id: "example.overlay", name: "Overlay", version: "1.0.0", apiVersion: "0.1", permissions: ["workspace.ui"] },
  onload(ctx) {
    try { ctx.ui.notice("hi"); } catch (error) { overlayError = error; }
  },
});
assert.match(String(overlayError), /overlay API is not configured/);

// ...and a plugin without workspace.ui cannot open one at all.
const uiPermHost = new ExtensionHost(undefined, {
  notice: () => ({ dispose() {} }),
  modal: () => ({ dispose() {} }),
  menu: () => ({ dispose() {} }),
  suggest: async () => null,
});
let permError = null;
await uiPermHost.enable({
  manifest: { id: "example.headless", name: "Headless", version: "1.0.0", apiVersion: "0.1", permissions: [] },
  onload(ctx) {
    try { ctx.ui.notice("hi"); } catch (error) { permError = error; }
  },
});
assert.match(String(permError), /lacks permission workspace\.ui/);

// API 1.1: a command can navigate. It routes to Core's sink with the calling
// plugin's id, and it is gated on workspace.ui like every other visible action
// — the whole point is that a hotkey command can open the note it just made.
const opened = [];
const navHost = new ExtensionHost(undefined, {
  notice: () => ({ dispose() {} }),
  modal: () => ({ dispose() {} }),
  menu: () => ({ dispose() {} }),
  suggest: async () => null,
  openObject: async (pluginId, id) => { opened.push([pluginId, id]); },
});
let navPermError = null;
await navHost.enable({
  manifest: { id: "example.nav", name: "Nav", version: "1.0.0", apiVersion: "1.1", permissions: ["workspace.ui"] },
  onload(ctx) {
    ctx.commands.register({ id: "go", name: "Go", execute: () => ctx.ui.openObject("obj-1") });
  },
});
await navHost.getSnapshot("example.nav")[0].commands[0].execute();
assert.deepEqual(opened, [["example.nav", "obj-1"]]);
await navHost.enable({
  manifest: { id: "example.nav2", name: "Nav2", version: "1.0.0", apiVersion: "1.1", permissions: [] },
  onload(ctx) {
    try { void ctx.ui.openObject("obj-1"); } catch (error) { navPermError = error; }
  },
});
assert.match(String(navPermError), /lacks permission workspace\.ui/);

// API 1.8: a plugin can open its OWN registered view. Three things are being
// held down here, and each of them was a real design choice:
//
//  - the calling plugin's id reaches Core from the host, never from the call,
//    so a plugin cannot open a view belonging to someone else;
//  - a view id this plugin never registered THROWS, naming both ids, because a
//    typo is a programming error and must not look like a host that cannot
//    render views;
//  - a shell that cannot render views answers `false` rather than throwing,
//    which is the whole reason the return is a boolean: the plugin falls back
//    to a modal.
const openedViews = [];
const viewOverlay = {
  notice: () => ({ dispose() {} }),
  modal: () => ({ dispose() {} }),
  menu: () => ({ dispose() {} }),
  suggest: async () => null,
  openObject: async () => {},
  openView: async (pluginId, viewId) => { openedViews.push([pluginId, viewId]); return true; },
};
const viewHost = new ExtensionHost(undefined, viewOverlay);
let viewTypoError = null;
await viewHost.enable({
  manifest: { id: "example.view", name: "View", version: "1.0.0", apiVersion: "1.8", permissions: ["workspace.ui"] },
  onload(ctx) {
    ctx.views.register({ id: "surface", title: "Surface", render: {} });
    ctx.commands.register({ id: "open", name: "Open", execute: () => ctx.ui.openView("surface") });
    ctx.commands.register({ id: "typo", name: "Typo", execute: () => ctx.ui.openView("surfcae") });
  },
});
assert.equal(await viewHost.getSnapshot("example.view")[0].commands[0].execute(), true);
assert.deepEqual(openedViews, [["example.view", "surface"]]);
// Thrown synchronously, exactly like the permission gate next to it: the call
// never gets far enough to produce a promise.
assert.throws(
  () => viewHost.getSnapshot("example.view")[0].commands[1].execute(),
  /example\.view has no registered view "surfcae"/,
);
// A view another plugin registered is not this plugin's to open: the id is
// namespaced per plugin, so the lookup simply does not find it.
await viewHost.enable({
  manifest: { id: "example.other", name: "Other", version: "1.0.0", apiVersion: "1.8", permissions: ["workspace.ui"] },
  onload(ctx) {
    ctx.commands.register({ id: "steal", name: "Steal", execute: () => ctx.ui.openView("surface") });
  },
});
assert.throws(
  () => viewHost.getSnapshot("example.other")[0].commands[0].execute(),
  /example\.other has no registered view "surface"/,
);
assert.deepEqual(openedViews, [["example.view", "surface"]], "a foreign view must never reach Core's bridge");
// A shell with nowhere to render views is not an error, it is a `false`.
const noViewHost = new ExtensionHost(undefined, { ...viewOverlay, openView: async () => false });
await noViewHost.enable({
  manifest: { id: "example.fallback", name: "Fallback", version: "1.0.0", apiVersion: "1.8", permissions: ["workspace.ui"] },
  onload(ctx) {
    ctx.views.register({ id: "surface", title: "Surface", render: {} });
    ctx.commands.register({ id: "open", name: "Open", execute: () => ctx.ui.openView("surface") });
  },
});
assert.equal(await noViewHost.getSnapshot("example.fallback")[0].commands[0].execute(), false);
// ...and it is a visible action, so it needs workspace.ui like the rest.
let viewPermError = null;
await viewHost.enable({
  manifest: { id: "example.viewperm", name: "View perm", version: "1.0.0", apiVersion: "1.8", permissions: [] },
  onload(ctx) {
    try { void ctx.ui.openView("surface"); } catch (error) { viewPermError = error; }
  },
});
assert.match(String(viewPermError), /lacks permission workspace\.ui/);

// getSnapshot must return the SAME reference until registrations change.
// React's useSyncExternalStore compares snapshots with Object.is on every
// render; a freshly-built array each call reads as "the store changed" and
// loops until React throws "Maximum update depth exceeded" (#185). That
// shipped in 0.40.0 and made the app unopenable, so it is asserted here.
const stableHost = new ExtensionHost();
await stableHost.enable({
  manifest: { id: "example.stable", name: "Stable", version: "1.0.0", apiVersion: "0.1", permissions: ["workspace.ui"] },
  onload(ctx) {
    ctx.ui.registerSlot("workspace.sidebar", { id: "one", render: {} });
  },
});
const first = stableHost.getSnapshot();
assert.equal(stableHost.getSnapshot(), first, "getSnapshot must be referentially stable between changes");
assert.equal(stableHost.getSnapshot(), first, "…and stay stable across repeated reads");
await stableHost.enable({
  manifest: { id: "example.stable-two", name: "Stable two", version: "1.0.0", apiVersion: "0.1", permissions: [] },
  onload() {},
});
const second = stableHost.getSnapshot();
assert.notEqual(second, first, "a new registration must produce a new snapshot");
assert.equal(stableHost.getSnapshot(), second);
await stableHost.disable("example.stable-two");
assert.notEqual(stableHost.getSnapshot(), second, "disabling must invalidate the snapshot");

// HIVE #37: a plugin may register a creates command after onload (for
// example, after the user saves a schema). Core subscribes to host changes to
// rebuild the + menu, so both the late registration and its disposal must
// notify. Synchronous bursts are one microtask notification, not one render
// per registration.
const dynamicHost = new ExtensionHost();
let dynamicContext;
await dynamicHost.enable({
  manifest: { id: "example.dynamic", name: "Dynamic", version: "1.0.0", apiVersion: "0.1" },
  onload(context) { dynamicContext = context; },
});
let dynamicChanges = 0;
dynamicHost.onChange(() => { dynamicChanges += 1; });
const lateCommand = dynamicContext.commands.register({
  id: "new-late-item",
  name: "New late item",
  creates: { objectType: "late.item", label: "Late item" },
  execute: () => null,
});
dynamicContext.commands.register({ id: "late-helper", name: "Late helper", execute: () => null });
assert.equal(dynamicChanges, 0, "late registrations are batched until the microtask boundary");
await Promise.resolve();
assert.equal(dynamicChanges, 1, "a burst of late registrations notifies host consumers once");
assert.ok(dynamicHost.getSnapshot("example.dynamic")[0].commands.some((command) => command.creates?.objectType === "late.item"), "the late creates command reaches the + menu snapshot");
lateCommand.dispose();
await Promise.resolve();
assert.equal(dynamicChanges, 2, "disposing a late command notifies host consumers");
assert.ok(!dynamicHost.getSnapshot("example.dynamic")[0].commands.some((command) => command.id === "new-late-item"), "the disposed command leaves the snapshot");

// The host must refuse an API version it does not offer. Until this existed
// a manifest could declare any string, including one from the future, and the
// plugin loaded anyway.
assert.equal(isApiVersionCompatible("1.0", "1.0"), true);
assert.equal(isApiVersionCompatible("1.0", "1.3"), true, "a plugin built against an older minor still runs");
assert.equal(isApiVersionCompatible("1.4", "1.0"), false, "a plugin needing a newer minor must be refused");
assert.equal(isApiVersionCompatible("2.0", "1.0"), false, "a different major must be refused");
assert.equal(isApiVersionCompatible("0.1", "1.0"), true, "pre-freeze packages carry over once");
assert.equal(isApiVersionCompatible("banana", "1.0"), false);
assert.throws(
  () => validatePluginManifest({ id: "example.future", name: "Future", version: "1.0.0", apiVersion: "9.0" }),
  /needs API 9\.0/,
);

// Permission values with no API behind them were removed at 1.0, but an
// already-installed package that declares one must still load — rejecting it
// would break a plugin on update, which is worse than granting nothing.
validatePluginManifest({ id: "example.old", name: "Old", version: "1.0.0", apiVersion: "0.1", permissions: ["filesystem.read"] });
assert.throws(
  () => validatePluginManifest({ id: "example.bogus", name: "Bogus", version: "1.0.0", apiVersion: "1.0", permissions: ["invented.permission"] }),
  /Unknown permission/,
);

// context.scheduler (API 1.9). setInterval/clearInterval are captured rather
// than actually waited out — the real interval, at its clamped one-minute
// floor, is not something a unit test should sit through — so the test
// drives the captured tick callback by hand and asserts against that.
{
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let capturedTick;
  let capturedDelay;
  let capturedTimerHandle = 0;
  let clearedHandle;
  global.setInterval = (fn, delay) => { capturedTick = fn; capturedDelay = delay; return ++capturedTimerHandle; };
  global.clearInterval = (handle) => { clearedHandle = handle; };
  try {
    const schedulerHost = new ExtensionHost();
    const schedulerErrors = [];
    schedulerHost.onError((error) => schedulerErrors.push(error));
    let ticks = 0;
    let disposable;
    await schedulerHost.enable({
      manifest: { id: "example.scheduler", name: "Scheduler", version: "1.0.0", apiVersion: "0.1" },
      onload(context) {
        disposable = context.scheduler.every(1000, () => { ticks += 1; });
      },
    });
    assert.equal(capturedDelay, MIN_SCHEDULER_INTERVAL_MS, "an interval below the floor must be clamped up to it");
    await capturedTick();
    assert.equal(ticks, 1, "the scheduled task must actually run on a tick");

    // A task that rejects must be reported like any other plugin runtime
    // error, not thrown as an unhandled rejection — and must not stop the
    // subscription from ticking again afterward.
    let failNext = true;
    let disposable2;
    await schedulerHost.enable({
      manifest: { id: "example.scheduler-error", name: "Scheduler error", version: "1.0.0", apiVersion: "0.1" },
      onload(context) {
        disposable2 = context.scheduler.every(MIN_SCHEDULER_INTERVAL_MS, () => {
          if (failNext) { failNext = false; throw new Error("scheduled task failure"); }
          ticks += 1;
        });
      },
    });
    await capturedTick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(schedulerErrors.map((error) => ({ pluginId: error.pluginId, phase: error.phase, message: error.message })), [
      { pluginId: "example.scheduler-error", phase: "scheduler", message: "scheduled task failure" },
    ]);
    await capturedTick();
    assert.equal(ticks, 2, "a failed tick must not stop future ticks");

    disposable.dispose();
    assert.equal(clearedHandle, 1, "disposing must clear the underlying interval");
    disposable2.dispose();
    await schedulerHost.disable("example.scheduler");
    await schedulerHost.disable("example.scheduler-error");
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
}

// 1.20: renderCodeBlockSvg reaches another plugin's `toSvg`; null without one.
{
  const svgHost = new ExtensionHost();
  let printer;
  await svgHost.enable({
    manifest: { id: "example.drawer", name: "Drawer", version: "1.0.0", apiVersion: "1.20", permissions: ["editor.extension"] },
    onload(ctx) { ctx.editor.registerCodeBlockRenderer("Chart", () => {}, { toSvg: async (source, mode) => `<svg>${mode}:${source}</svg>` }); },
  });
  await svgHost.enable({
    manifest: { id: "example.printer", name: "Printer", version: "1.0.0", apiVersion: "1.20", permissions: [] },
    onload(ctx) { printer = ctx; },
  });
  assert.equal(await printer.editor.renderCodeBlockSvg("chart", "a"), "<svg>paper:a</svg>");
  assert.equal(await printer.editor.renderCodeBlockSvg("chart", "b", { mode: "night" }), "<svg>night:b</svg>");
  assert.equal(await printer.editor.renderCodeBlockSvg("nothing", "c"), null);
}

// 1.24 (E14B-API, Hive #2): persistent renderers reach the snapshot; insertsBlock language is validated.
{
  const blockHost = new ExtensionHost();
  let threw = false;
  await blockHost.enable({
    manifest: { id: "example.blocks", name: "Blocks", version: "1.0.0", apiVersion: "1.24", permissions: ["editor.extension"] },
    onload(ctx) {
      ctx.editor.registerCodeBlockRenderer("x-live", () => {}, { persistent: true });
      ctx.editor.registerCodeBlockRenderer("x-plain", () => {});
      ctx.commands.register({ id: "good", name: "Good", insertsBlock: { language: "x-live" }, execute: () => "" });
      try { ctx.commands.register({ id: "bad", name: "Bad", insertsBlock: { language: "Bad Lang" }, execute: () => "" }); } catch { threw = true; }
    },
  });
  const snap = blockHost.getSnapshot().find((entry) => entry.pluginId === "example.blocks");
  assert.equal(threw, true, "an insertsBlock language that is not a lowercase id must be refused");
  assert.deepEqual(snap.commands.map((command) => command.id), ["good"]);
  assert.equal(snap.codeBlocks.find((block) => block.id === "x-live").persistent, true);
  assert.equal(snap.codeBlocks.find((block) => block.id === "x-plain").persistent, false);
}

// 1.25 (STORE-API, Hive #5): headless hosts get an in-memory store.
{
  const storeHost = new ExtensionHost();
  let ctx;
  await storeHost.enable({ manifest: { id: "example.store", name: "Store", version: "1.0.0", apiVersion: "1.25", permissions: [] }, onload(c) { ctx = c; } });
  await ctx.store.setMany([["lin:a", "1"], ["lin:b", "2"], ["v:a", "3"], ["lin_x", "4"]]);
  assert.deepEqual(await ctx.store.keys("lin:"), ["lin:a", "lin:b"]);
  assert.deepEqual(await ctx.store.getMany(["lin:a", "nope"]), ["1", null]);
  assert.equal(await ctx.store.deletePrefix("lin:"), 2);
  await assert.rejects(() => ctx.store.deletePrefix(""));
  await ctx.store.set("k", "v");
  assert.equal(await ctx.store.get("k"), "v");
  await ctx.store.deleteMany(["k", "v:a"]);
  assert.deepEqual(await ctx.store.keys(), ["lin_x"]);
}

// STORE-API (Hive #5): under Tauri the store generation is requested when the
// store is created (plugin enable), before any write, and writes carry it.
{
  const calls = [];
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd, args) => {
        calls.push([cmd, args]);
        if (cmd === "plugin_store_generation") return "gen-1";
        return undefined;
      },
    },
  };
  try {
    const tauriHost = new ExtensionHost();
    let ctx;
    await tauriHost.enable({ manifest: { id: "example.store-gen", name: "Store gen", version: "1.0.0", apiVersion: "1.25", permissions: [] }, onload(c) { ctx = c; } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(calls.map(([cmd]) => cmd), ["plugin_store_generation"], "the generation must be requested at creation, before any write");
    await ctx.store.setMany([["k", "v"]]);
    const write = calls.find(([cmd]) => cmd === "plugin_store_set_many");
    assert.ok(write, "setMany must reach the invoke layer");
    assert.equal(write[1].generation, "gen-1");
    assert.equal(calls.filter(([cmd]) => cmd === "plugin_store_generation").length, 1);
  } finally {
    delete globalThis.window;
  }
}

// SYNC-NOTICE fix (Hive #16, F1): another plugin clicking a notice action
// with `button.click()` dispatches an untrusted click; only real input runs it.
{
  const { activateNoticeAction } = await import("../src/core/extensions/host.ts");
  const calls = [];
  const button = new EventTarget();
  button.addEventListener("click", (event) => activateNoticeAction(event, () => calls.push("dismiss"), () => calls.push("run")));
  button.dispatchEvent(new Event("click"));
  assert.deepEqual(calls, [], "a synthetic click neither dismisses nor runs the callback");
  assert.equal(activateNoticeAction({ isTrusted: true }, () => calls.push("dismiss"), () => calls.push("run")), true);
  assert.deepEqual(calls, ["dismiss", "run"], "a real pointer or keyboard activation (a trusted click) runs it");
  const surfaces = (await import("node:fs")).readFileSync(new URL("../src/core/app/CorePluginSurfaces.tsx", import.meta.url), "utf8");
  assert.ok(surfaces.includes("onClick={(event) => { activateNoticeAction(event.nativeEvent,"), "the notice button goes through the trusted-event gate");
}

console.log("Extension host checks passed.");
