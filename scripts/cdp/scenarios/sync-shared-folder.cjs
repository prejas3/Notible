// Scenario: two sandboxes sync through one shared folder (Hive #9).
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/sync-shared-folder.cjs
//
// Starts two sandboxes (sync-a-<run>, sync-b-<run>) with the same `--shared` folder,
// installs Sync Simple from plugins/ on both, and checks: a note made on A
// reaches B, a note made on B reaches A, and both editing one note gives B the
// merge notice with its Open/Details button (Hive #11). SYNC_SHOTS=<dir> also
// takes the #11 screenshots (notice, panel with the "Merge notices" switch) in
// both themes at SYNC_SIZE (default 1024x700). Needs a fresh
// `npm run sandbox:build`. Exit code 1 on any failure.
const { execFileSync } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } = require("node:fs");
const { randomBytes } = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = path.resolve(__dirname, "../../..");
const pluginDir = path.join(repo, "plugins/notible-sync-simple");
const ROOT = process.env.NOTIBLE_SANDBOX_ROOT || path.join(os.tmpdir(), "notible-sandboxes");
// Hive #17: names unique to this run, so a run never stops, deletes or shares
// with a sandbox someone else started; `owned` is what cleanup may touch.
const RUN = `${process.pid.toString(36)}-${randomBytes(3).toString("hex")}`;
const SHARED = `claude-sync-${RUN}`;
const sharedPath = path.join(ROOT, ".shared", SHARED);
const owned = new Map(); // sandbox name -> pid, once start reported it
const SIZE = process.env.SYNC_SIZE || "1024x700";
const SHOTS = process.env.SYNC_SHOTS;
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${message}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failures.push(message); };
const CREATE = { name: /^(Create a note, folder or project|Utwórz notatkę, folder lub projekt)$/ };
const doc = (text) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function open(name) {
  if (existsSync(path.join(ROOT, name))) throw new Error(`sandbox ${name} already exists; not this run's, left alone`);
  owned.set(name, null); // claimed before start, so a half-started instance is cleaned up too
  const info = JSON.parse(sandboxCli("start", name, "--size", SIZE, "--shared", SHARED));
  owned.set(name, info.pid);
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole("button", CREATE).first().waitFor({ timeout: 30000 });
  return { name, browser, page };
}

async function install({ name, page }) {
  sandboxCli("pick", name, pluginDir.split(path.sep).join("/"));
  const manifest = readFileSync(path.join(pluginDir, "plugin.json"), "utf8");
  await page.evaluate(async (manifest) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const picked = await invoke("pick_folder");
    const parsed = JSON.parse(manifest);
    await invoke("upsert_plugin_registry", { pluginId: parsed.id, version: parsed.version, source: "local-file", installPath: picked, manifest: JSON.stringify(parsed), verified: false });
    await invoke("grant_plugin_trust", { pluginId: parsed.id, version: parsed.version });
    await invoke("set_plugin_registry_state", { pluginId: parsed.id, version: parsed.version, pluginState: "active" });
  }, manifest);
  await page.reload();
  await page.getByRole("button", CREATE).first().waitFor({ timeout: 30000 });
}

const invoke = (page, command, args) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [command, args]);

/** Settings → Plugins → Sync Simple, then "Synchronise now"; returns the status. */
async function syncNow({ page }) {
  const now = page.getByRole("button", { name: "Synchronise now" });
  if (!await now.isVisible()) {
    await page.getByRole("button", { name: "Settings", exact: true }).last().click();
    await page.getByRole("button", { name: /^Plugins/ }).click();
    await page.locator(".core-plugin-index-row", { hasText: "Sync Simple" }).first().click();
  }
  await now.waitFor({ timeout: 15000 });
  await now.click();
  const status = page.locator(".nsync-now p.status");
  await page.waitForFunction(() => {
    const el = document.querySelector(".nsync-now p.status");
    return el && ["ok", "error"].includes(el.dataset.state);
  }, null, { timeout: 30000 });
  return { state: await status.getAttribute("data-state"), text: await status.innerText() };
}

const body = async (page, id) => JSON.stringify((await invoke(page, "get_object", { id }))?.content ?? "");

