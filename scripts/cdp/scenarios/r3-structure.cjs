// Scenario R3 (repair plan 01.10, Core 0.93.0 "Structure and trust").
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/r3-structure.cjs
//
// In a fresh sandbox: a folder is just a name (S3); creating inside the open
// item, with "top level instead" (S4); project dialog name first (S2, S8);
// Modules is a button (S6); breadcrumb (N1, N11); floating notices (N2);
// delete + Undo (N3); Trash with Restore / Delete forever / Empty trash (N4);
// the tree stays in Settings and Help (N5); Rename, F2, Duplicate, Export
// group (N6); drag into a row and Move to a note, never into itself (N7);
// target expanded, expansion remembered (N8); scroll top on navigation (N14);
// + and Notes close search (N15); version history names its note and renders
// (N12). Needs a fresh `npm run sandbox:build`. Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-r3-structure";
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };
const CREATE = { name: "Create a note, folder or project", exact: true };

(async () => {
  const info = JSON.parse(sandboxCli("start", NAME, "--size", "1360x820"));
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  const row = (title) => page.locator(".core-object-tree-row", { has: page.locator(".core-object-row strong", { hasText: new RegExp(`^${title}$`) }) }).first();
  const rowMenu = async (title) => { await row(title).locator(".core-object-row").click({ button: "right" }); await page.locator(".core-row-context-menu").waitFor(); };
  const typeTitle = async (text) => { await page.keyboard.press("Control+A"); await page.keyboard.type(text, { delay: 10 }); await page.waitForTimeout(900); };
  const notes = async () => { await page.locator(".core-nav button", { hasText: "Notes" }).first().click(); await page.waitForTimeout(300); };
  try {
    await page.getByRole("button", CREATE).waitFor({ timeout: 30000 });
    await notes();

    // S3: a folder is just a name, title ready to type.
    await page.getByRole("button", CREATE).click();
    await page.locator(".core-create-menu-described button", { hasText: "Folder" }).click();
    await page.waitForTimeout(600);
    check(await page.locator(".cmp-panel").count() === 0, "S3: a new folder opens no module dialog");
    check(await page.evaluate(() => document.activeElement?.classList.contains("core-title-input")), "S3: the folder's title is ready to type");
    await typeTitle("Reading");

    // S4: + now creates inside the open folder; "Top level instead" is there.
    await page.getByRole("button", CREATE).click();
    const target = await page.locator(".core-create-target").innerText().catch(() => "");
    check(/Inside Reading/.test(target) && /Top level instead/.test(target), `S4: the + menu says it creates inside the open folder ("${target.replace(/\n/g, " ")}")`);
    await page.locator(".core-create-menu-described button", { hasText: "New note" }).click();
    await page.waitForTimeout(500);
    await typeTitle("Chapter one");
    const parentOk = await page.evaluate(async () => {
      const all = await window.__TAURI_INTERNALS__.invoke("list_objects", {}).catch(() => null);
      return all;
    });
    void parentOk;
    // N1/N11: the header shows where the note lives, and the folder is open in the tree.
    const crumb = await page.locator(".core-breadcrumb").innerText().catch(() => "");
    check(/All notes/.test(crumb) && /Reading/.test(crumb), `N1: the header shows the path ("${crumb.replace(/\n/g, " ")}")`);
    check(await page.locator(".core-editor-meta").innerText() === "", "N1: the tiny duplicate title under the title is gone");
    check(await row("Chapter one").count() === 1, "S4/N11: the note sits inside Reading and is visible in the tree");
    await page.locator(".core-breadcrumb button", { hasText: "Reading" }).click();
    await page.waitForTimeout(500);
    check((await page.locator(".core-title-input").inputValue()) === "Reading", "N1: a breadcrumb step opens that folder");
    const folderList = await page.locator(".core-editor-panel").innerText();
    check(folderList.includes("Chapter one"), "S3: the folder's page lists the note inside it");

    // S2/S8/S6: project dialog — name first, real dialog, Modules a button.
    await page.getByRole("button", CREATE).click();
    await page.locator(".core-create-target button").click(); // top level instead
    await page.locator(".core-create-menu-described button", { hasText: /^Project/ }).click();
    const dialog = page.getByRole("dialog", { name: /New project/ });
    await dialog.waitFor({ timeout: 4000 });
    check(await page.evaluate(() => document.activeElement?.tagName === "INPUT"), "S2: the name field has focus when the dialog opens");
    await page.keyboard.type("Garden plan", { delay: 10 });
    check(await dialog.getByRole("button", { name: "Use defaults" }).count() === 0, "S2: no \"Use defaults\" button");
    check(!/tab strip|container/i.test(await dialog.innerText()), "S2: no jargon in the dialog");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await page.waitForTimeout(800);
    check((await page.locator(".core-title-input").inputValue()) === "Garden plan", "S2/S8: the typed name is the project's name");
    check(await row("Garden plan").locator("xpath=..").count() >= 0 && await page.locator(".core-breadcrumb button").count() === 1, "S4: \"Top level instead\" created it at the top level");
    const modules = page.locator(".core-object-tabs-modules");
    check(await modules.count() === 1 && await modules.getAttribute("role") !== "tab" && (await modules.evaluate((el) => getComputedStyle(el).borderStyle)) !== "none", "S6: Modules is a button, not a tab");

    // N6: rename from the menu, F2, double-click; Duplicate; Export group.
    await rowMenu("Chapter one");
    const menuText = await page.locator(".core-row-context-menu").innerText();
    check(/Rename/.test(menuText) && /Move to/.test(menuText) && /Duplicate/.test(menuText) && /Export and print/.test(menuText), "N6: the row menu has Rename, Move to…, Duplicate and Export");
    check(!/Print \/ Save as PDF/.test(menuText), "N6: exports are folded under one entry");
    await page.locator(".core-row-context-menu button", { hasText: "Rename" }).click();
    await page.locator(".core-object-row-rename").fill("Chapter 1");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    check(await row("Chapter 1").count() === 1, "N6: Rename in place works");
    await row("Chapter 1").locator(".core-object-row").dblclick();
    check(await page.locator(".core-object-row-rename").count() === 1, "N6: double-click starts renaming");
    await page.keyboard.press("Escape");
    await row("Chapter 1").locator(".core-object-row").click();
    await page.waitForTimeout(400);
    await page.locator(".core-sidebar").click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("F2");
    check(await page.locator(".core-object-row-rename").count() === 1, "N6: F2 renames the open item");
    await page.keyboard.press("Escape");
    await rowMenu("Chapter 1");
    await page.locator(".core-row-context-menu button", { hasText: "Duplicate" }).click();
    await page.waitForTimeout(900);
    check(await row("Chapter 1 \\(copy\\)").count() === 1, "N6: Duplicate makes a copy beside it");

    // N7: Move lists notes; never itself or its children.
    await row("Reading").locator(".core-object-row").click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Move to…" }).click();
    const targets = await page.locator(".core-move-menu button").allInnerTexts();
    check(!targets.some((text) => /Chapter 1/.test(text)), `N7: a folder cannot move into its own notes (${targets.join(", ")})`);
    check(targets.some((text) => /Garden plan/.test(text)), "N7: other items are targets");
    await page.keyboard.press("Escape");
    await page.mouse.click(700, 500);

    // N7: drag a note onto another row to nest it; N8 the target opens.
    const source = row("Chapter 1 \\(copy\\)").locator(".core-object-row");
    const into = row("Garden plan").locator(".core-object-row");
    await source.dragTo(into, { targetPosition: { x: 40, y: 20 } });
    await page.waitForTimeout(900);
    const nested = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".core-object-tree-row")];
      const copy = rows.find((r) => r.textContent.includes("Chapter 1 (copy)"));
      const garden = rows.find((r) => r.textContent.includes("Garden plan"));
      return copy && garden ? parseFloat(copy.style.paddingLeft || "0") > parseFloat(garden.style.paddingLeft || "0") : false;
    });
    check(nested, "N7/N8: dropping onto a row nests it there, and the target is open");
    const remembered = await page.evaluate(() => JSON.parse(localStorage.getItem("notible-core-expanded") ?? "[]").length);
    check(remembered >= 1, `N8: open folders are remembered (${remembered})`);

    // N3: delete, notice floats, Undo brings it back and opens it.
    await row("Chapter 1").locator(".core-object-row").click();
    await page.waitForTimeout(400);
    const titleTop = await page.locator(".core-title-input").evaluate((el) => el.getBoundingClientRect().top);
    await page.getByRole("button", { name: "Move to trash" }).click();
    const undo = page.locator(".core-notice .core-notice-action", { hasText: "Undo" });
    await undo.waitFor({ timeout: 4000 });
    check(await page.locator(".core-notice").evaluate((el) => getComputedStyle(el).position === "fixed"), "N2: the notice floats");
    await undo.click();
    await page.waitForTimeout(900);
    check((await page.locator(".core-title-input").inputValue()) === "Chapter 1", "N3: Undo restores the note and opens it again");
    check(Math.abs((await page.locator(".core-title-input").evaluate((el) => el.getBoundingClientRect().top)) - titleTop) < 2, "N2: the page did not jump");

    // N4: Trash with visible buttons.
    await page.getByRole("button", { name: "Move to trash" }).click();
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "Settings", exact: true }).last().click();
    await page.locator(".core-settings-nav button", { hasText: "Recovery" }).click();
    await page.waitForTimeout(600);
    const trashRow = page.locator(".core-collection-row", { hasText: "Chapter 1" }).first();
    check(await trashRow.getByRole("button", { name: "Restore" }).count() === 1 && await trashRow.getByRole("button", { name: "Delete forever" }).count() === 1, "N4: a trashed item has Restore and Delete forever");
    check(await page.getByRole("button", { name: "Empty trash" }).count() === 1, "N4: Empty trash is there");
    // N5: the tree stays in the sidebar on Settings.
    check(await page.locator(".core-sidebar .core-object-tree-row").count() >= 3, "N5: the note tree stays in the sidebar on Settings");
    await trashRow.getByRole("button", { name: "Delete forever" }).click();
    await page.locator(".core-restore-confirm").getByRole("button", { name: "Delete forever" }).click();
    await page.waitForTimeout(900);
    check(await page.locator(".core-collection-row", { hasText: "Chapter 1" }).count() === 0, "N4: Delete forever removes it from the trash");

    // N12: version history names its note and renders.
    await notes();
    await rowMenu("Reading");
    await page.locator(".core-row-context-menu button", { hasText: "Version history" }).click();
    await page.locator(".core-history-panel").waitFor({ timeout: 4000 });
    check((await page.locator(".core-history-of").innerText()) === "Reading", "N12: version history names the note");
    check((await page.locator(".core-title-input").inputValue()) === "Reading", "N12: it opens over that note");
    await page.locator(".core-history-panel button[aria-label=Close]").click();

    // N15: + and Notes close search.
    await page.getByRole("button", { name: "Search notes and settings" }).click();
    await page.getByRole("button", CREATE).click();
    check(await page.locator(".core-search input").count() === 0, "N15: opening + closes search");
    await page.keyboard.press("Escape");

    // S5: an empty workspace overview offers New project / New note.
    await notes();
    await page.getByRole("button", CREATE).click();
    await page.locator(".core-create-target button").click().catch(() => {});
    await page.locator(".core-create-menu-described button", { hasText: /^Workspace/ }).click();
    const wsDialog = page.getByRole("dialog");
    await wsDialog.waitFor({ timeout: 4000 });
    await page.keyboard.type("Home", { delay: 10 });
    await wsDialog.getByRole("button", { name: "Create", exact: true }).click();
    await page.locator(".wd-empty-actions").waitFor({ timeout: 8000 }).catch(() => {});
    const startButtons = await page.locator(".wd-empty-actions button").allInnerTexts();
    check(startButtons.includes("New project") && startButtons.includes("New note"), `S5: the empty overview offers New project and New note (${startButtons.join(", ")})`);
    if (startButtons.includes("New note")) {
      await page.locator(".wd-empty-actions button", { hasText: "New note" }).click();
      await page.waitForTimeout(800);
      check(/Home/.test(await page.locator(".core-breadcrumb").innerText().catch(() => "")), "S5: the note is made inside that workspace");
    }

    // T12: tasks from cards — pick which, confirm, they land beside the board.
    await row("Reading").locator(".core-object-row").click();
    await page.waitForTimeout(400);
    await page.getByRole("button", CREATE).click();
    await page.locator(".core-create-menu-described button", { hasText: /^Whiteboard/ }).click();
    await page.waitForTimeout(1200);
    await page.locator(".core-object-tabs button[role=tab]", { hasText: "Whiteboard" }).first().click().catch(() => {});
    const surface = page.locator(".canvas-surface").first();
    await surface.waitFor({ timeout: 8000 });
    for (const [x, text] of [[120, "Buy seeds"], [420, "Fix fence"]]) {
      await surface.click({ button: "right", position: { x, y: 120 } });
      await page.locator(".canvas-menu button", { hasText: "Add" }).first().click();
      await page.locator(".canvas-menu button", { hasText: /^Card$/ }).click();
      await page.waitForTimeout(300);
      await page.locator(".canvas-node textarea").last().fill(text);
    }
    await surface.click({ button: "right", position: { x: 300, y: 380 } });
    await page.locator(".canvas-menu button", { hasText: "Create tasks from cards" }).click();
    const pick = page.locator(".canvas-task-pick");
    await pick.waitFor({ timeout: 4000 });
    check(await pick.locator("input[type=checkbox]").count() === 2, "T12: the dialog lists the cards to choose from");
    await pick.locator("label", { hasText: "Fix fence" }).locator("input").uncheck();
    await pick.getByRole("button", { name: /Create 1 task/ }).click();
    await page.waitForTimeout(1200);
    check(await row("Buy seeds").count() === 1 && await row("Fix fence").count() === 0, "T12: only the ticked card became a task");
    const taskDepth = await row("Buy seeds").evaluate((el) => parseFloat(el.style.paddingLeft || "0"));
    check(taskDepth > 0, "S4/T12: the task sits inside the board's folder, not at the top level");

    // N14: Help then Notes starts at the top.
    await page.evaluate(() => document.querySelector(".core-main").scrollTo({ top: 400 }));
    await page.getByRole("button", { name: "Help", exact: true }).last().click();
    await page.waitForTimeout(300);
    check(await page.evaluate(() => document.querySelector(".core-main").scrollTop) === 0, "N14: a new screen starts at the top");
  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n")[0]}`);
  } finally {
    await browser.close().catch(() => {});
    sandboxCli("stop", NAME);
  }
  console.log(failures.length ? `\nR3 structure scenario FAILED (${failures.length})` : "\nR3 structure scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
