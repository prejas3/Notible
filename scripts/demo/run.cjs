#!/usr/bin/env node
const { execFileSync, spawnSync } = require("node:child_process");
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repo = path.resolve(__dirname, "../..");
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const name = option("--name", "demo");
const lang = option("--lang", "en");
if (!/^[a-z0-9][a-z0-9-]{0,31}$/i.test(name)) throw new Error("--name must be 1-32 letters, digits or dashes");
if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(lang)) throw new Error("--lang must look like en or pl");

function playwright() {
  try { return require("playwright-core"); } catch {}
  const external = path.join(os.tmpdir(), "notible-pw", "node_modules", "playwright-core");
  if (existsSync(external)) return require(external);
  throw new Error(`playwright-core is missing. Run: npm i --prefix "${path.join(os.tmpdir(), "notible-pw")}" playwright-core`);
}
const sandbox = (...args) => execFileSync(process.execPath, [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { cwd: repo, encoding: "utf8" });

(async () => {
  let browser;
  const results = [];
  try {
    try { sandbox("stop", name); } catch { /* a missing old sandbox is the clean state */ }
    if (!process.argv.includes("--skip-build")) {
      const built = spawnSync("npm", ["run", "sandbox:build"], { cwd: repo, stdio: "inherit", shell: true });
      if (built.status !== 0) throw new Error(`sandbox build failed (${built.status})`);
    }
    const info = JSON.parse(sandbox("start", name, "--size", "1440x850"));
    browser = await playwright().chromium.connectOverCDP(info.cdp);
    const page = browser.contexts()[0].pages()[0];
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__?.invoke), null, { timeout: 30000 });
    const invoke = (command, args = {}) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [command, args]);
    await page.evaluate((value) => localStorage.setItem("notible-language", value), lang);

    const pluginDirs = readdirSync(path.join(repo, "plugins"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("notible-") && existsSync(path.join(repo, "plugins", entry.name, "plugin.json")))
      .map((entry) => entry.name).sort();
    for (const folder of pluginDirs) {
      try {
        const dir = path.join(repo, "plugins", folder);
        sandbox("pick", name, dir.split(path.sep).join("/"));
        const manifest = readFileSync(path.join(dir, "plugin.json"), "utf8");
        await page.evaluate(async (raw) => {
          const invoke = window.__TAURI_INTERNALS__.invoke;
          const picked = await invoke("pick_folder");
          const m = JSON.parse(raw);
          await invoke("upsert_plugin_registry", { pluginId: m.id, version: m.version, source: "local-file", installPath: picked, manifest: JSON.stringify(m), verified: false });
          await invoke("grant_plugin_trust", { pluginId: m.id, version: m.version });
          await invoke("set_plugin_registry_state", { pluginId: m.id, version: m.version, pluginState: "active" });
        }, manifest);
        results.push({ name: `plugin:${folder}`, ok: true });
      } catch (error) { results.push({ name: `plugin:${folder}`, ok: false, error: error.message }); }
    }
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__?.invoke), null, { timeout: 30000 });
    await page.waitForFunction(async () => {
      const types = await window.__TAURI_INTERNALS__.invoke("list_types");
      const names = new Set(types.map((type) => type.name));
      return ["table", "habit", "notible.library.item", "notible.schemas.schema"].every((name) => names.has(name));
    }, null, { timeout: 15000 }).catch(() => {});
    const ctx = { page, invoke, repo, lang };
    const builtinManifests = readdirSync(path.join(repo, "plugins", "builtin"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(path.join(repo, "plugins", "builtin", entry.name, "plugin.json")))
      .map((entry) => JSON.parse(readFileSync(path.join(repo, "plugins", "builtin", entry.name, "plugin.json"), "utf8")));
    results.push(...await require("./lib.cjs").enableAllBuiltinPlugins(ctx, builtinManifests));
    for (const sample of require("./manifest.cjs")) {
      try { await sample.run(ctx); results.push({ name: sample.name, ok: true }); }
      catch (error) { results.push({ name: sample.name, ok: false, error: String(error.message || error).split("\n")[0] }); }
    }
    await page.evaluate(() => window.dispatchEvent(new Event("notible:workspace-changed")));
    console.log("\nNotible demo summary");
    for (const result of results) console.log(`${result.ok ? "ok" : `FAIL ${result.error}`}  ${result.name}`);
    console.log(`\nSandbox ${name} is open and was left running.`);
    if (results.some((result) => !result.ok)) process.exitCode = 1;
  } catch (error) {
    console.error(`FAIL demo: ${error.message || error}`);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
  }
})();
