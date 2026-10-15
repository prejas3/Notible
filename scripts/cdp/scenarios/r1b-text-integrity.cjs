// Scenario R1b (repair plan 01.10): what you type is what gets saved.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/r1b-text-integrity.cjs [--keep-open]
//
// Needs a fresh `npm run sandbox:build`. Starts its own sandbox and compares the
// note's exported Markdown (the "Download as Markdown" button, which a sandbox
// writes straight into its exports folder) with what was typed:
//   E7  a [[link]] picked from the menu, then the rest of the sentence
//   E6  highlighting inside a list whose items start with a Tab
// Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-r1b-integrity";
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };

(async () => {
  const info = JSON.parse(sandboxCli("start", NAME));
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  const editor = page.locator("[contenteditable=true]").first();
  const type = (text) => page.keyboard.type(text, { delay: 35 });

  async function newNote(title) {
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).click();
    await page.getByRole("button", { name: "New note" }).first().click();
    await page.locator(".core-title-input").waitFor();
    await page.waitForTimeout(300);
    await type(title);
    await page.locator(".core-title-input").focus();
    await page.keyboard.press("Tab");
  }
  /** Opening a note is async: wait up to 3 s for its title to be the open one. */
  async function titleBecomes(title) {
    for (let i = 0; i < 30; i += 1) {
      if (await page.locator(".core-title-input").inputValue() === title) return true;
      await page.waitForTimeout(100);
    }
    return false;
  }
  /** Open a note from the sidebar and wait until it really is the open one. */
  async function openNote(title) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.locator(".core-object-row", { hasText: title }).first().click();
      for (let i = 0; i < 20; i += 1) {
        if (await page.locator(".core-title-input").inputValue() === title) return;
        await page.waitForTimeout(100);
      }
    }
    throw new Error(`could not open "${title}"`);
  }
  /** The open note's Markdown as "Download as Markdown" produces it, minus the
   * title line it adds. The export is a browser download of a Blob, so the Blob
   * is caught in the page and the download itself is cancelled (nothing lands
   * in the real Downloads folder). */
  async function savedMarkdown() {
    await page.waitForTimeout(1500); // past the autosave delay
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

    // E7
    await newNote("Meeting notes");
    await type("Decisions here.");
    await newNote("E7 essay");
    await type("See [[Meet");
    await page.waitForTimeout(400);
    await page.keyboard.press("Enter");
    await type(" for decisions.");
    await page.keyboard.press("Enter");
    await type("## Next steps");
    await page.keyboard.press("Enter");
    await type("Some paragraph.");
    const linkText = await editor.locator(".core-md-wikilink").first().textContent().catch(() => "missing");
    check(linkText === "[[Meeting notes]]", `E7 the link holds only itself (got ${JSON.stringify(linkText)})`);
    check(await editor.locator("h2").count() === 1, "E3 '## ' converts on the line after a link");
    const e7 = await savedMarkdown();
    check(e7 === "See [[Meeting notes]] for decisions.\n## Next steps\nSome paragraph.", "E7 saved text is exactly what was typed", JSON.stringify(e7));

    // E6
    await newNote("E6 list");
    await type("- Hiring");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await type("Frontend role");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await type("Designer role");
    await page.keyboard.press("Enter");
    await type("Office move");
    await page.keyboard.press("Shift+Home");
    await page.waitForTimeout(300);
    await page.locator(".core-selection-toolbar-pen").first().click();
    await page.waitForTimeout(500);
    // E16: double-click a word in a list item (after the item's tab).
    const wordAt = (word) => editor.evaluate((el, text) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent.indexOf(text);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at); range.setEnd(node, at + text.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      return null;
    }, word);
    const target = await wordAt("Designer");
    await page.mouse.dblclick(target.x, target.y);
    await page.waitForTimeout(300);
    const word = (await page.evaluate(() => getSelection().toString())).trim();
    check(word === "Designer", `E16 double-click selects the word in a list item (got ${JSON.stringify(word)})`);
    await page.locator(".core-selection-toolbar-pen").nth(1).click();
    await page.waitForTimeout(500);
    const e6 = await savedMarkdown();
    const lines = e6.split("\n");
    // Tab in a bullet nests it under the one above (E5), saved as leading tabs;
    // Enter keeps the level, so the second Tab goes one deeper.
    check(lines.length === 4 && lines.every((line) => /^\t*- /.test(line)), "E6 every item is still a list item after highlighting", JSON.stringify(e6));
    check(lines[3] === "\t\t- ==green:Office move==", "E6 the first highlight covers exactly its selection", JSON.stringify(lines[3]));
    check(lines[2] === "\t\t- ==blue:Designer== role", "E6 the second highlight covers exactly the word", JSON.stringify(lines[2]));
    check(lines[1] === "\t- Frontend role" && lines[0] === "- Hiring", "E5/E6 Tab nested the items, the other lines are untouched", JSON.stringify(lines.slice(0, 2)));

    // E5: Shift+Tab takes an item back out, Tab nests it again, nesting survives reopening.
    const frontend = await wordAt("Frontend");
    await page.mouse.click(frontend.x, frontend.y);
    await page.keyboard.press("Shift+Tab");
    await page.waitForTimeout(300);
    check((await savedMarkdown()).split("\n")[1] === "- Frontend role", "E5 Shift+Tab un-nests a bullet");
    const frontendAgain = await wordAt("Frontend"); // the export button took the focus
    await page.mouse.click(frontendAgain.x, frontendAgain.y);
    await page.keyboard.press("Tab");
    await page.waitForTimeout(1500);
    await openNote("E7 essay");
    await openNote("E6 list");
    const levels = await editor.locator("li").evaluateAll((items) => items.map((li) => Number(li.dataset.indent || 0)));
    check(JSON.stringify(levels) === "[0,1,2,2]", `E5 nested bullets survive reopening the note (${JSON.stringify(levels)})`);

    // E6: a selection across lines is marked line by line.
    const to = await wordAt("Hiring");
    await page.mouse.click(to.x, to.y);
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+End");
    await page.waitForTimeout(300);
    await page.locator(".core-selection-toolbar-bold").click();
    await page.waitForTimeout(500);
    const across = (await savedMarkdown()).split("\n").slice(0, 2);
    check(JSON.stringify(across) === JSON.stringify(["- **Hiring**", "\t- **Frontend role**"]), "E6 bold across two items marks each item, nesting intact", JSON.stringify(across));

    // E8: a [[link]] shows its title without brackets once the caret leaves it;
    // a link typed by hand (no picker) renders at once.
    const label = (link) => link.evaluate((el) => ({ raw: el.textContent, size: getComputedStyle(el).fontSize, shown: getComputedStyle(el, "::before").content }));
    await openNote("E7 essay");
    await page.waitForTimeout(500);
    await editor.locator("h2").click();
    const picked = await label(editor.locator(".core-md-wikilink").first());
    check(picked.size === "0px" && picked.shown === '"Meeting notes"', "E8 a link shows its title without brackets", JSON.stringify(picked));
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await type("also [[Meeting notes");
    await page.keyboard.press("Escape");
    await type("]]");
    await page.waitForTimeout(300);
    check(await editor.locator(".core-md-wikilink").count() === 2, "E8 a link typed by hand renders as a link straight away", await editor.evaluate((el) => el.innerHTML));

    // E22 + CP61: rename the target, then the source.
    await openNote("Meeting notes");
    await page.locator(".core-title-input").fill("Team meeting");
    await page.waitForTimeout(1500);
    await openNote("E7 essay");
    await page.waitForTimeout(500);
    const relabelled = await label(editor.locator(".core-md-wikilink").first());
    check(relabelled.shown === '"Team meeting"' && relabelled.raw === "[[Meeting notes]]", "E22 after a rename the link shows the new title, the text is unchanged", JSON.stringify(relabelled));
    await editor.locator("h2").click();
    await page.keyboard.press("End");
    await type(" edited");
    await page.waitForTimeout(1500); // the essay is saved again: its link must survive that
    const link = editor.locator(".core-md-wikilink").first();
    const linkBox = await link.boundingBox();
    await page.mouse.click(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2);
    await page.waitForTimeout(300);
    check(await page.locator(".core-title-input").inputValue() === "E7 essay", "E21 a plain click on a link does not leave the note");
    // The plain click put the caret in the link, which shows its raw text: measure again.
    const openBox = await link.boundingBox();
    // page.mouse.click ignores `modifiers`; hold Ctrl on the keyboard instead.
    await page.keyboard.down("Control");
    await page.mouse.click(openBox.x + openBox.width / 2, openBox.y + openBox.height / 2);
    await page.keyboard.up("Control");
    await page.waitForTimeout(500);
    check(await titleBecomes("Team meeting"), "E21/E22 Ctrl+click opens the renamed note after the linking note was saved again");
    await page.locator(".core-backlink-row").first().waitFor({ timeout: 3000 }).catch(() => {});
    const backlinkTitles = await page.locator(".core-backlink-row").allTextContents();
    check(backlinkTitles.some((text) => text.includes("E7 essay")), "E22 the renamed note lists its backlink", JSON.stringify(backlinkTitles));
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(500);
    check(await titleBecomes("E7 essay"), "E21 Alt+Left goes back to the note you came from");
    await openNote("E7 essay"); // whatever Alt+Left did, rename the right note
    await page.locator(".core-title-input").fill("Essay renamed");
    await page.waitForTimeout(1500);
    await openNote("Team meeting");
    await page.waitForTimeout(500);
    await page.locator(".core-backlink-row").first().waitFor({ timeout: 3000 }).catch(() => {});
    const renamedSource = await page.locator(".core-backlink-row").allTextContents();
    check(renamedSource.some((text) => text.includes("Essay renamed")), "CP61 a backlink shows its note's new name", JSON.stringify(renamedSource));

    // E9: code block from "/": typing goes inside, indentation survives, language can change.
    await newNote("E9 code");
    await type("/code block");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    await type("def f():");
    await page.keyboard.press("Enter");
    await type("    return 1");
    await page.waitForTimeout(300);
    check((await editor.locator("pre code").first().textContent().catch(() => "")).includes("return 1"), "E9 code typed after '/code block' lands inside the block", await editor.evaluate((el) => el.innerHTML));
    await editor.locator(".core-code-lang").first().click();
    await page.getByRole("menuitemradio", { name: "python", exact: true }).click();
    await page.waitForTimeout(400);
    const e9 = await savedMarkdown();
    check(e9 === "```python\ndef f():\n    return 1\n```", "E9 language changed to python and indentation kept", JSON.stringify(e9));

    // E17 + E18 + E19 + E26 on one note
    await newNote("E17 layout");
    await type("# Big heading");
    await page.keyboard.press("Enter");
    await type("first second third");
    await page.keyboard.press("Enter");
    await type("- [ ] buy milk");
    await page.waitForTimeout(300);
    const geometry = await page.evaluate(() => {
      const textLeft = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getClientRects()[0]?.left ?? -1; };
      const title = document.querySelector(".core-title-input");
      const h1 = document.querySelector(".core-editor-content h1");
      return {
        titleSize: parseFloat(getComputedStyle(title).fontSize), h1Size: parseFloat(getComputedStyle(h1).fontSize),
        titleLeft: title.getBoundingClientRect().left + parseFloat(getComputedStyle(title).borderLeftWidth) + parseFloat(getComputedStyle(title).paddingLeft),
        bodyLeft: textLeft(h1),
      };
    });
    check(geometry.h1Size < geometry.titleSize, `E19 a body heading is smaller than the title (${geometry.h1Size} < ${geometry.titleSize})`);
    check(Math.abs(geometry.bodyLeft - geometry.titleLeft) <= 2, `E26 body text lines up with the title (${Math.round(geometry.bodyLeft)} vs ${Math.round(geometry.titleLeft)})`);
    const stats = await page.locator(".core-editor-stats").textContent();
    // "Big heading first second third buy milk": the old count added "#", "-", "[", "]".
    check(/(^|\D)7 words/.test(stats), `E18 the word count ignores Markdown marks (${stats})`);
    const second = await wordAt("second");
    await page.mouse.dblclick(second.x, second.y);
    await page.waitForTimeout(300);
    const toolbar = await page.locator(".core-selection-toolbar").boundingBox();
    check(toolbar && toolbar.y >= second.y, `E17 the format bar opens below the selection (bar ${Math.round(toolbar?.y ?? -1)}, word ${Math.round(second.y)})`);
    const hBackground = await page.locator(".core-selection-toolbar-highlight").evaluate((el) => getComputedStyle(el).backgroundColor);
    check(/rgba\(0, 0, 0, 0\)|transparent/.test(hBackground), `E17 the H button does not look pressed (${hBackground})`);
    await page.getByRole("button", { name: "Heading", exact: true }).click();
    await page.waitForTimeout(400);
    check(await editor.locator("h2").filter({ hasText: "first second third" }).count() === 1, "E17 the Heading button makes the line a heading");
    const third = await wordAt("third");
    await page.mouse.dblclick(third.x, third.y);
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Link", exact: true }).click();
    await page.waitForTimeout(400);
    await type("example.com");
    const e17 = await savedMarkdown();
    check(e17.includes("## first second [third](https://example.com)"), "E17 the Link button wraps the word, caret in the address", JSON.stringify(e17));
  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n")[0]}`);
  } finally {
    await browser.close().catch(() => {});
    if (!process.argv.includes("--keep-open")) sandboxCli("stop", NAME);
  }
  console.log(failures.length ? `\nR1b text integrity scenario FAILED (${failures.length})` : "\nR1b text integrity scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
