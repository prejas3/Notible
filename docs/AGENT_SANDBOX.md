# Agent sandbox: disposable Notible instances over CDP

For AI agents (Claude Code, Codex, any other) that need to drive the real
desktop app through a scenario. Each sandbox is the debug build of Notible
with an **empty workspace, no plugins, first-run state**, its own WebView2
profile and its own CDP port. Several can run at once. None of them can touch
the real install or its data.

Everything goes through one script: `scripts/cdp/sandbox.cjs`
(`npm run sandbox -- <command>` is the same thing).

## 1. One-time setup (the human, or the first agent)

```sh
npm run sandbox:build        # debug NotibleApp.exe, frontend embedded; several minutes
```

Rebuild after any change to `src-tauri/` **or** the frontend. The UI is baked
into the exe, so a stale build means stale UI. The exe lands in
`src-tauri/target/debug/NotibleApp.exe`.

`NOTIBLE_SANDBOX_EXE=<path>` points the sandbox at another exe. It must be a
debug build: `start` refuses an exe without the debug-assertions marker
(`scripts/debug-build-marker.cjs`), because a release build ignores the
sandbox environment and would open the real `%APPDATA%\com.notible.app`.

Playwright is deliberately not a repo dependency. Install the small
`playwright-core` package (no browsers) outside the repo:

```sh
npm i --prefix "$TEMP/notible-pw" playwright-core      # bash
npm i --prefix "$env:TEMP\notible-pw" playwright-core  # PowerShell
```

Then run your scripts with `NODE_PATH` pointing at it:

```sh
NODE_PATH="$TEMP/notible-pw/node_modules" node my-scenario.cjs          # bash
$env:NODE_PATH="$env:TEMP\notible-pw\node_modules"; node my-scenario.cjs # PowerShell
```

## 2. Lifecycle of one scenario

```sh
node scripts/cdp/sandbox.cjs start <name>      # e.g. start claude-tables
# ... drive the app over CDP ...
node scripts/cdp/sandbox.cjs stop <name>       # kills it and deletes its data
```

`start` waits until the app window is up (up to 90 s) and prints JSON:

```json
{
  "name": "claude-tables",
  "running": true,
  "pid": 12345,
  "port": 9301,
  "cdp": "http://127.0.0.1:9301",
  "dir": "...\\notible-sandboxes\\claude-tables",
  "appLog": "...\\app.log",
  "dialogAnswer": "...\\data\\.sandbox\\dialog-answer.txt",
  "dialogsLog": "...\\data\\.sandbox\\dialogs.log",
  "nextPick": "...\\data\\.sandbox\\next-pick.txt",
  "exports": "...\\data\\.sandbox\\exports"
}
```

Use `cdp` from that output. Never hard-code a port.

| Command | What it does |
|---|---|
| `start <name> [--port N] [--dialogs approve\|cancel] [--reuse] [--size WxH] [--shared <folder>]` | Fresh instance (wipes any previous `<name>` data unless `--reuse`). Ports are auto-picked from 9301 up. `--size 1460x740` sets the native window size. `--shared` gives the sync plugins a local folder instead of Google Drive (see §5a). |
| `stop <name> [--keep]` | Kill the process tree; delete the data unless `--keep`. |
| `stop <name> --keep` then `start <name> --reuse` | **Restart the app with the same data**: use it for "does it survive a restart" scenarios. |
| `stop-all [--keep]` | Stop every sandbox. |
| `list` | All sandboxes with port, pid, running. |
| `dialogs <name> approve\|cancel` | How the next native dialogs are answered (takes effect immediately). |
| `dialogs <name>` | Print the log of native dialogs that were answered. |
| `pick <name> <path>` / `pick <name> --cancel` | What the next native file/folder picker returns (one-shot). |

## 3. Connecting

```js
// my-scenario.cjs
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP); // e.g. http://127.0.0.1:9301
  const page = browser.contexts()[0].pages()[0];
  await page.waitForLoadState('domcontentloaded');
  await page.screenshot({ path: 'start.png' });
  // page.getByRole('button', { name: 'New note' }).click(); ...
  await browser.close(); // disconnects only; the app keeps running
})();
```

