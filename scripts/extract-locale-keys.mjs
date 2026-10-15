// Generate `locales/en.json` — the canonical set of translatable strings.
//
// This file is the missing piece the i18n design turns on. It is, at once:
//
//   * the template a translator fills in (there is no other way to know what
//     strings exist — they are arguments at call sites, not a declared list),
//   * what `quality-check.mjs` validates `t("…")` calls against, replacing the
//     old rule that regex-searched the dictionary *source files* and therefore
//     could not survive translations moving into JSON,
//   * the denominator for "N strings untranslated", which is otherwise not
//     computable when an untranslated string is spelled identically to its key.
//
// Run: `npm run locale:extract`. Checked by `npm run test:quality`, so it
// cannot silently drift from the code.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Roots that ship in the application. `plugins/builtin` is here because the
 * old gate walked `src/` alone, which is exactly where the hardcoded Polish
 * was not.
 */
export const SOURCE_ROOTS = ["src/core", "src/product", "plugins/builtin"];

/**
 * Strings `t()` must return untranslated, whatever any locale file says.
 *
 * A hostile translation is valid JSON. Relabelling a destructive control or
 * inverting a warning ("This cannot be undone." -> "You can restore this from
 * Trash at any time.") costs a user their data while they read a sentence
 * saying it is safe. These few strings stay English for everyone; a wrong
 * warning is worse than an English one.
 *
 * Native dialog text built in Rust (`grant_plugin_trust`, the folder picker)
 * is out of scope for translation entirely and is not listed here — it never
 * passes through `t()` in the first place, and it must stay that way.
 */
export const UNTRANSLATABLE = [
  // Two-step delete confirmation.
  "Delete", "Delete all", "Cancel", "Continue", "This cannot be undone.",
  "Move to trash", "Delete forever", "Empty trash",
  // Database restore.
  "Restore", "Restore and reload",
  // Plugin installation — "Install .zip" relabelled as "Import notes" is the
  // whole pretext for a drive-by install.
  "Add plugin folder", "Install .zip", "Remove",
  // Folder grants.
  "Revoke", "Unlink folder",
];

function walk(dir, files = []) {
  const absolute = resolve(root, dir);
  for (const name of readdirSync(absolute)) {
    const relative = join(dir, name);
    if (statSync(resolve(root, relative)).isDirectory()) walk(relative, files);
    else if (/\.(ts|tsx)$/.test(name)) files.push(relative);
  }
  return files;
}

/** Every `t("…")` argument in the shipped source, in sorted order. */
export function collectKeys() {
  const keys = new Set();
  for (const dir of SOURCE_ROOTS) {
    for (const file of walk(dir)) {
      const source = readFileSync(resolve(root, file), "utf8");
      // Trailing `[,)]` rather than `)`: a key with placeholders is called as
      // t("{count} items…", { count }), and requiring the closing paren
      // silently dropped exactly the interpolated strings — the ones that
      // matter most, because they are the ones with grammar in them.
      // tCore: the same catalogue, called outside React (Markdown renderer, error boundary).
      for (const match of source.matchAll(/\b(?:t|tr|tCore)\(\s*"([^"]+)"\s*[,)]/g)) keys.add(match[1]);
      // Single-quoted keys too: a key that itself contains "quotes" (Hive #28).
      for (const match of source.matchAll(/\b(?:t|tr|tCore)\(\s*'([^']+)'\s*[,)]/g)) keys.add(match[1]);
    }
  }
  return [...keys].sort((left, right) => left.localeCompare(right, "en"));
}

export function buildCatalogue() {
  const keys = collectKeys();
  const untranslatable = new Set(UNTRANSLATABLE);
  return {
    // English is the source language, so every value equals its key. The file
    // exists for its key *set*, not for its values.
    locale: "en",
    name: "English",
    strings: {
      app: Object.fromEntries(keys.filter((key) => !untranslatable.has(key)).map((key) => [key, key])),
    },
    // Emitted so a translator can see what deliberately cannot be translated,
    // rather than wondering why their entry had no effect.
    untranslatable: [...untranslatable].sort((left, right) => left.localeCompare(right, "en")),
  };
}

export const CATALOGUE_PATH = "locales/en.json";

export function serialiseCatalogue(catalogue) {
  return `${JSON.stringify(catalogue, null, 2)}\n`;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("extract-locale-keys.mjs")) {
  const catalogue = buildCatalogue();
  mkdirSync(resolve(root, "locales"), { recursive: true });
  writeFileSync(resolve(root, CATALOGUE_PATH), serialiseCatalogue(catalogue), "utf8");
  const count = Object.keys(catalogue.strings.app).length;
  console.log(`locale catalogue written: ${count} translatable keys, ${catalogue.untranslatable.length} deliberately untranslatable`);
}
