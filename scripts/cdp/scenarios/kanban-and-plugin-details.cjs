// Scenario: the Kanban has a fixed height, and Settings →
// Plugins keeps the selected plugin's details in view on a short window.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/kanban-and-plugin-details.cjs
//
// Needs a fresh `npm run sandbox:build`. Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-kanban-details";
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };

(async () => {
  // A short window, like the one in the bug report. Sized natively: CDP resizing
  // only resized the WebView, so the app drew outside its window (01.10).
  const info = JSON.parse(sandboxCli("start", NAME, "--size", "1460x740"));
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  try {
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).waitFor({ timeout: 30000 });
    const size = await page.evaluate(() => ({ outer: outerHeight, inner: innerHeight }));
    check(size.inner < 760, `the window is short (${size.inner}px inside)`);

    // Settings → Plugins: pick the last plugin in the list.
    await page.getByRole("button", { name: "Settings", exact: true }).last().click();
    await page.getByRole("button", { name: /^Plugins/ }).click();
    await page.waitForTimeout(400);
    const rows = page.locator(".core-plugin-index-row");
    await rows.last().scrollIntoViewIfNeeded();
    await rows.last().click();
    await page.waitForTimeout(800); // a smooth scroll may run
    const pane = await page.evaluate(() => { const r = document.querySelector(".core-plugins-detail-pane").getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: innerHeight }; });
    check(pane.top >= 0 && pane.top < pane.height - 100, `the plugin's details are in view after picking the last plugin (top ${pane.top} of ${pane.height})`);

    // Kanban: a project with 24 tasks in one column.
    await page.getByRole("button", { name: "Back" }).click().catch(() => {});
    await page.getByRole("button", { name: "Notes", exact: true }).first().click();
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).click();
    await page.getByRole("button", { name: /^Project/ }).click();
    await page.locator(".cmp-confirm").click();
    await page.waitForTimeout(400);
    await page.locator(".core-title-input").click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Board height", { delay: 10 });
    // An empty project shows its board columns (R4 T1), so tasks start from "+ New".
    for (let i = 1; i <= 24; i += 1) {
      await page.getByRole("button", { name: "+ New", exact: true }).click();
      const title = page.locator("input[required]:visible");
      await title.waitFor();
      await title.click();
      await page.keyboard.type(`Task ${i}`, { delay: 4 });
      await page.locator("button:visible").filter({ hasText: /^Create$/ }).last().click();
      await page.waitForTimeout(80);
    }
    await page.getByRole("button", { name: "Kanban", exact: true }).first().click().catch(() => {});
    await page.locator(".plugin-view-kanban").first().waitFor();
    const board = await page.evaluate(() => {
      const el = document.querySelector(".plugin-view-kanban");
      el.scrollIntoView({ block: "start" });
      const r = el.getBoundingClientRect();
      const tallest = Math.max(...[...el.querySelectorAll(".plugin-view-kanban-col")].map((col) => col.scrollHeight));
      return { height: Math.round(r.height), bottom: Math.round(r.bottom), viewport: innerHeight, tallest, rail: Boolean(document.querySelector(".plugin-view-kanban-rail")) };
    });
    check(board.tallest > board.height, `the column holds more than the board shows (column ${board.tallest}px, board ${board.height}px)`);
    check(board.bottom <= board.viewport, `the whole board, with its sideways scrollbar, fits in the window (bottom ${board.bottom} of ${board.viewport})`);
    check(!board.rail, "the old scrollbar rail is gone");
  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n")[0]}`);
  } finally {
    await browser.close().catch(() => {});
    sandboxCli("stop", NAME);
  }
  console.log(failures.length ? `\nKanban and plugin details scenario FAILED (${failures.length})` : "\nKanban and plugin details scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
