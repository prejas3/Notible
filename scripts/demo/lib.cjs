const path = require("node:path");

const emptyDoc = () => JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
const doc = (...content) => JSON.stringify({ type: "doc", content });
const text = (value, marks) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const paragraph = (value) => ({ type: "paragraph", content: [text(value)] });

async function create(ctx, input) {
  const object = await ctx.invoke("create_object", {
    content: emptyDoc(), props: "{}", parentId: null, ...input,
    props: typeof input.props === "string" ? input.props : JSON.stringify(input.props || {}),
  });
  // A bare invoke skips core-data-api's notifyObjectEvent, so plugins (schemas, automations)
  // would never see the create. Announce it the same way Core does.
  await ctx.page.evaluate(({ id, type }) => window.dispatchEvent(new CustomEvent("notible:object-event", {
    detail: { event: "object.created", payload: { id, type } },
  })), { id: object.id, type: object.type });
  return object;
}

async function verify(ctx, ids) {
  for (const id of ids.flat()) {
    const found = await ctx.invoke("get_object", { id });
    if (!found) throw new Error(`created object ${id} cannot be read back`);
  }
}

async function openObject(ctx, title) {
  const search = ctx.page.locator(".core-search input");
  if (!(await search.isVisible())) await ctx.page.locator(".core-search-action").click();
  await search.fill(title);
  const hit = ctx.page.locator(".core-search-hit", { hasText: title }).first();
  await hit.waitFor({ timeout: 8000 });
  await hit.click();
}

async function enablePlugin(ctx, name) {
  await ctx.page.getByRole("button", { name: /Settings|Ustawienia/, exact: true }).last().click();
  await ctx.page.getByText(/Plugins|Wtyczki/).first().click();
  const filter = ctx.page.locator('.core-plugin-index-toolbar input[type="search"]');
  if (await filter.count()) await filter.fill(name);
  const row = ctx.page.locator(".core-plugin-index-row", { hasText: name }).first();
  await row.waitFor({ timeout: 8000 }).catch(async () => { throw new Error(`plugin row not found: ${name}; rows=${(await ctx.page.locator(".core-plugin-index-row").allInnerTexts()).join(" | ")}`); });
  await row.click({ force: true });
  const toggle = ctx.page.locator(".core-plugins-detail-pane .core-switch").first();
  if (await toggle.count()) {
    const on = await toggle.locator('input[type="checkbox"]').isChecked();
    if (!on) { await toggle.click(); await ctx.page.waitForTimeout(500); }
  }
}

async function enableAllBuiltinPlugins(ctx, manifests) {
  await ctx.page.getByRole("button", { name: /Settings|Ustawienia/, exact: true }).last().click();
  await ctx.page.getByText(/Plugins|Wtyczki/).first().click();
  const filter = ctx.page.locator('.core-plugin-index-toolbar input[type="search"]');
  if (await filter.count()) await filter.fill("");
  const rows = ctx.page.locator(".core-plugin-index-row").filter({ has: ctx.page.locator(".core-plugin-index-meta", { hasText: /Built in|Wbudowan/i }) });
  await rows.first().waitFor({ timeout: 10000 });
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest.id]));
  const results = [];
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    const pluginName = (await row.locator(".core-plugin-index-name").innerText()).trim();
    const pluginId = byName.get(pluginName) || pluginName;
    try {
      const checkbox = row.locator('input[type="checkbox"]');
      if (!(await checkbox.isChecked())) await row.locator(".core-switch").click();
      await ctx.page.waitForFunction((element) => element.checked && !element.disabled, await checkbox.elementHandle(), { timeout: 10000 });
      results.push({ name: `plugin ${pluginId} enabled`, ok: true });
    } catch (error) {
      results.push({ name: `plugin ${pluginId} enabled`, ok: false, error: String(error.message || error).split("\n")[0] });
    }
  }
  if (results.length !== manifests.filter((manifest) => manifest.id !== "notible.ai").length) {
    results.push({ name: "all builtin plugins enabled", ok: false, error: `Settings exposed ${results.length} builtins; expected ${manifests.filter((manifest) => manifest.id !== "notible.ai").length}` });
  }
  const off = [];
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    if (!(await row.locator('input[type="checkbox"]').isChecked())) off.push((await row.locator(".core-plugin-index-name").innerText()).trim());
  }
  results.push(off.length
    ? { name: "all builtin plugins enabled", ok: false, error: `still off: ${off.join(", ")}` }
    : { name: "all builtin plugins enabled", ok: true });
  return results;
}

module.exports = { path, emptyDoc, doc, text, paragraph, create, verify, openObject, enablePlugin, enableAllBuiltinPlugins };
