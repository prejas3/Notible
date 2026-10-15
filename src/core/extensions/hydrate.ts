import { LocalPluginManager } from "./manager.ts";
import { loadLocalPluginDirectory, type LocalPluginFileReader } from "./loader.ts";

export interface PersistedPluginRecord {
  plugin_id: string;
  version: string;
  source: "builtin" | "local-file" | "package";
  install_path: string;
  verified: boolean;
  user_trusted: boolean;
  state: "active" | "disabled" | "failed" | "installed";
}

export async function hydrateActiveLocalPlugins(
  entries: PersistedPluginRecord[],
  reader: LocalPluginFileReader,
  manager: LocalPluginManager,
): Promise<{ loaded: string[]; failed: Array<{ id: string; version: string; error: string }> }> {
  const loaded: string[] = [];
  const failed: Array<{ id: string; version: string; error: string }> = [];
  for (const entry of entries) {
    // The legacy `verified` flag is false for everything third-party (Model A
    // ships no signed plugin manifests) — requiring it here is what made
    // local plugins vanish on every restart of a release build. Under the
    // no-sandbox trust model the user's own recorded decision is the
    // authority; Rust only sets `user_trusted` after showing the warning.
    if (
      entry.state !== "active" ||
      (entry.source !== "local-file" && entry.source !== "package") ||
      !(entry.verified || entry.user_trusted)
    ) continue;
    const existing = manager.list().find((record) => record.id === entry.plugin_id && record.activeVersion === entry.version);
    if (existing?.status === "active") continue;
    try {
      const artifact = await loadLocalPluginDirectory(entry.install_path, reader, true);
      if (artifact.manifest.id !== entry.plugin_id || artifact.manifest.version !== entry.version) {
        throw new Error(`persisted plugin registry entry does not match artifact: ${entry.plugin_id}@${entry.version}`);
      }
      await manager.install({ ...artifact, source: entry.source });
      loaded.push(`${entry.plugin_id}@${entry.version}`);
    } catch (value) {
      failed.push({
        id: entry.plugin_id,
        version: entry.version,
        error: value instanceof Error ? value.message : String(value),
      });
    }
  }
  return { loaded, failed };
}
