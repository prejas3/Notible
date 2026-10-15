// Stored note content <-> the Markdown text CoreMarkdownEditor edits.
// Moved out of CoreOnlyApp.tsx unchanged.

/** Mark type name (Tiptap's `bold`/`strong`, `italic`/`em`, etc.) -> the
 * Markdown delimiter CoreMarkdownEditor's own dialect uses for it. */
const MARK_TYPE_DELIMITER: Record<string, string> = { bold: "**", strong: "**", italic: "*", em: "*", underline: "__", u: "__", strike: "~~", s: "~~", del: "~~", highlight: "==", mark: "==" };
/** Fixed wrap order so e.g. bold+italic always serializes as `***text***`
 * rather than depending on the marks array's incidental order. */
const MARK_WRAP_ORDER = ["**", "__", "~~", "==", "*"];

function markdownInline(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = node as { type?: unknown; text?: unknown; marks?: unknown };
  if (value.type === "hardBreak") return "\n";
  if (typeof value.text !== "string") return "";
  const delimiters = new Set<string>();
  if (Array.isArray(value.marks)) {
    for (const mark of value.marks) {
      const markType = mark && typeof mark === "object" ? (mark as { type?: unknown }).type : undefined;
      const delimiter = typeof markType === "string" ? MARK_TYPE_DELIMITER[markType] : undefined;
      if (delimiter) delimiters.add(delimiter);
    }
  }
  return MARK_WRAP_ORDER.filter((delimiter) => delimiters.has(delimiter)).reduce((text, delimiter) => `${delimiter}${text}${delimiter}`, value.text);
}

function markdownInlineChildren(node: unknown): string {
  const value = node && typeof node === "object" ? (node as { content?: unknown[] }) : null;
  return Array.isArray(value?.content) ? value.content.map(markdownInline).join("") : "";
}

function markdownTableCellText(cell: unknown): string {
  const value = cell && typeof cell === "object" ? (cell as { content?: unknown[] }) : null;
  return (value?.content ?? []).map((paragraph) => markdownInlineChildren(paragraph)).join(" ").trim();
}

function markdownFromTable(node: { content?: unknown[] }): string {
  const isRow = (candidate: unknown): candidate is { content?: unknown[] } =>
    !!candidate && typeof candidate === "object" && (candidate as { type?: unknown }).type === "tableRow";
  const rows = (node.content ?? []).filter(isRow).map((row) => (row.content ?? []).map(markdownTableCellText));
  if (rows.length === 0) return "";
  const header = rows[0];
  const body = rows.slice(1);
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...body.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

/** Renders one Tiptap block node (and, recursively, its children) as the
 * equivalent line(s) of CoreMarkdownEditor's own Markdown dialect — see
 * renderCoreMarkdown in CoreMarkdownEditor.tsx for the syntax this must
 * match (headings, `- `/`1. `/`- [ ] ` lists, fenced code, `![]()` images,
 * `| a | b |` tables, `> ` quotes). Anything unrecognized falls back to
 * concatenating its children so no content is silently dropped. */
function markdownFromNode(node: unknown, listContext: { ordered: boolean; start: number } | null = null, indexInList = 0): string {
  if (!node || typeof node !== "object") return "";
  const value = node as { type?: unknown; attrs?: Record<string, unknown>; content?: unknown[] };
  const attrs = value.attrs ?? {};
  switch (value.type) {
    case "text":
      return markdownInline(value);
    case "paragraph":
      return markdownInlineChildren(value);
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(attrs.level) || 1));
      return `${"#".repeat(level)} ${markdownInlineChildren(value)}`;
    }
    case "codeBlock": {
      const lang = typeof attrs.language === "string" ? attrs.language : "";
      const code = (value.content ?? []).map((child) => (child && typeof child === "object" ? (child as { text?: unknown }).text ?? "" : "")).join("");
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }
    case "image": {
      const alt = typeof attrs.alt === "string" ? attrs.alt : "";
      const src = typeof attrs.src === "string" ? attrs.src : "";
      return `![${alt}](${src})`;
    }
    case "horizontalRule":
      return "---";
    case "blockquote":
      return (value.content ?? []).map((child) => markdownFromNode(child)).join("\n").split("\n").map((line) => `> ${line}`).join("\n");
    case "bulletList":
      return (value.content ?? []).map((child, itemIndex) => markdownFromNode(child, { ordered: false, start: 1 }, itemIndex)).join("\n");
    case "orderedList": {
      const start = Number(attrs.start) || 1;
      return (value.content ?? []).map((child, itemIndex) => markdownFromNode(child, { ordered: true, start }, itemIndex)).join("\n");
    }
    case "taskList":
      return (value.content ?? []).map((child) => markdownFromNode(child)).join("\n");
    case "listItem": {
      const inner = (value.content ?? []).map((child) => markdownFromNode(child)).join(" ").trim();
      const prefix = listContext?.ordered ? `${listContext.start + indexInList}. ` : "- ";
      return `${prefix}${inner}`;
    }
    case "taskItem": {
      const inner = (value.content ?? []).map((child) => markdownFromNode(child)).join(" ").trim();
      return `- [${attrs.checked === true ? "x" : " "}] ${inner}`;
    }
    case "table":
      return markdownFromTable(value);
    default:
      return (value.content ?? []).map((child) => markdownFromNode(child)).join("\n");
  }
}

/** Converts stored note content — a Tiptap-shaped doc JSON, whether authored
 * by this app's own flat-paragraph convention or by a richer editor
 * elsewhere (marks, headings, lists, tables, images, code blocks) — into
 * the plain Markdown text CoreMarkdownEditor edits. This is a one-way,
 * best-effort conversion: saving back through documentFromText re-flattens
 * everything into plain paragraphs holding literal Markdown syntax, which
 * CoreMarkdownEditor's own renderer (renderCoreMarkdown) already knows how
 * to redisplay, so nothing is lost from the user's point of view even
 * though the original Tiptap node types don't survive a round trip. */
export function textFromDocument(raw: string) {
  try {
    const document = JSON.parse(raw) as { content?: unknown[] };
    if (!Array.isArray(document.content)) return "";
    // Exact inverse of documentFromText, which stores one paragraph per line
    // (blank lines included). Dropping the empties and re-joining with "\n\n"
    // used to fabricate a blank line between every stored line, which split
    // each consecutive list run into a separate <ol> — so every reload
    // restarted the numbering and Enter inside a list produced duplicates.
    return document.content.map((node) => markdownFromNode(node)).join("\n").trimEnd();
  } catch {
    return raw;
  }
}

export function documentFromText(text: string) {
  const paragraphs = text.split("\n").map((line) => line
    ? { type: "paragraph", content: [{ type: "text", text: line }] }
    : { type: "paragraph" });
  return JSON.stringify({ type: "doc", content: paragraphs });
}
