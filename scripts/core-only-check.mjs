import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
for (const relative of ["src/core/standalone.ts", "src/core/app/CoreOnlyApp.tsx", "src/core/data/core-data-api.ts"]) {
  const source = await (await import("node:fs/promises")).readFile(resolve(root, relative), "utf8");
  assert(!source.includes("src/lib/api"), `Core-only entrypoint must not import broad src/lib/api: ${relative}`);
  assert(!source.includes("plugins/builtin"), `Core-only entrypoint must not import builtin plugins: ${relative}`);
}
const core = await import(pathToFileURL(resolve(root, "src/core/standalone.ts")).href);
const commands = await import(pathToFileURL(resolve(root, "src/core/app/coreCommands.ts")).href);
const backlinkModel = await import(pathToFileURL(resolve(root, "src/core/app/coreBacklinks.ts")).href);
const appSource = await (await import("node:fs/promises")).readFile(resolve(root, "src/core/app/CoreOnlyApp.tsx"), "utf8");
const markdownEditorSource = await (await import("node:fs/promises")).readFile(resolve(root, "src/core/app/CoreMarkdownEditor.tsx"), "utf8");
const markdownMarksSource = await (await import("node:fs/promises")).readFile(resolve(root, "src/core/app/coreMarkdownMarks.ts"), "utf8");

// 16 since 0.95.0: code comparison joined beside Columns.
assert(commands.CORE_COMMANDS.length === 16, "Core slash registry should expose the 16 baseline commands");
assert(["table", "link", "image"].every((id) => commands.CORE_COMMANDS.some((command) => command.id === id)), "Table, Link and Image are in the / menu (E14)");
assert(commands.CORE_COMMANDS.some((command) => command.id === "compare"), "Code comparison is in the / menu");
assert(new Set(commands.CORE_COMMANDS.map((command) => command.id)).size === commands.CORE_COMMANDS.length, "Core slash command ids must be unique");
for (const command of commands.CORE_COMMANDS) {
  assert(typeof command.execute() === "string", `Core command ${command.id} should return an insertion`);
}
assert(appSource.includes("updateSlashMenuPosition"), "Core slash menu should position itself from the textarea caret");
assert(appSource.includes("onScroll={() => { if (slashMenuOpen) updateSlashMenuPosition(); }}"), "Core slash menu should follow textarea scrolling");
for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
  assert(appSource.includes(`event.key === \"${key}\"`), `Core slash menu should handle ${key}`);
}
assert(appSource.includes("aria-selected={index === slashActiveIndex}"), "Core slash menu should expose the active command to assistive technology");
assert(appSource.includes("...CORE_COMMANDS"), "Core slash menu should include the Core command registry");
// Embedded queries are discoverable through "/" and nowhere else — a syntax
// reference in Settings is not a way to find a feature you do not know exists.
const commandSource = await (await import("node:fs/promises")).readFile(resolve(root, "src/core/app/coreCommands.ts"), "utf8");
assert(commandSource.includes('id: "query"'), "Core slash menu should offer the query block");
assert(commandSource.includes("notible" + String.fromCharCode(92) + "n"), "the query slash command must insert a real notible block");
// Plugin commands reach "/" only when they create something. Diagnostics
// ("Show search status", "Manage automations") do nothing where the caret is,
// and listing them was read as half the menu being broken.
assert(appSource.includes("snapshot.commands.filter((command) => (command.creates && command.creates.slashMenu !== false) || command.insertsBlock)"), "Core slash menu should include object-creating plugin commands (unless slashMenu: false) and insertsBlock commands");
// The editor lives in CoreMarkdownEditor now and the app never passes it a
// readOnly prop at all — the original "autosave must not lock the editor"
// contract now holds by construction, so assert that nothing reintroduces it.
assert(!appSource.includes("readOnly={"), "Autosave must not make the editor read-only and steal focus");
assert(appSource.includes("setSelected(updated);"), "Autosave should update the persisted selection without reloading the editor DOM");
assert(appSource.includes("onWikilinkClick"), "Core editor should expose clickable wikilink navigation");
// Plugin Matrix, Plugin host, Plugin settings and Plugin panels are merged
// into one "Plugins" Settings screen: an All list + detail column, and a
// Market tab.
assert(appSource.includes("navigateToSettingsSection(\"plugins\")"), "Plugins should be reachable as a single Settings section");
assert(appSource.includes("pluginsTab === \"all\""), "the builtin plugin catalogue (former Plugin Matrix) should live in the Plugins screen's All tab");
assert(appSource.includes("settingsSection === \"about\""), "Settings should carry an About section in place of the Core boundary screen");
assert(!appSource.includes("section === \"matrix\""), "Plugin Matrix must not be a standalone top-level section outside the Settings shell");
for (const contract of ["restoreFromTrash", "listRelations", "core-settings-shell"]) {
  assert(appSource.includes(contract), `Core-only app is missing the ${contract} contract`);
}

