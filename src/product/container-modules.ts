/**
 * Container modules: object tabs the user turns on and off per container.
 * A container's `props._modules` is a list of `"<pluginId>:<tabId>"` strings;
 * absent means "show every tab" (back-compat). These helpers are pure and
 * take the ExtensionHost snapshot as an argument so they can be unit-tested
 * without a live host.
 */

export function moduleId(pluginId: string, tabId: string): string {
  return `${pluginId}:${tabId}`;
}

/** Tabs that moved to another plugin. A project that chose the old id keeps its tab (0.93.3: Finance left Planning). */
/** Marks a string for the locale catalogue; the picker translates it when it shows it. */
const tr = (key: string) => key;

const MOVED_MODULES: Record<string, string> = { "notible.planning:finance": "notible.finance:finance" };
export function normaliseModules(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => MOVED_MODULES[id] ?? id))];
}

/**
 * Built-in plugins whose tabs a new user can't see while the plugin is off (D3): Modules lists
 * them with "Turn on", so the features are found where they would appear.
 */
export const OFFERED_MODULES: ReadonlyArray<{ pluginId: string; label: string; description: string; objectTypes: readonly string[] }> = [
  { pluginId: "notible.planning", label: tr("Timeline, Planning and Calendar"), description: tr("A Gantt timeline of dated work, milestones and releases, and a month calendar."), objectTypes: ["project", "space"] },
  { pluginId: "notible.finance", label: tr("Finance"), description: tr("A budget, costs, income and time entries for the project."), objectTypes: ["project"] },
  { pluginId: "notible.automations", label: tr("Automations"), description: tr("Rules that do the routine for you, such as setting a finish date when a task is done."), objectTypes: ["project", "folder"] },
];

/** The offers for plugins that are not running now. */
export function offeredModules(snapshot: readonly SnapshotLike[], objectKind: string) {
  const running = new Set(snapshot.map((entry) => entry.pluginId));
  return OFFERED_MODULES.filter((offer) => offer.objectTypes.includes(objectKind) && !running.has(offer.pluginId));
}

type TabLike = {
  id: string;
  label: string;
  description?: string;
  objectTypes: readonly string[];
  defaultFor?: readonly string[];
  order?: number;
};
type SnapshotLike = { pluginId: string; objectTabs?: readonly TabLike[] };

export interface ModuleRow {
  id: string;
  pluginId: string;
  tabId: string;
  label: string;
  description: string;
  defaultForKind: boolean;
  order: number;
}

export function availableModules(snapshot: readonly SnapshotLike[], objectKind: string): ModuleRow[] {
  const rows: ModuleRow[] = [];
  for (const entry of snapshot) {
    for (const tab of entry.objectTabs ?? []) {
      if (!tab.objectTypes.includes(objectKind)) continue;
      rows.push({
        id: moduleId(entry.pluginId, tab.id),
        pluginId: entry.pluginId,
        tabId: tab.id,
        label: tab.label,
        description: tab.description ?? "",
        defaultForKind: (tab.defaultFor ?? []).includes(objectKind),
        order: tab.order ?? 5,
      });
    }
  }
  // In the order the tabs appear, not the order plugins were loaded in.
  return rows.sort((a, b) => a.order - b.order);
}

export function defaultModules(snapshot: readonly SnapshotLike[], objectKind: string): string[] {
  return availableModules(snapshot, objectKind).filter((r) => r.defaultForKind).map((r) => r.id);
}

export function filterTabsByModules<T extends { pluginId: string; tab: { id: string } }>(
  items: readonly T[],
  enabled: readonly string[] | undefined,
): T[] {
  if (!enabled || enabled.length === 0) return [...items];
  const on = new Set(normaliseModules(enabled));
  return items.filter((item) => on.has(moduleId(item.pluginId, item.tab.id)));
}
