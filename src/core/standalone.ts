/**
 * Dependency-light Core entrypoint for the Core-only build and isolation
 * tests. The product bundle may add a plugin set, but this module does not
 * import any builtin plugin or domain UI.
 */
export { ExtensionHost } from "./extensions/host.ts";
export { LocalPluginManager } from "./extensions/manager.ts";
export { enablePluginSet, disablePluginSet } from "./app/plugin-bootstrap.ts";
export type { PluginSetResult } from "./app/plugin-bootstrap.ts";
export type {
  LocalPluginArtifact,
  LocalPluginRecord,
  LocalPluginStatus,
} from "./extensions/manager.ts";
export type {
  DataApi,
  NotiblePlugin,
  PluginContext,
  PluginManifest,
} from "./extensions/types.ts";
