// Translation coverage report: how many user-visible literals are still NOT wrapped
// in t(), per area. `locale:extract` only knows about wrapped strings, so it cannot
// say how much of the interface is left; this scans the shipped JSX for the rest.
//
//   npm run locale:coverage           -> table per area
//   npm run locale:coverage -- --files -> per file
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP = /^(Ctrl|Alt|Shift|Space|Esc|N|Notible|SQLite · local-first|OK|API|MD|PDF|dist-core|Core)$/;

/** Area = the part of the product a person would name. */
const AREAS = [
  ["Settings panels (plugins list, updates, plugin forms)", /CoreMatrixPanel|CoreUpdateSection|CorePluginSettingsForm|PluginSettingsSurface/],
  ["Main window (sidebar, notes, menus; the Settings screens are done)", /CoreOnlyApp\.tsx/],
  ["Core shell and editor", /src\/core\//],
  ["Board / Typewriter", /typewriter/],
  ["Whiteboard", /canvas-ui/],
  ["Other built-in plugins", /plugins\/builtin\//],
  ["Product", /src\/product\//],
];

function walk(dir, out = []) {
  for (const name of readdirSync(resolve(root, dir))) {
    const rel = join(dir, name);
    if (statSync(resolve(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx$/.test(name)) out.push(rel);
  }
  return out;
}

function literalsIn(source) {
  const found = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  lines.forEach((line) => {
    if (/^\s*(import|\/\/|\*|\/\*)/.test(line)) return;
    for (const m of line.matchAll(/\b(?:title|placeholder|aria-label|ariaLabel|label)="([^"{}]*[A-Za-z][^"{}]*)"/g)) if (!SKIP.test(m[1])) found.push(m[1]);
    for (const m of line.matchAll(/>([^<>{}\n]*?[A-Za-z][^<>{}\n]*?)<\//g)) { const text = m[1].trim(); if (text && !SKIP.test(text) && /^[A-Z]/.test(text)) found.push(text); }
  });
  return found;
}

const files = [...walk("src/core"), ...walk("src/product"), ...walk("plugins/builtin")];
const perFile = files.map((file) => [file.replace(/\\/g, "/"), literalsIn(readFileSync(resolve(root, file), "utf8")).length]).filter(([, n]) => n > 0);
const perArea = new Map(AREAS.map(([name]) => [name, 0]));
for (const [file, count] of perFile) {
  const area = AREAS.find(([, pattern]) => pattern.test(file));
  if (area) perArea.set(area[0], perArea.get(area[0]) + count);
}
const total = perFile.reduce((sum, [, n]) => sum + n, 0);
console.log("Untranslated literals still in the interface (not wrapped in t()):\n");
for (const [name, count] of perArea) console.log(`  ${String(count).padStart(4)}  ${name}`);
console.log(`\n  ${String(total).padStart(4)}  total\n`);
if (process.argv.includes("--files")) for (const [file, count] of perFile.sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(4)}  ${file}`);
