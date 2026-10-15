// API 1.22 — what a helper plugin ("Nib") gets: context.help, ui.openHelp,
// ui.openPluginSettings, ui.renderMarkdown and the workspace.corner slot.
// Run: node --experimental-strip-types scripts/help-api-check.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ExtensionHost, PLUGIN_NAVIGATION_GAP_MS } from "../src/core/extensions/host.ts";
import { buildHelpTopics } from "../src/core/extensions/help-topics.ts";
import { cornerCandidates, pickCornerOccupant } from "../src/core/extensions/corner.ts";
import { parsePage } from "../src/help/parse.ts";
import { UI_SLOTS, EXTENSION_API_VERSION } from "../packages/plugin-api/src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// 1. buildHelpTopics, pure.
const pages = [
  { id: "writing-notes", title: "Writing notes", keywords: "write", body: "![pic](help/x.webp)\n\nWrite here.\n\n## Lists\n\nUse - for a list." },
  { id: "plugin-planning", title: "Planning", keywords: "plan", body: "Timeline and dashboard.\n\n## Timeline\n\nDrag bars.", plugin: "notible.planning" },
];
const plugins = [
  { id: "notible.planning", name: "Planning", description: "Timelines.", guide: "## Start\n\nOpen a project." },
  { id: "acme.notes", name: "Acme", description: "Acme things.", guide: "Intro.\n\n## Use\n\nClick." },
  { id: "acme.notes", name: "Acme duplicate", description: "", guide: "" },
];
let topics = buildHelpTopics(pages, plugins, (id) => (id === "acme.notes" ? "enabled" : "disabled"));
assert.deepEqual(topics.map((topic) => topic.id), ["core:writing-notes", "core:plugin-planning", "plugin:notible.planning", "plugin:acme.notes"], "ids are unique, Core pages first, a plugin listed once");
const writing = topics[0];
assert.equal(writing.state, "enabled", "a Core page with no plugin is always enabled");
assert.equal(writing.summary, "Write here.", "the summary skips pictures and takes the first paragraph");
assert.equal(writing.helpPageId, "writing-notes");
assert.deepEqual(writing.sections.map((section) => [section.heading, section.slug]), [["Writing notes", ""], ["Lists", "lists"]]);
const planningPage = topics[1];
assert.equal(planningPage.pluginId, "notible.planning");
assert.equal(planningPage.state, "disabled", "a page about a plugin follows that plugin");
assert.equal(planningPage.summary, "Timeline and dashboard.", "a disabled topic keeps its summary");
assert.deepEqual(planningPage.sections, [], "a disabled topic has no text");
assert.deepEqual(topics[2].sections, [], "a disabled plugin's guide is not exposed");
assert.deepEqual(topics[3].sections.map((section) => section.heading), ["Acme", "Use"], "an enabled guide is split at headings");
assert.equal(topics[3].summary, "Acme things.");
topics = buildHelpTopics(pages, plugins, () => "failed");
assert.equal(topics[1].state, "failed");
assert.deepEqual(topics[1].sections, [], "a failed plugin is not taught either");

// 2. The host: provider, states, cache, onChange.
const host = new ExtensionHost(undefined, {
  openHelp: async (_pluginId, pageId, slug) => { navigations.push(["help", pageId, slug]); },
  openPluginSettings: async (_pluginId, pluginId) => { navigations.push(["settings", pluginId]); },
  renderMarkdown: (_pluginId, markdown) => `<p>${markdown}</p>`,
});
const navigations = [];
host.setKnowledgeProvider({ pages: () => pages, plugins: () => plugins.slice(0, 2) });
let helper;
let changes = 0;
await host.enable({
  manifest: { id: "acme.helper", name: "Helper", version: "1.0.0", apiVersion: EXTENSION_API_VERSION, permissions: ["workspace.ui"] },
  onload(context) {
    helper = context;
    context.help.onChange(() => { changes += 1; });
    context.ui.registerSlot("workspace.corner", { id: "nib", mount: () => ({ dispose() {} }) });
  },
});
changes = 0; // the helper's own enable has just fired once
const first = helper.help.topics();
assert.equal(first, helper.help.topics(), "topics() is cached: the same array until something changes");
assert.equal(first.find((topic) => topic.id === "plugin:notible.planning").state, "disabled");
await host.enable({ manifest: { id: "notible.planning", name: "Planning", version: "1.0.0", apiVersion: EXTENSION_API_VERSION }, onload() {} });
assert.equal(changes, 1, "enabling a plugin fires help.onChange");
const second = helper.help.topics();
assert.notEqual(second, first, "the cache is dropped on change");
assert.equal(second.find((topic) => topic.id === "core:plugin-planning").state, "enabled");
assert.ok(second.find((topic) => topic.id === "core:plugin-planning").sections.length > 0, "an enabled plugin's page has its text");
await host.disable("notible.planning");
assert.equal(changes, 2, "disabling fires help.onChange");
await assert.rejects(host.enable({ manifest: { id: "acme.notes", name: "Acme", version: "1.0.0", apiVersion: EXTENSION_API_VERSION }, onload() { throw new Error("boom"); } }));
assert.equal(helper.help.topics().find((topic) => topic.id === "plugin:acme.notes").state, "failed", "a plugin whose onload threw is \"failed\"");
host.notifyKnowledgeChanged();
assert.equal(changes, 4, "notifyKnowledgeChanged (an install/remove) fires help.onChange");

