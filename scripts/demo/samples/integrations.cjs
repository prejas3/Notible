const { enablePlugin } = require("../lib.cjs");
module.exports = { name: "builtin-and-connected-plugin-surfaces", async run(ctx) {
  let stage = "start";
  try {
  const nav = async (label, selector) => {
    await ctx.page.locator(".core-nav button", { hasText: label }).first().click({ force: true });
    await ctx.page.locator(selector).waitFor({ timeout: 10000 });
  };
  // AI is skipped: this product build does not expose its builtin row/surface,
  // and sandbox mode blocks provider installation/login by design.
  stage = "open import/export";
  await enablePlugin(ctx, "Import and export");
  await ctx.page.locator(".core-plugins-detail-pane").getByText("Import and export").first().waitFor({ timeout: 10000 });
  stage = "open themes";
  await enablePlugin(ctx, "Themes");
  await ctx.page.locator(".core-plugins-detail-pane").getByText("Themes").first().waitFor({ timeout: 10000 });
  stage = "open graph";
  await enablePlugin(ctx, "Notible Graph");
  await nav(/^Graph$|^Graf$/, ".ngraph");

  stage = "switch themes";
  await ctx.page.evaluate(() => localStorage.setItem("notible-core-theme", "night"));
  await ctx.page.reload();
  await ctx.page.locator(".core-night").first().waitFor({ timeout: 10000 });
  await ctx.page.evaluate(() => localStorage.setItem("notible-core-theme", "paper"));
  await ctx.page.reload();
  await ctx.page.waitForFunction(() => !document.querySelector(".core-night"), null, { timeout: 10000 });

  stage = "open plugin settings";
  await ctx.page.getByRole("button", { name: /Settings|Ustawienia/, exact: true }).last().click();
  await ctx.page.getByText(/Plugins|Wtyczki/).first().click();
  for (const name of ["Notible Sync", "Notible Sync Simple", "Notible Teams"]) {
    stage = `open ${name}`;
    const filter = ctx.page.locator('.core-plugin-index-toolbar input[type="search"]');
    if (await filter.count()) await filter.fill(name);
    const row = ctx.page.locator(".core-plugin-index-row", { hasText: name }).first();
    await row.waitFor({ timeout: 8000 });
    await row.click();
    await ctx.page.locator(".core-plugins-detail-pane").getByText(name).first().waitFor({ timeout: 8000 });
    const back = ctx.page.locator(".core-plugin-detail-back");
    if (await back.isVisible()) await back.click();
  }
  } catch (error) { throw new Error(`${stage}: ${error.message || error}`); }
} };
