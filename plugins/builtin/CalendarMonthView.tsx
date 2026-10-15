import { useEffect, useMemo, useRef, useState } from "react";
import type { PluginContext, PluginObject } from "../../packages/plugin-api/src/index.ts";
import { ensureCalendarEventType, configureCalendar, removeCalendar, projectCalendarConnections, reconcileCalendarConnections, type CalendarConnection } from "./calendar.ts";
import {
  calendarStatus, calendarConnect, calendarDisconnect, calendarListSources, calendarReadRange, calendarSharingStatus,
  type CalendarProvider, type CalendarSource, type CalendarConnectionStatus, type ExternalCalendarEvent,
} from "../../src/core/data/calendar-api.ts";
import "./surface.css";
import "./calendar-month-view.css";
// Rendered inside another builtin surface, which supplies the provider.
import { useT, type Translate } from "./i18n.tsx";
import { Select, DatePicker } from "../../src/core/ui/index.ts";
import { composeEventTimestamps, eventGridDays, moveEventToDay } from "./calendar-month.ts";

interface Props {
  context: PluginContext;
  containerId: string;
  host?: { openObject(id: string): Promise<void> };
}

const REMINDER_OPTIONS = ["none", "at-time", "5-min-before", "30-min-before", "1-day-before"] as const;

/** BCP-47 tag for date formatting, following the app's chosen UI language
 * (mirrored onto <html lang> by applyTheme) rather than a hardcoded locale. */
function calLocale(): string {
  const lang = typeof document !== "undefined" ? document.documentElement.lang?.toLowerCase() : "";
  return lang?.startsWith("pl") ? "pl-PL" : "en-GB";
}

/** Monday-first short weekday names from the active locale — no per-day
 * translation keys needed. */
function weekdayShortNames(): string[] {
  const fmt = new Intl.DateTimeFormat(calLocale(), { weekday: "short" });
  // 2024-01-01 is a Monday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
}

function providerLabel(provider: string): string {
  return provider === "google" ? "Google" : provider === "outlook" ? "Outlook" : provider;
}

function reminderLabel(t: Translate, option: string): string {
  switch (option) {
    case "at-time": return t("At start time");
    case "5-min-before": return t("5 minutes before");
    case "30-min-before": return t("30 minutes before");
    case "1-day-before": return t("1 day before");
    default: return t("No reminder");
  }
}

