// Scenario: Hive #36 (PROPS-PATCH) — the Properties panel never writes its stale copy back.
//
//   NODE_PATH="$TEMP/notible-pw/node_modules" node scripts/cdp/scenarios/properties-concurrent.cjs [--size 1366x800]
//
// With a task open and its Properties panel showing, props change from outside
// (a raw update, no event at all, as a plugin or a sync could leave them), then
// the user changes Status in the panel: both changes must be in the database.
// Then an outside change announced as workspace.changed (what sync does) shows
// in the panel without reopening. Needs a fresh `npm run sandbox:build`.
// NOTIBLE_SANDBOX_EXE may point at a copy of the debug exe. Exit code 1 on failure.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright-core");

const repo = process.env.NOTIBLE_REPO || path.resolve(__dirname, "../../..");
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const SIZE = arg("--size", "1366x800");
const NAME = process.env.SANDBOX || `claude-props-${SIZE}`;
const sandboxCli = (...args) => execFileSync("node", [path.join(repo, "scripts/cdp/sandbox.cjs"), ...args], { encoding: "utf8" });
const failures = [];
const check = (ok, message) => { console.log(`${ok ? "PASS" : "FAIL"} ${message}`); if (!ok) failures.push(message); };
const CREATE = { name: "Create a note, folder or project", exact: true };

(async () => {
  const info = JSON.parse(sandboxCli("start", NAME, "--size", SIZE));
  const browser = await chromium.connectOverCDP(info.cdp);
  const page = browser.contexts()[0].pages()[0];
  const invoke = (cmd, args) => page.evaluate(([cmd, args]) => window.__TAURI_INTERNALS__.invoke(cmd, args), [cmd, args]);
  const props = async (id) => JSON.parse((await invoke("get_object", { id })).props);
  const outside = async (id, patch) => {
    const current = await invoke("get_object", { id });
    await invoke("update_object", { id, props: JSON.stringify({ ...JSON.parse(current.props), ...patch }), expectedUpdatedAt: current.updated_at });
  };
  try {
    await page.getByRole("button", CREATE).waitFor({ timeout: 30000 });
    await page.getByRole("button", CREATE).click();
    await page.getByRole("button", { name: /^Task/ }).first().click();
    await page.waitForTimeout(1200);
    const task = (await invoke("query_objects", { type: "task" }))[0];
    const status = page.getByRole("combobox").filter({ hasText: /^Todo$/ }).first();
    if (!(await status.isVisible())) await page.getByRole("button", { name: "Properties", exact: true }).click();
    await status.waitFor();

    // 1. Outside change with no event, then an edit in the stale panel.
    await outside(task.id, { priority: "high", tags: ["outside"], marker: 7 });
    await status.click();
    await page.getByRole("option", { name: /In progress/ }).first().click();
    await page.waitForTimeout(1500);
    let now = await props(task.id);
    check(now.status === "in-progress", `the panel's edit is saved (${now.status})`);
    check(now.priority === "high" && now.tags?.includes("outside") && now.marker === 7, `the outside change survives the edit (${JSON.stringify(now)})`);
    check(/High/.test(await page.locator(".pp-panel").innerText()), "after saving, the panel shows the merged values (Priority High)");

    // 2. Outside change announced as workspace.changed (sync does this): the panel shows it.
    await outside(task.id, { priority: "urgent" });
    await page.evaluate(() => window.dispatchEvent(new Event("notible:workspace-changed")));
    await page.waitForTimeout(800);
    check(/Urgent/.test(await page.locator(".pp-panel").innerText()), "an announced outside change shows in the open panel");

    // 3. A text edit right after an outside change: both kept, nothing reverts.
    const assignee = page.locator(".pp-panel input[placeholder^='Who?']").first();
    await outside(task.id, { estimate: 3 });
    await assignee.fill("Ola");
    await assignee.blur();
    await page.waitForTimeout(1500);
    now = await props(task.id);
    check(now.assignee === "Ola" && now.estimate === 3 && now.priority === "urgent" && now.status === "in-progress", `typed value and every earlier change kept (${JSON.stringify(now)})`);
  } catch (error) {
    check(false, `scenario crashed: ${error.message}`);
  } finally {
    await browser.close().catch(() => {});
    sandboxCli("stop", NAME, "--pid", String(info.pid));
  }
  console.log(failures.length ? `\n${failures.length} FAILED` : "\nall passed");
  process.exit(failures.length ? 1 : 0);
})();
