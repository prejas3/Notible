// CODE-LOOK (Hive #32): Settings → Appearance → Code blocks. Defaults are today's look, each control
// changes a code block live, the choice survives a reload, Reset brings today's look back, and the
// caret moves right on a long line in both wrap and scroll mode. Screenshots in both themes.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/code-look.cjs
//   SIZE=1920x1080 ... for the large-screen shots.
//
// Needs a fresh `npm run sandbox:build`. Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-code-look";
const SIZE = process.env.SIZE || "1024x700";
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };
const LONG = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");

(async () => {
  const info = JSON.parse(sandboxCli("start", NAME, "--size", SIZE));
  // Not info.exports: the sandbox data (and its exports) is deleted on stop.
  const shots = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "notible-code-look-"));
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  const shot = (name) => page.screenshot({ path: path.join(shots, `${SIZE}-${name}.png`) });
  const type = (text) => page.keyboard.type(text, { delay: 20 });
  const code = () => page.locator("[contenteditable=true] pre.core-code-block code").first();
  const look = () => code().evaluate((el) => { const s = getComputedStyle(el); return { size: s.fontSize, lineHeight: s.lineHeight, whiteSpace: s.whiteSpace, tabSize: s.tabSize }; });
  // Characters before the caret inside the code block.
  const caret = () => code().evaluate((el) => {
    const selection = window.getSelection();
    if (!selection.rangeCount || !el.contains(selection.anchorNode)) return null;
    const range = document.createRange();
    range.setStart(el, 0);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return range.toString().replace(/​/g, "").length;
  });
  const openAppearance = async () => {
    await page.getByRole("button", { name: "Settings", exact: true }).last().click();
    await page.locator(".core-settings-nav button", { hasText: "Appearance" }).first().click();
    await page.locator("#core-code-size").waitFor();
  };
  const pick = async (id, option) => {
    await page.locator(id).scrollIntoViewIfNeeded();
    await page.locator(id).click();
    await page.getByRole("option", { name: option, exact: true }).click();
    await page.waitForTimeout(250);
  };
  const backToNote = async () => {
    await page.keyboard.press("Escape");
    await page.locator(".core-object-row", { hasText: "Code look" }).first().click().catch(() => {});
    await code().waitFor();
    await page.waitForTimeout(400);
  };
  // Caret at line start, End, Down, Up: offsets must stay on the right logical line.
  const caretWalk = async (label) => {
    await code().click({ position: { x: 14, y: 16 } });
    await page.keyboard.press("Home");
    await page.keyboard.press("End");
    const endAt = await caret();
    await page.keyboard.press("ArrowDown");
    const downAt = await caret();
    await page.keyboard.press("ArrowUp");
    const upAt = await caret();
    return { label, endAt, downAt, upAt };
  };

  try {
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).click();
    await page.getByRole("button", { name: "New note" }).first().click();
    await page.locator(".core-title-input").waitFor();
    await page.waitForTimeout(300);
    await type("Code look");
    await page.keyboard.press("Enter");
    await type("/code");
    await page.locator(".core-slash-menu [role=option]", { hasText: "Code block" }).first().waitFor();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    await code().click();
    await type(LONG);
    await page.keyboard.press("Enter");
    await type("short line");
    await page.waitForTimeout(900);

    const before = await look();
    check(JSON.stringify(before) === JSON.stringify({ size: "13px", lineHeight: "20.15px", whiteSpace: "pre-wrap", tabSize: "8" }), "defaults are today's look", JSON.stringify(before));
    const wrapped = await caretWalk("wrap");
    check(wrapped.endAt !== null && wrapped.endAt <= LONG.length && wrapped.downAt <= LONG.length + 1 + "short line".length && wrapped.upAt <= LONG.length, "wrap: End/Down/Up keep the caret in the block", JSON.stringify(wrapped));
    await shot("01-default");

    await openAppearance();
    check(await page.locator(".core-settings-section input[type=range], .core-settings-section select").count() === 0, "no native range/select controls");
    await pick("#core-code-size", "16 px");
    await pick("#core-code-line-height", "1.9");
    await pick("#core-code-wrap", "Scroll sideways");
    await pick("#core-code-tab-size", "4");
    await page.locator(".core-code-look-heading").scrollIntoViewIfNeeded();
    await shot("02-settings-daylight");
    await backToNote();
    const changed = await look();
    check(JSON.stringify(changed) === JSON.stringify({ size: "16px", lineHeight: "30.4px", whiteSpace: "pre", tabSize: "4" }), "each control changes the code block live", JSON.stringify(changed));
    const scrolled = await caretWalk("scroll");
    check(scrolled.endAt === LONG.length, "scroll: End goes to the end of the long line", JSON.stringify(scrolled));
    check(await code().evaluate((el) => el.scrollLeft > 0), "scroll: the block scrolls to show the caret at the line end");
    check(scrolled.downAt > LONG.length && scrolled.downAt <= LONG.length + 1 + "short line".length, "scroll: Down moves to the next line", JSON.stringify(scrolled));
    check(scrolled.upAt <= LONG.length, "scroll: Up moves back to the long line", JSON.stringify(scrolled));
    await shot("03-scroll-daylight");

    await openAppearance();
    await pick("#core-theme", "Midnight");
    await page.locator(".core-code-look-heading").scrollIntoViewIfNeeded();
    await shot("04-settings-midnight");
    await backToNote();
    await shot("05-scroll-midnight");

    // Reload: the choice is read back from storage. Not a sandbox restart: `stop` kills the process
    // tree before WebView2 writes localStorage to disk, which loses every local pref (theme too).
    await page.reload();
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).waitFor({ timeout: 30000 });
    await page.locator(".core-object-row", { hasText: "Code look" }).first().click();
    await code().waitFor();
    const restarted = await look();
    check(JSON.stringify(restarted) === JSON.stringify(changed), "the choice survives a reload", JSON.stringify(restarted));

    await openAppearance();
    await page.locator(".core-code-look-heading").getByRole("button", { name: "Reset" }).click();
    check(await page.locator(".core-code-look-heading").getByRole("button", { name: "Reset" }).isDisabled(), "Reset is disabled at the defaults");
    await backToNote();
    const reset = await look();
    check(JSON.stringify(reset) === JSON.stringify(before), "Reset brings today's look back", JSON.stringify(reset));
    check(await page.evaluate(() => ["--core-code-size", "--core-code-line-height", "--core-code-wrap", "--core-code-tab-size"].every((name) => !document.documentElement.style.getPropertyValue(name))), "defaults write no CSS variables");
  } catch (error) {
    check(false, "scenario ran to the end", error instanceof Error ? error.stack : String(error));
    await shot("zz-failure").catch(() => {});
  } finally {
    await browser.close();
    if (!process.env.KEEP) sandboxCli("stop", NAME);
    console.log(`shots: ${shots}`);
    console.log(failures.length ? `\n${failures.length} failure(s)` : "\nall checks passed");
    process.exitCode = failures.length ? 1 : 0;
  }
})();
