import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  EXTENSION_API_VERSION,
  RETIRED_PERMISSIONS,
  PLUGIN_PERMISSIONS,
  PluginManifestError,
  validatePluginManifest,
  isApiVersionCompatible,
} from "../packages/plugin-api/src/index.ts";

// The contract is frozen at 1.x. Changing this constant is a deliberate act:
// removing a public token, slot, event or method is a major bump, anything
// additive is a minor one. 1.1 added context.ui.openObject. 1.2 added
// data.sync. 1.3 added a guarantee rather than a method: a code-block renderer
// is disposed and re-invoked after workspace data changes, not only when the
// note's own text does, so a block can show live data — which also makes
// "be idempotent, and stop after dispose()" part of the contract. 1.4 added
// context.i18n, so a plugin's UI can be translated by the same community
// locale files that translate the application. 1.5 added
// views.registerObjectTab, so a plugin can put a tab on a container object
// instead of a panel in Settings. 1.6 added data.sync.media — missing/read/
// write for the bytes behind a `media/<uuid>.<ext>` reference, so a
// replication plugin can carry a pasted screenshot to the other machine
// instead of shipping a note that points at a file only one device has.
// 1.7 added context.oauth: Google sign-in through the system browser, with
// Core owning the client id and the scopes, gated on `network`. 1.8 added
// context.ui.openView, so a plugin can bring the shell to its OWN registered
// view — until then `openObject` reached an object but nothing reached a
// section, so a sidebar button could not jump to the plugin's own nav card
// and both shipped plugins kept a modal as a workaround. 1.9 added
// relation.created/relation.deleted to CoreEvents (a plugin could already
// react to an object write but not to a relation, since Core never announced
// one) and context.scheduler, so a plugin can run its own work on a timer for
// as long as it stays enabled — not only while one of its views is open —
// with the same "disposed automatically on unload" guarantee events.on
// already gives. 1.10 added context.notifications (a native OS notification,
// gated on the new `notifications` permission), so a plugin's reminder still
// reaches the user while the app window is unfocused or minimized — the gap
// that left Habits' reminders unbuildable.
// 1.13 added manifest.guide: optional markdown usage notes shown under
// "Instructions" in Settings → Plugins, capped at 20 000 characters.
// 1.14 added context.data.media.read (gated on the new `media.read`
// permission): the base64 bytes of a pasted image referenced in a note, so a
// plugin can embed one in something it renders. A thin wrapper over the same
// primitive data.sync.media.read uses, through the same user toggle, so a
// plugin no longer needs data.sync just to read one image.
// 1.15 added context.ui.exportFile (gated on workspace.ui): write text to
// Core's sanitised exports folder and return the path. A thin wrapper over the
// existing write_export command — no new Rust, no new permission.
// 1.16 added context.ui.exportBinary (gated on workspace.ui): base64 bytes to
// the exports folder via the new Rust save_export_binary. General — a plugin
// can hand Core a generated spreadsheet or a rendered image.
// 1.17 added context.data.objects.setType (gated on data.write): change an
// object's type in place via the new Rust set_object_type. Needed for the
// bug -> issue type merge — the object patch carries only title/content/props.
// 1.18 added context.ui.confirm (gated on workspace.ui): a themed "are you
// sure" dialog. Also added context.data.objects.onChange (gated on
// data.read): subscribe to one object's title/content/props changes from any
// source. And context.data.objects.findByTitle (gated on data.read): indexed
// title lookup reusing the editor's own [[...]] link index, instead of a
// plugin pulling objects.query({ limit: 5000 }) and filtering client-side.
// 1.19 added context.ui.exportBinaryAs (gated on workspace.ui): like
// exportBinary, but through the new Rust save_export_binary_as, which opens
// a native "Save As" dialog so the user picks the folder and file name
// instead of always landing in the fixed exports folder. Resolves to `null`
// on cancel rather than throwing. exportBinary/exportFile are unchanged —
// this is an addition for a plugin that specifically wants the user to pick
// a destination (Typewriter's manuscript export is the first caller).
// 1.20 added context.editor.renderCodeBlockSvg (no permission) and the
// optional `toSvg` on registerCodeBlockRenderer: a plugin can print another
// plugin's drawing (ReportIt prints Core's Mermaid diagrams).
// 1.21 added the `google.identity` sign-in provider and the optional
// `idToken` on its result (Notible Teams proves who the user is to its server).
// 1.22 added context.help (topics/onChange, no permission), ui.openHelp and
// ui.openPluginSettings (workspace.ui + a user gesture), ui.renderMarkdown and
// the "workspace.corner" slot — what a helper plugin ("Nib") needs.
// 1.24 (E14B-API, Hive #2): persistent code-block renderers with
// updateSource/readOnly, insertsBlock slash commands, creates.slashMenu.
assert.equal(EXTENSION_API_VERSION, "1.28");
assert.equal(isApiVersionCompatible("1.21", "1.22"), true, "a 1.21 plugin must stay compatible with a 1.22 host (minor bump)");
assert.equal(isApiVersionCompatible("1.22", "1.23"), true, "a 1.22 plugin must stay compatible with a 1.23 host (minor bump)");
assert.equal(isApiVersionCompatible("1.23", "1.24"), true, "a 1.23 plugin must stay compatible with a 1.24 host (minor bump)");
assert.equal(isApiVersionCompatible("1.24", "1.25"), true, "a 1.24 plugin must stay compatible with a 1.25 host (minor bump)");
assert.deepEqual([...RETIRED_PERMISSIONS].sort(), ["files.granted", "files.private", "filesystem.read", "filesystem.write"]);
validatePluginManifest({
  id: "example.hello",
  name: "Hello plugin",
  version: "0.1.0",
  apiVersion: EXTENSION_API_VERSION,
});
const dataApiShape = ["objects", "index", "relations", "types", "dataSources"];
assert.deepEqual(dataApiShape, ["objects", "index", "relations", "types", "dataSources"]);
validatePluginManifest({
  id: "example.permissions",
  name: "Permissions",
  version: "0.1.0",
  apiVersion: EXTENSION_API_VERSION,
  permissions: ["data.read", "workspace.ui"],
  sync: "settings",
});
assert.throws(
  () => validatePluginManifest({ id: "Invalid ID", name: "Broken", version: "0.1.0", apiVersion: "0.1" }),
  (error) => error instanceof PluginManifestError && error.manifestId === "Invalid ID",
);
assert.throws(
  () => validatePluginManifest({ id: "example.bad", name: "Bad", version: "0.1.0", apiVersion: "0.1", permissions: ["root.access"] }),
  /Unknown permission/,
);
// 1.13: manifest.guide is optional, must be a string, capped at 20 000 chars.
validatePluginManifest({ id: "example.guide", name: "Guide", version: "0.1.0", apiVersion: EXTENSION_API_VERSION, guide: "## Hello\n\nUse `/` to start." });
assert.throws(
  () => validatePluginManifest({ id: "example.guide", name: "Guide", version: "0.1.0", apiVersion: EXTENSION_API_VERSION, guide: "x".repeat(20_001) }),
  /guide is over 20 000 characters/,
);

