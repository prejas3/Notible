const { create, verify, doc, paragraph } = require("../lib.cjs");
module.exports = { name: "relations-links-folders-and-files", async run(ctx) {
  const folder = await create(ctx, { type: "folder", title: "Demo folder" });
  const a = await create(ctx, { type: "note", title: "Linked source", parentId: folder.id, content: doc(paragraph("Open [[Linked target]] and inspect backlinks.")), props: { tags: ["demo", "relations"] } });
  const b = await create(ctx, { type: "note", title: "Linked target", parentId: folder.id, content: doc(paragraph("Backlinks should include Linked source.")), props: { tags: ["demo", "relations"], relations: [{ type: "related", targetId: a.id }] } });
  await ctx.invoke("update_object", { id: a.id, props: JSON.stringify({ tags: ["demo", "relations"], relations: [{ type: "related", targetId: b.id }] }) });
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const mediaPath = await ctx.invoke("save_media", { dataBase64: png, ext: "png" });
  const mediaRef = `media/${String(mediaPath).split(/[\\/]/).pop()}`;
  const file = await create(ctx, { type: "note", title: "Demo · files and media", parentId: folder.id, content: doc(
    paragraph("A real sandbox-local image is stored below; use this note for file/audio/video insertion too."),
    { type: "image", attrs: { src: mediaRef, alt: "Demo one-pixel PNG", title: "Sandbox media sample" } },
  ), props: { tags: ["demo", "media", "attachments"] } });
  await verify(ctx, [folder.id, a.id, b.id, file.id]);
  const stored = await ctx.invoke("get_object", { id: file.id });
  if (!stored.content.includes(mediaRef)) throw new Error("saved media reference is absent from the note");
} };
