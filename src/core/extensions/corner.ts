import type { ExtensionSnapshot, ViewMount } from "./types";

/** API 1.22: the slot a helper character lives in. */
export const CORNER_SLOT = "workspace.corner";

/** Plugins that registered the corner, one entry each, ordered by id. */
export function cornerCandidates(snapshots: ExtensionSnapshot[]): Array<{ pluginId: string; mount: ViewMount }> {
  return snapshots
    .flatMap((snapshot) => {
      const registration = (snapshot.slots[CORNER_SLOT] ?? [])[0];
      return registration?.mount ? [{ pluginId: snapshot.pluginId, mount: registration.mount }] : [];
    })
    .sort((left, right) => left.pluginId.localeCompare(right.pluginId));
}

/**
 * Who sits in the corner: the user's pick from Settings → Plugins, "none",
 * or — with no pick, or a pick that is no longer there — the first by id.
 * Deterministic, so it never depends on which plugin happened to load first.
 */
export function pickCornerOccupant<T extends { pluginId: string }>(candidates: T[], choice: string | null): T | null {
  if (choice === "none") return null;
  return candidates.find((candidate) => candidate.pluginId === choice) ?? candidates[0] ?? null;
}
