import type { PluginContext, PluginObject } from "../../packages/plugin-api/src/index.ts";
import { createBuiltinSurface } from "./scaffold.ts";

export type CalendarProvider = "google" | "outlook";
export interface CalendarConnection { id: string; provider: CalendarProvider; state?: "configured" | "disconnected" | "error"; calendarId?: string; calendarName?: string; color?: string; visible?: boolean; lastSyncedAt?: string; }

function readProps(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function configOf(value: Record<string, unknown>): { version: 1; connections: CalendarConnection[]; assignments: unknown[] } { const raw = value._projectCalendars; if (!raw || typeof raw !== "object") return { version: 1, connections: [], assignments: [] }; const candidate = raw as { connections?: unknown; assignments?: unknown }; return { version: 1, connections: Array.isArray(candidate.connections) ? candidate.connections as CalendarConnection[] : [], assignments: Array.isArray(candidate.assignments) ? candidate.assignments : [] }; }

export async function configureCalendar(context: PluginContext, input?: unknown) {
  const value = input && typeof input === "object" ? input as { projectId?: unknown; provider?: unknown; connectionId?: unknown; calendarId?: unknown; calendarName?: unknown; color?: unknown; visible?: unknown } : {};
  if (typeof value.projectId !== "string") throw new Error("projectId is required");
  const current = await context.data.objects.get(value.projectId); if (!current) throw new Error(`Project not found: ${value.projectId}`);
  const provider = value.provider === "outlook" ? "outlook" : "google";
  const id = typeof value.connectionId === "string" && value.connectionId ? value.connectionId : `${provider}:${String(value.calendarId ?? "default")}`;
  const props = readProps(current.props); const config = configOf(props); const nextConnection: CalendarConnection = { id, provider, calendarId: typeof value.calendarId === "string" ? value.calendarId : undefined, calendarName: typeof value.calendarName === "string" ? value.calendarName : undefined, color: typeof value.color === "string" ? value.color : undefined, visible: value.visible !== false };
  const next = { ...config, connections: [...config.connections.filter((connection) => connection.id !== id), nextConnection] };
  await context.data.objects.update(current.id, { props: JSON.stringify({ ...props, _projectCalendars: next }) }, current.updated_at);
  return { pluginId: context.manifest.id, projectId: current.id, config: next };
}

export async function removeCalendar(context: PluginContext, input?: unknown) {
  const value = input && typeof input === "object" ? input as { projectId?: unknown; connectionId?: unknown } : {};
  if (typeof value.projectId !== "string") throw new Error("projectId is required");
  if (typeof value.connectionId !== "string") throw new Error("connectionId is required");
  const current = await context.data.objects.get(value.projectId);
  if (!current) throw new Error(`Project not found: ${value.projectId}`);
  const props = readProps(current.props);
  const config = configOf(props);
  const next = { ...config, connections: config.connections.filter((connection) => connection.id !== value.connectionId) };
  await context.data.objects.update(current.id, { props: JSON.stringify({ ...props, _projectCalendars: next }) }, current.updated_at);
  return { pluginId: context.manifest.id, projectId: current.id, config: next };
}

/** Minutes of lead time for each `reminder` option a `calendar_event` can
 * carry (`CALENDAR_EVENT_TYPE_FIELDS.reminder.options`, set from the picker
 * in CalendarMonthView.tsx). `"none"` and anything unrecognised carry no
 * reminder at all. */
const REMINDER_LEAD_MINUTES: Record<string, number> = {
  "at-time": 0,
  "5-min-before": 5,
  "30-min-before": 30,
  "1-day-before": 24 * 60,
};

/** A `calendar_event`'s `start` is either `"YYYY-MM-DD"` (all-day) or
 * `"YYYY-MM-DDTHH:MM"` with no offset (composeEventTimestamps in
 * calendar-month.ts) — both parse as local time via the Date constructor
 * with no "Z" suffix, the same convention automations.ts's own
 * `parseLocalDate` uses. All-day events fire at local midnight of that day. */
function calendarEventStartMs(start: string): number {
  const parsed = new Date(start.length > 10 ? start : `${start}T00:00:00`);
  return parsed.getTime();
}

/** How stale a missed reminder can be and still fire late instead of never —
 * long enough that closing Notible overnight still catches this morning's
 * reminders on next launch, short enough that reopening a workspace after a
 * long break does not dump a backlog of ancient reminders. */
const REMINDER_CATCH_UP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** How often the interval re-checks for a due reminder. Tighter than
 * Automations' 15-minute recurring check on purpose: the shortest lead time
 * a reminder offers is 5 minutes, so anything coarser would make "5 minutes
 * before" indistinguishable from "at some point around then". `scheduler`
 * clamps below 1 minute anyway. */
const REMINDER_CHECK_INTERVAL_MS = 60 * 1000;

function readEventProps(value: string): Record<string, unknown> {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

/** Fires the one reminder due for `event`, exactly once per (reminder,
 * start) pair — stored on the event itself as `_reminderFiredFor`, so
 * rescheduling the event (a new `start`) or changing the reminder option
 * fires a fresh one, but editing anything else does not re-fire it. This was
 * previously nothing at all: the picker wrote `props.reminder` and nothing
 * in the codebase ever read it back. */
export async function fireDueCalendarReminder(context: PluginContext, event: PluginObject, now: number): Promise<void> {
  const props = readEventProps(event.props);
  const reminder = typeof props.reminder === "string" ? props.reminder : "none";
  const leadMinutes = REMINDER_LEAD_MINUTES[reminder];
  const start = typeof props.start === "string" ? props.start : "";
  if (leadMinutes === undefined || !start) return;
  const dueAt = calendarEventStartMs(start) - leadMinutes * 60000;
  if (Number.isNaN(dueAt) || now < dueAt || now - dueAt > REMINDER_CATCH_UP_WINDOW_MS) return;
  const key = `${reminder}:${start}`;
  if (props._reminderFiredFor === key) return;
  const title = typeof event.title === "string" && event.title.trim() ? event.title : "Event reminder";
  const startsAt = new Date(calendarEventStartMs(start));
  const body = leadMinutes === 0
    ? `Starting now — ${startsAt.toLocaleString()}`
    : `Starts ${startsAt.toLocaleString()}`;
  await context.notifications.show({ title, body }).catch(() => {});
  // Same in-app trail Automations' own "notify" action leaves — see
  // executeAutomationRule in automations.ts. Costs nothing if
  // notible.notifications is not installed, and does not require it.
  await context.data.objects.create({ type: "notification", title, props: JSON.stringify({ body, read: false, at: now }) }).catch(() => {});
  await context.data.objects.update(event.id, { props: JSON.stringify({ ...props, _reminderFiredFor: key }) }, event.updated_at).catch(() => {});
}

/** Runs a fire-and-forget background task and swallows whatever it rejects
 * with — same rationale as automations.ts's own `background()`: this is
 * invoked from a timer, nothing downstream awaits it, and an uncaught
 * rejection there is an unhandled rejection at the process level. */
function background(task: () => Promise<void>): void {
  task().catch(() => {});
}

function calendarOnActivate(context: PluginContext): void {
  const runDueReminders = async () => {
    const now = Date.now();
    const events = await context.data.objects.query({ type: "calendar_event", limit: 5000 });
    for (const event of events) await fireDueCalendarReminder(context, event, now);
  };
  // Once immediately, so a reminder due while Notible was closed fires on
  // the next launch instead of waiting up to REMINDER_CHECK_INTERVAL_MS —
  // same reasoning as automations.ts's own startup catch-up run.
  background(runDueReminders);
  context.scheduler.every(REMINDER_CHECK_INTERVAL_MS, runDueReminders);
}

export const CALENDAR_EVENT_TYPE_FIELDS = {
  start: { type: "date" },
  end: { type: "date" },
  allDay: { type: "bool" },
  reminder: { type: "select", options: ["none", "at-time", "5-min-before", "30-min-before", "1-day-before"] },
  linkedObjectId: { type: "text" },
};

/** Local calendar events (Legacy: "utworzyć wydarzenie, połączyć je z
 * notatką, dostać przypomnienie") are plain workspace objects of this type,
 * scoped to a project via parentId — not tied to any external provider. */
export async function ensureCalendarEventType(context: PluginContext) {
  const existing = await context.data.types.list();
  const current = existing.find((candidate) => candidate.name === "calendar_event");
  let schema: { fields?: Record<string, unknown> } = {};
  try { schema = current ? JSON.parse(current.schema) as { fields?: Record<string, unknown> } : {}; } catch { schema = {}; }
  await context.data.types.upsert("calendar_event", JSON.stringify({ ...schema, fields: { ...(schema.fields ?? {}), ...CALENDAR_EVENT_TYPE_FIELDS } }), current?.icon ?? "📅", current?.color ?? "#5b8def");
}

export function projectCalendarConnections(project: { props: string }): CalendarConnection[] {
  return configOf(readProps(project.props)).connections;
}

export interface LiveCalendarSource { id: string; name: string; color?: string }

/**
 * Reconcile stored connections for one provider against the calendars the
 * account currently exposes. A connection whose `calendarId` is no longer live
 * is dropped; if a live calendar carries the same display name it is treated as
 * the same calendar under a new opaque handle and re-pointed. Pure: returns the
 * ops to apply, writes nothing.
 */
export function reconcileCalendarConnections(
  connections: CalendarConnection[],
  live: LiveCalendarSource[],
  provider: CalendarProvider,
): { remove: string[]; add: Array<{ provider: CalendarProvider; calendarId: string; calendarName?: string; color?: string }> } {
  const liveIds = new Set(live.map((source) => source.id));
  const liveByName = new Map(live.map((source) => [source.name, source] as const));
  const remove: string[] = [];
  const add: Array<{ provider: CalendarProvider; calendarId: string; calendarName?: string; color?: string }> = [];
  for (const connection of connections) {
    if (connection.provider !== provider || !connection.calendarId) continue;
    if (liveIds.has(connection.calendarId)) continue;
    remove.push(connection.id);
    const match = connection.calendarName ? liveByName.get(connection.calendarName) : undefined;
    if (match) add.push({ provider, calendarId: match.id, calendarName: match.name, color: match.color });
  }
  return { remove, add };
}

export const calendarPlugin = createBuiltinSurface({
  manifest: { id: "notible.calendar", name: "Calendar integrations", version: "0.1.0", apiVersion: "0.1", entry: "index.ts", description: "External calendar connection metadata, project calendar views, and reminders for local calendar events.", permissions: ["data.read", "data.write", "workspace.ui", "network", "notifications"], sync: "settings" },
  capability: "calendar",
  commandName: "Configure project calendar",
  viewTitle: "Calendar",
  onActivate: calendarOnActivate,
  // Workspace-level entry point. Per-project connecting now lives in the
  // project's own Calendar tab (CalendarMonthView), but the check requires a
  // settings panel or an object tab, and this is the honest home for the
  // "pick any project and configure it" form.
  settingsTitle: "Calendar",
  onCommand: configureCalendar,
  viewRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
  settingsRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
  // No object tab: connecting an external calendar is now a panel inside the
  // project's own "Calendar" tab (notible.planning → CalendarMonthView), not a
  // second, separate "Calendar sync" tab several places away in the tab bar.
  // The Settings panel above stays for the workspace-level entry point.
});
