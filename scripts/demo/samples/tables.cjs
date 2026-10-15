const { create, verify, openObject } = require("../lib.cjs");
module.exports = { name: "data-tables", async run(ctx) {
  const table = {
    version: 1, name: "Demo budget", lockWidths: false,
    columns: [
      { id: "item", name: "Item", type: "text", width: 180 },
      { id: "amount", name: "Amount", type: "number", width: 120, format: { style: "currency", decimals: 2, symbol: "PLN" } },
      { id: "paid", name: "Paid", type: "checkbox", width: 90 },
      { id: "date", name: "Date", type: "date", width: 130 },
      { id: "owner", name: "Owner", type: "select", width: 130, options: ["Ada", "Alex"] },
    ],
    rows: [
      { id: "r1", cells: { item: "Design", amount: 4800, paid: true, date: "2026-10-03", owner: "Ada" } },
      { id: "r2", cells: { item: "Development", amount: 9800, paid: false, date: "2026-10-20", owner: "Alex" } },
      { id: "r3", cells: { item: "Total", amount: "=SUM(B1:B2)", paid: false } },
    ], styles: { "r3:item": { bold: true }, "r3:amount": { bold: true } }, merges: [],
  };
  const item = await create(ctx, { type: "table", title: "Demo data table · budget", content: "{}", props: table });
  await verify(ctx, [item.id]);
  await openObject(ctx, "Demo data table · budget");
  await ctx.page.locator(".ntbl-table").waitFor({ timeout: 8000 });
  const rendered = await ctx.page.locator(".ntbl-table").innerText();
  if (!rendered.replace(/\D/g, "").includes("29200")) throw new Error(`Tables plugin did not calculate the formula-backed numeric total (${JSON.stringify(rendered.slice(-160))})`);
} };
