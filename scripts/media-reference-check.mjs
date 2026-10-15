/**
 * The pair that keeps a pasted image alive on a second machine.
 *
 * Stored notes hold `media/<uuid>.<ext>`. The editor expands that to a
 * loadable URL when it renders, and must collapse it back when it reads the
 * DOM again — this editor saves whatever the DOM says. Miss the second half
 * and the first keystroke in a note writes the local machine's path back into
 * the database, undoing migration 027 in silence. That is the case this file
 * exists for; everything else here is the guard rail around it.
 *
 * node --experimental-strip-types scripts/media-reference-check.mjs
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

// The module reaches for the backend at import time and dispatches a DOM
// event when it answers. Neither exists under bare node, and neither has to:
// with no directory known, expansion is the identity function, which is
// exactly the state this check wants for the collapse half.
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};

const media = await import(
  pathToFileURL(resolve(root, "src/core/app/mediaRef.ts")).href
);
const { collapseMediaReference, expandMediaReference, isMediaReference } = media;

const UUID = "1f2e3d4c-5b6a-4978-8899-aabbccddeeff";
const REF = `media/${UUID}.png`;

// --- what counts as a stored reference
assert.ok(isMediaReference(REF));
assert.ok(!isMediaReference(`media/${UUID}.exe`), "unknown extensions are not media");
assert.ok(!isMediaReference(`media/../${UUID}.png`), "traversal is not a media reference");
assert.ok(!isMediaReference(`sub/media/${UUID}.png`), "only the exact prefix counts");
assert.ok(!isMediaReference(`media/${UUID.toUpperCase()}.png`), "the writer only ever emits lower case");

// --- collapse: every shape a note can hold today comes back as the stored one
for (const machineSpecific of [
  `http://asset.localhost/C%3A%5CUsers%5CSz%5CAppData%5CRoaming%5CNotible%5Cmedia%5C${UUID}.png`,
  `https://asset.localhost/C%3A%5Cmedia%5C${UUID}.png`,
  `asset://localhost/C:/Users/me/media/${UUID}.png`,
  `C:\\Users\\Sz\\AppData\\Roaming\\Notible\\media\\${UUID}.png`,
  `/home/sz/.local/share/notible/media/${UUID}.png`,
]) {
  assert.equal(collapseMediaReference(machineSpecific), REF, `did not collapse: ${machineSpecific}`);
}

// --- collapse leaves everything that is not ours completely alone
for (const value of [
  `https://cdn.example.com/media/${UUID}.png`,
  `http://example.com/media/${UUID}.png`,
  `https://asset.localhost.evil.com/media/${UUID}.png`,
  "https://example.com/logo.png",
  "data:image/png;base64,AAAA",
  "",
]) {
  assert.equal(collapseMediaReference(value), value, `must not be touched: ${value}`);
}

// --- collapse is idempotent, which is what makes repeated saves safe
assert.equal(collapseMediaReference(REF), REF);
assert.equal(collapseMediaReference(collapseMediaReference(REF)), REF);

// --- expansion without a known directory is the identity, never a wrong path
assert.equal(expandMediaReference(REF), REF, "an unknown media directory must not invent a path");
assert.equal(expandMediaReference("https://example.com/a.png"), "https://example.com/a.png");

// --- the round trip the editor actually performs
// Rendering puts a `src` in the DOM; reading the DOM back must produce the
// stored form again. Simulated with the same two functions the editor calls.
const rendered = expandMediaReference(REF);
assert.equal(collapseMediaReference(rendered), REF, "render → read-back must return the stored reference");

// And with a directory in hand, the expanded form still collapses back.
const expandedByHand = `http://asset.localhost/C%3A%5CUsers%5CSz%5Cmedia%5C${UUID}.png`;
assert.equal(collapseMediaReference(expandedByHand), REF, "an expanded reference must survive read-back");

console.log("Media reference checks passed: stored references survive the render/read-back round trip.");
