// CODE-FORMAT (Hive #35): Notepad++-style tools for a code block's text.
// Pure string -> string; the editor writes the result back through its own
// input sync, so one action is one undo step.

export type CodeFormatAction =
  | "json-pretty" | "json-minify"
  | "sort-lines" | "dedupe-lines" | "trim-trailing" | "join-lines"
  | "tabs-to-spaces" | "spaces-to-tabs" | "upper-case" | "lower-case";

/** Marks an i18n key for `npm run locale:extract`; callers translate. */
const t = (text: string) => text;

/** Menu order; `json` entries are offered only in json blocks. */
export const CODE_FORMAT_ACTIONS: { id: CodeFormatAction; label: string; json?: true }[] = [
  { id: "json-pretty", label: t("Pretty print JSON"), json: true },
  { id: "json-minify", label: t("Minify JSON"), json: true },
  { id: "sort-lines", label: t("Sort lines") },
  { id: "dedupe-lines", label: t("Remove duplicate lines") },
  { id: "trim-trailing", label: t("Trim trailing whitespace") },
  { id: "join-lines", label: t("Join lines") },
  { id: "tabs-to-spaces", label: t("Tabs to spaces") },
  { id: "spaces-to-tabs", label: t("Leading spaces to tabs") },
  { id: "upper-case", label: t("UPPER CASE") },
  { id: "lower-case", label: t("lower case") },
];

/** `error` is an English i18n template; `values` fill its {placeholders}. */
export type CodeFormatError = { error: string; values?: Record<string, string> };
export type CodeFormatResult = { text: string } | CodeFormatError;

export const TAB_SIZE = 4;
// ponytail: a few MB keeps JSON.parse + the scan well under a frame budget's worst case; raise if people paste dumps.
export const JSON_MAX_CHARS = 4 * 1024 * 1024;

const lines = (text: string) => text.split("\n");

export const sortLines = (text: string) => lines(text).sort((a, b) => a.localeCompare(b)).join("\n");
export const dedupeLines = (text: string) => [...new Set(lines(text))].join("\n");
export const trimTrailing = (text: string) => lines(text).map((line) => line.replace(/\s+$/u, "")).join("\n");
export const joinLines = (text: string) => lines(text).map((line) => line.trim()).filter(Boolean).join(" ");
export const upperCase = (text: string) => text.toUpperCase();
export const lowerCase = (text: string) => text.toLowerCase();

/** Every tab becomes spaces up to the next tab stop. */
export function tabsToSpaces(text: string, size = TAB_SIZE) {
  return lines(text).map((line) => {
    let out = "";
    for (const char of line) out += char === "\t" ? " ".repeat(size - (out.length % size)) : char;
    return out;
  }).join("\n");
}

/** Leading indentation only: spaces inside a line may be data (strings). */
export function spacesToTabs(text: string, size = TAB_SIZE) {
  return lines(text).map((line) => {
    const indent = /^[ \t]*/u.exec(line)![0];
    const width = tabsToSpaces(indent, size).length;
    return "\t".repeat(Math.floor(width / size)) + " ".repeat(width % size) + line.slice(indent.length);
  }).join("\n");
}

/** Significant digits of a decimal number's text: "120.50e3" -> "1205". */
const digits = (number: string) => number.replace(/[eE].*$/u, "").replace(/[-.]/gu, "").replace(/^0+|0+$/gu, "");

/**
 * Why re-serialising valid JSON would change its data, or null when it is safe:
 * a duplicate key (JSON.parse keeps the last) or a number a double cannot hold
 * (> 2^53, too many digits, out of range). Assumes `text` already parsed.
 */
export function jsonLossReason(text: string): CodeFormatError | null {
  const stack: { keys: Set<string> | null; expectKey: boolean }[] = [];
  const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/uy;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const top = stack[stack.length - 1];
    if (char === "{") stack.push({ keys: new Set(), expectKey: true });
    else if (char === "[") stack.push({ keys: null, expectKey: false });
    else if (char === "}" || char === "]") stack.pop();
    else if (char === ":") { if (top) top.expectKey = false; }
    else if (char === ",") { if (top?.keys) top.expectKey = true; }
    else if (char === "\"") {
      let end = index + 1;
      while (text[end] !== "\"") end += text[end] === "\\" ? 2 : 1;
      if (top?.keys && top.expectKey) {
        const key = JSON.parse(text.slice(index, end + 1)) as string;
        if (top.keys.has(key)) return { error: t("The key “{key}” appears twice; formatting would drop one."), values: { key: key.length > 40 ? `${key.slice(0, 40)}…` : key } };
        top.keys.add(key);
      }
      index = end;
    } else if (char === "-" || (char >= "0" && char <= "9")) {
      NUMBER.lastIndex = index;
      const token = NUMBER.exec(text)![0];
      const value = Number(token);
      // An integer past 2^53-1 may still be held exactly (9007199254740994),
      // but other tools reading the JSON may not: refuse it too (Codex, Hive #35).
      const unsafeInteger = /^-?\d+$/u.test(token) && !Number.isSafeInteger(value);
      if (unsafeInteger || !Number.isFinite(value) || digits(token) !== digits(String(value))) return { error: t("The number {number} cannot be kept exactly; formatting would change it."), values: { number: token.length > 40 ? `${token.slice(0, 40)}…` : token } };
      index += token.length - 1;
    }
  }
  return null;
}

function formatJson(text: string, indent: number | undefined): CodeFormatResult {
  if (text.length > JSON_MAX_CHARS) return { error: t("This JSON is too large to format here.") };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { error: t("This is not valid JSON, so nothing was changed.") }; }
  const loss = jsonLossReason(text);
  if (loss) return loss;
  return { text: JSON.stringify(value, null, indent) };
}

/**
 * Run one action. On `error` the text is left alone. Never returns a line that would
 * close the code fence (the editor's parser closes on a trimmed "```").
 */
export function formatCode(action: CodeFormatAction, text: string): CodeFormatResult {
  const result = action === "json-pretty" ? formatJson(text, 2)
    : action === "json-minify" ? formatJson(text, undefined)
    : { text: { "sort-lines": sortLines, "dedupe-lines": dedupeLines, "trim-trailing": trimTrailing, "join-lines": joinLines, "tabs-to-spaces": tabsToSpaces, "spaces-to-tabs": spacesToTabs, "upper-case": upperCase, "lower-case": lowerCase }[action](text) };
  // E14B-WRITE-GUARD's rule (sourceWriteAllowed), widened to the indented
  // "```" the parser also treats as a closing fence.
  if ("text" in result && /^\s*```/mu.test(result.text)) return { error: t("The result would end the code block early, so nothing was changed.") };
  return result;
}

/** The fenced block whose content holds `offset` in a note's Markdown, parsed
 * like the editor does (opens on "```lang", closes on a trimmed "```"). */
export function codeFenceAt(body: string, offset: number): { lang: string; start: number; end: number } | null {
  const all = body.split("\n");
  let at = 0;
  for (let index = 0; index < all.length; index += 1) {
    const open = /^```\s*([\w+-]*)\s*$/u.exec(all[index].trim());
    if (!open) { at += all[index].length + 1; continue; }
    const start = at + all[index].length + 1;
    let closeAt = start;
    let close = index + 1;
    while (close < all.length && all[close].trim() !== "```") { closeAt += all[close].length + 1; close += 1; }
    const end = Math.max(start, Math.min(closeAt - 1, body.length));
    if (offset >= start && offset <= end) return { lang: open[1].toLowerCase(), start, end };
    at = closeAt + (close < all.length ? all[close].length + 1 : 0);
    index = close;
  }
  return null;
}
