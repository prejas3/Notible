/**
 * Keeps the author-facing pack honest against the actual contract.
 *
 * Documentation that ships next to an API drifts from it silently — nothing
 * breaks, the docs just quietly start lying. These assertions are the cheap
 * half of preventing that: every exported name and every slot has to appear
 * in the reference and in the editor types, and every file the devkit exporter
 * claims to write has to exist.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const contract = read("packages/plugin-api/src/index.ts");
const types = read("packages/plugin-api/notible-plugin-api.d.ts");
const reference = read("docs/plugin-api/REFERENCE.md");
const start = read("docs/plugin-api/START.md");
const readme = read("docs/plugin-api/README.md");
const lib = read("src-tauri/src/lib.rs");

const failures = [];

// 1. Every exported interface/type must exist in the editor types file.
const exported = [...contract.matchAll(/export (?:interface|type) (\w+)/g)].map((match) => match[1]);
assert(exported.length > 10, "contract scan found almost nothing — the regex is broken");
for (const name of exported) {
  if (!types.includes(name)) failures.push(`notible-plugin-api.d.ts is missing exported type ${name}`);
}

// 2. Every slot Core renders must be documented, and vice versa.
const slotStart = contract.indexOf("export const UI_SLOTS");
const slotBlock = contract.slice(slotStart, contract.indexOf("] as const;", slotStart));
const declaredSlots = [...slotBlock.matchAll(/"([a-z]+\.[a-z]+)"/g)].map((match) => match[1]);
assert(declaredSlots.length === 7, `expected 7 UI slots, found ${declaredSlots.length}`);
for (const slot of declaredSlots) {
  if (!reference.includes(`\`${slot}\``)) failures.push(`REFERENCE.md does not document the slot ${slot}`);
}

// 3. Every Core event must be documented.
const eventsBlock = contract.slice(contract.indexOf("export interface CoreEvents"), contract.indexOf("export const CORE_EVENTS"));
const events = [...eventsBlock.matchAll(/"([a-z]+\.[a-z]+)":/g)].map((match) => match[1]);
assert(events.length === 9, `expected 9 core events, found ${events.length}`);
for (const event of events) {
  if (!reference.includes(event)) failures.push(`REFERENCE.md does not document the event ${event}`);
}

// 4. Every permission value must be documented.
// The end marker must actually exist: `indexOf` returning -1 made this slice
// the entire rest of the file, so every string-literal union declared below
// PluginPermission was read as a permission name.
const permissionStart = contract.indexOf("export const PLUGIN_PERMISSIONS");
const permissionEnd = contract.indexOf("RETIRED_PERMISSIONS");
if (permissionStart < 0 || permissionEnd < 0) failures.push("cannot locate the PluginPermission block in the contract");
const permissionBlock = contract.slice(permissionStart, permissionEnd);
const permissions = [...permissionBlock.matchAll(/"([\w.]+)"/g)].map((match) => match[1]);
// The list the validator actually enforces is derived from the same array, so
// reading the array — not the type union — is what keeps docs honest.
if (permissions.length < 5) failures.push("the PLUGIN_PERMISSIONS array parsed as almost empty; the contract shape changed");
for (const permission of permissions) {
  if (!reference.includes(permission)) failures.push(`REFERENCE.md does not document the permission ${permission}`);
}

// 5. Every settings field kind must be documented.
for (const kind of [...contract.matchAll(/\{ kind: "(\w+)"; key: string/g)].map((match) => match[1])) {
  if (!reference.includes(`"${kind}"`)) failures.push(`REFERENCE.md does not document the settings field kind ${kind}`);
}

// 6. Everything the devkit exporter promises must exist on disk, or the
//    include_str! would fail the build — but the README it writes lists files
//    by name, so check those too.
for (const path of [
  "docs/plugin-api/START.md",
  "docs/plugin-api/REFERENCE.md",
  "packages/plugin-api/notible-plugin-api.d.ts",
  "plugins/examples/pomodoro/plugin.json",
  "plugins/examples/pomodoro/main.js",
  "plugins/examples/pomodoro/README.md",
  "plugins/examples/workbench/plugin.json",
  "plugins/examples/workbench/main.js",
  "plugins/examples/workbench/theme.css",
  "docs/THEME_PACKS.md",
  "docs/LANGUAGE_PACKS.md",
  "examples/theme-glass/plugin.json",
  "examples/theme-glass/theme.css",
  "locales/en.json",
]) {
  if (!existsSync(join(root, path))) failures.push(`devkit file missing: ${path}`);
  if (!lib.includes(path.split("/").pop())) failures.push(`lib.rs devkit list does not mention ${path}`);
}

// 6b. Theme hooks are a promise to strangers: every hook token/attribute the docs
//     name must really exist in Core, and every Core hook must be documented.
{
  const themeDoc = readFileSync(join(root, "docs/THEME_PACKS.md"), "utf8");
  const coreCss = readFileSync(join(root, "src/core/app/core-only.css"), "utf8");
  const coreApp = readFileSync(join(root, "src/core/app/CoreOnlyApp.tsx"), "utf8") + readFileSync(join(root, "src/core/app/CoreMarkdownEditor.tsx"), "utf8");
  for (const token of ["app-backdrop", "sidebar-background", "sidebar-filter", "main-background", "editor-font-size", "editor-line-height"]) {
    if (!coreCss.includes(`var(--notible-${token}`)) failures.push(`Core does not consume hook token --notible-${token}`);
    if (!themeDoc.includes(`--notible-${token}`)) failures.push(`THEME_PACKS.md does not document --notible-${token}`);
  }
  for (const attr of ["data-notible-mode", "data-notible-theme", "data-notible-density", 'data-notible-region="sidebar"', 'data-notible-region="main"', 'data-notible-region="editor"']) {
    if (!themeDoc.includes(attr)) failures.push(`THEME_PACKS.md does not document ${attr}`);
    // Set either as a JSX attribute or through element.dataset.notibleXxx.
    const camel = attr.replace(/^data-/, "").replace(/-([a-z])/g, (_m, c) => c.toUpperCase()).split("=")[0];
    if (!coreApp.includes(attr) && !coreApp.includes(`dataset.${camel}`) && !coreApp.includes(`${attr.split("=")[0]}=`)) failures.push(`Core does not set ${attr}`);
  }
}

// 7. The guide must not promise a version the contract does not claim.
const apiVersion = contract.match(/EXTENSION_API_VERSION = "([^"]+)"/)?.[1];
assert(apiVersion, "could not read EXTENSION_API_VERSION");
// README.md is in this list because it was NOT, and sat at 1.1 while the
// contract went to 1.2 and then 1.3 — the author-facing front page was the
// only doc nothing compared against the constant.
for (const [name, body] of [["START.md", start], ["REFERENCE.md", reference], ["README.md", readme]]) {
  if (!body.includes(apiVersion)) failures.push(`${name} does not mention apiVersion ${apiVersion}`);
}

// 8. Rust hardcodes the version it stamps into the developer pack's README and
//    into every scaffolded plugin. It sat at "0.1" for two API releases because
//    nothing compared the two sides.
const rustVersion = lib.match(/const PLUGIN_API_VERSION: &str = "([^"]+)"/)?.[1];
if (rustVersion !== apiVersion) {
  failures.push(`lib.rs PLUGIN_API_VERSION is ${rustVersion ?? "missing"}, contract says ${apiVersion}`);
}

if (failures.length > 0) {
  console.error(`Plugin docs check failed (${failures.length}):`);
  for (const failure of [...new Set(failures)]) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Plugin docs checks passed: ${exported.length} types, ${declaredSlots.length} slots, ${events.length} events, ${permissions.length} permissions documented.`);