const doc = (text) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const target = { id: "target", title: "Current title", content: doc(""), props: JSON.stringify({ aliases: ["Old title"] }), type: "note", parent_id: null, updated_at: 1 };
const sourceOne = { id: "one", title: "One", content: doc("See [[Current title]]"), props: "{}", type: "note", parent_id: null, updated_at: 1 };
const sourceTwo = { id: "two", title: "Two", content: doc("See [[Old title|the note]]"), props: JSON.stringify({ aliases: ["Old title"] }), type: "note", parent_id: "workspace", updated_at: 1 };
const relationSource = { id: "relation", title: "Relation source", content: doc(""), props: "{}", type: "note", parent_id: "workspace", updated_at: 1 };
assert(backlinkModel.resolveBacklinks(target, [target]).length === 0, "Backlinks should be empty without sources");
assert(JSON.stringify(backlinkModel.resolveBacklinks(target, [target, sourceOne, sourceTwo]).map((item) => item.source.id)) === JSON.stringify(["one", "two"]), "Backlinks should resolve multiple title and alias links");
assert(backlinkModel.resolveBacklinks(target, [target, relationSource], [{ from_id: "relation", to_id: "target", kind: "references" }])[0]?.source.id === "relation", "Backlinks should include incoming object relations");
assert(backlinkModel.resolveBacklinks(null, [sourceOne]).length === 0, "Removed backlink target should not produce sources");
assert(backlinkModel.resolveWikilinkTarget("Current title", [target])?.id === "target", "Exact wikilinks should resolve to a workspace object");
assert(backlinkModel.resolveWikilinkTarget("Old title", [target])?.id === "target", "Alias wikilinks should resolve to a workspace object");
assert(markdownEditorSource.includes('html.push(`<h${heading[1].length}>'), "Core Markdown renderer should render headings");
assert(markdownMarksSource.includes("data-core-wikilink"), "Core Markdown renderer should mark wikilinks as interactive targets");
for (const delimiter of ["\\*\\*", "__", "~~", "=="]) {
  assert(markdownMarksSource.includes(delimiter), `Core Markdown renderer should recognize the ${delimiter} inline mark delimiter`);
}

// --- the "[[" picker
//
// Typing a title by hand was never a workable substitute: the titles in a real
// workspace are long sentences, and resolution needs an exact match.
const detect = backlinkModel.detectWikilinkTrigger;
assert(detect("see [[kaf", 9)?.filter === "kaf", "an open [[ must trigger the picker");
assert(detect("see [[kafka issue rev", 21)?.filter === "kafka issue rev", "the filter must survive spaces: titles have them");
assert(detect("see [[kaf", 9).start === 4, "the trigger replaces the [[ too");
assert(detect("see [[done]] and more", 21) === null, "a closed link must not keep the menu open");
assert(detect("see [[a\nb", 9) === null, "a newline ends the attempt");
assert(detect("nothing here", 12) === null, "no [[ means no menu");
assert(detect("", 0) === null && detect("x", 99)?.filter === undefined, "out-of-range cursors must not throw");
// E7 (01.10): typing "[[" auto-closes to "[[]]". The picked link must replace
// that "]]" too, or it stays behind the link ("[[Meeting notes]]]]") and the
// rest of the sentence is typed inside the link.
assert(detect("see [[mee]] more", 9)?.end === 11, "the trigger swallows the auto-closed ]] right after the caret");
assert(detect("see [[mee more", 9)?.end === 9, "without a closer the trigger ends at the caret");

// E22: a renamed note keeps answering to its old title (previousTitles, kept by
// Rust while something links to it), but a note that has that title now wins.
const renamed = { id: "r", title: "Weekly sync", type: "note", updated_at: 1, content: "", props: JSON.stringify({ previousTitles: ["Weekly team meeting"] }) };
const current = { id: "c", title: "Weekly team meeting", type: "note", updated_at: 2, content: "", props: "{}" };
assert(backlinkModel.resolveWikilinkTarget("Weekly team meeting", [renamed])?.id === "r", "an old title still resolves to the renamed note");
assert(backlinkModel.resolveWikilinkTarget("weekly team meeting", [renamed, current])?.id === "c", "a current title beats an old one");

