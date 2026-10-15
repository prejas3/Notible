// Scenario: R4 "Projects that plan" (0.93.3, repair plan §5: T1–T11, T13).
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/r4-projects.cjs [--size 1366x768] [--theme paper|night] [--shots <dir>]
//
// A new project shows four statuses as board columns, empty ones too; a column's "+" fills the
// status; quick add keeps focus and can add another; the card menu opens, renames, sets status,
// due date and trashes; "All statuses" shows eleven; the table hides Type, edits and sorts Due by
// date; views are named on creation and a deleted one comes back with Undo; the calendar uses the
// app language, adds a task in the day and moves one by dragging; Manual order puts new work last;
// Properties offers the project's statuses and says what goes in Assignee; Modules turns on
// Finance and Planning from the project; the timeline has its dates on top and a colour key; a
// whiteboard card is ready to type, never lands on another and drags by its body.
// Needs a fresh `npm run sandbox:build`. Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const SIZE = arg("--size", "1366x768");
const THEME = arg("--theme", "paper");
const shotsAt = arg("--shots", null);
if (shotsAt) mkdirSync(shotsAt, { recursive: true });
const NAME = process.env.SANDBOX || `claude-r4-${SIZE}-${THEME}`;
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message) => { console.log(`${ok ? "PASS" : "FAIL"} ${message}`); if (!ok) failures.push(message); };
const CREATE = { name: "Create a note, folder or project", exact: true };
const tag = `${SIZE}-${THEME}`;

