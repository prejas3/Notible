const { create, verify } = require("../lib.cjs");
module.exports = { name: "habits", async run(ctx) {
  const today = new Date(); const day = (offset) => { const d = new Date(today); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
  const ids = [];
  ids.push((await create(ctx, { type: "habit", title: "Write daily", props: { $: { graphExclude: true }, schedule: { kind: "daily" }, days: [day(-3), day(-2), day(-1), day(0)] } })).id);
  ids.push((await create(ctx, { type: "habit", title: "Exercise weekdays", props: { $: { graphExclude: true }, schedule: { kind: "weekdays", weekdays: [0, 2, 4] }, days: [day(-7), day(-5), day(-3)] } })).id);
  ids.push((await create(ctx, { type: "habit", title: "Read three times weekly", props: { $: { graphExclude: true }, schedule: { kind: "weekly", target: 3 }, days: [day(-2), day(-1)] } })).id);
  await verify(ctx, ids);
  await ctx.page.locator(".core-nav button", { hasText: /Habits|Nawyki/ }).first().click();
  await ctx.page.getByText("Write daily", { exact: true }).first().waitFor({ timeout: 8000 });
  const screen = await ctx.page.locator("body").innerText();
  if (!/streak|seria/i.test(screen)) throw new Error("Habits plugin did not calculate/render streak information");
} };
