// Scenario: the Nib plugin (plugins/notible-nib) in the real app.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/nib-plugin.cjs
//
// Installs Nib as a local plugin (folder picker answered by the sandbox, then
// registry + trust), and checks: the corner and caption, the one-time intro,
// opening by click, the three starters answered from Help with no unsafe HTML,
// a help link and Open in Help, "turned off" → Turn on Planning → "Planning is
// on now.", don't know, the hotkey and Escape returning focus, the hotkey also
// firing inside a note (documented v1 limitation), reduced motion, dark theme,
// restart (intro not shown again, nothing but schema/introSeen stored) and
// Polish. Needs a fresh `npm run sandbox:build`. Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const NAME = process.env.SANDBOX || "claude-nib-plugin";
const pluginDir = path.join(repo, "plugins/notible-nib");
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };
const CREATE = { name: /^(Create a note, folder or project|Utwórz notatkę, folder lub projekt)$/ };

async function connect(cdp) {
  const browser = await chromium.connectOverCDP(cdp);
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole("button", CREATE).first().waitFor({ timeout: 30000 });
  await page.locator(".core-nav button").first().click();
  return { browser, page };
}

(async () => {
  let info = JSON.parse(sandboxCli("start", NAME, "--size", "1360x820"));
  let { browser, page } = await connect(info.cdp);
  const nib = () => page.locator(".core-corner .nib");
  const askNib = async (question) => {
    const input = page.locator("#nib-question");
    await input.fill(question);
    await input.press("Enter");
    await page.waitForTimeout(450);
  };
  try {
    // Install from the folder, as nib-corner-helper.cjs does.
    sandboxCli("pick", NAME, pluginDir.split(path.sep).join("/"));
    const manifest = readFileSync(path.join(pluginDir, "plugin.json"), "utf8");
    const trusted = await page.evaluate(async (manifest) => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const picked = await invoke("pick_folder");
      const parsed = JSON.parse(manifest);
      await invoke("upsert_plugin_registry", { pluginId: parsed.id, version: parsed.version, source: "local-file", installPath: picked, manifest: JSON.stringify(parsed), verified: false });
      const granted = await invoke("grant_plugin_trust", { pluginId: parsed.id, version: parsed.version });
      await invoke("set_plugin_registry_state", { pluginId: parsed.id, version: parsed.version, pluginState: "active" });
      return granted.user_trusted || granted.verified;
    }, manifest);
    check(trusted, "Nib is installed and trusted");
    await page.reload();
    await page.getByRole("button", CREATE).first().waitFor({ timeout: 30000 });
    // A scripted click sends no pointerdown, so it doesn't dismiss the intro.
    await page.locator(".core-nav button").first().evaluate((el) => el.click());
    await nib().waitFor({ timeout: 20000 });

    // 1. Corner, caption, intro.
    const caption = await page.locator(".core-corner-caption").innerText();
    check(/Nib/.test(caption) && /notible\.nib/.test(caption), `Core captions the corner ("${caption}")`);
    const wake = page.locator(".nib-wake");
    const wakeBox = await wake.boundingBox();
    check(wakeBox && wakeBox.width <= 72 && wakeBox.height <= 72, `collapsed Nib is small (${wakeBox && Math.round(wakeBox.width)}×${wakeBox && Math.round(wakeBox.height)})`);
    check(await page.locator(".nib-bubble").count() === 1, "the one-time intro shows");
    await page.waitForTimeout(300);
    const drawn = await page.locator(".nib-wake canvas").evaluate((canvas) => { const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data; let paper = 0; let ink = 0; for (let i = 0; i < data.length; i += 4) { if (data[i + 3] < 200) continue; if (data[i] > 230 && data[i + 1] > 230) paper += 1; else ink += 1; } return { paper, ink }; });
    check(drawn.paper > 200 && drawn.ink > 50, `the fella is drawn: a paper note with an outline and a face (${JSON.stringify(drawn)})`);
    if (process.env.NIB_SHOTS) await page.locator(".core-corner").first().screenshot({ path: require("path").join(process.env.NIB_SHOTS, "nib-paper.png") }).catch(() => {});

    // 2. Opening.
    await wake.click();
    check(await page.locator(".nib-bubble").count() === 0, "the intro goes away on a click");
    const panel = page.locator(".nib-panel");
    await panel.waitFor();
    check(await page.evaluate(() => document.activeElement?.id === "nib-question"), "opening focuses the question box");
    const panelBox = await panel.boundingBox();
    check(panelBox.width <= 380 && panelBox.height <= 560 && panelBox.y >= 0 && panelBox.y + panelBox.height <= 820, `the panel fits the corner budget and the window (${Math.round(panelBox.width)}×${Math.round(panelBox.height)})`);
    check(await page.locator(".nib-panel .nib-action").count() >= 3, "the empty panel offers the starter questions");

    // 3. Core answers.
    for (const starter of ["How do I link notes?", "Keyboard shortcuts", "How do I restore a deleted note?"]) {
      await askNib(starter);
      const meta = await page.locator(".nib-body-scroll .nib-meta").first().innerText();
      const html = await page.locator(".nib-body-scroll").innerHTML();
      check(meta.startsWith("Help ·"), `"${starter}" is answered from Help (${meta})`);
      check(!/<script|\shref=|<img/iu.test(html), `"${starter}": no script, href or image in the answer`);
    }
    await askNib("what is a workspace");
    const helpLink = page.locator(".nib-excerpt [data-url^='https://nib.invalid/help/']").first();
    if (await helpLink.count()) {
      await helpLink.click();
      await page.locator(".core-help").waitFor({ timeout: 4000 });
      check(true, "a help: link in an answer opens Help");
      await page.locator(".core-back-button").click();
      await page.waitForTimeout(400);
    } else {
      check(true, "(no help: link in this answer to click)");
    }
    await page.locator(".nib-action", { hasText: "Open in Help" }).click();
    await page.locator(".core-help").waitFor({ timeout: 4000 });
    check(/Organising your work|containers/i.test(await page.locator(".core-help-title").innerText()), "Open in Help lands on the answer's page");
    check(await page.locator(".core-corner").evaluate((el) => getComputedStyle(el).display === "none"), "the corner hides on Help");
    await page.locator(".core-back-button").click();
    await page.waitForTimeout(400);
    check((await page.locator(".nib-body-scroll").innerText()).includes("Help ·"), "the answer is still there after Help");

    // 4. Turned off → Turn on → on now.
    await askNib("gantt chart");
    check(/turned off/i.test(await page.locator(".nib-body-scroll").innerText()), "gantt chart: Planning is turned off");
    await page.waitForTimeout(1100);
    await page.locator(".nib-action", { hasText: "Turn on Planning" }).click();
    await page.locator(".core-plugins-detail-pane").getByText("Planning").first().waitFor({ timeout: 5000 });
    await page.waitForTimeout(700);
    // The details pane has the plugin's own switch (below 1400 px the list is hidden behind it).
    await page.locator(".core-plugins-detail-pane .core-plugin-detail-actions .core-switch").first().click();
    await page.waitForTimeout(1500);
    await page.locator(".core-back-button").click();
    await page.waitForTimeout(800);
    check(/Planning is on now/.test(await page.locator(".nib-body-scroll").innerText()), "after turning Planning on, Nib re-answers: \"Planning is on now.\"");

    // 5. Don't know.
    await askNib("asdf qwerty");
    check(/don't have information/.test(await page.locator(".nib-body-scroll").innerText()), "asdf qwerty: I don't have information about that yet.");

    // 6. Hotkey, Escape, focus; and the v1 limitation inside a note.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    check(await page.locator(".nib-panel").count() === 0, "Escape closes Nib");
    const row = page.locator(".core-nav button").first();
    await row.focus();
    await page.keyboard.press("Control+Shift+H");
    await page.waitForTimeout(300);
    check(await page.evaluate(() => document.activeElement?.id === "nib-question"), "Ctrl+Shift+H opens Nib with focus in the box");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    check(await page.evaluate(() => document.activeElement?.classList.contains("is-active") || document.activeElement?.closest(".core-nav") !== null), "Escape returns focus to where it was");
    await page.getByRole("button", CREATE).first().click();
    await page.locator(".core-create-menu-described button", { hasText: "New note" }).click();
    await page.waitForTimeout(500);
    await page.keyboard.press("Tab");
    await page.keyboard.type("abc", { delay: 20 });
    await page.keyboard.press("Control+Shift+H");
    await page.waitForTimeout(300);
    // Nib 0.2.2 + API 1.23 (whileTyping): the shortcut works mid-sentence too, and Escape goes back to the note.
    check(await page.locator(".nib-panel").count() === 1 && await page.evaluate(() => document.activeElement?.id === "nib-question"), "inside a note Ctrl+Shift+H opens Nib too");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    check(await page.evaluate(() => document.activeElement?.closest(".core-editor-content, .core-title-input") !== null || document.activeElement?.classList.contains("core-title-input")), "Escape goes back to the note");

    // 7. Reduced motion.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(200);
    check(await nib().evaluate((el) => el.getAnimations({ subtree: true }).length === 0), "no animation with reduced motion");
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // 8. Dark.
    await page.evaluate(() => { localStorage.setItem("notible-core-theme", "night"); });
    await page.reload();
    await page.getByRole("button", CREATE).first().waitFor({ timeout: 30000 });
    await page.locator(".core-nav button").first().click();
    await page.locator(".nib-wake").waitFor({ timeout: 20000 });
    const bg = await page.locator(".nib-wake").evaluate((el) => getComputedStyle(el).backgroundColor);
    check(bg !== "rgb(255, 255, 255)", `dark theme: Nib is not white (${bg})`);
    if (process.env.NIB_SHOTS) { await page.waitForTimeout(300); await page.locator(".core-corner").first().screenshot({ path: require("path").join(process.env.NIB_SHOTS, "nib-night.png") }).catch(() => {}); }

    // The end of the note scrolls clear of the fella.
    const clear = await page.evaluate(() => {
      const end = document.querySelector(".core-backlinks");
      const fella = document.querySelector(".nib-wake");
      if (!end || !fella) return null;
      for (let el = end.parentElement; el; el = el.parentElement) if (el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight;
      const a = end.getBoundingClientRect(); const b = fella.getBoundingClientRect();
      return { overlaps: a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right };
    });
    check(clear && !clear.overlaps, `scrolled to the end, Backlinks sits clear of the fella (${JSON.stringify(clear)})`);
    // 9. Restart: collapsed, no intro, nothing stored but schema/introSeen.
    check(await page.locator(".nib-panel").count() === 0 && await page.locator(".nib-bubble").count() === 0, "after a restart Nib is collapsed and the intro does not come back");
    const stored = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes("notible.nib")).map((key) => key.split(String.fromCharCode(0))[1]));
    check(stored.every((key) => ["schema", "introSeen"].includes(key)), `Nib stores only schema/introSeen (${stored.join(", ")})`);

    // 10. Polish.
    await page.evaluate(() => { localStorage.setItem("notible-language", "pl"); window.dispatchEvent(new Event("notible:preferences")); });
    await page.waitForTimeout(500);
    await page.locator(".nib-wake").click();
    check(await page.locator(".nib-ask button").innerText() === "Zapytaj" && (await page.locator("#nib-question").getAttribute("placeholder")).startsWith("Zapytaj"), "in Polish the Ask button and placeholder are Polish");
    await askNib("jak przywrócić usuniętą notatkę");
    const polish = await page.locator(".nib-body-scroll").innerText();
    check(/Delete and restore/.test(polish) && /po angielsku/.test(polish), "a Polish question finds Delete and restore, with the 'Help is in English' line");
  } catch (error) {
    check(false, `scenario crashed: ${error.message.split("\n")[0]}`);
  } finally {
    await browser.close().catch(() => {});
    sandboxCli("stop", NAME);
  }
  console.log(failures.length ? `\nNib plugin scenario FAILED (${failures.length})` : "\nNib plugin scenario passed");
  process.exit(failures.length ? 1 : 0);
})();