function isoDate(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** Local-midnight (or local end-of-day) RFC3339 with offset, for provider queries. */
function rfc3339Local(date: Date, endOfDay: boolean): string {
  const d = new Date(date);
  d.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, 0);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(off / 60)}:${pad(off % 60)}`;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthGridDays(monthStart: Date): Date[] {
  const firstWeekday = (monthStart.getDay() + 6) % 7; // Monday-first grid
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  // Only as many whole weeks as the month actually touches — 5 for most, 6
  // when the month both starts late in a week and runs 30+ days, 4 for a
  // 28-day February that starts on a Monday. Never a fixed 6.
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - firstWeekday);
  return Array.from({ length: cellCount }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(day.getDate() + index);
    return day;
  });
}

function errorMessage(value: unknown) { return value instanceof Error ? value.message : String(value); }

function formatExternalWhen(event: ExternalCalendarEvent): string {
  if (event.allDay) {
    // Google/Outlook all-day `end` is exclusive — subtract a day so a
    // one-day event reads as one day, not two.
    const from = event.start.slice(0, 10);
    let to = event.end.slice(0, 10);
    if (to) {
      const back = new Date(`${to}T00:00:00`);
      back.setDate(back.getDate() - 1);
      to = isoDate(back);
    }
    return !to || to <= from ? from : `${from} – ${to}`;
  }
  const fmt = (iso: string) => new Date(iso).toLocaleString(calLocale(), { dateStyle: "medium", timeStyle: "short" });
  return `${fmt(event.start)} – ${fmt(event.end)}`;
}

function propsOf(object: PluginObject): Record<string, unknown> {
  try { const parsed = JSON.parse(object.props) as unknown; return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

export function CalendarMonthView({ context, containerId, host }: Props) {
  const t = useT();
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const [events, setEvents] = useState<PluginObject[]>([]);
  const [external, setExternal] = useState<ExternalCalendarEvent[]>([]);
  const [links, setLinks] = useState<PluginObject[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [externalDetail, setExternalDetail] = useState<ExternalCalendarEvent | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [endDate, setEndDate] = useState("");
  const [origStart, setOrigStart] = useState("");
  const [origEnd, setOrigEnd] = useState("");
  const [otherProps, setOtherProps] = useState<Record<string, unknown>>({});
  const [linkedObjectId, setLinkedObjectId] = useState("");
  const [reminder, setReminder] = useState("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [showConnections, setShowConnections] = useState(false);
  const PROVIDERS: CalendarProvider[] = ["google", "outlook"];
  const [status, setStatus] = useState<Partial<Record<CalendarProvider, CalendarConnectionStatus>>>({});
  const [sources, setSources] = useState<Partial<Record<CalendarProvider, CalendarSource[]>>>({});
  const [connecting, setConnecting] = useState<CalendarProvider | null>(null);
  const [sharingOff, setSharingOff] = useState(false);

  const days = useMemo(() => monthGridDays(monthStart), [monthStart]);

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      await ensureCalendarEventType(context);
      const [nextEvents, children, project] = await Promise.all([
        context.data.objects.query({ type: "calendar_event", parentId: containerId, limit: 500 }),
        context.data.objects.query({ parentId: containerId, limit: 500 }),
        context.data.objects.get(containerId),
      ]);
      setEvents(nextEvents);
      setLinks(children.filter((item) => item.type !== "calendar_event"));
      setConnections(project ? projectCalendarConnections(project) : []);
    } catch (value) { setError(errorMessage(value)); } finally { setBusy(false); }
  }

  async function loadStatus() {
    const on = await calendarSharingStatus();
    setSharingOff(!on);
    if (!on) return;
    for (const provider of PROVIDERS) {
      try {
        const s = await calendarStatus(provider);
        setStatus((current) => ({ ...current, [provider]: s }));
        if (s.connected) {
          const list = await calendarListSources(provider);
          setSources((current) => ({ ...current, [provider]: list }));
          await reconcileConnections(provider, list);
        }
      } catch (value) {
        setError(errorMessage(value));
      }
    }
  }

  /** Drop (or, on a name match, re-point) any stored connection whose calendar
   * is no longer on the account — a calendar removed upstream, or a leftover
   * from before the opaque handle scheme. Without this the stale entry sits in
   * the sync request forever and its events silently never load. */
  async function reconcileConnections(provider: CalendarProvider, list: CalendarSource[]) {
    const project = await context.data.objects.get(containerId);
    const current = project ? projectCalendarConnections(project) : [];
    const { remove, add } = reconcileCalendarConnections(current, list, provider);
    if (remove.length === 0 && add.length === 0) return;
    for (const connectionId of remove) await removeCalendar(context, { projectId: containerId, connectionId });
    for (const entry of add) await configureCalendar(context, { projectId: containerId, ...entry });
    await refresh();
  }

  async function connectProvider(provider: CalendarProvider) {
    setConnecting(provider); setError("");
    try {
      await calendarConnect(provider);
      await loadStatus();
    } catch (value) { setError(errorMessage(value)); }
    finally { setConnecting(null); }
  }

  async function disconnectProvider(provider: CalendarProvider) {
    setError("");
    try {
      await calendarDisconnect(provider);
      setStatus((current) => ({ ...current, [provider]: { provider, configured: current[provider]?.configured ?? true, connected: false } }));
      setSources((current) => ({ ...current, [provider]: [] }));
    } catch (value) { setError(errorMessage(value)); }
  }

  async function toggleSource(provider: CalendarProvider, source: CalendarSource, on: boolean) {
    const connectionId = `${provider}:${source.id}`;
    try {
      if (on) await configureCalendar(context, { projectId: containerId, provider, calendarId: source.id, calendarName: source.name, color: source.color });
      else await removeCalendar(context, { projectId: containerId, connectionId });
      await refresh();
    } catch (value) { setError(errorMessage(value)); }
  }

  useEffect(() => { void refresh(); }, [context, containerId, monthStart]);
  useEffect(() => { void loadStatus(); }, [context]);
  useEffect(() => { if (showConnections) void loadStatus(); }, [showConnections]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const from = rfc3339Local(days[0], false);
      const to = rfc3339Local(days[days.length - 1], true);
      const collected: ExternalCalendarEvent[] = [];
      let failed = false;
      for (const provider of PROVIDERS) {
        if (!status[provider]?.connected) continue;
        // Wait for calendar_list_sources to have run (it fills the Rust handle
        // map). Firing sync before that raced into "unknown calendar".
        if (!sources[provider]) continue;
        const label = provider === "google" ? "Google" : "Outlook";
        const ids = connections
          .filter((c) => c.provider === provider && c.visible !== false && !!c.calendarId)
          .map((c) => c.calendarId as string);
        if (!ids.length) continue;
        try {
          const evs = await calendarReadRange({ provider, calendarIds: ids, from, to });
          if (cancelled) return;
          collected.push(...evs);
        } catch (value) {
          if (!cancelled) { failed = true; setError(`${label}: ${errorMessage(value)}`); }
        }
      }
      if (!cancelled) { setExternal(collected); if (!failed) setError(""); }
    }
    void run();
    return () => { cancelled = true; };
  }, [days, status, connections, sources]);

  const gridStart = days.length ? isoDate(days[0]) : "";
  const gridEnd = days.length ? isoDate(days[days.length - 1]) : "";

  const eventsByDate = useMemo(() => {
    const map = new Map<string, PluginObject[]>();
    for (const event of events) {
      const props = propsOf(event);
      const keys = eventGridDays(String(props.start ?? ""), String(props.end ?? ""), props.allDay !== false, gridStart, gridEnd);
      for (const key of keys) map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [events, gridStart, gridEnd]);
  const externalByDate = useMemo(() => {
    const map = new Map<string, ExternalCalendarEvent[]>();
    for (const event of external) {
      // `eventGridDays` keys timed events by their LOCAL day, treats an all-day
      // / midnight `end` as exclusive, and clips to the visible grid.
      for (const key of eventGridDays(event.start, event.end, event.allDay, gridStart, gridEnd)) {
        map.set(key, [...(map.get(key) ?? []), event]);
      }
    }
    return map;
  }, [external, gridStart, gridEnd]);

  // The form opens next to where you clicked, not under the whole month (T9).
  const [formAt, setFormAt] = useState<{ x: number; y: number } | null>(null);
  // Drag an event onto another day.
  const dragEvent = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const dragOverRef = useRef<string | null>(null);
  const justDragged = useRef(false);
  useEffect(() => {
    const onMove = (pointer: PointerEvent) => {
      const drag = dragEvent.current;
      if (!drag) return;
      if (!drag.moved && Math.hypot(pointer.clientX - drag.x, pointer.clientY - drag.y) < 5) return;
      drag.moved = true;
      const day = (document.elementFromPoint(pointer.clientX, pointer.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-cal-day]")?.dataset.calDay ?? null;
      dragOverRef.current = day;
      setDragOver(day);
    };
    const onUp = () => {
      const drag = dragEvent.current;
      dragEvent.current = null;
      if (drag?.moved) justDragged.current = true;
      const day = dragOverRef.current;
      dragOverRef.current = null;
      setDragOver(null);
      if (drag?.moved && day) void moveEvent(drag.id, day);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp); };
  });
  async function moveEvent(id: string, day: string) {
    const current = events.find((event) => event.id === id);
    if (!current) return;
    const props = propsOf(current);
    const start = String(props.start ?? "");
    if (!start || start.slice(0, 10) === day) return;
    const moved = moveEventToDay(start, String(props.end ?? ""), day);
    try {
      await context.data.objects.update(id, { props: JSON.stringify({ ...props, ...moved }) }, current.updated_at);
      await refresh();
    } catch (value) { setError(errorMessage(value)); }
  }

  function openCreate(date: string, at?: { x: number; y: number }) {
    setFormAt(at ?? null);
    setExternalDetail(null);
    setSelectedDate(date);
    setEditingId(null);
    setTitle("");
    setAllDay(true);
    setStartTime("09:00");
    setEndTime("10:00");
    setEndDate(date);
    setOrigStart("");
    setOrigEnd("");
    setOtherProps({});
    setLinkedObjectId("");
    setReminder("none");
  }
  function openEdit(event: PluginObject, at?: { x: number; y: number }) {
    setFormAt(at ?? null);
    const props = propsOf(event);
    const start = String(props.start ?? "");
    const end = String(props.end ?? "");
    setExternalDetail(null);
    setSelectedDate(start.slice(0, 10));
    setEditingId(event.id);
    setTitle(event.title);
    setAllDay(props.allDay !== false);
    setStartTime(start.length > 10 ? start.slice(11, 16) : "09:00");
    setEndTime(end.length > 10 ? end.slice(11, 16) : "10:00");
    setEndDate((end || start).slice(0, 10));
    setOrigStart(start);
    setOrigEnd(end);
    // Keep every prop we don't have a control for, so a save round-trips it.
    const { start: _s, end: _e, allDay: _a, reminder: _r, linkedObjectId: _l, ...rest } = props;
    setOtherProps(rest);
    setLinkedObjectId(typeof props.linkedObjectId === "string" ? props.linkedObjectId : "");
    setReminder(typeof props.reminder === "string" ? props.reminder : "none");
  }

  async function saveEvent() {
    if (!selectedDate || !title.trim()) { setError(t("Title is required.")); return; }
    const composed = composeEventTimestamps({
      origStart: editingId ? origStart : undefined,
      origEnd: editingId ? origEnd : undefined,
      startDate: selectedDate,
      startTime,
      endDate: endDate || selectedDate,
      endTime,
      allDay,
    });
    if (!composed.ok) {
      setError(composed.reason === "end-before-start"
        ? t("The end must be on or after the start.")
        : t("Enter a valid time between 00:00 and 23:59."));
      return;
    }
    setBusy(true); setError("");
    try {
      const props = { ...otherProps, start: composed.start, end: composed.end, allDay, reminder, ...(linkedObjectId ? { linkedObjectId } : {}) };
      if (editingId) {
        const current = events.find((event) => event.id === editingId);
        await context.data.objects.update(editingId, { title: title.trim(), props: JSON.stringify(props) }, current?.updated_at);
      } else {
        await context.data.objects.create({ type: "calendar_event", title: title.trim(), parentId: containerId, props: JSON.stringify(props) });
      }
      setSelectedDate(null); setEditingId(null);
      await refresh();
    } catch (value) { setError(errorMessage(value)); } finally { setBusy(false); }
  }

  async function deleteEvent() {
    if (!editingId) return;
    setBusy(true); setError("");
    try {
      await context.data.objects.trash(editingId);
      setSelectedDate(null); setEditingId(null);
      await refresh();
    } catch (value) { setError(errorMessage(value)); } finally { setBusy(false); }
  }

  return <div className="cal-month">
    <header className="cal-month-header">
      <button type="button" className="cal-nav" onClick={() => setMonthStart((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} aria-label={t("Previous month")}>‹</button>
      <strong>{monthStart.toLocaleDateString(calLocale(), { month: "long", year: "numeric" })}</strong>
      <button type="button" className="cal-nav" onClick={() => setMonthStart((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} aria-label={t("Next month")}>›</button>
      <button type="button" className="cal-today" onClick={() => setMonthStart(startOfMonth(new Date()))}>{t("Today")}</button>
      <button type="button" className="cal-today" aria-expanded={showConnections} onClick={() => setShowConnections((open) => !open)}>{t("Connections")}{connections.length ? ` · ${connections.length}` : ""}</button>
    </header>
    {error && <div className="cal-error" role="alert">{error}</div>}
    {showConnections && <section className="cal-conn" onClick={(event) => event.stopPropagation()}>
      <h3>{t("External calendars")}</h3>
      {sharingOff && <p className="cal-conn-off">{t("Reading calendars is off. Turn on “Let plugins read your calendars” in Settings → Files & links.")}</p>}
      {!sharingOff && PROVIDERS.map((provider) => {
        const s = status[provider];
        const label = provider === "google" ? "Google" : "Outlook";
        if (!s) return <p key={provider} className="cal-conn-row">{label}: {t("Loading…")}</p>;
        if (!s.configured) return <p key={provider} className="cal-conn-row">{t("{provider} sign-in isn't available in this build.", { provider: label })}</p>;
        if (!s.connected) return <div key={provider} className="cal-conn-row">
          <span>{label}</span>
          <button type="button" className="cal-primary" disabled={connecting !== null} onClick={() => void connectProvider(provider)}>
            {connecting === provider ? t("Waiting for the browser…") : t("Connect {provider}", { provider: label })}
          </button>
        </div>;
        return <div key={provider} className="cal-conn-provider">
          <div className="cal-conn-row"><strong>{label}</strong><span className="cal-conn-ok">{t("Connected")}</span><button type="button" className="cal-secondary" onClick={() => void disconnectProvider(provider)}>{t("Disconnect")}</button></div>
          <ul className="cal-conn-sources">
            {(sources[provider] ?? []).map((source) => {
              const on = connections.some((c) => c.id === `${provider}:${source.id}`);
              return <li key={source.id}><label><input type="checkbox" checked={on} onChange={(event) => void toggleSource(provider, source, event.target.checked)} />{source.name}</label></li>;
            })}
            {(sources[provider] ?? []).length === 0 && <li className="cal-conn-empty">{t("No calendars on this account.")}</li>}
          </ul>
        </div>;
      })}
    </section>}
    <div className="cal-grid">
      {weekdayShortNames().map((name, index) => <div key={index} className="cal-weekday">{name}</div>)}
      {days.map((day) => {
        const key = isoDate(day);
        const inMonth = day.getMonth() === monthStart.getMonth();
        const dayEvents = eventsByDate.get(key) ?? [];
        const dayExternal = externalByDate.get(key) ?? [];
        // The whole cell is a mouse target (unchanged); the day number is a
        // real button so the day is reachable and activatable by keyboard.
        return <div key={key} data-cal-day={key} title={t("Double-click to add an event on this day")} className={`cal-cell${inMonth ? "" : " cal-cell-outside"}${key === isoDate(new Date()) ? " cal-cell-today" : ""}${dragOver === key ? " cal-cell-drop" : ""}`} onDoubleClick={(clickEvent) => openCreate(key, { x: clickEvent.clientX, y: clickEvent.clientY })}>
          <button type="button" className="cal-cell-date" onClick={(clickEvent) => { clickEvent.stopPropagation(); openCreate(key); }} aria-label={t("New event on {date}", { date: key })}>{day.getDate()}</button>
          <div className="cal-cell-events">
            {dayEvents.map((event) => <button type="button" key={event.id} className="cal-event" onPointerDown={(pointer) => { if (pointer.button === 0) { justDragged.current = false; dragEvent.current = { id: event.id, x: pointer.clientX, y: pointer.clientY, moved: false }; } }} onDoubleClick={(clickEvent) => clickEvent.stopPropagation()} onClick={(clickEvent) => { clickEvent.stopPropagation(); if (justDragged.current) { justDragged.current = false; return; } openEdit(event, { x: clickEvent.clientX, y: clickEvent.clientY }); }}>{event.title || t("Untitled")}</button>)}
            {dayExternal.map((event) => <button type="button" key={event.id} className={`cal-event cal-event-external cal-event-${event.provider}`} title={t("{provider} · read-only", { provider: providerLabel(event.provider) })} onClick={(clickEvent) => { clickEvent.stopPropagation(); setSelectedDate(null); setEditingId(null); setExternalDetail(event); }}>{event.title || t("Untitled")}</button>)}
          </div>
        </div>;
      })}
    </div>
    {selectedDate && <section className={`cal-form${formAt ? " cal-form-floating" : ""}`} style={formAt ? { left: Math.max(8, Math.min(formAt.x + 12, window.innerWidth - 400)), top: Math.max(8, Math.min(formAt.y - 20, window.innerHeight - 480)) } : undefined} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setSelectedDate(null); setEditingId(null); } }}>
      <h3>{editingId ? t("Edit event") : t("New event")} · {selectedDate}</h3>
      <label>{t("Title")}<input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus /></label>
      <div className="cal-form-row">
        <label className="cal-form-checkbox"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />{t("All day")}</label>
        {!allDay && <label>{t("Start time")}<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>}
        {!allDay && <label>{t("End time")}<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>}
        <label>{t("End date")}<DatePicker value={endDate || null} min={selectedDate} ariaLabel={t("End date")} onChange={(next) => setEndDate(next)} /></label>
      </div>
      <div className="cal-form-row">
        <label>{t("Reminder")}<Select value={reminder} ariaLabel={t("Reminder")} onChange={(next) => setReminder(next)} options={REMINDER_OPTIONS.map((option) => ({ value: option, label: reminderLabel(t, option) }))} /></label>
      </div>
      <label>{t("Link to note/task/issue")}<Select value={linkedObjectId} ariaLabel={t("Link to note/task/issue")} placeholder={t("No link")} onChange={(next) => setLinkedObjectId(next)} options={links.map((item) => ({ value: item.id, label: `${item.type}: ${item.title || t("Untitled")}` }))} /></label>
      <div className="cal-form-actions">
        <button type="button" className="cal-primary" onClick={() => void saveEvent()} disabled={busy}>{editingId ? t("Save") : t("Create event")}</button>
        {editingId && linkedObjectId && <button type="button" onClick={() => void host?.openObject(linkedObjectId)}>{t("Open linked item")}</button>}
        {editingId && <button type="button" className="cal-danger" onClick={() => void deleteEvent()} disabled={busy}>{t("Delete")}</button>}
        <button type="button" onClick={() => { setSelectedDate(null); setEditingId(null); }}>{t("Cancel")}</button>
      </div>
    </section>}
    {externalDetail && <section className="cal-form cal-detail" onClick={(event) => event.stopPropagation()}>
      <h3>{externalDetail.title || t("Untitled")}</h3>
      <p className="cal-detail-line">{formatExternalWhen(externalDetail)}</p>
      {externalDetail.location && <p className="cal-detail-line">{externalDetail.location}</p>}
      <p className="cal-detail-meta">{t("Read-only · from {provider}", { provider: externalDetail.provider === "google" ? "Google" : "Outlook" })}</p>
      <div className="cal-form-actions"><button type="button" onClick={() => setExternalDetail(null)}>{t("Close")}</button></div>
    </section>}
  </div>;
}
