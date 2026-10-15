// Automations shipped with 29 `automation-*` classes and no stylesheet: the
// only file defining them was src/components/views/views.css, which the Core
// build never loads. Nothing failed — the screen just rendered unstyled.
//
// So: every class a builtin surface renders must be defined either by
// core-only.css (always loaded by the host) or by a stylesheet that same
// module imports.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const BUILTIN = "plugins/builtin";
const classesIn = (css) => new Set([...css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));

const host = classesIn(readFileSync("src/core/app/core-only.css", "utf8"));
const sheets = new Map();
for (const file of readdirSync(BUILTIN).filter((name) => name.endsWith(".css"))) {
  sheets.set(file, classesIn(readFileSync(`${BUILTIN}/${file}`, "utf8")));
}

const modules = readdirSync(BUILTIN).filter((name) => /-ui\.tsx?$|^[A-Z].*\.tsx$/.test(name));
assert.ok(modules.length >= 10, `expected the builtin UI modules, found ${modules.length}`);

let checked = 0;
const missing = [];
for (const name of modules) {
  const source = readFileSync(`${BUILTIN}/${name}`, "utf8");
  const imported = [...source.matchAll(/import "\.\/([\w.-]+\.css)"/g)].map((m) => m[1]);
  const available = new Set(host);
  for (const sheet of imported) {
    assert.ok(sheets.has(sheet), `${name} imports ${sheet}, which does not exist`);
    for (const cls of sheets.get(sheet)) available.add(cls);
  }
  // Only literal className strings; template literals carry state modifiers
  // ("active", "expanded") that are styled through their base class.
  for (const [, value] of source.matchAll(/className="([^"{]+)"/g)) {
    for (const cls of value.trim().split(/\s+/)) {
      checked += 1;
      if (!available.has(cls)) missing.push(`${name}: .${cls}`);
    }
  }
}

assert.deepEqual(missing, [], `builtin surfaces render classes no imported stylesheet defines:\n  ${missing.join("\n  ")}`);
console.log(`builtin surface style check ok (${modules.length} modules, ${checked} class usages)`);
