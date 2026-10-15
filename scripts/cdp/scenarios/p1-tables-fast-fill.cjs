// Scenario P1 (repair plan 01.10): Tables must survive fast typing.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/p1-tables-fast-fill.cjs [--market]
//
// Starts its own sandbox (docs/AGENT_SANDBOX.md), installs Tables from the
// market, then (unless --market) swaps in this repo's plugins/notible-tables/main.js
// so the unreleased fix is what runs. Fills rows with Tab-Tab-Enter at full
// speed and checks: no "Could not save" toast, every value stored, Enter on the
// last row adds a row, values survive an app restart, the format bar doesn't
// cover the headers, delete "×" hidden until hover. Exit code 1 on any failure.
// --market tests the published version instead (0.6.8 fails: conflict + lost cells).
const { execFileSync } = require("node:child_process");
const { readdirSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-p1-tables-scenario";
const useRepo = !process.argv.includes("--market");
const sandbox = (...args) => JSON.parse(execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" }) || "null");
const failures = [];
let stage = "start";
let title = "";
const check = (ok, message) => { console.log(`${ok ? "PASS" : "FAIL"} ${message}`); if (!ok) failures.push(message); };

async function connect(cdp) {
  const browser = await chromium.connectOverCDP(cdp);
  const page = browser.contexts()[0].pages()[0];
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).waitFor({ timeout: 30000 });
  return { browser, page };
}

async function restart() {
  execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), "stop", NAME, "--keep"]);
  return sandbox("start", NAME, "--reuse").cdp;
}

const tableRows = (page) => page.$$eval("tbody tr", (trs) => trs
  .filter((tr) => tr.querySelector("td[data-row-id]"))
  .map((tr) => [...tr.querySelectorAll("td[data-row-id] input")].map((input) => input.value).join(",")));

