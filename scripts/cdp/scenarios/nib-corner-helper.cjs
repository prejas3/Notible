// Scenario (API 1.22, the "Nib" helper): the workspace.corner slot, context.help
// and the gesture-gated openHelp / openPluginSettings, in the real app.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/nib-corner-helper.cjs
//
// Installs plugins/examples/corner-helper as a local plugin (registry +
// trust, the native dialog auto-approved by the sandbox), then checks: the
// corner shows bottom-left of the note area with Core's caption, the plugin
// sees Help topics and Planning as "disabled", a call without a click is
// refused, Help and Settings hide the corner without unmounting it, "Turn on
// Planning" lands on Planning's details and ignores an immediate click, and
// "None" in Settings → Plugins empties the corner. Needs a fresh
// `npm run sandbox:build`. Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-nib-corner";
const pluginDir = path.join(repo, "plugins/examples/corner-helper");
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };
const CREATE = { name: "Create a note, folder or project", exact: true };

(async () => {
  const info = JSON.parse(sandboxCli("start", NAME, "--size", "1360x820"));
  let browser = await chromium.connectOverCDP(info.cdp);
  let page = browser.contexts()[0].pages()[0];
  try {
    await page.getByRole("button", CREATE).waitFor({ timeout: 30000 });

    // Install the example as a local plugin, the way installFromRoot does.
    // The folder picker (answered by the sandbox) is what links the folder,
    // so the app may read the plugin's files.
    const dir = pluginDir.split(path.sep).join("/");
    sandboxCli("pick", NAME, dir);
    const manifest = readFileSync(path.join(pluginDir, "plugin.json"), "utf8");
    const installed = await page.evaluate(async ({ manifest, dir }) => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const picked = await invoke("pick_folder");
      if (!picked) throw new Error("the sandbox did not answer the folder picker");
      const parsed = JSON.parse(manifest);
      await invoke("upsert_plugin_registry", { pluginId: parsed.id, version: parsed.version, source: "local-file", installPath: picked, manifest: JSON.stringify(parsed), verified: false });
      const granted = await invoke("grant_plugin_trust", { pluginId: parsed.id, version: parsed.version });
      await invoke("set_plugin_registry_state", { pluginId: parsed.id, version: parsed.version, pluginState: "active" });
      return granted.user_trusted || granted.verified;
    }, { manifest, dir });
    check(installed, "the example plugin is trusted (sandbox approved the native dialog)");
    await page.reload();
    await page.getByRole("button", CREATE).waitFor({ timeout: 30000 });
    // A first run may open on Help, where the corner is (rightly) hidden.
    await page.locator(".core-nav button", { hasText: "Notes" }).first().click();
    const corner = page.locator(".core-corner");
    await corner.waitFor({ timeout: 20000 }).catch(async (error) => {
      const registry = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_plugin_registry"));
      console.log(await page.evaluate(() => { const c = document.querySelector(".core-corner"); return c ? `${c.className} ${getComputedStyle(c).display} ${JSON.stringify(c.getBoundingClientRect())}` : `no corner; slots: ${document.querySelectorAll("[data-plugin]").length}`; }));
      throw new Error(`${error.message.split("\n")[0]} — registry: ${JSON.stringify(registry.map((entry) => [entry.plugin_id, entry.state, entry.last_error]))}`);
    });

    const layout = await page.evaluate(() => {
      const box = document.querySelector(".core-corner").getBoundingClientRect();
      const main = document.querySelector(".core-main").getBoundingClientRect();
      const sidebar = document.querySelector(".core-sidebar").getBoundingClientRect();
      return { left: box.left, bottom: box.bottom, mainLeft: main.left, sidebarRight: sidebar.right, height: innerHeight, width: innerWidth, docWidth: document.documentElement.scrollWidth };
    });
    check(layout.left >= layout.mainLeft && layout.left >= layout.sidebarRight, `the corner sits in the note area, not over the sidebar (left ${Math.round(layout.left)}, main ${Math.round(layout.mainLeft)})`);
    check(layout.bottom <= layout.height && layout.bottom > layout.height - 40, `the corner hugs the bottom of the window (bottom ${Math.round(layout.bottom)} of ${layout.height})`);
    check(layout.docWidth <= layout.width, `nothing is drawn wider than the window (${layout.docWidth} of ${layout.width})`);
    const caption = await page.locator(".core-corner-caption").textContent();
    check(caption.includes("Corner helper example") && caption.includes("example.corner-helper"), `Core draws the caption under the box ("${caption}")`);

    const box = page.locator(".corner-helper-example");
    const data = await box.evaluate((el) => ({ ...el.dataset }));
    check(Number(data.topics) > 20, `the plugin sees this build's Help topics (${data.topics})`);
    check(data.planning === "disabled", `Planning (off by default) is "disabled" (${data.planning})`);
    check(data.noGesture === "refused", `openHelp without a click is refused (${data.noGesture})`);
    check(data.imageDropped === "true", "renderMarkdown drops images (no fake banners)");
    check(caption.includes("unverified"), "an unsigned helper is captioned unverified");

    await box.getByRole("button", { name: "Explain writing" }).click();
    const answer = await page.locator(".corner-helper-answer").innerHTML();
    check(answer.length > 20 && !/<script/i.test(answer), "renderMarkdown gives the plugin Help text as safe HTML");

    await box.getByRole("button", { name: "Count" }).click();
    await box.getByRole("button", { name: "Open Help" }).click();
    await page.locator(".core-help").waitFor({ timeout: 5000 });
    check(await page.locator(".core-help-title").textContent() === "Writing notes", "the plugin's click opened Help at the right page");
    check(await corner.evaluate((el) => getComputedStyle(el).display === "none"), "the corner is hidden on Help");
    check(await box.count() === 1, "…but still mounted");
    await page.locator(".core-back-button").click();
    await page.waitForTimeout(300);
    check(await corner.evaluate((el) => getComputedStyle(el).display !== "none"), "the corner is back on the notes screen");
    check(await box.evaluate((el) => el.dataset.clicks) === "1", "the helper kept its state through Help");

    await page.waitForTimeout(1100); // past the one-navigation-a-second limit
    // Click Planning's switch the moment it appears: a plugin could open
    // Settings under the cursor so the user's next click flips a switch.
    await box.getByRole("button", { name: "Turn on Planning" }).click();
    const clicked = await page.evaluate(() => new Promise((resolve) => {
      const started = performance.now();
      const tryClick = () => {
        const row = [...document.querySelectorAll(".core-plugin-index-row")].find((candidate) => candidate.textContent.includes("Planning"));
        const input = row?.querySelector(".core-switch input");
        if (input) { const before = input.checked; input.click(); setTimeout(() => resolve({ before, after: input.checked, ms: Math.round(performance.now() - started) }), 150); return; }
        if (performance.now() - started > 3000) { resolve(null); return; }
        requestAnimationFrame(tryClick);
      };
      tryClick();
    }));
    check(Boolean(clicked) && clicked.after === clicked.before, `a click right after the plugin opened Settings is ignored (${clicked ? `${clicked.ms} ms after, ${clicked.before} → ${clicked.after}` : "no switch"})`);
    await page.locator(".core-plugins-detail-pane").getByText("Planning").first().waitFor({ timeout: 5000 });
    check(true, "openPluginSettings landed on Planning's details");

    // Settings → Plugins: the corner picker, set to None. Below 1400 px the
    // details replace the list, so go back to it first.
    const back = page.locator(".core-plugin-detail-back");
    if (await back.isVisible()) await back.click();
    const picker = page.locator("#core-corner-helper");
    check(await picker.count() === 1, "Settings → Plugins offers a Corner helper picker");
    await picker.click();
    await page.getByRole("option", { name: "None" }).click();
    await page.locator(".core-back-button").click();
    await page.waitForTimeout(300);
    check(await page.locator(".core-corner").count() === 0, "\"None\" empties the corner");
  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n")[0]}`);
  } finally {
    await browser.close().catch(() => {});
    sandboxCli("stop", NAME);
  }
  console.log(failures.length ? `\nNib corner helper scenario FAILED (${failures.length})` : "\nNib corner helper scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
