import type { PluginObject } from "../extensions/types";

/**
 * Exporting and importing one object with its children.
 *
 * This is Core's job, not a plugin's, for the same reason "Print / Save as
 * PDF" is (0.49.0): it needs files, and the plugin API deliberately has no
 * file access — the `filesystem.*` permissions were removed at 1.0 because
 * they were declared with no API behind them. Until 0.55.0 the feature lived
 * in `notible.import-export` as a panel in Settings with a `<select>` listing
 * the entire workspace; you now right-click the thing you meant.
 *
 * Whole-workspace copies are a different feature and stay in Settings →
 * Recovery, where they are real database backups rather than JSON.
 */

const CORE_FORMAT = "notible-core-export";
/** Files written by the old plugin panel must keep importing. */
const LEGACY_FORMAT = "notible-plugin-export";

/**
 * One object plus every descendant reachable through `parent_id`, breadth
 * first so parents always precede their children — import depends on that
 * order to have a new parent id ready by the time a child needs it.
 */
export function collectObjectTree(rootId: string, all: PluginObject[]): PluginObject[] {
  const byParent = new Map<string, PluginObject[]>();
  for (const object of all) {
    const parentId = object.parent_id;
    if (!parentId) continue;
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), object]);
  }
  const root = all.find((object) => object.id === rootId);
  if (!root) return [];
  const collected: PluginObject[] = [];
  const queue: PluginObject[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    collected.push(current);
    queue.push(...(byParent.get(current.id) ?? []));
  }
  return collected;
}

export function exportObjectTreeJson(rootId: string, all: PluginObject[]): string {
  return JSON.stringify({ format: CORE_FORMAT, version: 1, objects: collectObjectTree(rootId, all) }, null, 2);
}

/** Deliberately the shape of the real `objects.create`, camelCase `parentId`
 * and all: writing `parent_id` here type-checks against a loose Record and
 * then silently creates every imported object at the top level. That exact
 * mismatch has shipped in this project before. */
export interface TransferCreateApi {
  create(input: { type: string; title: string; content?: string; props?: string; parentId?: string }): Promise<{ id: string }>;
}

/**
 * Rebuilds an exported tree under `parentId`, mapping old ids to new ones so a
 * child attaches to the copy of its parent rather than to the original — which
 * would silently graft the import onto the source tree.
 *
 * Everything here is untrusted input: the file may have been edited, truncated
 * or written by something else entirely, so the shape is checked before a
 * single record is created.
 */
export async function importObjectTreeJson(json: string, parentId: string | null, api: TransferCreateApi): Promise<number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("That file is not valid JSON, so nothing was imported.");
  }
  const payload = parsed as { format?: unknown; objects?: unknown };
  if (payload.format !== CORE_FORMAT && payload.format !== LEGACY_FORMAT) {
    throw new Error("Unknown file format — this is not a Notible export.");
  }
  if (!Array.isArray(payload.objects)) {
    throw new Error("Unknown file format: the export contains no list of objects.");
  }
  const idMap = new Map<string, string>();
  let count = 0;
  for (const item of payload.objects as PluginObject[]) {
    if (!item || typeof item !== "object" || typeof item.type !== "string") continue;
    const mappedParent = item.parent_id ? idMap.get(item.parent_id) ?? parentId : parentId;
    const created = await api.create({
      title: item.title ?? "Untitled",
      type: item.type,
      ...(mappedParent ? { parentId: mappedParent } : {}),
      content: item.content ?? "",
      props: item.props ?? "{}",
    });
    idMap.set(item.id, created.id);
    count += 1;
  }
  return count;
}
