// Help media shots. Each shot runs its steps on a freshly seeded app, then is
// captured: "shot" → public/help/<name>.webp, "clip" → public/help/<name>.webm.
// `clip` is a CSS selector whose box is the crop, or a { x, y, width, height }
// rectangle in window pixels (absent = whole window).
// A step that can't find its target throws — Help then describes UI that is gone.

const openRow = async (page, title) => {
  await page.locator(".core-sidebar").getByText(title, { exact: true }).first().click();
  await page.waitForTimeout(700);
};
const expandRow = async (page, title) => {
  const toggle = page.locator(`.core-sidebar button[aria-label="Expand ${title}"]`);
  if (await toggle.count()) { await toggle.first().click(); await page.waitForTimeout(300); }
};

module.exports = [
  {
    name: "plus-menu", kind: "shot", clip: { x: 0, y: 0, width: 480, height: 640 },
    steps: async (page) => { await page.locator("button.core-new-button").click(); await page.waitForTimeout(400); },
    after: async (page) => { await page.keyboard.press("Escape"); },
  },
  {
    name: "slash-menu", kind: "clip", clip: ".core-main",
    steps: async (page) => {
      await openRow(page, "Weekly review");
      const editor = page.locator(".core-editor-content").first();
      await editor.click();
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      await page.keyboard.type("/", { delay: 120 });
      await page.waitForTimeout(700);
      for (let i = 0; i < 4; i += 1) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(260); }
      await page.keyboard.type("che", { delay: 180 });
      await page.waitForTimeout(700);
      await page.keyboard.press("Enter");
      await page.keyboard.type("Water the new beds", { delay: 60 });
      await page.waitForTimeout(800);
    },
  },
  {
    name: "containers-tree", kind: "shot", clip: { x: 0, y: 0, width: 272, height: 620 },
    steps: async (page) => { await expandRow(page, "Home"); await expandRow(page, "Garden redesign"); await expandRow(page, "Reading list"); },
  },
  {
    name: "project-board", kind: "shot", clip: { x: 272, y: 170, width: 1168, height: 690 },
    steps: async (page) => { await openRow(page, "Garden redesign"); await page.waitForTimeout(800); },
  },
  {
    name: "workspace-overview", kind: "shot", clip: { x: 272, y: 170, width: 1168, height: 690 },
    steps: async (page) => { await openRow(page, "Home"); await page.waitForTimeout(1000); },
  },
  {
    name: "whiteboard-drag", kind: "clip", clip: ".core-main",
    steps: async (page) => {
      await openRow(page, "Ideas");
      await page.waitForTimeout(800);
      // Card text lives in a <textarea>; grab the card by its drag handle.
      const card = page.locator(".canvas-node-card .canvas-node-handle").first();
      const box = await card.boundingBox();
      if (!box) throw new Error("whiteboard card not found");
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 20; i += 1) { await page.mouse.move(x + i * 12, y + i * 4); await page.waitForTimeout(40); }
      await page.mouse.up();
      await page.waitForTimeout(600);
    },
  },
  {
    name: "move-to", kind: "clip",
    steps: async (page) => {
      await openRow(page, "Dolor sit amet");
      await page.locator('button[aria-label="Move to…"]').first().click();
      await page.waitForTimeout(1200);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    },
  },
  {
    name: "help-search", kind: "shot", clip: { x: 0, y: 0, width: 560, height: 520 },
    steps: async (page) => {
      await page.locator('button[aria-label="Search notes and settings"]').click();
      // Typing before the box has focus loses the first letters ("ace dashboard").
      await page.locator(".core-sidebar input").first().waitFor();
      await page.waitForTimeout(400);
      await page.keyboard.type("workspace dashboard", { delay: 30 });
      await page.waitForTimeout(600);
    },
    after: async (page) => { await page.keyboard.press("Escape"); },
  },
];
