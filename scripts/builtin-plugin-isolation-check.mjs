import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const builtinRoot = resolve(root, "plugins/builtin");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const module = await import(pathToFileURL(join(builtinRoot, "index.ts")).href);
const plugins = module.BUILTIN_PLUGINS;
const ids = plugins.map((plugin) => plugin.manifest.id);
assert(ids.length === 14, `expected 14 builtin plugins, got ${ids.length}`);
assert(new Set(ids).size === ids.length, "builtin plugin ids must be unique");

const sourceFiles = readdirSync(builtinRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")))
  .map((entry) => join(builtinRoot, entry.name));
// Comments are stripped first. This codebase cites `file:line` in prose
// constantly — a builtin explaining *why* it does not touch src-tauri would
// otherwise trip the guard that checks it does not touch src-tauri.
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
// `src/core/ui` is a sanctioned shared-control import (API 1.11 UI baseline:
// <Select>/<Combobox>/<DatePicker>). `src/core/*` is deliberately NOT in the
// pattern below — only `src/components` and `src/lib` are private to Core.
const PRIVATE_DEPENDENCY = /(?:src-tauri|src[\\/](?:components|lib)|@tauri-apps)/;
for (const file of sourceFiles) {
  const source = stripComments(readFileSync(file, "utf8"));
  assert(!PRIVATE_DEPENDENCY.test(source), `builtin imports private Core/runtime dependency: ${file}`);
}
// The guard must still be able to fail.
assert(PRIVATE_DEPENDENCY.test(stripComments('import x from "@tauri-apps/api";')), "comment stripping must not disarm the check");

// Mermaid appearance has two easy-to-miss plumbing points: every stored
// setting must affect both the cache identity and Mermaid's site config.
// Keep this source contract beside the registration isolation check so a
// refactor cannot leave the fields visible but functionally disconnected.
const editorExtensionsSource = readFileSync(join(builtinRoot, "editor-extensions.ts"), "utf8");
// Since Hive #41 one function, mermaidConfig(), turns every setting into
// Mermaid's config; the cache key is that config serialised and initialize()
// spreads it, so a setting is in both or in neither.
const cacheKeyBody = /function mermaidCacheKey\([\s\S]*?\n\}/u.exec(editorExtensionsSource)?.[0] ?? "";
const initializeBody = /mermaid\.initialize\(\{[\s\S]*?\n    \}\);/u.exec(editorExtensionsSource)?.[0] ?? "";
const configBody = /export function mermaidConfig\([\s\S]*?\n\}/u.exec(editorExtensionsSource)?.[0] ?? "";
assert(cacheKeyBody.includes("JSON.stringify(config)"), "Mermaid SVG cache key must be the whole config");
assert(initializeBody.includes("...config") && initializeBody.includes('securityLevel: "strict"'), "Mermaid initialize() must spread the config and keep securityLevel strict");
assert(configBody && !/securityLevel/u.test(configBody), "Mermaid settings must not reach securityLevel");
for (const setting of ["theme", "handDrawn", "elk", "colors"]) assert(configBody.includes(`appearance.${setting}`), `Mermaid ${setting} setting missing from mermaidConfig()`);
{
  // Behaviour, not just source: every picker reaches themeVariables, and only plain hex does.
  const ee = await import(pathToFileURL(join(builtinRoot, "editor-extensions.ts")).href);
  const storage = new Map();
  const appearanceOf = () => ee.mermaidAppearance({ storage: { get: (key) => storage.get(key) ?? null } });
  const blank = JSON.stringify(ee.mermaidConfig(appearanceOf(), false));
  for (const [index, key] of ee.MERMAID_COLOR_KEYS.entries()) {
    const color = `#00000${index}`;
    storage.set(ee.mermaidColorStorageKey(key), color);
    assert(Object.values(ee.mermaidConfig(appearanceOf(), false).themeVariables).includes(color), `Mermaid ${key} colour missing from themeVariables`);
    storage.delete(ee.mermaidColorStorageKey(key));
  }
  // Auto node text reads on a picked node fill; a picked node text still wins.
  storage.set(ee.mermaidColorStorageKey("nodeFill"), "#f0e060");
  assert(ee.mermaidConfig(appearanceOf(), true).themeVariables.nodeTextColor === "#1f2733", "Auto node text must be dark on a light picked fill");
  storage.set(ee.mermaidColorStorageKey("nodeFill"), "#102040");
  assert(ee.mermaidConfig(appearanceOf(), false).themeVariables.nodeTextColor === "#f4f7fb", "Auto node text must be light on a dark picked fill");
  storage.set(ee.mermaidColorStorageKey("nodeText"), "#ff0000");
  assert(ee.mermaidConfig(appearanceOf(), false).themeVariables.nodeTextColor === "#ff0000", "a picked node text must win");
  storage.clear();
  storage.set(ee.mermaidColorStorageKey("line"), "red; background: url(x)");
  assert(JSON.stringify(ee.mermaidConfig(appearanceOf(), false)) === blank, "Mermaid colours must be plain #rrggbb");
  storage.set("mermaid.theme", "forest");
  assert(ee.mermaidConfig(appearanceOf(), true).theme === "forest", "Mermaid fixed theme must reach the config");
  // MERMAID-SOURCE-THEME (review #41): a theme the diagram sets itself wins
  // outright: no Notible tokens or picks in initialize(), whose themeVariables
  // Mermaid would rebuild that theme from; the soft panel follows that theme.
  storage.clear();
  storage.set(ee.mermaidColorStorageKey("nodeFill"), "#123456");
  const frontMatter = (theme) => `---\nconfig:\n  look: classic\n  theme: ${theme}\n---\nflowchart LR\n  A --> B`;
  assert(ee.mermaidSourceTheme(frontMatter("forest")) === "forest", "front matter theme not detected");
  assert(ee.mermaidSourceTheme(`%%{init: {"theme": "dark"}}%%\nflowchart LR\n  A --> B`) === "dark", "init directive theme not detected");
  assert(ee.mermaidSourceTheme(`%%{init: {'theme':'neutral'}}%%\ngraph TD\n  A --> B`) === "neutral", "single-quoted init theme not detected");
  assert(ee.mermaidSourceTheme("---\ntitle: No theme here\n---\nflowchart LR\n  A --> B") === null, "front matter without a theme must not count");
  assert(ee.mermaidSourceTheme("flowchart LR\n  A[theme: x] --> B") === null, "a label must not count as a theme");
  assert(Object.keys(ee.mermaidConfig(appearanceOf(), true, frontMatter("forest")).themeVariables).length === 0, "a diagram's own theme must get no Notible/picker themeVariables");
  assert(ee.mermaidConfig(appearanceOf(), true, "flowchart LR\n  A --> B").themeVariables.primaryColor === "#123456", "picks still apply without a source theme");
  assert(ee.mermaidSoftPanel(appearanceOf(), true, frontMatter("forest")) === true, "front matter forest in Night needs the soft panel");
  assert(ee.mermaidSoftPanel(appearanceOf(), true, frontMatter("dark")) === false, "front matter dark must not get the soft panel");
  assert(ee.mermaidSoftPanel(appearanceOf(), true, "flowchart LR\n  A --> B") === false, "Notible theme needs no panel");
  storage.set("mermaid.theme", "forest");
  assert(ee.mermaidSoftPanel(appearanceOf(), true, frontMatter("dark")) === false, "front matter dark wins over a fixed device theme");
  assert(ee.mermaidSoftPanel(appearanceOf(), false, frontMatter("forest")) === false, "no panel in Daylight");
}

for (const plugin of plugins) {
  const folder = join(builtinRoot, plugin.manifest.id);
  const manifest = JSON.parse(readFileSync(join(folder, "plugin.json"), "utf8"));
  assert(manifest.id === plugin.manifest.id, `manifest id mismatch: ${plugin.manifest.id}`);
  assert(manifest.version === plugin.manifest.version, `manifest version mismatch: ${plugin.manifest.id}`);
  assert(manifest.apiVersion === plugin.manifest.apiVersion, `manifest API mismatch: ${plugin.manifest.id}`);
  assert(JSON.stringify(manifest.permissions ?? []) === JSON.stringify(plugin.manifest.permissions ?? []), `manifest permissions mismatch: ${plugin.manifest.id}`);
}

const { ExtensionHost } = await import(pathToFileURL(resolve(root, "src/core/extensions/host.ts")).href);
const { loadPluginPackage, isSafePluginPackagePath } = await import(pathToFileURL(resolve(root, "src/core/extensions/package.ts")).href);
for (const plugin of plugins) {
  const folder = join(builtinRoot, plugin.manifest.id);
  const manifest = JSON.parse(readFileSync(join(folder, "plugin.json"), "utf8"));
  assert(isSafePluginPackagePath(manifest.entry), `unsafe builtin entry path: ${plugin.manifest.id}`);
  const packaged = await loadPluginPackage({
    readText: async (path) => readFileSync(join(folder, path), "utf8"),
  }, true, "builtin");
  assert(packaged.manifest.id === plugin.manifest.id, `packaged plugin id mismatch: ${plugin.manifest.id}`);
  const host = new ExtensionHost();
  // "Isolation" means this plugin cleans up after itself, not that it has
  // zero dependencies — enable declared dependencies first, same as any
  // real host would (Plugin Matrix's sequential batch-enable).
  for (const depId of Object.keys(plugin.manifest.dependencies ?? {})) {
    const dep = plugins.find((candidate) => candidate.manifest.id === depId);
    if (dep) await host.enable(dep);
  }
  await host.enable(plugin);
  const snapshot = host.getSnapshot(plugin.manifest.id)[0];
  assert(snapshot.commands.length >= 1, `${plugin.manifest.id} command registration missing`);
  const expectedViews = ["notible.planning", "notible.finance", "notible.whiteboard", "notible.properties", "notible.views"].includes(plugin.manifest.id) ? 2 : 1;
  assert(snapshot.views.length === expectedViews, `${plugin.manifest.id} view registration missing`);
  // A builtin view is either Core's lazy React descriptor or the public
  // `mount` contract. The workspace dashboard uses `mount` deliberately, so
  // that at least one shipped surface proves the public API can carry real
  // product UI; requiring a loader on every view would forbid exactly that.
  assert(
    snapshot.views.every((view) => typeof view.render?.loader === "function" || typeof view.mount === "function"),
    `${plugin.manifest.id} must expose lazy plugin-owned view surfaces`,
  );
  // Since 0.55.0 a builtin configures itself EITHER through a panel in
  // Settings OR through a tab on the object it configures — automations and a
  // project calendar belong on the project, not on a screen that first asks
  // which project you meant. What must never happen is neither: a plugin with
  // no surface at all is a plugin nobody can reach.
  // notible.import-export is the one plugin with nothing left to configure:
  // exporting and importing a subtree became a Core feature in 0.55.0 (it
  // needs files, and the plugin API has none), so its panel went away and
  // nothing replaced it. Retiring the plugin outright touches Matrix presets
  // and several plugin counts, so it is its own decision, not a side effect of
  // this one. Until then it is named here rather than silently tolerated.
  // A code-block renderer is the honest general case: it acts on note text and
  // has nothing to configure, so demanding a panel from it would only produce
  // an empty screen. import-export is the named one-off above.
  const HAS_NO_CONFIGURATION = new Set(["notible.import-export"]);
  if (!HAS_NO_CONFIGURATION.has(plugin.manifest.id) && snapshot.codeBlocks.length === 0) {
    assert(
      snapshot.settings.length + snapshot.objectTabs.length >= 1,
      `${plugin.manifest.id} registers neither a settings panel nor an object tab`,
    );
  }
  assert(snapshot.settings.length <= 1, `${plugin.manifest.id} registers more than one settings panel`);
  if (snapshot.settings.length === 1) {
    assert(
      typeof snapshot.settings[0].render?.loader === "function" || snapshot.settings[0].schema?.sections?.length > 0,
      `${plugin.manifest.id} must expose a lazy plugin-owned or declarative settings surface`,
    );
    if (plugin.manifest.id === "notible.editor-extensions") {
      assert(snapshot.codeBlocks.some((block) => block.id === "compare"), "Code comparison renderer missing");
      // Hive #41: a custom panel (colour pickers + preview), so it must be lazy.
      assert(typeof snapshot.settings[0].render?.loader === "function", "Mermaid settings panel must be lazy");
      const panel = readFileSync(join(builtinRoot, "mermaid-settings-ui.tsx"), "utf8");
      for (const name of ["MERMAID_THEME_KEY", "MERMAID_HAND_DRAWN_KEY", "MERMAID_ELK_KEY", "MERMAID_COLOR_KEYS", "mermaidSvg("]) assert(panel.includes(name), `Mermaid settings panel lost ${name}`);
      assert(!/type=["']color["']/u.test(panel), "Mermaid colour picker must be Notible's own control, not a native colour input");
    }
  }
  for (const tab of snapshot.objectTabs) {
    assert(tab.order >= 0 && tab.order <= 100, `${plugin.manifest.id} tab "${tab.id}" has an out-of-range order`);
    assert(tab.objectTypes.length > 0, `${plugin.manifest.id} tab "${tab.id}" claims no object type`);
  }
  assert(snapshot.slots["workspace.sidebar"]?.length === 1, `${plugin.manifest.id} slot registration missing`);
  await host.disable(plugin.manifest.id);
  // A disabled plugin leaves the snapshot entirely — it is not present with
  // empty arrays, which is what this used to assert.
  assert(host.getSnapshot(plugin.manifest.id).length === 0, `${plugin.manifest.id} did not clean up in isolation`);
}

const combined = new ExtensionHost();
for (const plugin of plugins) await combined.enable(plugin);
assert(combined.getSnapshot().length === plugins.length, "combined builtin set did not load completely");
for (const plugin of [...plugins].reverse()) await combined.disable(plugin.manifest.id);
assert(combined.getSnapshot().length === 0, "combined builtin set did not clean up completely");

console.log(`Builtin plugin isolation checks passed: ${plugins.length} plugins individually and together.`);

// A builtin must not be listed in more than one category. Visibility no
// longer depends on this map — buildPluginRows lists every builtin and drops
// the uncategorised ones into "Other" (guarded by scripts/plugin-rows-check.mjs)
// — but a plugin filed under two categories would render twice.
const enrichment = readFileSync(resolve(root, "src/product/plugin-enrichment.ts"), "utf8");
const categories = enrichment.slice(enrichment.indexOf("PLUGIN_CATEGORIES"), enrichment.indexOf("PLUGIN_LONG_DESCRIPTIONS"));
for (const id of ids) {
  const occurrences = categories.split(`"${id}"`).length - 1;
  assert(occurrences <= 1, `${id} appears in ${occurrences} plugin categories, expected at most 1`);
}

// The JS guard must agree with its Rust twin (`safe_package_path` in
// src-tauri/src/plugins.rs). Both rejected only `..`/empty/leading-slash,
// which is complete on POSIX and holed on Windows: a drive-prefixed component
// makes a join replace its base instead of extending it.
for (const escape of [
  "C:/Users/me/evil.js", "C:evil.js", "C:\Users\me\evil.js",
  "sub/C:/evil.js", "plugin.json:stream", "../outside.js", "/absolute.js", "./x.js", "",
]) {
  assert(!isSafePluginPackagePath(escape), `package path must be refused: ${escape}`);
}
for (const allowed of ["plugin.json", "main.js", "locales/pl.json", "a/b/c.txt"]) {
  assert(isSafePluginPackagePath(allowed), `package path must be allowed: ${allowed}`);
}
