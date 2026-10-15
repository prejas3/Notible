import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PluginContext, PluginObject, PluginType } from "../../packages/plugin-api/src/index.ts";
import { ViewContent, dateLabel, selectOptions } from "./views-ui.tsx";
import { shownStatuses } from "./task-statuses.ts";
import { CalendarMonthView } from "./CalendarMonthView.tsx";
import { financeSummary, financeCsv, financeRows, financeImportRow, FINANCE_HEADERS, xlsxBytes, bytesToBase64, type FinanceSummary, type FinanceAlert } from "./finance.ts";
import { parseDelimited } from "./views.ts";
import { PropertiesEditor } from "./PropertiesEditor.tsx";
import { cascadeDependents, dateRangeOf, depsOf, earliestStartFor, endKeyOf, isoDay, wouldCycle, type Dep, type DependencyKind } from "./ganttCascade.ts";
import { DEPENDENCY_KIND_LABEL, KIND_OPTIONS } from "./DependencyList.tsx";
import "./surface.css";
import "./project-dashboard-ui.css";
import { PluginI18nProvider, tr, useT } from "./i18n.tsx";
import { Select, DatePicker } from "../../src/core/ui/index.ts";

interface Props {
  context: unknown;
  host?: { openObject(id: string): Promise<void>; notifyChanged(): void };
  initialContainerId?: string;
  /** Set by Core when this dashboard is mounted as one object tab (API 1.5).
   * Its presence also hides this component's own tab strip. */
  tab?: "tasks" | "timeline" | "milestones" | "calendar" | "finance";
}

type Tab = "tasks" | "timeline" | "milestones" | "calendar" | "finance";
const TABS: { id: Tab; label: string }[] = [
  { id: "tasks", label: tr("Tasks") },
  { id: "timeline", label: tr("Timeline") },
  { id: "milestones", label: tr("Planning") },
  { id: "calendar", label: tr("Calendar") },
  { id: "finance", label: tr("Finance") },
];
type GanttZoom = "day" | "week" | "month";
const DAY_MS = 86_400_000;
const PLANNING_TYPES = ["milestone", "cycle", "release"];
const WORK_TYPES = ["task", "issue"];

function errorMessage(value: unknown) { return value instanceof Error ? value.message : String(value); }
function isConflict(value: unknown) { return errorMessage(value).toLowerCase().includes("conflict"); }

