// Scenario R1a (repair plan 01.10): basic writing works on every line.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/r1a-writing.cjs [--keep-open]
//
// Needs a fresh `npm run sandbox:build`. Starts its own sandbox, creates a note
// and types like a person (no reopen between steps). Checks:
//   E1  Enter in the title moves the caret into the body
//   E2  "/" opens the slash menu on line 2+, not only on line 1
//   E3  "# ", "## ", "> ", "- [ ] " convert on line 2+ while typing
// Exit code 1 on any failure. --keep-open leaves the sandbox running.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-r1a-writing";
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };

(async () => {
  const info = JSON.parse(sandboxCli("start", NAME));
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  const editor = page.locator("[contenteditable=true]").first();
  const slashMenu = page.locator(".core-slash-menu");
  const editorHtml = () => editor.evaluate((el) => el.innerHTML);
  const type = (text) => page.keyboard.type(text, { delay: 35 });

  async function newNote() {
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).click();
    await page.getByRole("button", { name: "New note" }).first().click();
    await page.locator(".core-title-input").waitFor();
    await page.waitForTimeout(300);
  }
  async function bodyFromTitle() {
    // Tab is the known-good way into the body; E1 is checked separately.
    await page.locator(".core-title-input").focus();
    await page.keyboard.press("Tab");
  }

  try {
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).waitFor({ timeout: 30000 });

    // E1
    await newNote();
    await type("Meeting notes");
    await page.keyboard.press("Enter");
    const inBody = await page.evaluate(() => Boolean(document.activeElement?.isContentEditable));
    check(inBody, "E1 Enter in the title moves into the body");
    await type("x");
    check((await editor.innerText()).trim() === "x", "E1 typing after that lands in the body", await editorHtml());

    // E1: Enter in the middle of the title takes the rest along as line 1.
    await newNote();
    await type("Meeting notes");
    for (let i = 0; i < " notes".length; i += 1) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const split = { title: await page.locator(".core-title-input").inputValue(), body: (await editor.innerText()).trim() };
    check(split.title === "Meeting" && split.body === "notes", "E1 Enter mid-title moves the rest into the body", JSON.stringify(split));

    // E2: slash menu on line 2
    await newNote();
    await type("E2 note");
    await bodyFromTitle();
    await type("first line");
    await page.keyboard.press("Enter");
    await type("/");
    await page.waitForTimeout(300);
    check(await slashMenu.isVisible(), "E2 '/' opens the menu on line 2", await editorHtml());
    await page.keyboard.press("Escape");

    // E3: block shortcuts on later lines
    for (const line of [1, 2]) {
      for (const [prefix, tag] of [["# ", "h1"], ["## ", "h2"], ["> ", "blockquote"], ["- [ ] ", "li[data-task=true]"]]) {
        await newNote();
        await type(`E3 ${tag} line ${line}`);
        await bodyFromTitle();
        if (line === 2) { await type("first line"); await page.keyboard.press("Enter"); }
        await type(`${prefix}Converted`);
        await page.waitForTimeout(300);
        const converted = await editor.evaluate((el, selector) => [...el.querySelectorAll(selector)].some((node) => node.textContent.includes("Converted")), tag);
        check(converted, `E3 "${prefix.trim()}" converts on line ${line} while typing`, await editorHtml());
      }
    }

    // Round 2 (01.10): "- " right after leaving a list (Enter on an empty item)
    // stayed literal text, because that paragraph starts with a zero-width space.
    await newNote();
    await type("E3 after list");
    await bodyFromTitle();
    await type("- one");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await type("- two");
    await page.waitForTimeout(300);
    const afterList = await editor.evaluate((el) => [...el.querySelectorAll("li")].map((li) => li.textContent.replace(/​/g, "")));
    check(JSON.stringify(afterList) === JSON.stringify(["one", "two"]), '"- " starts a bullet again after leaving a list', JSON.stringify(afterList));

    // Round 2 (01.10), decision "a": Enter leaves a quote, Shift+Enter stays in it.
    await newNote();
    await type("Quote exit");
    await bodyFromTitle();
    await type("> Write decisions down");
    await page.keyboard.press("Shift+Enter");
    await type("before they become folklore.");
    await page.keyboard.press("Enter");
    await type("### Working agreements");
    await page.waitForTimeout(300);
    const quoteState = await editor.evaluate((el) => ({ quotes: [...el.querySelectorAll("blockquote")].map((q) => q.innerText.replace(/​/g, "").trim()), h3: [...el.querySelectorAll("h3")].map((h) => h.textContent) }));
    check(JSON.stringify(quoteState) === JSON.stringify({ quotes: ["Write decisions down\nbefore they become folklore."], h3: ["Working agreements"] }), "Enter leaves a quote, Shift+Enter adds a line inside it, '### ' converts after it", JSON.stringify(quoteState));

    // E4: checklists
    await newNote();
    await type("E4 checklist");
    await bodyFromTitle();
    await type("- [ ] one");
    await page.keyboard.press("Enter");
    await type("two");
    await page.keyboard.press("Enter");
    await type("three");
    await page.waitForTimeout(300);
    const items = await editor.evaluate((el) => [...el.querySelectorAll("li")].map((li) => ({ task: li.dataset.task === "true", checked: li.dataset.checked === "true", box: Boolean(li.querySelector(":scope > .core-md-task-box")), text: li.textContent.replace(/​/g, "").trim() })));
    check(items.length === 3 && items.every((item) => item.task && item.box && !item.checked), "E4 every new checklist item gets an unchecked box", JSON.stringify(items));
    const boxBg = await editor.locator("li[data-checked=false] > .core-md-task-box").first().evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => "missing");
    check(/rgba\(0, 0, 0, 0\)|transparent/.test(boxBg), `E4 an unchecked box is an outline, not filled (${boxBg})`);
    await editor.locator(".core-md-task-box").first().click();
    await page.waitForTimeout(200);
    check(await editor.locator("li").first().getAttribute("data-checked") === "true", "E4 clicking a box ticks it");

    // E10: code block Copy label
    await newNote();
    await type("E10 code");
    await bodyFromTitle();
    await type("/code block");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    const copyLabel = await editor.locator(".core-code-copy").first().textContent().catch(() => "missing");
    check(copyLabel === "Copy", `E10 code block button reads "Copy" (got ${JSON.stringify(copyLabel)})`);

    // E13: slash menu details
    await newNote();
    await type("E13 slash");
    await bodyFromTitle();
    await type("text");
    await page.keyboard.press("Enter");
    // Measured from the line above: an empty line's collapsed caret has no box.
    const lineBox = await editor.evaluate((el) => { const range = document.createRange(); range.selectNodeContents(el.firstChild); return range.getBoundingClientRect().toJSON(); });
    const caretBox = { x: lineBox.left, bottom: lineBox.bottom + lineBox.height };
    await page.mouse.move(caretBox.x + 40, caretBox.bottom + 40); // resting where the menu will open
    await type("/check");
    await page.waitForTimeout(300);
    const firstRow = slashMenu.locator("[role=option]").first();
    check((await firstRow.textContent().catch(() => "")).includes("Task list"), '"/check" finds Task list by its description (E13)');
    check(await firstRow.getAttribute("aria-selected").catch(() => null) === "true", "E13 first item stays selected under a resting pointer");
    const menuTop = (await slashMenu.boundingBox().catch(() => null))?.y ?? -1;
    check(menuTop >= caretBox.bottom, `E13 menu opens below the caret when there is room (menu ${Math.round(menuTop)}, caret ${Math.round(caretBox.bottom)})`);
    for (let i = 0; i < "/check".length; i += 1) await page.keyboard.press("Backspace");
    await type("/heading 1");
    await page.waitForTimeout(300);
    check(await slashMenu.isVisible() && (await slashMenu.locator("[role=option]").first().textContent()).includes("Heading 1"), 'E13 a space keeps the menu open on "/heading 1"');
    await page.keyboard.press("Escape");

    // E12: Ctrl+N while typing in the body
    const notesBefore = await page.locator(".core-title-input").inputValue();
    await page.keyboard.press("Control+n");
    await page.waitForTimeout(600);
    check(await page.locator(".core-title-input").inputValue() !== notesBefore, "E12 Ctrl+N opens a new note while typing");

    // E24 + N16
    await page.locator(".core-title-input").focus();
    const ring = await page.locator(".core-title-input").evaluate((el) => ({ outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow }));
    check(ring.outline === "none" && ring.shadow !== "none", `E24 title shows one focus ring (${JSON.stringify(ring)})`);
    check(await page.title() === "Notible", `N16 window title is "Notible" (got ${JSON.stringify(await page.title())})`);

    // E3: what was saved renders back the same (no reopen artifacts).
    await page.waitForTimeout(2500); // past the autosave delay
    await page.getByRole("button", { name: "E4 checklist" }).first().click();
    await page.waitForTimeout(400);
    const savedItems = await editor.evaluate((el) => [...el.querySelectorAll("li[data-task=true]")].map((li) => `${li.dataset.checked === "true" ? "x" : " "}:${li.textContent.replace(/​|✓/g, "").trim()}`));
    check(JSON.stringify(savedItems) === JSON.stringify(["x:one", " :two", " :three"]), "E4 the checklist and the tick are saved", JSON.stringify(savedItems));
    for (const line of [1, 2]) {
      for (const tag of ["h1", "h2", "blockquote", "li[data-task=true]"]) {
        await page.getByRole("button", { name: `E3 ${tag} line ${line}` }).first().click();
        await page.waitForTimeout(400);
        const blocks = await editor.evaluate((el, selector) => [...el.querySelectorAll(selector)].map((node) => node.textContent.replace(/​/g, "").trim()), tag);
        check(JSON.stringify(blocks) === JSON.stringify(["Converted"]), `E3 ${tag} on line ${line} is saved as one "Converted" block`, `${JSON.stringify(blocks)} ${await editorHtml()}`);
      }
    }
  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n")[0]}`);
  } finally {
    await browser.close().catch(() => {});
    if (!process.argv.includes("--keep-open")) sandboxCli("stop", NAME);
  }
  console.log(failures.length ? `\nR1a writing scenario FAILED (${failures.length})` : "\nR1a writing scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
