// Pure helpers for the Typewriter surfaces. No DOM, no DataApi — every
// function here is unit-tested in scripts/typewriter-check.mjs.

/** Whitespace-delimited token count across block `text`. `context.data.
 *  document.get` already strips dialect markers; a leading "# " / "> " / "- "
 *  is dropped defensively so a heading line does not inflate the count. */
export function wordCount(blocks: Array<{ text?: string }>): number {
  let total = 0;
  for (const block of blocks) {
    const raw = (block.text ?? "").replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/, "").trim();
    if (raw) total += raw.split(/\s+/).length;
  }
  return total;
}

export interface SubtreeRow {
  id: string;
  parentId: string | null;
  words: number;
  isScene?: boolean;
}

/** Sum `words` over the transitive descendants of `rootId` (not the root
 *  itself). Explicit scene flags distinguish empty chapters from scenes.
 *  Legacy callers without flags retain the leaf-content-row convention. */
export function aggregateSubtree(rows: SubtreeRow[], rootId: string): { words: number; scenes: number } {
  const childrenOf = new Map<string, SubtreeRow[]>();
  for (const row of rows) {
    const key = row.parentId ?? "";
    const bucket = childrenOf.get(key);
    if (bucket) bucket.push(row);
    else childrenOf.set(key, [row]);
  }
  let words = 0;
  let scenes = 0;
  const walk = (id: string) => {
    for (const child of childrenOf.get(id) ?? []) {
      const grandchildren = childrenOf.get(child.id) ?? [];
      words += child.words;
      if (child.isScene ?? grandchildren.length === 0) scenes += 1;
      walk(child.id);
    }
  };
  walk(rootId);
  return { words, scenes };
}

/** pov / setIn are single per scene. Keep the lexicographically-smallest
 *  `toId`, drop the rest (sync can introduce duplicates). */
export function singletonRepair<T extends { toId: string }>(relations: T[]): { keep: T | null; drop: T[] } {
  if (relations.length === 0) return { keep: null, drop: [] };
  const sorted = [...relations].sort((a, b) => (a.toId < b.toId ? -1 : a.toId > b.toId ? 1 : 0));
  return { keep: sorted[0], drop: sorted.slice(1) };
}

/** Words per day needed to hit `target` by `deadlineISO`, given `current`
 *  words today. null if there is no target or no deadline. 0 once the target
 *  is met or the deadline is today/past. Dates are `YYYY-MM-DD`. */
export function wordsPerDay(current: number, target: number, deadlineISO: string, todayISO: string): number | null {
  if (!target || target <= 0 || !deadlineISO) return null;
  if (current >= target) return 0;
  const day = 86_400_000;
  const daysLeft = Math.round((Date.parse(deadlineISO) - Date.parse(todayISO)) / day);
  if (!Number.isFinite(daysLeft) || daysLeft <= 0) return 0;
  return Math.ceil((target - current) / daysLeft);
}

/** date -> cumulative manuscript word count recorded that day (the last total
 *  seen while the app was open, not a delta). `YYYY-MM-DD` keys. */
export interface DailyWordLog { [date: string]: number }

export function isoAddDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Words added on `date`, i.e. its total minus the prior calendar day's total.
 *  null when there is no entry for `date`, or none for the day before it (a
 *  gap, or the very first day ever logged — neither can be credited as
 *  "written that day", since there is nothing to diff against). */
export function wordsWrittenOn(log: DailyWordLog, date: string): number | null {
  const today = log[date];
  const prev = log[isoAddDays(date, -1)];
  if (today === undefined || prev === undefined) return null;
  return today - prev;
}

/** Consecutive days up to and including `today` with positive word-count
 *  growth over the prior calendar day. Stops at the first gap, flat/negative
 *  day, or missing baseline — a day with no entry the day before it (import,
 *  first-ever session) never counts itself, so opening the app for the very
 *  first time cannot claim a 1-day streak for free. */
export function writingStreak(log: DailyWordLog, today: string): number {
  let streak = 0;
  let cursor = today;
  for (;;) {
    const delta = wordsWrittenOn(log, cursor);
    if (delta === null || delta <= 0) break;
    streak++;
    cursor = isoAddDays(cursor, -1);
  }
  return streak;
}

export interface HeatmapDay { date: string; words: number | null }

