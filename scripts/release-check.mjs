import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseNotesSection } from "./release-notes.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const pkg = readJson("package.json");
const tauri = readJson("src-tauri/tauri.conf.json");
const cargo = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const versions = new Set([pkg.version, tauri.version, cargoVersion]);
const failures = [];

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? ""));
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`invalid semantic version: ${left} / ${right}`);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

const verifyPrevious = process.argv.includes("--verify-previous");
const manifestArgIndex = process.argv.indexOf("--manifest-url");
const manifestUrl = manifestArgIndex >= 0 && process.argv[manifestArgIndex + 1]
  ? process.argv[manifestArgIndex + 1]
  : tauri.plugins?.updater?.endpoints?.[0];

if (verifyPrevious) {
  if (!manifestUrl) failures.push("cannot verify previous release: updater manifest URL is missing");
  else {
    try {
      const response = await fetch(manifestUrl, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`manifest request failed (${response.status})`);
      const manifest = await response.json();
      if (!manifest.version) throw new Error("manifest has no version");
      if (compareVersions(pkg.version, manifest.version) <= 0) {
        failures.push(`release ${pkg.version} is not newer than published ${manifest.version}`);
      } else {
        console.log(`Previous published release verified: ${manifest.version} → ${pkg.version}.`);
      }
    } catch (error) {
      failures.push(`cannot verify previous release: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (versions.size !== 1 || versions.has(undefined)) {
  failures.push(`version mismatch: package=${pkg.version}, tauri=${tauri.version}, cargo=${cargoVersion}`);
}

for (const required of [
  `docs/releases/RELEASE_CHECKLIST_${pkg.version}.md`,
  "docs/AKTUALIZACJE.md",
  "docs/RELEASE_NOTES.md",
  "src-tauri/capabilities/default.json",
]) {
  if (!existsSync(resolve(root, required))) failures.push(`missing release file: ${required}`);
}

// docs/RELEASE_NOTES.md is user-facing (shown in-app, Settings → About) and
// must always be in English — unlike docs/AKTUALIZACJE.md, the internal
// Polish dev changelog. Enforced two ways: this file must have a section for
// the version being released, and that section must not contain Polish
// diacritics (a reliable tell for "someone wrote this in Polish").
const releaseNotesPath = resolve(root, "docs/RELEASE_NOTES.md");
if (existsSync(releaseNotesPath)) {
  // The same extractor as latest.json (release-notes.mjs), so an empty section or CRLF line endings fail here, before the build.
  try {
    const body = releaseNotesSection(readFileSync(releaseNotesPath, "utf8"), pkg.version);
    if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(body)) failures.push(`docs/RELEASE_NOTES.md's ${pkg.version} section contains Polish characters — it must be English only`);
  } catch (error) {
    failures.push(error.message);
  }
}

if (failures.length) {
  console.error(`Release check failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Release metadata is consistent: ${pkg.version}.`);
