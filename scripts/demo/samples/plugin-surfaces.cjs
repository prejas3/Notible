const { create, verify, doc, paragraph, openObject, enablePlugin } = require("../lib.cjs");
const code = (language, value) => ({ type: "codeBlock", attrs: { language }, content: [{ type: "text", text: value }] });

module.exports = { name: "automations-queries-nib-and-slash", async run(ctx) {
  await enablePlugin(ctx, "Embedded queries");
  const project = await create(ctx, { type: "project", title: "Demo automation project", props: { _automations: [{
    id: "demo-on-create", version: 2, name: "Mark new records", enabled: true,
    trigger: { type: "record_created" },
    actions: [{ id: "history", type: "history_note", value: "Created by the demo automation" }],
    stopOnError: true,
  }] } });
  const automated = await create(ctx, { type: "task", title: "Automation reaction target", parentId: project.id, props: { status: "todo" } });
  await ctx.page.waitForFunction(async (id) => {
    const object = await window.__TAURI_INTERNALS__.invoke("get_object", { id });
    try { return JSON.parse(object.props)._automationNotes?.length > 0; } catch { return false; }
  }, automated.id, { timeout: 8000 });
  await openObject(ctx, "Demo automation project").catch((error) => { throw new Error(`Automations surface project did not open: ${error.message}`); });
  const automationsTab = ctx.page.locator(".core-object-tabs button", { hasText: /Automations/ });
  await automationsTab.waitFor({ timeout: 10000 }).catch(() => { throw new Error("Automations object tab was not registered"); });
  await automationsTab.click({ force: true, timeout: 10000 }).catch((error) => { throw new Error(`Automations object tab did not open: ${error.message}`); });
  const automationRule = ctx.page.locator(".automation-rule").first();
  await automationRule.waitFor({ timeout: 10000 }).catch(() => { throw new Error("Automations pane did not render the saved rule"); });
  if (await automationRule.locator("input").first().inputValue() !== "Mark new records") throw new Error("Automations pane rendered a different rule");
  if (!(await ctx.page.locator(".automation-plugin-surface").innerText()).includes("Execution log · 1")) throw new Error("Automations pane did not show the rule execution log");

  const query = await create(ctx, { type: "note", title: "Demo · live embedded query", content: doc(
    paragraph("This list is rendered live by notible.queries."),
    code("notible", "type: task\nstatus: todo\nsort: due asc\nlimit: 20\nas: table\nfields: title, status, due"),
  ), props: { tags: ["demo", "query"] } });
  await openObject(ctx, "Demo · live embedded query");
  await ctx.page.locator(".nq-summary").waitFor({ timeout: 10000 });
  if (!(await ctx.page.locator(".nq-root").innerText()).includes("Automation reaction target")) throw new Error("embedded query did not render its matching task");

  const slash = await create(ctx, { type: "note", title: "Demo · slash command result", content: doc(paragraph("")), props: { tags: ["demo", "slash-menu"] } });
  await openObject(ctx, "Demo · slash command result");
  const editor = ctx.page.locator("[contenteditable=true]").first();
  await editor.click();
  await ctx.page.keyboard.type("/heading 1", { delay: 20 });
  await ctx.page.locator(".core-slash-menu [role=option]", { hasText: "Heading 1" }).first().waitFor({ timeout: 5000 });
  await ctx.page.keyboard.press("Enter");
  await ctx.page.keyboard.type("Inserted through the slash menu");
  await ctx.page.waitForTimeout(500);
  if (await editor.locator("h1").count() < 1) throw new Error("slash-menu Heading 1 command did not change the editor");

  await ctx.page.locator(".nib-wake").click();
  await ctx.page.locator("#nib-question").fill("how do I link notes");
  await ctx.page.locator(".nib-ask button", { hasText: /Ask|Zapytaj/ }).click();
  await ctx.page.locator(".nib-excerpt").waitFor({ timeout: 8000 });
  if ((await ctx.page.locator(".nib-excerpt").innerText()).trim().length < 20) throw new Error("Nib did not return a Help-grounded answer");
  await ctx.page.locator(".nib-close").click();
  await verify(ctx, [project.id, automated.id, query.id, slash.id]);
} };
