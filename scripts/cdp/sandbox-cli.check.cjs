// Hive #17: sandbox.cjs never stops or deletes an instance it was not asked
// for. An occupied name refuses `start` without touching it, and
// `stop --pid N` leaves alone an instance whose pid is not N. Runs against a
// throwaway NOTIBLE_SANDBOX_ROOT with a sleeping node process as the "app".
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "notible-sandbox-cli-"));
const env = { ...process.env, NOTIBLE_SANDBOX_ROOT: root, NOTIBLE_SANDBOX_EXE: process.execPath };
const cli = (...args) => spawnSync(process.execPath, [path.join(__dirname, "sandbox.cjs"), ...args], { env, encoding: "utf8" });
const alive = (pid) => { try { return process.kill(pid, 0); } catch { return false; } };

const app = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
const dir = path.join(root, "occupied");
fs.mkdirSync(path.join(dir, "data"), { recursive: true });
fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ pid: app.pid, port: 9399 }));
fs.writeFileSync(path.join(dir, "data", "keep.txt"), "someone else's");
try {
  const started = cli("start", "occupied");
  assert.notEqual(started.status, 0, "start refuses a running name");
  assert.match(started.stderr, /already running/);
  assert.ok(alive(app.pid) && fs.existsSync(path.join(dir, "data", "keep.txt")), "and leaves it running, data intact");

  const wrong = cli("stop", "occupied", "--pid", String(app.pid + 1));
  assert.notEqual(wrong.status, 0, "stop --pid refuses another pid");
  assert.ok(alive(app.pid) && fs.existsSync(path.join(dir, "data", "keep.txt")), "and leaves it running, data intact");

  const right = cli("stop", "occupied", "--pid", String(app.pid));
  assert.equal(right.status, 0, right.stderr);
  assert.ok(!fs.existsSync(dir), "the matching pid is stopped and deleted");
  console.log("sandbox CLI ownership checks passed");

  // RELEASE-SAFETY (Hive #15): node.exe stands in for a release exe, which has no debug marker.
  const refused = cli("start", "claude-release");
  assert.notEqual(refused.status, 0, "start refuses a NOTIBLE_SANDBOX_EXE that is not a debug build");
  assert.match(refused.stderr, /not a debug build/);
  assert.ok(!fs.existsSync(path.join(root, "claude-release", "state.json")), "and launches nothing");

  // The same marker gates the release build (scripts/release-build.ps1), and must match the Rust one.
  const { MARKER, hasDebugMarker } = require("../debug-build-marker.cjs");
  const rust = fs.readFileSync(path.join(__dirname, "..", "..", "src-tauri", "src", "sandbox.rs"), "utf8");
  assert.ok(rust.includes(`#[cfg(debug_assertions)]\nconst DEBUG_BUILD_MARKER: &str = "${MARKER}";`), "the marker is the Rust one, debug-only");
  const debugExe = path.join(root, "debug.exe");
  const releaseExe = path.join(root, "release.exe");
  fs.writeFileSync(debugExe, Buffer.concat([Buffer.alloc(4096, 7), Buffer.from(MARKER), Buffer.alloc(64)]));
  fs.writeFileSync(releaseExe, Buffer.concat([Buffer.alloc(4096, 7), Buffer.from(MARKER.slice(0, -1))]));
  assert.ok(hasDebugMarker(debugExe) && !hasDebugMarker(releaseExe));
  const gate = (exe) => spawnSync(process.execPath, [path.join(__dirname, "..", "debug-build-marker.cjs"), "--release", exe], { encoding: "utf8" });
  assert.equal(gate(debugExe).status, 1, "the release gate fails a debug-assertions exe");
  assert.equal(gate(releaseExe).status, 0, "and passes a clean one");
  const ps1 = fs.readFileSync(path.join(__dirname, "..", "release-build.ps1"), "utf8");
  assert.ok(ps1.indexOf("debug-build-marker.cjs --release") > ps1.indexOf("run tauri:build") && ps1.indexOf("debug-build-marker.cjs --release") < ps1.indexOf("release:updater-package"), "release-build.ps1 checks the exe before packaging it");
  console.log("debug-build guard checks passed");
} finally {
  app.kill();
  fs.rmSync(root, { recursive: true, force: true });
}