(async () => {
  const info = JSON.parse(sandboxCli("start", NAME, "--size", SIZE));
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  const shot = async (name) => { if (shotsAt) await page.screenshot({ path: path.join(shotsAt, `${tag}-${name}.png`) }); };
  const board = () => page.locator(".plugin-view-kanban").first();
  const column = (status) => page.locator(`.plugin-view-kanban-col[data-kanban-col="${status}"]`).first();
  const card = (title) => page.locator(".plugin-view-kanban-card", { hasText: title }).first();
  const layout = async (name) => { await page.locator(".plugin-view-layouts button", { hasText: name }).first().click(); await page.waitForTimeout(500); };
  const openCardMenu = async (title) => { await card(title).click({ button: "right" }); await page.locator(".plugin-view-menu").waitFor(); };
  const menuSub = async (name) => { await page.locator(".plugin-view-menu .plugin-view-submenu-trigger", { hasText: name }).hover(); await page.waitForTimeout(150); };
  try {
    await page.getByRole("button", CREATE).waitFor({ timeout: 30000 });
    await page.evaluate((value) => localStorage.setItem("notible-core-theme", value), THEME);
    await page.reload();
    await page.getByRole("button", CREATE).waitFor({ timeout: 30000 });

    // T13 / D3: the New project dialog offers what plugins that are off would add.
    await page.getByRole("button", CREATE).click();
    await page.getByRole("button", { name: /^Project/ }).click();
    await page.locator(".cmp-panel").waitFor();
    const offers = await page.locator(".cmp-offer").allInnerTexts();
    check(offers.some((text) => /Finance/.test(text)) && offers.some((text) => /Timeline/.test(text)), `New project lists Timeline and Finance with Turn on (${offers.length} offers)`);
    await page.locator(".cmp-name input").fill("Office move");
    await page.locator(".cmp-confirm").click();
    await board().waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);

    // T1/T2: four columns, empty ones too, one width.
    const cols = await page.evaluate(() => [...document.querySelectorAll(".plugin-view-kanban-col")].map((col) => ({ id: col.dataset.kanbanCol, name: col.querySelector(".plugin-view-kanban-head span")?.textContent, width: Math.round(col.getBoundingClientRect().width) })));
    check(cols.map((col) => col.id).join(",") === "todo,in-progress,blocked,done" && cols[0].name === "To do", `a new project's board shows To do / In progress / Blocked / Done (${cols.map((col) => col.name).join(", ")})`);
    check(new Set(cols.map((col) => col.width)).size === 1, `the columns are one width (${[...new Set(cols.map((col) => col.width))].join(", ")} px)`);
    const fill = await page.evaluate(() => { const board = document.querySelector(".plugin-view-kanban"); const cols = [...board.querySelectorAll(".plugin-view-kanban-col")]; const b = board.getBoundingClientRect(); return { gapRight: Math.round(b.right - cols[cols.length - 1].getBoundingClientRect().right), scrolls: board.scrollWidth > board.clientWidth + 1, width: Math.round(cols[0].getBoundingClientRect().width) }; });
    // Columns share the width when they fit; only when they do not, the board scrolls with columns at their 260 px minimum.
    check(fill.scrolls ? fill.width <= 262 : fill.gapRight <= 16, `columns fill the board, no empty half (${JSON.stringify(fill)})`);
    await shot("board-empty");
    // T6: one scroll area — nothing between the board and the main area scrolls on its own.
    const nested = await page.evaluate(() => { const out = []; for (let el = document.querySelector(".plugin-view-kanban")?.parentElement; el && !el.classList.contains("core-main"); el = el.parentElement) { const style = getComputedStyle(el); if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) out.push(el.className.toString().slice(0, 40)); } return out; });
    check(nested.length === 0, `the board scrolls with the page, not in a box of its own (${nested.join(", ") || "none"})`);

    // T1 + T3: a column's "+" opens quick add with that status; the title has focus; add another.
    await column("in-progress").locator("button[aria-label^='Add to']").click();
    const form = page.locator(".plugin-view-create-form");
    await form.waitFor();
    check(await page.evaluate(() => document.activeElement?.closest(".plugin-view-create-title") !== null), "quick add puts the cursor in Title");
    check(/In progress/.test(await form.innerText()), "the column's status is filled in");
    const typeTrigger = await form.locator(".nb-control-trigger").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    check(typeTrigger !== "rgb(36, 107, 232)" && typeTrigger !== "rgb(37, 99, 235)", `the pickers in the form look like fields, not blue buttons (${typeTrigger})`);
    await page.keyboard.type("Write the brief", { delay: 15 });
    await form.getByRole("button", { name: "Create and add another" }).click();
    await page.waitForTimeout(700);
    const again = await page.evaluate(() => ({ open: Boolean(document.querySelector(".plugin-view-create-form")), value: document.querySelector(".plugin-view-create-title input")?.value, focused: document.activeElement?.closest(".plugin-view-create-title") !== null }));
    check(again.open && again.value === "" && again.focused, `"Create and add another" keeps the form open, empty and focused ${JSON.stringify(again)}`);
    await page.keyboard.type("Book the room", { delay: 15 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    check(await form.count() === 0, "Create closes the form");
    check(await column("in-progress").locator(".plugin-view-kanban-card").count() === 2, "both tasks are in In progress");
    check(await page.locator(".plugin-view-meta-chip", { hasText: /^None$/ }).count() === 0, "no \"None\" priority chip on cards (T4)");

    // T1: the column menu closes on Escape.
    await column("todo").locator("button[aria-haspopup]").click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    check(await column("todo").locator(".plugin-view-submenu-panel").count() === 0, "a column's menu closes on Escape");

    // T4: the card menu.
    await openCardMenu("Write the brief");
    const menuText = await page.locator(".plugin-view-menu").innerText();
    check(["Open", "Rename", "Status", "Priority", "Due date", "Move to trash"].every((item) => menuText.includes(item)), `the card menu has Open, Rename, Status, Priority, Due date, Move to trash`);
    await menuSub("Status");
    const statusItems = await page.locator(".plugin-view-menu .plugin-view-submenu-panel button").allInnerTexts();
    check(statusItems.length === 4 && !statusItems.includes("Open"), `Status lists the project's four statuses, without a stray "Open" (${statusItems.join(", ")})`);
    await shot("card-menu");
    await page.keyboard.press("Escape");
    await openCardMenu("Write the brief");
    await page.locator(".plugin-view-menu button", { hasText: "Rename" }).click();
    await page.locator(".plugin-view-rename").waitFor();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Write the project brief", { delay: 10 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    check(await card("Write the project brief").count() === 1, "Rename renames the card in place");
    await openCardMenu("Write the project brief");
    await menuSub("Status");
    await page.locator(".plugin-view-menu .plugin-view-submenu-panel button", { hasText: /^Done$/ }).click();
    await page.waitForTimeout(600);
    check(await column("done").locator(".plugin-view-kanban-card.is-finished").count() === 1, "a done card moves to Done and reads as finished");

    // T2: "All statuses" shows all eleven; back to four.
    await page.locator(".plugin-view-more > button").click();
    await page.locator(".plugin-view-more-menu button", { hasText: "Show all 11 statuses" }).click();
    await page.waitForTimeout(800);
    const allCols = await page.locator(".plugin-view-kanban-col .plugin-view-kanban-count").allTextContents();
    check(allCols.length >= 1 && allCols.length < 11 && allCols.every((count) => Number(count) > 0), `with all 11 statuses only the columns in use show, no wall of empty ones (${allCols.join(", ")})`);
    await page.locator(".plugin-view-more > button").click();
    await page.locator(".plugin-view-more-menu button", { hasText: "Show 4 statuses" }).click();
    await page.waitForTimeout(800);
    check(await page.locator(".plugin-view-kanban-col").count() === 4, "and Show 4 statuses goes back to four");
    await shot("board");

    // An older project (no statusSet) whose tasks are all done: its work is on screen, not past 8 empty columns.
    await page.evaluate(async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const doc = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
      const project = await invoke("create_object", { type: "project", title: "Older project", content: doc, props: "{}", parentId: null });
      for (let i = 1; i <= 5; i += 1) await invoke("create_object", { type: "task", title: `Finished ${i}`, content: doc, props: JSON.stringify({ status: "done" }), parentId: project.id });
    });
    await page.reload();
    await page.getByRole("button", CREATE).waitFor({ timeout: 30000 });
    await page.locator(".core-object-row", { hasText: "Older project" }).click();
    await board().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const legacy = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".plugin-view-kanban-card")];
      const visible = cards.filter((card) => { const r = card.getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; });
      return { columns: document.querySelectorAll(".plugin-view-kanban-col").length, cards: cards.length, visible: visible.length };
    });
    check(legacy.cards === 5 && legacy.visible === 5 && legacy.columns === 1, `an older project's done tasks are on screen in their one column ${JSON.stringify(legacy)}`);
    await shot("board-older");
    await page.locator(".core-object-row", { hasText: "Office move" }).click();
    await board().waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);

    // T5: the toolbar says what its parts do.
    const toolbar = await page.locator(".plugin-view-tabs, .plugin-view-toolbar").allInnerTexts();
    check(toolbar.join(" ").includes("Duplicate view") && toolbar.join(" ").includes("Showing"), "the toolbar reads Duplicate view and Showing");

    // T7: the table.
    await layout("Table");
    const headers = await page.locator(".plugin-view-table thead tr").first().locator("th").allInnerTexts();
    check(!headers.some((text) => /^Type/.test(text.trim())), `the Type column is hidden when every row is a task (${headers.map((text) => text.trim()).join(", ")})`);
    const fills = await page.evaluate(() => { const table = document.querySelector(".plugin-view-table"); const wrap = document.querySelector(".plugin-view-table-wrap"); return table.getBoundingClientRect().width >= wrap.clientWidth - 1; });
    check(fills, "the table fills its width");
    const dueInputs = page.locator(".plugin-view-table tbody .nb-datepicker input");
    check(await dueInputs.count() === 2, "Due is editable in the table");
    const rows = await page.locator(".plugin-view-table tbody tr").allInnerTexts();
    const firstTitle = rows[0].split("\n")[0].trim();
    for (const [index, date] of [[0, "2026-10-20"], [1, "2026-10-05"]]) {
      await dueInputs.nth(index).click();
      await page.keyboard.press("Control+A");
      await page.keyboard.type(date, { delay: 10 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
    }
    await page.locator(".plugin-view-th-sort", { hasText: "Due" }).click();
    await page.waitForTimeout(400);
    const sorted = (await page.locator(".plugin-view-table tbody tr").first().innerText()).split("\n")[0].trim();
    check(sorted !== firstTitle, `sorting by Due puts 5 October first (${sorted})`);
    await shot("table");

    // T8: a new view asks for its name; a deleted view comes back with Undo.
    await page.getByRole("button", { name: "+ New view" }).click();
    const nameBox = page.locator(".plugin-view-tab input");
    await nameBox.waitFor();
    check(await nameBox.evaluate((el) => el === document.activeElement), "+ New view puts the cursor in its name");
    await page.keyboard.type("Sprint", { delay: 15 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    const sprint = page.locator(".plugin-view-tab", { hasText: "Sprint" });
    check(await sprint.count() === 1, "the new view is called Sprint");
    const idleOpacity = await page.locator(".plugin-view-tab", { hasText: "Tasks" }).locator(".plugin-view-tab-delete").evaluate((el) => getComputedStyle(el).opacity);
    check(idleOpacity === "0", `a tab's × shows only on hover (${idleOpacity})`);
    await sprint.hover();
    await sprint.locator(".plugin-view-tab-delete").click();
    await page.locator(".plugin-view-undo").waitFor();
    await page.locator(".plugin-view-undo button").click();
    const back = await page.locator(".plugin-view-tab", { hasText: "Sprint" }).waitFor({ timeout: 8000 }).then(() => true, () => false);
    check(back, "Undo brings the deleted view back");
    await page.locator(".plugin-view-tab", { hasText: "Tasks" }).locator("button").first().click();
    await page.waitForTimeout(500);

    // T9: the calendar.
    await layout("Calendar");
    const month = await page.locator(".plugin-view-cal-head strong").innerText();
    const expected = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    check(month === expected, `the calendar month is in the app's language (${month}, expected ${expected})`);
    check(await page.locator(".plugin-view-cal-today").count() === 1, "today is marked");
    const now = new Date();
    const day = (n) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
    await page.locator(`[data-cal-day="${day(15)}"]`).dblclick({ position: { x: 40, y: 50 } });
    await page.locator(".plugin-view-cal-new").waitFor();
    await page.keyboard.type("Call the vendor", { delay: 15 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(900);
    const chip = page.locator(`[data-cal-day="${day(15)}"] .plugin-view-cal-chip`, { hasText: "Call the vendor" });
    check(await chip.count() === 1, "double-clicking a day adds a task right there");
    const from = await chip.boundingBox();
    const to = await page.locator(`[data-cal-day="${day(16)}"]`).boundingBox();
    await page.mouse.move(from.x + 10, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) { await page.mouse.move(from.x + 10 + ((to.x + 30 - from.x - 10) * i) / 10, from.y + from.height / 2 + ((to.y + 40 - from.y - from.height / 2) * i) / 10); await page.waitForTimeout(25); }
    await page.mouse.up();
    await page.waitForTimeout(900);
    check(await page.locator(`[data-cal-day="${day(16)}"] .plugin-view-cal-chip`, { hasText: "Call the vendor" }).count() === 1, "dragging a task to another day moves its due date");
    await shot("calendar");

    // T10: Manual order — the newest task is last.
    await layout("Gallery");
    const gallery = await page.locator(".plugin-view-card .plugin-view-row-title").allInnerTexts();
    check(gallery[gallery.length - 1] === "Call the vendor", `Manual order puts the newest task last (${gallery.join(" · ")})`);

    // T10 + D2: Properties of a task in this project.
    await page.locator(".plugin-view-card", { hasText: "Book the room" }).click();
    await page.waitForTimeout(1200);
    // Below 1200 px Properties folds behind its toolbar button (0.93.1, C1).
    const toggle = page.locator(".core-properties-toggle");
    if (await toggle.isVisible().catch(() => false) && await toggle.getAttribute("aria-pressed") !== "true") { await toggle.click(); await page.waitForTimeout(400); }
    const assignee = page.locator(".properties-editor-field", { hasText: /^Assignee/ }).locator("input");
    check(await assignee.getAttribute("placeholder") === "Who? Type a name", "Assignee says what goes in it");
    const statusField = page.locator(".properties-editor-field", { hasText: /^Status/ }).locator(".nb-control-trigger").first();
    await statusField.click();
    await page.waitForTimeout(300);
    const statusOptions = await page.locator("[role=option]").allInnerTexts();
    check(statusOptions.length === 4, `the task's Status offers the project's four (${statusOptions.join(", ")})`);
    await page.keyboard.press("Escape");
    await shot("task");

    // T13 / D3 / D8: Modules turns on Finance and Planning from the project.
    await page.locator(".core-tree-row, .core-nav-row, [role=treeitem]", { hasText: "Office move" }).first().click().catch(() => {});
    await page.getByRole("button", { name: "Back to parent" }).click().catch(() => {});
    await page.waitForTimeout(800);
    const modules = page.getByRole("button", { name: "Modules: choose what this shows" });
    await modules.click();
    await page.locator(".cmp-panel").waitFor();
    await page.locator(".cmp-offer", { hasText: "Finance" }).getByRole("button", { name: "Turn on" }).click();
    await page.waitForTimeout(2500);
    const financeRow = page.locator(".cmp-row", { hasText: /^Finance/ }).locator("input[type=checkbox]");
    check(await financeRow.count() === 1 && await financeRow.isChecked(), "Turn on adds Finance to the list, ticked");
    await page.locator(".cmp-offer", { hasText: "Timeline" }).getByRole("button", { name: "Turn on" }).click();
    await page.waitForTimeout(2500);
    await shot("modules");
    await page.locator(".cmp-confirm").click();
    await page.waitForTimeout(1200);
    const tabs = await page.locator(".core-object-tabs > button").allInnerTexts();
    check(tabs.some((text) => /Finance/.test(text)) && tabs.some((text) => /Timeline/.test(text)), `the project now has Finance and Timeline tabs (${tabs.join(", ")})`);
    await page.locator(".core-object-tabs > button", { hasText: "Timeline" }).click();
    await page.waitForTimeout(1500);
    const gantt = await page.evaluate(() => { const axis = document.querySelector(".pd-gantt-axis"); const rows = document.querySelector(".pd-gantt-rows"); return { axisTop: axis?.getBoundingClientRect().top ?? -1, rowsTop: rows?.getBoundingClientRect().top ?? -1, key: Boolean(document.querySelector(".pd-gantt-key")) }; });
    check(gantt.axisTop >= 0 && gantt.axisTop < gantt.rowsTop && gantt.key, `the timeline has its dates on top and a colour key ${JSON.stringify(gantt)}`);
    await shot("timeline");

    // T11: a whiteboard.
    await page.getByRole("button", CREATE).click();
    await page.getByRole("button", { name: /^Whiteboard/ }).click();
    await page.locator(".canvas-toolbar").waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    await page.locator(".canvas-toolbar button", { hasText: "Card" }).click();
    await page.waitForTimeout(400);
    check(await page.evaluate(() => document.activeElement?.closest(".canvas-node-card") !== null), "a new card is ready to type in");
    await page.keyboard.type("First idea", { delay: 15 });
    await page.locator(".canvas-toolbar button", { hasText: "Card" }).click();
    await page.waitForTimeout(400);
    const boxes = await page.locator(".canvas-node-card").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })));
    const [a, b] = boxes;
    check(boxes.length === 2 && (b.x >= a.x + a.w || b.x + b.w <= a.x || b.y >= a.y + a.h || b.y + b.h <= a.y), "the second card lands beside the first, not on it");
    // The card just typed in: Esc leaves typing, then its body drags it (final review R-USE-01).
    await page.keyboard.type("Second", { delay: 10 });
    await page.keyboard.press("Escape");
    const before = await page.locator(".canvas-node-card").last().boundingBox();
    const body = { x: before.x + before.width / 2, y: before.y + before.height / 2 + 10 };
    await page.mouse.move(body.x, body.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) { await page.mouse.move(body.x + i * 10, body.y + i * 5); await page.waitForTimeout(25); }
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await page.locator(".canvas-node-card").last().boundingBox();
    check(after.x - before.x > 50, `after Esc, the card you were typing in drags by its body (moved ${Math.round(after.x - before.x)} px)`);
    await page.locator(".canvas-more").click();
    check(/Report: the board as text/.test(await page.locator(".canvas-menu").innerText()), "⋯ opens the whiteboard menu, with Report explained");
    await shot("whiteboard");
    await page.keyboard.press("Escape");

    // T9: Core puts the app language on <html lang>, which dates follow.
    const lang = await page.evaluate(async () => { localStorage.setItem("notible-language", "pl"); window.dispatchEvent(new Event("notible:preferences")); await new Promise((resolve) => setTimeout(resolve, 300)); const pl = document.documentElement.lang; localStorage.setItem("notible-language", "en"); window.dispatchEvent(new Event("notible:preferences")); await new Promise((resolve) => setTimeout(resolve, 300)); return [pl, document.documentElement.lang]; });
    check(lang[0] === "pl" && lang[1] === "en", `<html lang> follows the app language (${lang.join(" → ")})`);
  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n")[0]}`);
    await shot("crash").catch(() => {});
  } finally {
    await browser.close().catch(() => {});
    sandboxCli("stop", NAME);
  }
  console.log(failures.length ? `\nR4 projects scenario FAILED (${failures.length})` : "\nR4 projects scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
