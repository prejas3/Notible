const { create, verify, openObject } = require("../lib.cjs");
// Schemas 0.2.0 (Hive #42): one Invoice schema attached to two projects counts in each
// separately; a global task schema applies anywhere. Attachments are the plugin's own
// hidden objects (notible.schemas.attachment), created here the way the tab creates them.
module.exports = { name: "note-schemas", async run(ctx) {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  const alpha = await create(ctx, { type: "project", title: "Client Alpha" });
  const beta = await create(ctx, { type: "project", title: "Client Beta" });
  const invoice = await create(ctx, { type: "notible.schemas.schema", title: "Invoice", props: { targetType: "note", titlePattern: "FV/{counter:3}/{mm}/{yyyy}", counterReset: "monthly", defaultProps: { status: "draft" }, defaultTags: ["invoice"] } });
  const taskSchema = await create(ctx, { type: "notible.schemas.schema", title: "Demo task", props: { targetType: "task", titlePattern: "TASK-{counter:3}", counterReset: "never", defaultProps: { status: "todo", priority: "high" }, defaultTags: ["demo-schema"] } });
  for (const project of [alpha, beta]) {
    await create(ctx, { type: "notible.schemas.attachment", title: "Invoice", parentId: project.id, props: { schemaId: invoice.id, containerId: project.id } });
  }
  await ctx.page.waitForTimeout(300);
  const items = [];
  for (const project of [alpha, alpha, beta, beta]) items.push({ project, ...(await create(ctx, { type: "note", title: "New note", parentId: project.id })) });
  const globalTask = await create(ctx, { type: "task", title: "New task" });
  const taskInAlpha = await create(ctx, { type: "task", title: "New task", parentId: alpha.id });
  await ctx.page.waitForTimeout(1500);
  await verify(ctx, [alpha.id, beta.id, invoice.id, taskSchema.id, items.map((item) => item.id), globalTask.id, taskInAlpha.id]);

  const title = async (id) => (await ctx.invoke("get_object", { id })).title;
  const invoices = [];
  for (const item of items) invoices.push(`${item.project.title}: ${await title(item.id)}`);
  const expected = ["Client Alpha", "Client Alpha", "Client Beta", "Client Beta"].map((name, index) => `${name}: FV/00${index % 2 + 1}/${mm}/${yyyy}`);
  if (invoices.join(" | ") !== expected.join(" | ")) throw new Error(`per-project invoice numbers wrong: ${invoices.join(" | ")}`);
  const tasks = [await title(globalTask.id), await title(taskInAlpha.id)];
  if (tasks.join(",") !== "TASK-001,TASK-002") throw new Error(`global task schema did not apply: ${tasks.join(", ")}`);
  const props = JSON.parse((await ctx.invoke("get_object", { id: items[0].id })).props);
  if (props.schemaScope !== alpha.id || props.status !== "draft" || !props.tags?.includes("invoice")) throw new Error("invoice is missing its scope, status or tag");

  // The project tab lists the attachment with Alpha's next number.
  await openObject(ctx, "Client Alpha");
  await ctx.page.locator(".core-object-tabs button", { hasText: /^\s*(Schemas|Schematy)\s*$/ }).click();
  const tab = ctx.page.locator(".nschemas-tab");
  await tab.waitFor({ timeout: 10000 });
  await ctx.page.waitForFunction(() => /FV\/003/.test(document.querySelector(".nschemas-tab")?.innerText ?? ""), null, { timeout: 10000 })
    .catch(async () => { throw new Error(`Schemas tab does not show FV/003 next: ${(await tab.innerText()).slice(0, 200)}`); });
} };
