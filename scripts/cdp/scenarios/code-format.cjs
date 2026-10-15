// CODE-FORMAT (Hive #35, #43): code block format tools from the right-click
// menu, the "/" menu and the toolbar Format button. One undo step each, caret at the end of the block, JSON
// refusals leave the block alone.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/code-format.cjs
//
// Needs a fresh `npm run sandbox:build`. Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-code-format";
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };

(async () => {
  const info = JSON.parse(sandboxCli("start", NAME));
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  const editor = page.locator("[contenteditable=true]").first();
  const slashMenu = page.locator(".core-slash-menu");
  const codeMenu = page.locator(".core-table-context-menu[role=menu]");
  const type = (text) => page.keyboard.type(text, { delay: 35 });
  const code = () => editor.locator("pre.core-code-block code").first();
  const codeText = async () => (await code().textContent()).replace(/​/g, "");
  // Caret inside the block and how many characters of it lie before the caret.
  const caret = () => code().evaluate((el) => {
    const selection = window.getSelection();
    if (!selection.rangeCount || !el.contains(selection.anchorNode)) return null;
    const range = document.createRange();
    range.setStart(el, 0);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return range.toString().replace(/​/g, "").length;
  });
  const undo = async () => { await page.waitForTimeout(900); await page.keyboard.press("Control+z"); await page.waitForTimeout(500); };

  async function newNote(title) {
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).click();
    await page.getByRole("button", { name: "New note" }).first().click();
    await page.locator(".core-title-input").waitFor();
    await page.waitForTimeout(300);
    await type(title);
    await page.keyboard.press("Enter");
  }
  async function pickSlash(name) {
    await slashMenu.locator("[role=option]", { hasText: name }).first().waitFor({ timeout: 3000 });
    const index = await slashMenu.locator("[role=option]").evaluateAll((els, wanted) => els.findIndex((el) => el.textContent.includes(wanted)), name);
    for (let i = 0; i < index; i += 1) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
  }
  async function codeBlock(lang, lines) {
    await type("/code");
    await pickSlash("Code block");
    await editor.locator("pre.core-code-block .core-code-lang").first().click();
    await page.getByRole("menuitemradio", { name: lang, exact: true }).click();
    await page.waitForTimeout(400);
    await code().click(); // not Ctrl+End: from a trailing block it steps out below
    for (const [index, line] of lines.entries()) { if (index) await page.keyboard.press("Enter"); await type(line); }
    await page.waitForTimeout(900);
  }
  async function menuAction(label) {
    await code().click({ button: "right" });
    await codeMenu.getByRole("menuitem", { name: label, exact: true }).click();
    await page.waitForTimeout(500);
  }

  try {
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).waitFor({ timeout: 30000 });

    // Right-click menu on a json block
    await newNote("Format JSON");
    await codeBlock("json", ['{"b":1,"a":[1,2]}']);
    const raw = await codeText();
    check(raw === '{"b":1,"a":[1,2]}', "json block typed", JSON.stringify(raw));
    await code().click({ button: "right" });
    const labels = await codeMenu.getByRole("menuitem").allTextContents();
    check(labels.includes("Pretty print JSON") && labels.includes("Sort lines") && !labels.includes("Edit code"), "a plain json block gets the JSON and line tools, no Edit code", labels.join(" | "));
    await page.keyboard.press("Escape");
    await menuAction("Pretty print JSON");
    const pretty = '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}';
    check(await codeText() === pretty, "Pretty print JSON rewrites the block", JSON.stringify(await codeText()));
    check(await caret() === pretty.length, "caret sits at the end of the formatted block", String(await caret()));
    await undo();
    check(await codeText() === raw, "one Ctrl+Z restores the block as typed", JSON.stringify(await codeText()));
    await menuAction("Minify JSON");
    check(await codeText() === raw, "Minify of minified JSON changes nothing");

    // Refusals: invalid JSON, a number a double cannot hold
    await code().click();
    await page.keyboard.press("End");
    await type("x");
    await page.waitForTimeout(900);
    await menuAction("Pretty print JSON");
    check(await codeText() === `${raw}x`, "invalid JSON is left alone");
    check(await page.getByText("This is not valid JSON, so nothing was changed.").count() > 0, "invalid JSON shows a notice");
    await code().evaluate((el) => { el.ownerDocument.getSelection().selectAllChildren(el); });
    await type('{"id":12345678901234567890}');
    await page.waitForTimeout(900);
    await menuAction("Pretty print JSON");
    check(await codeText() === '{"id":12345678901234567890}', "an integer over 2^53 is not reformatted", JSON.stringify(await codeText()));
    check(await page.getByText(/12345678901234567890 cannot be kept exactly/).count() > 0, "the big-number refusal names the number");

    // "/" menu on a plain block: only line tools, one undo step
    await newNote("Format lines");
    await codeBlock("python", ["b", "a", "c "]);
    await type("/sort");
    await page.waitForTimeout(400);
    const offered = await slashMenu.locator("[role=option]").allTextContents();
    check(offered.some((text) => text.includes("Sort lines")) && !offered.some((text) => text.includes("JSON")), "the / menu offers Sort lines and no JSON tools in a python block", offered.join(" | "));
    await pickSlash("Sort lines");
    check(await codeText() === "a\nb\nc ", "Sort lines from the / menu sorts the block and drops /sort", JSON.stringify(await codeText()));
    check(await caret() === "a\nb\nc ".length, "caret at the end of the block after the / menu", String(await caret()));
    await undo();
    check(await codeText() === "b\na\nc ", "one Ctrl+Z after the / menu restores the block", JSON.stringify(await codeText()));
    await menuAction("Trim trailing whitespace");
    check(await codeText() === "b\na\nc", "Trim trailing whitespace from the right-click menu");

    // Outside a code block the tools are not offered
    await page.keyboard.press("Control+End"); // steps out under the trailing block
    await type("/sort");
    await page.waitForTimeout(400);
    const outside = await slashMenu.locator("[role=option]").allTextContents().catch(() => []);
    check(!outside.some((text) => text.includes("Sort lines")), "outside a code block / does not offer Sort lines", outside.join(" | "));

    // CODE-FORMAT (Hive #43): the toolbar's Format button opens the same tools.
    const formatButton = () => editor.locator("pre.core-code-block .core-code-format").first();
    const menuOpen = () => codeMenu.count().then((n) => n > 0);
    await newNote("Format button");
    await codeBlock("json", ['{"b":1}']);
    check(await formatButton().isVisible(), "every code block shows a Format button");
    await formatButton().click();
    const fromButton = await codeMenu.getByRole("menuitem").allTextContents();
    check(fromButton.includes("Pretty print JSON") && fromButton.includes("Sort lines") && !fromButton.includes("Copy code"), "Format on a json block lists the JSON and line tools only", fromButton.join(" | "));
    const fits = await codeMenu.evaluate((el) => { const box = el.getBoundingClientRect(); return el.scrollHeight <= el.clientHeight + 1 && box.top >= 0 && box.bottom <= innerHeight; });
    check(fits, "the whole Format menu shows without scrolling");
    await formatButton().click();
    check(!(await menuOpen()), "a second click on Format closes its menu");
    await formatButton().click();
    await codeMenu.getByRole("menuitem", { name: "Pretty print JSON", exact: true }).click();
    await page.waitForTimeout(500);
    check(await codeText() === '{\n  "b": 1\n}', "Pretty print JSON from the Format button", JSON.stringify(await codeText()));
    await undo();
    check(await codeText() === '{"b":1}', "one Ctrl+Z after a Format button action restores the block", JSON.stringify(await codeText()));

    // Keyboard: Enter opens with focus on the first tool, arrows move, Esc closes back to the button.
    // Reached with the keyboard: Esc leaves the text, Tab walks the toolbar.
    await code().click();
    await page.keyboard.press("Escape");
    const focused = () => page.evaluate(() => document.activeElement?.className ?? "");
    const walk = [];
    for (let i = 0; i < 4 && !walk.includes("core-code-format"); i += 1) { await page.keyboard.press("Tab"); walk.push(await focused()); }
    check(walk.includes("core-code-format"), "Esc then Tab reaches the Format button", walk.join(" -> "));
    check(await codeText() === '{"b":1}', "tabbing through the toolbar does not indent the block", JSON.stringify(await codeText()));
    await formatButton().focus();
    await page.keyboard.press("Enter");
    check(await menuOpen() && await page.evaluate(() => document.activeElement?.getAttribute("role")) === "menuitem", "Enter on the focused Format button opens the menu, focus on the first tool");
    const first = await page.evaluate(() => document.activeElement?.textContent);
    await page.keyboard.press("ArrowDown");
    const second = await page.evaluate(() => document.activeElement?.textContent);
    check(first !== second && fromButton.indexOf(second) === fromButton.indexOf(first) + 1, "ArrowDown moves to the next tool", `${first} -> ${second}`);
    await page.keyboard.press("Escape");
    check(!(await menuOpen()) && await page.evaluate(() => document.activeElement?.classList.contains("core-code-format")), "Esc closes the menu and focus returns to Format");
    await page.keyboard.press(" ");
    check(await menuOpen(), "Space on Format opens the menu too");
    await page.keyboard.press("Escape");
    check(await codeText() === '{"b":1}', "keys on the Format button never edit the block", JSON.stringify(await codeText()));

    // Nothing of the button reaches the note: reopen it, no stray text outside the block.
    await page.locator(".core-object-row", { hasText: "Format lines" }).first().click();
    await page.locator(".core-object-row", { hasText: "Format button" }).first().click();
    await page.waitForTimeout(600);
    const outsideText = await editor.evaluate((root) => Array.from(root.children).filter((el) => !el.matches("pre")).map((el) => el.textContent).join("|"));
    check(!/Format|Copy/u.test(outsideText) && await editor.locator("pre.core-code-block").count() === 1 && await editor.locator(".core-code-format").count() === 1, "after reopening, the note holds one block with one Format button and no toolbar text", outsideText);

    // A python block: no JSON tools
    await newNote("Format python");
    await codeBlock("python", ["b", "a"]);
    await formatButton().click();
    const pyTools = await codeMenu.getByRole("menuitem").allTextContents();
    check(pyTools.includes("Sort lines") && !pyTools.some((label) => label.includes("JSON")), "Format on a python block has no JSON tools", pyTools.join(" | "));
    await codeMenu.getByRole("menuitem", { name: "Sort lines", exact: true }).click();
    await page.waitForTimeout(500);
    check(await codeText() === "a\nb", "Sort lines from the Format button", JSON.stringify(await codeText()));

    // A drawn block (Mermaid): Format opens its menu without opening the source.
    await newNote("Format diagram");
    await type("/mermaid");
    await slashMenu.locator("[role=option]", { hasText: "Mermaid diagram" }).first().waitFor({ timeout: 3000 });
    await page.keyboard.press("Enter");
    await editor.locator(".core-code-render.nq-ready").first().waitFor({ timeout: 15000 });
    await page.locator(".core-title-input").click(); // caret out of the block, so it shows drawn
    await page.waitForTimeout(400);
    const drawn = editor.locator("pre.core-code-block").first();
    const editing = () => drawn.evaluate((el) => el.classList.contains("is-editing"));
    check(!(await editing()), "the diagram shows drawn with the caret elsewhere");
    await drawn.locator(".core-code-format").click();
    check(await menuOpen() && !(await editing()), "Format on a drawn diagram opens the menu without opening its source");
    const drawnTools = await codeMenu.getByRole("menuitem").allTextContents();
    check(drawnTools.includes("Sort lines") && !drawnTools.includes("Edit code"), "the diagram's Format menu lists the line tools", drawnTools.join(" | "));
    await page.screenshot({ path: path.join(info.exports, "43-format-diagram.png") });
    await page.keyboard.press("Escape");
    check(!(await editing()), "Esc leaves the diagram drawn");
  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n")[0]}`);
  } finally {
    await browser.close().catch(() => {});
    sandboxCli("stop", NAME);
  }
  console.log(failures.length ? `\nCode format scenario FAILED (${failures.length})` : "\nCode format scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
