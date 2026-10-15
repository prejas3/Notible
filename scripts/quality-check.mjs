import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildCatalogue, CATALOGUE_PATH, serialiseCatalogue, SOURCE_ROOTS } from "./extract-locale-keys.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const failures = [];

// The legacy editor's slash-command assertions lived here; the Core editor
// (src/core/app/CoreMarkdownEditor.tsx) has its own slash menu, tracked in
// PLAN_AUDYTU_PLUGINOW_I_TEST_HOST_2026-08-09.md (internal, not published) P0.

const i18n = read("src/lib/i18n.ts");
if (!i18n.includes("const t = useCallback")) {
  failures.push("useI18n translation function is not referentially stable");
}
const coreI18n = read("src/core/app/core-i18n.ts");
if (!coreI18n.includes("const t = useCallback")) {
  failures.push("useCoreI18n translation function is not referentially stable");
}
if (!coreI18n.includes('import bundledPolishLocale from "../../../locales/pl.json"')) {
  failures.push("the shipped frontend does not bundle locales/pl.json");
}
if (!coreI18n.includes("...(bundledPolishLocale.strings?.app")) {
  failures.push("the bundled Polish catalogue is not merged into the core translator");
}

// Translatable strings are validated against the generated catalogue, not by
// regex-searching a dictionary's source text. The old rule only worked while
// every translation lived in a `.ts` object literal; the moment locales move
// to JSON — which is the whole point of community translations — it would
// report every string in the app as untranslated.
const catalogue = JSON.parse(read(CATALOGUE_PATH));
const catalogueKeys = new Set(Object.keys(catalogue.strings.app));
const untranslatable = new Set(catalogue.untranslatable);

// The catalogue is generated, so it can go stale. Regenerating is the fix for
// a failure here; editing it by hand is not.
if (serialiseCatalogue(buildCatalogue()) !== read(CATALOGUE_PATH)) {
  failures.push(`${CATALOGUE_PATH} is stale - run: npm run locale:extract`);
}

// The runtime's untranslatable set and the extractor's must not drift. One
// decides what t() refuses to translate, the other what a translator is told
// cannot be translated; a gap between them is a string a hostile locale could
// rewrite while the documentation claims it cannot.
for (const key of untranslatable) {
  if (!coreI18n.includes(`"${key}"`)) {
    failures.push(`UNTRANSLATABLE key missing from the core-i18n.ts runtime list: ${key}`);
  }
}

// A fragment cannot be translated: its position is fixed by JSX, so no locale
// file can repair the grammar around it. Keys must be whole sentences.
for (const key of catalogueKeys) {
  if (/^(?:contains|items|including|and|or|of|the)$/i.test(key.trim())) {
    failures.push(`translatable key is a sentence fragment: ${key}`);
  }
}

function hasTranslation(key) {
  return catalogueKeys.has(key) || untranslatable.has(key);
}

function walk(dir, resolves) {
  const absolute = new URL(dir, root);
  for (const name of readdirSync(absolute)) {
    const relative = `${dir}${name}`;
    const full = new URL(relative, root);
    if (statSync(full).isDirectory()) walk(`${relative}/`, resolves);
    else if (/\.(ts|tsx)$/.test(name)) {
      const source = read(relative);
      for (const match of source.matchAll(/\b(?:t|tr)\(\s*(?:"([^"]+)"|'([^']+)')\s*[,)]/g)) {
        const key = match[1] ?? match[2];
        if (!resolves(key)) failures.push(`key not in the locale catalogue: ${key} (${relative}) - run: npm run locale:extract`);
      }
      // Literal UI attributes, now enforced everywhere including
      // plugins/builtin. Turning the walk on there first surfaced 60
      // untranslated aria-labels — labels a screen reader reads out, so the
      // worst place to leave untranslated — and they have since been
      // converted. The exception this rule used to carry is gone.
      if (name.endsWith(".tsx")) {
        for (const match of source.matchAll(/\b(?:title|aria-label|placeholder)="([^"]+)"/g)) {
          const value = match[1];
          const technicalPlaceholder = value.startsWith("https://") || value.includes("{");
          if (!technicalPlaceholder) {
            failures.push(`untranslated literal UI attribute: ${value} (${relative})`);
          }
        }
      }
    }
  }
}
// The gate used to walk `src/` alone — which is precisely where the hardcoded
// Polish is not. The shipped roots include plugins/builtin.
for (const dir of [...SOURCE_ROOTS, "src/lib"]) walk(`${dir}/`, hasTranslation);

if (failures.length) {
  console.error(`Quality check failed (${failures.length}):`);
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Quality check passed: translation calls and JSX UI attributes verified.");
