#!/usr/bin/env node
// Guards the two promises of 2026-08-20-core-collections-design.md (internal, not published).
// Neither is about looks — both are about the rules we wrote down, because a
// visual change is only ever verified by a human looking at the real app.
//
// 1. A settings screen may not grow without bound with use: any list whose
//    length comes from user data renders inside a <details>.
// 2. Width on a settings surface comes from a token, never from a fresh
//    hardcoded pixel constant. Without this, the nine constants grow back.
import { readFileSync } from "node:fs";

const errors = [];
const app = readFileSync("src/core/app/CoreOnlyApp.tsx", "utf8");
const css = readFileSync("src/core/app/core-only.css", "utf8");

// ponytail: an explicit list, not inference. Add the name here when you add a
// list to Settings whose length the user controls.
// `pluginEntries` used to render as a flat `.map()` in a settings section; the
// Plugin Matrix is now its own category-grouped master/detail surface
// (src/product/CoreMatrixPanel.tsx), so it is no longer guarded here.
const UNBOUNDED = ["backups", "trashObjects"];
for (const name of UNBOUNDED) {
  const needle = `${name}.map(`;
  let at = app.indexOf(needle);
  if (at === -1) errors.push(`${name}.map( not found — rename it in this check or drop it`);
  while (at !== -1) {
    const before = app.slice(0, at);
    const section = before.lastIndexOf('<article className="core-settings-section');
    if (section !== -1 && !before.slice(section).includes("<details")) {
      const line = before.split("\n").length;
      errors.push(`CoreOnlyApp.tsx:${line}: ${name} renders flat in a settings section; put it under <details> (a collection, not a document)`);
    }
    at = app.indexOf(needle, at + 1);
  }
}

const SETTINGS_SELECTOR = /^\.core-(settings|setting-row|collection|trash|backup|hotkey|plugin|matrix|diagnostics)/;
css.split("\n").forEach((line, index) => {
  const selector = line.split("{")[0].trim();
  if (!selector.split(",").some((part) => SETTINGS_SELECTOR.test(part.trim()))) return;
  const match = line.match(/max-(width|inline-size):\s*\d+(px|rem|em)\b/);
  if (match) errors.push(`core-only.css:${index + 1}: ${match[0]} on a settings surface; use var(--core-measure) or a collection grid`);
});

// The container surface must come from a registered object tab, not from a
// map of plugin ids inside Core. Narrow on purpose: `src/` holds 65 such
// literals today (Matrix presets, catalogue copy, the properties panel), so a
// rule over the whole directory would need an exception list longer than
// itself and would guard nothing.
const containerPanel = readFileSync("src/product/CorePluginContainerPanel.tsx", "utf8");
if (/["'`]notible\.[a-z-]+["'`]/.test(containerPanel)) {
  errors.push("CorePluginContainerPanel.tsx: hardcoded plugin id; the container surface must come from registered object tabs");
}

if (errors.length > 0) {
  console.error("core-collection-check failed:\n" + errors.map((line) => `  - ${line}`).join("\n"));
  process.exit(1);
}
console.log(`core-collection-check: ok (${UNBOUNDED.length} unbounded lists disclosed, no hardcoded settings widths)`);
