const { create, verify, openObject } = require("../lib.cjs");
module.exports = { name: "calendar-gantt-whiteboard-and-views", async run(ctx) {
  const project = await create(ctx, { type: "project", title: "Launch calendar and Gantt", props: { status: "in-progress", start: "2026-10-01", due: "2026-11-15" } });
  const milestone = await create(ctx, { type: "milestone", title: "Public beta", parentId: project.id, props: { status: "todo", due: "2026-11-01" } });
  const event = await create(ctx, { type: "task", title: "Demo planning review · calendar item", parentId: project.id, props: { status: "todo", start: "2026-10-15T10:00:00", due: "2026-10-15T11:00:00", allDay: false } });
  const task = await create(ctx, { type: "task", title: "Gantt dependency sample", parentId: project.id, props: { status: "in-progress", start: "2026-10-10", due: "2026-10-25", deps: [{ on: milestone.id, kind: "finish-start" }] } });
  const board = { version: 1, viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [{ id: "idea", kind: "card", x: 80, y: 80, width: 200, height: 100, text: "Idea" }, { id: "result", kind: "shape", shape: "rounded", x: 360, y: 180, width: 200, height: 100, text: "Result" }],
    edges: [{ id: "e1", from: "idea", to: "result" }] };
  const whiteboard = await create(ctx, { type: "whiteboard", title: "Demo whiteboard and canvas", parentId: project.id, content: JSON.stringify(board) });
  // The app creates calendar_event lazily when the Calendar month view first opens
  // (ensureCalendarEventType); do the same upsert so the event exists before anyone opens it.
  const reminderOptions = ["none", "at-time", "5-min-before", "30-min-before", "1-day-before"];
  if (!(await ctx.invoke("list_types")).some((type) => type.name === "calendar_event")) {
    await ctx.invoke("upsert_type", { name: "calendar_event", icon: "📅", color: "#5b8def", schema: JSON.stringify({ fields: { start: { type: "date" }, end: { type: "date" }, allDay: { type: "bool" }, reminder: { type: "select", options: reminderOptions }, linkedObjectId: { type: "text" } } }) });
  }
  const meeting = await create(ctx, { type: "calendar_event", title: "Demo calendar event with reminder", parentId: project.id, props: { start: "2026-10-16T09:00", end: "2026-10-16T10:00", reminder: "30-min-before" } });
  const current = await ctx.invoke("get_object", { id: project.id });
  const projectProps = JSON.parse(current.props || "{}");
  projectProps._views = [
    { id: "tasks", name: "Tasks", layout: "kanban", typeFilter: "task" },
    { id: "schedule", name: "Schedule", layout: "calendar", typeFilter: "task" },
    { id: "gallery", name: "Gallery", layout: "gallery", query: { kind: "group", combinator: "and", children: [{ kind: "condition", field: "status", operator: "not", value: "done" }] } },
  ];
  await ctx.invoke("update_object", { id: project.id, props: JSON.stringify(projectProps) });
  await verify(ctx, [project.id, milestone.id, event.id, task.id, whiteboard.id, meeting.id]);
  const saved = JSON.parse((await ctx.invoke("get_object", { id: project.id })).props)._views;
  if (!Array.isArray(saved) || saved.length !== 3 || saved[1].layout !== "calendar") throw new Error("Views plugin definitions were not persisted");
  await openObject(ctx, "Launch calendar and Gantt");
  await ctx.page.locator(".core-object-tabs button", { hasText: /Timeline/ }).click();
  await ctx.page.locator(".pd-dashboard").waitFor({ timeout: 10000 });
  const timeline = await ctx.page.locator(".pd-dashboard").innerText();
  if (!timeline.includes("Gantt dependency sample") || !timeline.includes("Public beta")) throw new Error("Planning timeline did not render the dated task and milestone");
  await ctx.page.locator(".core-object-tabs button", { hasText: /Planning/ }).click();
  if (!(await ctx.page.locator(".pd-dashboard").innerText()).includes("Public beta")) throw new Error("Planning pane did not render its milestone");
} };