const pickable = [
  { id: "a", title: "Kafka issue review", type: "note", updated_at: 2, content: "", props: "{}" },
  { id: "b", title: "KAFKA issue", type: "issue", updated_at: 1, content: "", props: "{}" },
  { id: "c", title: "Trainlog", type: "project", updated_at: 3, content: "", props: "{}" },
];
const suggested = backlinkModel.wikilinkSuggestions("kafka", pickable);
assert(suggested.length === 2, "the picker should match on a substring of the title");
assert(suggested[0].id === "a", "both start with the filter, so the more recent one leads");
assert(backlinkModel.wikilinkSuggestions("issue", pickable).every((entry) => entry.id !== "c"), "only titles containing the filter");
// A prefix match must beat a mid-title match even when the mid one is newer:
// typing "kaf" should offer the note that starts with it.
const ranked = backlinkModel.wikilinkSuggestions("kaf", [
  { id: "mid", title: "Review of kafka", type: "note", updated_at: 99, content: "", props: "{}" },
  { id: "pre", title: "Kafka issue", type: "note", updated_at: 1, content: "", props: "{}" },
]);
assert(ranked[0].id === "pre", "a prefix match ranks above a newer mid-title match");
assert(backlinkModel.wikilinkSuggestions("", pickable)[0].id === "c", "an empty filter offers the most recent first");
assert(backlinkModel.wikilinkSuggestions("zzz", pickable).length === 0, "no match means no menu");
assert(backlinkModel.wikilinkSuggestions("a", pickable, 1).length === 1, "the limit is honoured");

assert(appSource.includes("detectWikilinkTrigger"), "Core must offer a [[ picker, not require typing the title exactly");
assert(appSource.includes('menuMode === "wikilink"'), "the [[ picker shares the slash menu's popup");
assert(appSource.includes("const wikilink = detectWikilinkTrigger(nextBody, caret);"), "[[ must be detected before /");
assert(appSource.includes("allObjects.filter"), "the picker must search the workspace, not the sidebar search results");

const host = new core.ExtensionHost();
// E14B-SLASH-BLOCK (Hive #2): a plugin's "/" block lands on its own lines, with a typing spot after it.
{
  const zw = String.fromCharCode(0x200b);
  const atEnd = commands.pluginBlockInsertion("before /tab", 7, 11, "notible-table", "{}");
  assert(atEnd.body === "before \n```notible-table\n{}\n```\n" + zw && atEnd.caret === 33, `block at the end of a line: ${JSON.stringify(atEnd)}`);
  const beforeText = commands.pluginBlockInsertion("/tab\nafter", 0, 4, "notible-table", "{}");
  assert(beforeText.body === "```notible-table\n{}\n```\nafter" && beforeText.caret === 24, `block before more text: ${JSON.stringify(beforeText)}`);
  assert(commands.pluginBlockInsertion("/t", 0, 2, "x", "a\n```\nb") === null, "a source that would close the fence early is refused");
  assert(appSource.includes("command.insertsBlock"), "plugin insertsBlock commands must reach the slash menu");
}

// E14B-KEEPALIVE (Hive #2): a persistent code-block mount survives a redraw only while nothing about it changed.
{
  const { keepMount } = await import(pathToFileURL(resolve(root, "src/core/app/codeBlockMounts.ts")).href);
  const render = () => {};
  const entry = { language: "notible-table", source: "a", render, connected: true };
  assert(keepMount(entry, { language: "notible-table", source: "a", render }) === true, "unchanged persistent block is kept");
  assert(keepMount(entry, { language: "notible-table", source: "b", render }) === false, "a source change from outside remounts");
  assert(keepMount(entry, { language: "notible-table", source: "a", render: () => {} }) === false, "a plugin reload remounts");
  assert(keepMount({ ...entry, connected: false }, { language: "notible-table", source: "a", render }) === false, "a detached block is not kept");
  // Final review (Hive #2): a block's write-back must not clobber a hand edit or break out of its fence.
  const { sourceWriteAllowed } = await import(pathToFileURL(resolve(root, "src/core/app/codeBlockMounts.ts")).href);
  assert(sourceWriteAllowed("a", "a", "b") === true, "a write over the source the block was drawn from goes through");
  assert(sourceWriteAllowed("a hand edit", "a", "b") === false, "a write over a hand edit not yet picked up is refused");
  assert(sourceWriteAllowed("a", "a", "x\n```\n# injected") === false, "a source that would close the fence is refused");
}

const result = await core.enablePluginSet(host, []);
assert(result.loaded.length === 0 && result.failed.length === 0, "Core-only bootstrap should load no plugin");
assert(host.getSnapshot().length === 0, "Core-only host should have no domain registrations");

console.log("Core-only checks passed: minimal data adapter, empty host and no domain registrations.");
