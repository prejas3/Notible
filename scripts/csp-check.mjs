#!/usr/bin/env node
/**
 * Asserts the properties of the shipped CSP that the plugin trust model rests
 * on. None of this is obvious from reading the CSP line itself, which is why
 * it is asserted rather than commented:
 *
 * - `img-src` and `font-src` carry no remote scheme. That is what makes a
 *   CSS-only package safe to install without a prompt: an injected theme can
 *   describe the DOM with attribute selectors, but with no remote sink it has
 *   nowhere to send what it learns. Adding `https:` to `img-src` — an obvious
 *   future request, for remote images in notes — silently converts every
 *   installed theme into an exfiltration channel.
 * - `script-src` names the `plugin:` scheme and nothing else beyond 'self'.
 *   Not `data:` or `blob:` (which would arm every XSS-shaped bug in note
 *   content or imports), and not `asset:` (which shares one scope list with
 *   `$APPDATA/media/**`, so allowing it would make every pasted image file a
 *   loadable script origin).
 * - No `'unsafe-eval'` anywhere.
 *
 * `http://asset.localhost` and `http://plugin.localhost` are the Windows
 * spellings of Tauri's own custom schemes, not remote origins, so they are
 * allowed by name.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(root, "src-tauri", "tauri.conf.json");
const csp = JSON.parse(readFileSync(configPath, "utf8")).app?.security?.csp;

const failures = [];
if (typeof csp !== "string" || csp.trim() === "") {
  failures.push("app.security.csp is missing or empty");
}

/** Tauri's own webview-local schemes; not remote origins. */
const LOCAL_SCHEMES = new Set(["http://asset.localhost", "http://plugin.localhost", "asset:", "ipc:", "http://ipc.localhost", "plugin:"]);
const REMOTE = /^(https?:|wss?:|\/\/|\*$)/;

function directive(name) {
  const found = (csp ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return found === undefined ? null : found.slice(name.length).trim().split(/\s+/).filter(Boolean);
}

function assertNoRemoteSink(name) {
  const values = directive(name);
  if (values === null) {
    failures.push(`${name} is not set, so it falls back to default-src; set it explicitly`);
    return;
  }
  for (const value of values) {
    if (LOCAL_SCHEMES.has(value)) continue;
    if (REMOTE.test(value)) {
      failures.push(`${name} allows the remote source "${value}" — this is the exfiltration sink CSS-only packages must not have`);
    }
  }
}

// The sinks a CSS-only package could reach.
assertNoRemoteSink("img-src");
assertNoRemoteSink("font-src");
assertNoRemoteSink("style-src");

const scriptSrc = directive("script-src") ?? [];
for (const banned of ["data:", "blob:", "asset:", "http://asset.localhost", "'unsafe-eval'", "'unsafe-inline'"]) {
  if (scriptSrc.includes(banned)) {
    failures.push(`script-src allows ${banned}; see the header of this script for why that is not an option`);
  }
}
if (!scriptSrc.includes("plugin:") && !scriptSrc.includes("http://plugin.localhost")) {
  failures.push("script-src does not allow the plugin: scheme, so no third-party plugin entry can be imported");
}
// API 1.22 (security review): a plugin-drawn corner box must not be able to
// post a fake form to anywhere. Nothing in Notible submits a real form.
if ((directive("form-action") ?? []).join(" ") !== "'none'") {
  failures.push("form-action must be 'none'");
}
if (/'unsafe-eval'/.test(csp ?? "")) {
  failures.push("'unsafe-eval' appears in the CSP");
}

if (failures.length > 0) {
  console.error("CSP check failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("CSP check passed.");