- `browser.close()` only disconnects. Use `sandbox.cjs stop` to end the app.
- Playwright's `recordVideo` does not work over `connectOverCDP`. Take
  screenshots in a loop instead.
- Prefer role/text locators (`getByRole`, `getByText`) over guessed CSS
  classes, and check that an action worked (for example that the new note's
  title is visible) before you type into anything.

## 4. Native dialogs and pickers

CDP can only control the web page. Native Windows dialogs cannot be clicked,
and they are native on purpose so plugin code cannot click them either. In a
sandbox they are answered automatically instead of blocking:

| Native UI | Sandbox behaviour |
|---|---|
| "Install a plugin that contains code" (non-official plugins) | Answered from `dialog-answer.txt` (default **approve**); logged to `dialogs.log` |
| "Let plugins read pasted images?" | Same |
| "Let plugins read your calendars?" | Same |
| "Move notes to the Trash" (approving an AI cleanup request) | Same; scenario: `scripts/cdp/scenarios/mcp-cleanup.cjs` |
| Folder picker (linked folders), file picker (local plugin `.zip`) | Returns the path set with `pick`; nothing set = cancelled |
| "Save as" for exports (PDF, CSV, ...) | Written straight into `exports/`; the command returns that path |

To test the cancel path: `dialogs <name> cancel`, do the action, then assert
that nothing changed. To check that a dialog *would* have appeared, read
`dialogs <name>` (each line is `approve|cancel<TAB>dialog title`).

Official market installs never show the trust dialog, as in the real app.

## 5. What is switched off in a sandbox

These are enforced in Rust for any debug build started with
`NOTIBLE_TEST_APP_DATA_DIR` (see `src-tauri/src/sandbox.rs`). They never reach
the real machine:

- **Updater install**: returns an error (the installer would overwrite the real app).
- **Autostart on**: returns an error.
- **AI provider install/login/MCP registration and CLI AI turns**: return an
  error (they would spawn installers or edit the global Claude/Codex config).
- **Keyring**: separate `*.sandbox` service names, so there are no real tokens or keys.
- **Window position**: saved to its own file.

Everything else is the real app: the live plugin market (same catalog,
signatures and GitHub releases your users get), built-in plugins, notes,
projects, views, search, themes, language packs and notifications. Market
installs need internet access. Sync needs `--shared` (below); without it the
sync plugins would want a real Google sign-in, so don't test sync that way.

## 5a. Two sandboxes syncing through one folder

The sync plugins (Sync Simple, Sync) talk to their remote through one small
transport. In a sandbox started with `--shared <folder>`, Core offers a local
folder in place of Google Drive, and the plugins use it with no sign-in:

```sh
node scripts/cdp/sandbox.cjs start claude-sync-a --shared claude-sync
node scripts/cdp/sandbox.cjs start claude-sync-b --shared claude-sync
# install the sync plugin from plugins/ on both (see the scenario), then
# "Synchronise now" on A, then on B: A's notes arrive on B.
```

- `--shared` takes a name, never a path: the folder is
  `<sandbox root>/.shared/<name>`, and Core refuses any folder that is not
  directly inside a `.shared` folder, so a typo cannot hand plugins your
  Documents. Use a fresh name per run (or delete the folder): a
  workspace key left there by an older run is picked up by the new
  sandboxes. That still works, but it is no longer a first-run test.
- `stop` does not delete the shared folder. Delete it yourself at the end.
- In a script, give sandboxes and the shared folder names unique to the run,
  and clean up only what the run started: `stop <name> --pid <pid from start>`
  refuses to touch an instance with another pid. The scenario below shows how.
- Limits: 64 MB per file, 20000 files and 1 GB per shared folder.
- Install the plugin from `plugins/` (folder install), not from the market:
  the published version may not have the shared-folder transport yet.
- The Google account row still says "Connected": the transport has no
  sign-in. This only affects the sandbox display.
