// Pure date maths for the month-grid calendar surface (CalendarMonthView.tsx).
// No React, no DOM — exercised headless by scripts/builtin-calendar-check.mjs.
import { normaliseTime } from "../../src/core/ui/logic.ts";

function pad(n: number): string { return String(n).padStart(2, "0"); }

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// A wall-clock string with no timezone: `yyyy-mm-dd`, optionally `THH:MM[:SS]`.
const LOCAL_WALL = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/;

/** The local calendar day (`yyyy-mm-dd`) an instant falls on.
 *  - a bare wall-clock string → its literal date part (no timezone shift);
 *  - an offset / `Z` string → the viewer's local day;
 *  - unparseable / impossible input → `null`. Never throws. */
export function localDay(iso: string): string | null {
  if (typeof iso !== "string" || !iso) return null;
  const wall = LOCAL_WALL.exec(iso);
  if (wall) {
    const [y, m, d] = [+wall[1], +wall[2], +wall[3]];
    const probe = new Date(y, m - 1, d);
    return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d
      ? `${wall[1]}-${wall[2]}-${wall[3]}`
      : null;
  }
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? null
    : `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

/** `"2026-01-31"` + 1 → `"2026-02-01"`. Non-date input passes through. */
export function addDays(day: string, n: number): string {
  const m = DATE_ONLY.exec(day);
  if (!m) return day;
  const d = new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** True when the time-of-day portion is exactly midnight (00:00[:00[.0…]]),
 *  with or without a trailing Z / ±hh:mm offset. */
export function isMidnight(iso: string): boolean {
  if (typeof iso !== "string") return false;
  // A timezone-bearing instant is midnight only after conversion to the
  // viewer's local timezone. A timezone-less wall time is already local.
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso);
  if (!hasZone) return /T00:00(?::00(?:\.0+)?)?$/.test(iso);
  const parsed = new Date(iso);
  return !Number.isNaN(parsed.getTime()) && parsed.getHours() === 0 && parsed.getMinutes() === 0
    && parsed.getSeconds() === 0 && parsed.getMilliseconds() === 0;
}

/**
 * The visible-grid day keys an event occupies, intersected with
 * `[gridStart, gridEnd]` *before* enumeration so a month-long or
 * starts-before-the-grid event still resolves to just its visible days.
 *
 *  - all-day events: provider `end` is exclusive → last day = end − 1.
 *  - timed events ending exactly at midnight: that midnight is exclusive →
 *    the following day is not drawn.
 *  - other timed events: last day = end's local day.
 *  - missing / unparseable `end` → single day at start.
 *  - unparseable `start` → `[]`.
 */
export function eventGridDays(
  startIso: string,
  endIso: string | undefined,
  allDay: boolean,
  gridStart: string,
  gridEnd: string,
): string[] {
  const startDay = localDay(startIso);
  if (!startDay) return [];
  let lastDay = startDay;
  const rawEnd = typeof endIso === "string" ? endIso : "";
  const endDay = rawEnd ? localDay(rawEnd) : null;
  if (endDay && endDay > startDay) {
    if (allDay || isMidnight(rawEnd)) lastDay = addDays(endDay, -1);
    else lastDay = endDay;
    if (lastDay < startDay) lastDay = startDay;
  }
  const lo = startDay > gridStart ? startDay : gridStart;
  const hi = lastDay < gridEnd ? lastDay : gridEnd;
  if (lo > hi) return [];
  const out: string[] = [];
  for (let day = lo; day <= hi && out.length <= 45; day = addDays(day, 1)) out.push(day);
  return out;
}

export interface ComposeInput {
  /** Stored `start` / `end` — reused verbatim (seconds + offset kept) when the
   *  form still points at the same wall date/time. */
  origStart?: string;
  origEnd?: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
}
export type ComposeResult =
  | { ok: true; start: string; end: string }
  | { ok: false; reason: "end-before-start" | "invalid-time" };

function keepOriginal(orig: string | undefined, day: string, hhmm: string, allDay: boolean): string | null {
  if (!orig) return null;
  if (allDay !== (orig.length <= 10)) return null;
  if (orig.slice(0, 10) !== day) return null;
  if (allDay) return orig;
  return orig.slice(11, 16) === hhmm ? orig : null;
}

/**
 * Build `{ start, end }` for a `calendar_event` save. Only the piece the user
 * actually changed is recomposed; an untouched timestamp is kept byte-for-byte.
 * An end before the start is rejected (`ok: false`) rather than silently
 * snapped to the start.
 */
export function composeEventTimestamps(input: ComposeInput): ComposeResult {
  const { origStart, origEnd, startDate, endDate, allDay } = input;
  if (!DATE_ONLY.test(startDate) || !DATE_ONLY.test(endDate)) return { ok: false, reason: "invalid-time" };

  let startTime = "";
  let endTime = "";
  if (!allDay) {
    const ns = normaliseTime(input.startTime);
    const ne = normaliseTime(input.endTime);
    if (ns === null || ne === null) return { ok: false, reason: "invalid-time" };
    startTime = ns;
    endTime = ne;
  }

  const start = keepOriginal(origStart, startDate, startTime, allDay) ?? (allDay ? startDate : `${startDate}T${startTime}`);
  const end = keepOriginal(origEnd, endDate, endTime, allDay) ?? (allDay ? endDate : `${endDate}T${endTime}`);

  const startMs = Date.parse(start.length > 10 ? start : `${start}T00:00:00`);
  const endMs = Date.parse(end.length > 10 ? end : `${end}T${allDay ? "23:59:59" : "00:00:00"}`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return { ok: false, reason: "invalid-time" };
  if (endMs < startMs) return { ok: false, reason: "end-before-start" };
  return { ok: true, start, end };
}

/**
 * Move an event so it starts on `toDay` (YYYY-MM-DD), keeping its times and
 * its length: a two-day event dragged to Friday ends on Saturday (R4 T9).
 */
export function moveEventToDay(start: string, end: string, toDay: string): { start: string; end: string } {
  const from = start.slice(0, 10);
  const shift = Math.round((Date.UTC(+toDay.slice(0, 4), +toDay.slice(5, 7) - 1, +toDay.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000);
  const move = (value: string) => {
    if (!value) return value;
    const day = new Date(Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10) + shift));
    return day.toISOString().slice(0, 10) + value.slice(10);
  };
  return { start: move(start), end: move(end) };
}
