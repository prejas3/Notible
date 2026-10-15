import type { ExtensionHost } from "../core/extensions/host.ts";
import type { NotiblePlugin } from "../../packages/plugin-api/src/index.ts";

/** Plugins active immediately after a fresh install, before the user has
 * touched Plugin Matrix. Everything else in BUILTIN_PLUGINS starts inactive. */
export const DEFAULT_BUILTIN_SELECTION: readonly string[] = [
  "notible.properties",
  "notible.search",
  "notible.whiteboard",
  "notible.views",
  "notible.work-models",
  "notible.editor-extensions",
];

/**
 * Serializes calls. Two overlapping applications both read "nothing is
 * active", both try to enable the same plugins, and the second one throws
 * `Duplicate registration`. React StrictMode invokes mount effects twice in
 * development, which is exactly that case — the errors were dev-only noise,
 * but the underlying re-entrancy was real.
 */
let pending: Promise<unknown> = Promise.resolve();

/** Where Settings → Plugins keeps which built-ins are on. */
export const MATRIX_SELECTION_KEY = "notible-test-host.matrix-selection";

/** Turn one built-in on without opening Settings (Modules → "Turn on", D3); keeps the rest as they are. */
export async function turnOnBuiltin(host: ExtensionHost, catalog: readonly NotiblePlugin[], id: string): Promise<void> {
  let current: string[] = host.getSnapshot().map((item) => item.pluginId);
  try {
    const raw = localStorage.getItem(MATRIX_SELECTION_KEY);
    const stored = raw ? JSON.parse(raw) as unknown : null;
    if (Array.isArray(stored) && stored.every((item) => typeof item === "string")) current = stored;
  } catch { /* the active plugins are the selection */ }
  if (current.includes(id) && host.getSnapshot().some((item) => item.pluginId === id)) return;
  const ids = await applyPluginSelection(host, catalog, [...new Set([...current, id])]);
  try { localStorage.setItem(MATRIX_SELECTION_KEY, JSON.stringify(ids)); } catch { /* still on for this session */ }
}

export function applyPluginSelection(
  host: ExtensionHost,
  catalog: readonly NotiblePlugin[],
  selected: readonly string[],
): Promise<string[]> {
  const run = pending.then(
    () => applySelectionNow(host, catalog, selected),
    () => applySelectionNow(host, catalog, selected),
  );
  // Keep the chain alive even when a run rejects, or one failure would wedge
  // every later application.
  pending = run.catch(() => {});
  return run;
}

async function applySelectionNow(
  host: ExtensionHost,
  catalog: readonly NotiblePlugin[],
  selected: readonly string[],
): Promise<string[]> {
  const snapshot = host.getSnapshot();
  const active = snapshot.map((item) => item.pluginId);
  const catalogById = new Map(catalog.map((plugin) => [plugin.manifest.id, plugin]));
  // Selecting a plugin implicitly selects everything it (transitively)
  // depends on — a user checking "Work Packs" in Matrix shouldn't also
  // have to separately check "Properties" for it to actually enable.
  const wanted = new Set(selected);
  const stack = [...wanted];
  while (stack.length > 0) {
    const id = stack.pop();
    for (const depId of Object.keys(catalogById.get(id ?? "")?.manifest.dependencies ?? {})) {
      if (!wanted.has(depId)) { wanted.add(depId); stack.push(depId); }
    }
  }
  const errors: string[] = [];
  // host.getSnapshot() is alphabetically sorted, not enable-order, so
  // reversing it doesn't guarantee dependents disable before the
  // dependencies they need — ExtensionHost.disable() would just throw
  // "required by X" for the wrong ordering. Disable in real dependency-safe
  // order instead: repeatedly remove any not-wanted, still-active plugin
  // that nothing else still-active depends on.
  // Only ever disable plugins this catalog actually manages. A selection over
  // the builtin set has no business touching a third-party plugin it has
  // never heard of — and it used to disable every one of them, so opening
  // Plugin Matrix silently switched off anything the user had installed
  // themselves and their sidebar panels vanished.
  const toDisable = new Set(active.filter((id) => !wanted.has(id) && catalogById.has(id)));
  while (toDisable.size > 0) {
    const stillActive = new Set(host.getSnapshot().map((item) => item.pluginId));
    const next = [...toDisable].find((id) => ![...stillActive].some((otherId) => otherId !== id && stillActive.has(otherId) && catalogById.get(otherId)?.manifest.dependencies?.[id] !== undefined));
    if (!next) break; // remaining ids form a cycle or depend on something not in toDisable's removal path — bail, don't spin forever
    toDisable.delete(next);
    try {
      await host.disable(next);
    } catch (value) {
      errors.push(`${next}: ${value instanceof Error ? value.message : String(value)}`);
    }
  }
  for (const plugin of catalog) {
    // Re-read what is active rather than trusting the snapshot taken before
    // the disable loop ran: that list is stale by this point, and acting on
    // it is the other half of the duplicate-registration bug.
    const activeNow = new Set(host.getSnapshot().map((item) => item.pluginId));
    if (wanted.has(plugin.manifest.id) && !activeNow.has(plugin.manifest.id)) {
      try {
        await host.enable(plugin);
      } catch (value) {
        errors.push(`${plugin.manifest.id}: ${value instanceof Error ? value.message : String(value)}`);
      }
    }
  }
  if (errors.length) throw new Error(`Some plugins failed to apply: ${errors.join("; ")}`);
  return host.getSnapshot().map((item) => item.pluginId);
}
