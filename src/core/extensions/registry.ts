import type { PluginRegistryEntry } from "../../lib/api";

const BACKUP_FORMAT = "notible-plugin-registry";
const BACKUP_VERSION = 1;

export interface PluginRegistryBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  entries: PluginRegistryEntry[];
}

export function createPluginRegistryBackup(entries: PluginRegistryEntry[]): string {
  const normalized = entries.map((entry) => ({ ...entry }));
  validateEntries(normalized);
  return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, entries: normalized }, null, 2);
}

export function restorePluginRegistryBackup(serialized: string): PluginRegistryEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`plugin registry backup is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error("plugin registry backup must be an object");
  const backup = parsed as Partial<PluginRegistryBackup>;
  if (backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION || !Array.isArray(backup.entries)) {
    throw new Error("unsupported plugin registry backup format");
  }
  const entries = backup.entries.map((entry) => ({ ...entry }));
  validateEntries(entries);
  return entries;
}

function validateEntries(entries: PluginRegistryEntry[]): void {
  const keys = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.plugin_id}@${entry.version}`;
    if (keys.has(key)) throw new Error(`duplicate plugin registry entry: ${key}`);
    keys.add(key);
    if (!entry.plugin_id || !entry.version || !entry.install_path) throw new Error(`incomplete plugin registry entry: ${key}`);
    if (!['builtin', 'local-file', 'package'].includes(entry.source)) throw new Error(`invalid plugin source: ${entry.source}`);
    if (!['active', 'disabled', 'failed', 'installed'].includes(entry.state)) throw new Error(`invalid plugin state: ${entry.state}`);
    if (entry.state === "active" && !entry.verified) throw new Error(`unverified plugin cannot be active: ${key}`);
    let manifest: unknown;
    try {
      manifest = JSON.parse(entry.manifest);
    } catch {
      throw new Error(`plugin manifest is not valid JSON: ${key}`);
    }
    if (!manifest || typeof manifest !== "object") throw new Error(`plugin manifest must be an object: ${key}`);
    const value = manifest as { id?: unknown; version?: unknown };
    if (value.id !== entry.plugin_id || value.version !== entry.version) {
      throw new Error(`plugin manifest does not match registry key: ${key}`);
    }
  }
}
