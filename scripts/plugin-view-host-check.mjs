import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginsModule = await import(pathToFileURL(join(root, "plugins/builtin/index.ts")).href);
const { ExtensionHost } = await import(pathToFileURL(join(root, "src/core/extensions/host.ts")).href);
const plugins = pluginsModule.BUILTIN_PLUGINS;
assert.equal(plugins.length, 14);

for (const plugin of plugins) {
  const host = new ExtensionHost();
  for (const depId of Object.keys(plugin.manifest.dependencies ?? {})) {
    const dep = plugins.find((candidate) => candidate.manifest.id === depId);
    if (dep) await host.enable(dep);
  }
  await host.enable(plugin);
  const view = host.getSnapshot(plugin.manifest.id)[0]?.views[0];
  assert(view, `${plugin.manifest.id} did not register a view`);
  assert.equal(view.render?.kind, "react-loader", `${plugin.manifest.id} view is not a lazy host descriptor`);
  assert.equal(typeof view.render.loader, "function", `${plugin.manifest.id} view loader missing`);
  await host.disable(plugin.manifest.id);
  // Disabling removes the plugin from the snapshot entirely, so there is no
  // entry left to read a view count off.
  assert.equal(host.getSnapshot(plugin.manifest.id).length, 0, `${plugin.manifest.id} view was not removed`);
}

const combined = new ExtensionHost();
for (const plugin of plugins) await combined.enable(plugin);
// 19: Finance registers its own project tab view since 0.93.3 (D8).
assert.equal(combined.getSnapshot().flatMap((snapshot) => snapshot.views).length, 19);
for (const plugin of [...plugins].reverse()) await combined.disable(plugin.manifest.id);
assert.equal(combined.getSnapshot().length, 0);

const hostSource = await readFile(join(root, "src/core/app/PluginViewSurface.tsx"), "utf8");
assert.match(hostSource, /extensionHost\.getSnapshot/);
assert.match(hostSource, /render\.loader/);
assert.match(hostSource, /data-plugin-view-host/);
const domainSource = await readFile(join(root, "plugins/builtin/builtin-domain-view-ui.tsx"), "utf8");
assert.doesNotMatch(domainSource, /src[\\/]lib|src[\\/]components|src-tauri|@tauri-apps/);
const viewsSource = await readFile(join(root, "plugins/builtin/views-ui.tsx"), "utf8");
const automationsSource = await readFile(join(root, "plugins/builtin/automations-ui.tsx"), "utf8");
// Rule execution lives in automations.ts (executeAutomationRule); the surface
// only calls it.
const automationsCore = await readFile(join(root, "plugins/builtin/automations.ts"), "utf8");
assert.doesNotMatch(viewsSource, /src[\\/]lib|src[\\/]components|src-tauri|@tauri-apps/);
assert.doesNotMatch(automationsSource, /src[\\/]lib|src[\\/]components|src-tauri|@tauri-apps/);
assert.match(viewsSource, /context\.data\.objects\.create/);
assert.match(viewsSource, /context\.data\.objects\.update/);
assert.match(viewsSource, /context\.data\.dataSources\.list/);
assert.match(viewsSource, /VIEW_LAYOUTS/);
assert.match(viewsSource, /PluginQueryBuilder/);
assert.match(viewsSource, /operatorsForField/);
assert.match(viewsSource, /queryOpen/);
// Views parity (2026-09-03): TanStack table grid + CSV import/export.
assert.match(viewsSource, /useReactTable/, "views-ui must render the table via @tanstack/react-table");
assert.match(viewsSource, /Import CSV/, "views-ui toolbar must expose CSV import");
assert.match(viewsSource, /Export CSV/, "views-ui toolbar must expose CSV export");
assert.match(viewsSource, /context\.ui\.exportFile/, "views-ui must call context.ui.exportFile");
assert.match(automationsSource, /context\.data\.objects\.update/);
assert.match(automationsCore, /context\.data\.objects\.move/);
assert.match(automationsSource, /pluginAutomationMatches/);
assert.match(automationsSource, /Execution log/);
assert.match(hostSource, /openObject/);
assert.match(hostSource, /Use legacy view/);
assert.match(hostSource, /PluginContainerSurface/);
console.log("Plugin view host checks passed: 16 lazy surfaces work individually and together.");
