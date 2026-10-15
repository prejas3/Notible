#!/usr/bin/env node
/**
 * Disposable Notible instances for agents (Claude, Codex, ...). Each sandbox is
 * the debug build with its own empty workspace, WebView2 profile and CDP port,
 * isolated from the real install. Full guide: docs/AGENT_SANDBOX.md
 *
 *   node scripts/cdp/sandbox.cjs start <name> [--port N] [--dialogs approve|cancel] [--reuse] [--size WxH] [--shared <folder>]
 *   node scripts/cdp/sandbox.cjs stop <name> [--keep] [--pid N]
 *   node scripts/cdp/sandbox.cjs stop-all [--keep]
 *   node scripts/cdp/sandbox.cjs list
 *   node scripts/cdp/sandbox.cjs dialogs <name> [approve|cancel]   (no answer = print log)
 *   node scripts/cdp/sandbox.cjs pick <name> <path>|--cancel
 *
 * `.cjs` because package.json is `"type": "module"`.
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { hasDebugMarker } = require('../debug-build-marker.cjs');

const REPO = path.resolve(__dirname, '..', '..');
const ROOT = process.env.NOTIBLE_SANDBOX_ROOT || path.join(os.tmpdir(), 'notible-sandboxes');
const EXE = process.env.NOTIBLE_SANDBOX_EXE || path.join(REPO, 'src-tauri', 'target', 'debug', 'NotibleApp.exe');
const FIRST_PORT = 9301; // 9222 stays for the real app

const die = (message) => { console.error(`sandbox: ${message}`); process.exit(1); };
const flag = (args, name) => args.includes(name);
const option = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function paths(name) {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/i.test(name || '')) die('name must be 1-32 letters, digits or dashes');
  const dir = path.join(ROOT, name);
  const control = path.join(dir, 'data', '.sandbox');
  return {
    dir,
    data: path.join(dir, 'data'),
    webview: path.join(dir, 'webview'),
    state: path.join(dir, 'state.json'),
    log: path.join(dir, 'app.log'),
    control,
    dialogAnswer: path.join(control, 'dialog-answer.txt'),
    dialogsLog: path.join(control, 'dialogs.log'),
    nextPick: path.join(control, 'next-pick.txt'),
    exports: path.join(control, 'exports'),
  };
}

const readState = (p) => { try { return JSON.parse(fs.readFileSync(p.state, 'utf8')); } catch { return null; } };
const alive = (pid) => { try { return !!pid && (process.kill(pid, 0), true); } catch { return false; } };
const allNames = () => (fs.existsSync(ROOT) ? fs.readdirSync(ROOT) : []).filter((n) => fs.existsSync(path.join(ROOT, n, 'state.json')));

const portFree = (port) => new Promise((resolve) => {
  const server = net.createServer().once('error', () => resolve(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
});

async function pickPort() {
  const taken = new Set(allNames().map((n) => readState(paths(n))?.port));
  for (let port = FIRST_PORT; port < FIRST_PORT + 100; port++) {
    if (!taken.has(port) && await portFree(port)) return port;
  }
  die('no free port');
}

async function waitForApp(port, pid, log) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (!alive(pid)) die(`app exited during startup, see ${log}`);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.some((t) => t.type === 'page' && String(t.url).includes('tauri.localhost'))) return;
    } catch { /* not listening yet */ }
    await sleep(500);
  }
  die(`CDP did not come up on port ${port} within 90 s, see ${log}`);
}

