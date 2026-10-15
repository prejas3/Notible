// Scenario for the Codex round 3 findings (01.10): fast typing right after an
// insertion, menus and the format bar near the bottom edge.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/round3-regressions.cjs
//
// Needs a fresh `npm run sandbox:build`. Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-round3";
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };

(async () => {
  const info = JSON.parse(sandboxCli("start", NAME));
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  const editor = page.locator("[contenteditable=true]").first();
  const fast = (text) => page.keyboard.type(text, { delay: 5 });

  async function newNote(title) {
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).click();
    await page.getByRole("button", { name: "New note" }).first().click();
    await page.locator(".core-title-input").waitFor();
    await page.waitForTimeout(300);
    await fast(title);
    await page.keyboard.press("Enter");
  }
  /** The note's Markdown as "Download as Markdown" writes it (see r1b-text-integrity.cjs). */
  async function savedMarkdown() {
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.__exported = null;
      if (window.__exportHooked) return;
      window.__exportHooked = true;
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { if (blob instanceof Blob && blob.type === "text/markdown") window.__exported = blob.text(); return create(blob); };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) return; return click.call(this); };
    });
    await page.getByRole("button", { name: "Download as Markdown (.md)" }).click();
    const text = await page.evaluate(() => window.__exported);
    return text == null ? "<no export>" : text.replace(/\r\n/g, "\n").replace(/^# .*\n+/, "").trim();
  }

  try {
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).waitFor({ timeout: 30000 });

    // Typing at once after "/Code block": was saved as `tion … }func`.
    await newNote("R3 code");
    await fast("/code block");
    await page.keyboard.press("Enter");
    await fast("function greet() {");
    const code = await savedMarkdown();
    // "{" auto-closes to "{}", so the typed line ends with "}".
    check(code === "```\nfunction greet() {}\n```", "typing straight after /Code block stays in order", JSON.stringify(code));

    // Six [[ picks in one sentence: was `[[Research archive ]informs …]]]]]`.
    const targets = ["Alpha notes", "Beta notes", "Gamma notes", "Delta notes", "Epsilon notes", "Zeta notes"];
    for (const title of targets) await newNote(title);
    await newNote("R3 links");
    // Codex's exact timings: "[[" 30 ms/key, the whole title 15 ms/key, 180 ms, Enter, then 8 ms/key.
    for (const title of targets) {
      await page.keyboard.type("[[", { delay: 30 });
      await page.keyboard.type(title, { delay: 15 });
      await page.waitForTimeout(180);
      await page.keyboard.press("Enter");
      await page.keyboard.type(" informs this; ", { delay: 8 });
    }
    const links = await savedMarkdown();
    const expected = targets.map((title) => `[[${title}]] informs this;`).join(" ");
    check(links === expected, "six links picked in a row stay six separate links", JSON.stringify(links));
    // The same six typed in full, closing brackets included, without using the list.
    await newNote("R3 typed links");
    for (const title of targets) await fast(`[[${title}]] informs this; `);
    const typed = await savedMarkdown();
    check(typed === expected, "six links typed in full, without the list, stay separate", JSON.stringify(typed));

    // Format bar near the bottom edge: it was off-screen below the selection.
    await newNote("R3 toolbar");
    for (let i = 0; i < 40; i += 1) { await page.keyboard.type(`Line ${i} of a long note`); await page.keyboard.press("Enter"); }
    await page.keyboard.type("last line here");
    await page.keyboard.press("Shift+Home");
    await page.waitForTimeout(400);
    const bar = await page.locator(".core-selection-toolbar").boundingBox().catch(() => null);
    const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    check(Boolean(bar) && bar.y >= 0 && bar.y + bar.height <= viewport.height, `the format bar is on screen for a selection at the bottom (${bar ? Math.round(bar.y) : "none"} / ${viewport.height})`);

    // Code-language menu near the bottom edge: lower languages were off-screen.
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await fast("/code block");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    await editor.locator(".core-code-lang").last().scrollIntoViewIfNeeded();
    await page.evaluate(() => { const button = [...document.querySelectorAll(".core-code-lang")].pop(); const scroller = button.closest(".core-editor-content"); scroller.scrollTop += button.getBoundingClientRect().bottom - innerHeight + 40; });
    await page.waitForTimeout(200);
    await editor.locator(".core-code-lang").last().click();
    const menu = await page.locator(".core-code-lang-menu").boundingBox();
    check(Boolean(menu) && menu.y >= 0 && menu.y + menu.height <= viewport.height + 1, `the language menu fits on screen near the bottom (${menu ? `${Math.round(menu.y)}–${Math.round(menu.y + menu.height)}` : "none"} / ${viewport.height})`);
    await page.getByRole("menuitemradio", { name: "yaml", exact: true }).click();
    await page.waitForTimeout(300);
    check(await editor.locator(".core-code-lang").last().textContent() === "yaml", "the last language in the menu can be picked near the bottom");
  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n")[0]}`);
  } finally {
    await browser.close().catch(() => {});
    sandboxCli("stop", NAME);
  }
  console.log(failures.length ? `\nRound 3 regressions scenario FAILED (${failures.length})` : "\nRound 3 regressions scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
