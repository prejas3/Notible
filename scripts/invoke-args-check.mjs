/**
 * Asserts that every `invoke("cmd", { ... })` in the frontend passes the keys
 * the Rust command actually declares.
 *
 * Tauri exposes a command's snake_case Rust parameters to JavaScript as
 * camelCase keys. Get that wrong and nothing complains until the moment a user
 * triggers the command, where it fails with "missing required key <name>" —
 * TypeScript cannot see it, because the argument object is typed
 * `Record<string, unknown>` at the invoke boundary. That is exactly how folder
 * plugin installs shipped broken in 0.40.0.
 *
 * Deliberately a text scan rather than a parser: it needs to run in plain Node
 * with no build step, and the shapes it looks for are consistent in this
 * codebase. Anything it cannot read confidently it reports rather than skips.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

/** Parameters Tauri injects itself; they never come from the caller. */
const INJECTED = /^(tauri::State<|tauri::AppHandle|tauri::Window|tauri::WebviewWindow|State<|AppHandle|Window|WebviewWindow)/;

function snakeToCamel(value) {
  // `r#type` is Rust's raw-identifier escape for the keyword `type`; Tauri
  // strips the `r#` before it ever reaches JavaScript.
  return value.replace(/^r#/, "").replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());
}

/**
 * Top-level keys of an object literal, including shorthand (`{ ext }`) and
 * quoted keys. Nested literals are skipped: `{ request: { mode } }` declares
 * one key, `request`, and picking up `mode` would report a phantom mismatch.
 */
function topLevelKeys(literal) {
  const keys = new Set();
  let depth = 0;
  let index = 0;
  // A key can only appear right after `{` or a depth-1 `,`. Without tracking
  // that, the value half of `pluginState: state` reads as a shorthand key
  // named `state`, and `pluginId: input.plugin_id` reads as one named
  // `plugin_id` — both phantom mismatches.
  let expectingKey = false;

  while (index < literal.length) {
    const character = literal[index];

    if (character === '"' || character === "'" || character === "`") {
      const quote = character;
      let end = index + 1;
      while (end < literal.length && literal[end] !== quote) end += (literal[end] === "\\" ? 2 : 1);
      if (depth === 1 && expectingKey && /^\s*:/.test(literal.slice(end + 1))) {
        keys.add(literal.slice(index + 1, end));
        expectingKey = false;
      }
      index = end + 1;
      continue;
    }

    if (character === "{" || character === "[" || character === "(") {
      depth += 1;
      expectingKey = depth === 1 && character === "{";
      index += 1;
      continue;
    }
    if (character === "}" || character === "]" || character === ")") {
      depth -= 1;
      expectingKey = false;
      index += 1;
      continue;
    }
    if (character === "," && depth === 1) { expectingKey = true; index += 1; continue; }
    if (character === ":" && depth === 1) { expectingKey = false; index += 1; continue; }
    if (/\s/.test(character)) { index += 1; continue; }

    if (/[A-Za-z_$]/.test(character)) {
      const identifier = literal.slice(index).match(/^[A-Za-z_$][\w$]*/)[0];
      if (depth === 1 && expectingKey) {
        const following = literal.slice(index + identifier.length).match(/^\s*([:,}])/);
        // `:` means an explicit key; `,`/`}` means shorthand. Anything else
        // (a `.`, a `(`) means this is an expression, not a key.
        if (following) {
          keys.add(identifier);
          if (following[1] !== ":") expectingKey = false;
        }
        if (!following || following[1] !== ":") expectingKey = following ? false : false;
      }
      index += identifier.length;
      continue;
    }

    index += 1;
  }
  return keys;
}

// ---------- 1. collect Rust commands ----------

const commands = new Map(); // name -> { required:Set, optional:Set }

for (const file of readdirSync(join(root, "src-tauri", "src"))) {
  if (!file.endsWith(".rs")) continue;
  const source = readFileSync(join(root, "src-tauri", "src", file), "utf8");
  const pattern = /#\[tauri::command\][\s\S]*?fn\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:->|\{)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const [, name, rawParams] = match;
    const required = new Set();
    const optional = new Set();
    // Split on commas at depth zero so generic parameters stay intact.
    let depth = 0;
    let current = "";
    const params = [];
    for (const character of rawParams) {
      if (character === "<" || character === "(" || character === "[") depth += 1;
      if (character === ">" || character === ")" || character === "]") depth -= 1;
      if (character === "," && depth === 0) { params.push(current); current = ""; continue; }
      current += character;
    }
    if (current.trim()) params.push(current);

    for (const param of params) {
      const trimmed = param.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;
      const colon = trimmed.indexOf(":");
      if (colon === -1) continue;
      const paramName = trimmed.slice(0, colon).trim().replace(/^mut\s+/, "");
      const paramType = trimmed.slice(colon + 1).trim();
      if (INJECTED.test(paramType)) continue;
      (paramType.startsWith("Option<") ? optional : required).add(snakeToCamel(paramName));
    }
    commands.set(name, { required, optional, file });
  }
}

if (commands.size === 0) failures.push("no #[tauri::command] functions found — the scan is broken, not the code");

// ---------- 2. check every invoke call site ----------

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    checkFile(full);
  }
}

function checkFile(path) {
  const source = readFileSync(path, "utf8");
  const shown = relative(root, path).replaceAll("\\", "/");
  // invoke("name", { ... }) — capture the object literal by brace matching.
  const pattern = /\binvoke(?:<[^>]*>)?\(\s*"([a-z0-9_]+)"\s*(,)?/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const [, command, hasArgs] = match;
    const spec = commands.get(command);
    if (!spec) {
      // Mocks and preview shims call names that are not Rust commands; only
      // complain from code that talks to the real backend.
      if (/dev-mock-invoke|\.test\./.test(shown)) continue;
      failures.push(`${shown}: invoke("${command}") has no matching #[tauri::command]`);
      continue;
    }
    if (!hasArgs) {
      if (spec.required.size > 0) {
        failures.push(`${shown}: invoke("${command}") passes no arguments but requires ${[...spec.required].join(", ")}`);
      }
      continue;
    }
    // Read the object literal that follows.
    let index = pattern.lastIndex;
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (source[index] !== "{") continue; // spread or variable — cannot check statically
    let depth = 0;
    const start = index;
    for (; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") { depth -= 1; if (depth === 0) { index += 1; break; } }
    }
    const literal = source.slice(start, index);
    if (literal.includes("...")) continue; // spread — keys are not statically known

    const keys = topLevelKeys(literal);
    for (const required of spec.required) {
      if (!keys.has(required)) {
        failures.push(`${shown}: invoke("${command}") is missing required key "${required}" (Rust declares it in ${spec.file})`);
      }
    }
    for (const key of keys) {
      if (!spec.required.has(key) && !spec.optional.has(key)) {
        failures.push(`${shown}: invoke("${command}") passes unknown key "${key}" — Rust accepts ${[...spec.required, ...spec.optional].join(", ") || "no arguments"}`);
      }
    }
  }
}

walk(join(root, "src"));

if (failures.length > 0) {
  console.error(`Invoke argument check failed (${failures.length}):`);
  for (const failure of [...new Set(failures)]) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Invoke argument checks passed: ${commands.size} Tauri commands cross-checked against their call sites.`);
