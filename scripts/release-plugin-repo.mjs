#!/usr/bin/env node
// Publish an external plugin from this monorepo to its own GitHub repo, in one
// step, so the released copy and the repo cannot drift apart again (ReportIt
// 0.1.12 was released without ever reaching prejas3/notible-reportit).
//
//   node scripts/release-plugin-repo.mjs notible-reportit "Release notes text"
//
// plugins/<dir> → github.com/prejas3/<dir>: runs self-check.mjs, copies
// main.js / plugin.json / self-check.mjs / README.md, every file named in the
// manifest's `locales` and `styles`, and `fixtures/` (for the self-check),
// commits and pushes, then creates release v<version> with <id>.zip
// (plugin.json + main.js + README.md + locales + styles, paths kept) and
// plugin.json, which is what the market reads from releases/latest. A
// declared locale missing from the zip fails the plugin's load, which is why
// they are packed from the manifest rather than from a fixed list.
// Refuses a version that already has a release (never reuse a version).
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const [dir, notes] = process.argv.slice(2);
if (!dir || !notes) {
  console.error('usage: node scripts/release-plugin-repo.mjs <plugins/ dir name> "<release notes>"');
  process.exit(1);
}
const source = resolve("plugins", dir);
const manifest = JSON.parse(readFileSync(join(source, "plugin.json"), "utf8"));
const repo = `prejas3/${dir}`;
const tag = `v${manifest.version}`;
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" }).trim();

const released = run("gh", ["release", "list", "--repo", repo, "--limit", "100", "--json", "tagName", "--jq", ".[].tagName"]).split("\n");
if (released.includes(tag)) throw new Error(`${repo} already has ${tag}: bump plugin.json first`);
if (existsSync(join(source, "self-check.mjs"))) run("node", [join(source, "self-check.mjs")], source);

const work = mkdtempSync(join(tmpdir(), "notible-plugin-release-"));
try {
  run("gh", ["repo", "clone", repo, work, "--", "-q"]);
  // Files the running plugin needs, in the zip with their folders.
  const packed = ["plugin.json", "main.js", "README.md", ...Object.values(manifest.locales ?? {}), ...(manifest.styles ?? [])];
  for (const file of packed) {
    if (!existsSync(join(source, file))) throw new Error(`${file} is declared but missing in ${source}`);
  }
  for (const file of [...new Set([...packed, "self-check.mjs"])]) {
    if (!existsSync(join(source, file))) continue;
    mkdirSync(dirname(join(work, file)), { recursive: true });
    copyFileSync(join(source, file), join(work, file));
  }
  if (existsSync(join(source, "fixtures"))) cpSync(join(source, "fixtures"), join(work, "fixtures"), { recursive: true });
  const author = run("git", ["log", "-1", "--format=%an|%ae"], work).split("|");
  run("git", ["add", "-A"], work);
  if (run("git", ["status", "--porcelain"], work)) {
    run("git", ["-c", `user.name=${author[0]}`, "-c", `user.email=${author[1]}`, "commit", "-q", "-m", `release: ${manifest.version}`, "-m", notes, "-m", "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"], work);
    run("git", ["push", "-q", "origin", "HEAD"], work);
  }
  const zip = join(work, `${manifest.id}.zip`);
  // tar -a (bsdtar, in Windows since 10 1803) keeps `locales/pl.json` as a
  // path; Compress-Archive flattened it to the zip root.
  // Windows' own bsdtar by full path: from Git Bash, plain `tar` is GNU tar,
  // which writes a tar archive under a .zip name.
  run(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", zip, ...new Set(packed)], work);
  console.log(run("gh", ["release", "create", tag, zip, join(work, "plugin.json"), "--repo", repo, "--title", tag, "--notes", notes], work));
  const latest = run("gh", ["api", `repos/${repo}/releases/latest`, "--jq", ".tag_name"]);
  if (latest !== tag) throw new Error(`releases/latest is ${latest}, expected ${tag}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