- Worked example: `scripts/cdp/scenarios/sync-shared-folder.cjs` (A → B,
  B → A, both editing one note → merge notice; `SYNC_SHOTS=<dir>` takes
  screenshots in both themes at `SYNC_SIZE`).

How it is fenced: the Core commands (`sandbox_shared_*` in
`src-tauri/src/sandbox.rs`) refuse every call unless this is a debug build
**and** an agent sandbox (`NOTIBLE_TEST_APP_DATA_DIR` + `NOTIBLE_SANDBOX=1`)
**and** `NOTIBLE_SANDBOX_SHARED_DIR` is exactly `<sandbox root>/.shared/<name>`, in the
same root as the sandbox's own data. Junctions and symlinks are refused at the
folder and at each file, names are single flat file names, and temp files are
created under random names, so nothing outside the folder is reachable. A
release build refuses even with all three set (`cargo test --release` checks it).

## 6. Rules for agents

1. **One sandbox per agent, with a unique name**, prefixed with who you are:
   `claude-<scenario>`, `codex-<scenario>`. Never touch another agent's sandbox.
2. **Never** connect to port 9222, kill `NotibleApp.exe` by name, or open
   `%APPDATA%\com.notible.app`. That is the user's real app and data. Only
   use `sandbox.cjs stop <your-name>`.
3. **Always `stop` your sandbox at the end**, including when the scenario
   fails. Use `--keep` only if the human asked to inspect the data.
4. Put screenshots and scripts in your own temp or scratch folder, not in the repo.
5. If `start` fails, read `appLog` from its message before retrying. If it
   says the build is missing, ask the human before running `npm run sandbox:build`,
   since another agent may be building at the same time.
6. Report what you saw, with screenshots, and name the sandbox you used.

## 7. Notes per agent tool

- **Claude Code**: Bash/PowerShell can run everything above. Background the
  scenario script only if it runs long.
- **Codex CLI**: its default sandbox blocks starting GUI processes, localhost
  connections and downloads from the market. Run it with full access for this
  work, e.g. `codex --sandbox danger-full-access` (or approve each command).
  `AGENTS.md` at the repo root points Codex here.

## 8. Prompt template for giving an agent a scenario

```
Read docs/AGENT_SANDBOX.md and follow its rules.
Sandbox name: <claude|codex>-<short-scenario>.
Scenario: <e.g. first launch -> create a project -> install Tables from the
market -> add a table to the project -> restart the app (stop --keep / start
--reuse) -> confirm the table is still there>.
Expected: <what should be true>.
Deliver: pass/fail per step, screenshots of every failure, anything that
looked wrong even if it passed. Stop your sandbox when done.
```

## 9. One-command feature demo

To build the current tree, replace any old sandbox named `demo`, install every
official plugin from the local `plugins/notible-*` folders, and populate a
hand-testing workspace through the running app:

```sh
npm run demo
npm run demo -- --skip-build
npm run demo -- --name my-demo --lang pl
```

The command prints one `ok` or `FAIL <reason>` line for every plugin and sample
module, exits with code 1 when anything failed, and deliberately leaves the
sandbox open. Re-running it is safe: the named sandbox is stopped and deleted
before a fresh one starts. Stop it afterwards with
`node scripts/cdp/sandbox.cjs stop <name>`.

Samples live in `scripts/demo/samples/` and are listed in
`scripts/demo/manifest.cjs`; add one small module for each new feature. The demo
requires `playwright-core` in `NODE_PATH` or the external temp install described
in section 1. It never connects to the real-app CDP port or data directory.

Current limits: the editor has no callout block, so the demo cannot create one.
AI provider setup is also omitted: this build does not expose the AI builtin in
the plugin list, and sandbox mode deliberately blocks provider install/login.

## Window size: never over CDP

Do not resize with `Browser.setWindowBounds`, `Emulation.setDeviceMetricsOverride` or `page.setViewportSize`. In WebView2 they resize the web content, not the native window, so the app renders larger or smaller than the window around it. Start the sandbox with `--size WxH` instead; Rust resizes the real window.
