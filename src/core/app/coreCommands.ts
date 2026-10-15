import type { CommandRegistration } from "../../../packages/plugin-api/src/index.ts";
import { CODE_FORMAT_ACTIONS, codeFenceAt, formatCode, type CodeFormatAction, type CodeFormatError } from "./codeFormat.ts";

// I18N (#28): marks a menu label, drawn through t() in CoreOnlyApp. Local, not
// core-i18n: this file also runs under plain Node in the checks.
const tr = (key: string) => key;

export const CORE_COMMAND_SOURCE = "core";

/**
 * Commands that belong to the Core writing surface. They return a small
 * Markdown-compatible insertion because the Core-only editor deliberately
 * stays a safe plain-text editor; richer plugin editors can interpret the
 * same intent in their own surface.
 */
/**
 * Slash commands whose block only comes alive when a plugin draws it. With
 * that plugin off the menu must not offer them: a fresh install has
 * notible.queries off, and "Live list" used to insert raw code pointing at a
 * help panel that never appeared.
 */
export const CORE_COMMAND_REQUIRES: Record<string, string> = { query: "notible.queries", mermaid: "notible.editor-extensions", compare: "notible.editor-extensions" };

export const CORE_COMMANDS: CommandRegistration[] = [
  { id: "heading-1", name: tr("Heading 1"), description: tr("Insert a level 1 heading"), execute: () => "# " },
  { id: "heading-2", name: tr("Heading 2"), description: tr("Insert a level 2 heading"), execute: () => "## " },
  { id: "heading-3", name: tr("Heading 3"), description: tr("Insert a level 3 heading"), execute: () => "### " },
  { id: "bullet-list", name: tr("Bullet list"), description: tr("Start a bulleted list"), execute: () => "- " },
  { id: "numbered-list", name: tr("Numbered list"), description: tr("Start a numbered list"), execute: () => "1. " },
  { id: "task-list", name: tr("Task list"), description: tr("Start a checklist"), execute: () => "- [ ] " },
  { id: "quote", name: tr("Quote"), description: tr("Insert a block quote"), execute: () => "> " },
  { id: "code-block", name: tr("Code block"), description: tr("Insert a fenced code block"), execute: () => "```\n\n```" },
  { id: "columns", name: tr("Columns"), description: tr("Insert a two-column block"), execute: () => "::: columns\n\n:::" },
  { id: "compare", name: tr("Code comparison"), description: tr("Compare two code snippets side by side"), execute: () => "```compare\nconst before = true;\n=====\nconst after = true;\n```" },
  { id: "divider", name: tr("Divider"), description: tr("Insert a horizontal divider"), execute: () => "---" },
  // E14: the three blocks people looked for in this menu and did not find.
  // Empty header cells: the caret starts in the first one, so typing names the column.
  { id: "table", name: tr("Table"), description: tr("A small table inside the note"), execute: () => "|  |  |\n| --- | --- |\n|  |  |" },
  { id: "link", name: tr("Link"), description: tr("Link to a web page"), execute: () => "[](https://)" },
  // Its file picker is opened by CoreOnlyApp (selectSlashCommand), not here.
  { id: "image", name: tr("Image"), description: tr("Insert a picture from a file"), execute: () => "" },
  /* The one way anybody finds embedded queries. The block is inserted already
     working — a query that returns rows on the first try teaches the syntax
     better than the reference page this replaces, which sat in Settings, where
     nobody goes looking for a feature they do not know exists. Core writes the
     text; notible.queries draws the table beneath it, the same split as the
     calendar block above. */
  // The `#` lines are comments (queries.ts drops them before parsing), and
  // they are the whole point: someone who picks this out of the slash menu
  // has to learn what they are looking at without leaving the note.
  // Same split as the query block: Core writes the fence, notible.editor-extensions
  // draws it. Inserted already valid, because hand-typing the fence is where it went wrong.
  { id: "mermaid", name: tr("Mermaid diagram"), description: tr("A diagram drawn from text (flowchart, sequence, Gantt…)"), execute: () => "```mermaid\nflowchart LR\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do it]\n  B -->|No| D[Skip it]\n```" },
  { id: "query", name: tr("Live list of matching items"), description: tr("A block that answers itself — no manual updating"), execute: () => "```notible\n# A live list. Edit the lines below; the note keeps itself up to date.\n# Open \"How this block works\" underneath for every option.\ntype: task\nstatus: open\ndue: <= +7d\n```" },
];

