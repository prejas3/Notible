// Generates Help screenshots and clips from the real app on a throwaway
// profile. Hand-run before a release: `npm run help:media`.
// See 2026-09-23-in-app-help-design.md (internal, not published), "Media generator".
//
// Safety: uses its own identifier (com.notible.app.help-media), deletes only
// that profile, and closes only the process tree it spawned. The installed
// app (NotibleApp.exe) and %APPDATA%\com.notible.app are never touched.

const { spawn, execSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

let chromium;
try { ({ chromium } = require("playwright-core")); } catch {
  console.error("help-media: playwright-core is not installed. In a scratch folder run `npm i playwright-core --no-save`, then set NODE_PATH to its node_modules.");
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "public", "help");
const ID = "com.notible.app.help-media";
const PORT = 9225;
const shots = require("./shots.cjs");
const only = process.argv.slice(2);

function findFfmpeg() {
  const base = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const dir = fs.existsSync(base) ? fs.readdirSync(base).find((name) => name.startsWith("ffmpeg-")) : undefined;
  const exe = dir && path.join(base, dir, "ffmpeg-win64.exe");
  if (!exe || !fs.existsSync(exe)) { console.error(`help-media: ffmpeg not found under ${base}\\ffmpeg-*`); process.exit(1); }
  return exe;
}

function fresh() {
  for (const dir of [path.join(process.env.APPDATA, ID), path.join(process.env.LOCALAPPDATA, ID)]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let appExited = false;

async function waitForPort() {
  for (let i = 0; i < 400; i += 1) {
    if (appExited) throw new Error("the app exited before opening its debug port");
    try { const res = await fetch(`http://localhost:${PORT}/json/version`); if (res.ok) return; } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("app did not open its debug port within 10 minutes");
}

// Neutral English sample data, created through the backend the UI itself
// uses; the page reloads afterwards so every view reads it fresh.
async function seed(page) {
  await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const doc = (text) => JSON.stringify({ type: "doc", content: text.split("\n").map((line) => (line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" })) });
    const make = (type, title, extra = {}) => invoke("create_object", { type, title, content: doc(extra.text ?? ""), props: JSON.stringify(extra.props ?? {}), parentId: extra.parentId });
    const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

    const reading = await make("folder", "Reading list");
    await make("note", "Lorem ipsum", { parentId: reading.id, text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.\nSed do eiusmod tempor incididunt ut labore." });
    await make("note", "Dolor sit amet", { parentId: reading.id, text: "Ut enim ad minim veniam, quis nostrud exercitation." });

    const home = await make("space", "Home");
    const garden = await make("project", "Garden redesign", { parentId: home.id });
    await make("task", "Measure the beds", { parentId: garden.id, props: { status: "open", priority: "medium" } });
    await make("task", "Order seeds", { parentId: garden.id, props: { status: "done", priority: "low" } });
    await make("task", "Plan the path", { parentId: garden.id, props: { status: "in_progress", priority: "high", due: day(5) } });
    const kitchen = await make("project", "Kitchen refresh", { parentId: home.id });
    await make("task", "Pick a paint colour", { parentId: kitchen.id, props: { status: "open", priority: "medium", due: day(2) } });

    await make("note", "Weekly review", { text: "## This week\n- [x] Order seeds\n- [ ] Measure the beds\nSee [[Garden redesign]] for the plan." });
    // Whiteboards keep their board in `content` (whiteboard.ts EMPTY_WHITEBOARD shape).
    await invoke("create_object", { type: "whiteboard", title: "Ideas", props: "{}", content: JSON.stringify({ version: 1, edges: [], viewport: { x: 0, y: 0, zoom: 1 }, nodes: [
      { id: "c1", kind: "card", x: 80, y: 80, width: 220, height: 120, text: "Lorem ipsum dolor" },
      { id: "c2", kind: "card", x: 440, y: 220, width: 220, height: 120, text: "Consectetur adipiscing" },
    ] }) });
  });
  await page.reload();
  await page.waitForTimeout(2500);
}

async function capture(cdp, page, selector, format) {
  let clip;
  if (selector && typeof selector === "object") clip = { ...selector, scale: 1 };
  else if (selector) {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`nothing matches ${selector}`);
    clip = { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 };
  }
  const { data } = await cdp.send("Page.captureScreenshot", { format, ...(format === "png" ? {} : { quality: 90 }), ...(clip ? { clip } : {}) });
  return Buffer.from(data, "base64");
}

async function record(cdp, page, shot, ffmpeg, file) {
  // Playwright's ffmpeg only reads piped JPEG (image2pipe + mjpeg) and only
  // writes WebM/VP8 — so frames are JPEGs kept in memory and piped in.
  const frames = [];
  let recording = true;
  const started = Date.now();
  const loop = (async () => {
    while (recording) frames.push(await capture(cdp, page, shot.clip, "jpeg"));
  })();
  try { await shot.steps(page); } finally { recording = false; await loop; }
  const fps = Math.max(4, Math.round(frames.length / ((Date.now() - started) / 1000)));
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "pipe:0",
    // VP8 needs even dimensions.
    "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libvpx", "-b:v", "1M", "-auto-alt-ref", "0", path.join(OUT, `${file}.webm`)], { input: Buffer.concat(frames), maxBuffer: 1 << 30 });
}

function cleanup(child) {
  if (child?.pid) { try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ } }
}

(async () => {
  const ffmpeg = findFfmpeg();
  fs.mkdirSync(OUT, { recursive: true });
  fresh();
  execSync("npm run build:test-host", { cwd: ROOT, stdio: "inherit" });
  // Config goes through a file: cmd.exe (shell: true) strips the quotes of an
  // inline JSON argument and tauri then refuses to start.
  const configFile = path.join(require("node:os").tmpdir(), "notible-help-media.tauri.json");
  fs.writeFileSync(configFile, JSON.stringify({ identifier: ID, productName: "Notible Help Media" }));
  const child = spawn("npx", ["tauri", "dev", "--no-watch", "--config", `"${configFile}"`], {
    cwd: ROOT, shell: true, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  child.on("exit", (code) => { appExited = true; if (code) console.error(`help-media: tauri exited with ${code}
${stderr}`); });
  let failed = false;
  try {
    await waitForPort();
    const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
    const page = browser.contexts()[0].pages()[0];
    await page.waitForTimeout(3000);
    const size = await page.evaluate(() => [innerWidth, innerHeight]);
    if (size[0] !== 1440 || size[1] !== 900) console.warn(`help-media: window is ${size.join("×")}, expected 1440×900`);
    // The UI language shows in the sidebar; screenshots must be English.
    const english = await page.evaluate(() => (document.querySelector(".core-sidebar")?.textContent ?? "").includes("Settings"));
    if (!english) throw new Error("fresh profile is not showing the English UI");
    await seed(page);
    const cdp = await page.context().newCDPSession(page);
    // Stills twice: Help shows `<name>.dark.webp` under Midnight (CE76).
    // Clips too (`<name>.dark.webm`): a light recording glares inside Midnight Help.
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") {
        await page.evaluate(() => localStorage.setItem("notible-core-theme", "night"));
        await page.reload();
        await page.waitForSelector(".core-sidebar");
      }
      for (const shot of shots) {
        if (only.length && !only.includes(shot.name)) continue;
        const file = theme === "dark" ? `${shot.name}.dark` : shot.name;
        try {
          if (shot.kind === "clip") await record(cdp, page, shot, ffmpeg, file);
          else { await shot.steps(page); fs.writeFileSync(path.join(OUT, `${file}.webp`), await capture(cdp, page, shot.clip, "webp")); }
          await shot.after?.(page);
          await page.keyboard.press("Escape");
          console.log(`help-media: ${file} ✓`);
        } catch (error) {
          throw new Error(`shot "${file}" failed: ${error.message}`);
        }
      }
    }
    await browser.close().catch(() => {});
  } catch (error) {
    failed = true;
    console.error(`help-media: ${error.message}`);
  } finally {
    cleanup(child);
  }
  process.exit(failed ? 1 : 0);
})();
