// Scenario: the Help review of 02.10 (Codex, Notible-feedback/2026-10-02-codex-help), at a small and a
// full window, both themes.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/help-review.cjs [--shots <dir>]
//
// Code blocks look like a note's (one outlined box, a quiet bar, no "text" label) and Copy works;
// the active contents item is outlined, not a filled ribbon; on a small window the contents drop down
// over the article and close on Escape; shortcut keys are keycaps; recordings follow the theme.
// Needs a fresh `npm run sandbox:build`. Exit 1 on failure.
const { execFileSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-help-review";
const shotsAt = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message) => { console.log(`${ok ? "PASS" : "FAIL"} ${message}`); if (!ok) failures.push(message); };
const CREATE = { name: "Create a note, folder or project", exact: true };

(async () => {
  let browser;
  try {
    for (const [size, theme] of [["1024x700", "paper"], ["1024x700", "night"], ["1920x1080", "paper"], ["1920x1080", "night"]]) {
      const tag = `${size}-${theme}`;
      const info = JSON.parse(sandboxCli("start", NAME, "--size", size, ...(tag === "1024x700-paper" ? [] : ["--reuse"])));
      browser = await chromium.connectOverCDP(info.cdp);
      const page = browser.contexts()[0].pages()[0];
      await page.getByRole("button", CREATE).waitFor({ timeout: 30000 });
      await page.evaluate((value) => localStorage.setItem("notible-core-theme", value), theme);
      await page.reload();
      await page.getByRole("button", CREATE).waitFor({ timeout: 30000 });
      const small = size === "1024x700";
      const shot = async (name) => { if (shotsAt) await page.screenshot({ path: path.join(shotsAt, `${tag}-${name}.png`) }); };
      const openPage = async (title) => {
        if (small) await page.locator(".core-help-contents-toggle").click();
        await page.locator(".core-help-toc button", { hasText: title }).first().click();
        await page.locator(".core-help-title", { hasText: title }).waitFor();
        await page.waitForTimeout(300);
      };

      await page.getByRole("button", { name: "Help", exact: true }).last().click();
      await page.locator(".core-help-title").waitFor();

      // Small window: the contents drop over the article instead of pushing it down.
      if (small) {
        await page.waitForTimeout(600);
        const before = await page.locator(".core-help-title").evaluate((el) => el.getBoundingClientRect().top);
        await page.locator(".core-help-contents-toggle").click();
        const drawer = await page.evaluate(() => { const toc = document.querySelector(".core-help-toc"); const style = getComputedStyle(toc); const r = toc.getBoundingClientRect(); return { position: style.position, scrolls: style.overflowY, bottom: r.bottom, title: document.querySelector(".core-help-title").getBoundingClientRect().top }; });
        check(drawer.position === "absolute" && drawer.bottom <= 700 && Math.abs(drawer.title - before) < 2, `[${tag}] Contents drop down over the article, fit the window and don't move it (H-LOOK-03) ${JSON.stringify({ ...drawer, before })}`);
        await shot("contents-open");
        await page.keyboard.press("Escape");
        check(await page.locator(".core-help-toc").evaluate((el) => getComputedStyle(el).display === "none"), `[${tag}] Escape closes the contents`);
      }

      // Code block: one outlined box like a note's, no "text" label, a quiet Copy that works.
      await openPage("Embedded queries");
      const code = await page.evaluate(() => {
        const pre = document.querySelector(".core-help-body pre");
        const lang = pre.querySelector(".core-code-lang");
        const copy = pre.querySelector(".core-code-copy");
        const pick = (el) => { const s = getComputedStyle(el); return { border: s.borderTopWidth, bg: s.backgroundColor, visible: s.visibility }; };
        return { pre: pick(pre), radius: getComputedStyle(pre).borderTopLeftRadius, lang: pick(lang), copy: pick(copy) };
      });
      check(code.pre.border === "1px" && code.radius === "8px", `[${tag}] the code block is one outlined box (H-LOOK-01) ${JSON.stringify(code.pre)}`);
      check(code.lang.visible === "hidden", `[${tag}] a plain-text block shows no "text" label`);
      check(code.copy.border === "0px" && code.copy.bg === "rgba(0, 0, 0, 0)", `[${tag}] Copy is a quiet, borderless action ${JSON.stringify(code.copy)}`);
      await page.locator(".core-help-body .core-code-copy").first().click();
      check(await page.locator(".core-help-body .core-code-copy").first().innerText() === "Copied", `[${tag}] Copy works in Help and says Copied`);
      check(/Live list of matching items/.test(await page.locator(".core-help-body").innerText()), `[${tag}] the page says "matching items", not "objects" (H-LOOK-05)`);
      await shot("code-block");

      // Active contents item: an outline, no fill and no ribbon (H-LOOK-02).
      if (small) await page.locator(".core-help-contents-toggle").click();
      const active = await page.locator(".core-help-toc button.is-active").evaluate((el) => { const s = getComputedStyle(el); return { shadow: s.boxShadow, bg: s.backgroundColor, border: s.borderTopColor, accent: getComputedStyle(document.querySelector(".core-help-link") ?? el).color }; });
      check(active.shadow === "none" && active.bg === "rgba(0, 0, 0, 0)" && active.border !== "rgba(0, 0, 0, 0)", `[${tag}] the active page is outlined, no fill, no ribbon ${JSON.stringify(active)}`);
      await shot("contents-active");
      if (small) await page.keyboard.press("Escape");

      // Shortcut keys are keycaps, like Settings → Hotkeys (H-LOOK-04).
      await openPage("Commands and shortcuts");
      const caps = await page.locator(".core-help-body table .core-hotkey-caps").count();
      check(caps >= 11, `[${tag}] the shortcut table shows keys as keycaps (${caps})`);
      await shot("shortcuts");

      // Recordings follow the theme (H-LOOK-07).
      await openPage("Whiteboard");
      const src = await page.locator(".core-help-body video").first().evaluate((el) => ({ src: el.currentSrc || el.src, ready: el.readyState }));
      await page.waitForTimeout(800);
      const ready = await page.locator(".core-help-body video").first().evaluate((el) => el.readyState);
      check((theme === "night" ? /\.dark\.webm$/u : /(?<!\.dark)\.webm$/u).test(src.src) && ready > 0, `[${tag}] the Whiteboard recording matches the theme and loads (${src.src.split("/").pop()}, ready ${ready})`);
      await shot("whiteboard");

      await browser.close().catch(() => {});
      browser = null;
      sandboxCli("stop", NAME, "--keep");
    }

  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n")[0]}`);
  } finally {
    await browser?.close().catch(() => {});
    sandboxCli("stop", NAME);
  }
  console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nHelp review scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
