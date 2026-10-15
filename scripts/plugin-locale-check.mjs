// I18N (Hive #28): the official plugins translate their own UI through
// `context.i18n.t` and ship Polish in `locales/pl.json`. Core's
// `locale:extract` does not read plugins/notible-*, so this keeps each
// plugin's file in step with its `t("…")` calls: every key has a Polish
// entry, no entry is left without a call, and plugin.json declares the file.
//
//   node scripts/plugin-locale-check.mjs            -> check, exit 1 on a gap
//   node scripts/plugin-locale-check.mjs --missing  -> also print missing keys
//   node scripts/plugin-locale-check.mjs --keys notible-tables -> that plugin's keys
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginsDir = resolve(root, "plugins");
// `t(...)` or the `tr(...)` marker (a label translated later) with a literal first argument: "…", '…' or a template without ${}.
const CALL = /(?:(?<![\w$.])|(?<=i18n\.))tr?\(\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`([^`$\\]*)`)\s*[,)]/g;
const unescape = (text) => text.replace(/\\(["'\\])/g, "$1").replace(/\\n/g, "\n");

export function keysIn(source) {
  const keys = new Set();
  for (const match of source.matchAll(CALL)) keys.add(unescape(match[1] ?? match[2] ?? match[3]));
  return keys;
}

// `--keys notible-tables`: print that plugin's keys as JSON (for translating).
if (process.argv.includes("--keys")) {
  const dir = join(pluginsDir, process.argv[process.argv.indexOf("--keys") + 1]);
  console.log(JSON.stringify([...keysIn(readFileSync(join(dir, "main.js"), "utf8"))], null, 1));
  process.exit(0);
}

const failures = [];
const report = [];
for (const name of readdirSync(pluginsDir).filter((entry) => entry.startsWith("notible-")).sort()) {
  const dir = join(pluginsDir, name);
  const main = join(dir, "main.js");
  if (!existsSync(main)) continue;
  const keys = keysIn(readFileSync(main, "utf8"));
  // Shared modules a plugin bundles (plugins/shared/*.js copied in) are scanned with it.
  for (const extra of readdirSync(dir).filter((file) => file.endsWith(".js") && file !== "main.js" && !file.includes("check"))) {
    for (const key of keysIn(readFileSync(join(dir, extra), "utf8"))) keys.add(key);
  }
  if (keys.size === 0) continue;
  const manifest = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8"));
  const declared = manifest.locales?.pl;
  if (declared !== "locales/pl.json") { failures.push(`${name}: plugin.json must declare "locales": { "pl": "locales/pl.json" }`); continue; }
  const file = join(dir, declared);
  if (!existsSync(file)) { failures.push(`${name}: ${declared} is missing`); continue; }
  const strings = JSON.parse(readFileSync(file, "utf8")).strings ?? {};
  // Core's package loader (loadLocales in src/core/extensions/package.ts) keeps
  // only string entries with key and value up to 300 characters and drops the
  // rest without a word, so anything else would quietly stay English.
  const usable = (key, value) => typeof value === "string" && value.trim() && key.length <= 300 && value.length <= 300;
  for (const key of keys) if (key.length > 300) failures.push(`${name}: key longer than 300 characters can never be translated: ${key.slice(0, 60)}…`);
  for (const [key, value] of Object.entries(strings)) if (typeof value !== "string" || value.length > 300) failures.push(`${name}: Polish entry the loader would drop (not a string or over 300 characters): ${key.slice(0, 60)}`);
  const missing = [...keys].filter((key) => key.length <= 300 && !usable(key, strings[key]));
  const stale = Object.keys(strings).filter((key) => !keys.has(key));
  report.push(`${name}: ${keys.size} keys, ${missing.length} missing, ${stale.length} stale`);
  if (missing.length) failures.push(`${name}: ${missing.length} keys without Polish${process.argv.includes("--missing") ? `\n  ${missing.join("\n  ")}` : " (run with --missing)"}`);
  if (stale.length) failures.push(`${name}: ${stale.length} Polish keys no call uses:\n  ${stale.join("\n  ")}`);
}
console.log(report.join("\n"));
if (failures.length) {
  console.error(`\nplugin-locale-check failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("plugin-locale-check: ok");
