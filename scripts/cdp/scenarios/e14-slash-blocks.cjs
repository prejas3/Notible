// Scenario E14 (repair plan 01.10): the "/" menu offers Table, Link and Image,
// and a plugin's command ("New data table") works from the keyboard.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/e14-slash-blocks.cjs
//
// Needs a fresh `npm run sandbox:build` and internet (Tables comes from the
// market). Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const { writeFileSync, mkdtempSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-e14-slash";
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };
// A 1x1 PNG for the file picker.
const png = path.join(mkdtempSync(path.join(os.tmpdir(), "notible-e14-")), "dot.png");
writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

(async () => {
  const info = JSON.parse(sandboxCli("start", NAME));
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  const editor = page.locator("[contenteditable=true]").first();
  const menu = page.locator(".core-slash-menu");
  const type = (text) => page.keyboard.type(text, { delay: 35 });
  const editorText = () => editor.evaluate((el) => el.innerText.replace(/​/g, ""));

  async function newNote(title) {
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).click();
    await page.getByRole("button", { name: "New note" }).first().click();
    await page.locator(".core-title-input").waitFor();
    await page.waitForTimeout(300);
    await type(title);
    await page.keyboard.press("Enter");
  }
  async function pick(name) {
    const option = menu.locator("[role=option]", { hasText: name }).first();
    await option.waitFor({ timeout: 3000 });
    const index = await menu.locator("[role=option]").evaluateAll((els, wanted) => els.findIndex((el) => el.textContent.includes(wanted)), name);
    for (let i = 0; i < index; i += 1) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
  }

  try {
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).waitFor({ timeout: 30000 });

    await newNote("E14 table");
    await type("/table");
    await pick("Table");
    await type("Name");
    check(await editor.locator("table th").first().textContent() === "Name", "/table inserts a table, caret in its first cell", await editor.evaluate((el) => el.innerHTML));
    // E20: Tab walks the cells and adds a row from the last one; nothing gets glued.
    for (const value of ["Qty", "Eggs", "3"]) { await page.keyboard.press("Tab"); await type(value); }
    await page.keyboard.press("Tab");
    await type("Milk");
    await page.waitForTimeout(300);
    const cells = await editor.locator("table tr").evaluateAll((rows) => rows.map((row) => [...row.children].map((cell) => cell.textContent.replace(/​/g, ""))));
    check(JSON.stringify(cells) === JSON.stringify([["Name", "Qty"], ["Eggs", "3"], ["Milk", ""]]), "E20 Tab fills cells in order and the last cell's Tab adds a row", JSON.stringify(cells));

    await newNote("E14 link");
    await type("/link");
    await pick("Link");
    await type("Docs");
    await page.waitForTimeout(300);
    check((await editor.evaluate((el) => el.textContent)).includes("[Docs](https://)"), "/link leaves the caret on the link text", await editorText());

    await newNote("E14 image");
    await type("/image");
    const chooser = page.waitForEvent("filechooser", { timeout: 5000 });
    await pick("Image");
    await (await chooser).setFiles(png);
    await page.waitForTimeout(1500);
    check(await editor.locator("img").count() === 1, "/image puts the chosen picture into the note", await editor.evaluate((el) => el.innerHTML));

    // CE28: a plugin command chosen with Enter.
    await page.getByRole("button", { name: "Settings", exact: true }).last().click();
    await page.getByRole("button", { name: /^Plugins/ }).click();
    await page.getByRole("tab", { name: "Market" }).or(page.getByRole("button", { name: "Market", exact: true })).first().click();
    await page.getByRole("button", { name: /Notible Tables/ }).click();
    await page.getByRole("button", { name: /^Install/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Install", exact: true }).click();
    await page.getByRole("button", { name: /Notible Tables.*Installed/ }).or(page.getByRole("button", { name: "Installed", exact: true })).first().waitFor({ timeout: 60000 }); // the list hides below 1400 px
    await page.getByRole("button", { name: "Notes", exact: true }).first().click();
    await newNote("E14 data table");
    await type("before /tab");
    await pick("New data table");
    await page.waitForTimeout(1500);
    const text = await editorText();
    check(!text.includes("/tab"), `"/tab" is gone after choosing New data table with Enter (note: ${JSON.stringify(text)})`);
    check(await page.locator(".core-object-row", { hasText: "New table" }).count() >= 1, "New data table chosen with Enter creates the table");
  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n")[0]}`);
  } finally {
    await browser.close().catch(() => {});
    sandboxCli("stop", NAME);
  }
  console.log(failures.length ? `\nE14 slash blocks scenario FAILED (${failures.length})` : "\nE14 slash blocks scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
