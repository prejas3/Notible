/** Pure helpers for the themed controls. No React, no DOM globals — this
 *  module is imported both by the components and by
 *  `scripts/ui-baseline-check.mjs` under `node --experimental-strip-types`. */

const ISO = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2})?$/;
const PL = /^(\d{2})\.(\d{2})\.(\d{4})$/;

function validYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** `"27.08.2026"` + `pl` → `"2026-08-27"`; ISO passthrough for other locales;
 *  `""` → `""`; anything unparseable → `null`. */
export function parseDate(text: string, locale: string): string | null {
  if (text === "") return "";
  if (locale === "pl") {
    const m = PL.exec(text.trim());
    if (!m) return null;
    const [, dd, mm, yyyy] = m;
    return validYmd(+yyyy, +mm, +dd) ? `${yyyy}-${mm}-${dd}` : null;
  }
  const m = ISO.exec(text.trim());
  if (!m) return null;
  return validYmd(+m[1], +m[2], +m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** ISO (optionally with `THH:mm`) → the locale's display form. Time is
 *  dropped for display; the field keeps it in its own model. */
export function formatDate(iso: string, locale: string): string {
  if (!iso) return "";
  const m = ISO.exec(iso);
  if (!m) return "";
  return locale === "pl" ? `${m[3]}.${m[2]}.${m[1]}` : `${m[1]}-${m[2]}-${m[3]}`;
}

export function clampDate(iso: string, min?: string, max?: string): string {
  if (!iso) return iso;
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

export function withTime(iso: string, hhmm: string): string {
  const date = iso.slice(0, 10);
  return hhmm ? `${date}T${hhmm}` : date;
}

/** `"9:05"`/`"09:05"` → `"09:05"`; hours 0-23, minutes 0-59 only. `""` or
 *  anything out of range → `null` (caller keeps the previous value). */
export function normaliseTime(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = +m[1];
  if (h > 23 || +m[2] > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** 6×7 = 42 ISO date strings, Monday-first, `null` for leading/trailing
 *  padding. `month` is 1-based. */
export function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // shift so Monday === 0
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length < 42) cells.push(null);
  return cells;
}

export interface Rect { top: number; left: number; bottom: number; right: number; width: number; height: number }
export interface Size { width: number; height: number }
export interface Placement {
  top: number;
  left: number;
  placement: "top" | "bottom";
  /** Present only when the viewport is too short for the panel's natural (or
   *  CSS-capped) height: a px cap the caller must apply so the panel fits
   *  between an 8px top gutter and an 8px bottom gutter, scrolling its
   *  overflow. Omitted when the panel already fits. */
  maxHeight?: number;
}

const GUTTER = 8;
/** `.nb-popover-bottom` / `-top` add a 4px margin toward the anchor. */
const ANCHOR_MARGIN = 4;

/** Prefer below the anchor; flip above when the panel would overflow the
 *  viewport bottom and there is more room above; clamp `left` to an 8px
 *  viewport gutter. Coordinates are viewport-relative — the caller adds
 *  scroll offset. */
export function placePopover(anchor: Rect, panel: Size, viewport: Size): Placement {
  const roomBelow = viewport.height - anchor.bottom;
  const roomAbove = anchor.top;
  const below = roomBelow >= panel.height || roomBelow >= roomAbove;
  const raw = below ? anchor.bottom : anchor.top - panel.height;
  // Keep the panel inside the viewport even in short windows: an "above"
  // flip with a tall panel could land at a negative top and be unreachable.
  const top = Math.max(GUTTER, Math.min(raw, Math.max(GUTTER, viewport.height - panel.height - GUTTER)));
  const left = Math.max(GUTTER, Math.min(anchor.left, viewport.width - panel.width - GUTTER));
  // If the panel still cannot fit below `top` within the bottom gutter, hand
  // back an explicit max-height so it can shrink and scroll rather than run
  // off screen. getBoundingClientRect already includes padding + border;
  // subtract the toward-anchor margin too.
  const available = viewport.height - top - GUTTER - ANCHOR_MARGIN;
  const placement: Placement = { top, left, placement: below ? "bottom" : "top" };
  if (available < panel.height) placement.maxHeight = Math.max(64, available);
  return placement;
}

export function filterOptions<T extends { label: string }>(options: T[], query: string): T[] {
  if (!query) return options;
  const q = query.toLowerCase();
  return options.filter((o) => o.label.toLowerCase().includes(q));
}

/** Move `dir` steps from `from`, skipping `disabled` entries, wrapping at
 *  both ends. Returns `from` when every other entry is disabled. */
export function nextOptionIndex(options: { disabled?: boolean }[], from: number, dir: 1 | -1): number {
  const n = options.length;
  if (n === 0) return from;
  for (let step = 1; step <= n; step++) {
    const i = ((from + dir * step) % n + n) % n;
    if (!options[i]?.disabled) return i;
  }
  return from;
}

let warned = false;
export function truncateOptions<T>(options: T[], cap = 500): T[] {
  if (options.length <= cap) return options;
  if (!warned) {
    console.warn(`ui: option list capped at ${cap} (was ${options.length})`);
    warned = true;
  }
  return options.slice(0, cap);
}