// Every permission the contract publishes must actually install. This is not
// theoretical: 1.2 added `data.sync` to the type union while the validator
// kept a separately hand-written allowlist, so the one plugin the release
// existed for could not be installed at all — and tsc, which only sees the
// type, reported nothing. The lists are one array now; this proves it.
for (const permission of PLUGIN_PERMISSIONS) {
  validatePluginManifest({
    id: "example.everypermission",
    name: "Every permission",
    version: "0.1.0",
    apiVersion: EXTENSION_API_VERSION,
    permissions: [permission],
  });
}
// 1.8: ui.openView. Its whole contract is in the shape, so the shape is what
// is asserted here — the behaviour (permission gate, the throw on a view id
// the plugin never registered, delegation carrying the caller's id) is
// exercised against a live ExtensionHost in extension-host-check.mjs.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractSource = readFileSync(join(root, "packages/plugin-api/src/index.ts"), "utf8");
const editorTypes = readFileSync(join(root, "packages/plugin-api/notible-plugin-api.d.ts"), "utf8");
const uiApiBlock = (source) => {
  const start = source.indexOf("export interface UiApi {");
  assert(start >= 0, "UiApi is no longer declared as an interface");
  return source.slice(start, source.indexOf("}", source.indexOf("openView", start)));
};
for (const [name, source] of [["src/index.ts", contractSource], ["notible-plugin-api.d.ts", editorTypes]]) {
  // On `ui`, not on `views`: `views.*` is registration, `ui.*` is "change
  // what the user is looking at". A method that drifted onto the other
  // namespace would still type-check on its own — this is what notices it.
  assert.match(
    uiApiBlock(source),
    /openView\(viewId: string\): Promise<boolean>;/,
    `${name}: UiApi must declare openView(viewId: string): Promise<boolean>`,
  );
  // Boolean, not void and not a tri-state. `false` means "this host has
  // nowhere to render views", which the plugin falls back from; a view id the
  // plugin never registered throws instead, because a typo is a programming
  // error and the two must stay distinguishable.
  assert(
    !/openView\([^)]*pluginId/.test(uiApiBlock(source)),
    `${name}: openView must not take a plugin id — the caller's id comes from the host, never from the call`,
  );
  // API 1.15.
  assert.match(
    source,
    /exportFile\(filename: string, content: string\): Promise<string>;/,
    `${name}: UiApi must declare exportFile(filename: string, content: string): Promise<string> (API 1.15)`,
  );
  // API 1.16.
  assert.match(
    source,
    /exportBinary\(filename: string, dataBase64: string, mime: string\): Promise<string>;/,
    `${name}: UiApi must declare exportBinary(filename, dataBase64, mime): Promise<string> (API 1.16)`,
  );
}
// The editor types ship to plugin authors and are hand-maintained next to the
// contract; a version skew between them is exactly the drift that made
// README.md sit at 1.1 while the contract went to 1.3.
assert.match(editorTypes, /EXTENSION_API_VERSION: "1.28"/, "notible-plugin-api.d.ts is not at 1.28");
assert.match(editorTypes, /importImageFromUrl\(url: string\): Promise<string>/, "notible-plugin-api.d.ts is missing MediaApi.importImageFromUrl (1.28)");
assert.match(editorTypes, /networkHosts\?: string\[\];/, "notible-plugin-api.d.ts is missing manifest.networkHosts (1.28)");
assert.match(editorTypes, /pickImage\(\): Promise<string \| null>/, "notible-plugin-api.d.ts is missing MediaApi.pickImage (1.27)");
// API 1.24.
for (const [name, source] of [["src/index.ts", contractSource], ["notible-plugin-api.d.ts", editorTypes]]) {
  for (const decl of ["updateSource(next: string): boolean;", "readOnly: boolean;", "persistent?: boolean;", "insertsBlock?: { language: string };", "slashMenu?: boolean;"]) {
    assert.ok(source.includes(decl), `${name} must declare ${decl} (API 1.24)`);
  }
}
// API 1.25 (STORE-API, Hive #5).
for (const [name, source] of [["src/index.ts", contractSource], ["notible-plugin-api.d.ts", editorTypes]]) {
  for (const decl of ["export interface PluginStore", "readonly store: PluginStore;", "deletePrefix(prefix: string): Promise<number>;", "setMany(entries: [string, string][]): Promise<void>;"]) {
    assert.ok(source.includes(decl), `${name} must declare ${decl} (API 1.25)`);
  }
}
// API 1.22.
for (const [name, source] of [["src/index.ts", contractSource], ["notible-plugin-api.d.ts", editorTypes]]) {
  assert.match(source, /openHelp\(pageId\?: string, slug\?: string\): Promise<void>;/, `${name}: UiApi must declare openHelp (API 1.22)`);
  assert.match(source, /openPluginSettings\(pluginId: string\): Promise<void>;/, `${name}: UiApi must declare openPluginSettings (API 1.22)`);
  assert.match(source, /renderMarkdown\(markdown: string\): string;/, `${name}: UiApi must declare renderMarkdown (API 1.22)`);
  assert.match(source, /readonly help: HelpApi;/, `${name}: PluginContext must declare help (API 1.22)`);
  assert.match(source, /"workspace\.corner"/, `${name}: UI_SLOTS must include workspace.corner (API 1.22)`);
  assert.match(source, /whileTyping\?: boolean;/, `${name}: CommandRegistration must declare whileTyping (API 1.23)`);
}
assert.match(editorTypes, /renderCodeBlockSvg\(language: string/, "notible-plugin-api.d.ts is missing editor.renderCodeBlockSvg (1.20)");
assert.match(editorTypes, /guide\?: string;/, "notible-plugin-api.d.ts is missing manifest.guide");
assert.match(editorTypes, /read\(ref: string\): Promise<string>/, "notible-plugin-api.d.ts is missing MediaApi.read (1.14)");
// API 1.18.
for (const [name, source] of [["src/index.ts", contractSource], ["notible-plugin-api.d.ts", editorTypes]]) {
  assert.match(
    source,
    /confirm\(message: string, options\?: \{ title\?: string; confirmLabel\?: string; danger\?: boolean \}\): Promise<boolean>;/,
    `${name}: UiApi must declare confirm(message, options?): Promise<boolean> (API 1.18)`,
  );
  assert.match(
    source,
    /onChange\(id: string, callback: \(object: PluginObject\) => void\): Disposable;/,
    `${name}: DataApi.objects must declare onChange(id, callback): Disposable (API 1.18)`,
  );
  assert.match(
    source,
    /findByTitle\(query: string, options\?: \{ exact\?: boolean \}\): Promise<PluginObject\[\]>;/,
    `${name}: DataApi.objects must declare findByTitle(query, options?): Promise<PluginObject[]> (API 1.18)`,
  );
}

// API 1.15 host wiring: the ui object delegates, the unavailable overlay throws.
const hostSrc = readFileSync(join(root, "src/core/extensions/host.ts"), "utf8");
assert.match(hostSrc, /exportFile: \(filename, content\) => \{/, "host.ts ui object is missing exportFile");
assert.match(hostSrc, /exportFile: async \(\) => \{ throw new Error/, "host.ts unavailable overlay is missing exportFile");
assert.match(hostSrc, /exportFile\(pluginId: string, \.\.\.args: Parameters<UiApi\["exportFile"\]>\)/, "CoreOverlayApi is missing exportFile");
assert.match(hostSrc, /exportBinary: \(filename, dataBase64, mime\) => \{/, "host.ts ui object is missing exportBinary");
assert.match(hostSrc, /exportBinary: async \(\) => \{ throw new Error/, "host.ts unavailable overlay is missing exportBinary");
assert.match(hostSrc, /exportBinary\(pluginId: string, \.\.\.args: Parameters<UiApi\["exportBinary"\]>\)/, "CoreOverlayApi is missing exportBinary");
assert.match(hostSrc, /exportBinaryAs: \(filename, dataBase64, mime\) => \{/, "host.ts ui object is missing exportBinaryAs");
assert.match(hostSrc, /exportBinaryAs: async \(\) => \{ throw new Error/, "host.ts unavailable overlay is missing exportBinaryAs");
assert.match(hostSrc, /exportBinaryAs\(pluginId: string, \.\.\.args: Parameters<UiApi\["exportBinaryAs"\]>\)/, "CoreOverlayApi is missing exportBinaryAs");

console.log("Public plugin API checks passed.");
