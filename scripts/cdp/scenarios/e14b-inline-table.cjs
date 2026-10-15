// Scenario E14b (Hive #2): "/New data table" puts an editable Tables grid
// inside the note, stored in the note as a ```notible-table fence.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/e14b-inline-table.cjs
//
// Needs a fresh `npm run sandbox:build` and internet (Tables comes from the
// market; this repo's main.js + plugin.json are swapped in under the installed
// version). Screenshots for the UI gate land in $SHOTS (default: a temp dir).
// Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const { readdirSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-e14b-inline-table";
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), "notible-e14b-shots");
const CREATE = { name: "Create a note, folder or project", exact: true };
const sandbox = (...args) => JSON.parse(execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" }) || "null");
const failures = [];
let stage = "start";
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };

async function connect(cdp) {
  const browser = await chromium.connectOverCDP(cdp);
  const page = browser.contexts()[0].pages()[0];
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", CREATE).waitFor({ timeout: 30000 });
  return { browser, page };
}
async function restart(...extra) {
  execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), "stop", NAME, "--keep"]);
  return sandbox("start", NAME, "--reuse", ...extra).cdp;
}

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const info = sandbox("start", NAME);
  let session = await connect(info.cdp);
  try {
    let { page } = session;
    const editor = () => page.locator("[contenteditable=true]").first();
    const type = (text) => page.keyboard.type(text, { delay: 30 });
    const cells = () => page.locator(".nt-embed td[data-row-id] input");
    const values = () => cells().evaluateAll((inputs) => inputs.map((input) => input.value));
    const outsideText = () => editor().evaluate((el) => [...el.childNodes].filter((node) => !(node.nodeType === 1 && node.matches("pre"))).map((node) => node.textContent).join("\n").replace(/​/g, ""));
    const openSettingsPlugins = async () => {
      await page.getByRole("button", { name: "Settings", exact: true }).last().click();
      await page.getByRole("button", { name: /^Plugins/ }).click();
    };
    const setPlugin = async (name, on) => {
      await openSettingsPlugins();
      await page.getByRole("button", { name: new RegExp(name) }).first().click();
      await page.waitForTimeout(500);
      const sw = page.locator(".core-plugins-detail-pane .core-plugin-detail-actions .core-switch").first();
      const checked = await sw.evaluate((el) => el.getAttribute("aria-checked") === "true" || el.querySelector("input")?.checked === true || el.classList.contains("is-on"));
      if (checked !== on) { await sw.click(); await page.waitForTimeout(1500); }
      await page.locator(".core-back-button").click();
      await page.waitForTimeout(500);
    };
    const openNote = async (title) => { await page.locator(".core-object-row", { hasText: title }).first().click(); await page.waitForTimeout(600); };
    const pick = async (name) => {
      const menu = page.locator(".core-slash-menu");
      await menu.locator("[role=option]", { hasText: name }).first().waitFor({ timeout: 3000 });
      const index = await menu.locator("[role=option]").evaluateAll((els, wanted) => els.findIndex((el) => el.textContent.includes(wanted)), name);
      for (let i = 0; i < index; i += 1) await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(800);
    };
    const newNote = async (title) => {
      await page.getByRole("button", CREATE).click();
      await page.getByRole("button", { name: "New note" }).first().click();
      await page.locator(".core-title-input").waitFor();
      await page.waitForTimeout(300);
      await type(title);
      await page.keyboard.press("Enter");
    };
    const clickEndOfLastLine = async () => {
      const box = await editor().evaluate((el) => { const last = [...el.children].filter((c) => !c.matches("pre")).pop(); const r = last.getBoundingClientRect(); return { x: r.right - 2, y: r.top + r.height / 2 }; });
      await page.mouse.click(box.x, box.y);
      await page.keyboard.press("End");
    };

    stage = "install";
    await openSettingsPlugins();
    await page.getByRole("tab", { name: "Market" }).or(page.getByRole("button", { name: "Market", exact: true })).first().click();
    await page.getByRole("button", { name: /Notible Tables/ }).click();
    await page.getByRole("button", { name: /^Install/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Install", exact: true }).click();
    // Below 1400 px the details pane hides the list, so its "Installed" button is the sign.
    await page.getByRole("button", { name: /Notible Tables.*Installed/ }).or(page.getByRole("button", { name: "Installed", exact: true })).first().waitFor({ timeout: 60000 });
    const versions = path.join(info.dir, "data", "plugins", "notible.tables", "versions");
    for (const version of readdirSync(versions)) {
      const at = (file) => path.join(versions, version, file);
      writeFileSync(at("main.js"), readFileSync(path.join(repo, "plugins/notible-tables/main.js"), "utf8").replace(/version: "[^"]+"/, `version: "${version}"`));
      writeFileSync(at("plugin.json"), readFileSync(path.join(repo, "plugins/notible-tables/plugin.json"), "utf8").replace(/"version": "[^"]+"/, `"version": "${version}"`));
    }
    await session.browser.close();
    session = await connect(await restart());
    page = session.page;
    await setPlugin("Editor extensions", true);
    await setPlugin("Embedded queries", true);
    await page.getByRole("button", { name: "Notes", exact: true }).first().click().catch(() => {});

    stage = "1 insert";
    await newNote("Bystander");
    await type("Nothing here.");
    await newNote("Inline table");
    const rowsBefore = await page.locator(".core-object-row").count();
    await type("/data");
    await pick("New data table");
    await cells().first().waitFor({ timeout: 5000 }).catch(() => {});
    check(await page.locator(".nt-embed").count() === 1, "1. /data + Enter puts one grid into the note", await editor().evaluate((el) => el.innerHTML.slice(0, 400)));
    check(await page.locator(".core-object-row").count() === rowsBefore, "1. no new object in the sidebar");
    check(await page.locator(".core-slash-menu [role=option]", { hasText: "New data table" }).count() === 0, "1. the slash menu closed");

    stage = "2 fast typing";
    await cells().first().click();
    await page.keyboard.type("alpha", { delay: 5 }); await page.keyboard.press("Tab");
    await page.keyboard.type("beta", { delay: 5 }); await page.keyboard.press("Tab");
    await page.keyboard.type("gamma", { delay: 5 });
    await page.waitForTimeout(1200);
    check(await page.evaluate(() => Boolean(document.activeElement?.closest(".nt-embed"))), "2. focus stays in the grid while the note saves");
    check(JSON.stringify((await values()).slice(0, 3)) === JSON.stringify(["alpha", "beta", "gamma"]), "2. all three values show", JSON.stringify(await values()));

    stage = "3+6 typing around it";
    await clickEndOfLastLine();
    await type("After the table");
    await page.waitForTimeout(600);
    check((await values()).slice(0, 3).join() === "alpha,beta,gamma", "6. typing a line under the grid keeps its values");
    check((await outsideText()).includes("After the table"), "6. the line is in the note", await outsideText());
    await cells().nth(0).click();
    await cells().nth(1).click({ modifiers: ["Shift"] });
    await clickEndOfLastLine();
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(600);
    check((await values()).slice(0, 3).join() === "alpha,beta,gamma", "3. Backspace in the note text leaves the selected cells alone", JSON.stringify(await values()));
    check((await outsideText()).includes("After the tabl") && !(await outsideText()).includes("After the table"), "3. Backspace edited the note text", await outsideText());

    stage = "4 leave right after an edit";
    await cells().nth(3).click();
    await page.keyboard.type("delta", { delay: 5 });
    await page.locator(".core-object-row", { hasText: "Bystander" }).first().click({ delay: 0 });
    await page.waitForTimeout(800);
    await openNote("Inline table");
    await cells().first().waitFor({ timeout: 5000 });
    check((await values())[3] === "delta", "4. an edit followed at once by switching notes is kept", JSON.stringify(await values()));
    // Final review: a keyboard switch (Alt+Left) never blurs the cell first.
    await cells().nth(6).click();
    await page.keyboard.type("epsilon", { delay: 5 });
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(800);
    await openNote("Inline table");
    await cells().first().waitFor({ timeout: 5000 });
    check((await values())[6] === "epsilon", "4b. a cell still being typed in is kept when Alt+Left leaves the note", JSON.stringify(await values()));

    stage = "5 other blocks";
    await clickEndOfLastLine();
    await page.keyboard.press("Enter");
    await type("/mermaid");
    await pick("Mermaid diagram");
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await type("/live");
    await pick("Live list");
    await page.waitForTimeout(2000);
    const renders = await page.locator(".core-code-render").evaluateAll((els) => els.map((el) => ({ svg: Boolean(el.querySelector("svg")), text: el.textContent.trim().length, table: Boolean(el.querySelector(".nt-embed")) })));
    check(renders.some((r) => r.svg), "5. the Mermaid block renders beside the table", JSON.stringify(renders));
    check(renders.length >= 3 && renders.every((r) => r.svg || r.text > 0), "5. the query block renders too", JSON.stringify(renders));
    check((await values()).slice(0, 4).join() === "alpha,beta,gamma,delta", "5. the table still holds its values");

    stage = "7 restart";
    await page.waitForTimeout(1200);
    await session.browser.close();
    session = await connect(await restart());
    page = session.page;
    await openNote("Inline table");
    await cells().first().waitFor({ timeout: 8000 });
    check((await values()).slice(0, 4).join() === "alpha,beta,gamma,delta", "7. values survive a restart", JSON.stringify(await values()));

    stage = "8 delete + undo";
    // A known line: after a restart the last child can be an empty spot the click misses.
    await editor().getByText("After the tabl").click();
    const focusAt = await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className} sel=${JSON.stringify(String(getSelection()?.anchorNode?.textContent).slice(0, 40))}`);
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(1200);
    check(await page.locator(".nt-embed").count() === 0, "8. deleting everything removes the grid", `focus: ${focusAt}; text: ${JSON.stringify((await editor().innerText()).slice(0, 200))}`);
    await page.keyboard.press("Control+Z");
    await page.waitForTimeout(1200);
    await cells().first().waitFor({ timeout: 5000 }).catch(() => {});
    check((await values()).slice(0, 4).join() === "alpha,beta,gamma,delta", "8. Ctrl+Z brings the grid back with its values", JSON.stringify(await values()));

    stage = "9 grid undo";
    const textBefore = await outsideText();
    await cells().nth(4).click();
    await page.keyboard.type("zzz", { delay: 5 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await cells().nth(4).click();
    await page.keyboard.press("Control+Z");
    await page.waitForTimeout(800);
    check((await values())[4] === "", "9. Ctrl+Z in the grid reverts the cell", JSON.stringify(await values()));
    check((await outsideText()) === textBefore, "9. and leaves the note text alone", `${JSON.stringify(textBefore)} → ${JSON.stringify(await outsideText())}`);

    stage = "11 screenshots";
    await page.waitForTimeout(1000);
    await session.browser.close();
    for (const [size, theme] of [["1024x700", "paper"], ["1024x700", "night"], ["1920x1080", "paper"], ["1920x1080", "night"]]) {
      session = await connect(await restart("--size", size));
      page = session.page;
      await page.evaluate((value) => localStorage.setItem("notible-core-theme", value), theme);
      await page.reload();
      await page.getByRole("button", CREATE).waitFor({ timeout: 30000 });
      await openNote("Inline table");
      await cells().first().waitFor({ timeout: 8000 });
      await cells().first().click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SHOTS, `${size}-${theme}.png`) });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(overflow <= 0, `11. ${size} ${theme}: no sideways page scroll (${overflow}px)`);
      await session.browser.close();
    }
    session = await connect(await restart());
    page = session.page;

    stage = "10 Tables off";
    await setPlugin("Notible Tables", false);
    await openNote("Inline table");
    await page.waitForTimeout(800);
    const code = await page.locator("pre.core-code-block code").allTextContents();
    check(await page.locator(".nt-embed").count() === 0 && code.some((text) => text.includes('"v":1') && text.includes("alpha")), "10. with Tables off the block shows as its JSON source", JSON.stringify(code).slice(0, 300));
    await page.screenshot({ path: path.join(SHOTS, "tables-off.png") });
  } catch (error) {
    check(false, `scenario crashed at ${stage}: ${error.message.split("\n")[0]}`);
    await session.page.screenshot({ path: path.join(SHOTS, "crash.png") }).catch(() => {});
  } finally {
    await session.browser.close().catch(() => {});
    execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), "stop", NAME]);
  }
  console.log(`screenshots: ${SHOTS}`);
  console.log(failures.length ? `\nE14b inline table scenario FAILED (${failures.length})` : "\nE14b inline table scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
