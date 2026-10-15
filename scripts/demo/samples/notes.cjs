const { create, verify, doc, text, paragraph } = require("../lib.cjs");
module.exports = { name: "notes-and-blocks", async run(ctx) {
  const blocks = [
    { type: "heading", attrs: { level: 1 }, content: [text("Every editor block")] },
    paragraph("Plain paragraph with **literal** punctuation and [[Demo project]]."),
    { type: "heading", attrs: { level: 2 }, content: [text("Lists and tasks")] },
    { type: "bulletList", content: [{ type: "listItem", content: [paragraph("Bullet one")] }, { type: "listItem", content: [paragraph("Bullet two")] }] },
    { type: "orderedList", content: [{ type: "listItem", content: [paragraph("First")] }, { type: "listItem", content: [paragraph("Second")] }] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph("Completed checkbox")] }, { type: "taskItem", attrs: { checked: false }, content: [paragraph("Open checkbox")] }] },
    { type: "blockquote", content: [paragraph("A quotation for visual testing.")] },
    // ponytail: no callout block exists in CoreMarkdownEditor; add one here when the app has it.
    { type: "horizontalRule" },
    { type: "table", content: [
      { type: "tableRow", content: [{ type: "tableHeader", content: [paragraph("Feature")] }, { type: "tableHeader", content: [paragraph("State")] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [paragraph("Inline table")] }, { type: "tableCell", content: [paragraph("Ready")] }] },
    ] },
    // Columns are Markdown fences in the editor (coreCommands.ts "columns"), not a node type.
    paragraph("::: columns"), paragraph("Left column"), paragraph("Right column"), paragraph(":::"),
  ];
  const note = await create(ctx, { type: "note", title: "Demo · every editor block", content: doc(...blocks), props: { tags: ["demo", "blocks"] } });
  await verify(ctx, [note.id]);
} };
