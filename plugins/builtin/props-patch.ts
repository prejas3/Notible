/**
 * PROPS-PATCH (Hive #36): the Properties panel saves only what the user
 * changed, applied to the object's current props, instead of writing back its
 * whole copy. Its copy can be stale: a plugin, an automation or a sync merge
 * may have written in between, and a full write erased their keys.
 */
type Props = Record<string, unknown>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * `base` is what the panel loaded, `next` what it shows after the edit,
 * `fresh` the props in the database now. Keys the edit changed take `next`'s
 * value (undefined = removed); every other key keeps `fresh`'s value.
 */
export function mergePropsEdit(fresh: Props, base: Props, next: Props): Props {
  const merged: Props = { ...fresh };
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (same(base[key], next[key])) continue;
    if (next[key] === undefined) delete merged[key];
    else merged[key] = next[key];
  }
  return merged;
}

export function parsePropsText(text: string | undefined | null): Props {
  try {
    const value = JSON.parse(text || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Props : {};
  } catch { return {}; }
}
