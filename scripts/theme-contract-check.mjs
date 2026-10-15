import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/core/app/midnight-theme.css", import.meta.url), "utf8")
  + await readFile(new URL("../src/core/app/core-only.css", import.meta.url), "utf8");
const app = await readFile(new URL("../src/core/app/CoreOnlyApp.tsx", import.meta.url), "utf8");

const contract = [
  "background",
  "surface",
  "raised",
  "hover",
  "active",
  "border",
  "border-subtle",
  "text",
  "muted",
  "faint",
  "accent",
  "danger",
  "success",
  "warning",
];

// D3/D6: `--notible-*` is the public vocabulary a theme overrides; `--core-*`
// is private and must carry no value of its own, only `var(--notible-*)`.
const nightBlock = css.match(/\.core-night\s*\{([^}]*)\}/s)?.[1] ?? "";
for (const token of contract) {
  assert.match(css, new RegExp(`--notible-${token}\\s*:`), `missing public token --notible-${token}`);
  assert.match(nightBlock, new RegExp(`--notible-${token}\\s*:`), `missing night token --notible-${token}`);
  assert.match(
    css,
    new RegExp(`--core-${token}\\s*:\\s*var\\(--notible-`),
    `private --core-${token} must be defined as var(--notible-…), not a literal`,
  );
}
assert.doesNotMatch(nightBlock, /--core-[a-z-]+\s*:/, "night must redefine public tokens only, not the private aliases");

// D4: runtime theme tokens go through a stylesheet rule, never inline styles on
// documentElement — inline declarations beat every stylesheet, so an injected
// plugin theme was silently overridden.
assert.doesNotMatch(app, /root\.style\.setProperty\(\s*["']--/, "theme tokens must not be applied as inline styles");
assert.match(app, /sanitizeThemeCss\(/, "theme pack CSS must go through the sanitiser");
// …and through setProperty, which drops invalid values. Serialising token
// values into CSS text would turn the host stylesheet into an injection sink.
assert.doesNotMatch(app, /cssText\s*[+=]/, "theme tokens must not be serialised into CSS text");

assert.match(css, /\.core-switch input:focus-visible \+ span/);
assert.match(css, /\.core-editor-textarea:focus\s*\{[^}]*box-shadow:\s*none/s);
const nightRoot = css.match(/\.core-night\s*\{([^}]*)\}/s)?.[1] ?? "";
assert.doesNotMatch(nightRoot, /(?<!-)background:\s*#[0-9a-f]{3,8}/i, "night theme contains a hardcoded background");
assert.doesNotMatch(app, /Saved automatically in Core SQLite/);
assert.doesNotMatch(app, />Saved automatically</);

console.log("Core theme contract checks passed: semantic tokens, night overrides and editor/menu surfaces are covered.");
