export type PluginRowSource = "core" | "local";

export interface PluginRow {
  id: string;
  name: string;
  version: string;
  source: PluginRowSource;
  state: "active" | "disabled";
  verified: boolean;
}

export interface LocalEntry {
  plugin_id: string;
  version: string;
  source: string;
  state: string;
  verified: boolean;
}

/**
 * The plugin list is derived only from its real sources — the builtin catalog
 * and the local registry. No id-keyed map decides whether a plugin shows up,
 * so a plugin nobody has described yet still gets a row with a working switch.
 */
export function buildPluginRows(args: {
  builtins: { manifest: { id: string; name: string; version: string } }[];
  activeIds: string[];
  localEntries: LocalEntry[];
}): PluginRow[] {
  const { builtins, activeIds, localEntries } = args;
  const active = new Set(activeIds);
  const builtinIds = new Set(builtins.map((plugin) => plugin.manifest.id));

  const coreRows: PluginRow[] = builtins.map((plugin) => ({
    id: plugin.manifest.id,
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    source: "core",
    state: active.has(plugin.manifest.id) ? "active" : "disabled",
    verified: true,
  }));

  const localRows: PluginRow[] = localEntries
    .filter((entry) => !builtinIds.has(entry.plugin_id))
    .map((entry) => ({
      id: entry.plugin_id,
      name: entry.plugin_id
        .replace(/^notible\./, "")
        .replaceAll("-", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
      version: entry.version,
      source: "local",
      state: entry.state === "active" ? "active" : "disabled",
      verified: entry.verified,
    }));

  return [...coreRows, ...localRows];
}
