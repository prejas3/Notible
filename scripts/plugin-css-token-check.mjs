/**
 * D6 guard: plugin CSS may not paint with a colour literal.
 *
 * The point is not tidiness. A literal is invisible to the theme: a panel
 * written with `#a33c2f` stays that red in night mode and under every theme a
 * third party ships, which is exactly the failure D3 exists to prevent.
 *
 * Two shapes are rejected, both for the same reason:
 *
 *   1. A bare literal — `color: #a33c2f` — which no theme can reach.
 *   2. A fallback inside var() — `color: var(--surface, #fff)`. This one is
 *      worse than it looks. While the alias is defined the fallback is dead
 *      code, so it reads as harmless; the moment an alias is renamed or
 *      dropped it silently paints light-mode colour under every theme instead
 *      of failing visibly. That is precisely how plugin panels ignored the
 *      theme before core-only.css started defining the unprefixed aliases.
 *      Plugin CSS is at zero fallbacks today, so the ban costs nothing now
 *      and stops the shape coming back.
 *
 * plugins/notible-sync used to be out of scope on the grounds that an external
 * plugin can be installed on an older host, where a fallback is real defence.
 * That stopped being true in 0.55.0: its stylesheet now names the PUBLIC
 * `--notible-*` contract, which has existed since API 1.0, and the fallbacks
 * it used to carry included a green accent that Notible does not own — so on
 * any host missing the deprecated unprefixed aliases it painted itself the
 * wrong colour. Its CSS lives inside main.js, so that file is scanned too.
 *
 * Scope: properties that paint a surface. `box-shadow` is excluded — its
 * literals are translucent black, which is theme-neutral by construction.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../plugins/", import.meta.url));
const EXTERNAL = ["notible-sync", "notible-sync-simple", "notible-reportit"];
// A plugin may wrap a block of CSS for a FIXED, non-theme palette — a print
// document, say — between these sentinels; the check skips it. The colour
// literals in there are the point, not a theme escape.
const PALETTE_EXEMPT = /\/\*\s*palette-exempt[\s\S]*?end palette-exempt\s*\*\//gi;
const PAINTS = /(^|[;{])\s*(color|background|background-color|border(?:-\w+)?-color|border|outline-color|fill|stroke|caret-color|text-decoration-color)\s*:([^;}]*)/gi;
const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;

async function cssFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (!EXTERNAL.includes(entry.name)) found.push(...(await cssFiles(path))); }
    else if (entry.name.endsWith(".css")) found.push(path);
  }
  return found;
}

/** Both sync plugins ship one ES module with their CSS in a template literal. */
async function externalStyleFiles() {
  return EXTERNAL.map((name) => join(ROOT, name, "main.js"));
}

const offences = [];
for (const file of [...(await cssFiles(ROOT)), ...(await externalStyleFiles())]) {
  // Strip palette-exempt regions BEFORE the generic comment strip, so the
  // sentinels are still there to find.
  const css = (await readFile(file, "utf8")).replace(PALETTE_EXEMPT, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, , property, value] of css.matchAll(PAINTS)) {
    // A literal anywhere in the value is an offence now — bare or inside a
    // var() fallback. No need to strip var(…) first to tell them apart.
    if (LITERAL.test(value)) offences.push(`${file.replace(ROOT, "")}: ${property}:${value.trim().slice(0, 70)}`);
  }
}

assert.deepEqual(offences, [], `plugin CSS paints with colour literals, which no theme can reach:\n  ${offences.join("\n  ")}`);
console.log(`Plugin CSS token check passed: no colour literal paints a surface.`);
