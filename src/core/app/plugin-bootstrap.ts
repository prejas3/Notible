import type { NotiblePlugin } from "../../../packages/plugin-api/src/index.ts";
import type { ExtensionHost } from "../extensions/host.ts";

export interface PluginSetResult {
  loaded: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * Product bundles decide which plugins to pass here. Core itself does not
 * import a domain plugin, so the same bootstrap can run with an empty set.
 */
export async function enablePluginSet(
  host: ExtensionHost,
  plugins: readonly NotiblePlugin[],
): Promise<PluginSetResult> {
  const loaded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const plugin of plugins) {
    try {
      await host.enable(plugin);
      loaded.push(plugin.manifest.id);
    } catch (value) {
      failed.push({
        id: plugin.manifest.id,
        error: value instanceof Error ? value.message : String(value),
      });
    }
  }
  return { loaded, failed };
}

export async function disablePluginSet(
  host: ExtensionHost,
  plugins: readonly NotiblePlugin[],
): Promise<string[]> {
  const disabled: string[] = [];
  for (const plugin of [...plugins].reverse()) {
    if (await host.disable(plugin.manifest.id)) disabled.push(plugin.manifest.id);
  }
  return disabled;
}
