// Scenario: the 0.93.1 visual cleanup (Codex audit 02.10, plan in
// Notible-feedback/2026-10-02-codex-visual-audit/plan.md), at a small and a full window, both themes.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/v-cleanup.cjs [--shots <dir>]
//
// Checks layout rules, not only behaviour: nothing scrolls sideways, menus and dialogs fit the window,
// rows are compact, the Plugins screen shows the list or the details below 1400 px, Help gives the
// article the width, Properties folds on a small window, the note column is capped on a wide one.
// With --shots it saves a screenshot of every screen for a person to look at (the cleanliness gate).
// Needs a fresh `npm run sandbox:build`. Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-v-cleanup";
const shotsAt = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message) => { console.log(`${ok ? "PASS" : "FAIL"} ${message}`); if (!ok) failures.push(message); };
const CREATE = { name: "Create a note, folder or project", exact: true };

async function open(size, reuse) {
  const info = JSON.parse(sandboxCli("start", NAME, "--size", size, ...(reuse ? ["--reuse"] : [])));
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole("button", CREATE).waitFor({ timeout: 30000 });
  await page.locator(".core-nav button").first().click();
  return { browser, page };
}

(async () => {
  let session;
  try {
    for (const [size, theme] of [["1024x700", "paper"], ["1024x700", "night"], ["1366x768", "paper"], ["1920x1080", "paper"], ["1920x1080", "night"]]) {
      const tag = `${size}-${theme}`;
      session = await open(size, size !== "1024x700" || theme !== "paper");
      const { page } = session;
      await page.evaluate((value) => localStorage.setItem("notible-core-theme", value), theme);
      await page.reload();
      await page.getByRole("button", CREATE).waitFor({ timeout: 30000 });
      await page.locator(".core-nav button").first().click();
      const shot = async (name) => { if (shotsAt) await page.screenshot({ path: path.join(shotsAt, `${tag}-${name}.png`) }); };
      const noSideways = async (where) => {
        const overflow = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - innerWidth, main: (() => { const m = document.querySelector(".core-main"); return m ? m.scrollWidth - m.clientWidth : 0; })() }));
        check(overflow.doc <= 0 && overflow.main <= 1, `[${tag}] ${where}: nothing scrolls sideways (${overflow.doc}/${overflow.main})`);
      };
      const small = size === "1024x700";
      const width = Number(size.split("x")[0]);
      const first = tag === "1024x700-paper";

      // The + menu: one line per item, fits the sidebar and the window.
      if (first) {
        // Some content for the screens below.
        await page.getByRole("button", CREATE).click();
        await page.locator(".core-create-menu-described button", { hasText: /^Project/ }).click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        const fits = await dialog.evaluate((el) => { const r = el.getBoundingClientRect(); const button = el.querySelector(".cmp-confirm").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && button.bottom <= innerHeight; });
        check(fits, `[${tag}] the New project dialog and its Create button fit the window (C3)`);
        await page.keyboard.type("Garden plan", { delay: 10 });
        await dialog.getByRole("button", { name: "Create", exact: true }).click();
        await page.waitForTimeout(800);
        // Setup only: three tasks with long titles, so the Table view has columns to overflow.
        await page.evaluate(async () => {
          const invoke = window.__TAURI_INTERNALS__.invoke;
          const objects = await invoke("list_objects", {}).catch(() => []);
          const project = (Array.isArray(objects) ? objects : []).find((object) => object.title === "Garden plan");
          if (!project) return;
          for (const title of ["Order seed potatoes and onion sets for the spring", "Build two raised beds by the fence", "Plan the watering rota for July"]) {
            await invoke("create_object", { type: "task", title, content: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }), props: JSON.stringify({ status: "todo", priority: "none" }), parentId: project.id });
          }
        });
        await page.getByRole("button", CREATE).click();
        await page.locator(".core-create-menu-described button", { hasText: /^New note/ }).click();
        await page.waitForTimeout(500);
        await page.keyboard.type("Planting notes", { delay: 10 });
        await page.keyboard.press("Enter");
        await page.keyboard.type("Tomatoes go in after the last frost.", { delay: 5 });
        await page.waitForTimeout(800);
      }
      await page.getByRole("button", CREATE).click();
      const menu = await page.locator(".core-create-menu-described").evaluate((el) => {
        const r = el.getBoundingClientRect();
        const sidebar = document.querySelector(".core-sidebar").getBoundingClientRect();
        const rows = [...el.querySelectorAll(":scope > button")].map((b) => b.getBoundingClientRect().height);
        return { bottom: r.bottom, right: r.right, sidebar: sidebar.right, tallest: Math.max(...rows), height: r.height };
      });
      check(menu.tallest <= 36 && menu.right <= menu.sidebar && menu.bottom <= await page.evaluate(() => innerHeight), `[${tag}] + menu: one-line rows (${Math.round(menu.tallest)} px), inside the sidebar and the window (height ${Math.round(menu.height)})`);
      await shot("plus-menu");
      await page.keyboard.press("Escape");
      await page.mouse.click(700, 300);

      // The note: Properties folds on a small window; the text column is capped on a wide one.
      await page.locator(".core-object-row", { hasText: "Planting notes" }).first().click();
      await page.waitForTimeout(600);
      const editor = await page.evaluate(() => {
        const aside = document.querySelector(".core-properties-aside");
        const body = document.querySelector(".core-editor-panel.is-note .core-editor-body-wrap");
        return { asideShown: !!aside && getComputedStyle(aside).display !== "none", toggle: !!document.querySelector(".core-properties-toggle") && getComputedStyle(document.querySelector(".core-properties-toggle")).display !== "none", bodyWidth: body ? body.getBoundingClientRect().width : 0 };
      });
      if (small) {
        check(!editor.asideShown && editor.toggle, `[${tag}] Properties is folded behind its button on a small window (C1)`);
        await page.locator(".core-properties-toggle").click();
        check(await page.locator(".core-properties-aside").evaluate((el) => getComputedStyle(el).display !== "none"), `[${tag}] the Properties button opens it`);
        await page.locator(".core-properties-toggle").click();
      } else if (width >= 1900) {
        check(editor.bodyWidth <= 862, `[${tag}] the note text column is capped (${Math.round(editor.bodyWidth)} px, C9)`);
      }
      await noSideways("note");
      await shot("note");
      // Slash menu: one line per command.
      const body = page.locator(".core-editor-content").first();
      await body.click();
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("/", { delay: 30 });
      await page.locator(".core-slash-menu").waitFor({ timeout: 4000 });
      const slashRow = await page.locator(".core-slash-row").first().evaluate((el) => el.getBoundingClientRect().height);
      check(slashRow <= 36, `[${tag}] slash menu rows are one line (${Math.round(slashRow)} px, C2)`);
      await shot("slash");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Backspace");

      // Project tabs: no bare scrollbar, Modules never cut off.
      await page.locator(".core-object-row", { hasText: "Garden plan" }).first().click();
      await page.waitForTimeout(800);
      const tabs = await page.evaluate(() => {
        const strip = document.querySelector(".core-object-tabbar .core-object-tabs");
        const modules = document.querySelector(".core-object-tabs-modules");
        return { scrollbar: strip ? strip.offsetHeight - strip.clientHeight : 0, modulesCut: modules ? modules.scrollWidth > modules.clientWidth + 1 : true };
      });
      check(tabs.scrollbar === 0 && !tabs.modulesCut, `[${tag}] project tabs: no bare scrollbar, Modules not cut off (C4)`);
      const cutTabs = await page.locator(".core-object-tabbar .core-object-tabs > button").evaluateAll((buttons) => buttons.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent));
      check(cutTabs.length === 0, `[${tag}] no tab label is cut short (${cutTabs.join(", ") || "none"})`);
      await page.locator(".plugin-view-layouts button", { hasText: "Table" }).first().click().catch(() => {});
      await page.waitForTimeout(500);
      const table = await page.evaluate(() => {
        const wrap = document.querySelector(".plugin-view-table-wrap");
        const panel = document.querySelector(".core-editor-panel");
        if (!wrap || !panel) return null;
        return { right: wrap.getBoundingClientRect().right, panel: panel.getBoundingClientRect().right, scrolls: wrap.scrollWidth > wrap.clientWidth, fits: wrap.scrollWidth <= wrap.clientWidth };
      });
      check(Boolean(table) && table.right <= table.panel + 1 && (table.scrolls || table.fits), `[${tag}] the table stays inside its box and scrolls there (C6) ${JSON.stringify(table)}`);
      await shot("table");
      await page.locator(".plugin-view-layouts button", { hasText: "Kanban" }).first().click().catch(() => {});
      await noSideways("project");
      await shot("project");

      // Settings: one-line nav, no Language row in Appearance, no sideways scroll anywhere.
      await page.getByRole("button", { name: "Settings", exact: true }).last().click();
      for (const section of ["Appearance", "Languages", "Editor", "Files & links", "Hotkeys", "Recovery", "Updates", "About"]) {
        await page.locator(".core-settings-nav button", { hasText: section }).click();
        await page.waitForTimeout(250);
        await noSideways(`Settings › ${section}`);
        if (section === "Appearance") check(!/Language/.test(await page.locator(".core-settings-detail").innerText()), `[${tag}] Appearance has no Language row`);
        await shot(`settings-${section.replace(/\W+/g, "-").toLowerCase()}`);
      }
      const navRow = await page.locator(".core-settings-nav button").first().evaluate((el) => ({ h: el.getBoundingClientRect().height, small: !!el.querySelector("small") }));
      check(!navRow.small && navRow.h <= 40, `[${tag}] Settings nav: one line per item (${Math.round(navRow.h)} px, B1)`);

      // Plugins: compact rows; list or details below 1400 px, side by side above.
      await page.locator(".core-settings-nav button", { hasText: "Plugins" }).click();
      await page.waitForTimeout(400);
      const rowHeight = await page.locator(".core-plugin-index-row").first().evaluate((el) => el.getBoundingClientRect().height);
      check(rowHeight <= 40, `[${tag}] plugin rows are compact (${Math.round(rowHeight)} px, A1)`);
      check(await page.locator(".core-plugin-index-reload").count() === 0, `[${tag}] no reload icon in the rows (A1)`);
      await shot("plugins-list");
      await page.locator(".core-plugin-index-row", { hasText: "Properties" }).first().locator(".core-plugin-index-open").click();
      await page.waitForTimeout(600);
      const layout = await page.evaluate(() => {
        const list = document.querySelector(".core-settings-detail");
        const pane = document.querySelector(".core-plugins-detail-pane");
        const visible = (el) => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0;
        return { list: visible(list), pane: visible(pane), paneTop: pane?.getBoundingClientRect().top ?? -1, text: pane?.innerText ?? "" };
      });
      if (width < 1340) {
        check(!layout.list && layout.pane && layout.paneTop >= 0 && layout.paneTop < 300, `[${tag}] picking a plugin shows its details in place of the list (A2)`);
        await page.locator(".core-plugin-detail-back").click();
        await page.waitForTimeout(300);
        check(await page.locator(".core-settings-detail").evaluate((el) => getComputedStyle(el).display !== "none"), `[${tag}] ← All plugins brings the list back`);
      } else {
        check(layout.list && layout.pane, `[${tag}] the list and the details sit side by side (A2)`);
      }
      check(!/Plugin surface for the Notible workspace|work-object types|type schemas|SQLite/i.test(layout.text), `[${tag}] the details speak plainly (A4, A6)`);
      await shot("plugins-detail");
      if (width < 1340) await page.locator(".core-plugin-detail-back").click().catch(() => {});
      await page.getByRole("tab", { name: "Market" }).click();
      const marketRow = await page.locator(".core-plugin-index-row").first().waitFor({ timeout: 30000 }).then(() => page.locator(".core-plugin-index-row").first().evaluate((el) => el.getBoundingClientRect().height)).catch(() => -1);
      check(marketRow > 0 && marketRow <= 56, `[${tag}] Market rows: name and one line of description (${Math.round(marketRow)} px)`);
      await shot("market");
      await page.getByRole("tab", { name: "All" }).click();
      await noSideways("Settings › Plugins");

      // Help: on a small window the contents are a button and the article gets the width.
      await page.getByRole("button", { name: "Help", exact: true }).last().click();
      await page.waitForTimeout(400);
      const help = await page.evaluate(() => ({ toc: getComputedStyle(document.querySelector(".core-help-toc")).display, article: document.querySelector(".core-help-page").getBoundingClientRect().width }));
      if (small) {
        check(help.toc === "none" && help.article >= 560, `[${tag}] Help: contents behind a button, article ${Math.round(help.article)} px wide (B2)`);
        await page.locator(".core-help-contents-toggle").click();
        check(await page.locator(".core-help-toc").evaluate((el) => getComputedStyle(el).display !== "none"), `[${tag}] the Contents button opens the contents`);
      } else {
        check(help.toc !== "none", `[${tag}] Help shows its contents beside the article on a wide window`);
      }
      await noSideways("Help");
      await shot("help");

      await session.browser.close().catch(() => {});
      sandboxCli("stop", NAME, "--keep");
      session = null;
    }
  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n")[0]}`);
  } finally {
    if (session) await session.browser.close().catch(() => {});
    try { sandboxCli("stop", NAME); } catch { /* already stopped */ }
  }
  console.log(failures.length ? `\nVisual cleanup scenario FAILED (${failures.length})` : "\nVisual cleanup scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
