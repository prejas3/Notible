const { create, verify, doc, paragraph, enablePlugin } = require("../lib.cjs");
module.exports = { name: "typewriter-manuscript", async run(ctx) {
  await enablePlugin(ctx, "Typewriter");
  await ctx.page.waitForFunction(async () => (await window.__TAURI_INTERNALS__.invoke("list_types")).some((type) => type.name === "notible.typewriter.manuscript"), null, { timeout: 10000 });
  const types = new Set((await ctx.invoke("list_types")).map((type) => type.name));
  for (const name of ["notible.typewriter.manuscript", "notible.typewriter.chapter", "notible.typewriter.scene", "notible.typewriter.character"]) if (!types.has(name)) throw new Error(`Typewriter did not register ${name}`);
  const manuscript = await create(ctx, { type: "notible.typewriter.manuscript", title: "Demo novel", props: { logline: "A note app learns to tell its own story.", wordTarget: 50000, deadline: "2027-01-31", font: "georgia" } });
  const chapter = await create(ctx, { type: "notible.typewriter.chapter", title: "Chapter 1 · The Sandbox", parentId: manuscript.id, props: { synopsis: "The safe test world opens." } });
  const scene = await create(ctx, { type: "notible.typewriter.scene", title: "Scene 1 · First run", parentId: chapter.id, content: doc(paragraph("— Everything is isolated, said the tester.")), props: { status: "draft", order: 1, wordTarget: 800, font: "georgia" } });
  const character = await create(ctx, { type: "notible.typewriter.character", title: "Ada", parentId: manuscript.id, props: { fullName: "Ada Tester", oneLine: "Finds the edge cases.", colour: "violet" } });
  await verify(ctx, [manuscript.id, chapter.id, scene.id, character.id]);
  const children = await ctx.invoke("query_objects", { parentId: manuscript.id, limit: 50 });
  if (!children.some((item) => item.type === "notible.typewriter.chapter") || !children.some((item) => item.type === "notible.typewriter.character")) throw new Error("Typewriter hierarchy did not persist under the manuscript");
} };
