// CODE-COMPARE (Hive #51): the compare block in Polish. "/" menu entry, marks,
// line numbers, notices, narrow and wide panes, click to edit, one Ctrl+Z per
// edit, and the fit at the UI gate sizes.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" SIZE=1024x700 THEME=Daylight node scripts/cdp/scenarios/code-compare.cjs
//
// Needs a fresh `npm run sandbox:build`. SIZE: 1024x700 or 1920x1080. THEME:
// Daylight or Midnight. Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-code-compare";
const SIZE = process.env.SIZE || "1024x700";
const THEME = process.env.THEME || "Daylight";
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };

(async () => {
  const info = JSON.parse(sandboxCli("start", NAME, "--size", SIZE));
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  const editor = page.locator("[contenteditable=true]").first();
  const slashMenu = page.locator(".core-slash-menu");
  const type = (text) => page.keyboard.type(text, { delay: 30 });
  const block = () => editor.locator(".core-code-comparison").first();
  const sourceOf = () => editor.locator("pre.core-code-block code").first().textContent().then((text) => text.replace(/​/g, ""));
  const undo = async () => { await page.waitForTimeout(900); await page.keyboard.press("Control+z"); await page.waitForTimeout(500); };
  const caretOut = async () => { await page.locator(".core-title-input").click(); await page.waitForTimeout(700); };
  const toolbar = () => editor.locator("pre.core-code-block .core-code-toolbar").first();
  // The open note's stored Markdown as "Download as Markdown" writes it, minus the
  // title line. The export is a Blob download: the Blob is caught in the page and
  // the download is cancelled, so nothing lands in Downloads.
  async function savedMarkdown(title) {
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
    // The row menu holds the export (the note toolbar does not).
    await page.locator(".core-object-row", { hasText: title }).first().click({ button: "right" });
    const rowMenu = page.locator(".core-row-context-menu");
    await rowMenu.getByRole("button", { name: "Eksport i druk" }).click(); // the app is in Polish here
    await rowMenu.getByRole("button", { name: "Pobierz jako Markdown (.md)", exact: true }).click();
    const text = await page.evaluate(() => window.__exported);
    return text == null ? "<no export>" : text.replace(/\r\n/g, "\n").replace(/^# .*\n+/, "").trim();
  }
  const pane = (index) => block().locator(".core-code-comparison-pane").nth(index);
  const marks = (index, kind) => pane(index).locator(`li.is-${kind}`).count();
  const numbers = (index) => pane(index).locator("li").evaluateAll((items) => items.map((item) => ({ text: item.textContent, number: getComputedStyle(item, "::before").content })));
  const tracks = () => block().locator(".core-code-comparison-panes").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length);

  async function setTheme(label) {
    await page.getByRole("button", { name: "Settings", exact: true }).last().click();
    await page.locator(".core-settings-nav button", { hasText: "Appearance" }).first().click();
    await page.locator("#core-theme").click();
    await page.getByRole("option", { name: label, exact: true }).click();
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).waitFor({ timeout: 10000 });
  }
  // Switch the app to Polish the way the app stores it, then reload.
  async function toPolish() {
    await page.evaluate(() => localStorage.setItem("notible-language", "pl"));
    await page.reload();
    await page.locator("input[type=file][accept*='.md']").waitFor({ state: "attached", timeout: 30000 });
    await page.waitForTimeout(800);
  }
  // A note from a Markdown file: the same import the app offers, no button labels needed.
  async function importNote(title, body) {
    const file = path.join(os.tmpdir(), `${title}.md`);
    fs.writeFileSync(file, `# ${title}\n\n${body}\n`);
    await page.locator("input[type=file][accept*='.md']").setInputFiles(file);
    const row = page.locator(".core-object-row", { hasText: title }).first();
    await row.waitFor({ timeout: 10000 });
    await row.click();
    await page.waitForTimeout(700);
    await caretOut();
  }
  const SAMPLE = "keep\nold\ngone\nend\n=====\nkeep\nnew\nend\nfresh";
  const fenced = (source) => "```compare\n" + source + "\n```";

  try {
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).waitFor({ timeout: 30000 });
    if (THEME !== "Daylight") await setTheme(THEME);
    await toPolish();

    // (a) "/" menu in Polish: the entry is named Porównanie kodu and inserts the block.
    await importNote("Porównanie", "");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await type("/porów");
    await slashMenu.locator("[role=option]", { hasText: "Porównanie kodu" }).first().waitFor({ timeout: 3000 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    const inserted = (await sourceOf()).split("\n");
    check(inserted.includes("====="), "(a) / menu lists Porównanie kodu and picking it inserts a compare block with a ===== line", inserted.join(" | "));
    await page.keyboard.press("Escape");

    // The / menu in Polish: no English command names left in the list.
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await type("/");
    await page.waitForTimeout(400);
    const offered = await slashMenu.locator("[role=option]").allTextContents();
    // Every name in CORE_COMMANDS that has a different Polish text must be gone from the menu.
    const commandNames = [...fs.readFileSync(path.join(repo, "src/core/app/coreCommands.ts"), "utf8").matchAll(/name: tr\("([^"]+)"\)/g)].map((match) => match[1]);
    const polishText = JSON.parse(fs.readFileSync(path.join(repo, "locales/pl.json"), "utf8")).strings.app;
    const translated = commandNames.filter((name) => polishText[name] && polishText[name] !== name);
    const english = offered.filter((row) => translated.some((name) => row.includes(name)));
    check(commandNames.length === 16 && english.length === 0 && offered.some((text) => text.includes("Porównanie kodu")), `(a) in Polish no / entry is English (${translated.length} of ${commandNames.length} names checked)`, english.join(" | "));
    await page.keyboard.press("Escape");
    await caretOut();

    // (b) marks: a removed, an added and a changed line.
    await importNote("Zmiany", fenced(SAMPLE));
    await block().waitFor({ timeout: 10000 });
    check(await marks(0, "removed") >= 1 && await marks(0, "changed") >= 1, "(b) the left pane marks a removed and a changed line");
    check(await marks(1, "added") >= 1 && await marks(1, "changed") >= 1, "(b) the right pane marks an added and a changed line");

    // (c) an empty placeholder row does not advance the line number.
    await importNote("Numery", fenced("x\n=====\ny\nx"));
    await block().waitFor({ timeout: 10000 });
    // The computed ::before only shows the counter rule, not its digit, so this
    // checks the rule: the placeholder takes no number and x is the first numbered row.
    const leftNumbers = await numbers(0);
    const xIndex = leftNumbers.findIndex((item) => item.text === "x");
    const placeholder = leftNumbers.find((item) => item.text.trim() === "");
    check(placeholder?.number === '""' && xIndex === 1 && leftNumbers[xIndex].number === "counter(code-line)", "(c) an empty placeholder row takes no number, so left x is line 1", JSON.stringify(leftNumbers));
    // The rendered number: the placeholder increments nothing, the numbered row increments by one.
    const increments = await pane(0).locator("li").evaluateAll((items) => items.map((item) => ({ text: item.textContent, increment: getComputedStyle(item, "::before").counterIncrement })));
    const placeholderIncrement = increments.find((item) => item.text.trim() === "")?.increment;
    const xIncrement = increments.find((item) => item.text === "x")?.increment;
    check(placeholderIncrement === "none" && xIncrement === "code-line 1", "(c) the rendered counter: the placeholder row increments nothing, x increments by one", JSON.stringify(increments));

    // (d) no ===== line: the missing-divider notice, in Polish.
    await importNote("Bez podziału", fenced("a\nb"));
    await block().waitFor({ timeout: 10000 });
    const noDivider = await block().textContent();
    check(noDivider.includes("Dodaj wiersz ===== między dwoma fragmentami."), "(d) a block with no ===== line shows the missing-divider notice in Polish", noDivider);

    // (e) over 2000 lines: panes, no marks, the too-large notice.
    const big = (prefix) => Array.from({ length: 1100 }, (_, i) => `${prefix} ${i}`).join("\n");
    await importNote("Duży", fenced(`${big("left")}\n=====\n${big("right")}`));
    await block().waitFor({ timeout: 15000 });
    const bigMarks = await page.locator(".core-code-comparison li.is-added, .core-code-comparison li.is-removed, .core-code-comparison li.is-changed").count();
    check(await pane(0).locator("li").count() === 1100 && bigMarks === 0, "(e) over 2000 lines: both panes show and nothing is marked", `marks ${bigMarks}`);
    const bigNotice = await block().textContent();
    check(bigNotice.includes("To porównanie jest zbyt duże"), "(e) over 2000 lines shows the too-large notice in Polish");

    // (f) narrow editor: panes stack. Wide: side by side. Measured on the block's own width.
    await importNote("Szerokość", fenced(SAMPLE));
    await block().waitFor({ timeout: 10000 });
    await block().evaluate((el) => { el.style.width = "400px"; });
    await page.waitForTimeout(300);
    check(await tracks() === 1, "(f) a 400 px editor stacks the two panes", `tracks ${await tracks()}`);
    await block().evaluate((el) => { el.style.width = "100%"; });
    await page.waitForTimeout(300);
    const wide = await block().evaluate((el) => el.getBoundingClientRect().width);
    check(wide > 620 ? await tracks() === 2 : await tracks() === 1, "(f) the editor's own width decides: wide shows two panes side by side", `width ${Math.round(wide)} px, tracks ${await tracks()}`);

    // (g) the toolbar opens the source; leaving re-renders; one Ctrl+Z undoes one edit.
    const original = await sourceOf();
    // Opening the source is the toolbar's job (Mermaid and query blocks share it), not the body's.
    const body = await block().boundingBox();
    await page.mouse.click(body.x + body.width / 2, body.y + body.height / 2);
    await page.waitForTimeout(400);
    check(await editor.locator("pre.core-code-block.is-editing").count() === 0, "(g) a click on the block body does not open its source");
    const strip = await toolbar().boundingBox();
    await page.mouse.click(strip.x + 4, strip.y + strip.height / 2);
    await page.waitForTimeout(400);
    check(await editor.locator("pre.core-code-block.is-editing").count() === 1, "(g) a real click on the toolbar opens its source");
    // Caret at the end of the source itself: Ctrl+End would go to the end of the whole note.
    await editor.locator("pre.core-code-block code").first().evaluate((el) => { const range = document.createRange(); range.selectNodeContents(el); range.collapse(false); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); });
    await type("z"); // one typed run: Enter would start a second undo step
    await page.waitForTimeout(400);
    await caretOut();
    await block().waitFor({ timeout: 10000 });
    const edited = await sourceOf();
    check(edited.endsWith("fresh" + "z") && await block().count() === 1, "(g) leaving the source re-renders the block with the edit", JSON.stringify({ edited, blocks: await block().count(), editing: await editor.locator("pre.core-code-block.is-editing").count() }));
    await undo();
    check(await sourceOf() === original, "(g) one Ctrl+Z undoes one edit", JSON.stringify(await sourceOf()));

    // (i) serialisation: the note's stored Markdown is unchanged by rendering, holds the block source, and no pane text sits outside the block.
    const storedBefore = await savedMarkdown("Szerokość");
    await block().click();
    await caretOut();
    await block().waitFor({ timeout: 10000 });
    const storedAfter = await savedMarkdown("Szerokość");
    const outsideText = await editor.evaluate((root) => Array.from(root.children).filter((el) => !el.matches("pre")).map((el) => el.textContent.replace(/​/g, "")).join("|"));
    const holdsSource = storedAfter.includes("```compare\n" + original + "\n```");
    check(storedAfter === storedBefore && holdsSource && outsideText.trim() === "", "(i) the stored Markdown is unchanged by rendering and holds the block source; no pane text outside the block", JSON.stringify({ holdsSource, outsideText, storedAfter }));

    // Fit at the gate size, in the chosen theme.
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(info.exports, `code-compare-${SIZE}-${THEME}.png`) });
    const fit = await page.evaluate(() => {
      const root = document.scrollingElement;
      const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
      return { overflowX: root.scrollWidth > root.clientWidth + 1, luminance: bg.reduce((sum, v) => sum + v, 0) / 3 };
    });
    const rect = await block().boundingBox();
    check(!fit.overflowX && rect && rect.x + rect.width <= Number(SIZE.split("x")[0]) + 1, `(j) fits ${SIZE} without horizontal page scroll`, JSON.stringify(fit));
    check(THEME === "Midnight" ? fit.luminance < 128 : fit.luminance >= 128, `(j) ${THEME} theme is in effect`, `luminance ${Math.round(fit.luminance)}`);

    // (h) read-only note: not checked. The Core-only UI has no read-only note path in this build.
    console.log("SKIP (h) read-only note: the Core-only UI has no read-only note path in this build");
  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n")[0]}`, error.message.split("\n").slice(1, 12).join("\n"));
  } finally {
    await browser.close().catch(() => {});
    sandboxCli("stop", NAME);
  }
  console.log(failures.length ? `\nCode compare scenario FAILED (${failures.length}) at ${SIZE} ${THEME}` : `\nCode compare scenario passed at ${SIZE} ${THEME}`);
  process.exit(failures.length ? 1 : 0);
})();
