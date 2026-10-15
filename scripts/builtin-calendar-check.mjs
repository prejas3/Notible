/**
 * Drives calendar.ts's project-metadata helpers against a stub context.
 * There is no other test over plugins/builtin/calendar.ts — project-calendars
 * -check.mjs covers only the dead src/lib tree.
 *
 * node scripts/builtin-calendar-check.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { configureCalendar, removeCalendar, projectCalendarConnections, reconcileCalendarConnections, fireDueCalendarReminder } = await import(
  pathToFileURL(resolve(root, "plugins/builtin/calendar.ts")).href
);
const { eventGridDays, composeEventTimestamps, localDay, isMidnight, moveEventToDay } = await import(
  pathToFileURL(resolve(root, "plugins/builtin/calendar-month.ts")).href
);

function stubContext(project) {
  return {
    manifest: { id: "notible.calendar" },
    data: {
      objects: {
        get: async (id) => (id === project.id ? project : null),
        update: async (id, patch) => { Object.assign(project, patch); return project; },
      },
    },
  };
}

// 1. configureCalendar writes a connection with no `state`
const project = { id: "p1", props: "{}", updated_at: 1 };
await configureCalendar(stubContext(project), {
  projectId: "p1", provider: "google", calendarId: "cal_abc", calendarName: "Work",
});
let conns = projectCalendarConnections(project);
assert.equal(conns.length, 1);
assert.equal(conns[0].id, "google:cal_abc");
assert.equal(conns[0].calendarName, "Work");
assert.ok(!("state" in conns[0]), "configureCalendar must not write a fabricated state");

// 2. a second configure of the same handle replaces, not appends
await configureCalendar(stubContext(project), {
  projectId: "p1", provider: "google", calendarId: "cal_abc", calendarName: "Work (renamed)",
});
conns = projectCalendarConnections(project);
assert.equal(conns.length, 1);
assert.equal(conns[0].calendarName, "Work (renamed)");

// 3. removeCalendar drops exactly the named entry
await configureCalendar(stubContext(project), {
  projectId: "p1", provider: "google", calendarId: "cal_xyz", calendarName: "Personal",
});
assert.equal(projectCalendarConnections(project).length, 2);
await removeCalendar(stubContext(project), { projectId: "p1", connectionId: "google:cal_abc" });
conns = projectCalendarConnections(project);
assert.equal(conns.length, 1);
assert.equal(conns[0].id, "google:cal_xyz");

// 4. reconcileCalendarConnections: keep live, drop dead, migrate on name match
{
  const stored = [
    { id: "google:cal_live", provider: "google", calendarId: "cal_live", calendarName: "Work" },
    { id: "google:cal_dead", provider: "google", calendarId: "cal_dead", calendarName: "Gone" },
    { id: "google:cal_renamed", provider: "google", calendarId: "cal_old", calendarName: "Personal" },
    { id: "outlook:cal_x", provider: "outlook", calendarId: "cal_x", calendarName: "Other" },
  ];
  const live = [
    { id: "cal_live", name: "Work" },
    { id: "cal_new", name: "Personal", color: "#123456" },
  ];
  const { remove, add } = reconcileCalendarConnections(stored, live, "google");
  assert.deepEqual(remove.sort(), ["google:cal_dead", "google:cal_renamed"], "dead + renamed removed, live kept, other provider untouched");
  assert.equal(add.length, 1);
  assert.deepEqual(add[0], { provider: "google", calendarId: "cal_new", calendarName: "Personal", color: "#123456" });

  const clean = reconcileCalendarConnections([stored[0]], live, "google");
  assert.deepEqual(clean, { remove: [], add: [] }, "no-op when every connection is still live");
}

// --- calendar-month.ts: grid expansion --------------------------------------
{
  const g0 = "2026-03-01", g1 = "2026-03-31";

  // all-day multi-day: provider `end` is exclusive
  assert.deepEqual(
    eventGridDays("2026-03-10", "2026-03-13", true, g0, g1),
    ["2026-03-10", "2026-03-11", "2026-03-12"],
    "all-day end is exclusive",
  );

  // starts before the visible grid and runs for most of a year — must not vanish
  const long = eventGridDays("2026-01-05", "2026-12-20", true, "2026-06-01", "2026-06-30");
  assert.equal(long.length, 30, "long event clipped to the visible grid, not dropped");
  assert.ok(long.includes("2026-06-15"));
  assert.equal(long[0], "2026-06-01");

  // timed event ending exactly at midnight: the following day is NOT drawn
  assert.deepEqual(
    eventGridDays("2026-03-10T09:00", "2026-03-11T00:00", false, g0, g1),
    ["2026-03-10"],
    "midnight end is exclusive for timed events",
  );
  // ...but a real time on the next day does span two days
  assert.deepEqual(
    eventGridDays("2026-03-10T09:00", "2026-03-11T10:00", false, g0, g1),
    ["2026-03-10", "2026-03-11"],
  );

  // malformed input never throws
  assert.deepEqual(eventGridDays("not-a-date", "2026-03-13", true, g0, g1), []);
  assert.deepEqual(eventGridDays("2026-03-10", "garbage", true, g0, g1), ["2026-03-10"]);
  assert.deepEqual(eventGridDays("2026-03-10", undefined, true, g0, g1), ["2026-03-10"]);

  assert.equal(isMidnight("2026-03-11T00:00"), true);
  assert.equal(isMidnight("2026-03-11T00:00:00"), true);
  // UTC midnight is 01:00 in Europe/Warsaw and must remain an occupied day.
  assert.equal(isMidnight("2026-03-11T00:00:00Z"), false);
  assert.equal(isMidnight("2026-03-11T09:00"), false);
  assert.equal(isMidnight("2026-03-11"), false);
  assert.equal(localDay("2026-03-10"), "2026-03-10");
  assert.equal(localDay("not-a-date"), null);
  assert.equal(localDay("2026-13-40"), null);
}

// --- calendar-month.ts: save composition -----------------------------------
{
  // title-only edit: BOTH original timestamps kept verbatim (the reported bug —
  // 09:00-17:00 must not collapse to 09:00-09:00)
  assert.deepEqual(
    composeEventTimestamps({
      origStart: "2026-01-10T09:00:00", origEnd: "2026-01-10T17:00:00",
      startDate: "2026-01-10", startTime: "09:00", endDate: "2026-01-10", endTime: "17:00", allDay: false,
    }),
    { ok: true, start: "2026-01-10T09:00:00", end: "2026-01-10T17:00:00" },
  );

  // offset + seconds survive when the piece is untouched
  const kept = composeEventTimestamps({
    origStart: "2026-01-10T09:00:00+01:00", origEnd: "2026-01-10T17:30:45+01:00",
    startDate: "2026-01-10", startTime: "09:00", endDate: "2026-01-10", endTime: "17:30", allDay: false,
  });
  assert.equal(kept.ok && kept.end, "2026-01-10T17:30:45+01:00", "unchanged end kept byte-for-byte");

  // editing the end time recomposes just that piece
  const edited = composeEventTimestamps({
    origStart: "2026-01-10T09:00:00+01:00", origEnd: "2026-01-10T17:00:00+01:00",
    startDate: "2026-01-10", startTime: "09:00", endDate: "2026-01-10", endTime: "18:00", allDay: false,
  });
  assert.equal(edited.ok && edited.start, "2026-01-10T09:00:00+01:00", "untouched start still verbatim");
  assert.equal(edited.ok && edited.end, "2026-01-10T18:00", "edited end recomposed");

  // an end before the start is rejected, not snapped
  assert.deepEqual(
    composeEventTimestamps({ startDate: "2026-01-10", startTime: "14:00", endDate: "2026-01-10", endTime: "09:00", allDay: false }),
    { ok: false, reason: "end-before-start" },
  );
  // invalid time is rejected
  assert.deepEqual(
    composeEventTimestamps({ startDate: "2026-01-10", startTime: "99:99", endDate: "2026-01-10", endTime: "10:00", allDay: false }),
    { ok: false, reason: "invalid-time" },
  );
  // all-day multi-day keeps plain dates; same day is valid
  assert.deepEqual(
    composeEventTimestamps({ startDate: "2026-01-10", startTime: "", endDate: "2026-01-12", endTime: "", allDay: true }),
    { ok: true, start: "2026-01-10", end: "2026-01-12" },
  );
  assert.equal(
    composeEventTimestamps({ startDate: "2026-01-10", startTime: "", endDate: "2026-01-09", endTime: "", allDay: true }).ok,
    false,
    "all-day end before start rejected",
  );
  // toggling all-day OFF must not reuse a date-only original as a timed start
  const toggled = composeEventTimestamps({
    origStart: "2026-01-10", origEnd: "2026-01-10",
    startDate: "2026-01-10", startTime: "09:00", endDate: "2026-01-10", endTime: "10:00", allDay: false,
  });
  assert.equal(toggled.ok && toggled.start, "2026-01-10T09:00", "recomposed as timed, not the bare date");
}

// --- fireDueCalendarReminder: the reminder picker in CalendarMonthView.tsx
// writes props.reminder/start on a calendar_event, but nothing ever read it
// back — this is the fix. Direct unit test against a stub context, since the
// firing is timer-driven (calendarOnActivate + context.scheduler), not
// event-driven like Automations.
{
  function stubReminderContext() {
    const objects = new Map();
    const notifyCalls = [];
    const created = [];
    return {
      notifyCalls, created, objects,
      context: {
        notifications: { show: async (options) => { notifyCalls.push(options); } },
        data: {
          objects: {
            get: async (id) => objects.get(id) ?? null,
            update: async (id, patch) => { const current = objects.get(id); const next = { ...current, ...patch, updated_at: current.updated_at + 1 }; objects.set(id, next); return next; },
            create: async (input) => { const object = { id: `note-${objects.size + 1}`, ...input }; created.push(object); return object; },
          },
        },
      },
    };
  }

  // "5 minutes before" fires once the window opens, not exactly at the
  // instant — `now` here is 3 minutes before start, inside the 5-minute lead.
  const { context: ctx1, notifyCalls: calls1, created: created1, objects: objects1 } = stubReminderContext();
  const start1 = "2026-06-15T09:00";
  const startMs1 = new Date(`${start1}:00`).getTime();
  const event1 = { id: "ev1", title: "Standup", updated_at: 1, props: JSON.stringify({ reminder: "5-min-before", start: start1 }) };
  objects1.set(event1.id, event1);
  await fireDueCalendarReminder(ctx1, event1, startMs1 - 3 * 60000);
  assert.equal(calls1.length, 1, "a reminder inside its lead window must fire the OS toast");
  assert.equal(calls1[0].title, "Standup");
  assert.equal(created1.length, 1, "must also leave an in-app notification object, same as Automations' notify action");
  assert.equal(created1[0].type, "notification");

  // Firing again for the SAME (reminder, start) pair must be a no-op — the
  // dedup key persisted by the first call must stop it.
  const fired1 = await ctx1.data.objects.get("ev1");
  await fireDueCalendarReminder(ctx1, fired1, startMs1 - 1 * 60000);
  assert.equal(calls1.length, 1, "the same reminder must not fire twice");

  // Rescheduling the event (a new start) must fire a fresh reminder even
  // though the reminder option didn't change.
  const rescheduled = { ...fired1, props: JSON.stringify({ ...JSON.parse(fired1.props), start: "2026-06-16T09:00" }) };
  const startMs2 = new Date("2026-06-16T09:00:00").getTime();
  await fireDueCalendarReminder(ctx1, rescheduled, startMs2 - 4 * 60000);
  assert.equal(calls1.length, 2, "rescheduling the event must allow its reminder to fire again");

  // "none" and a missing/unrecognised reminder must never fire.
  const { context: ctx2, notifyCalls: calls2 } = stubReminderContext();
  const noneEvent = { id: "ev2", title: "No reminder", updated_at: 1, props: JSON.stringify({ reminder: "none", start: "2026-06-15T09:00" }) };
  await fireDueCalendarReminder(ctx2, noneEvent, new Date("2026-06-15T09:00:00").getTime());
  assert.equal(calls2.length, 0, "reminder: none must never fire");

  // A reminder in the future must not fire early.
  const { context: ctx3, notifyCalls: calls3 } = stubReminderContext();
  const futureEvent = { id: "ev3", title: "Later", updated_at: 1, props: JSON.stringify({ reminder: "at-time", start: "2026-06-15T09:00" }) };
  await fireDueCalendarReminder(ctx3, futureEvent, new Date("2026-06-15T08:00:00").getTime());
  assert.equal(calls3.length, 0, "a reminder not yet due must not fire early");

  // Ancient, long-missed reminders (workspace reopened after a long break)
  // must not fire — only a recent miss (app closed overnight) should catch up.
  const { context: ctx4, notifyCalls: calls4 } = stubReminderContext();
  const staleEvent = { id: "ev4", title: "Ancient", updated_at: 1, props: JSON.stringify({ reminder: "at-time", start: "2026-01-01T09:00" }) };
  await fireDueCalendarReminder(ctx4, staleEvent, new Date("2026-06-15T09:00:00").getTime());
  assert.equal(calls4.length, 0, "a reminder missed by months must not suddenly fire");

  // All-day events: "1-day-before" fires the day before local midnight.
  const { context: ctx5, notifyCalls: calls5 } = stubReminderContext();
  const allDayEvent = { id: "ev5", title: "Conference", updated_at: 1, props: JSON.stringify({ reminder: "1-day-before", start: "2026-06-15", allDay: true }) };
  await fireDueCalendarReminder(ctx5, allDayEvent, new Date("2026-06-14T10:00:00").getTime());
  assert.equal(calls5.length, 1, "1-day-before on an all-day event must fire the day before");
}
assert.ok(readFileSync(resolve(root, "plugins/builtin/calendar.ts"), "utf8").includes('permissions: ["data.read", "data.write", "workspace.ui", "network", "notifications"]'), "calendar manifest must declare the notifications permission its reminder engine uses");

// --- calendar-month.ts: drag an event to another day (R4 T9) ---------------
assert.deepEqual(moveEventToDay("2026-10-05", "2026-10-05", "2026-10-09"), { start: "2026-10-09", end: "2026-10-09" });
assert.deepEqual(moveEventToDay("2026-10-05T09:00:00", "2026-10-05T10:30:00", "2026-10-07"), { start: "2026-10-07T09:00:00", end: "2026-10-07T10:30:00" }, "times are kept");
assert.deepEqual(moveEventToDay("2026-10-30", "2026-11-01", "2026-11-03"), { start: "2026-11-03", end: "2026-11-05" }, "length is kept across a month end");
assert.deepEqual(moveEventToDay("2026-10-05", "", "2026-10-01"), { start: "2026-10-01", end: "" }, "an open end stays open");

console.log("Notible builtin calendar check passed.");
