/**
 * Prose profile (API 1.12) — source-level check.
 *
 * CoreMarkdownEditor.tsx cannot be imported under node: it pulls
 * "@tauri-apps/api/core" (via core-data-api.ts) and touches `document.*`. So
 * this is a text-assertion check in the idiom of core-only-check.mjs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "src/core/app/CoreMarkdownEditor.tsx"), "utf8");

// 1. The prop exists on CoreMarkdownEditorProps.
const propsStart = source.indexOf("interface CoreMarkdownEditorProps");
assert(propsStart >= 0, "CoreMarkdownEditorProps interface not found");
const propsBlock = source.slice(propsStart, source.indexOf("}", propsStart));
assert(
  /dashList\?:\s*boolean/.test(propsBlock),
  "CoreMarkdownEditorProps must declare `dashList?: boolean`",
);

// 2. The forwardRef param destructure defaults it to true.
assert(
  /function CoreMarkdownEditor\(\{[^}]*\bdashList = true\b/.test(source),
  "the CoreMarkdownEditor forwardRef destructure must default `dashList = true`",
);

// 3. The space-key auto-list guard references dashList (conversion is gated).
const spaceGuard = source.split("\n").find((line) => line.includes('event.key === " "'));
assert(spaceGuard, 'no `event.key === " "` guard found');
assert(
  spaceGuard.includes("dashList"),
  'the `event.key === " "` auto-list guard must reference `dashList` so the conversion is gated',
);

// 4. The round-trip contract is structurally intact.
assert(
  source.includes("export function renderCoreMarkdown"),
  "renderCoreMarkdown must still be an `export function`",
);
assert(
  source.includes("export function markdownFromCoreHtml"),
  "markdownFromCoreHtml must still be an `export function`",
);

// 5. The serializer stays profile-independent: its body mentions none of the
//    profile machinery.
const serStart = source.indexOf("export function markdownFromCoreHtml");
// The function body ends at the first line that is exactly "}" at column 0.
const rest = source.slice(serStart);
const endRel = rest.search(/\r?\n\}\r?\n/);
assert(endRel > 0, "could not delimit the markdownFromCoreHtml body");
const serBody = rest.slice(0, endRel);
for (const forbidden of ["dashList", "proseProfile", "ProseProfile"]) {
  assert(
    !serBody.includes(forbidden),
    `markdownFromCoreHtml body must not reference \`${forbidden}\` — the serializer stays profile-independent`,
  );
}

console.log("Prose profile source-level checks passed.");