function killTree(pid) {
  if (alive(pid)) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

async function removeDir(dir) {
  // WebView2 child processes release their files a moment after the kill.
  for (let i = 0; i < 20; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch { await sleep(500); }
  }
  console.error(`sandbox: could not fully delete ${dir}`);
}

function describe(name, p, state) {
  return {
    name,
    running: alive(state?.pid),
    pid: state?.pid ?? null,
    port: state?.port ?? null,
    cdp: state?.port ? `http://127.0.0.1:${state.port}` : null,
    dir: p.dir,
    appLog: p.log,
    dialogAnswer: p.dialogAnswer,
    dialogsLog: p.dialogsLog,
    nextPick: p.nextPick,
    exports: p.exports,
  };
}

// Agents start sandboxes in parallel; without this two of them pick the same
// port before either has written its state.json.
async function withStartLock(fn) {
  const lock = path.join(ROOT, '.start-lock');
  fs.mkdirSync(ROOT, { recursive: true });
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(lock); break; } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 60_000) fs.rmSync(lock, { recursive: true, force: true }); } catch { /* raced */ }
      if (i > 240) die('timed out waiting for another sandbox to start');
      await sleep(250);
    }
  }
  try { return await fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

async function start(name, args) {
  const p = paths(name);
  if (!fs.existsSync(EXE)) die(`debug build not found at ${EXE}. Run: npm run sandbox:build`);
  const previous = readState(p);
  if (alive(previous?.pid)) die(`"${name}" is already running on port ${previous.port}`);
  // RELEASE-SAFETY (Hive #15): a release exe ignores the sandbox env and opens the real %APPDATA%.
  if (process.env.NOTIBLE_SANDBOX_EXE && !hasDebugMarker(EXE)) {
    die(`NOTIBLE_SANDBOX_EXE is not a debug build (no debug-assertions marker): ${EXE}. Point it at a build from npm run sandbox:build.`);
  }
  if (!flag(args, '--reuse')) await removeDir(p.dir);
  const { pid, port } = await withStartLock(() => launch(p, args));
  await waitForApp(port, pid, p.log);
  console.log(JSON.stringify(describe(name, p, { pid, port }), null, 2));
}

async function launch(p, args) {
  const kept = flag(args, '--reuse') ? readState(p)?.port : undefined; // a restart keeps its port
  const port = Number(option(args, '--port')) || (kept && await portFree(kept) ? kept : await pickPort());
  if (!await portFree(port)) die(`port ${port} is in use`);
  const dialogs = option(args, '--dialogs') || 'approve';
  if (!['approve', 'cancel'].includes(dialogs)) die('--dialogs must be approve or cancel');

  fs.mkdirSync(p.control, { recursive: true });
  fs.mkdirSync(p.webview, { recursive: true });
  fs.writeFileSync(p.dialogAnswer, dialogs);
  const out = fs.openSync(p.log, 'a');
  const child = spawn(EXE, [], {
    detached: true,
    windowsHide: true, // hides the debug build's console, not the app window
    stdio: ['ignore', out, out],
    env: {
      ...process.env,
      NOTIBLE_TEST_APP_DATA_DIR: p.data,
      NOTIBLE_SANDBOX: '1',
      // --size WxH: the native window's size (never resize over CDP, see sandbox.rs).
      ...(option(args, '--size') ? { NOTIBLE_SANDBOX_WINDOW_SIZE: option(args, '--size') } : {}),
      // --shared <folder>: the folder the sync plugins use in place of Google
      // Drive (Hive #9). Give two sandboxes the same one to sync them. A bare
      // folder lands next to the sandboxes, under <root>/.shared/<name>.
      NOTIBLE_SANDBOX_SHARED_DIR: sharedDir(args),
      WEBVIEW2_USER_DATA_FOLDER: p.webview,
      // NOTIBLE_SANDBOX_BROWSER_ARGS: extra WebView2 flags for a scenario (e.g. --accept-lang=en-US).
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [`--remote-debugging-port=${port}`, process.env.NOTIBLE_SANDBOX_BROWSER_ARGS].filter(Boolean).join(' '),
    },
  });
  child.unref();
  fs.writeFileSync(p.state, JSON.stringify({ pid: child.pid, port }, null, 2));
  return { pid: child.pid, port };
}

function sharedDir(args) {
  const value = option(args, '--shared');
  if (!value) return '';
  // A name only: Core refuses any folder not directly inside a .shared folder.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) die('--shared takes a folder name, not a path');
  return path.join(ROOT, '.shared', value);
}

async function stop(name, args) {
  const p = paths(name);
  const state = readState(p);
  if (!state) die(`no sandbox named "${name}"`);
  // --pid N: stop only the instance a script itself started (Hive #17), never
  // one that took the name since.
  const pid = option(args, '--pid');
  if (pid && String(state.pid) !== pid) die(`"${name}" is pid ${state.pid}, not ${pid}; left alone`);
  killTree(state.pid);
  if (flag(args, '--keep')) {
    fs.writeFileSync(p.state, JSON.stringify({ port: state.port }, null, 2));
    console.log(`stopped ${name}, data kept in ${p.dir}`);
  } else {
    await removeDir(p.dir);
    console.log(`stopped ${name}, deleted ${p.dir}`);
  }
}

async function main() {
  const [command, name, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'start': return start(name, rest);
    case 'stop': return stop(name, rest);
    case 'stop-all':
      for (const n of allNames()) await stop(n, [name, ...rest].filter(Boolean));
      return;
    case 'list':
      return console.log(JSON.stringify(allNames().map((n) => describe(n, paths(n), readState(paths(n)))), null, 2));
    case 'dialogs': {
      const p = paths(name);
      if (!rest[0]) return process.stdout.write(fs.existsSync(p.dialogsLog) ? fs.readFileSync(p.dialogsLog, 'utf8') : '');
      if (!['approve', 'cancel'].includes(rest[0])) die('answer must be approve or cancel');
      fs.writeFileSync(p.dialogAnswer, rest[0]);
      return console.log(`${name}: native dialogs will ${rest[0]}`);
    }
    case 'pick': {
      const p = paths(name);
      if (!rest[0]) die('give a path or --cancel');
      fs.writeFileSync(p.nextPick, rest[0] === '--cancel' ? '' : path.resolve(rest[0]));
      return console.log(`${name}: next file/folder picker returns ${rest[0] === '--cancel' ? 'cancel' : path.resolve(rest[0])}`);
    }
    default:
      process.stdout.write(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
      process.exit(command ? 1 : 0);
  }
}

main().catch((error) => die(error.stack || String(error)));
