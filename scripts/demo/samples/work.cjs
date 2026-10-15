const { create, verify, openObject } = require("../lib.cjs");
module.exports = { name: "workspaces-projects-tasks-issues", async run(ctx) {
  const workspace = await create(ctx, { type: "space", title: "Demo workspace", props: { description: "A complete hand-test area" } });
  const project = await create(ctx, { type: "project", title: "Demo project", parentId: workspace.id, props: { status: "in-progress", plannedBudget: 25000, approvedBudget: 22000, openingCash: 30000, budgetAlertThreshold: 75, baseCurrency: "PLN", start: "2026-10-01", due: "2026-12-15", tags: ["demo", "finance"] } });
  const tasks = [];
  for (const [title, status, priority] of [["Plan scope", "todo", "high"], ["Build prototype", "in-progress", "urgent"], ["Review result", "review", "medium"], ["Ship release", "done", "low"]]) tasks.push((await create(ctx, { type: "task", title, parentId: project.id, props: { status, priority, due: "2026-10-20", estimate: 4 } })).id);
  const issue = await create(ctx, { type: "issue", title: "Demo issue · keyboard focus", parentId: project.id, props: { status: "open", priority: "high", severity: "major", due: "2026-10-22" } });
  const finance = await create(ctx, { type: "financial_entry", title: "Prototype development cost", parentId: project.id, props: { kind: "cost", amount: 9800, currency: "PLN", category: "development", vendor: "Demo Studio", date: "2026-10-08", status: "paid", recurrence: "none" } });
  const income = await create(ctx, { type: "financial_entry", title: "Pilot customer income", parentId: project.id, props: { kind: "income", amount: 14500, currency: "PLN", category: "sales", date: "2026-10-07", status: "paid", recurrence: "none" } });
  const time = await create(ctx, { type: "time_entry", title: "Prototype engineering", parentId: project.id, props: { date: "2026-10-08", person: "Ada", hours: 12, billable: true, billableRate: 300, costRate: 180, currency: "PLN", description: "Demo implementation" } });
  await verify(ctx, [workspace.id, project.id, tasks, issue.id, finance.id, income.id, time.id]);
  await openObject(ctx, "Demo project");
  await ctx.page.locator(".core-object-tabs button", { hasText: /Finance/ }).click();
  await ctx.page.locator(".pd-finance-budget").waitFor({ timeout: 10000 });
  const financeSurface = await ctx.page.locator(".pd-panel").innerText();
  const approvedBudget = await ctx.page.locator(".pd-finance-budget label", { hasText: /Approved budget/ }).locator("input").inputValue();
  if (!financeSurface.includes("Prototype development cost") || Number(approvedBudget) !== 22000) throw new Error("Finance surface did not show the demo budget and transactions");
} };