/**
 * Right-click menu entries contributed by plugins, for one workspace row.
 *
 * `objectMenu` is spread into the host snapshot straight from plugin code, so
 * nothing has checked its shape by the time it gets here: a malformed entry is
 * dropped rather than rendered. A union in the .d.ts proves nothing at runtime
 * — that is exactly how data.sync shipped broken in 0.48.0.
 */
export function objectMenuEntries(
  snapshots: readonly { pluginId: string; commands: readonly CommandRegistration[] }[],
) {
  return snapshots.flatMap((snapshot) =>
    snapshot.commands.flatMap((command) => {
      const meta = command.objectMenu;
      if (!meta || typeof meta !== "object" || typeof meta.label !== "string" || meta.label === "") return [];
      const types = Array.isArray(meta.objectTypes)
        ? meta.objectTypes.filter((type): type is string => typeof type === "string")
        : undefined;
      return [{ pluginId: snapshot.pluginId, command, label: meta.label, types }];
    }),
  );
}

/** Does a contributed entry belong on a row of this object type? */
export function objectMenuMatches(entry: { types?: string[] }, objectType: string) {
  return !entry.types || entry.types.includes(objectType);
}

/**
 * E14B-SLASH-BLOCK (Hive #2): replace the "/query" range with a plugin's
 * fenced block on its own lines. Nothing after it gets a typing spot (the
 * zero-width paragraph terminal blocks use); text after it moves to the next
 * line. The caret lands after the block. A source with a line starting ```
 * would close the fence early, so it is refused (null).
 */
export function pluginBlockInsertion(body: string, start: number, end: number, language: string, source: string): { body: string; caret: number } | null {
  if (/^```/m.test(source)) return null;
  const lead = start > 0 && body[start - 1] !== "\n" ? "\n" : "";
  const rest = body.slice(end);
  const tail = rest.startsWith("\n") ? "" : rest ? "\n" : `\n${String.fromCharCode(0x200b)}`;
  const block = `${lead}\`\`\`${language}\n${source}\n\`\`\`${tail}`;
  return { body: body.slice(0, start) + block + rest, caret: start + block.length + (rest.startsWith("\n") ? 1 : 0) };
}

/**
 * CODE-FORMAT (Hive #35): the code block tools in the "/" menu. CoreOnlyApp
 * offers them only with the caret inside a code block (the JSON ones only in a
 * json block) and runs them through codeFormatInBody, not execute().
 */
/** Marks an i18n key for `npm run locale:extract`; the slash menu translates. */
const t = (text: string) => text;
export const CODE_FORMAT_COMMAND = "code-format:";
export const CODE_FORMAT_COMMANDS: CommandRegistration[] = CODE_FORMAT_ACTIONS.map(({ id, label }) => ({ id: CODE_FORMAT_COMMAND + id, name: label, description: t("Format this code block"), execute: () => "" }));

/** Is this "/" command offered with the caret at `offset` of `body`? */
export function codeFormatCommandOffered(commandId: string, body: string, offset: number): boolean {
  if (!commandId.startsWith(CODE_FORMAT_COMMAND)) return true;
  const fence = codeFenceAt(body, offset);
  const action = CODE_FORMAT_ACTIONS.find(({ id }) => CODE_FORMAT_COMMAND + id === commandId);
  return Boolean(fence && action && (!action.json || fence.lang === "json"));
}

/**
 * Drop the "/filter" text at [start, end) and run the action on the code block
 * it was typed in. The caret goes to the end of the block. A refusal still
 * drops the "/filter" text, so the block is left exactly as it was.
 */
export function codeFormatInBody(body: string, start: number, end: number, action: CodeFormatAction): { body: string; caret: number; error?: CodeFormatError } | null {
  const plain = body.slice(0, start) + body.slice(end);
  const fence = codeFenceAt(plain, start);
  if (!fence) return null;
  const result = formatCode(action, plain.slice(fence.start, fence.end));
  if ("error" in result) return { body: plain, caret: start, error: result };
  return { body: plain.slice(0, fence.start) + result.text + plain.slice(fence.end), caret: fence.start + result.text.length };
}