(async () => {
  let info = sandbox("start", NAME);
  let session = await connect(info.cdp);
  try {
    let { page } = session;

    stage = "install";
    // Install Tables from the market (official: no trust dialog).
    await page.getByRole("button", { name: "Settings", exact: true }).last().click();
    await page.getByRole("button", { name: /^Plugins/ }).click();
    await page.getByRole("tab", { name: "Market" }).or(page.getByRole("button", { name: "Market", exact: true })).first().click();
    await page.getByRole("button", { name: /Notible Tables/ }).click();
    await page.getByRole("button", { name: /^Install/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Install", exact: true }).click();
    await page.getByRole("button", { name: /Notible Tables.*Installed/ }).or(page.getByRole("button", { name: "Installed", exact: true })).first().waitFor({ timeout: 60000 }); // the list hides below 1400 px

    stage = "swap in repo main.js";
    if (useRepo) {
      const versions = path.join(info.dir, "data", "plugins", "notible.tables", "versions");
      // The repo's code under the installed version number: the loader checks
      // that main.js's manifest version matches the installed one.
      for (const version of readdirSync(versions)) {
        const code = readFileSync(path.join(repo, "plugins/notible-tables/main.js"), "utf8").replace(/version: "[^"]+"/, `version: "${version}"`);
        writeFileSync(path.join(versions, version, "main.js"), code);
        // plugin.json too: 0.7.0 asks for editor.extension (Hive #2), and the manifests must agree.
        writeFileSync(path.join(versions, version, "plugin.json"), readFileSync(path.join(repo, "plugins/notible-tables/plugin.json"), "utf8").replace(/"version": "[^"]+"/, `"version": "${version}"`));
      }
      await session.browser.close();
      session = await connect(await restart());
      page = session.page;
    }

    stage = "fill";
    // A note the keyboard must never reach: round 2 (01.10) typed rows into one.
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).click();
    await page.getByRole("button", { name: "New note" }).first().click();
    await page.locator(".core-title-input").waitFor();
    await page.keyboard.type("Bystander note");
    await page.waitForTimeout(1200);
    // Create a table, rename its headers (that emptied the selection state),
    // then fill it as fast as Playwright types.
    await page.getByRole("button", { name: "Create a note, folder or project", exact: true }).click();
    await page.getByRole("button", { name: "Data table" }).first().click();
    await page.locator("td[data-row-id] input").first().waitFor();
    // Rename the table first: Core's title save raced the plugin's cell saves,
    // showed a bare "conflict" and lost the title after a restart (round 3).
    await page.locator(".core-title-input").click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Office move budget", { delay: 15 });
    title = "Office move budget";
    const headers = page.locator("input.ntbl-th-input");
    for (const [i, name] of ["Item", "Amount", "Notes"].entries()) { await headers.nth(i).click(); await page.keyboard.press("Control+A"); await page.keyboard.type(name, { delay: 8 }); }
    const toasts = new Set();
    const poll = setInterval(() => page.evaluate(() => document.body.innerText).then((text) => {
      // Also Core's own bare "conflict" banner (the lost table title, round 3).
      for (const match of text.match(/Could not save[^\n]*|^conflict$/gim) ?? []) toasts.add(match);
    }).catch(() => {}), 30);
    await page.locator("td[data-row-id] input").first().click();
    // 30 rows: the table starts with 3, so 27 come from Enter on the last row.
    const expected = Array.from({ length: 30 }, (_, i) => `Line ${i + 1},${(i + 1) * 125},${i % 3 ? "Pending" : "Approved"}`);
    let escaped = null;
    for (const row of expected) {
      const [a, b, c] = row.split(",");
      await page.keyboard.type(a, { delay: 3 }); await page.keyboard.press("Tab");
      await page.keyboard.type(b, { delay: 3 }); await page.keyboard.press("Tab");
      await page.keyboard.type(c, { delay: 3 }); await page.keyboard.press("Enter");
      if (!escaped && !(await page.evaluate(() => Boolean(document.activeElement?.closest("td[data-row-id]"))))) escaped = row;
    }
    await page.waitForTimeout(2500);
    clearInterval(poll);
    check(!escaped, `Tab/Enter never leave the grid (left it after ${escaped ?? "-"})`);
    check(toasts.size === 0, `no save error toast (saw: ${[...toasts].join(" | ") || "none"})`);
    const rows = await tableRows(page);
    check(JSON.stringify(rows.slice(0, 30)) === JSON.stringify(expected), `Tab-Tab-Enter fills 30 rows in order after renaming headers (first wrong: ${JSON.stringify(rows.slice(0, 30).find((r, i) => r !== expected[i]) ?? "none")})`);
    check(await page.locator(".core-object-row", { hasText: "Bystander note" }).count() === 1, "the other note keeps its title");

    // Sticky header: after scrolling, no strip of rows may show above it
    // (bug report: "a couple of pixels above the headers").
    const gap = await page.evaluate(async () => {
      // The box that really scrolls: .core-main since 0.93.3 (one scroll area, T6), .core-container-slot before.
      let slot = document.querySelector(".ntbl-th").parentElement;
      while (slot && !(/(auto|scroll)/.test(getComputedStyle(slot).overflowY) && slot.scrollHeight > slot.clientHeight)) slot = slot.parentElement;
      slot.scrollTop = 517.5; // a fractional position, like a wheel leaves it
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const clips = []; for (let el = document.querySelector(".ntbl-th").parentElement; el && el !== slot; el = el.parentElement) { const st = getComputedStyle(el); if (st.overflowX !== "visible" || st.overflowY !== "visible") clips.push(`${el.className.toString().slice(0, 40)}:${st.overflowX}/${st.overflowY}`); }
      return { gap: document.querySelector(".ntbl-th").getBoundingClientRect().top - slot.getBoundingClientRect().top, clips, pad: getComputedStyle(slot).paddingTop, scroller: slot.className.toString().slice(0, 30) };
    });
    check(gap.gap <= 0, `the sticky header leaves no gap above it (${gap.gap.toFixed(2)} px) ${JSON.stringify(gap)}`);
    await page.evaluate(() => { document.querySelector(".core-container-slot").scrollTop = 0; });

    stage = "format bar";
    // Format bar must not cover the column headers.
    const cells = page.locator("tbody tr").first().locator("td[data-row-id]");
    await cells.nth(0).click();
    await cells.nth(1).click({ modifiers: ["Shift"] });
    const bar = page.locator(".ntbl-format-bar").first();
    if (await bar.isVisible().catch(() => false)) {
      const barBox = await bar.boundingBox();
      const headBox = await page.locator("thead").boundingBox();
      check(barBox.y >= headBox.y + headBox.height || barBox.y + barBox.height <= headBox.y, "format bar leaves the headers readable");
    } else {
      check(false, "format bar appears for a 2-cell selection");
    }

    // Delete buttons hidden until hover.
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur());
    const opacity = await page.locator(".ntbl-row-remove").last().evaluate((el) => getComputedStyle(el).opacity);
    check(opacity === "0", `row delete × hidden while not hovered (opacity ${opacity})`);

    stage = "restart";
    // Survives a restart.
    await session.browser.close();
    session = await connect(await restart());
    page = session.page;
    if (!(await page.locator("td[data-row-id] input").first().isVisible().catch(() => false))) await page.getByRole("button", { name: title || "New table" }).first().click();
    await page.locator("td[data-row-id] input").first().waitFor();
    const after = await tableRows(page);
    check(JSON.stringify(after.slice(0, 30)) === JSON.stringify(expected), `the table and all 30 rows survive a restart (got ${after.length} rows)`);
    const titleAfter = await page.locator(".core-title-input").inputValue();
    check(titleAfter === "Office move budget", `the renamed table keeps its title after a restart (got ${JSON.stringify(titleAfter)})`);
  } catch (error) {
    check(false, `scenario crashed at ${stage}: ${error.message.split("\n")[0]}`);
    console.log("title:", JSON.stringify(title), "| buttons:", await session.page.$$eval("button", (els) => els.filter((e) => e.offsetParent).map((e) => e.textContent.trim()).filter(Boolean).slice(0, 15).join(" | ")).catch(() => "?"));
  } finally {
    await session.browser.close().catch(() => {});
    execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), "stop", NAME]);
  }
  console.log(failures.length ? `\nP1 scenario FAILED (${failures.length})` : "\nP1 scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
