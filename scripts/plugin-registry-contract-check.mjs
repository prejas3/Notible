import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [db, lib, api, runtime, hydrate] = await Promise.all([
  readFile("src-tauri/src/db.rs", "utf8"),
  readFile("src-tauri/src/lib.rs", "utf8"),
  readFile("src/lib/api.ts", "utf8"),
  readFile("src/core/extensions/runtime.ts", "utf8"),
  readFile("src/core/extensions/hydrate.ts", "utf8"),
]);

assert.match(db, /CREATE TABLE plugin_registry/);
assert.match(db, /PRIMARY KEY \(plugin_id, version\)/);
assert.match(db, /state = 'disabled'/, "activating one version must disable the previous version");
// Activation requires the legacy `verified` flag OR the user's own recorded
// decision. Requiring `verified` alone meant nothing side-loaded could ever
// activate in a release build, since Model A ships no signed plugin manifests.
assert.match(db, /signature-verified or user-trusted/);
assert.match(db, /SELECT verified OR user_trusted FROM plugin_registry/);
assert.match(db, /user_trusted = 0/, "re-installing the same version must reset the user's trust");
// `grant_plugin_trust` is the only writer of user_trusted, and it must show a
// native dialog before writing.
assert.match(lib, /fn grant_plugin_trust/);
assert.match(lib, /blocking_show\(\)/);
assert.match(hydrate, /entry\.verified \|\| entry\.user_trusted/);
for (const command of ["list_plugin_registry", "upsert_plugin_registry", "set_plugin_registry_state", "remove_plugin_registry", "extract_plugin_zip"]) {
  assert.match(lib, new RegExp(command), `missing native command: ${command}`);
}
for (const apiSurface of ["listPluginRegistry", "upsertPluginRegistry", "setPluginRegistryState", "removePluginRegistry", "extractPluginZip"]) {
  assert.match(api, new RegExp(`export (async )?function ${apiSurface}`), `missing frontend API: ${apiSurface}`);
}
assert.match(api, /notible\.plugin-registry\.preview\.v1/);
assert.match(hydrate, /entry\.source !== "local-file" && entry\.source !== "package"/);
// Commands that take a caller-supplied path must resolve it against the roots
// the user granted. Any code in the webview can call these — under this trust
// model that includes every installed plugin — so an unchecked path argument
// is a read primitive over the whole disk.
const files = await readFile("src-tauri/src/files.rs", "utf8");
assert.match(files, /pub fn resolve_granted_file/);
for (const command of ["import_markdown", "hash_plugin_package", "extract_plugin_zip"]) {
  const body = lib.slice(lib.indexOf(`fn ${command}(`));
  const end = body.indexOf("\n}");
  assert.match(
    body.slice(0, end),
    /resolve_granted_file/,
    `${command} must resolve its path against the granted roots`,
  );
}

// `script-src` names the plugin: scheme, so anything the scheme serves, the
// CSP executes. Resolving against the grant list alone made every .js under
// any picked folder a script origin.
assert.match(files, /pub fn resolve_plugin_script\(\s*app: &tauri::AppHandle,\s*path: &str,\s*install_paths: &\[String\],/);
assert.match(files, /plugin scripts must live inside an installed plugin/);
assert.match(lib, /list_plugin_registry\(&conn\)\.ok\(\)/, "the scheme handler must read the registry for allowed roots");

console.log("Plugin registry checks passed.");