// 3. Navigation: workspace.ui, a user gesture, and a rate limit.
let gesture = false;
host.setUserGestureCheck((pluginId) => gesture && pluginId === "acme.helper");
await assert.rejects(helper.ui.openHelp("writing-notes"), /user clicks or presses a key/, "openHelp outside a gesture is refused");
await assert.rejects(helper.ui.openPluginSettings("notible.planning"), /user clicks or presses a key/, "openPluginSettings outside a gesture is refused");
gesture = true;
await helper.ui.openHelp("writing-notes", "lists");
assert.deepEqual(navigations.at(-1), ["help", "writing-notes", "lists"]);
await assert.rejects(helper.ui.openPluginSettings("notible.planning"), /too soon/, "a second navigation within a second is refused");
const realNow = Date.now;
Date.now = () => realNow() + PLUGIN_NAVIGATION_GAP_MS + 10;
await helper.ui.openPluginSettings("notible.planning");
Date.now = realNow;
assert.deepEqual(navigations.at(-1), ["settings", "notible.planning"]);
assert.equal(helper.ui.renderMarkdown("**x**"), "<p>**x**</p>", "renderMarkdown is delegated to Core");
let noUi;
await host.enable({ manifest: { id: "acme.noui", name: "No UI", version: "1.0.0", apiVersion: EXTENSION_API_VERSION }, onload(context) { noUi = context; } });
await assert.rejects(noUi.ui.openHelp(), /lacks permission workspace\.ui/, "openHelp needs workspace.ui");

// The default gate (no seam): a plugin's own command counts as the user asking it.
const gated = new ExtensionHost(undefined, { openHelp: async () => {}, openPluginSettings: async () => {}, renderMarkdown: () => "" });
let gatedContext;
await gated.enable({
  manifest: { id: "acme.gated", name: "Gated", version: "1.0.0", apiVersion: EXTENSION_API_VERSION, permissions: ["workspace.ui"] },
  onload(context) {
    gatedContext = context;
    context.commands.register({ id: "ask", name: "Ask", execute: () => context.ui.openHelp("writing-notes") });
  },
});
await assert.rejects(gatedContext.ui.openHelp(), /in this plugin/, "with no input at all, openHelp is refused");
await gated.getSnapshot("acme.gated")[0].commands[0].execute();
assert.ok(true, "a call from the plugin's own command (hotkey, / menu) is allowed");
assert.ok(Array.isArray(noUi.help.topics()), "help needs no permission");

// 4. The corner: a known slot, one occupant, the user's pick wins.
assert.ok(UI_SLOTS.includes("workspace.corner"));
const fakeSnapshot = (pluginId) => ({ pluginId, slots: { "workspace.corner": [{ id: "c", mount: () => {} }] } });
const candidates = cornerCandidates([fakeSnapshot("zeta.helper"), fakeSnapshot("acme.helper"), { pluginId: "x.none", slots: {} }]);
assert.deepEqual(candidates.map((candidate) => candidate.pluginId), ["acme.helper", "zeta.helper"], "candidates are sorted by id, plugins without the slot are left out");
assert.equal(pickCornerOccupant(candidates, null)?.pluginId, "acme.helper", "no choice: the first by id");
assert.equal(pickCornerOccupant(candidates, "zeta.helper")?.pluginId, "zeta.helper", "the user's pick wins");
assert.equal(pickCornerOccupant(candidates, "gone.plugin")?.pluginId, "acme.helper", "a pick that is gone falls back to the first");
assert.equal(pickCornerOccupant(candidates, "none"), null, "\"none\" empties the corner");
assert.ok(host.getSnapshot("acme.helper")[0].slots["workspace.corner"], "the host accepts the corner slot");

// 5. Help pages about a built-in plugin say so, and name a real plugin.
const builtinIds = new Set(readdirSync(join(root, "plugins/builtin")).filter((name) => name.startsWith("notible.")));
for (const file of readdirSync(join(root, "src/help/pages")).filter((name) => name.startsWith("plugin-"))) {
  const page = parsePage(readFileSync(join(root, "src/help/pages", file), "utf8"));
  assert.ok(page.plugin, `${file} needs "plugin:" front matter`);
  assert.ok(builtinIds.has(page.plugin), `${file} names ${page.plugin}, which is not a built-in plugin`);
}

// 6. CSP: no form can post anywhere (a corner box must not fake one).
const csp = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8")).app.security.csp;
assert.match(csp, /form-action 'none'/);

// 7. A plugin's bundled translations (manifest.locales) reach its context.i18n.t
//    (0.93.1: the package loader read them, but nothing ever used them).
const { LocalPluginManager } = await import("../src/core/extensions/manager.ts");
const localeHost = new ExtensionHost();
localeHost.setTranslator({ translate: (_namespace, key, _values, own) => own?.pl?.[key] ?? key, locale: "pl-PL" });
let localeContext;
const localePlugin = { manifest: { id: "acme.polish", name: "Polish", version: "1.0.0", apiVersion: EXTENSION_API_VERSION }, onload(context) { localeContext = context; } };
const localeManager = new LocalPluginManager(localeHost);
await localeManager.install({ manifest: localePlugin.manifest, plugin: localePlugin, verified: true, source: "package", locales: { pl: { Ask: "Zapytaj" } } });
assert.equal(localeContext.i18n.t("Ask"), "Zapytaj", "the plugin's own Polish string is used");
assert.equal(localeContext.i18n.t("Close"), "Close", "a missing key falls back to the key");

console.log("Help API (1.22) checks passed: topics, states, onChange, gesture gate, rate limit, corner occupant, help front matter, CSP.");