async function shoot(page, file) {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${SIZE}-${file}.png`) });
}

(async () => {
  let a;
  let b;
  let ownShared = false;
  try {
    if (existsSync(sharedPath)) throw new Error(`${sharedPath} already exists; not this run's`);
    mkdirSync(sharedPath, { recursive: true });
    ownShared = true;
    a = await open(`sync-a-${RUN}`);
    b = await open(`sync-b-${RUN}`);
    check(await invoke(a.page, "sandbox_shared_available", {}), "the shared folder is offered in a sandbox started with --shared");
    await install(a);
    await install(b);

    // 1. A → B.
    const note = await invoke(a.page, "create_object", { type: "note", title: "Made on A", content: doc("hello from A"), props: "{}", parentId: null });
    const ranA = await syncNow(a);
    check(ranA.state === "ok", `A synchronises through the folder (${ranA.text})`);
    const files = readdirSync(sharedPath);
    check(files.some((f) => /^device-.+\.json$/.test(f)) && files.includes("workspace-key.txt"), `A's snapshot and the key are in the folder (${files.join(", ")})`);
    const ranB = await syncNow(b);
    check(ranB.state === "ok", `B synchronises (${ranB.text})`);
    const onB = await invoke(b.page, "get_object", { id: note.id });
    check(onB?.title === "Made on A" && /hello from A/.test(JSON.stringify(onB.content)), "A's note arrived on B");

    // 2. B → A.
    const back = await invoke(b.page, "create_object", { type: "note", title: "Made on B", content: doc("hello from B"), props: "{}", parentId: null });
    await syncNow(b);
    await syncNow(a);
    check((await invoke(a.page, "get_object", { id: back.id }))?.title === "Made on B", "B's note arrived on A");

    // 3. Both edit A's note: B gets the merge notice (Hive #11).
    await invoke(a.page, "update_object", { id: note.id, content: doc("A's edit") });
    await invoke(b.page, "update_object", { id: note.id, content: doc("B's edit") });
    await syncNow(a);
    await syncNow(b);
    const notice = b.page.locator(".core-plugin-notice", { hasText: /./ }).first();
    await notice.waitFor({ timeout: 10000 }).catch(() => {});
    const noticeText = await notice.innerText().catch(() => "");
    check(noticeText.length > 0, `B shows a merge notice ("${noticeText.replace(/\s+/g, " ").trim()}")`);
    check(await b.page.locator(".core-plugin-notice-action").count() === 1, "the notice has its Open/Details button");
    check(/A's edit/.test(await body(b.page, note.id)) || /A's edit/.test(JSON.stringify(await invoke(b.page, "list_objects", {}).catch(() => []))), "A's edit is on B (in the note or a copy)");

    if (SHOTS) {
      for (const theme of ["day", "night"]) {
        for (const s of [a, b]) await s.page.evaluate((t) => localStorage.setItem("notible-core-theme", t), theme);
        await b.page.reload();
        await b.page.getByRole("button", CREATE).first().waitFor({ timeout: 30000 });
        await invoke(b.page, "update_object", { id: note.id, content: doc(`B again, ${theme}`) });
        await invoke(a.page, "update_object", { id: note.id, content: doc(`A again, ${theme}`) });
        await syncNow(a);
        await syncNow(b);
        await b.page.locator(".core-plugin-notice-action").first().waitFor({ timeout: 10000 }).catch(() => {});
        await shoot(b.page, `${theme}-notice-and-panel`);
        await b.page.locator(".core-plugin-notice").first().waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
        await b.page.getByText("Merge notices", { exact: true }).click();
        const toggle = b.page.locator(".nsync-switch").last();
        await toggle.waitFor({ timeout: 5000 }).catch(() => {});
        await toggle.scrollIntoViewIfNeeded().catch(() => {});
        await shoot(b.page, `${theme}-merge-switch`);
      }
    }
  } catch (error) {
    check(false, "scenario ran to the end", error.stack);
  } finally {
    for (const s of [a, b]) await s?.browser.close().catch(() => {});
    for (const [name, started] of owned) {
      // A start that failed half-way recorded its pid in state.json only.
      let pid = started;
      try { pid ??= JSON.parse(readFileSync(path.join(ROOT, name, "state.json"), "utf8")).pid; } catch { /* never launched */ }
      try { sandboxCli("stop", name, ...(pid ? ["--pid", String(pid)] : [])); } catch { /* not started */ }
    }
    if (ownShared) rmSync(sharedPath, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} failure(s)` : "\nAll checks passed.");
  process.exit(failures.length ? 1 : 0);
})();
