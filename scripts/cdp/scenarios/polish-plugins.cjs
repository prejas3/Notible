// Scenario: the official plugins in Polish (Hive #28, I18N).
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/polish-plugins.cjs
//
// Starts one sandbox, installs Tables, Sync, Sync Simple, Graph, Habits,
// Notifications, ReportIt and Teams from plugins/, switches the interface to
// Polish and opens each plugin's screen. A screen fails when it shows one of
// that plugin's English strings (a key whose Polish text differs, at least 10
// characters, no placeholders) instead of its translation.
// PL_SHOTS=<dir> saves a screenshot of each screen in both themes at PL_SIZE
// (default 1024x700). Needs a fresh `npm run sandbox:build`. Exit 1 on failure.
const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { randomBytes } = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const ROOT = process.env.NOTIBLE_SANDBOX_ROOT || path.join(os.tmpdir(), "notible-sandboxes");
const NAME = `claude-polish-${process.pid.toString(36)}-${randomBytes(3).toString("hex")}`;
const SIZE = process.env.PL_SIZE || "1024x700";
const SHOTS = process.env.PL_SHOTS;
const PLUGINS = ["notible-tables", "notible-sync", "notible-sync-simple", "notible-graph", "notible-habits", "notible-notifications", "notible-reportit", "notible-teams"];
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };
const CREATE = { name: /^(Create a note, folder or project|Utwórz notatkę, folder lub projekt)$/ };
let pid = null;

const invoke = (page, command, args = {}) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [command, args]);
const ready = (page) => page.getByRole("button", CREATE).first().waitFor({ timeout: 30000 });

/** English strings of one plugin that must not show once Polish is on. */
function englishOf(plugin) {
  const strings = JSON.parse(readFileSync(path.join(repo, "plugins", plugin, "locales/pl.json"), "utf8")).strings;
  return Object.entries(strings).filter(([key, value]) => key !== value && key.length >= 10 && !key.includes("{")).map(([key]) => key);
}

async function install(page, plugin) {
  const dir = path.join(repo, "plugins", plugin);
  sandboxCli("pick", NAME, dir.split(path.sep).join("/"));
  const manifest = readFileSync(path.join(dir, "plugin.json"), "utf8");
  await page.evaluate(async (manifest) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const picked = await invoke("pick_folder");
    const parsed = JSON.parse(manifest);
    await invoke("upsert_plugin_registry", { pluginId: parsed.id, version: parsed.version, source: "local-file", installPath: picked, manifest: JSON.stringify(parsed), verified: false });
    await invoke("grant_plugin_trust", { pluginId: parsed.id, version: parsed.version });
    await invoke("set_plugin_registry_state", { pluginId: parsed.id, version: parsed.version, pluginState: "active" });
  }, manifest);
}

async function settingsFor(page, pluginName) {
  await page.getByRole("button", { name: "Ustawienia", exact: true }).last().click();
  await page.locator(".core-settings-nav button", { hasText: "Wtyczki" }).click();
  await page.locator(".core-plugin-index-row", { hasText: pluginName }).first().click();
  await page.waitForTimeout(800);
}

async function navTo(page, label) {
  await page.locator(".core-nav button", { hasText: label }).first().click();
  await page.waitForTimeout(1200);
}

(async () => {
  let session;
  try {
    if (existsSync(path.join(ROOT, NAME))) throw new Error(`sandbox ${NAME} already exists; not this run's`);
    const info = JSON.parse(sandboxCli("start", NAME, "--size", SIZE));
    pid = info.pid;
    const browser = await chromium.connectOverCDP(info.cdp);
    const page = browser.contexts()[0].pages()[0];
    session = { browser, page };
    await ready(page);
    for (const plugin of PLUGINS) await install(page, plugin);
    await page.evaluate(() => localStorage.setItem("notible-language", "pl"));
    await page.reload();
    await ready(page);
    await page.waitForTimeout(1500); // plugins register their types on load
    const table = await invoke(page, "create_object", { type: "table", title: "Tabela testowa", content: "{}", props: "{}", parentId: null });
    check(await page.evaluate(() => document.documentElement.lang) === "pl", "the interface is in Polish");

    const screens = [
      ["tables", "notible-tables", async () => { await page.locator(".core-object-row", { hasText: "Tabela testowa" }).first().click(); await page.waitForTimeout(1500); }],
      ["sync", "notible-sync", () => settingsFor(page, "Notible Sync")],
      ["sync-simple", "notible-sync-simple", () => settingsFor(page, "Sync Simple")],
      ["teams", "notible-teams", () => settingsFor(page, "Notible Teams")],
      ["graph", "notible-graph", () => navTo(page, "Graf")],
      ["habits", "notible-habits", () => navTo(page, "Nawyki")],
      ["reportit", "notible-reportit", () => navTo(page, "ReportIt")],
      ["notifications", "notible-notifications", async () => { await page.locator(".nnot-bell").first().click(); await page.waitForTimeout(800); }],
    ];
    for (const theme of ["day", "night"]) {
      await page.evaluate((value) => localStorage.setItem("notible-core-theme", value === "day" ? "paper" : "night"), theme);
      for (const [id, plugin, open] of screens) {
        await page.reload();
        await ready(page);
        try { await open(); } catch (error) { check(false, `${id}: the screen opens`, String(error).split("\n")[0]); continue; }
        if (theme === "day") {
          // Whole text elements, not substrings: the manifest description Core
          // shows in the plugin pane is not the plugin's to translate.
          const shown = new Set(await page.evaluate(() => [...document.body.querySelectorAll("*")]
            // The guide and description come from plugin.json, which Core cannot translate yet.
            .filter((node) => node.children.length === 0 && node.offsetParent !== null && !node.closest(".core-plugin-guide"))
            .map((node) => (node.textContent ?? "").trim()).filter(Boolean)));
          const english = englishOf(plugin).filter((key) => shown.has(key));
          const where = english.length ? await page.evaluate((text) => [...document.body.querySelectorAll("*")]
            .filter((node) => node.children.length === 0 && (node.textContent ?? "").trim() === text)
            .map((node) => { const path = []; for (let el = node; el && path.length < 5; el = el.parentElement) path.push(el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "")); return path.join(" < "); }), english[0]) : [];
          check(english.length === 0, `${id}: no English fallback on the screen`, `${english.slice(0, 6).join(" | ")} ${where.join(" ; ")}`);
        }
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${SIZE}-pl-${theme}-${id}.png`) });
      }
    }
    check(Boolean(table?.id), "a table object was created for the Tables screen");
  } catch (error) {
    check(false, "scenario ran to the end", error.stack);
  } finally {
    await session?.browser.close().catch(() => {});
    let stopPid = pid;
    try { stopPid ??= JSON.parse(readFileSync(path.join(ROOT, NAME, "state.json"), "utf8")).pid; } catch { /* never launched */ }
    try { sandboxCli("stop", NAME, ...(stopPid ? ["--pid", String(stopPid)] : [])); } catch { /* not started */ }
  }
  console.log(failures.length ? `\n${failures.length} failure(s)` : "\nAll checks passed.");
  process.exit(failures.length ? 1 : 0);
})();