function labelOf(value: string): string {
  if (!value) return value;
  if (value.toLowerCase() === "todo") return "To do";
  const spaced = value.replaceAll(/[-_]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function propsOf(object: PluginObject): Record<string, unknown> {
  try { const parsed = JSON.parse(object.props) as unknown; return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function textPropOf(object: PluginObject, key: string): string {
  const value = propsOf(object)[key];
  return typeof value === "string" ? value : "";
}

function dateOf(object: PluginObject): string {
  const props = propsOf(object);
  const value = props.due ?? props.targetDate ?? props.startDate ?? props.date;
  return typeof value === "string" ? value : "";
}

const GANTT_ROW_HEIGHT = 44;
/** Everything in a row that sits left of the track and is not the name
 * column: the drag handle plus the two grid gaps. The track overlay has to
 * start exactly past it, so both share this number. */
const GANTT_GUTTER = 46;
const GANTT_LABEL_DEFAULT = 290;
const GANTT_LABEL_MIN = 120;
const GANTT_LABEL_MAX = 460;

/** Tick boundaries for the current zoom. Weeks start on a Monday and months
 * on the 1st: stepping by a fixed number of milliseconds from the epoch put
 * "week" gridlines on Thursdays, which is what made the vertical lines look
 * arbitrary and unexplained. */
function ganttTicks(zoom: GanttZoom, from: number, to: number): number[] {
  const ticks: number[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  if (zoom === "month") cursor.setDate(1);
  if (zoom === "week") cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  while (cursor.getTime() <= to && ticks.length < 60) {
    if (cursor.getTime() >= from) ticks.push(cursor.getTime());
    if (zoom === "day") cursor.setDate(cursor.getDate() + 1);
    else if (zoom === "week") cursor.setDate(cursor.getDate() + 7);
    else cursor.setMonth(cursor.getMonth() + 1);
  }
  return ticks;
}

/** BCP-47 tag for date formatting, following the app's chosen UI language
 * (mirrored onto <html lang> by applyTheme) rather than the OS locale. */
function pdLocale(): string {
  const lang = typeof document !== "undefined" ? document.documentElement.lang?.toLowerCase() : "";
  return lang?.startsWith("pl") ? "pl-PL" : "en-GB";
}

function ganttTickLabel(time: number, zoom: GanttZoom): string {
  const date = new Date(time);
  if (zoom === "month") return date.toLocaleDateString(pdLocale(), { month: "short", year: "2-digit" });
  return date.toLocaleDateString(pdLocale(), { day: "numeric", month: "short" });
}

const ZOOM_UNIT_LABEL: Record<GanttZoom, string> = { day: "1 gridline = 1 day", week: "1 gridline = 1 week (Mon)", month: "1 gridline = 1 month" };

/** The toolbar's month navigation works on a fixed 2-month window (matches
 * the reference "September – October 2026" label) independent of the data's
 * own date range — `null` means "Fit" (the auto range below, which spans
 * exactly what's dated, same as before this feature existed). */
const GANTT_WINDOW_MONTHS = 2;
function startOfMonth(ms: number): number { const d = new Date(ms); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); }
function addMonths(ms: number, count: number): number { const d = new Date(ms); d.setMonth(d.getMonth() + count); return d.getTime(); }
/** `end` is an exclusive window boundary (start of the month *after* the
 * last visible one) — back it up a day before reading its month/year so a
 * Sep 1 – Nov 1 window reads as "September – October", not "…– November". */
function formatWindowLabel(startMs: number, endMs: number): string {
  const start = new Date(startMs);
  const end = new Date(endMs - DAY_MS);
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  if (sameMonth) return start.toLocaleDateString(pdLocale(), { month: "long", year: "numeric" });
  const sameYear = start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString(pdLocale(), { month: "long", year: sameYear ? undefined : "numeric" });
  const endLabel = end.toLocaleDateString(pdLocale(), { month: "long", year: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

/** Real (not decorative) date-scaled timeline: bars are positioned/sized by
 * actual computed date range, dependency lines connect finish-to-start
 * predecessors, and the day/week/month toggle changes tick granularity. */
function GanttChart({ items, onAddDep, onChangeDepKind, onRemoveDep, onOpenNote, onReorder, onMoveItem, onConflict }: {
  items: PluginObject[];
  onAddDep: (id: string, predecessorId: string, kind: DependencyKind) => void;
  onChangeDepKind: (id: string, predecessorId: string, kind: DependencyKind) => void;
  onRemoveDep: (id: string, predecessorId: string) => void;
  onOpenNote: (id: string) => void;
  onReorder: (id: string, anchorId: string, before: boolean) => void;
  onMoveItem: (item: PluginObject, start: number, end: number) => Promise<void>;
  onConflict: (message: string) => void;
}) {
  const t = useT();
  const [zoom, setZoom] = useState<GanttZoom>("week");
  const [labelWidth, setLabelWidth] = useState(() => {
    const stored = Number(localStorage.getItem("notible.gantt.labelWidth"));
    return Number.isFinite(stored) && stored >= GANTT_LABEL_MIN && stored <= GANTT_LABEL_MAX ? stored : GANTT_LABEL_DEFAULT;
  });
  const [menu, setMenu] = useState<{ itemId: string; x: number; y: number } | null>(null);
  // Where the menu actually renders: `menu` holds the raw right-click point,
  // this holds it clamped inside the viewport once the menu's real size is
  // measured. Kept separate so the menu can paint once (hidden) to be
  // measured, then show at the corrected spot without a visible jump.
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [menuFilter, setMenuFilter] = useState("");
  const [drag, setDrag] = useState<{ sourceId: string; x1: number; y1: number; x2: number; y2: number } | null>(null);
  // A plain click (pointerdown+up with no movement) on a bar selects it so
  // the detail strip below can show its dependency counts — set from
  // `endBarEdit`, which already distinguishes a click from a drag via
  // `drag.moved`.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The visible month window — null means "Fit" (the full dated range,
  // today's original default behaviour). Navigating months or jumping to
  // Today sets an explicit window; "Fit" clears it back to null.
  const [manualWindow, setManualWindow] = useState<{ start: number; end: number } | null>(null);
  // "All" draws every dependency line (today's original behaviour);
  // "selected" only draws lines touching the currently selected task, so a
  // dense project's arrows don't compete for attention once something is
  // picked.
  const [depFilter, setDepFilter] = useState<"all" | "selected">("all");
  const rowsRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Declared here (before the early "nothing dated yet" return below), not
  // next to the drag handlers that use it — a hook called only on some
  // renders (e.g. only once there's dated content) desyncs React's hook
  // order between renders and throws #310 the moment the list goes from
  // empty to non-empty or back.
  const barDragRef = useRef<{ itemId: string; element: HTMLElement; pointerId: number; startClientX: number; trackWidthPx: number; mode: "move" | "start" | "end"; originalStart: number; originalEnd: number; nextStart: number; nextEnd: number; moved: boolean } | null>(null);
  // Live bar-drag position, in state so the bar and its dependency lines
  // re-render together while dragging (no imperative style that React would
  // clobber on the next render) and so the bar stays put on drop through the
  // async write + refresh instead of snapping back to its old date.
  const [barDrag, setBarDrag] = useState<{ itemId: string; start: number; end: number } | null>(null);
  // Connectors are drawn in real pixels (no distorted viewBox), so the track's
  // rendered width has to be known. A plain useEffect(..., []) ResizeObserver
  // used to miss it: on the render where nothing is dated yet this component
  // early-returns *before* the SVG exists, the effect runs once against a null
  // ref and never re-binds when data arrives — which is why arrowheads never
  // appeared. A callback ref re-attaches the observer every time the node
  // mounts, empty-state or not.
  const [trackWidth, setTrackWidth] = useState(0);
  const trackObserver = useRef<ResizeObserver | null>(null);
  const measureTrack = useCallback((node: SVGSVGElement | null) => {
    trackObserver.current?.disconnect();
    if (!node) return;
    setTrackWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => { const rect = entries[0]?.contentRect; if (rect) setTrackWidth(rect.width); });
    observer.observe(node);
    trackObserver.current = observer;
  }, []);

  // Clamp the menu inside the viewport after it renders at its natural size.
  // Runs before paint (useLayoutEffect) so the first visible frame is already
  // in the right place. `menu.itemId` is in the deps because a different bar's
  // menu has different content and height.
  useLayoutEffect(() => {
    if (!menu) { setMenuPos(null); setMenuFilter(""); return; }
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    setMenuPos({
      x: Math.max(pad, Math.min(menu.x, window.innerWidth - rect.width - pad)),
      y: Math.max(pad, Math.min(menu.y, window.innerHeight - rect.height - pad)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const closeWhenOutside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    window.addEventListener("pointerdown", closeWhenOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("pointerdown", closeWhenOutside); window.removeEventListener("keydown", closeOnEscape); };
  }, [menu]);

  const dated = useMemo(() => items.map((item) => ({ item, range: dateRangeOf(item) })).filter((entry): entry is { item: PluginObject; range: { start: number; end: number } } => entry.range !== null), [items]);
  if (dated.length === 0) return <p className="pd-muted">{t("No dated tasks, issues, milestones, cycles or releases to place on a timeline yet.")}</p>;

  const min = Math.min(...dated.map((entry) => entry.range.start));
  const max = Math.max(...dated.map((entry) => entry.range.end));
  const span = Math.max(max - min, DAY_MS);
  const pad = span * 0.06;
  // "Fit" (the default): the padded range spanning every dated item, exactly
  // what this chart always showed before the month-navigation toolbar
  // existed. Navigating months or jumping to Today overrides it with an
  // explicit `manualWindow`; "Fit" clears that override.
  const fitRangeMin = min - pad;
  const fitRangeSpan = span + pad * 2;
  const rangeMin = manualWindow ? manualWindow.start : fitRangeMin;
  const rangeSpan = manualWindow ? Math.max(manualWindow.end - manualWindow.start, DAY_MS) : fitRangeSpan;
  const pct = (t: number) => Math.min(Math.max(((t - rangeMin) / rangeSpan) * 100, 0), 100);
  const rawPct = (t: number) => ((t - rangeMin) / rangeSpan) * 100;
  const today = Date.now();
  const todayPct = rawPct(today);
  const showTodayLine = todayPct >= 0 && todayPct <= 100;
  function navigateWindow(direction: 1 | -1) {
    const baseStart = startOfMonth(manualWindow ? manualWindow.start : fitRangeMin);
    const nextStart = addMonths(baseStart, direction);
    setManualWindow({ start: nextStart, end: addMonths(nextStart, GANTT_WINDOW_MONTHS) });
  }
  function jumpToToday() {
    const start = startOfMonth(Date.now());
    setManualWindow({ start, end: addMonths(start, GANTT_WINDOW_MONTHS) });
  }
  const sorted = [...dated].sort((left, right) => left.range.start - right.range.start);
  const indexOfId = new Map(sorted.map((entry, index) => [entry.item.id, index]));
  // While a bar is being dragged its range comes from `barDrag`, not the
  // (stale) stored dates — used by both the bar and its dependency lines so
  // they move as one.
  const liveRange = (id: string, base: { start: number; end: number }) =>
    barDrag && barDrag.itemId === id ? { start: barDrag.start, end: barDrag.end } : base;
  const menuItem = menu ? sorted.find((entry) => entry.item.id === menu.itemId) : undefined;

  const ticks = ganttTicks(zoom, rangeMin, rangeMin + rangeSpan);
  // Every tick gets a line; only every nth gets a caption, so the axis stays
  // readable when a long project is zoomed to days.
  const labelEvery = Math.max(1, Math.ceil(ticks.length / 12));

  const successorIndexOf = (id: string) => indexOfId.get(id) as number;
  // Everything below is in real pixels: x = percent-of-track scaled by the
  // measured track width, y = row centre. A dated-but-unmeasured first frame
  // (trackWidth 0) just draws nothing; the callback ref fills it in next tick.
  const toPx = (percent: number) => (percent / 100) * trackWidth;
  const STUB = 10;    // px held straight off an anchored edge before the line turns
  const ARROW_LEN = 7;
  const ARROW_HALF = 4;
  const dependencyLines = trackWidth === 0 ? [] : sorted.flatMap((entry) => depsOf(entry.item).flatMap((dep) => {
    const predecessorIndex = indexOfId.get(dep.on);
    if (predecessorIndex === undefined) return [];
    const successorIndex = successorIndexOf(entry.item.id);
    const kind = dep.kind;
    // Each of the four types anchors to a specific pair of bar edges
    // (flexi-project.com's breakdown): the line leaves the predecessor's
    // start or finish edge and enters the successor's start or finish edge.
    //   finish-start : pred finish → succ start   (arrow points → into the start)
    //   start-start  : pred start  → succ start   (arrow points →)
    //   finish-finish: pred finish → succ finish  (arrow points ← into the finish)
    //   start-finish : pred start  → succ finish  (arrow points ←)
    const predecessor = sorted[predecessorIndex];
    const predRange = liveRange(dep.on, predecessor.range);
    const succRange = liveRange(entry.item.id, entry.range);
    const ax = toPx(pct(kind === "start-start" || kind === "start-finish" ? predRange.start : predRange.end));
    const bx = toPx(pct(kind === "finish-start" || kind === "start-start" ? succRange.start : succRange.end));
    const y1 = predecessorIndex * GANTT_ROW_HEIGHT + GANTT_ROW_HEIGHT / 2;
    const y2 = successorIndex * GANTT_ROW_HEIGHT + GANTT_ROW_HEIGHT / 2;
    const midY = (y1 + y2) / 2;
    if (![ax, bx, y1, y2].every(Number.isFinite)) return [];
    // Orthogonal routing, per type. The STUB keeps the line from turning
    // flush against a bar; when two bars are adjacent the elbow collapses to
    // a clean drop-then-in instead of a wiggle.
    let d: string;
    if (kind === "finish-start") {
      // A clean forward elbow only reads well when the successor starts far
      // enough right to leave room for it. When the bars are stacked and the
      // dates are tangent (successor start ≈ predecessor finish) that elbow
      // collapses to an ugly straight vertical drop, so route the same wrap
      // used when the successor starts *before* the predecessor finishes:
      // jog right off the finish edge, come back left, then point in.
      d = bx - ax >= 2 * STUB
        ? `M ${ax} ${y1} H ${bx - STUB} V ${y2} H ${bx}`
        : `M ${ax} ${y1} H ${ax + STUB} V ${midY} H ${bx - STUB} V ${y2} H ${bx}`;
    } else if (kind === "start-start") {
      const gutter = Math.min(ax, bx) - STUB;   // both starts share a left channel
      d = `M ${ax} ${y1} H ${gutter} V ${y2} H ${bx}`;
    } else if (kind === "finish-finish") {
      const gutter = Math.max(ax, bx) + STUB;   // both finishes share a right channel
      d = `M ${ax} ${y1} H ${gutter} V ${y2} H ${bx}`;
    } else { // start-finish
      const gutter = Math.max(ax, bx) + STUB;
      d = `M ${ax} ${y1} H ${ax - STUB} V ${midY} H ${gutter} V ${y2} H ${bx}`;
    }
    // Arrowhead points *into* the successor bar: right for a start edge,
    // left for a finish edge.
    const into = kind === "finish-start" || kind === "start-start" ? 1 : -1;
    const backX = bx - ARROW_LEN * into;
    const arrow = `${backX},${y2 - ARROW_HALF} ${bx},${y2} ${backX},${y2 + ARROW_HALF}`;
    return [{ key: `${dep.on}->${entry.item.id}`, d, arrow, kind, predId: dep.on, succId: entry.item.id }];
  }));
  // "Selected" hides every arrow except the ones touching the currently
  // selected task — with nothing selected there is nothing to narrow to, so
  // it falls back to showing none rather than silently ignoring the filter.
  const visibleDependencyLines = depFilter === "all"
    ? dependencyLines
    : dependencyLines.filter((line) => selectedId !== null && (line.predId === selectedId || line.succId === selectedId));

  /**
   * `.pd-gantt-rows` scrolls internally past ~12 rows (`max-height: 420px`),
   * and its own `getBoundingClientRect()` is the fixed VIEWPORT box — it
   * does not move when the content inside scrolls. Every other coordinate
   * in this file (bar positions, dependency-line y = index * ROW_HEIGHT) is
   * measured against the scrollable CONTENT's own top, so a pointer position
   * has to add back `scrollTop` (and `scrollLeft`, for completeness) to land
   * in that same space — without it, the drag-connect preview drew several
   * rows off from wherever the pointer actually was the moment the page had
   * scrolled at all.
   */
  function connectPoint(event: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const rows = rowsRef.current;
    if (!rows) return null;
    const rowsRect = rows.getBoundingClientRect();
    return { x: event.clientX - rowsRect.left + rows.scrollLeft, y: event.clientY - rowsRect.top + rows.scrollTop };
  }

  /** Drag a bar's right-edge handle onto another row to create a
   * finish-start dependency — the manual "B after A" case — without any
   * permanently-visible controls cluttering every row. */
  function beginConnect(event: ReactPointerEvent, sourceId: string) {
    event.preventDefault();
    event.stopPropagation();
    const point = connectPoint(event);
    if (!point) return;
    setDrag({ sourceId, x1: point.x, y1: point.y, x2: point.x, y2: point.y });
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }
  function moveConnect(event: ReactPointerEvent) {
    if (!drag) return;
    const point = connectPoint(event);
    if (!point) return;
    setDrag({ ...drag, x2: point.x, y2: point.y });
  }
  function endConnect(event: ReactPointerEvent) {
    if (!drag) return;
    const targetRow = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-gantt-item-id]");
    const targetId = targetRow?.dataset.ganttItemId;
    if (targetId && targetId !== drag.sourceId) onAddDep(targetId, drag.sourceId, "finish-start");
    setDrag(null);
  }

  /**
   * Drag a bar/diamond to change its dates directly. Three modes:
   * - `"move"` (grab the bar body): the whole bar slides, duration preserved.
   * - `"start"` (left edge handle): the start date moves, the end stays —
   *   duration changes. Clamped to keep at least one day of span.
   * - `"end"` (right edge handle): the end date moves, the start stays.
   * Milestones (diamonds) are a point in time and only take `"move"`.
   *
   * `draggable={false}` on the bar keeps this from racing the row's own
   * native HTML5 drag-and-drop, which still owns row reordering.
   *
   * The one rule this enforces: if the item has a predecessor, its start may
   * not land earlier than that dependency allows — moving *later* is always
   * fine (and cascades via `onMoveItem`), moving *earlier* is the conflict a
   * dependency exists to prevent, so it is rejected with a message. This
   * applies to `"move"` and `"start"`; `"end"` never touches the start.
   */
  function beginBarEdit(event: ReactPointerEvent<HTMLElement>, item: PluginObject, range: { start: number; end: number }, mode: "move" | "start" | "end") {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const bar = mode === "move" ? handle : handle.parentElement;
    const track = bar?.parentElement;
    if (!bar || !track) return;
    handle.setPointerCapture(event.pointerId);
    barDragRef.current = {
      itemId: item.id, element: handle, pointerId: event.pointerId, startClientX: event.clientX,
      trackWidthPx: Math.max(track.getBoundingClientRect().width, 1),
      mode, originalStart: range.start, originalEnd: range.end,
      nextStart: range.start, nextEnd: range.end, moved: false,
    };
  }
  function moveBarEdit(event: ReactPointerEvent) {
    const drag = barDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Round the live preview to whole days — the same rounding the drop
    // applies — so the bar tracks the cursor in day steps and doesn't jump
    // on release. Back at the original position = no preview.
    const deltaDays = Math.round(((event.clientX - drag.startClientX) / drag.trackWidthPx) * rangeSpan / DAY_MS);
    if (deltaDays === 0) {
      if (drag.moved) { drag.moved = false; drag.nextStart = drag.originalStart; drag.nextEnd = drag.originalEnd; setBarDrag(null); }
      return;
    }
    drag.moved = true;
    const shift = deltaDays * DAY_MS;
    if (drag.mode === "move") {
      drag.nextStart = drag.originalStart + shift;
      drag.nextEnd = drag.originalEnd + shift;
    } else if (drag.mode === "start") {
      drag.nextStart = Math.min(drag.originalStart + shift, drag.originalEnd - DAY_MS);
      drag.nextEnd = drag.originalEnd;
    } else {
      drag.nextEnd = Math.max(drag.originalEnd + shift, drag.originalStart + DAY_MS);
      drag.nextStart = drag.originalStart;
    }
    setBarDrag({ itemId: drag.itemId, start: drag.nextStart, end: drag.nextEnd });
  }
  async function endBarEdit(event: ReactPointerEvent) {
    const drag = barDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.element.releasePointerCapture(event.pointerId);
    barDragRef.current = null;
    if (!drag.moved || (drag.nextStart === drag.originalStart && drag.nextEnd === drag.originalEnd)) {
      if (!drag.moved) setSelectedId(drag.itemId);
      setBarDrag(null);
      return;
    }
    const item = items.find((candidate) => candidate.id === drag.itemId);
    if (!item) { setBarDrag(null); return; }
    if (drag.mode !== "end") {
      const minStart = earliestStartFor(item, (predecessorId) => {
        const predecessor = items.find((candidate) => candidate.id === predecessorId);
        return predecessor ? dateRangeOf(predecessor) : null;
      });
      if (minStart !== null && drag.nextStart < minStart) {
        setBarDrag(null);
        onConflict(`"${item.title || "Untitled"}" cannot start before ${isoDay(minStart)} — one of its dependencies requires it.`);
        return;
      }
    }
    // Keep the bar pinned at the drop position through the async write +
    // refresh; the next render off fresh data clears `barDrag` with no
    // snap-back to the old dates.
    try {
      await onMoveItem(item, drag.nextStart, drag.nextEnd);
    } finally {
      setBarDrag(null);
    }
  }

  function handleDrop(event: ReactDragEvent, anchorItem: PluginObject) {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData("text/plain");
    if (!draggedId || draggedId === anchorItem.id) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onReorder(draggedId, anchorItem.id, event.clientY < rect.top + rect.height / 2);
  }

  /** Drag the divider between the name column and the track. Width is a CSS
   * variable so the row grid and the track overlay stay in lockstep — they
   * used to hardcode the same pixel value in two places, which is exactly
   * how the gridlines drifted out of alignment once before. */
  function beginLabelResize(event: ReactPointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = labelWidth;
    const onMove = (move: PointerEvent) => {
      const next = Math.min(GANTT_LABEL_MAX, Math.max(GANTT_LABEL_MIN, startWidth + (move.clientX - startX)));
      setLabelWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setLabelWidth((current) => { localStorage.setItem("notible.gantt.labelWidth", String(current)); return current; });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return <div className="pd-gantt" style={{ "--pd-gantt-label-w": `${labelWidth}px` } as CSSProperties}>
    <div className="pd-gantt-toolbar">
      <button type="button" className="pd-gantt-nav-btn" aria-label={t("Previous month")} onClick={() => navigateWindow(-1)}><ChevronLeft size={14} /></button>
      <span className="pd-gantt-range-label">{formatWindowLabel(rangeMin, rangeMin + rangeSpan)}</span>
      <button type="button" className="pd-gantt-nav-btn" aria-label={t("Next month")} onClick={() => navigateWindow(1)}><ChevronRight size={14} /></button>
      <button type="button" onClick={jumpToToday}>{t("Today")}</button>
      <span className="pd-gantt-zoom-label">{t("Zoom")}</span>
      {(["day", "week", "month"] as GanttZoom[]).map((option) => <button type="button" key={option} className={zoom === option ? "active" : ""} onClick={() => setZoom(option)}>{labelOf(option)}</button>)}
      <span className="pd-gantt-zoom-hint">{ZOOM_UNIT_LABEL[zoom]}</span>
      <Select
        ariaLabel={t("Dependencies")}
        value={depFilter}
        onChange={(next) => setDepFilter(next as "all" | "selected")}
        options={[{ value: "all", label: t("Dependencies: All") }, { value: "selected", label: t("Dependencies: Selected") }]}
      />
      <button type="button" className={manualWindow === null ? "active" : ""} onClick={() => setManualWindow(null)}>{t("Fit")}</button>
      <span className="pd-gantt-key" aria-label={t("Colours")}><i className="pd-gantt-bar is-in-progress" />{t("In progress")}<i className="pd-gantt-bar is-blocked" />{t("Blocked")}<i className="pd-gantt-bar is-done" />{t("Done")}</span>
    </div>
    {/* The dates on top, where the eye starts (R4 T13). Same inset as .pd-gantt-track-overlay
        so a 0-100% position here lands on the gridline it names. */}
    <div className="pd-gantt-axis pd-gantt-axis-top">
      {ticks.map((tick, index) => index % labelEvery === 0
        ? <span key={tick} className="pd-gantt-axis-tick" style={{ left: `${pct(tick)}%` }}>{ganttTickLabel(tick, zoom)}</span>
        : null)}
    </div>
    <div className="pd-gantt-rows" ref={rowsRef} style={{ height: sorted.length * GANTT_ROW_HEIGHT }} onPointerMove={(event) => { moveConnect(event); moveBarEdit(event); }} onPointerUp={(event) => { endConnect(event); void endBarEdit(event); }}>
      {sorted.map(({ item, range }) => {
        const shown = liveRange(item.id, range);
        const left = pct(shown.start);
        const width = Math.max(pct(shown.end) - left, 1.2);
        const status = textPropOf(item, "status");
        const statusKey = status.toLowerCase();
        const isDone = statusKey.includes("done");
        const isInProgress = statusKey.includes("progress") || statusKey.includes("doing");
        const isBlocked = statusKey.includes("blocked") || statusKey.includes("waiting");
        const barStatusClass = (isDone ? " is-done" : isBlocked ? " is-blocked" : isInProgress ? " is-in-progress" : "") + (item.id === selectedId ? " is-selected" : "");
        const isMilestone = item.type === "milestone";
        return <div
          className="pd-gantt-row"
          key={item.id}
          data-gantt-item-id={item.id}
          style={{ height: GANTT_ROW_HEIGHT }}
          draggable
          onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => handleDrop(event, item)}
          onContextMenu={(event) => { event.preventDefault(); setMenuPos(null); setMenu({ itemId: item.id, x: event.clientX, y: event.clientY }); }}
        >
          <span className="pd-gantt-reorder-handle" aria-hidden="true" title={t("Drag to reorder")}>⠿</span>
          <span className="pd-gantt-label" title={item.title || t("Untitled")}><strong>{item.title || "Untitled"}</strong><em className={`pd-gantt-kind pd-gantt-kind-${item.type}`}>{labelOf(item.type)}</em>{status && <em className="pd-gantt-status">{labelOf(status)}</em>}</span>
          <div className="pd-gantt-track">
            {/* Milestones are a point in time, not a duration — the industry-
                standard shape for that is a diamond, not a bar. Cycles and
                releases keep a bar (they do span real dates) but get their
                own color plus a full-height "flag" line at the end date,
                since those mark project-wide stage boundaries other rows
                care about. */}
            {isMilestone
              ? <span className={`pd-gantt-bar pd-gantt-bar-${item.type} pd-gantt-diamond${barStatusClass}`} style={{ left: `${left}%` }} draggable={false} title={`${item.title || t("Untitled")} — ${dateLabel(new Date(range.start).toISOString())} — ${t("Drag to change date")}`} onPointerDown={(event) => beginBarEdit(event, item, range, "move")}>
                  <span className="pd-gantt-connect-handle" title={t("Drag to link a dependency")} onPointerDown={(event) => beginConnect(event, item.id)} />
                </span>
              : <span className={`pd-gantt-bar pd-gantt-bar-${item.type}${barStatusClass}`} style={{ left: `${left}%`, width: `${width}%` }} draggable={false} title={`${item.title || t("Untitled")} — ${dateLabel(new Date(range.start).toISOString())} – ${dateLabel(new Date(range.end).toISOString())} — ${t("Drag body to move, edges to resize")}`} onPointerDown={(event) => beginBarEdit(event, item, range, "move")}>
                  <span className="pd-gantt-resize pd-gantt-resize-start" title={t("Drag to change the start date")} onPointerDown={(event) => beginBarEdit(event, item, range, "start")} />
                  <span className="pd-gantt-resize pd-gantt-resize-end" title={t("Drag to change the end date")} onPointerDown={(event) => beginBarEdit(event, item, range, "end")} />
                  <span className="pd-gantt-connect-handle" title={t("Drag to link a dependency")} onPointerDown={(event) => beginConnect(event, item.id)} />
                </span>}
          </div>
        </div>;
      })}
      {/* Single positioned box scoping every overlay (gridlines, dependency
          lines, stage-flag lines) to the track region only — left/width here
          match the row grid's column1+column2+gaps above, so a plain 0-100%
          inside any child lines up with the track column of every row. Kept
          as one shared wrapper (rather than repeating this inset on each
          overlay) after a real bug where the gridlines used this same 256px
          value in their own CSS `left`, but a per-tick inline `style={{left}}`
          silently overrode it — so gridlines were positioned against the
          *whole row's* width instead of just the track's. */}
      <span
        className="pd-gantt-label-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("Resize the name column")}
        title={t("Drag to resize the name column")}
        onPointerDown={beginLabelResize}
      />
      <div className="pd-gantt-track-overlay" style={{ height: sorted.length * GANTT_ROW_HEIGHT }}>
        {/* Drawn in real pixels (userSpace == CSS px), so no viewBox and no
            aspect-ratio distortion to fight — `measureTrack` feeds the track
            width into the % → px conversion. A replaced <svg> still needs its
            box stretched by CSS (`inset:0; width/height:100%`). */}
        <svg className="pd-gantt-deps" aria-hidden="true" ref={measureTrack}>
          {visibleDependencyLines.map((line) => <g key={line.key} className={`pd-gantt-dep pd-gantt-dep-${line.kind}`}><path d={line.d} /><polygon points={line.arrow} /></g>)}
        </svg>
        {/* Plain-pixel overlay (not the % viewBox above) for the live drag
            preview, since it tracks the raw pointer position. */}
        {drag && <svg className="pd-gantt-connect-preview" aria-hidden="true"><line x1={drag.x1 - GANTT_GUTTER - labelWidth} y1={drag.y1} x2={drag.x2 - GANTT_GUTTER - labelWidth} y2={drag.y2} /></svg>}
        {ticks.map((t) => <span key={t} className="pd-gantt-gridline" style={{ left: `${pct(t)}%` }} />)}
        {showTodayLine && <span className="pd-gantt-today-line" style={{ left: `${todayPct}%` }} title={t("Today")} />}
        {/* Cycles get a full-height boundary line at their end date. Releases
            used to as well, but a release already renders a distinct green
            bar spanning start–due, and the line landed exactly on that bar's
            own right edge in the same green — reading as a doubled edge, not
            a marker. The bar carries it. */}
        {sorted.filter(({ item }) => item.type === "cycle").map(({ item, range }) => <span key={item.id} className={`pd-gantt-flag-line pd-gantt-flag-${item.type}`} style={{ left: `${pct(range.end)}%` }} title={`${item.title || "Untitled"}: ${dateLabel(new Date(range.end).toISOString())}`} />)}
      </div>
    </div>

    {(() => {
      const selectedEntry = selectedId ? sorted.find((entry) => entry.item.id === selectedId) : undefined;
      if (!selectedEntry) return null;
      const { item, range } = selectedEntry;
      const days = Math.max(1, Math.round((range.end - range.start) / DAY_MS));
      const predecessorCount = depsOf(item).length;
      const successorCount = sorted.filter((entry) => depsOf(entry.item).some((dep) => dep.on === item.id)).length;
      return <div className="pd-gantt-detail">
        <div className="pd-gantt-detail-main">
          <strong>{item.title || "Untitled"}</strong>
          <span className="pd-gantt-detail-meta">
            {dateLabel(new Date(range.start).toISOString())} – {dateLabel(new Date(range.end).toISOString())} · {t("{count} days", { count: days })}
            {" · "}{t("{count} predecessor", { count: predecessorCount })} · {t("{count} successor", { count: successorCount })}
          </span>
        </div>
        <button type="button" className="pd-gantt-detail-open" onClick={() => onOpenNote(item.id)}>{t("Open task")} →</button>
      </div>;
    })()}

    {menu && menuItem && <div className={`pd-gantt-menu pd-gantt-menu--nested${(menuPos ?? menu).x > window.innerWidth / 2 ? " pd-gantt-menu--left" : ""}`} role="menu" ref={menuRef} style={{ position: "fixed", left: (menuPos ?? menu).x, top: (menuPos ?? menu).y, visibility: menuPos ? "visible" : "hidden" }}>
      <p className="pd-gantt-menu-title">{menuItem.item.title || "Untitled"}</p>
      {(() => {
        const current = depsOf(menuItem.item);
        const currentIds = new Set(current.map((dep) => dep.on));
        const query = menuFilter.trim().toLowerCase();
        const candidates = sorted.filter((candidate) =>
          candidate.item.id !== menuItem.item.id
          && !currentIds.has(candidate.item.id)
          && !wouldCycle(items, menuItem.item.id, candidate.item.id));
        const shown = query ? candidates.filter((c) => (c.item.title || "").toLowerCase().includes(query)) : candidates;
        // rule → element: hover a rule, then pick the predecessor.
        const pickList = (kind: DependencyKind) => <div className="pd-gantt-menu-list">
          {shown.length === 0
            ? <p className="pd-gantt-menu-empty">{candidates.length ? t("No match.") : t("Nothing else can go before this one.")}</p>
            : shown.map((candidate) => <button type="button" key={candidate.item.id} onClick={() => { onAddDep(menuItem.item.id, candidate.item.id, kind); setMenu(null); }}>{candidate.item.title || "Untitled"}</button>)}
        </div>;
        return <>
          {current.map((dep) => {
            const title = items.find((candidate) => candidate.id === dep.on)?.title || "Untitled";
            return <div key={dep.on} className="pd-gantt-menu-dep">
              <span className="pd-gantt-menu-dep-text"><span className="pd-gantt-menu-dep-name">{title}</span><span className="pd-gantt-menu-dep-rule">{DEPENDENCY_KIND_LABEL[dep.kind]}</span></span>
              <div className="pd-gantt-menu-sub">
                <button type="button" className="pd-gantt-menu-sub-toggle" aria-haspopup="menu">{t("Rule")} ▸</button>
                <div className="pd-gantt-menu-flyout">
                  {KIND_OPTIONS.map((opt) => <button type="button" key={opt.value} className={opt.value === dep.kind ? "active" : ""} onClick={() => { onChangeDepKind(menuItem.item.id, dep.on, opt.value); setMenu(null); }}>{opt.label}</button>)}
                </div>
              </div>
              <button type="button" className="pd-gantt-menu-danger" aria-label={`Remove dependency on ${title}`} onClick={() => onRemoveDep(menuItem.item.id, dep.on)}>{t("Remove")}</button>
            </div>;
          })}
          <p className="pd-gantt-menu-hint">{current.length ? t("Add another predecessor — pick a rule:") : t("Link a predecessor — pick a rule:")}</p>
          <input className="pd-gantt-menu-filter" type="text" placeholder={t("Filter tasks…")} value={menuFilter} onChange={(event) => setMenuFilter(event.target.value)} />
          {KIND_OPTIONS.map((opt) => <div className="pd-gantt-menu-sub" key={opt.value}>
            <button type="button" className="pd-gantt-menu-sub-toggle" aria-haspopup="menu">{opt.label} ▸</button>
            <div className="pd-gantt-menu-flyout">{pickList(opt.value)}</div>
          </div>)}
          <div className="pd-gantt-menu-foot">
            <button type="button" onClick={() => { onOpenNote(menuItem.item.id); setMenu(null); }}>{t("Open note")}</button>
          </div>
        </>;
      })()}
    </div>}
  </div>;
}

function ProjectDashboardInner({ context: rawContext, host, initialContainerId, tab: hostTab }: Props) {
  const t = useT();
  const context = rawContext as PluginContext;
  const containerId = initialContainerId ?? "";
  // When Core mounts one tab of this dashboard (API 1.5), the host owns the
  // choice and this component must not draw a second strip below Core's.
  const [tab, setTab] = useState<Tab>(hostTab ?? "tasks");
  useEffect(() => { if (hostTab) setTab(hostTab); }, [hostTab]);
  const [work, setWork] = useState<PluginObject[]>([]);
  const [planning, setPlanning] = useState<PluginObject[]>([]);
  const [types, setTypes] = useState<PluginType[]>([]);
  const [summary, setSummary] = useState<(FinanceSummary & { entryCount: number; timeEntryCount: number }) | null>(null);
  const [entries, setEntries] = useState<PluginObject[]>([]);
  const [projectProps, setProjectProps] = useState<Record<string, unknown>>({});
  const [entryTitle, setEntryTitle] = useState("");
  const [entryValues, setEntryValues] = useState<Record<string, unknown>>({});
  const [budgetDraft, setBudgetDraft] = useState({ baseCurrency: "", plannedBudget: "", approvedBudget: "", openingCash: "", budgetAlertThreshold: "80" });
  const [timeDraft, setTimeDraft] = useState({ title: "", person: "", date: "", hours: "", billableRate: "", costRate: "", billable: true });
  const [scheduleDraft, setScheduleDraft] = useState({ person: "", week: "", hours: "" });
  const [importOpen, setImportOpen] = useState(false);
  const [financeMoreOpen, setFinanceMoreOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState("");
  const [dueFilter, setDueFilter] = useState<"" | "overdue" | "today" | "this_week" | "no_date">("");
  const [propertyFilterKey, setPropertyFilterKey] = useState("");
  const [propertyFilterValue, setPropertyFilterValue] = useState("");

  const financeTypeDef = useMemo(() => types.find((candidate) => candidate.name === "financial_entry"), [types]);

  // 2: Planning items (milestone/cycle/release) get real inline property
  // editing here, same as Finance's entry form — they used to be created as
  // bare notes with no schema fields exposed (Feedback #5 item 2).
  const [planningCreateType, setPlanningCreateType] = useState<"milestone" | "cycle" | "release">("milestone");
  const [planningTitle, setPlanningTitle] = useState("");
  const [planningValues, setPlanningValues] = useState<Record<string, unknown>>({});
  const [editingPlanningId, setEditingPlanningId] = useState<string | null>(null);
  const [planningMenu, setPlanningMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [editingPlanningValues, setEditingPlanningValues] = useState<Record<string, unknown>>({});
  const planningCreateTypeDef = useMemo(() => types.find((candidate) => candidate.name === planningCreateType), [types, planningCreateType]);
  const editingPlanningRecord = useMemo(() => planning.find((item) => item.id === editingPlanningId) ?? null, [planning, editingPlanningId]);
  const editingPlanningTypeDef = useMemo(() => types.find((candidate) => candidate.name === editingPlanningRecord?.type), [types, editingPlanningRecord]);

  function openPlanningEdit(item: PluginObject) {
    setEditingPlanningId(item.id);
    try { setEditingPlanningValues(JSON.parse(item.props) as Record<string, unknown>); } catch { setEditingPlanningValues({}); }
  }

  async function savePlanningEdit() {
    if (!editingPlanningRecord) return;
    const patch = { props: JSON.stringify(editingPlanningValues) };
    try {
      try {
        await context.data.objects.update(editingPlanningRecord.id, patch, editingPlanningRecord.updated_at);
      } catch (value) {
        // Optimistic locking: anything that touched the record since it was
        // read moves updated_at on. Refetch and retry once instead of showing
        // the raw "conflict" string, exactly as Core does.
        if (!isConflict(value)) throw value;
        const fresh = await context.data.objects.get(editingPlanningRecord.id);
        if (!fresh) throw value;
        await context.data.objects.update(fresh.id, patch, fresh.updated_at);
      }
      setEditingPlanningId(null);
      await refresh();
      host?.notifyChanged();
    } catch (value) {
      setError(isConflict(value) ? t("This item changed somewhere else. Reopen it to see the current values.") : errorMessage(value));
    }
  }

  async function deletePlanningItem(id: string) {
    setPlanningMenu(null);
    try {
      await context.data.objects.trash(id);
      if (editingPlanningId === id) setEditingPlanningId(null);
      await refresh();
      host?.notifyChanged();
    } catch (value) { setError(errorMessage(value)); }
  }

  async function createPlanningItemWithValues() {
    const cleanTitle = planningTitle.trim();
    if (!cleanTitle) { setError(t("Add a title before creating a planning item.")); return; }
    try {
      await context.data.objects.create({ type: planningCreateType, title: cleanTitle, parentId: containerId, props: JSON.stringify({ status: "planned", ...planningValues }) });
      // Both, not just the title: leaving the property values behind meant the
      // next item silently inherited the previous one's status and date, and
      // switching type carried fields the new type has no schema for.
      setPlanningTitle("");
      setPlanningValues({});
      await refresh();
      host?.notifyChanged();
    } catch (value) { setError(errorMessage(value)); }
  }

  async function refresh() {
    if (!containerId) return;
    setLoading(true);
    setError("");
    try {
      const [children, nextTypes, nextSummary, project] = await Promise.all([
        context.data.objects.query({ parentId: containerId, limit: 500 }),
        context.data.types.list(),
        financeSummary(context, { parentId: containerId }),
        context.data.objects.get(containerId),
      ]);
      setTypes(nextTypes);
      setSummary(nextSummary);
      setWork(children.filter((item) => WORK_TYPES.includes(item.type)));
      setPlanning(children.filter((item) => PLANNING_TYPES.includes(item.type)));
      setEntries(children.filter((item) => item.type === "financial_entry" || item.type === "time_entry"));
      const props = (() => { try { const parsed = JSON.parse(project?.props ?? "{}") as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } })();
      setProjectProps(props);
      setBudgetDraft({
        baseCurrency: String(props.baseCurrency ?? ""),
        plannedBudget: props.plannedBudget == null ? "" : String(props.plannedBudget),
        approvedBudget: props.approvedBudget == null ? "" : String(props.approvedBudget),
        openingCash: props.openingCash == null ? "" : String(props.openingCash),
        budgetAlertThreshold: props.budgetAlertThreshold == null ? "80" : String(props.budgetAlertThreshold),
      });
    } catch (value) { setError(errorMessage(value)); } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [context, containerId]);
  useEffect(() => { setEntryValues((current) => ({ status: "planned", currency: "USD", ...current })); }, [financeTypeDef]);

  const statusOptions = shownStatuses(selectOptions(types, "task", "status"), projectProps, "task");
  const priorityOptions = selectOptions(types, "task", "priority");
  // 2.4: filters straight from each task's own Properties, not a fixed list —
  // any custom prop key present on at least one task becomes a filterable
  // field, with its value options collected from what's actually in use.
  const STANDARD_KEYS = new Set(["status", "priority", "due", "targetDate", "startDate", "date", "deps", "dependsOn", "dependsOnKind"]);
  const propertyKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of work) for (const key of Object.keys(propsOf(item))) if (!STANDARD_KEYS.has(key)) keys.add(key);
    return [...keys].sort();
  }, [work]);
  const propertyValueOptions = useMemo(() => {
    if (!propertyFilterKey) return [];
    const values = new Set<string>();
    for (const item of work) { const value = propsOf(item)[propertyFilterKey]; if (typeof value === "string" && value) values.add(value); }
    return [...values].sort();
  }, [work, propertyFilterKey]);
  const filteredWork = work.filter((item) => {
    const props = propsOf(item);
    if (statusFilters.length > 0 && !statusFilters.includes(String(props.status ?? ""))) return false;
    if (priorityFilter && props.priority !== priorityFilter) return false;
    if (dueFilter) {
      const due = dateOf(item);
      if (dueFilter === "no_date") { if (due) return false; }
      else {
        if (!due) return false;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const dueDate = new Date(`${due.slice(0, 10)}T00:00:00`);
        if (dueFilter === "overdue" && !(dueDate < today)) return false;
        if (dueFilter === "today" && dueDate.getTime() !== today.getTime()) return false;
        if (dueFilter === "this_week") {
          const weekStart = new Date(today); weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
          const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);
          if (!(dueDate >= weekStart && dueDate < weekEnd)) return false;
        }
      }
    }
    if (propertyFilterKey && propertyFilterValue && String(props[propertyFilterKey] ?? "") !== propertyFilterValue) return false;
    return true;
  });

  async function updateProp(id: string, key: string, value: string) {
    return updateProps(id, { [key]: value });
  }

  // Batches multiple prop keys into one write — e.g. a reorder-driven date
  // shift touches startDate + due together, and two sequential updateProp
  // calls would race (the second reads the pre-refresh, now-stale
  // updated_at token and gets rejected by the optimistic-concurrency check).
  async function updateProps(id: string, patch: Record<string, string>) {
    const object = work.find((candidate) => candidate.id === id) ?? planning.find((candidate) => candidate.id === id);
    if (!object) return;
    const props = { ...propsOf(object) };
    for (const [key, value] of Object.entries(patch)) { if (value) props[key] = value; else delete props[key]; }
    try {
      const updated = await context.data.objects.update(id, { props: JSON.stringify(props) }, object.updated_at);
      // A date edit anywhere (drag, Tasks, Properties) must re-check the
      // chain immediately — otherwise "B after A" only held until the next
      // unrelated write happened to reload it. The edited item is
      // authoritative; the cascade pushes whatever depends on it forward.
      // (Dependency edits run their own cascade in `setItemDeps`.)
      const datesChanged = ["startDate", "due", "targetDate", "date"].some((key) => key in patch);
      if (datesChanged) {
        await cascadeFrom(id, updated);
      }
      await refresh();
      host?.notifyChanged();
    } catch (value) { setError(errorMessage(value)); }
  }

  /** Push every item chained off `rootId` (whose fresh state is `rootObject`)
   * to satisfy its dependency constraints, preserving each one's duration.
   * Shared by a date edit (root = the edited item) and a dependency edit
   * (root = the just-added predecessor, so the newly-linked item is itself
   * re-checked against it). */
  async function cascadeFrom(rootId: string, rootObject: PluginObject) {
    const all = [...work, ...planning].map((candidate) => candidate.id === rootObject.id ? rootObject : candidate);
    const byId = new Map(all.map((candidate) => [candidate.id, candidate]));
    const rootRange = dateRangeOf(byId.get(rootId) ?? rootObject);
    if (!rootRange) return;
    const cascaded = cascadeDependents(all, rootId, rootRange);
    await Promise.all(cascaded.map((change) => {
      const successor = byId.get(change.id)!;
      return context.data.objects.update(successor.id, { props: JSON.stringify({ ...propsOf(successor), startDate: change.startDate, [change.endKey]: change.endDate }) }, successor.updated_at);
    }));
  }

  /** Write an item's full predecessor list (the `deps` prop), dropping the
   * pre-0.71.2 single-predecessor keys on the way. `cascadeFromPredecessorId`
   * is set when a predecessor was just added, so the item is re-checked
   * against it (and anything downstream is pushed in turn). */
  async function setItemDeps(id: string, deps: Dep[], cascadeFromPredecessorId?: string) {
    const object = work.find((candidate) => candidate.id === id) ?? planning.find((candidate) => candidate.id === id);
    if (!object) return;
    const props = { ...propsOf(object) };
    if (deps.length) props.deps = deps; else delete props.deps;
    delete props.dependsOn;
    delete props.dependsOnKind;
    try {
      const updated = await context.data.objects.update(id, { props: JSON.stringify(props) }, object.updated_at);
      if (cascadeFromPredecessorId) await cascadeFrom(cascadeFromPredecessorId, updated);
      await refresh();
      host?.notifyChanged();
    } catch (value) { setError(errorMessage(value)); }
  }

  function addDep(itemId: string, predecessorId: string, kind: DependencyKind = "finish-start") {
    const item = [...work, ...planning].find((candidate) => candidate.id === itemId);
    if (!item) return;
    if (wouldCycle([...work, ...planning], itemId, predecessorId)) {
      setError(t("That link would create a circular dependency."));
      return;
    }
    const current = depsOf(item);
    if (current.some((dep) => dep.on === predecessorId)) return;
    void setItemDeps(itemId, [...current, { on: predecessorId, kind }], predecessorId);
  }

  function changeDepKind(itemId: string, predecessorId: string, kind: DependencyKind) {
    const item = [...work, ...planning].find((candidate) => candidate.id === itemId);
    if (!item) return;
    const current = depsOf(item);
    if (!current.some((dep) => dep.on === predecessorId && dep.kind !== kind)) return;
    void setItemDeps(itemId, current.map((dep) => dep.on === predecessorId ? { ...dep, kind } : dep), predecessorId);
  }

  function removeDep(itemId: string, predecessorId: string) {
    const item = [...work, ...planning].find((candidate) => candidate.id === itemId);
    if (!item) return;
    void setItemDeps(itemId, depsOf(item).filter((dep) => dep.on !== predecessorId));
  }

  /** Manual row reorder (drag a Gantt row before/after another): shifts the
   * dragged item's own date range to sit right at the anchor's edge,
   * preserving its duration — the "B must be after A, done by hand" case.
   * `updateProps` cascades the shift to whatever else depends on it. */
  /** Drag-to-move a bar directly (see `beginBarDrag` in `GanttChart` for the
   * conflict check that runs before this is ever called). */
  async function moveItem(item: PluginObject, start: number, end: number) {
    await updateProps(item.id, { startDate: isoDay(start), [endKeyOf(item)]: isoDay(end) });
  }

  function reorderByDrag(id: string, anchorId: string, before: boolean) {
    const all = [...work, ...planning];
    const dragged = all.find((candidate) => candidate.id === id);
    const anchor = all.find((candidate) => candidate.id === anchorId);
    if (!dragged || !anchor) return;
    const draggedRange = dateRangeOf(dragged);
    const anchorRange = dateRangeOf(anchor);
    if (!draggedRange || !anchorRange) return;
    const duration = Math.max(draggedRange.end - draggedRange.start, 0);
    const newStart = before ? anchorRange.start - duration : anchorRange.end;
    void updateProps(id, { startDate: isoDay(newStart), [endKeyOf(dragged)]: isoDay(newStart + duration) });
  }

  async function createTask(status?: string) {
    try {
      await context.data.objects.create({ type: "task", title: t("New task"), parentId: containerId, props: JSON.stringify({ status: status || "todo", priority: "none" }) });
      await refresh();
      host?.notifyChanged();
    } catch (value) { setError(errorMessage(value)); }
  }

  async function createEntry() {
    if (!entryTitle.trim()) { setError("Title is required."); return; }
    setError(""); setNotice("");
    try {
      await context.data.objects.create({ type: "financial_entry", title: entryTitle.trim(), parentId: containerId, props: JSON.stringify(entryValues) });
      setEntryTitle("");
      setNotice(t("Entry added to project."));
      await refresh();
    } catch (value) { setError(errorMessage(value)); }
  }

  // Finance: budget fields and the resource schedule live on the project
  // object's props, not on a child. One merge helper for both.
  async function onPersistProjectProps(patch: Record<string, unknown>) {
    try {
      const project = await context.data.objects.get(containerId);
      if (!project) return;
      const props = (() => { try { const parsed = JSON.parse(project.props) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } })();
      for (const [key, value] of Object.entries(patch)) { if (value === "" || value == null) delete props[key]; else props[key] = value; }
      await context.data.objects.update(containerId, { props: JSON.stringify(props) }, project.updated_at);
      await refresh();
    } catch (value) { setError(errorMessage(value)); }
  }

  async function createTimeEntry() {
    if (!timeDraft.title.trim()) { setError(t("Work description is required.")); return; }
    setError(""); setNotice("");
    try {
      await context.data.objects.create({ type: "time_entry", title: timeDraft.title.trim(), parentId: containerId, props: JSON.stringify({
        person: timeDraft.person, date: timeDraft.date, hours: Number(timeDraft.hours) || 0,
        billable: timeDraft.billable, billableRate: Number(timeDraft.billableRate) || 0,
        costRate: Number(timeDraft.costRate) || 0, currency: budgetDraft.baseCurrency || "",
      }) });
      setTimeDraft({ title: "", person: "", date: "", hours: "", billableRate: "", costRate: "", billable: true });
      setNotice(t("Time entry added."));
      await refresh();
    } catch (value) { setError(errorMessage(value)); }
  }

  const financialEntries = entries.filter((entry) => entry.type === "financial_entry");
  const timeEntries = entries.filter((entry) => entry.type === "time_entry");

  type ResourceAllocation = { id: string; person: string; week: string; hours: number };
  const allocations: ResourceAllocation[] = Array.isArray(projectProps._resourceSchedule)
    ? (projectProps._resourceSchedule as unknown[]).filter((row): row is ResourceAllocation =>
        !!row && typeof row === "object" && typeof (row as ResourceAllocation).person === "string" && typeof (row as ResourceAllocation).week === "string")
    : [];
  const scheduleWeeks = [...new Set(allocations.map((row) => row.week))].sort();
  const schedulePeople = [...new Set([
    ...allocations.map((row) => row.person),
    ...timeEntries.map((entry) => { try { return String((JSON.parse(entry.props) as { person?: unknown }).person ?? ""); } catch { return ""; } }).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b));

  async function setAllocation() {
    const person = scheduleDraft.person.trim();
    const week = scheduleDraft.week.trim();
    if (!person || !week) return;
    const hours = Number(scheduleDraft.hours);
    const existing = allocations.find((row) => row.person.toLocaleLowerCase() === person.toLocaleLowerCase() && row.week === week);
    const next = !hours || Number.isNaN(hours)
      ? allocations.filter((row) => row.id !== existing?.id)
      : existing
        ? allocations.map((row) => row.id === existing.id ? { ...row, person, hours } : row)
        : [...allocations, { id: crypto.randomUUID(), person, week, hours }];
    setScheduleDraft({ person: "", week: "", hours: "" });
    await onPersistProjectProps({ _resourceSchedule: next });
  }

  async function exportFinanceCsv() {
    try {
      const path = await context.ui.exportFile(`finance-${containerId.slice(0, 8)}.csv`, financeCsv(financialEntries, timeEntries));
      context.ui.notice(t("Exported to {path}", { path }));
    } catch (value) { context.ui.notice(t("Export failed: {message}", { message: value instanceof Error ? value.message : String(value) })); }
  }
  async function exportFinanceXlsx() {
    try {
      const bytes = xlsxBytes("Finance", FINANCE_HEADERS, financeRows(financialEntries, timeEntries));
      const path = await context.ui.exportBinary(`finance-${containerId.slice(0, 8)}.xlsx`, bytesToBase64(bytes), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      context.ui.notice(t("Exported to {path}", { path }));
    } catch (value) { context.ui.notice(t("Export failed: {message}", { message: value instanceof Error ? value.message : String(value) })); }
  }
  async function importFinanceCsv(file: File) {
    setError("");
    try {
      const { headers, rows } = parseDelimited(await file.text());
      let count = 0;
      for (const row of rows) {
        const record = financeImportRow(headers, row);
        if (!record) continue;
        await context.data.objects.create({ type: record.type, title: record.title, props: JSON.stringify(record.props), parentId: containerId });
        count += 1;
      }
      context.ui.notice(t("Imported {count} records", { count: String(count) }));
      setImportOpen(false);
      await refresh();
    } catch (value) { setError(errorMessage(value)); }
  }

  function financeAlertText(alert: FinanceAlert): string {
    switch (alert.key) {
      case "finance.alert.budgetThreshold": return t("Budget threshold reached");
      case "finance.alert.forecastExceedsBudget": return t("Forecast exceeds the approved budget");
      case "finance.alert.runwayLow": return t("Runway is below three months");
      case "finance.alert.marginNegative": return t("Project margin is negative");
      case "finance.alert.currencyExcluded": return t("Excluded {currencies} entries — totals are shown in {base}", alert.params);
      case "finance.alert.currencyMixedNoBase": return t("Totals unavailable: entries use {currencies}. Set a base currency.", alert.params);
      default: return "";
    }
  }

  if (!containerId) return <div className="pd-empty"><p>{t("No container selected.")}</p></div>;

  return <section className="pd-dashboard" data-plugin-surface="notible.planning">
    {!hostTab && <nav className="pd-tabs" role="tablist">{TABS.map((candidate) => <button type="button" key={candidate.id} role="tab" aria-selected={tab === candidate.id} className={tab === candidate.id ? "active" : ""} onClick={() => setTab(candidate.id)}>{t(candidate.label)}</button>)}</nav>}
    {error && <div className="pd-message pd-error" role="alert">{error}</div>}
    {notice && <div className="pd-message pd-notice" role="status">{notice}</div>}
    {loading && <p className="pd-muted">{t("Loading…")}</p>}

    {tab === "tasks" && <div className="pd-panel core-view-in" key="tasks">
      <div className="pd-panel-actions">
        <button type="button" className="pd-primary" onClick={() => void createTask()}>+ New task</button>
        <label className="pd-filter">Status
          <div className="pd-multiselect-menu">
            <button type="button" className="pd-multiselect-toggle" onClick={() => setStatusMenuOpen((current) => !current)}>{statusFilters.length === 0 ? "All" : `${statusFilters.length} selected`}</button>
            {statusMenuOpen && <div className="pd-multiselect-panel" role="menu" onMouseLeave={() => setStatusMenuOpen(false)}>
              {statusOptions.map((option) => <label key={option}><input type="checkbox" checked={statusFilters.includes(option)} onChange={(event) => setStatusFilters((current) => event.target.checked ? [...current, option] : current.filter((value) => value !== option))} />{labelOf(option)}</label>)}
            </div>}
          </div>
        </label>
        <label className="pd-filter">{t("Priority")}<Select value={priorityFilter} ariaLabel={t("Priority")} placeholder={t("All")} onChange={(next) => setPriorityFilter(next)} options={priorityOptions.map((option) => ({ value: option, label: labelOf(option) }))} /></label>
        <label className="pd-filter">{t("Due")}<Select value={dueFilter} ariaLabel={t("Due")} placeholder={t("Any")} onChange={(next) => setDueFilter(next as typeof dueFilter)} options={[{ value: "overdue", label: "Overdue" }, { value: "today", label: "Today" }, { value: "this_week", label: "This week" }, { value: "no_date", label: "No date" }]} /></label>
        {propertyKeys.length > 0 && <label className="pd-filter">{t("Property")}<Select value={propertyFilterKey} ariaLabel={t("Property")} placeholder={t("None")} onChange={(next) => { setPropertyFilterKey(next); setPropertyFilterValue(""); }} options={propertyKeys.map((key) => ({ value: key, label: labelOf(key) }))} /></label>}
        {propertyFilterKey && <label className="pd-filter">{t("Value")}<Select value={propertyFilterValue} ariaLabel={t("Value")} placeholder={t("Any")} onChange={(next) => setPropertyFilterValue(next)} options={propertyValueOptions.map((value) => ({ value, label: value }))} /></label>}
      </div>
      <div className="pd-kanban-scroll">
        <ViewContent layout="kanban" objects={filteredWork} statusOptions={statusOptions.length > 0 ? statusOptions : ["todo", "in-progress", "done"]} priorityOptions={priorityOptions.length > 0 ? priorityOptions : ["low", "medium", "high"]} onOpenObject={(id) => void host?.openObject(id)} onUpdateProp={(id, key, value) => void updateProp(id, key, value)} onCreate={(_type, _date, status) => void createTask(status)} />
      </div>
    </div>}

    {tab === "timeline" && <div className="pd-panel core-view-in" key="timeline">
      <div className="pd-panel-actions">
        <h3 className="pd-timeline-heading">{t("Timeline")}</h3>
      </div>
      <GanttChart items={[...work, ...planning]} onAddDep={addDep} onChangeDepKind={changeDepKind} onRemoveDep={removeDep} onOpenNote={(id) => void host?.openObject(id)} onReorder={reorderByDrag} onMoveItem={moveItem} onConflict={setError} />
    </div>}

    {tab === "milestones" && <div className="pd-panel pd-panel-narrow core-view-in" key="milestones">
      <div className="pd-card pd-create">
        <div className="pd-create-head">
          <h3>{t("New planning item")}</h3>
          <p className="pd-muted">{t("A milestone is a date to hit, a cycle is a stretch of work, a release is something you ship.")}</p>
        </div>
        <div className="pd-create-row">
          <label className="pd-field">
            <span>{t("Type")}</span>
            <Select
              value={planningCreateType}
              ariaLabel={t("Type")}
              onChange={(next) => { setPlanningCreateType(next as typeof planningCreateType); setPlanningValues({}); }}
              options={[
                { value: "milestone", label: t("Milestone") },
                { value: "cycle", label: t("Cycle") },
                { value: "release", label: t("Release") },
              ]}
            />
          </label>
          <label className="pd-field">
            <span>{t("Title")}</span>
            <input placeholder={t("What is it called?")} value={planningTitle} onChange={(event) => setPlanningTitle(event.target.value)} />
          </label>
        </div>
        <PropertiesEditor type={planningCreateTypeDef} values={planningValues} onChange={setPlanningValues} context={context} />
        <div className="pd-create-actions">
          <button type="button" className="pd-primary" disabled={!planningTitle.trim()} onClick={() => void createPlanningItemWithValues()}>{t("Create")}</button>
        </div>
      </div>

      {editingPlanningRecord && <div className="pd-card">
        <h3>{editingPlanningRecord.title || "Untitled"}</h3>
        <PropertiesEditor type={editingPlanningTypeDef} values={editingPlanningValues} onChange={setEditingPlanningValues} context={context} />
        <div className="pd-panel-actions">
          <button type="button" className="pd-primary" onClick={() => void savePlanningEdit()}>{t("Save")}</button>
          <button type="button" className="pd-secondary" onClick={() => setEditingPlanningId(null)}>{t("Cancel")}</button>
          <button type="button" className="pd-secondary" onClick={() => void host?.openObject(editingPlanningRecord.id)}>{t("Open note (description)")}</button>
        </div>
      </div>}

      {planning.length === 0
        ? <p className="pd-muted">{t("No milestones, cycles or releases yet.")}</p>
        : <div className="pd-plan-board">
            {([["milestone", t("Milestones")], ["release", t("Releases")], ["cycle", t("Cycles")]] as const).map(([kind, heading]) => {
              const items = planning.filter((item) => item.type === kind);
              return <section className="pd-plan-col" key={kind}>
                <header className="pd-plan-col-head"><span>{heading}</span><span className="pd-plan-col-count">{items.length}</span></header>
                {items.length === 0
                  ? <p className="pd-plan-col-empty">—</p>
                  : items.map((item) => <button
                      type="button"
                      key={item.id}
                      className="pd-plan-card"
                      onClick={() => openPlanningEdit(item)}
                      onContextMenu={(event) => { event.preventDefault(); setPlanningMenu({ id: item.id, x: event.clientX, y: event.clientY }); }}
                    >
                      <strong>{item.title || "Untitled"}</strong>
                      <small>{dateLabel(dateOf(item)) || "No date"}</small>
                    </button>)}
              </section>;
            })}
          </div>}

      {planningMenu && <div className="pd-gantt-menu" role="menu" style={{ position: "fixed", left: planningMenu.x, top: planningMenu.y }}>
        <button type="button" onClick={() => { const item = planning.find((candidate) => candidate.id === planningMenu.id); if (item) openPlanningEdit(item); setPlanningMenu(null); }}>{t("Edit")}</button>
        <button type="button" onClick={() => { void host?.openObject(planningMenu.id); setPlanningMenu(null); }}>{t("Open note")}</button>
        <button type="button" className="pd-gantt-menu-danger" onClick={() => void deletePlanningItem(planningMenu.id)}>{t("Move to trash")}</button>
      </div>}
      {planningMenu && <div className="pd-menu-backdrop" onClick={() => setPlanningMenu(null)} onContextMenu={(event) => { event.preventDefault(); setPlanningMenu(null); }} />}
    </div>}

    {tab === "calendar" && <div className="pd-panel core-view-in" key="calendar">
      <div className="pd-panel-actions">
        <h3 className="pd-timeline-heading">{t("Calendar")}</h3>
      </div>
      <CalendarMonthView context={context} containerId={containerId} host={host} />
    </div>}

    {tab === "finance" && <div className="pd-panel core-view-in" key="finance">
      {/* Import and export in one "⋯" menu, not three buttons before any data (V-SURFACES-06). */}
      <div className="pd-finance-toolbar">
        <span className="pd-more">
          <button type="button" className={financeMoreOpen || importOpen ? "active" : ""} aria-expanded={financeMoreOpen} aria-label={t("More actions")} title={t("More actions")} onClick={() => setFinanceMoreOpen((current) => !current)}>⋯</button>
          {financeMoreOpen && <span className="pd-more-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { setFinanceMoreOpen(false); void exportFinanceCsv(); }}>{t("Export CSV")}</button>
            <button type="button" role="menuitem" onClick={() => { setFinanceMoreOpen(false); void exportFinanceXlsx(); }}>{t("Export XLSX")}</button>
            <button type="button" role="menuitem" onClick={() => { setFinanceMoreOpen(false); setImportOpen((current) => !current); }}>{t("Import CSV")}</button>
          </span>}
        </span>
      </div>
      {importOpen && <div className="pd-card"><label className="pd-finance-import"><input type="file" accept=".csv,.tsv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFinanceCsv(file); }} /><span>{t("Choose a finance CSV (record_type column: financial_entry / time_entry)")}</span></label></div>}

      {(() => {
        const cur = summary?.reportingCurrency ?? "";
        const unavailable = !!summary && !summary.monetaryTotalsAvailable;
        const money = (value: number | undefined) =>
          unavailable ? "—" : `${Number(value ?? 0).toFixed(2)}${cur ? ` ${cur}` : ""}`;
        const rows: Array<[string, string]> = [
          [t("Actual cost"), money(summary?.actualCost)],
          [t("Actual income"), money(summary?.actualIncome)],
          [t("Time cost"), money(summary?.timeCost)],
          [t("Billable revenue"), money(summary?.billableRevenue)],
          [t("Margin"), money(summary?.margin)],
          [t("Forecast at completion"), money(summary?.forecastAtCompletion)],
          [t("Budget used %"), `${Number(summary?.budgetUsedPercent ?? 0).toFixed(2)}%`],
        ];
        // Nothing recorded yet: one sentence instead of seven zeros (V-SURFACES-06).
        const nothingYet = !summary || [summary.actualCost, summary.actualIncome, summary.timeCost, summary.billableRevenue].every((value) => !value);
        if (nothingYet) return <p className="pd-finance-empty">{t("No costs, income or time recorded yet. Set a budget below, or add a time entry or a cost to this project.")}</p>;
        return <div className="pd-metrics">{rows.map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>;
      })()}
      {summary && !summary.monetaryTotalsAvailable && summary.currencyBreakdown.length > 0 && (
        <div className="pd-finance-alerts" role="status">
          {summary.currencyBreakdown.map((b) => (
            <span key={b.currency}>{t("{currency}: cost {cost}, income {income}", { currency: b.currency, cost: b.actualCost.toFixed(2), income: b.actualIncome.toFixed(2) })}</span>
          ))}
        </div>
      )}
      {summary && summary.alerts.length > 0 && <div className="pd-finance-alerts" role="status">{summary.alerts.map((alert) => <span key={alert.key}>{financeAlertText(alert)}</span>)}</div>}

      <div className="pd-card pd-finance-budget">
        <h3>{t("Budget")}</h3>
        <div className="pd-finance-budget-grid">
          <label>{t("Base currency")}<input value={budgetDraft.baseCurrency} onChange={(event) => setBudgetDraft({ ...budgetDraft, baseCurrency: event.target.value })} onBlur={() => void onPersistProjectProps({ baseCurrency: budgetDraft.baseCurrency.trim() })} /></label>
          {([["plannedBudget", tr("Planned budget")], ["approvedBudget", tr("Approved budget")], ["openingCash", tr("Opening cash")]] as const).map(([field, label]) => <label key={field}>{t(label)}<input type="number" step="0.01" value={budgetDraft[field]} onChange={(event) => setBudgetDraft({ ...budgetDraft, [field]: event.target.value })} onBlur={() => void onPersistProjectProps({ [field]: budgetDraft[field] === "" ? "" : Number(budgetDraft[field]) })} /></label>)}
          <label>{t("Alert at")}<span className="pd-finance-threshold"><input type="number" min="1" max="100" value={budgetDraft.budgetAlertThreshold} onChange={(event) => setBudgetDraft({ ...budgetDraft, budgetAlertThreshold: event.target.value })} onBlur={() => void onPersistProjectProps({ budgetAlertThreshold: Number(budgetDraft.budgetAlertThreshold) || 80 })} />%</span></label>
        </div>
      </div>

      <div className="pd-card">
        <h3>{t("New financial entry")}</h3>
        <div className="pd-finance-entry-form">
          <label>{t("Title")}<input value={entryTitle} onChange={(event) => setEntryTitle(event.target.value)} /></label>
        </div>
        <PropertiesEditor type={financeTypeDef} values={entryValues} onChange={setEntryValues} context={context} />
        <button type="button" className="pd-primary" onClick={() => void createEntry()}>{t("Add entry")}</button>
      </div>

      <div className="pd-card">
        <h3>{t("New time entry")}</h3>
        <div className="pd-finance-time-form">
          <label>{t("Work description")}<input value={timeDraft.title} onChange={(event) => setTimeDraft({ ...timeDraft, title: event.target.value })} /></label>
          <label>{t("Person")}<input value={timeDraft.person} onChange={(event) => setTimeDraft({ ...timeDraft, person: event.target.value })} /></label>
          <label>{t("Date")}<DatePicker value={timeDraft.date} ariaLabel={t("Date")} onChange={(next) => setTimeDraft({ ...timeDraft, date: next })} /></label>
          <label>{t("Hours")}<input type="number" step="0.25" value={timeDraft.hours} onChange={(event) => setTimeDraft({ ...timeDraft, hours: event.target.value })} /></label>
          <label>{t("Billable rate")}<input type="number" step="0.01" value={timeDraft.billableRate} onChange={(event) => setTimeDraft({ ...timeDraft, billableRate: event.target.value })} /></label>
          <label>{t("Cost rate")}<input type="number" step="0.01" value={timeDraft.costRate} onChange={(event) => setTimeDraft({ ...timeDraft, costRate: event.target.value })} /></label>
          <label className="pd-finance-billable"><input type="checkbox" checked={timeDraft.billable} onChange={(event) => setTimeDraft({ ...timeDraft, billable: event.target.checked })} />{t("Billable")}</label>
        </div>
        <button type="button" className="pd-primary" onClick={() => void createTimeEntry()}>{t("Add time entry")}</button>
      </div>

      <div className="pd-card">
        <h3>{t("Weekly capacity schedule")}</h3>
        <div className="pd-finance-schedule-form">
          <input placeholder={t("Person")} value={scheduleDraft.person} onChange={(event) => setScheduleDraft({ ...scheduleDraft, person: event.target.value })} />
          <input placeholder={t("Week (e.g. 2026-W12)")} value={scheduleDraft.week} onChange={(event) => setScheduleDraft({ ...scheduleDraft, week: event.target.value })} />
          <input type="number" step="0.5" placeholder={t("Hours")} value={scheduleDraft.hours} onChange={(event) => setScheduleDraft({ ...scheduleDraft, hours: event.target.value })} />
          <button type="button" className="pd-primary" onClick={() => void setAllocation()} disabled={!scheduleDraft.person.trim() || !scheduleDraft.week.trim()}>{t("Set allocation")}</button>
        </div>
        {allocations.length === 0
          ? <p className="pd-muted">{t("No planned allocations yet.")}</p>
          : <div className="pd-finance-schedule-scroll"><div className="pd-finance-schedule" style={{ gridTemplateColumns: `minmax(140px, 1.2fr) repeat(${scheduleWeeks.length}, minmax(80px, .7fr)) minmax(70px, .5fr)` }}>
              <strong />{scheduleWeeks.map((week) => <strong key={week}>{week}</strong>)}<strong>{t("Total")}</strong>
              {schedulePeople.map((person) => <Fragment key={person}>
                <span>{person}</span>
                {scheduleWeeks.map((week) => { const cell = allocations.find((row) => row.person === person && row.week === week); return <button type="button" key={week} onClick={() => setScheduleDraft({ person, week, hours: cell ? String(cell.hours) : "" })}>{cell?.hours ?? ""}</button>; })}
                <strong>{allocations.filter((row) => row.person === person).reduce((sum, row) => sum + Number(row.hours), 0)}h</strong>
              </Fragment>)}
            </div></div>}
      </div>

      <div className="pd-card">
        <h3>{t("Entries")} · {entries.length}</h3>
        {entries.length === 0 ? <p className="pd-muted">{t("No financial or time entries for this project yet.")}</p> : <div className="pd-record-list">{entries.map((entry) => <button type="button" key={entry.id} onClick={() => void host?.openObject(entry.id)}><strong>{entry.title || "Untitled"}</strong><small>{entry.type}</small></button>)}</div>}
      </div>
    </div>}
  </section>;
}

/** Translation for every component below, from the plugin's own context. The
 * provider has to sit outside the component that consumes it, so the surface
 * proper is `ProjectDashboardInner`. */
export default function ProjectDashboard(props: Props) {
  return <PluginI18nProvider context={props.context as PluginContext}><ProjectDashboardInner {...props} /></PluginI18nProvider>;
}
