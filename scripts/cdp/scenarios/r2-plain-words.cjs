// Scenario R2 (repair plan 01.10, Core 0.92.2 "Plain words and polish").
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/r2-plain-words.cjs
//
// One check per R2 item, in a fresh sandbox: + menu descriptions and the "All
// notes" header (S1), labels on + and search (S7), no developer words in
// Settings (G1–G6), one active nav item, no title jump and no stray scrollbar
// (G8, L8), Follow system / dropdown font / Compact density (G9), plurals
// (G12), toolbar names (N10), "Open on start" (N13), slash subtitles (E15),
// "Saved" (E23), the Market's official/community split, quiet Refresh and a
// centred install dialog with a secondary Cancel (M2, M3, M5), and Help's
// table of contents (L9). Needs a fresh `npm run sandbox:build`.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-r2-plain-words";
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };
const CREATE = { name: "Create a note, folder or project", exact: true };
const JARGON = /Core workspace|Core-side SQLite|dist-core|links_to|Name only|Core \+ plugins|Simple by default|plugins on\b|Test build/;

(async () => {
  const info = JSON.parse(sandboxCli("start", NAME, "--size", "1280x720"));
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  const settings = async (section) => {
    await page.getByRole("button", { name: "Settings", exact: true }).last().click();
    await page.locator(".core-settings-nav button", { hasText: section }).first().click();
    await page.waitForTimeout(350);
  };
  const mainText = () => page.locator(".core-main").innerText();
  try {
    // S7, S1
    const create = page.getByRole("button", CREATE);
    await create.waitFor({ timeout: 30000 });
    check(await page.getByRole("button", { name: "Search notes and settings" }).count() === 1, "S7: the search button has a name");
    check(await create.getAttribute("title") === "Create a note, folder or project", "S7: + has a tooltip that says what it makes");
    await create.click();
    const menu = page.locator(".core-create-menu-described");
    const descriptions = await menu.locator("small").allInnerTexts();
    check(descriptions.length >= 3 && descriptions.every((text) => text.trim().length > 5), `S1: every + menu item has a one-line description (${descriptions.length})`);
    const fits = await page.evaluate(() => {
      const sidebar = document.querySelector(".core-sidebar").getBoundingClientRect();
      const clipped = [...document.querySelectorAll(".core-create-menu-described button > span")].filter((span) => span.scrollWidth > span.clientWidth + 1 || span.getBoundingClientRect().right > sidebar.right).length;
      return { right: Math.round(document.querySelector(".core-create-menu-described").getBoundingClientRect().right), sidebar: Math.round(sidebar.right), clipped };
    });
    check(fits.right <= fits.sidebar && fits.clipped === 0, `S1: the + menu fits inside the sidebar, nothing cut off (menu ${fits.right}, sidebar ${fits.sidebar}, clipped ${fits.clipped})`);
    await menu.getByRole("button", { name: /New note/ }).click();
    await page.waitForTimeout(500);
    check((await page.locator(".core-list-heading span").first().innerText()).trim().toLowerCase() === "all notes", "S1: the sidebar header says All notes");

    // E23, G12: type one word, wait for "Saved", read the footer.
    await page.keyboard.press("Enter");
    await page.keyboard.type("Hello", { delay: 20 });
    const saved = await page.locator(".core-dirty.is-saved").waitFor({ timeout: 8000 }).then(() => true, () => false);
    check(saved, "E23: a brief \"Saved\" shows after the save lands");
    check(await page.locator(".core-dirty").evaluate((el) => getComputedStyle(el).color) !== "rgb(178, 97, 41)", "E23: the save status is not the warning colour");
    const footer = await page.locator(".core-editor-stats").innerText();
    check(/\b1 word\b/.test(footer) && !/\b1 words\b/.test(footer), `G12: "1 word", not "1 words" (${footer.split("\n").join(" · ")})`);

    // N10
    check(await page.getByRole("button", { name: "Move to trash" }).count() >= 1, "N10: the trash button has an accessible name");
    const unnamed = await page.locator(".core-editor-toolbar button").evaluateAll((buttons) => buttons.filter((b) => !(b.getAttribute("aria-label") || b.textContent.trim())).length);
    check(unnamed === 0, `N10: every toolbar button has a name (${unnamed} without)`);

    // E15: slash menu subtitles carry no plugin names.
    await page.keyboard.press("Enter");
    await page.keyboard.type("/", { delay: 30 });
    await page.locator(".core-slash-menu").waitFor({ timeout: 4000 });
    const subtitles = await page.locator(".core-slash-menu small").allInnerTexts();
    check(!subtitles.some((text) => /Tasks, Issues and Projects|Editor extensions|Whiteboard ·/.test(text)), "E15: no plugin names under slash commands");
    await page.keyboard.press("Escape");

    // N13
    await page.locator(".core-object-row").first().click({ button: "right" });
    check(await page.getByRole("button", { name: "Open on start" }).count() === 1, "N13: the row menu says Open on start");
    await page.keyboard.press("Escape");
    await page.mouse.click(700, 400);

    // N10: no "plain note editor" on a project.
    await create.click();
    await page.getByRole("button", { name: /^Project/ }).click();
    await page.locator(".cmp-confirm").click().catch(() => {});
    await page.waitForTimeout(600);
    check(await page.getByRole("button", { name: "Use plain note editor" }).count() === 0, "N10: projects do not offer the plain note editor");

    // G1/G8/L8: Settings words, one active item, no title jump, no scrollbar.
    const titleY = {};
    for (const section of ["Appearance", "Languages", "Editor", "Files & links", "Hotkeys", "Recovery", "Updates", "About"]) {
      await settings(section);
      const text = await mainText();
      const hit = text.match(JARGON);
      check(!hit, `G1: no developer words on ${section}${hit ? ` ("${hit[0]}")` : ""}`);
      check(await page.locator(".core-notice").evaluate((el) => getComputedStyle(el).position === "fixed").catch(() => true), `CE47: a notice floats instead of pushing ${section} down`);
      titleY[section] = await page.evaluate(() => Math.round(document.querySelector(".core-settings-section h2, .core-settings-detail h2")?.getBoundingClientRect().top ?? -1));
      const active = await page.locator(".core-settings-nav button.is-active").count();
      if (active !== 1) check(false, `G8: one active Settings item on ${section} (${active})`);
    }
    const ys = [...new Set(Object.values(titleY))];
    check(ys.length === 1, `G8: the Settings title does not jump between sections (${JSON.stringify(titleY)})`);
    await settings("About");
    check(await page.evaluate(() => { const m = document.querySelector(".core-main"); return m.scrollHeight <= m.clientHeight; }), "L8: no scrollbar when the page fits");
    check(await page.locator("details.core-about-technical").evaluate((el) => !el.open), "G1: About keeps developer facts under a closed Technical details");
    // hover a different nav item: still one item looks selected
    await page.locator(".core-settings-nav button", { hasText: "Languages" }).hover();
    const looksSelected = await page.locator(".core-settings-nav button").evaluateAll((buttons) => {
      const active = buttons.find((b) => b.classList.contains("is-active"));
      const hovered = buttons.find((b) => b.matches(":hover"));
      return getComputedStyle(active).backgroundColor !== getComputedStyle(hovered).backgroundColor;
    });
    check(looksSelected, "G8: the hovered item does not look like a second selected one");

    // G2, G3, G5
    await settings("Editor");
    check(await page.locator(".core-settings-detail .core-setting-value").count() === 0, "G2: Editor has no read-only value rows");
    await settings("Files & links");
    check((await mainText()).includes("Plugin permissions"), "G3: Files & links groups plugin permissions");
    const fontSizes = await page.locator(".core-settings-detail .core-setting-row small").evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).fontSize))]);
    check(fontSizes.length === 1, `G3/CE48: one description size on Files & links (${fontSizes.join(", ")})`);
    await settings("Hotkeys");
    const hotkeys = await mainText();
    check(!/notible\.[a-z-]+/.test(hotkeys), "G5: no plugin ids on Hotkeys");
    check(!/Install work models|Inspect code block|Ensure default view|Show properties status/.test(hotkeys), "G5: no internal commands on Hotkeys");
    check((hotkeys.match(/Create whiteboard/g) ?? []).length <= 1, "G5: Create whiteboard is listed once");
    check(!/\boff\b/.test(await page.locator(".core-plugin-hotkey-list").innerText().catch(() => "")), "G5: unassigned shows —, not off");

    // G6: Recovery
    await settings("Recovery");
    check(await page.getByRole("button", { name: "Open folder" }).count() === 0 || (await mainText()).includes("Latest:"), "G6: no Open folder while there are no backups");
    await page.getByRole("button", { name: "Create database backup" }).click();
    await page.waitForTimeout(1200);
    await page.locator("details.core-collection-disclosure summary").first().click();
    check(await page.locator(".core-collection-row").first().getByRole("button", { name: "Restore" }).count() === 1, "G6: a backup has a visible Restore button");
    check(!(await mainText()).includes("no note still references"), "G6: the cleanup sentence reads normally");

    // G4, G9
    await settings("Appearance");
    check(!/Language/.test(await page.locator(".core-settings-detail").innerText()), "G4: Appearance has no language row; language lives only in Languages");
    await page.locator("#core-theme").click();
    const options = await page.getByRole("option").allInnerTexts();
    check(options.some((text) => text.includes("Follow system")), `G9: Theme offers Follow system (${options.join(", ")})`);
    const sizes = await page.evaluate(() => ({ control: getComputedStyle(document.querySelector("#core-theme")).fontSize, option: getComputedStyle(document.querySelector('[role="option"]')).fontSize }));
    check(sizes.control === sizes.option, `G9: the dropdown list uses the control's font size (${sizes.control} / ${sizes.option})`);
    await page.getByRole("option", { name: "Follow system" }).click();
    check(await page.evaluate(() => localStorage.getItem("notible-core-theme")) === "system", "G9: Follow system is saved");
    const rowBefore = await page.locator(".core-setting-row").first().evaluate((el) => el.getBoundingClientRect().height);
    await page.locator("#core-density").click();
    await page.getByRole("option", { name: "Compact" }).click();
    await page.waitForTimeout(250);
    const rowAfter = await page.locator(".core-setting-row").first().evaluate((el) => el.getBoundingClientRect().height);
    check(rowAfter < rowBefore - 6, `G9/D13: Compact is visibly tighter (row ${Math.round(rowBefore)} → ${Math.round(rowAfter)} px)`);
    await page.locator("#core-density").click();
    await page.getByRole("option", { name: "Comfortable" }).click();

    // M2, M3, M5: Market
    await settings("Plugins");
    check(/\d+ of \d+ turned on/.test(await mainText()), "G1: \"N of M turned on\"");
    await page.getByRole("tab", { name: "Market" }).click();
    const refresh = page.getByRole("button", { name: "Refresh the market" });
    check(await refresh.count() === 1 && !(await refresh.getAttribute("class")).includes("core-button"), "M5: Refresh is a quiet icon button");
    await page.locator(".core-plugin-index-row").first().waitFor({ timeout: 30000 });
    check(await page.locator(".core-matrix-category-heading", { hasText: "Official" }).count() === 1, "M2: official plugins have their own section");
    const communityNote = await page.locator(".core-plugin-index-note", { hasText: "Community plugins" }).count();
    const communityRows = await page.locator(".core-matrix-category-heading", { hasText: "Community" }).count();
    check(communityNote === communityRows, "M2: the community warning only shows over community plugins");
    await page.locator(".core-plugin-index-row", { hasText: "Graph" }).first().click().catch(async () => { await page.locator(".core-plugin-index-row").first().click(); });
    const install = page.locator(".core-plugins-detail-pane").getByRole("button", { name: /^Install/ }).first();
    if (await install.count()) {
      await install.click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ timeout: 4000 });
      const geo = await dialog.evaluate((el) => { const r = el.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: innerWidth, h: innerHeight }; });
      check(Math.abs(geo.cx - geo.w / 2) < 40 && Math.abs(geo.cy - geo.h / 2) < 80, `M3: the install dialog is centred (${Math.round(geo.cx)},${Math.round(geo.cy)} in ${geo.w}×${geo.h})`);
      const backgrounds = await dialog.locator("button").evaluateAll((buttons) => buttons.map((b) => getComputedStyle(b).backgroundColor));
      check(new Set(backgrounds).size === 2, `M3: Cancel and Install look different (${backgrounds.join(" / ")})`);
      await dialog.getByRole("button", { name: "Cancel" }).click();
    } else {
      check(false, "M3: could not find an Install button to open the dialog");
    }

    // L9: Help
    await page.getByRole("button", { name: "Help", exact: true }).last().click();
    await page.locator(".core-help").waitFor();
    const duplicates = await page.locator(".core-help-chapter").evaluateAll((chapters) => chapters.filter((chapter) => {
      const title = chapter.querySelector(".core-help-chapter-title")?.textContent?.trim();
      const pages = [...chapter.querySelectorAll("button")].map((b) => b.textContent.trim());
      return title && pages.length === 1 && pages[0] === title;
    }).length);
    check(duplicates === 0, `L9: no "Group > same name" in Help's contents (${duplicates})`);
    // Marked by an accent outline and bold text, not a filled ribbon (Help review 02.10, H-LOOK-02).
    check(await page.locator(".core-help-toc button.is-active").evaluate((el) => { const s = getComputedStyle(el); return s.borderTopColor !== "rgba(0, 0, 0, 0)" && s.borderTopWidth === "1px" && Number(s.fontWeight) >= 600; }), "L9: the active Help topic is marked strongly (outline, bold)");

    // L8: the empty state wraps without an orphan word.
    await page.locator(".core-back-button").click();
    check(await page.evaluate(() => { const p = document.querySelector(".core-editor-empty p"); return !p || getComputedStyle(p).textWrap.includes("balance"); }), "L8: the empty-state text is balanced");
  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n")[0]}`);
  } finally {
    await browser.close().catch(() => {});
    sandboxCli("stop", NAME);
  }
  console.log(failures.length ? `\nR2 plain words scenario FAILED (${failures.length})` : "\nR2 plain words scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
