import type { PluginObject } from "../../packages/plugin-api/src/index.ts";

const DAY_MS = 86_400_000;

function propsOf(object: PluginObject): Record<string, unknown> {
  try { const parsed = JSON.parse(object.props) as unknown; return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

/** Start/end of a dated item's bar. `startDate` + `due` is a real range;
 * with only one of the two the bar is a single day. */
export function dateRangeOf(item: PluginObject): { start: number; end: number } | null {
  const props = propsOf(item);
  const startRaw = props.startDate;
  const endRaw = props.due ?? props.targetDate ?? props.date;
  const start = typeof startRaw === "string" ? new Date(startRaw).getTime() : NaN;
  const end = typeof endRaw === "string" ? new Date(endRaw).getTime() : NaN;
  if (Number.isFinite(start) && Number.isFinite(end)) return { start: Math.min(start, end), end: Math.max(start, end) };
  if (Number.isFinite(start)) return { start, end: start + DAY_MS };
  if (Number.isFinite(end)) return { start: end, end: end + DAY_MS };
  return null;
}

export type DependencyKind = "finish-start" | "start-start" | "finish-finish" | "start-finish";

const DEPENDENCY_KINDS = new Set<DependencyKind>(["finish-start", "start-start", "finish-finish", "start-finish"]);

export interface Dep { on: string; kind: DependencyKind; }

function normalizeKind(value: unknown): DependencyKind {
  return typeof value === "string" && DEPENDENCY_KINDS.has(value as DependencyKind) ? value as DependencyKind : "finish-start";
}

/** Every predecessor this item waits on. The model is `props.deps`: an array
 * of `{ on, kind }`. Older records carried a single `dependsOn` string (+
 * `dependsOnKind`); those are read transparently as a one-entry list so data
 * written before 0.71.2 keeps working until it's next edited. An item with no
 * predecessors is simply independent/parallel and needs no data at all. */
export function depsOf(item: PluginObject): Dep[] {
  const props = propsOf(item);
  const raw = props.deps;
  if (Array.isArray(raw)) {
    const seen = new Set<string>();
    const out: Dep[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const on = (entry as { on?: unknown }).on;
      if (typeof on !== "string" || !on || seen.has(on)) continue;
      seen.add(on);
      out.push({ on, kind: normalizeKind((entry as { kind?: unknown }).kind) });
    }
    return out;
  }
  const legacy = props.dependsOn;
  if (typeof legacy === "string" && legacy) return [{ on: legacy, kind: normalizeKind(props.dependsOnKind) }];
  return [];
}

/** True if making `predecessorId` a predecessor of `itemId` would close a
 * cycle — i.e. `predecessorId` already depends on `itemId`, directly or
 * transitively (or they're the same item). Adding a predecessor that fails
 * this check is rejected rather than left to loop the cascade forever. */
export function wouldCycle(all: PluginObject[], itemId: string, predecessorId: string): boolean {
  if (itemId === predecessorId) return true;
  const byId = new Map(all.map((candidate) => [candidate.id, candidate]));
  const stack = [predecessorId];
  const visited = new Set<string>();
  while (stack.length) {
    const currentId = stack.pop()!;
    if (currentId === itemId) return true;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const current = byId.get(currentId);
    if (current) for (const dep of depsOf(current)) stack.push(dep.on);
  }
  return false;
}

/** Which prop key already carries this item's "end" date (mirrors the same
 * lookup order as dateRangeOf), so a reorder-driven date rewrite lands on
 * the field the item already uses instead of adding a second, conflicting
 * one. */
export function endKeyOf(item: PluginObject): string {
  const props = propsOf(item);
  if (typeof props.due === "string") return "due";
  if (typeof props.targetDate === "string") return "targetDate";
  if (typeof props.date === "string") return "date";
  return item.type === "task" || item.type === "issue" ? "due" : "targetDate";
}

export function isoDay(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }

/** The earliest a successor of `predecessorRange` may start under `kind`,
 * given the successor's own duration. Shared by `cascadeDependents` (what a
 * predecessor's change pushes its successors to) and the Gantt drag handler
 * (what a manual drag of the successor itself is not allowed to go earlier
 * than — the same rule, just checked instead of applied). */
export function requiredSuccessorStart(predecessorRange: { start: number; end: number }, kind: DependencyKind, successorDuration: number): number {
  if (kind === "start-start") return predecessorRange.start;
  if (kind === "finish-finish") return predecessorRange.end - successorDuration;
  // start-finish: the successor may not *finish* until the predecessor
  // *starts*, so the earliest its start can sit is one duration before that.
  if (kind === "start-finish") return predecessorRange.start - successorDuration;
  return predecessorRange.end;
}

/** The earliest `successor` may start given ALL of its predecessors — the
 * strictest constraint wins. `rangeFor` resolves a predecessor's current
 * range (the cascade passes in freshly-pushed ranges for items it has
 * already moved this pass). Returns null when the successor isn't dated or
 * has no resolvable predecessor. */
export function earliestStartFor(
  successor: PluginObject,
  rangeFor: (id: string) => { start: number; end: number } | null,
): number | null {
  const successorRange = dateRangeOf(successor);
  if (!successorRange) return null;
  const duration = Math.max(successorRange.end - successorRange.start, 0);
  let required: number | null = null;
  for (const dep of depsOf(successor)) {
    const predecessorRange = rangeFor(dep.on);
    if (!predecessorRange) continue;
    const candidate = requiredSuccessorStart(predecessorRange, dep.kind, duration);
    if (required === null || candidate > required) required = candidate;
  }
  return required;
}

/**
 * Walks every item chained from `changedId` via `deps` and pushes each one to
 * satisfy its own constraint against its predecessors' new ranges, preserving
 * duration. This used to not exist at all: dragging a bar (or editing its
 * date from Tasks/Properties) moved only that bar, so "B must be after A"
 * held only until A's date changed. `visited` both prevents reprocessing an
 * item and guards a dependency cycle (A depends on B depends on A) from
 * looping forever. With multiple predecessors a successor is re-evaluated
 * against the strictest of them.
 */
export function cascadeDependents(all: PluginObject[], changedId: string, changedRange: { start: number; end: number }): Array<{ id: string; startDate: string; endKey: string; endDate: string }> {
  const ranges = new Map<string, { start: number; end: number }>([[changedId, changedRange]]);
  const rangeFor = (id: string) => ranges.get(id) ?? dateRangeOf(all.find((candidate) => candidate.id === id) ?? ({} as PluginObject));
  const patches: Array<{ id: string; startDate: string; endKey: string; endDate: string }> = [];
  const visited = new Set([changedId]);
  const queue = [changedId];
  while (queue.length) {
    const currentId = queue.shift()!;
    for (const successor of all.filter((candidate) => depsOf(candidate).some((dep) => dep.on === currentId))) {
      if (visited.has(successor.id)) continue;
      visited.add(successor.id);
      const successorRange = dateRangeOf(successor);
      if (!successorRange) continue;
      const duration = Math.max(successorRange.end - successorRange.start, 0);
      const requiredStart = earliestStartFor(successor, rangeFor);
      if (requiredStart === null || successorRange.start >= requiredStart) { ranges.set(successor.id, successorRange); continue; }
      const nextRange = { start: requiredStart, end: requiredStart + duration };
      ranges.set(successor.id, nextRange);
      patches.push({ id: successor.id, startDate: isoDay(nextRange.start), endKey: endKeyOf(successor), endDate: isoDay(nextRange.end) });
      queue.push(successor.id);
    }
  }
  return patches;
}
