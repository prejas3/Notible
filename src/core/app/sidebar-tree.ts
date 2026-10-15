export type SidebarTreeMode = "auto" | "manual";
export const SIDEBAR_TREE_MODE_KEY = "notible-core-sidebar-tree-mode";

/** Existing installations keep revealing the open note until they opt out. */
export function readSidebarTreeMode(): SidebarTreeMode {
  try {
    return localStorage.getItem(SIDEBAR_TREE_MODE_KEY) === "manual" ? "manual" : "auto";
  } catch {
    return "auto";
  }
}

export function saveSidebarTreeMode(mode: SidebarTreeMode): void {
  try { localStorage.setItem(SIDEBAR_TREE_MODE_KEY, mode); } catch { /* this session only */ }
}

/** All automatic reveals share this policy; explicit tree toggles bypass it. */
export function expandSidebarTree(
  current: Set<string>,
  ids: readonly string[],
  mode: SidebarTreeMode,
): Set<string> {
  if (mode === "manual" || ids.every((id) => current.has(id))) return current;
  return new Set([...current, ...ids]);
}