/** `weeks` full Mon-Sun calendar weeks ending on the week containing `today`,
 *  oldest first — a GitHub-style contribution grid, column-major (each
 *  column one week, top-to-bottom Monday..Sunday) so the caller can render
 *  it directly with `grid-auto-flow: column`. `words` is `wordsWrittenOn`
 *  for that day — null where there is no log entry the day before it
 *  (before tracking started, or a gap), not the same as a logged zero. */
export function buildHeatmapWeeks(log: DailyWordLog, today: string, weeks = 10): HeatmapDay[][] {
  const monday = new Date(`${today}T00:00:00Z`);
  const mondayOffset = (monday.getUTCDay() + 6) % 7; // 0 = Monday
  monday.setUTCDate(monday.getUTCDate() - mondayOffset - (weeks - 1) * 7);
  const columns: HeatmapDay[][] = [];
  for (let week = 0; week < weeks; week++) {
    const column: HeatmapDay[] = [];
    for (let day = 0; day < 7; day++) {
      const date = new Date(monday);
      date.setUTCDate(date.getUTCDate() + week * 7 + day);
      const iso = date.toISOString().slice(0, 10);
      column.push({ date: iso, words: wordsWrittenOn(log, iso) });
    }
    columns.push(column);
  }
  return columns;
}

export interface OrderedRow {
  id: string;
  parentId: string | null;
  order: number;
}

/** Reading-order rank for scenes: chapters/parts sorted by `order`, then
 *  scenes within each by `order`, flattened depth-first. Returns id → 0-based
 *  position. Rows whose parent is not in `containers` (loose scenes) sort
 *  after everything, by their own `order`. Ties break on `id` for stability.
 *  Pass the manuscript itself as a container with `parentId: null` so its
 *  parts/chapters hang off the root. */
export function sceneReadingRank(scenes: OrderedRow[], containers: OrderedRow[]): Map<string, number> {
  const byParent = new Map<string, OrderedRow[]>();
  for (const row of [...containers, ...scenes]) {
    const key = row.parentId ?? "";
    const bucket = byParent.get(key);
    if (bucket) bucket.push(row);
    else byParent.set(key, [row]);
  }
  const containerIds = new Set(containers.map((row) => row.id));
  const sort = (rows: OrderedRow[]) =>
    [...rows].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rank = new Map<string, number>();
  let next = 0;
  const walk = (parentKey: string) => {
    for (const row of sort(byParent.get(parentKey) ?? [])) {
      if (containerIds.has(row.id)) walk(row.id);
      else rank.set(row.id, next++);
    }
  };
  walk("");
  // Loose scenes (parent missing from the tree) land last, in order.
  for (const scene of sort(scenes)) {
    if (!rank.has(scene.id)) rank.set(scene.id, next++);
  }
  return rank;
}

/** True when `props` (a JSON string) has `props["tw.manuscriptId"] ===
 *  manuscriptId`. Bad JSON → false. */
/**
 * Compile-time footnotes. Each scene numbers its own notes from 1, so joining
 * scenes would make `[^1]` mean different things. Renumber by order of
 * appearance across the whole manuscript and gather the definitions (already
 * removed from the scene bodies) for one Notes section at the end. Sources are
 * never touched; only the compiled copy changes.
 */
export function renumberFootnotes(scenes: string[][]): { scenes: string[][]; notes: string[] } {
  const definition = /^\[\^([^\]\s]+)\]:\s?(.*)$/u;
  const reference = /\[\^([^\]\s]+)\]/gu;
  const notes: string[] = [];
  const renumbered = scenes.map((lines) => {
    const defs = new Map<string, string>();
    const body: string[] = [];
    for (const line of lines) {
      const match = definition.exec(line);
      if (match) defs.set(match[1], match[2]);
      else body.push(line);
    }
    const numbers = new Map<string, number>();
    return body.map((line) => line.replace(reference, (_match, label: string) => {
      let number = numbers.get(label);
      if (number === undefined) {
        number = notes.length + 1;
        numbers.set(label, number);
        notes.push(defs.get(label) ?? "");
      }
      return `[^${number}]`;
    }));
  });
  return { scenes: renumbered, notes: notes.map((text, index) => `[^${index + 1}]: ${text}`.trimEnd()) };
}

export function inManuscript(props: string, manuscriptId: string): boolean {
  try {
    const parsed = JSON.parse(props) as Record<string, unknown>;
    return parsed["tw.manuscriptId"] === manuscriptId;
  } catch {
    return false;
  }
}
