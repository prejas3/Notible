import { tCore, tr, useCoreI18n } from "./core-i18n.ts";
import { forwardRef, useEffect, useMemo, useRef, useState, type KeyboardEvent, type UIEvent } from "react";
import type { CodeBlockEditorBridge } from "./codeBlockMounts.ts";
import { CODE_FORMAT_ACTIONS, formatCode, type CodeFormatAction } from "./codeFormat.ts";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { escapeHtml, FOOTNOTE_DEFINITION, footnoteDefinitionLabels, footnoteMarkerLabels, HIGHLIGHT_COLOURS, inlineHtml, insertFootnote, LINK_URL, MARK_DELIMITERS, orphanedFootnotes, markdownOpenFor, toggleHeading, toggleInlineMark, wrapLink, type HighlightColour, type InlineMarkKind } from "./coreMarkdownMarks.ts";
import { Heading2, Link2 } from "lucide-react";
import { isDevMockActive } from "../data/dev-mock-invoke.ts";
import { saveMedia } from "../data/core-data-api.ts";
import { collapseMediaReference, expandMediaReference, mediaDirectoryKnown, MEDIA_READY_EVENT } from "./mediaRef.ts";

const ZERO_WIDTH_SPACE = new RegExp(String.fromCharCode(0x200b), "gu");
/** A `[text](url)` link that ends exactly where the caret is. */
/** Blocks with no text line of their own for the caret to end on. */
const TRAILING_BLOCKS = "pre.core-code-block, hr, table, .core-md-block, p.core-md-picture";
const LINK_AT_END =/\[[^[\]]+\]\((?:https?:\/\/|mailto:)[^\s()]+\)$/u;
/** Link text taken from a selection or a page: brackets would end it early. */
function linkLabel(value: string, url: string): string {
  return value.replace(/[[\]]/gu, "").replace(/\s+/gu, " ").trim() || url;
}

/** Inverse of inlineHtml's mark handling: walks a DOM subtree back into the
 * same delimited markdown text, so bold/italic/underline/strike/highlight
 * marks the user applies actually round-trip through the stored Markdown
 * string instead of being silently flattened to plain text on save. */
function inlineMarkdownOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(ZERO_WIDTH_SPACE, "");
  if (!(node instanceof HTMLElement)) return "";
  if (node.classList.contains("core-md-task-box") || node.classList.contains("core-code-toolbar") || node.classList.contains("core-md-block-label")) return "";
  if (node.tagName.toLowerCase() === "br") return "\n";
  if (node.tagName.toLowerCase() === "img") return `![${(node as HTMLImageElement).alt}](${collapseMediaReference(node.getAttribute("src") ?? "")})`;
  const inner = Array.from(node.childNodes).map(inlineMarkdownOf).join("");
  const delimiter = MARK_DELIMITERS[node.tagName.toLowerCase()];
  return delimiter ? `${markdownOpenOf(node)}${inner}${delimiter}` : inner;
}

const BRACKET_PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const BRACKET_CLOSERS = new Set(Object.values(BRACKET_PAIRS));

/** 3.7: pasting a spreadsheet/chat table (tab-separated rows) becomes a real
 * Markdown table instead of one flattened line per row. Returns null for
 * anything that isn't at least two rows of the same tab-delimited width, so
 * ordinary multi-line paste still falls through to plain-text insertion. */
function tabularMarkdownFrom(text: string): string | null {
  const lines = text.replace(/\r\n/gu, "\n").split("\n").filter((line) => line.length > 0);
  if (lines.length < 2 || !lines.every((line) => line.includes("\t"))) return null;
  const rows = lines.map((line) => line.split("\t").map((cell) => cell.trim()));
  const width = rows[0]?.length ?? 0;
  if (width < 2 || !rows.every((row) => row.length === width)) return null;
  return [
    `| ${rows[0].join(" | ")} |`,
    `| ${rows[0].map(() => "---").join(" | ")} |`,
    ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

const PASTE_BLOCK_TAGS = new Set(["p", "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th", "h1", "h2", "h3", "blockquote", "hr", "img", "pre", "code", "br"]);
const PASTE_INLINE_TAGS = new Set(Object.keys(MARK_DELIMITERS));

/** Pasting from Word/Docs/a web page carries real structure (bullets,
 * headings, bold, tables) in `text/html`, which the plain-text branches below
 * throw away — a bulleted list turns into bare lines with no "- ". Reuses
 * `markdownFromCoreHtml`'s own tag-based dispatch by reshaping the pasted
 * markup into the same vocabulary it already understands: unwrap every div/
 * span/font wrapper (Docs' `docs-internal-guid` div, style spans, …) up to
 * its children, drop anything else (script/style/comments/images-as-embeds),
 * and fold h4-h6 down to h3 since that is as deep as this editor's headings
 * go. Returns null when the paste carried no real structure, so the caller
 * falls back to the plain-text heuristics (tables/code/multi-line). */
function markdownFromPastedHtml(html: string): string | null {
  if (!/<[a-z][\s\S]*>/iu.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  let linked = false;
  function unwrap(node: Node) {
    Array.from(node.childNodes).forEach(unwrap);
    // HTML source wraps lines inside a paragraph; a browser renders that as one line, so collapse it here or every wrap becomes its own note line.
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.parentElement?.closest("pre")) node.textContent = (node.textContent ?? "").replace(/\s+/gu, " ");
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    let tag = node.tagName.toLowerCase();
    if (tag === "script" || tag === "style") { node.remove(); return; }
    // A web link becomes `[text](url)` as plain text — markdownFromCoreHtml
    // passes text through, and this editor renders it back as a link. Any
    // other href (relative, javascript:, …) keeps only its text.
    if (tag === "a") {
      const href = node.getAttribute("href") ?? "";
      const text = node.textContent ?? "";
      if (LINK_URL.test(href) && text.trim()) { node.replaceWith(doc.createTextNode(`[${linkLabel(text, href)}](${href})`)); linked = true; }
      else node.replaceWith(...Array.from(node.childNodes));
      return;
    }
    if (tag === "strong" && node.style?.fontWeight === "normal") tag = "span";
    if (/^h[4-6]$/u.test(tag)) {
      const h3 = doc.createElement("h3");
      h3.append(...Array.from(node.childNodes));
      node.replaceWith(h3);
      return;
    }
    if (PASTE_BLOCK_TAGS.has(tag) || PASTE_INLINE_TAGS.has(tag)) {
      // Attributes not needed for markdown conversion — a stray leftover
      // `style`/`class` from the source page must never leak into the note.
      if (tag === "ol" && node.hasAttribute("start")) {
        const start = node.getAttribute("start");
        Array.from(node.attributes).forEach((attr) => node.removeAttribute(attr.name));
        if (start) node.setAttribute("start", start);
      } else {
        Array.from(node.attributes).forEach((attr) => node.removeAttribute(attr.name));
      }
      return;
    }
    node.replaceWith(...Array.from(node.childNodes));
  }
  // Children only: unwrap(body) would replaceWith() the <body> itself, detaching it and leaving nothing to convert.
  Array.from(body.childNodes).forEach(unwrap);
  // A link turned into text sits between two other text nodes; merge them, or
  // markdownFromCoreHtml reads each loose text node as a line of its own.
  body.normalize();
  // A fragment of a sentence (no block element at all) is one line: wrap it,
  // or each loose text/bold/italic piece becomes a line of its own.
  if (!Array.from(body.children).some((child) => child.matches("p, ul, ol, table, h1, h2, h3, blockquote, pre, hr"))) {
    const paragraph = doc.createElement("p");
    paragraph.append(...Array.from(body.childNodes));
    body.append(paragraph);
  }
  const hasStructure = linked || body.querySelector("ul, ol, table, h1, h2, h3, blockquote, strong, b, em, i, u, s, strike, del");
  if (!hasStructure) return null;
  const markdown = markdownFromCoreHtml(body);
  return markdown.trim() ? markdown : null;
}

/** Cheap source-code heuristic for paste auto-detection: multi-line text
 * with a meaningful share of lines carrying code punctuation or indentation.
 * False positives just mean plain prose stays plain — this only needs to
 * catch the common "pasted a code snippet" case, not be exhaustive. */
function looksLikeCode(text: string): boolean {
  const trimmed = text.replace(/\r\n/gu, "\n").trim();
  if (!trimmed || /^```/u.test(trimmed)) return false;
  const lines = trimmed.split("\n");
  if (lines.length < 2) return false;
  const punctLines = lines.filter((line) => /[{};]|=>|^\s*(#|\/\/)/u.test(line)).length;
  const indentLines = lines.filter((line) => /^(\s{2,}|\t)/u.test(line)).length;
  const keywordHit = /\b(function|const|let|var|def|class|import|export|public|private|static|return|SELECT|INSERT|UPDATE|#include|package|fn)\b/u.test(trimmed);
  return keywordHit && (punctLines / lines.length > 0.25 || indentLines / lines.length > 0.35);
}

/** Best-effort language tag for the fenced block a code-shaped paste gets
 * wrapped in — covers the languages CoreMarkdownEditor's syntax styling
 * (see core-code-lang / renderCoreMarkdown) is most likely to see: web,
 * Python, SQL, C-family, Java, Go, Rust, PHP, shell, CSS. Returns "" (no
 * tag) rather than guessing wrong when nothing matches confidently. */
function detectCodeLanguage(text: string): string {
  const trimmed = text.trim();
  if (/<\/?[a-z][\w-]*[^>]*>/iu.test(trimmed) && /<\/\w+>|\/>/u.test(trimmed)) return "html";
  if (/^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/iu.test(trimmed)) return "sql";
  if (/^\s*(#!\/bin\/(ba)?sh|\$\s+\w|sudo\s+\w)/mu.test(trimmed)) return "bash";
  if (/^\s*(import|from)\s+\S+.*$|:\s*$/mu.test(trimmed) && /\bdef\s+\w+\s*\(.*\):/u.test(trimmed)) return "python";
  if (/^\s*(package\s+main|func\s+\w+\s*\()/mu.test(trimmed)) return "go";
  if (/^\s*fn\s+\w+\s*\(.*\)\s*(->|\{)/mu.test(trimmed) || /\blet\s+mut\b/u.test(trimmed)) return "rust";
  if (/^\s*#include\s*<\w+>/mu.test(trimmed) || /\bstd::\w+/u.test(trimmed)) return "cpp";
  if (/\bpublic\s+(static\s+)?(class|void)\b/u.test(trimmed) || /System\.out\.println/u.test(trimmed)) return "java";
  if (/<\?php/u.test(trimmed) || /\$\w+\s*=(?!=)/u.test(trimmed) && /;\s*$/mu.test(trimmed)) return "php";
  if (/^\s*[.#]?[\w-]+\s*\{[\s\S]*:[\s\S]*;[\s\S]*\}/mu.test(trimmed) && !/\bfunction\b|\bconst\b/u.test(trimmed)) return "css";
  if (/:\s*(string|number|boolean|any|unknown|void)\b|\binterface\s+\w+|<\w+>\s*\(/u.test(trimmed)) return "typescript";
  if (/\b(function|const|let|var)\b|=>|console\.log/u.test(trimmed)) return "javascript";
  return "";
}

/** Turns plain-text bullet characters (•, ‣, ◦, ●, ▪) pasted with no
 * surrounding <ul>/<li> markup into real markdown "- " list items, so
 * copy-paste from sources that render bullets as plain glyphs (not
 * `markdownFromPastedHtml`'s territory — there's no list HTML to catch)
 * still becomes a list instead of literal bullet characters in the note. */
function normalizeBulletLines(text: string): string {
  return text.replace(/^[ \t]*[•‣◦●▪][ \t]+/gmu, "- ");
}

function isTableRow(value: string) {
  return value.trim().startsWith("|") && value.trim().endsWith("|");
}

/** The `| --- | --- |` line under a table's header — the same test used to
 * both start a table (line 2 after a header) and stop one (peeking one line
 * ahead to tell "this is real data" from "this is actually the next
 * table's header"). One regex, two call sites, so they cannot drift apart. */
function isTableSeparatorRow(value: string) {
  return /^\|[\s|:-]+\|$/u.test(value);
}

function tableCells(value: string) {
  return value.trim().replace(/^\||\|$/gu, "").split("|").map((cell) => cell.trim());
}

/** An image is `display: block`, and a block box sitting directly inside a
 * <li>/<p>'s inline flow wrecks that block's caret hit-testing: clicking
 * anywhere to the right of the text collapsed the caret to offset 0 (start of
 * the line) instead of end-of-line, and arrow keys gained an extra stop that
 * rendered to the left of the picture. Giving each text run its own block
 * sibling of the image restores ordinary, Word-like caret behaviour.
 * Round-trips unchanged: inlineMarkdownOf returns a span's inner content
 * verbatim when the span carries no mark delimiter. */
function inlineHtmlWithImageLines(value: string): string {
  const html = inlineHtml(value);
  if (!html.includes("<img")) return html;
  return html
    .split(/(<img\b[^>]*>)/u)
    .map((part) => (part === "" || part.startsWith("<img") ? part : `<span class="core-md-line">${part}</span>`))
    .join("");
}

/** Move a caret that has just landed immediately *before* a picture to the
 * far side of it. Only vertical moves call this: ArrowLeft/ArrowRight keep
 * the before-image position so text can still be typed in front of it. */
function skipCaretPastImage() {
  const selection = window.getSelection();
  if (!selection?.isCollapsed || selection.rangeCount === 0) return;
  const anchor = selection.anchorNode;
  if (!(anchor instanceof HTMLElement)) return;
  const next = anchor.childNodes[selection.anchorOffset];
  if (!(next instanceof HTMLImageElement) || !next.classList.contains("core-md-image")) return;
  const range = document.createRange();
  range.setStartAfter(next);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function lastTextNode(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  for (let i = node.childNodes.length - 1; i >= 0; i -= 1) {
    const found = lastTextNode(node.childNodes[i]);
    if (found) return found;
  }
  return null;
}

function firstTextNode(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  for (const child of Array.from(node.childNodes)) {
    const found = firstTextNode(child);
    if (found) return found;
  }
  return null;
}

/** A click in the margin between two block-level siblings (a paragraph's
 * `margin-bottom`, sitting right above an image's own top margin) hits
 * neither element's box. The browser resolves it to a position between the
 * two children on the *root* itself — not "end of the paragraph's text", as
 * clicking anywhere else on that line does. Landing there is only cosmetic
 * until the next keystroke: `document.execCommand("insertText")` inserts a
 * bare text node as a direct child of root, outside any `<p>`, which
 * `markdownFromCoreHtml` does not expect. Retarget it to the nearest text in
 * whichever neighbour the click was closer to. */
function fixCaretInBlockGap(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.isCollapsed || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (range.startContainer !== root) return;
  const offset = range.startOffset;
  const previousSibling = root.childNodes[offset - 1];
  const before = previousSibling ? lastTextNode(previousSibling) : null;
  if (before) { placeSelection(before, before.textContent?.length ?? 0); return; }
  const nextSibling = root.childNodes[offset];
  const after = nextSibling ? firstTextNode(nextSibling) : null;
  if (after) placeSelection(after, 0);
}

/** Where each cell's text starts inside a table's Markdown block, matching
 * linesForElement: the header row, a "| --- |" line, then the body rows, each
 * written `| a | b |`. Shared by caret measuring and caret placing, which had
 * no table case, so typing in a table landed inside the wrong text (E14, E20). */
function tableCellOffsets(table: HTMLElement) {
  const cells: Array<{ cell: HTMLElement; start: number; length: number }> = [];
  let lineStart = 0;
  Array.from(table.querySelectorAll("tr")).forEach((row, rowIndex) => {
    const rowCells = Array.from(row.children) as HTMLElement[];
    let at = lineStart + 2;
    for (const cell of rowCells) {
      const length = nodeText(cell).length;
      cells.push({ cell, start: at, length });
      at += length + 3;
    }
    lineStart = at; // past the row's closing " |" and its newline
    if (rowIndex === 0) lineStart += `| ${rowCells.map(() => "---").join(" | ")} |`.length + 1;
  });
  return cells;
}

/** ` data-indent="n"` for a list line's leading tabs (E5), nothing at level 0. */
function indentAttribute(tabs: string) {
  const level = Math.min(MAX_LIST_INDENT, tabs.length);
  return level ? ` data-indent="${level}"` : "";
}

/** Length of a code block's opening "```lang\n" line. */
function codeFenceLength(pre: HTMLElement) { return 3 + (pre.dataset.lang ?? "").length + 1; }

const CODE_LANGUAGES = ["", "bash", "cpp", "css", "go", "html", "java", "javascript", "json", "mermaid", "php", "python", "rust", "sql", "typescript", "yaml"];

/** The code block's language label is a button: it opens the language menu,
 * so the language can be changed once the block exists (E9). The fence line
 * itself is never on screen. */
function codeLanguagePicker(lang: string) {
  return `<button type="button" class="core-code-lang" title="${escapeHtml(tCore("Code language"))}" data-edit-label="${escapeHtml(tCore("edit"))}" aria-haspopup="menu">${escapeHtml(lang || "text")}</button>`;
}

/** CODE-FORMAT (Hive #43): the toolbar's Format button opens the same menu as
 * a right-click. `hidden` keeps it out of help, panels and read-only notes,
 * which share this renderer but cannot edit; core-only.css shows it only in
 * an editable note. */
function codeFormatButton() {
  return `<button type="button" class="core-code-format" hidden tabindex="0" aria-haspopup="menu">${escapeHtml(tCore("Format"))}</button>`;
}

/** A block a slash command just created is empty ("# " → <h1></h1>), and a
 * childless block cannot hold a caret in contentEditable — the browser drops
 * the caret to the start of the note and the next keystroke lands outside the
 * new block. A lone <br> gives it a caret position; `nodeMarkdown` trims it
 * back out, so the Markdown round-trip is unchanged. */
function caretHost(html: string) { return html || "<br>"; }

/** Turn bare http(s) URLs in a footnote definition into links (Ctrl+click opens
 *  them). The anchor keeps the URL as its literal text, so — like the marker span
 *  — it serializes and caret-measures exactly as plain text. Only run on a
 *  definition line, and never on a URL that is already inside an attribute. */
function linkFootnoteUrls(html: string): string {
  return html.replace(/(?<![="'/])\bhttps?:\/\/[^\s<"']*[^\s<"'.,;:!?)]/gu, (url) => `<a class="core-md-fnlink" data-url="${url}">${url}</a>`);
}

export function renderCoreMarkdown(value: string, options: { dashList?: boolean } = {}) {
  const dashList = options.dashList ?? true;
  const lines = value.replaceAll("\r\n", "\n").split("\n");
  const html: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") { index += 1; continue; }
    const fence = /^```\s*([\w+-]*)\s*$/u.exec(line.trim());
    if (fence) {
      const lang = fence[1] ?? "";
      const code: string[] = [];
      index += 1;
      while (index < lines.length && lines[index]?.trim() !== "```") { code.push(lines[index] ?? ""); index += 1; }
      if (index < lines.length) index += 1;
      html.push(`<pre class="core-code-block" data-lang="${escapeHtml(lang)}"><div class="core-code-toolbar" contenteditable="false">${codeLanguagePicker(lang)}${codeFormatButton()}<button type="button" class="core-code-copy">${escapeHtml(tCore("Copy"))}</button></div><code spellcheck="false">${escapeHtml(code.join("\n")) || "&#8203;"}</code></pre>`);
      continue;
    }
    // After a block's mark only spaces are dropped, never tabs: nodeMarkdown
    // keeps leading tabs, so eating them here left the screen one character
    // shorter than the saved text, and every offset after it wrong. That is
    // how a highlight pushed a list item out of its list (E6).
    const heading = /^(#{1,3})\s[^\S\t]*(.*)$/u.exec(line);
    if (heading) { html.push(`<h${heading[1].length}>${caretHost(inlineHtml(heading[2]))}</h${heading[1].length}>`); index += 1; continue; }
    if (/^---+\s*$/u.test(line)) { html.push("<hr>"); index += 1; continue; }
    const image = /^!\[([^\]]*)\]\(([^)]*)\)$/u.exec(line);
    // A picture on its own line sits in a paragraph of its own, Word-style.
    // A bare <img> straight under the editor had no caret position beside it:
    // a click next to it landed in the following code block's toolbar or
    // source, a click on it at the very start of the note. In a paragraph
    // the caret can stand right after the picture and Enter makes a new line.
    // Serializes the same: a <p> is its inline markdown, `![](…)`.
    if (image) { html.push(`<p class="core-md-picture"><img class="core-md-image" alt="${escapeHtml(image[1])}" src="${escapeHtml(expandMediaReference(image[2]))}"></p>`); index += 1; continue; }
    if (/^:::\s+(columns|calendar)\s*$/u.test(line)) {
      const kind = /^:::\s+(columns|calendar)\s*$/u.exec(line)?.[1] ?? "block";
      const content: string[] = [];
      index += 1;
      while (index < lines.length && lines[index]?.trim() !== ":::") { content.push(lines[index] ?? ""); index += 1; }
      if (index < lines.length) index += 1;
      html.push(`<div class="core-md-block" data-core-block="${kind}"><strong class="core-md-block-label" contenteditable="false">${kind === "columns" ? tCore("Columns") : tCore("Calendar")}</strong>${content.filter(Boolean).map((item) => `<span>${inlineHtml(item)}</span>`).join("")}</div>`);
      continue;
    }
    if (/^>\s?/u.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/u.test(lines[index] ?? "")) { quote.push((lines[index] ?? "").replace(/^>\s?/u, "")); index += 1; }
      html.push(`<blockquote>${caretHost(quote.map(inlineHtml).join("<br>"))}</blockquote>`);
      continue;
    }
    // `\s*`, not `\s+`: an empty checkbox serializes as "- [ ]" because
    // nodeMarkdown trims, so requiring a space after the bracket turned every
    // freshly inserted task item back into a plain bullet reading "[ ]".
    if (/^\t*- (?:\[ \]|\[[xX]\])\s*/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\t*- (?:\[ \]|\[[xX]\])\s*/u.test(lines[index] ?? "")) {
        const item = /^(\t*)- \[([ xX])\][^\S\t]*(.*)$/u.exec(lines[index] ?? "");
        if (item) items.push(`<li data-task="true" data-checked="${item[2].toLowerCase() === "x"}"${indentAttribute(item[1])}><span class="core-md-task-box" contenteditable="false">${item[2].toLowerCase() === "x" ? "✓" : ""}</span>${inlineHtml(item[3]) || "&#8203;"}</li>`);
        index += 1;
      }
      html.push(`<ul class="core-md-list core-md-task-list">${items.join("")}</ul>`);
      continue;
    }
    // `dashList: false` (the Typewriter scene profile) — a line that opens with
    // "- " is dialogue, not a bullet. Fall through so it renders as a plain
    // paragraph keeping the literal dash, matching what typing already does.
    if (dashList && /^\t*-\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\t*-\s+/u.test(lines[index] ?? "")) {
        const item = lines[index] ?? "";
        items.push(`<li${indentAttribute(/^\t*/u.exec(item)?.[0] ?? "")}>${caretHost(inlineHtmlWithImageLines(item.replace(/^\t*-[^\S\t]*/u, "")))}</li>`);
        index += 1;
      }
      html.push(`<ul class="core-md-list">${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/u.test(line)) {
      const start = Number(/^(\d+)\./u.exec(line)?.[1] ?? "1");
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/u.test(lines[index] ?? "")) { items.push(`<li>${caretHost(inlineHtmlWithImageLines((lines[index] ?? "").replace(/^\d+\.[^\S\t]*/u, "")))}</li>`); index += 1; }
      html.push(`<ol class="core-md-list"${start !== 1 ? ` start="${start}"` : ""}>${items.join("")}</ol>`);
      continue;
    }
    if (isTableRow(line) && isTableSeparatorRow(lines[index + 1] ?? "")) {
      const header = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      // A row is only this table's DATA if the line after it is not itself a
      // header starting a new table — otherwise two `/table` insertions with
      // no blank line between them (the natural result of running the
      // command twice in a row) fused into one table whose body rows were
      // literally the second table's "Column 1" / "---" header and
      // separator text, rather than a real second table.
      while (index < lines.length && isTableRow(lines[index] ?? "") && !isTableSeparatorRow(lines[index + 1] ?? "")) {
        rows.push(tableCells(lines[index] ?? "")); index += 1;
      }
      html.push(`<table><thead><tr>${header.map((cell) => `<th>${inlineHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    // `[^1]: source or note` — a footnote definition, set small under the text.
    html.push(FOOTNOTE_DEFINITION.test(line) ? `<p class="core-md-fndef">${linkFootnoteUrls(inlineHtmlWithImageLines(line))}${/\s$/u.test(line) ? "&#8203;" : ""}</p>` : `<p>${inlineHtmlWithImageLines(line)}</p>`);
    index += 1;
  }
  return html.join("");
}

function nodeText(node: Element) {
  return (node.textContent ?? "").replace(/\u200b/gu, "").trim();
}

/** Inline-mark-aware serialization of an element's content — the counterpart
 * to nodeText for anything that should round-trip bold/italic/underline/
 * strike/highlight, not just plain characters. */
function nodeMarkdown(node: Element): string {
  // Leading tabs are content (the Tab key's indent); other edge whitespace is not.
  return Array.from(node.childNodes).map(inlineMarkdownOf).join("").replace(ZERO_WIDTH_SPACE, "").replace(/^[^\S\t]+|\s+$/gu, "");
}

/** The literal Markdown prefix a list item's own bullet/checkbox/number
 * contributes, independent of its (possibly marked-up) content — computed
 * structurally so mark delimiters inside the content are never mistaken for
 * part of the prefix. */
function listItemPrefix(index: number, ordered: boolean, task: boolean, checked: boolean, startAt = 1, indent = 0): string {
  if (ordered) return `${startAt + index}. `;
  const tabs = "\t".repeat(indent);
  if (task) return `${tabs}- [${checked ? "x" : " "}] `;
  return `${tabs}- `;
}

/** A bullet's nesting level (E5): Tab/Shift+Tab change it, Markdown writes it
 * as leading tabs (`\t- item`). The list stays one flat <ul>, indented by CSS. */
const MAX_LIST_INDENT = 6;
function listIndent(li: HTMLElement) {
  return Math.min(MAX_LIST_INDENT, Math.max(0, Number(li.dataset.indent) || 0));
}

function listStartAt(list: HTMLElement): number {
  const start = Number(list.getAttribute("start"));
  return Number.isFinite(start) && start > 0 ? start : 1;
}

function listItemMarkdown(li: HTMLElement, index: number, ordered: boolean, startAt = 1) {
  const task = li.dataset.task === "true";
  const checked = li.dataset.checked === "true";
  return listItemPrefix(index, ordered, task, checked, startAt, listIndent(li)) + nodeMarkdown(li);
}

/** Markdown lines produced by one top-level block element, matching the
 * conversion `markdownFromCoreHtml` performs for the same element. Shared so
 * caret-offset math stays in exact sync with the text actually written. */
function linesForElement(element: HTMLElement): string[] {
  const tag = element.tagName.toLowerCase();
  if (tag === "h1" || tag === "h2" || tag === "h3") return [`${"#".repeat(Number(tag.slice(1)))} ${nodeMarkdown(element)}`];
  if (tag === "p") return [nodeMarkdown(element)];
  if (tag === "blockquote") return nodeMarkdown(element).split(/\r?\n/u).map((line) => `> ${line}`);
  if (tag === "hr") return ["---"];
  if (tag === "img") return [`![${(element as HTMLImageElement).alt}](${collapseMediaReference(element.getAttribute("src") ?? "")})`];
  if (tag === "pre") { const lang = element.dataset.lang ?? ""; const code = (element.querySelector("code")?.textContent ?? "").replace(ZERO_WIDTH_SPACE, ""); return [`\`\`\`${lang}\n${code}\n\`\`\``]; }
  if (tag === "ul") return Array.from(element.children).map((item, index) => listItemMarkdown(item as HTMLElement, index, false));
  if (tag === "ol") { const startAt = listStartAt(element); return Array.from(element.children).map((item, index) => listItemMarkdown(item as HTMLElement, index, true, startAt)); }
  if (tag === "table") {
    const rows = Array.from(element.querySelectorAll("tr")).map((row) => Array.from(row.children).map((cell) => nodeText(cell)));
    if (!rows[0]) return [];
    return [
      `| ${rows[0].join(" | ")} |`,
      `| ${rows[0].map(() => "---").join(" | ")} |`,
      ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
    ];
  }
  // Its lines are the <span>s; the label is chrome. This used to write the
  // block back empty, so any edit anywhere in the note wiped a Columns block.
  if (element.dataset.coreBlock) {
    const lines = Array.from(element.children).filter((child) => child.tagName.toLowerCase() === "span").map((span) => nodeMarkdown(span)).filter(Boolean);
    return [`::: ${element.dataset.coreBlock}`, ...(lines.length ? lines : [""]), ":::"];
  }
  return nodeText(element) ? [nodeText(element)] : [];
}

export function markdownFromCoreHtml(root: HTMLElement) {
  // Typing into a childless (or caret-outside-any-block) contentEditable can
  // land the browser's first character as a bare text node directly under
  // root, a sibling of any <p> rather than inside it — root.children (Element
  // only) silently drops it. Treat stray non-whitespace text-node children
  // as their own implicit paragraph so the first keystroke is never lost.
  const lines = Array.from(root.childNodes).flatMap(linesOfRootChild);
  return lines.join("\n").replace(/\n{3,}/gu, "\n\n");
}

function linesOfRootChild(node: ChildNode): string[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").replace(ZERO_WIDTH_SPACE, "").trim();
    return text ? [text] : [];
  }
  return node instanceof HTMLElement ? linesForElement(node) : [];
}

/** Markdown-space offset of a DOM position within one block element, aware
 * of mark delimiters (so a caret placed inside a **bold** run lands at the
 * right index in the Markdown string, not the shorter plain-text one). */
function markdownOffsetWithin(container: Node, anchor: Node, anchorOffset: number): number {
  let result = -1;
  let consumed = 0;
  function visit(node: Node): boolean {
    if (result !== -1) return true;
    if (node === anchor) {
      if (node.nodeType === Node.TEXT_NODE) {
        // Zero-width placeholders are not in the Markdown, before the caret either.
        consumed += (node.textContent ?? "").slice(0, anchorOffset).replace(ZERO_WIDTH_SPACE, "").length;
      } else {
        const children = Array.from(node.childNodes);
        for (let i = 0; i < Math.min(anchorOffset, children.length); i += 1) visit(children[i]);
      }
      result = consumed;
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      consumed += (node.textContent ?? "").replace(ZERO_WIDTH_SPACE, "").length;
      return false;
    }
    if (!(node instanceof HTMLElement)) return false;
    if (node.classList.contains("core-md-task-box") || node.classList.contains("core-code-toolbar") || node.classList.contains("core-code-render") || node.classList.contains("core-md-block-label")) return false;
    if (node.tagName.toLowerCase() === "br") { consumed += 1; return false; }
    if (node.tagName.toLowerCase() === "img") { consumed += inlineMarkdownOf(node).length; return false; }
    const delimiter = MARK_DELIMITERS[node.tagName.toLowerCase()] ?? "";
    consumed += markdownOpenOf(node).length;
    for (const child of Array.from(node.childNodes)) {
      if (visit(child)) return true;
    }
    consumed += delimiter.length;
    return false;
  }
  visit(container);
  return result === -1 ? consumed : result;
}

/** Markdown-space offset of an arbitrary DOM (node, offset) position within
 * the editor root — the shared basis for both the live caret offset and the
 * selection-toolbar's start/end range lookup. */
export function markdownOffsetAt(root: HTMLElement, anchor: Node, anchorOffset: number): number {
  const fullMarkdown = markdownFromCoreHtml(root);
  if (!root.contains(anchor)) return fullMarkdown.length;

  const children = Array.from(root.children) as HTMLElement[];
  const topChild = children.find((child) => child === anchor || child.contains(anchor));
  if (!topChild) {
    // A bare text node directly under root (first keystroke in an empty note,
    // before any <p> exists): measure it like markdownFromCoreHtml does — as
    // its own trimmed line — instead of jumping to the end of the document.
    const nodes = Array.from(root.childNodes);
    const index = nodes.indexOf(anchor as ChildNode);
    if (index < 0 || anchor.nodeType !== Node.TEXT_NODE) return fullMarkdown.length;
    const bare = (node: Node) => (node.textContent ?? "").replace(ZERO_WIDTH_SPACE, "").trim();
    const before = nodes.slice(0, index).flatMap((node) => node.nodeType === Node.TEXT_NODE ? (bare(node) ? [bare(node)] : []) : node instanceof HTMLElement ? linesForElement(node) : []);
    const raw = (anchor.textContent ?? "").replace(ZERO_WIDTH_SPACE, "");
    const lead = raw.length - raw.trimStart().length;
    return (before.length ? before.join("\n").length + 1 : 0) + Math.min(Math.max(0, anchorOffset - lead), bare(anchor).length);
  }

  // Every node before the block, bare text included: the first line typed into
  // an empty note is a bare text node, and skipping it put the caret a whole
  // line too early, so "/" and "# " were never seen on line 2+ (E2/E3).
  const rootNodes = Array.from(root.childNodes);
  const linesBefore = rootNodes.slice(0, rootNodes.indexOf(topChild)).flatMap(linesOfRootChild);
  let offset = linesBefore.length ? linesBefore.join("\n").length + 1 : 0;

  const tag = topChild.tagName.toLowerCase();
  if (tag === "ul" || tag === "ol") {
    const items = Array.from(topChild.children) as HTMLElement[];
    const li = items.find((item) => item === anchor || item.contains(anchor));
    const liIndex = li ? items.indexOf(li) : 0;
    const ordered = tag === "ol";
    const startAt = ordered ? listStartAt(topChild) : 1;
    const priorLines = items.slice(0, liIndex).map((item, index) => listItemMarkdown(item, index, ordered, startAt));
    offset += priorLines.length ? priorLines.join("\n").length + 1 : 0;
    if (li) {
      const task = li.dataset.task === "true";
      const checked = li.dataset.checked === "true";
      offset += listItemPrefix(liIndex, ordered, task, checked, startAt, listIndent(li)).length + markdownOffsetWithin(li, anchor, anchorOffset);
    }
    return offset;
  }
  if (tag === "h1" || tag === "h2" || tag === "h3") {
    offset += Number(tag.slice(1)) + 1 + markdownOffsetWithin(topChild, anchor, anchorOffset);
    return offset;
  }
  if (tag === "blockquote") {
    offset += 2 + markdownOffsetWithin(topChild, anchor, anchorOffset);
    return offset;
  }
  if (tag === "table") {
    const entry = tableCellOffsets(topChild).find(({ cell }) => cell === anchor || cell.contains(anchor));
    return entry ? offset + entry.start + Math.min(entry.length, markdownOffsetWithin(entry.cell, anchor, anchorOffset)) : offset;
  }
  if (tag === "pre" && topChild.querySelector("code")) {
    // The "```lang" line is in the Markdown but not on screen (E9).
    offset += codeFenceLength(topChild) + markdownOffsetWithin(topChild, anchor, anchorOffset);
    return offset;
  }
  offset += markdownOffsetWithin(topChild, anchor, anchorOffset);
  return offset;
}

/** Caret offset expressed as an index into the Markdown string produced by
 * `markdownFromCoreHtml`, not the rendered DOM text — the two diverge by the
 * length of any `#`/`- `/`&gt; ` prefix, which corrupts slash-command
 * detection on any line after a heading, list item or quote. */
export function editorCaretOffset(root: HTMLElement) {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  if (!selection?.rangeCount || !anchor) return markdownFromCoreHtml(root).length;
  return markdownOffsetAt(root, anchor, selection.anchorOffset);
}

function setCaretInElementText(element: HTMLElement, localTextOffset: number) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = localTextOffset;
  let node = walker.nextNode();
  let last: Text | null = null;
  while (node) {
    const text = node as Text;
    last = text;
    if (remaining <= text.length) {
      placeSelection(text, Math.max(0, remaining));
      return;
    }
    remaining -= text.length;
    node = walker.nextNode();
  }
  if (last) { placeSelection(last, last.length); return; }
  // No text node at all — an empty block a slash command just inserted
  // ("# " renders as <h1></h1>). Focusing the element does nothing (a heading
  // is not focusable) and the caret silently fell back to the start of the
  // note, so the user's next keystroke landed outside the new block.
  //
  // Offset 0 is wrong for a task item: its first child is the checkbox
  // widget, so the caret landed *inside the box* and the typing went in
  // there instead of next to it. Start at the first child that is real
  // content.
  const children = Array.from(element.childNodes);
  const firstEditable = children.findIndex((node) => !(node instanceof HTMLElement && node.classList.contains("core-md-task-box")));
  placeSelection(element, firstEditable < 0 ? children.length : firstEditable);
}

/**
 * Mark the code block holding the caret as `.is-editing`. A rendered block
 * (diagram, query) shows its source only while it has this class. It used to
 * be `:focus-within`, which never matched: focus sits on the contenteditable
 * root, an ancestor of the <pre>, never inside it.
 */
/** E14B-ISOLATE (Hive #2): events and selection inside a plugin-rendered block
 * (a live table grid) belong to the plugin, not to the note editor. */
function insidePluginRender(target: EventTarget | Node | null | undefined): boolean {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return Boolean(element?.closest(".core-code-render"));
}

function syncEditingCodeBlock(root: HTMLElement | null) {
  if (!root) return;
  // Focus gone (sidebar, another pane): collapse even though the selection
  // still sits inside the block — otherwise a diagram stays open forever.
  // E14B-ISOLATE: working inside a rendered block is not editing its source.
  const rawAnchor = root.contains(document.activeElement) && !insidePluginRender(document.activeElement) ? window.getSelection()?.anchorNode ?? null : null;
  const anchor = insidePluginRender(rawAnchor) ? null : rawAnchor;
  const active = anchor && root.contains(anchor) ? (anchor instanceof Element ? anchor : anchor.parentElement)?.closest("pre.core-code-block") : null;
  for (const pre of root.querySelectorAll("pre.core-code-block.is-editing")) if (pre !== active) pre.classList.remove("is-editing");
  active?.classList.add("is-editing");
  // Same for a `[text](url)` link and a `[[link]]`: the raw Markdown shows
  // only while the caret is inside it.
  const link = anchor && root.contains(anchor) ? (anchor instanceof Element ? anchor : anchor.parentElement)?.closest(".core-md-link, .core-md-wikilink") : null;
  for (const open of root.querySelectorAll(".core-md-link.is-editing, .core-md-wikilink.is-editing")) if (open !== link) open.classList.remove("is-editing");
  link?.classList.add("is-editing");
}

/** Each closed `[[link]]` shows a label instead of its raw text while the
 * caret is outside it: the target's current title (so a rename shows up
 * without rewriting any note, E22), or the alias of `[[target|alias]]`, without
 * brackets (E8). The raw text stays in the DOM, so caret math and saving never
 * see the label. */
function labelWikilinks(root: HTMLElement | null, resolve?: (target: string) => string | null) {
  if (!root) return;
  for (const link of Array.from(root.querySelectorAll<HTMLElement>(".core-md-wikilink"))) {
    const raw = link.textContent ?? "";
    if (!raw.startsWith("[[") || !raw.endsWith("]]")) { delete link.dataset.currentTitle; continue; }
    const inner = raw.slice(2, -2);
    const pipe = inner.indexOf("|");
    const target = link.dataset.coreWikilink ?? inner;
    const resolved = resolve?.(target) ?? null;
    // Read the size before the label zeroes the raw text's font size.
    if (!link.style.getPropertyValue("--core-wl-size")) link.style.setProperty("--core-wl-size", getComputedStyle(link).fontSize);
    link.dataset.currentTitle = pipe >= 0 ? inner.slice(pipe + 1).trim() : (resolved ?? inner.trim());
    link.classList.toggle("is-missing", resolve !== undefined && resolved === null);
  }
}

/** Caret at the end of a code block's last real line — not after a trailing
 * "\n", where it would sit on the blank line the next Enter leaves from. */
function placeCaretAtCodeEnd(code: HTMLElement) {
  const last = code.lastChild;
  if (last instanceof Text && last.data.endsWith("\n")) placeSelection(last, last.data.length - 1);
  else placeSelection(code, code.childNodes.length);
}

/** Enter in a checklist: the browser clones the <li> (data-task and all) but
 * not its box, so the new item looked like a bullet until reopened (E4). Give
 * every boxless task item a fresh, unchecked box. */
function addMissingTaskBoxes(root: HTMLElement) {
  for (const li of Array.from(root.querySelectorAll<HTMLElement>("li[data-task='true']"))) {
    if (li.querySelector(":scope > .core-md-task-box")) continue;
    li.dataset.checked = "false";
    const box = document.createElement("span");
    box.className = "core-md-task-box";
    box.contentEditable = "false";
    if ((li.textContent ?? "").replace(ZERO_WIDTH_SPACE, "").trim()) {
      li.prepend(box);
      continue;
    }
    // Empty new item: the caret sits at (li, 0), which would end up before the box.
    const hadCaret = li.contains(window.getSelection()?.anchorNode ?? null);
    const text = document.createTextNode(String.fromCharCode(0x200b));
    li.replaceChildren(box, text);
    if (hadCaret) placeSelection(text, 1);
  }
}

function placeSelection(node: Node, offset: number) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Inverse of `markdownOffsetWithin`: place the caret at a Markdown-space
 * offset inside one element's content, stepping over mark delimiters
 * instead of counting them as real DOM text. Falls back to the element's
 * very end if the target offset is out of range. */
function placeCaretAtMarkdownOffsetWithinElement(element: HTMLElement, targetOffset: number) {
  let remaining = targetOffset;
  function visit(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent ?? "";
      const length = raw.replace(ZERO_WIDTH_SPACE, "").length;
      if (remaining <= length) {
        // `remaining` counts visible characters; the node may hold zero-width
        // markers that do not. Walk the raw string to the same visible offset,
        // then step past any marker sitting exactly there — a caret *before* a
        // marker that follows a contenteditable="false" widget gets normalised
        // to the wrong side of the widget, which is how text ended up left of
        // a task checkbox instead of after it.
        let rawOffset = 0;
        let seen = 0;
        while (rawOffset < raw.length && seen < Math.max(0, remaining)) {
          if (raw.charCodeAt(rawOffset) !== 0x200b) seen += 1;
          rawOffset += 1;
        }
        while (rawOffset < raw.length && raw.charCodeAt(rawOffset) === 0x200b) rawOffset += 1;
        placeSelection(node, rawOffset);
        return true;
      }
      remaining -= length;
      return false;
    }
    if (!(node instanceof HTMLElement)) return false;
    if (node.classList.contains("core-md-task-box") || node.classList.contains("core-code-toolbar") || node.classList.contains("core-code-render") || node.classList.contains("core-md-block-label")) return false;
    if (node.tagName.toLowerCase() === "br") { if (remaining < 1) return false; remaining -= 1; return false; }
    if (node.tagName.toLowerCase() === "img") {
      const length = inlineMarkdownOf(node).length;
      if (remaining <= length) {
        // `remaining === length` is the offset just PAST the image markdown,
        // which is where a paste leaves the caret. Landing before the image
        // there put the caret at the picture's left edge and the user's next
        // sentence above it, so the two ends are distinguished.
        const index = Array.from(node.parentNode?.childNodes ?? []).indexOf(node);
        placeSelection(node.parentNode as Node, remaining >= length ? index + 1 : index);
        return true;
      }
      remaining -= length;
      return false;
    }
    const delimiter = MARK_DELIMITERS[node.tagName.toLowerCase()] ?? "";
    if (delimiter) {
      const opening = markdownOpenOf(node);
      if (remaining < opening.length) { placeSelection(node, 0); return true; }
      remaining -= opening.length;
    }
    for (const child of Array.from(node.childNodes)) {
      if (visit(child)) return true;
    }
    if (delimiter) {
      if (remaining < delimiter.length) { placeSelection(node, node.childNodes.length); return true; }
      remaining -= delimiter.length;
    }
    return false;
  }
  if (!visit(element)) setCaretInElementText(element, Number.MAX_SAFE_INTEGER);
}

/** Inverse of `editorCaretOffset`: place the DOM caret at the position
 * corresponding to an offset into the reconstructed Markdown string, so the
 * cursor lands where a slash command actually inserted text instead of
 * defaulting to the start of the note. */
export function placeCaretAtMarkdownOffset(root: HTMLElement | null, markdownOffset: number) {
  if (!root) return;
  root.focus();
  const children = Array.from(root.children) as HTMLElement[];
  let remaining = markdownOffset;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const lines = linesForElement(child);
    const blockText = lines.join("\n");
    const isLast = index === children.length - 1;
    if (remaining <= blockText.length || isLast) {
      const tag = child.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        const items = Array.from(child.children) as HTMLElement[];
        const ordered = tag === "ol";
        const startAt = ordered ? listStartAt(child) : 1;
        let liRemaining = remaining;
        for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
          const liLine = listItemMarkdown(items[itemIndex], itemIndex, ordered, startAt);
          const isLastItem = itemIndex === items.length - 1;
          if (liRemaining <= liLine.length || isLastItem) {
            const item = items[itemIndex];
            const prefixLen = listItemPrefix(itemIndex, ordered, item.dataset.task === "true", item.dataset.checked === "true", startAt, listIndent(item)).length;
            placeCaretAtMarkdownOffsetWithinElement(item, liRemaining - prefixLen);
            return;
          }
          liRemaining -= liLine.length + 1;
        }
        return;
      }
      if (tag === "table") {
        // The last cell that starts at or before the offset holds the caret.
        const entry = tableCellOffsets(child).filter(({ start }) => start <= remaining).pop();
        if (!entry) { placeSelection(child, 0); return; }
        if (entry.cell.textContent) placeCaretAtMarkdownOffsetWithinElement(entry.cell, Math.min(entry.length, remaining - entry.start));
        else placeSelection(entry.cell, 0);
        return;
      }
      // A code block's "```lang" line is in the Markdown but not on screen (E9).
      const code = tag === "pre" ? child.querySelector<HTMLElement>("code") : null;
      if (code) {
        placeCaretAtMarkdownOffsetWithinElement(code, Math.max(0, remaining - codeFenceLength(child)));
        return;
      }
      const prefixLen = tag === "h1" || tag === "h2" || tag === "h3" ? Number(tag.slice(1)) + 1 : tag === "blockquote" ? 2 : 0;
      placeCaretAtMarkdownOffsetWithinElement(child, remaining - prefixLen);
      return;
    }
    remaining -= blockText.length + 1;
  }
  setCaretInElementText(root, 0);
}


/** The text of the quote line the caret sits on — a <blockquote> holds all of
 * its lines in one element, separated by <br>, so "is this line empty" cannot
 * be answered from `textContent`. */
function quoteLineIsEmpty(quote: HTMLElement, range: Range): boolean {
  const walker = document.createTreeWalker(quote, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let line = "";
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as HTMLElement).tagName.toLowerCase() === "br") line = "";
    } else {
      const isCaretNode = node === range.startContainer;
      const text = node.textContent ?? "";
      line += isCaretNode ? text.slice(0, range.startOffset) : text;
      if (isCaretNode) break;
    }
    node = walker.nextNode();
  }
  return line.replace(ZERO_WIDTH_SPACE, "").trim() === "";
}

/** Is the caret on a blank trailing line at the very end of a code block's
 * text, with nothing after it? Unlike quoteLineIsEmpty, "the current line"
 * only matters at the end here — a blank line typed in the *middle* of some
 * code is plausibly deliberate spacing, not a request to leave. */
function codeBlockIsAtEmptyTrailingLine(pre: HTMLElement, range: Range): boolean {
  const code = pre.querySelector("code");
  if (!code) return false;
  const full = code.textContent ?? "";
  const upToCaret = document.createRange();
  upToCaret.selectNodeContents(code);
  upToCaret.setEnd(range.startContainer, range.startOffset);
  const before = upToCaret.toString();
  // One "\n" may follow the caret: Enter at the very end writes two, so the
  // blank line stays drawable (see the Enter handler).
  const after = full.slice(before.length);
  if (after !== "" && after !== "\n") return false;
  const lastLine = before.slice(before.lastIndexOf("\n") + 1);
  return lastLine.trim() === "";
}

/** Blocks Enter should be able to escape from. Without this the browser just
 * splits the block: a second quote line, forever, with no way back to normal
 * text. Every editor exits on an empty line instead. */
function blockToExitOnEnter(root: HTMLElement, range: Range): HTMLElement | null {
  const start = range.startContainer;
  const element = start.nodeType === Node.ELEMENT_NODE ? start as HTMLElement : start.parentElement;
  if (!element || !root.contains(element)) return null;
  const item = element.closest("li");
  if (item && root.contains(item) && (item.textContent ?? "").replace(ZERO_WIDTH_SPACE, "").trim() === "") return item;
  const quote = element.closest("blockquote");
  if (quote && root.contains(quote) && quoteLineIsEmpty(quote, range)) return quote;
  const pre = element.closest<HTMLElement>("pre.core-code-block");
  if (pre && root.contains(pre) && codeBlockIsAtEmptyTrailingLine(pre, range)) return pre;
  return null;
}

interface CoreMarkdownEditorProps {
  value: string;
  readOnly?: boolean;
  placeholder?: string;
  ariaLabel: string;
  onWikilinkClick?: (target: string) => void;
  /** Current title of a `[[target]]`, or null when nothing matches (E22). */
  wikilinkTitle?: (target: string) => string | null;
  onChange: (value: string, caret: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onBlur: () => void;
  /** A short message for the app notice bar (a refused code format, Hive #35). */
  onNotice?: (message: string) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  /** Default true. When false, a leading "- " / "1. " is NOT auto-converted
   * into a list (a registered prose profile can turn this off so dialogue
   * dashes survive). Nothing else about the Markdown dialect changes. */
  dashList?: boolean;
  /** Long-form writing mode: narrow prose measure, caret line kept centred,
   * every block but the active one dimmed. Set by a prose profile; the
   * toolbar toggle in CoreOnlyApp flips it per reader. */
  focusMode?: boolean;
  /** Faint unnumbered rule where a printed A4 page would end (prose profile). */
  pageBreaks?: boolean;
  /** Called after each re-render with the editor root, for decoration that is
   * not part of the document — currently plugin code-block renderers. Must be
   * referentially stable or the editor re-decorates on every parent render. */
  decorate?: (root: HTMLElement, editor: CodeBlockEditorBridge) => void;
  /** Bump to re-run `decorate` without rebuilding the HTML.
   *
   * Needed because the effect below only redecorates when `value` actually
   * changed, which is right for the caret but means a decoration can never
   * follow anything else: a block the user just typed would not render until
   * the note was reopened, and a rendered query table would show stale data
   * for as long as the note stayed open. */
  decorateNonce?: number;
  /** Bump to force a full HTML rebuild from `value` on the next render, even
   * if `value` looks unchanged from `lastValue.current`'s point of view.
   *
   * A slash-command insertion (or any other programmatic edit that writes
   * `value` from outside a keystroke) is supposed to already trigger the
   * rebuild below through the ordinary `lastValue.current !== value` check.
   * This nonce is a deliberate second, independent trigger for exactly that
   * case — belt-and-suspenders against the DOM ever silently falling out of
   * sync with a `value` that is itself correct (confirmed by exporting the
   * note as Markdown): whatever the precise cause, forcing a rebuild here
   * costs one extra `innerHTML` write and closes the whole class of bug. */
  forceRebuildNonce?: number;
}

/** Table row/column edits (8): markdown pipe-tables always require a header
 * row and uniform column count across rows, so these mutate the DOM table
 * in place rather than going through a richer model — merge/split and a
 * header *column* aren't representable in plain markdown and are out of
 * scope on purpose (see PLAN_0.32.0.md (internal, not published) item 8). */
function insertTableRow(referenceRow: HTMLTableRowElement, position: "before" | "after") {
  const table = referenceRow.closest("table");
  const colCount = table?.rows[0]?.cells.length ?? referenceRow.cells.length;
  const tr = document.createElement("tr");
  for (let i = 0; i < colCount; i += 1) tr.appendChild(document.createElement("td"));
  referenceRow.parentElement?.insertBefore(tr, position === "before" ? referenceRow : referenceRow.nextSibling);
}

function deleteTableRow(row: HTMLTableRowElement) {
  const table = row.closest("table");
  if (!table || table.rows.length <= 2) return; // keep the header row + at least one body row
  row.remove();
}

function insertTableColumn(table: HTMLTableElement, colIndex: number, position: "before" | "after") {
  Array.from(table.rows).forEach((row, rowIndex) => {
    const cell = document.createElement(rowIndex === 0 ? "th" : "td");
    const reference = row.cells[colIndex] ?? null;
    row.insertBefore(cell, position === "before" ? reference : reference?.nextSibling ?? null);
  });
}

function deleteTableColumn(table: HTMLTableElement, colIndex: number) {
  if ((table.rows[0]?.cells.length ?? 0) <= 1) return;
  Array.from(table.rows).forEach((row) => { row.cells[colIndex]?.remove(); });
}

/**
 * What this element opens with in Markdown.
 *
 * A coloured highlight is `==green:text==`, so its opening run is longer than
 * the delimiter alone. The caret walkers below count Markdown characters to
 * find a DOM position, and a pen they did not count puts the caret six
 * characters off for the rest of the line.
 */
function markdownOpenOf(node: HTMLElement): string {
  return markdownOpenFor(node.tagName, node.dataset.highlight);
}

/** Characters (with spaces) per printed A4 page for the page rule: ~3300 is a
 *  full page of 12pt body text in a word processor. */
const PAGE_CHARS = 3300;
const FOOTNOTE_BUTTON ={ label: tr("Insert footnote (Ctrl+Alt+F)"), symbol: "¹" };
const MARK_BUTTONS: { kind: InlineMarkKind; label: string; symbol: string }[] = [
  { kind: "bold", label: tr("Bold"), symbol: "B" },
  { kind: "italic", label: tr("Italic"), symbol: "I" },
  { kind: "underline", label: tr("Underline"), symbol: "U" },
  { kind: "strike", label: tr("Strikethrough"), symbol: "S" },
  { kind: "highlight", label: tr("Highlight"), symbol: "H" },
];

export const CoreMarkdownEditor = forwardRef<HTMLDivElement, CoreMarkdownEditorProps>(function CoreMarkdownEditor({ value, readOnly = false, placeholder, ariaLabel, onWikilinkClick, wikilinkTitle, onChange, onKeyDown, onBlur, onNotice, onScroll, dashList = true, focusMode = false, pageBreaks = false, decorate, decorateNonce, forceRebuildNonce }, ref) {
  const { t } = useCoreI18n();
  // Without this, the browser's own Enter handling starts a bare <div> (or,
  // inside a heading, another heading) that matches nothing in editor.css —
  // only <p> gets the 12px margin/line-height renderCoreMarkdown gives every
  // paragraph. Typed text then sits tight until some other edit forces a
  // full rebuild from Markdown, at which point the same lines suddenly gain
  // real paragraph spacing: the "interlinia" jump. Asking the browser to use
  // <p> from the start keeps live typing visually identical to a rebuild.
  useEffect(() => { document.execCommand("defaultParagraphSeparator", false, "p"); }, []);
  const internalRef = useRef<HTMLDivElement | null>(null);
  const lastValue = useRef(value);
  /** Pasting a screenshot writes to the DOM outside the browser's own editing
   * commands (it has to: the file is saved to disk asynchronously first), so
   * the native undo stack never learns about it and Ctrl+Z appeared to do
   * nothing. Remember the document as it was just before the paste and serve
   * that one press ourselves. Any other edit clears it, so undo after typing
   * still means "undo my typing", not "delete the picture". */
  const pasteUndo = useRef<{ value: string; caret: number } | null>(null);
  /** General Ctrl+Z/Ctrl+Y undo/redo, independent of the browser's native
   * contentEditable undo manager — several edits below (paste, table cell
   * edits, mark toggles) replace `innerHTML` wholesale, which silently wipes
   * that native stack, so native undo alone stopped covering anything past
   * the first paste in a session. Values only (no per-edit caret): undo just
   * clamps the caret it already has to the restored text's length, which
   * reads fine and avoids threading pre-edit caret capture through every
   * branch below. Plain typing is coalesced into bursts (undoBurstStart +
   * a debounce) so undo doesn't need one step per keystroke; anything else
   * (paste, mark toggle, table edit) is pushed immediately. */
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const undoBurstStart = useRef<string | null>(null);
  const undoBurstTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function pushUndoValue(previous: string) {
    if (undoStack.current[undoStack.current.length - 1] === previous) return;
    undoStack.current.push(previous);
    if (undoStack.current.length > 200) undoStack.current.shift();
  }
  function flushUndoBurst() {
    clearTimeout(undoBurstTimer.current);
    if (undoBurstStart.current !== null) {
      pushUndoValue(undoBurstStart.current);
      undoBurstStart.current = null;
    }
  }
  /** Continuous typing: remember where the current burst of keystrokes
   * started, extend the "still typing" window on every one, and only land
   * it on the undo stack once typing pauses — a full history of every
   * character would make Ctrl+Z crawl backwards one letter at a time. */
  function noteTypingEdit() {
    if (undoBurstStart.current === null) undoBurstStart.current = lastValue.current;
    redoStack.current = [];
    clearTimeout(undoBurstTimer.current);
    undoBurstTimer.current = setTimeout(flushUndoBurst, 700);
  }
  /** A single non-typing edit (paste, mark toggle, table cell change): one
   * undo step, pushed right away. */
  function commitDiscreteEdit() {
    flushUndoBurst();
    pushUndoValue(lastValue.current);
    redoStack.current = [];
  }
  // Esc right before Tab lets Tab leave the editor, so a keyboard user is
  // never stuck in it now that Tab indents.
  const escapedBeforeTab = useRef(false);
  // Ctrl+A was the last thing done: the whole note is selected. What replaces
  // it (paste, a typed key, Delete, cut) is done on the Markdown text, because
  // the browser's own deletion keeps the first block's shell — the new text
  // then landed inside a code block or a quote. Any click or other key ends it.
  const selectAllActive = useRef(false);
  function replaceWholeNote(markdown: string) {
    const root = internalRef.current;
    if (!root) return;
    commitDiscreteEdit();
    // Leave lastValue stale so the value effect rebuilds the note.
    onChange(markdown, markdown.length);
    requestAnimationFrame(() => placeCaretAtMarkdownOffset(root, markdown.length));
  }
  /** Tab / Shift+Tab inside the note: next/previous cell in a table, indent or
   * outdent in a code block (two spaces — YAML, e.g. a diagram's `config:`
   * header, forbids tab characters), a tab character in ordinary text. */
  function handleTab(back: boolean) {
    const root = internalRef.current;
    const selection = window.getSelection();
    if (!root || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const start = range.startContainer;
    const element = start instanceof Element ? start : start.parentElement;
    const cell = element?.closest<HTMLTableCellElement>("td, th");
    if (cell && root.contains(cell)) {
      const cells = Array.from(cell.closest("table")?.querySelectorAll<HTMLTableCellElement>("th, td") ?? []);
      const target = cells[cells.indexOf(cell) + (back ? -1 : 1)];
      // Tab in the last cell adds a row, like a spreadsheet; it used to do
      // nothing, so the next word was glued onto that cell (E20).
      const row = cell.closest("tr");
      if (!target && !back && row) {
        insertTableRow(row, "after");
        syncAfterTableEdit();
        const first = row.nextElementSibling?.querySelector("td, th");
        if (first) placeSelection(first, 0);
        return;
      }
      if (!target) return;
      // The whole cell selected, spreadsheet-style: typing replaces it.
      const next = document.createRange();
      next.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(next);
      return;
    }
    // Tab in a bullet or checklist nests it one level under the item above,
    // Shift+Tab takes it back out (E5). It used to insert a tab character.
    // Numbered lists keep the old behaviour: their numbers are per list.
    const item = element?.closest<HTMLElement>("li");
    const list = item?.parentElement;
    if (item && list?.tagName === "UL" && root.contains(item)) {
      const siblings = Array.from(list.children) as HTMLElement[];
      const index = siblings.indexOf(item);
      const current = listIndent(item);
      const deepest = index > 0 ? listIndent(siblings[index - 1]) + 1 : 0;
      const level = back ? Math.max(0, current - 1) : Math.min(deepest, MAX_LIST_INDENT, current + 1);
      if (level !== current) {
        commitDiscreteEdit();
        if (level) item.dataset.indent = String(level);
        else delete item.dataset.indent;
        const markdown = markdownFromCoreHtml(root);
        lastValue.current = markdown;
        onChange(markdown, editorCaretOffset(root));
      }
      return;
    }
    const pre = element?.closest<HTMLElement>("pre.core-code-block");
    const code = pre?.querySelector("code");
    if (pre && code && root.contains(pre)) {
      const offsetIn = (node: Node, offset: number) => { const r = document.createRange(); r.selectNodeContents(code); r.setEnd(node, offset); return r.toString().length; };
      const text = code.textContent ?? "";
      const from = offsetIn(range.startContainer, range.startOffset);
      const to = offsetIn(range.endContainer, range.endOffset);
      let next = text, selStart = from, selEnd = to;
      if (range.collapsed && !back) {
        next = `${text.slice(0, from)}  ${text.slice(from)}`;
        selStart = selEnd = from + 2;
      } else {
        // Every line the selection touches, like a code editor.
        const lineStart = text.lastIndexOf("\n", from - 1) + 1;
        const lines = text.slice(lineStart, to).split("\n");
        let shiftFirst = 0, shiftAll = 0;
        const changed = lines.map((line, index) => {
          const cut = back ? (line.match(/^( {1,2}|\t)/u)?.[0].length ?? 0) : -2;
          if (index === 0) shiftFirst = -cut;
          shiftAll -= cut;
          return back ? line.slice(cut) : `  ${line}`;
        });
        next = text.slice(0, lineStart) + changed.join("\n") + text.slice(to);
        selStart = Math.max(lineStart, from + shiftFirst);
        selEnd = Math.max(selStart, to + shiftAll);
      }
      if (next === text) return;
      noteTypingEdit();
      code.textContent = next;
      const node = code.firstChild ?? code.appendChild(document.createTextNode(""));
      const placed = document.createRange();
      placed.setStart(node, Math.min(selStart, next.length));
      placed.setEnd(node, Math.min(selEnd, next.length));
      selection.removeAllRanges();
      selection.addRange(placed);
    } else if (!back) {
      // Chromium wraps the tab in a white-space:pre span so it shows as a gap;
      // after a re-render inlineHtml draws it the same way (.core-md-tab).
      noteTypingEdit();
      document.execCommand("insertText", false, "\t");
      return; // onInput reports the change
    } else return;
    const markdown = markdownFromCoreHtml(root);
    lastValue.current = markdown;
    onChange(markdown, editorCaretOffset(root));
  }
  const [toolbarPosition, setToolbarPosition] = useState<{ top: number; left: number } | null>(null);
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number; cell: HTMLTableCellElement } | null>(null);
  // Right-click on a rendered code block (diagram, query). Shares the table
  // menu's ref and styling; only one of the two is ever open.
  // `opener` is the toolbar's Format button (Hive #43): that menu shows only
  // the format tools, sits under the button, and Esc gives focus back to it.
  const [codeMenu, setCodeMenu] = useState<{ x?: number; right?: number; y?: number; bottom?: number; maxHeight: number; pre: HTMLElement; opener?: HTMLElement } | null>(null);
  const [langMenu, setLangMenu] = useState<{ x: number; y?: number; bottom?: number; maxHeight: number; pre: HTMLElement } | null>(null);
  const tableMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const opener = codeMenu?.opener;
    if (!opener) return;
    opener.setAttribute("aria-expanded", "true");
    tableMenuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
    return () => opener.setAttribute("aria-expanded", "false");
  }, [codeMenu]);

  useEffect(() => {
    if (!tableMenu && !codeMenu && !langMenu) return;
    const close = () => { setTableMenu(null); setCodeMenu(null); setLangMenu(null); };
    const closeWhenOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      // A press on the Format button itself is its click's to handle (toggle).
      if (target && !tableMenuRef.current?.contains(target) && !codeMenu?.opener?.contains(target)) close();
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", closeWhenOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeWhenOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [tableMenu, codeMenu, langMenu]);

  /** Reveal a rendered block's collapsed source by putting the caret at its
   * end. False when the block isn't rendered, so the caller can fall through. */
  function openRenderedCodeBlock(pre: HTMLElement | null): boolean {
    const code = pre?.querySelector("code");
    if (!pre || !code || !pre.querySelector(":scope > .core-code-render.nq-ready")) return false;
    internalRef.current?.focus({ preventScroll: true });
    placeCaretAtCodeEnd(code);
    syncEditingCodeBlock(internalRef.current);
    return true;
  }

  /** A code block (usually a drawn diagram) as the note's last block leaves
   * nowhere below it for the caret: a click under it or Ctrl+End lands in its
   * collapsed source, and typing silently edits the diagram. Give the caret a
   * paragraph to go to. A zero-width space for the same reason as the Enter
   * exit; no onChange — it is an empty line until something is typed in it. */
  function paragraphAfterTrailingCodeBlock(): boolean {
    const root = internalRef.current;
    const last = root?.lastElementChild;
    // Same for every block that has no text of its own to end in: a table
    // (the caret jumped to the top of the note), a divider, a Columns block,
    // a picture.
    if (!root || readOnly || !(last instanceof HTMLElement) || !last.matches(TRAILING_BLOCKS)) return false;
    const paragraph = document.createElement("p");
    paragraph.appendChild(document.createTextNode(String.fromCharCode(0x200b)));
    last.after(paragraph);
    placeSelection(paragraph.firstChild as Node, 1);
    syncEditingCodeBlock(root);
    return true;
  }

  function syncAfterTableEdit() {
    const root = internalRef.current;
    if (!root) return;
    commitDiscreteEdit();
    const next = markdownFromCoreHtml(root);
    lastValue.current = next;
    onChange(next, editorCaretOffset(root));
    setTableMenu(null);
  }
  // E14B-UPDATESOURCE (Hive #2): a persistent plugin block writes its new
  // source back. Same pattern as syncAfterTableEdit: lastValue is set before
  // onChange, so the value effect does not rebuild the HTML and the block's
  // widget keeps its DOM and focus. Caret 0: no "/" or "[[" trigger from it.
  const updateSourceRef = useRef<(pre: HTMLPreElement, next: string) => boolean>(() => false);
  updateSourceRef.current = (pre, next) => {
    const root = internalRef.current;
    const code = pre.querySelector("code");
    if (!root || readOnly || !code || !root.contains(pre)) return false;
    if (code.textContent === next) return true;
    commitDiscreteEdit();
    code.textContent = next;
    const markdown = markdownFromCoreHtml(root);
    lastValue.current = markdown;
    onChange(markdown, 0);
    return true;
  };
  const codeBlockBridge = useMemo<CodeBlockEditorBridge>(() => ({
    updateSource: (pre, next) => updateSourceRef.current(pre, next),
    readOnly,
  }), [readOnly]);
  // A note can be on screen before the media directory lookup returns, and
  // until it does every stored image reference renders as-is (broken). One
  // rebuild when it lands, and never again — `mediaDirectoryKnown` latches.
  const [mediaReady, setMediaReady] = useState(mediaDirectoryKnown);
  /**
   * One rebuild when the directory lands — ONE.
   *
   * The first version of this put `mediaReady` straight into the condition
   * below. It latches true and never goes back, so from then on the guard was
   * always true and every keystroke rebuilt the note's HTML from Markdown,
   * dropping the caret at the start of the note. The guard exists precisely
   * to stop that; a flag that is permanently true silently removes it.
   */
  const rebuiltForMedia = useRef(false);
  const lastDashList = useRef(dashList);
  useEffect(() => {
    if (mediaReady) return;
    const onReady = () => setMediaReady(true);
    window.addEventListener(MEDIA_READY_EVENT, onReady);
    return () => window.removeEventListener(MEDIA_READY_EVENT, onReady);
  }, [mediaReady]);
  // Latest resolver for the rebuild paths; relabel when the titles behind it change.
  const wikilinkTitleRef = useRef(wikilinkTitle);
  wikilinkTitleRef.current = wikilinkTitle;
  useEffect(() => { labelWikilinks(internalRef.current, wikilinkTitle); }, [wikilinkTitle]);
  const lastForceRebuildNonce = useRef(forceRebuildNonce);
  useEffect(() => {
    if (!internalRef.current) return;
    const mediaArrived = mediaReady && !rebuiltForMedia.current;
    if (mediaArrived) rebuiltForMedia.current = true;
    const forced = forceRebuildNonce !== undefined && forceRebuildNonce !== lastForceRebuildNonce.current;
    if (forced) lastForceRebuildNonce.current = forceRebuildNonce;
    // `dashList` flips from its default once a scene's prose profile resolves,
    // often a tick after mount with `value` unchanged — rebuild then too, or a
    // reopened scene keeps showing dialogue dashes as bullets.
    const dashListChanged = lastDashList.current !== dashList;
    if (dashListChanged) lastDashList.current = dashList;
    if (lastValue.current !== value || internalRef.current.innerHTML === "" || mediaArrived || forced || dashListChanged) {
      // A rebuild replaces innerHTML and collapses any selection to the top of
      // the editor. If the caret was in here (e.g. the deferred media-ready
      // rebuild after pasting a screenshot), remember where and put it back —
      // otherwise the next ArrowDown starts from line 1, not from the picture.
      const hadFocus = internalRef.current.contains(document.activeElement);
      const caretBefore = hadFocus ? editorCaretOffset(internalRef.current) : null;
      internalRef.current.innerHTML = renderCoreMarkdown(value, { dashList });
      lastValue.current = value;
      // Runs after the HTML is in place and only after a real re-render, so a
      // decorator never fights the caret while the user types. Whatever it adds
      // is invisible to markdownFromCoreHtml, which reads a code block from its
      // <code> element alone — decoration cannot change what gets saved.
      decorate?.(internalRef.current, codeBlockBridge);
      labelWikilinks(internalRef.current, wikilinkTitleRef.current);
      if (caretBefore !== null) placeCaretAtMarkdownOffset(internalRef.current, caretBefore);
      // Synchronously, so an open block doesn't collapse for a frame on rebuild.
      syncEditingCodeBlock(internalRef.current);
    }
  }, [value, decorate, mediaReady, forceRebuildNonce, dashList]);

  useEffect(() => {
    const sync = () => syncEditingCodeBlock(internalRef.current);
    document.addEventListener("selectionchange", sync);
    const root = internalRef.current;
    // focusout fires before activeElement moves; re-check on the next frame.
    const syncLater = () => requestAnimationFrame(sync);
    root?.addEventListener("focusout", syncLater);
    root?.addEventListener("focusin", sync);
    // The caret at the very end of a link (after its `)`) is still inside the
    // link's hidden `](url)` span, so typing there would vanish from view the
    // moment the link collapses. Step it out just before the text goes in.
    const typeAfterLink = (event: InputEvent) => {
      if (!root || !event.inputType.startsWith("insert") || insidePluginRender(event.target)) return; // E14B-ISOLATE
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      if (!selection?.isCollapsed || !anchor) return;
      // [[wikilinks]] too: text typed after a picked link went inside its span,
      // so the rest of the sentence looked and clicked like the link (E7).
      const link = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest<HTMLElement>(".core-md-link, .core-md-wikilink");
      if (!link || !root.contains(link)) return;
      if (link.classList.contains("core-md-wikilink") && !(link.textContent ?? "").endsWith("]]")) return;
      const tail = document.createRange();
      tail.setStart(anchor, selection.anchorOffset);
      tail.setEnd(link, link.childNodes.length);
      if (tail.toString() !== "") return;
      const next = link.nextSibling;
      if (next instanceof Text) placeSelection(next, 0);
      else { const spacer = document.createTextNode(String.fromCharCode(0x200b)); link.after(spacer); placeSelection(spacer, 1); }
    };
    root?.addEventListener("beforeinput", typeAfterLink);
    return () => {
      document.removeEventListener("selectionchange", sync);
      root?.removeEventListener("focusout", syncLater);
      root?.removeEventListener("focusin", sync);
      root?.removeEventListener("beforeinput", typeAfterLink);
    };
  }, []);

  /** Re-render the whole note from its current text and put the caret back —
   * what the value effect does, for an edit that changes how the text is
   * drawn but not the text itself (so `value` never changes to trigger it). */
  function rebuildKeepingCaret() {
    const root = internalRef.current;
    if (!root) return;
    const markdown = markdownFromCoreHtml(root);
    const caret = editorCaretOffset(root);
    root.innerHTML = renderCoreMarkdown(markdown, { dashList });
    lastValue.current = markdown;
    decorate?.(root, codeBlockBridge);
    labelWikilinks(root, wikilinkTitleRef.current);
    placeCaretAtMarkdownOffset(root, caret);
    syncEditingCodeBlock(root);
  }

  // Re-decorate on demand. The HTML is deliberately left alone: rebuilding it
  // would move the caret, which is exactly what the guard above exists to
  // avoid. Decorators dispose their previous containers before mounting, so
  // running this repeatedly is idempotent.
  useEffect(() => {
    if (!decorateNonce || !internalRef.current) return;
    decorate?.(internalRef.current, codeBlockBridge);
  }, [decorateNonce, decorate]);

  useEffect(() => {
    if (readOnly) return;
    function updateToolbar() {
      const root = internalRef.current;
      const selection = window.getSelection();
      if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0 || !root.contains(selection.anchorNode) || insidePluginRender(selection.anchorNode)) {
        setToolbarPosition(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) { setToolbarPosition(null); return; }
      // Below the selection: above it, the bar hid the line you were reading
      // (E17). Near the bottom of the window there is no room below, and the
      // bar was off-screen (round 3), so it goes above there.
      const roomBelow = window.innerHeight - rect.bottom;
      const top = roomBelow > 56 ? rect.bottom - rootRect.top + 6 : rect.top - rootRect.top - 46;
      setToolbarPosition({ top, left: Math.max(0, rect.left - rootRect.left) });
    }
    document.addEventListener("selectionchange", updateToolbar);
    return () => document.removeEventListener("selectionchange", updateToolbar);
  }, [readOnly]);

  // Long-form focus mode: keep the block holding the caret bright and
  // vertically centred, dim the rest. Pure decoration — it only toggles a
  // class and scrolls, never touches the document or the caret.
  useEffect(() => {
    const root = internalRef.current;
    if (!root) return;
    if (!focusMode) {
      root.classList.remove("is-prose-focus");
      for (const marked of root.querySelectorAll(".is-prose-focus-line")) marked.classList.remove("is-prose-focus-line");
      return;
    }
    root.classList.add("is-prose-focus");
    let raf = 0;
    const paint = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) return;
      let node: Node | null = selection.anchorNode;
      while (node && node.parentNode !== root) node = node.parentNode;
      // `node` can be a bare text node the browser hasn't wrapped in a <p>
      // yet — those have no classList, so bail rather than crash.
      if (!(node instanceof HTMLElement)) return;
      const block = node;
      if (block.classList.contains("is-prose-focus-line")) return;
      for (const marked of root.querySelectorAll(".is-prose-focus-line")) marked.classList.remove("is-prose-focus-line");
      block.classList.add("is-prose-focus-line");
      // Typewriter scroll: keep the CARET line vertically centred, not the
      // whole block — a long paragraph would otherwise drift its last lines
      // well past centre. Falls back to the block rect when the collapsed
      // range reports no geometry (empty line, just-created <p>).
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        let rect = sel.getRangeAt(0).getBoundingClientRect();
        if (!rect || (rect.top === 0 && rect.height === 0)) rect = block.getBoundingClientRect();
        const view = root.getBoundingClientRect();
        root.scrollTop += (rect.top + rect.height / 2) - (view.top + view.height / 2);
      });
    };
    paint();
    document.addEventListener("selectionchange", paint);
    return () => { document.removeEventListener("selectionchange", paint); cancelAnimationFrame(raf); };
    // Not `value`: typing moves the caret, so `selectionchange` already
    // re-paints. Re-subscribing on every keystroke only adds churn.
  }, [focusMode]);

  // A4 page rule (prose profile): one rule after every PAGE_CHARS characters,
  // drawn under the text line the last character of the page falls on. Counting
  // characters (not pixels) keeps it honest when paragraph spacing or the font
  // change; the position itself comes from the laid-out text. The rules live in
  // an overlay outside the editable root, so they never touch the document.
  const [pageRules, setPageRules] = useState<{ y: number; left: number; width: number }[]>([]);
  useEffect(() => {
    const root = internalRef.current;
    if (!root || !pageBreaks) { setPageRules([]); return; }
    let timer = 0;
    const measure = () => {
      const holder = root.offsetParent as HTMLElement | null;
      if (!holder) return;
      const base = holder.getBoundingClientRect();
      const style = getComputedStyle(root);
      const left = root.getBoundingClientRect().left - base.left + parseFloat(style.paddingLeft);
      const width = root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const rules: { y: number; left: number; width: number }[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let seen = 0;
      let next = PAGE_CHARS;
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const length = node.data.length;
        while (length > 0 && seen + length >= next) {
          const offset = Math.min(length - 1, next - seen - 1);
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const rects = range.getClientRects();
          const rect = rects[rects.length - 1];
          if (rect) rules.push({ y: rect.bottom - base.top + 3, left, width });
          next += PAGE_CHARS;
        }
        seen += length;
      }
      setPageRules(rules);
    };
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(measure, 200); };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    void document.fonts?.ready.then(schedule);
    schedule();
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, [pageBreaks, value, focusMode]);

  // Footnotes that lose their marker lose their note in the same edit, so the
  // undo step that brings the marker back brings the note back with it. The
  // removed text is kept, so a marker that comes back (cut and paste elsewhere)
  // gets its note again instead of being left pointing at nothing.
  const removedFootnotes = useRef(new Map<string, string>());
  function syncFootnotes(root: HTMLElement, previous: string) {
    const next = markdownFromCoreHtml(root);
    const blocks = () => Array.from(root.children) as HTMLElement[];
    const noteOf = (label: string) => blocks().find((block) => (block.textContent ?? "").replace(ZERO_WIDTH_SPACE, "").startsWith(`[^${label}]:`));
    for (const label of orphanedFootnotes(previous, next)) {
      const note = noteOf(label);
      if (!note) continue;
      removedFootnotes.current.set(label, (note.textContent ?? "").replace(ZERO_WIDTH_SPACE, ""));
      note.remove();
    }
    if (removedFootnotes.current.size === 0) return;
    const markers = footnoteMarkerLabels(markdownFromCoreHtml(root));
    const defined = footnoteDefinitionLabels(markdownFromCoreHtml(root));
    for (const [label, text] of removedFootnotes.current) {
      if (!markers.has(label) || defined.has(label)) continue;
      const paragraph = document.createElement("p");
      paragraph.className = "core-md-fndef";
      paragraph.textContent = text;
      root.append(paragraph);
      removedFootnotes.current.delete(label);
    }
  }

  // Insert a footnote marker after the selection/caret and open its
  // definition at the end of the note (Ctrl+Alt+F or the selection toolbar).
  function addFootnote() {
    const root = internalRef.current;
    const selection = window.getSelection();
    if (readOnly || !root || !selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);
    const at = Math.max(markdownOffsetAt(root, range.startContainer, range.startOffset), markdownOffsetAt(root, range.endContainer, range.endOffset));
    commitDiscreteEdit();
    const result = insertFootnote(lastValue.current, at);
    setToolbarPosition(null);
    onChange(result.body, result.caret);
    requestAnimationFrame(() => {
      placeCaretAtMarkdownOffset(internalRef.current, result.caret);
      internalRef.current?.querySelector<HTMLElement>(".core-md-fndef:last-of-type")?.scrollIntoView({ block: "nearest" });
    });
  }

  function applyMark(kind: InlineMarkKind, colour?: HighlightColour) {
    applyEdit((body, start, end) => toggleInlineMark(body, start, end, kind, colour));
  }

  /** Change a code block's language (E9). lastValue is left stale on purpose
   * so the note re-renders: switching to mermaid has to draw the diagram. */
  function setCodeLanguage(pre: HTMLElement, lang: string) {
    setLangMenu(null);
    const root = internalRef.current;
    if (!root || !root.contains(pre) || (pre.dataset.lang ?? "") === lang) return;
    commitDiscreteEdit();
    pre.dataset.lang = lang;
    onChange(markdownFromCoreHtml(root), editorCaretOffset(root));
  }

  /** CODE-FORMAT (Hive #35): rewrite a block's text in place, the way typing
   * does (one undo step, lastValue synced so the DOM is not rebuilt), with the
   * caret at the end of the block. A refusal is a notice and no change. */
  function formatCodeBlock(pre: HTMLElement, action: CodeFormatAction) {
    setCodeMenu(null);
    const root = internalRef.current;
    const code = pre.querySelector("code");
    if (!root || readOnly || !code || !root.contains(pre)) return;
    const before = (code.textContent ?? "").replace(ZERO_WIDTH_SPACE, "");
    const result = formatCode(action, before);
    if ("error" in result) { onNotice?.(t(result.error, result.values)); return; }
    if (result.text === before) return;
    commitDiscreteEdit();
    code.textContent = result.text || String.fromCharCode(0x200b);
    root.focus({ preventScroll: true });
    placeCaretAtCodeEnd(code);
    const markdown = markdownFromCoreHtml(root);
    // A drawn block (diagram) must redraw from its new source: leave lastValue
    // stale so the value effect re-renders, as setCodeLanguage does.
    if (!pre.querySelector(":scope > .core-code-render")) lastValue.current = markdown;
    onChange(markdown, editorCaretOffset(root));
  }

  /** CODE-FORMAT (Hive #43): the Format button's menu, right-aligned under the
   * button, above it when only that fits, else moved up until it all shows
   * (as the right-click menu does). A second click closes it. */
  function toggleCodeFormatMenu(button: HTMLElement, keyboard = false) {
    const pre = button.closest<HTMLElement>("pre.core-code-block");
    if (!pre || readOnly) return;
    if (codeMenu?.opener === button && !keyboard) { setCodeMenu(null); return; }
    // ponytail: 390 px is the full json tool list; scrolls only in a window lower than that.
    const need = 390;
    const rect = button.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const y = below >= need ? rect.bottom + 4 : above >= need ? undefined : Math.max(8, window.innerHeight - 8 - need);
    // Moved up, it sits left of the button so the button stays clickable.
    const right = window.innerWidth - (y === undefined || y === rect.bottom + 4 ? rect.right : rect.left - 4);
    setCodeMenu(y === undefined
      ? { right, bottom: window.innerHeight - rect.top + 4, maxHeight: above, pre, opener: button }
      : { right, y, maxHeight: window.innerHeight - y - 8, pre, opener: button });
  }

  /** A toolbar edit of the selection's Markdown, re-rendered with the caret put back. */
  function applyEdit(edit: (body: string, start: number, end: number) => { body: string; caret: number }) {
    const root = internalRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const from = markdownOffsetAt(root, range.startContainer, range.startOffset);
    const to = markdownOffsetAt(root, range.endContainer, range.endOffset);
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    if (start === end) return;
    commitDiscreteEdit();
    // Offsets come from markdownOffsetAt, which measures against the Markdown
    // of the DOM; edit that same string, not lastValue, so any drift between
    // the two can never put marks into other lines (E6).
    const result = edit(markdownFromCoreHtml(root), start, end);
    // Do NOT sync lastValue.current here: the render-skip guard in the
    // `value` effect above compares against it, and a toolbar toggle needs
    // that effect to actually fire and re-render the marked-up HTML (unlike
    // onInput, which pre-syncs it on purpose to avoid clobbering the caret
    // while typing plain text).
    setToolbarPosition(null);
    onChange(result.body, result.caret);
    requestAnimationFrame(() => placeCaretAtMarkdownOffset(internalRef.current, result.caret));
  }

  return <div className="core-editor-content-wrap" data-notible-region="editor">
    {pageRules.length > 0 && <div className="core-page-rules" aria-hidden="true">
      {pageRules.map((rule, index) => <span key={index} className="core-page-rule" style={{ top: rule.y, left: rule.left, width: rule.width }} />)}
    </div>}
    {toolbarPosition && <div className="core-selection-toolbar" style={{ top: toolbarPosition.top, left: toolbarPosition.left }} onMouseDown={(event) => event.preventDefault()}>
      {MARK_BUTTONS.map((button) => <button key={button.kind} type="button" className={`core-selection-toolbar-btn core-selection-toolbar-${button.kind}`} title={t(button.label)} aria-label={t(button.label)} onClick={() => applyMark(button.kind)}>{button.symbol}</button>)}
      <button type="button" className="core-selection-toolbar-btn core-selection-toolbar-heading" title={t("Heading")} aria-label={t("Heading")} onClick={() => applyEdit(toggleHeading)}><Heading2 size={15} /></button>
      <button type="button" className="core-selection-toolbar-btn core-selection-toolbar-link" title={t("Link")} aria-label={t("Link")} onClick={() => applyEdit(wrapLink)}><Link2 size={15} /></button>
      <button type="button" className="core-selection-toolbar-btn core-selection-toolbar-footnote" title={FOOTNOTE_BUTTON.label} aria-label={FOOTNOTE_BUTTON.label} onClick={addFootnote}>{FOOTNOTE_BUTTON.symbol}</button>
      {/* The pens, minus yellow: the H button already is yellow, and a second
          yellow swatch beside it would only raise the question of how they
          differ. Clicking a pen over an existing highlight recolours it. */}
      <span className="core-selection-toolbar-pens">
        {HIGHLIGHT_COLOURS.filter((colour) => colour !== "yellow").map((colour) => <button
          key={colour}
          type="button"
          className="core-selection-toolbar-pen"
          style={{ background: `var(--core-hl-${colour})` }}
          title={`Highlight ${colour}`}
          aria-label={`Highlight ${colour}`}
          onClick={() => applyMark("highlight", colour)}
        />)}
      </span>
    </div>}
    <div
      ref={(node) => { internalRef.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }}
      className="core-editor-content"
      contentEditable={!readOnly}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      aria-label={ariaLabel}
      onContextMenu={(event) => {
        if (insidePluginRender(event.target)) return; // E14B-ISOLATE
        const pre = event.target instanceof Element ? event.target.closest<HTMLElement>("pre.core-code-block") : null;
        // CODE-FORMAT (Hive #35): every code block has a menu now, not only drawn ones.
        if (pre && event.currentTarget.contains(pre)) {
          event.preventDefault();
          // ponytail: 440 px is the full json menu; moved up so it all shows, scrolls only below that height.
          const y = Math.max(8, Math.min(event.clientY, window.innerHeight - 8 - 440));
          setCodeMenu({ x: event.clientX, y, maxHeight: window.innerHeight - y - 8, pre });
          return;
        }
        const cell = event.target instanceof HTMLElement ? event.target.closest<HTMLTableCellElement>("td, th") : null;
        if (!cell) return;
        event.preventDefault();
        setTableMenu({ x: event.clientX, y: event.clientY, cell });
      }}
      onClick={(event) => {
        if (insidePluginRender(event.target)) return; // E14B-ISOLATE
        const element = event.target instanceof HTMLElement ? event.target : null;
        // A click in the empty space under a trailing code block.
        const lastBlock = event.currentTarget.lastElementChild;
        if (event.target === event.currentTarget && lastBlock && event.clientY > lastBlock.getBoundingClientRect().bottom && !readOnly) {
          if (paragraphAfterTrailingCodeBlock()) return;
          // A text block (heading, list, quote): its end, like Word — not the
          // spot on its last line straight above the mouse.
          const endOf = document.createRange();
          endOf.selectNodeContents(lastBlock);
          endOf.collapse(false);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(endOf);
          return;
        }
        // The code block's language label opens the language menu (E9).
        const langButton = element?.closest<HTMLElement>(".core-code-lang");
        const langPre = langButton?.closest<HTMLElement>("pre.core-code-block");
        if (langButton && langPre && !readOnly) {
          event.preventDefault();
          const rect = langButton.getBoundingClientRect();
          // Opens upward when the room below is short: near the bottom of a
          // long note the lower languages were off-screen (round 3).
          const below = window.innerHeight - rect.bottom - 8;
          const above = rect.top - 8;
          setLangMenu(below >= Math.min(320, above)
            ? { x: rect.left, y: rect.bottom + 4, maxHeight: below, pre: langPre }
            : { x: rect.left, bottom: window.innerHeight - rect.top + 4, maxHeight: above, pre: langPre });
          return;
        }
        // Clicking a checklist box ticks it (E4: it used to do nothing).
        const taskBox = element?.closest<HTMLElement>(".core-md-task-box");
        const taskItem = taskBox?.parentElement;
        if (taskBox && taskItem?.dataset.task === "true" && !readOnly && internalRef.current) {
          event.preventDefault();
          const checked = taskItem.dataset.checked !== "true";
          taskItem.dataset.checked = String(checked);
          taskBox.textContent = checked ? "✓" : "";
          noteTypingEdit();
          const next = markdownFromCoreHtml(internalRef.current);
          lastValue.current = next;
          onChange(next, editorCaretOffset(internalRef.current));
          return;
        }
        // Before the toolbar check below, so a drawn block does not open its source.
        const formatButton = element?.closest<HTMLElement>(".core-code-format");
        if (formatButton) {
          event.preventDefault();
          toggleCodeFormatMenu(formatButton, event.detail === 0);
          return;
        }
        const copyButton = element?.closest<HTMLElement>(".core-code-copy");
        if (copyButton) {
          event.preventDefault();
          const code = copyButton.closest("pre")?.querySelector("code")?.textContent ?? "";
          void navigator.clipboard.writeText(code);
          const original = copyButton.textContent;
          copyButton.textContent = tCore("Copied");
          window.setTimeout(() => { copyButton.textContent = original; }, 1200);
          return;
        }
        // Clicking the toolbar of a rendered block (query, diagram) drops the
        // caret back into its collapsed source, which `.is-editing` reveals.
        // Moving the caret out of the block collapses it again.
        const toolbar = element?.closest<HTMLElement>(".core-code-toolbar");
        if (toolbar && openRenderedCodeBlock(toolbar.closest<HTMLElement>("pre.core-code-block"))) return;
        // Ctrl/Cmd-click a footnote marker to jump to its definition, and the
        // number in front of a definition to jump back to the text. A link in a
        // definition opens in the browser the same way.
        if (event.ctrlKey || event.metaKey) {
          const marker = element?.closest<HTMLElement>(".core-md-fnref");
          if (marker) {
            const root = internalRef.current;
            const inDefinition = Boolean(marker.closest(".core-md-fndef"));
            const target = inDefinition
              ? Array.from(root?.querySelectorAll<HTMLElement>(".core-md-fnref") ?? []).find((node) => node.dataset.fn === marker.dataset.fn && !node.closest(".core-md-fndef"))
              : Array.from(root?.querySelectorAll<HTMLElement>(".core-md-fndef") ?? []).find((node) => node.textContent?.startsWith(`[^${marker.dataset.fn}]:`));
            if (target) {
              target.scrollIntoView({ block: "center", behavior: "smooth" });
              target.classList.add("is-fn-flash");
              window.setTimeout(() => target.classList.remove("is-fn-flash"), 1400);
            }
            return;
          }
          const url = element?.closest<HTMLElement>(".core-md-fnlink, .core-md-link")?.dataset.url;
          if (url && LINK_URL.test(url)) {
            event.preventDefault();
            if (isDevMockActive()) window.open(url, "_blank", "noopener");
            else void openUrl(url).catch(() => {});
            return;
          }
        }
        // Ctrl+click opens a [[link]], like a web link; a plain click puts the
        // caret in it so its text can be edited (E21).
        const link = element?.closest<HTMLElement>(".core-md-wikilink");
        const target = link?.dataset.coreWikilink;
        if (target && (event.ctrlKey || event.metaKey)) onWikilinkClick?.(target);
      }}
      onInput={(event) => { if (insidePluginRender(event.target)) return; /* E14B-ISOLATE */ pasteUndo.current = null; const previous = lastValue.current; noteTypingEdit(); syncFootnotes(event.currentTarget, previous);
        if ((event.nativeEvent as InputEvent).inputType === "insertParagraph") addMissingTaskBoxes(event.currentTarget);
        const next = markdownFromCoreHtml(event.currentTarget);
        // Typing the ")" that completes `[text](url)`: leave lastValue stale so
        // the value effect re-renders and the link shows at once (same trick
        // as applyMark), instead of only after the note is reopened.
        const typed = (event.nativeEvent as InputEvent).data;
        const caretNode = window.getSelection()?.anchorNode;
        const closesLink = typed === ")" && caretNode?.nodeType === Node.TEXT_NODE && !caretNode.parentElement?.closest(".core-md-link, pre")
          && LINK_AT_END.test((caretNode.textContent ?? "").slice(0, window.getSelection()?.anchorOffset ?? 0));
        if (!closesLink) lastValue.current = next;
        onChange(next, editorCaretOffset(event.currentTarget)); }}
      onPaste={(event) => {
        if (insidePluginRender(event.target)) return; // E14B-ISOLATE
        // Pasting from a web page inserts the source's raw styled HTML
        // (fonts, background colors, …) straight into the contenteditable.
        // This editor only ever round-trips through plain Markdown, so
        // strip formatting immediately instead of waiting for a remount.
        event.preventDefault();
        const root = internalRef.current;
        const selection = window.getSelection();
        // Every branch below splices Markdown at the caret; a non-collapsed
        // selection must be replaced by the paste, not pushed after it.
        // Ctrl+A just before: the paste replaces the whole note. Browser
        // deletion would keep the first block's shell (paste into a code block
        // or a quote), and offsets measured inside a diagram's SVG are wrong.
        const wholeNote = selectAllActive.current;
        selectAllActive.current = false;
        const startOf = (range: Range) => wholeNote || !root ? 0 : markdownOffsetAt(root, range.startContainer, range.startOffset);
        const selectionEnd = (range: Range, start: number) =>
          wholeNote ? lastValue.current.length : range.collapsed || !root ? start : Math.max(start, markdownOffsetAt(root, range.endContainer, range.endOffset));
        // A space typed just before pasting is still only trailing whitespace,
        // which the Markdown text trims, so an inline paste would glue itself to
        // the word before ("Before:See"). Put the space back.
        const spaceBefore = (range: Range, before: string) => {
          const node = range.startContainer;
          const typed = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? "").slice(0, range.startOffset) : "";
          return /[  ]$/u.test(typed) && before.length > 0 && !/\s$/u.test(before) ? " " : "";
        };
        // Screenshots/images (Snipping Tool → Ctrl+V, or copied off a web
        // page) arrive as a clipboard file, not text — persist to app_data
        // via save_media and insert as a Markdown image line.
        const imageFile = Array.from(event.clipboardData?.items ?? [])
          .find((item) => item.kind === "file" && item.type.startsWith("image/"))
          ?.getAsFile();
        if (imageFile && root && selection && selection.rangeCount > 0) {
          commitDiscreteEdit();
          const range = selection.getRangeAt(0);
          // A picture can't live inside a code block, a table or a Columns/
          // Calendar block — it was spliced into them as text, at an offset
          // that is wrong inside those blocks (into the code mid-line; a table
          // cut in two at its header). It goes on the line right under them.
          const startElement = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
          const enclosing = startElement?.closest<HTMLElement>("pre.core-code-block, .core-md-block, table");
          const enclosingTop = enclosing && root.contains(enclosing) ? Array.from(root.children).find((child) => child === enclosing || child.contains(enclosing)) : undefined;
          const afterBlock = !wholeNote && enclosingTop ? Array.from(root.children).slice(0, Array.from(root.children).indexOf(enclosingTop) + 1).flatMap((child) => linesForElement(child as HTMLElement)).join("\n").length : null;
          const offset = afterBlock ?? startOf(range);
          const end = afterBlock ?? selectionEnd(range, offset);
          // Captured now (selection can change once the async save below
          // resolves): pasting inside a list item should attach the image
          // to that item — Word-style "picture as part of this point" —
          // instead of consuming the next number/bullet.
          let listItem: HTMLLIElement | null = null;
          let node: Node | null = range.startContainer;
          while (!wholeNote && node && node !== root) { if (node instanceof HTMLLIElement) { listItem = node; break; } node = node.parentNode; }
          // In a list item the picture goes in through the DOM, so a selection
          // it replaces has to be removed there too.
          if (listItem && !range.collapsed) range.deleteContents();
          const insertionNode = range.startContainer;
          const insertionOffset = range.startOffset;
          // Snapshot before anything is written, so Ctrl+Z can restore it.
          pasteUndo.current = { value: lastValue.current, caret: offset };
          void (async () => {
            const bytes = new Uint8Array(await imageFile.arrayBuffer());
            let binary = "";
            const chunk = 0x8000;
            for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
            const ext = (imageFile.type.split("/")[1] || "png").toLowerCase();
            const path = await saveMedia(btoa(binary), ext);
            // Two forms, on purpose: `src` is what the DOM loads now, `ref`
            // is what gets stored. Writing `src` into the note is what made
            // pasted images machine-specific in the first place.
            const src = isDevMockActive() ? path : convertFileSrc(path);
            const ref = collapseMediaReference(path);
            if (listItem && listItem.isConnected) {
              const img = document.createElement("img");
              img.className = "core-md-image";
              img.src = src;
              const insertRange = document.createRange();
              insertRange.setStart(insertionNode, insertionOffset);
              insertRange.collapse(true);
              insertRange.insertNode(img);
              const after = document.createRange();
              after.setStartAfter(img);
              after.collapse(true);
              const insertSelection = window.getSelection();
              insertSelection?.removeAllRanges();
              insertSelection?.addRange(after);
              const nextMarkdown = markdownFromCoreHtml(root);
              lastValue.current = nextMarkdown;
              onChange(nextMarkdown, editorCaretOffset(root));
              return;
            }
            const body = lastValue.current;
            // Always land the image on its own line — pasting mid-sentence
            // (or mid-list-item) must not corrupt an existing block.
            const before = body.slice(0, offset);
            const after = body.slice(end);
            const leading = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
            const trailing = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
            const markdown = `${leading}![](${ref})${trailing}`;
            const next = before + markdown + after;
            const caret = offset + markdown.length;
            onChange(next, caret);
            requestAnimationFrame(() => placeCaretAtMarkdownOffset(root, caret));
          })();
          return;
        }
        // A page's <ul>/<li> markup is caught by markdownFromPastedHtml
        // below, but some sites (and most non-browser sources) render
        // bullet points as plain "• " prefixed text with no list markup at
        // all — text/html carries no <ul>, so that path never fires and the
        // bullet character pastes in literally. Normalize it here so it
        // round-trips as a real markdown list either way.
        const text = normalizeBulletLines(event.clipboardData?.getData("text/plain") ?? "");
        // Caret already inside a code block: the paste is literal text and
        // must never be wrapped in its own ``` fence (looksLikeCode) or
        // reparsed as a table/multiline block — doing so splices ``` into
        // the middle of this block, closing it early so the pasted text
        // lands above it and the text below gets swallowed in. Splice the
        // clipboard string straight into the <code> text node, mirroring
        // the Enter-in-code-block handler below.
        if (root && selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const start = range.startContainer;
          const element = start.nodeType === Node.ELEMENT_NODE ? (start as HTMLElement) : start.parentElement;
          const pre = element?.closest<HTMLElement>("pre.core-code-block");
          // Only a selection wholly inside this block: Ctrl+A in a note that
          // starts with a code block also *starts* in it, and used to paste the
          // whole clipboard into that block instead of replacing the note.
          if (!wholeNote && pre && root.contains(pre) && pre.contains(range.endContainer)) {
            const code = pre.querySelector("code");
            if (code) {
              let node = start.nodeType === Node.TEXT_NODE ? (start as Text) : null;
              let at = range.startOffset;
              if (!node) { node = document.createTextNode(""); code.appendChild(node); at = 0; }
              const pasted = text.replace(/\r\n/gu, "\n");
              const body = node.textContent ?? "";
              // Replace a selection inside this text node, like a normal paste.
              const to = range.endContainer === node ? Math.max(at, range.endOffset) : at;
              node.textContent = body.slice(0, at) + pasted + body.slice(to);
              placeSelection(node, at + pasted.length);
              const nextMarkdown = markdownFromCoreHtml(root);
              lastValue.current = nextMarkdown;
              onChange(nextMarkdown, editorCaretOffset(root));
              return;
            }
          }
        }
        const pastedHtml = event.clipboardData?.getData("text/html") ?? "";
        // In a table cell everything goes in as text through the browser, the
        // one path that works there: the Markdown-splicing branches below
        // measure a cell's position wrongly and cut the table at its header
        // row. A Markdown table cell is one line, so line breaks become spaces.
        if (!wholeNote && root && selection && selection.rangeCount > 0) {
          const start = selection.getRangeAt(0).startContainer;
          // A Columns/Calendar line is measured just as wrongly (the paste
          // landed inside the `::: columns` word), and is one line too.
          const cell = (start instanceof Element ? start : start.parentElement)?.closest("td, th, .core-md-block > span");
          if (cell && root.contains(cell)) {
            const url = text.trim();
            const selected = selection.toString();
            const htmlLine = markdownFromPastedHtml(pastedHtml);
            const inline = LINK_URL.test(url)
              ? `[${linkLabel(selected || (pastedHtml ? new DOMParser().parseFromString(pastedHtml, "text/html").querySelector("a")?.textContent ?? "" : ""), url)}](${url})`
              : (htmlLine ?? text);
            document.execCommand("insertText", false, inline.replace(/\s*\n\s*/gu, " ").trim());
            return;
          }
        }
        // A pasted address becomes a link, inline: over selected text that text
        // is the link's label (Notion/Obsidian style); otherwise the page title
        // the browser sent along, or the address itself.
        const pastedUrl = text.trim();
        if (LINK_URL.test(pastedUrl) && root && selection && selection.rangeCount > 0) {
          commitDiscreteEdit();
          const range = selection.getRangeAt(0);
          const offset = startOf(range);
          const end = selectionEnd(range, offset);
          const pageTitle = pastedHtml ? new DOMParser().parseFromString(pastedHtml, "text/html").querySelector("a")?.textContent ?? "" : "";
          const body = lastValue.current;
          const link = `${spaceBefore(range, body.slice(0, offset))}[${linkLabel(range.collapsed ? pageTitle : range.toString(), pastedUrl)}](${pastedUrl})`;
          const next = body.slice(0, offset).replace(/ $/u, " ") + link + body.slice(end);
          const caret = offset + link.length;
          onChange(next, caret);
          requestAnimationFrame(() => placeCaretAtMarkdownOffset(root, caret));
          return;
        }
        const htmlMarkdown = markdownFromPastedHtml(pastedHtml);
        if (htmlMarkdown && root && selection && selection.rangeCount > 0) {
          commitDiscreteEdit();
          const range = selection.getRangeAt(0);
          const offset = startOf(range);
          const end = selectionEnd(range, offset);
          const body = lastValue.current;
          // A trailing space the browser stored as a no-break space.
          const before = body.slice(0, offset).replace(/ $/u, " ");
          const after = body.slice(end);
          // One line of inline text (a sentence with a link or bold) goes in
          // where the caret is; anything with block structure gets its own lines.
          const inline = !htmlMarkdown.includes("\n") && !/^(#{1,3} |[-*+] |\d+\. |> |\||```)/u.test(htmlMarkdown);
          const leading = inline ? spaceBefore(range, before) : before.length > 0 && !before.endsWith("\n") ? "\n" : "";
          const trailing = !inline && after.length > 0 && !after.startsWith("\n") ? "\n" : "";
          const pasted = `${leading}${htmlMarkdown}${trailing}`;
          const next = before + pasted + after;
          const caret = offset + pasted.length;
          onChange(next, caret);
          requestAnimationFrame(() => placeCaretAtMarkdownOffset(root, caret));
          return;
        }
        const table = tabularMarkdownFrom(text);
        if (table && root && selection && selection.rangeCount > 0) {
          commitDiscreteEdit();
          const range = selection.getRangeAt(0);
          const offset = startOf(range);
          const end = selectionEnd(range, offset);
          const body = lastValue.current;
          const next = body.slice(0, offset) + table + body.slice(end);
          const caret = offset + table.length;
          // Same reasoning as applyMark: leave lastValue.current stale so the
          // value effect actually re-renders the new block structure.
          onChange(next, caret);
          requestAnimationFrame(() => placeCaretAtMarkdownOffset(root, caret));
          return;
        }
        if (looksLikeCode(text) && root && selection && selection.rangeCount > 0) {
          commitDiscreteEdit();
          const range = selection.getRangeAt(0);
          const offset = startOf(range);
          const end = selectionEnd(range, offset);
          const body = lastValue.current;
          const lang = detectCodeLanguage(text);
          const before = body.slice(0, offset);
          const after = body.slice(end);
          const leading = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
          const trailing = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
          const fenced = `${leading}\`\`\`${lang}\n${text.replace(/\r\n/gu, "\n").replace(/\n+$/u, "")}\n\`\`\`${trailing}`;
          const next = before + fenced + after;
          const caret = offset + fenced.length;
          onChange(next, caret);
          requestAnimationFrame(() => placeCaretAtMarkdownOffset(root, caret));
          return;
        }
        // Plain multi-line paste (e.g. a Markdown table + "---" divider
        // copied from a chat client) must go through the same body/markdown
        // path as the tabular/code branches above, or the browser's default
        // text-node insertion collapses the newlines and the pipe-table /
        // hr lines never get a chance to be reparsed into real blocks.
        if (text.includes("\n") && root && selection && selection.rangeCount > 0) {
          commitDiscreteEdit();
          const range = selection.getRangeAt(0);
          const offset = startOf(range);
          const end = selectionEnd(range, offset);
          const body = lastValue.current;
          const pasted = text.replace(/\r\n/gu, "\n");
          const next = body.slice(0, offset) + pasted + body.slice(end);
          const caret = offset + pasted.length;
          onChange(next, caret);
          requestAnimationFrame(() => placeCaretAtMarkdownOffset(root, caret));
          return;
        }
        if (wholeNote) { replaceWholeNote(text.replace(/\r\n/gu, "\n")); return; }
        document.execCommand("insertText", false, text);
      }}
      onKeyDown={(event) => {
        if (insidePluginRender(event.target)) return; // E14B-ISOLATE
        // A focused code toolbar button (Hive #43): Tab moves on to the next
        // button, not into the block. On Format, Enter, Space or ArrowDown open
        // its menu and no key reaches the editing code below.
        if (event.target instanceof HTMLElement && event.target.closest(".core-code-toolbar")) {
          const format = event.target.classList.contains("core-code-format");
          if (format && ["Enter", " ", "ArrowDown"].includes(event.key)) { event.preventDefault(); toggleCodeFormatMenu(event.target, true); }
          if (format || event.key === "Tab") return;
        }
        // An open "/" or "[[" menu takes its keys first, as Tab does below:
        // in a code block Enter added a line instead of picking (Hive #35).
        if (["Enter", "ArrowUp", "ArrowDown"].includes(event.key)) { onKeyDown(event); if (event.defaultPrevented) return; }
        const mod = event.ctrlKey || event.metaKey;
        if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") { selectAllActive.current = true; return; }
        if (selectAllActive.current && !["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
          // AltGr (Polish ą, ę, …) reports as Ctrl+Alt on Windows.
          const typed = event.key.length === 1 && ((!mod && !event.altKey) || event.getModifierState("AltGraph"));
          const erase = event.key === "Backspace" || event.key === "Delete";
          const cut = mod && !event.altKey && event.key.toLowerCase() === "x";
          if (!readOnly && (typed || erase || cut)) {
            event.preventDefault();
            selectAllActive.current = false;
            if (cut) document.execCommand("copy");
            replaceWholeNote(typed ? event.key : "");
            return;
          }
          // Copy (and paste, which onPaste handles) keep the note selected.
          if (!(mod && ["c", "v"].includes(event.key.toLowerCase()))) selectAllActive.current = false;
        }
        if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) {
          if (readOnly || escapedBeforeTab.current) { escapedBeforeTab.current = false; return; }
          // An open / or [[ menu picks its item on Tab (the parent handles it).
          onKeyDown(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          handleTab(event.shiftKey);
          return;
        }
        if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) escapedBeforeTab.current = event.key === "Escape";
        // Ctrl+End, or ArrowDown on the last line of a trailing code block:
        // step out under it instead of staying in (or landing in) its source.
        if (!readOnly && ((event.key === "End" && (event.ctrlKey || event.metaKey) && !event.shiftKey) || (event.key === "ArrowDown" && !event.shiftKey))) {
          const root = internalRef.current;
          const last = root?.lastElementChild;
          const selection = window.getSelection();
          const anchor = selection?.anchorNode ?? null;
          if (root && last instanceof HTMLElement && last.matches(TRAILING_BLOCKS) && anchor && selection) {
            const code = last.querySelector("code");
            let onLastLine = false;
            if (code && last.contains(anchor)) {
              const tail = document.createRange();
              tail.setStart(anchor, selection.anchorOffset);
              tail.setEnd(code, code.childNodes.length);
              onLastLine = !tail.toString().replace(/\n+$/u, "").includes("\n");
            }
            if ((event.key === "End" || onLastLine) && paragraphAfterTrailingCodeBlock()) { event.preventDefault(); return; }
          }
        }
        // A vertical move onto a picture's line parks the caret *before* the
        // image: it renders at the image's left edge and costs a second
        // ArrowDown to get past. Word treats the picture as part of the line,
        // so hop to its far side and make one press move one visual line.
        // Undo a just-pasted screenshot. See pasteUndo: the insertion bypasses
        // the browser's editing commands, so its native undo entry is missing
        // and this press would otherwise be a no-op.
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z" && pasteUndo.current) {
          event.preventDefault();
          const restored = pasteUndo.current;
          pasteUndo.current = null;
          // Leave lastValue.current stale so the value effect really re-renders
          // the document without the picture (same reasoning as applyMark).
          onChange(restored.value, restored.caret);
          const root = internalRef.current;
          if (root) requestAnimationFrame(() => placeCaretAtMarkdownOffset(root, restored.caret));
          return;
        }
        // General undo/redo: the browser's own contentEditable undo manager
        // doesn't survive the innerHTML rebuilds several edits above do on
        // purpose, so it stops covering anything past the first paste/mark
        // toggle/table edit in a session. This stack is the real one.
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
          event.preventDefault();
          flushUndoBurst();
          const previous = undoStack.current.pop();
          if (previous !== undefined && previous !== lastValue.current) {
            redoStack.current.push(lastValue.current);
            const root = internalRef.current;
            const caret = Math.min(root ? editorCaretOffset(root) : previous.length, previous.length);
            onChange(previous, caret);
          }
          return;
        }
        if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
          event.preventDefault();
          const next = redoStack.current.pop();
          if (next !== undefined) {
            undoStack.current.push(lastValue.current);
            const root = internalRef.current;
            const caret = Math.min(root ? editorCaretOffset(root) : next.length, next.length);
            onChange(next, caret);
          }
          return;
        }
        // Backspace next to a code block. Left to the browser, it merges the
        // paragraph below into the <code> and deletes the rendered diagram
        // (a contenteditable=false child) instead, leaving a bare block
        // frame behind that has to be hunted down and deleted separately.
        if (event.key === "Backspace" && !readOnly && !event.ctrlKey && !event.altKey && !event.metaKey) {
          const root = internalRef.current;
          const selection = window.getSelection();
          const range = selection?.isCollapsed && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
          const start = range?.startContainer;
          const element = start ? (start instanceof Element ? start : start.parentElement) : null;
          if (root && range && element && root.contains(element) && element !== root) {
            const pre = element.closest<HTMLElement>("pre.core-code-block");
            const code = pre?.querySelector("code");
            let block: HTMLElement = element as HTMLElement;
            while (block.parentElement && block.parentElement !== root) block = block.parentElement;
            const textBeforeCaret = (container: Node) => {
              const before = document.createRange();
              before.selectNodeContents(container);
              before.setEnd(range.startContainer, range.startOffset);
              return before.toString().replace(ZERO_WIDTH_SPACE, "");
            };
            const commit = () => {
              noteTypingEdit();
              const next = markdownFromCoreHtml(root);
              lastValue.current = next;
              onChange(next, editorCaretOffset(root));
            };
            if (pre && code && textBeforeCaret(code) === "") {
              event.preventDefault();
              // Empty block: remove it whole. Otherwise do nothing — there is
              // no sensible "join" of code with the paragraph above.
              if ((code.textContent ?? "").trim() !== "") return;
              const paragraph = document.createElement("p");
              paragraph.appendChild(document.createTextNode(String.fromCharCode(0x200b)));
              pre.replaceWith(paragraph);
              placeSelection(paragraph.firstChild as Node, 1);
              commit();
              return;
            }
            const previous = block.previousElementSibling;
            if (!pre && previous instanceof HTMLElement && previous.matches("pre.core-code-block") && textBeforeCaret(block) === "") {
              event.preventDefault();
              if ((block.textContent ?? "").replace(ZERO_WIDTH_SPACE, "").trim() === "") block.remove();
              const previousCode = previous.querySelector("code");
              if (previousCode) placeCaretAtCodeEnd(previousCode);
              syncEditingCodeBlock(root);
              commit();
              return;
            }
          }
        }
        // Enter on an empty quote line or empty list item leaves the block
        // instead of making one more of it. The browser's default split is
        // what produced "every Enter is another Quote and I cannot write
        // normally again".
        if (event.key === "Enter" && !event.shiftKey && !readOnly) {
          const root = internalRef.current;
          const selection = window.getSelection();
          if (root && selection?.isCollapsed && selection.rangeCount > 0) {
            // Enter in a quote starts a normal paragraph below it, taking the
            // text after the caret along; Shift+Enter adds a line inside the
            // quote. Before, Enter kept adding quote lines, and a new user
            // wrote a whole page inside one without noticing.
            const caretRange = selection.getRangeAt(0);
            const anchorElement = caretRange.startContainer instanceof Element ? caretRange.startContainer : caretRange.startContainer.parentElement;
            const quote = anchorElement?.closest<HTMLElement>("blockquote");
            if (quote && root.contains(quote)) {
              event.preventDefault();
              noteTypingEdit();
              const tail = document.createRange();
              tail.setStart(caretRange.startContainer, caretRange.startOffset);
              tail.setEnd(quote, quote.childNodes.length);
              const paragraph = document.createElement("p");
              paragraph.append(tail.extractContents());
              while (paragraph.firstChild instanceof HTMLElement && paragraph.firstChild.tagName === "BR") paragraph.firstChild.remove();
              while (quote.lastChild instanceof HTMLElement && quote.lastChild.tagName === "BR") quote.lastChild.remove();
              if (!(paragraph.textContent ?? "").replace(ZERO_WIDTH_SPACE, "").trim()) paragraph.replaceChildren(document.createTextNode(String.fromCharCode(0x200b)));
              quote.after(paragraph);
              if (!(quote.textContent ?? "").replace(ZERO_WIDTH_SPACE, "").trim()) quote.remove();
              const first = paragraph.firstChild;
              if (first instanceof Text && first.data === String.fromCharCode(0x200b)) placeSelection(first, 1);
              else placeSelection(paragraph, 0);
              const next = markdownFromCoreHtml(root);
              lastValue.current = next;
              onChange(next, editorCaretOffset(root));
              return;
            }
            const block = blockToExitOnEnter(root, caretRange);
            if (block) {
              event.preventDefault();
              // A zero-width space, not an empty <p>: renderCoreMarkdown drops
              // blank lines, so an empty paragraph disappears on the next
              // round-trip and takes the caret (and the next keystroke) with
              // it. Same trick the terminal-block slash commands already use.
              const paragraph = document.createElement("p");
              paragraph.appendChild(document.createTextNode(String.fromCharCode(0x200b)));
              const container = block.tagName.toLowerCase() === "li" ? block.parentElement ?? block : block;
              // A trailing <br> is the empty line the caret was on; it must go
              // with the caret, or the quote keeps an empty last line.
              if (block.lastChild instanceof HTMLElement && block.lastChild.tagName.toLowerCase() === "br") block.lastChild.remove();
              // A code block has no <br>: its blank trailing line is a literal
              // "\n" at the end of the <code> text, which must go the same way.
              if (block.tagName.toLowerCase() === "pre") {
                const code = block.querySelector("code");
                const last = code?.lastChild;
                if (last?.nodeType === Node.TEXT_NODE && (last.textContent ?? "").endsWith("\n")) {
                  last.textContent = (last.textContent ?? "").replace(/\n+$/u, "");
                }
              }
              noteTypingEdit();
              if (block.tagName.toLowerCase() === "li") block.remove();
              container.after(paragraph);
              if (!(container.textContent ?? "").replace(ZERO_WIDTH_SPACE, "").trim() && container.children.length === 0) container.remove();
              placeSelection(paragraph.firstChild as Node, 1);
              const next = markdownFromCoreHtml(root);
              lastValue.current = next;
              onChange(next, editorCaretOffset(root));
              return;
            }
            // Not exiting: still need to keep the code block from exiting.
            // The browser's default Enter-in-<pre> behaviour — and even
            // execCommand("insertText", "\n") — splits <code> into sibling
            // elements instead of continuing the same text node, which
            // markdownFromCoreHtml never expected and which loses the block
            // on the next round-trip. Splice the character in by hand.
            const range = selection.getRangeAt(0);
            const start = range.startContainer;
            const element = start.nodeType === Node.ELEMENT_NODE ? start as HTMLElement : start.parentElement;
            const pre = element?.closest<HTMLElement>("pre.core-code-block");
            if (pre && root.contains(pre)) {
              event.preventDefault();
              const code = pre.querySelector("code");
              if (code) {
                noteTypingEdit();
                let node = start.nodeType === Node.TEXT_NODE ? start as Text : null;
                let offset = range.startOffset;
                if (!node) {
                  node = document.createTextNode("");
                  code.appendChild(node);
                  offset = 0;
                }
                const text = node.textContent ?? "";
                // A lone trailing "\n" draws no line in a <pre>, so the caret
                // would snap back onto the line it just left. At the very end,
                // write two: the second is the blank trailing line that a
                // further Enter already knows how to leave the block from.
                const atEnd = offset === text.length && node === code.lastChild;
                node.textContent = `${text.slice(0, offset)}\n${atEnd ? "\n" : ""}${text.slice(offset)}`;
                placeSelection(node, offset + 1);
                const next = markdownFromCoreHtml(root);
                lastValue.current = next;
                onChange(next, editorCaretOffset(root));
              }
              return;
            }
          }
        }
        // Typing "- " or "1. " alone on a line converts it into a real
        // bullet/numbered list, matching what most note editors do.
        if (event.key === " " && !readOnly && dashList) {
          const root = internalRef.current;
          const selection = window.getSelection();
          const textNode = selection?.rangeCount ? selection.getRangeAt(0).startContainer : null;
          if (root && selection?.isCollapsed && textNode) {
            // A genuinely empty editor's very first keystrokes land as a bare
            // text node directly under root (no <p> wrapper yet — same gap
            // markdownFromCoreHtml works around), so a plain P-only block
            // search misses "- " typed as the first thing in a new note.
            let target: HTMLElement | Text | null = null;
            if (textNode.nodeType === Node.TEXT_NODE && textNode.parentNode === root) {
              target = textNode as Text;
            } else {
              let block: Node | null = textNode.nodeType === Node.TEXT_NODE ? textNode.parentElement : textNode;
              while (block && block.parentNode !== root) block = block.parentNode;
              if (block instanceof HTMLElement && block.tagName === "P" && block.lastChild === textNode) target = block;
            }
            if (target) {
              const range = selection.getRangeAt(0);
              const raw = textNode.textContent ?? "";
              const caretAtEnd = range.startOffset === raw.length;
              // The paragraph left behind by leaving a list starts with a
              // zero-width space, which made "- " there stay literal text
              // (round 2, 01.10).
              const text = raw.replace(ZERO_WIDTH_SPACE, "");
              const numbered = /^\d+\.$/u.test(text);
              if (caretAtEnd && (text === "-" || numbered)) {
                event.preventDefault();
                noteTypingEdit();
                const list = document.createElement(numbered ? "ol" : "ul");
                list.className = "core-md-list";
                if (numbered) {
                  const startAt = Number(/^(\d+)\./u.exec(text)?.[1] ?? "1");
                  if (startAt !== 1) list.setAttribute("start", String(startAt));
                }
                const li = document.createElement("li");
                list.appendChild(li);
                (target as ChildNode).replaceWith(list);
                placeSelection(li, 0);
                const next = markdownFromCoreHtml(root);
                lastValue.current = next;
                onChange(next, editorCaretOffset(root));
                return;
              }
            }
          }
        }
        // Typing "#"-"###" or ">" alone on a line, then a space, makes it a
        // heading or quote at once; "[ ]"/"[x]" alone in a bullet makes it a
        // task. Before, these only took shape when the note was reopened (E3).
        if (event.key === " " && !readOnly) {
          const root = internalRef.current;
          const selection = window.getSelection();
          const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
          const textNode = range?.startContainer;
          if (root && range && selection?.isCollapsed && textNode?.nodeType === Node.TEXT_NODE && range.startOffset === (textNode.textContent ?? "").length) {
            const text = (textNode.textContent ?? "").replace(ZERO_WIDTH_SPACE, "");
            const parent = textNode.parentElement;
            // The block's whole visible text must be the mark. Compared as text, not
            // as "one child": Enter can leave empty nodes (a <br>, a cloned empty
            // span) next to the typed text, which made "## " on that line a no-op.
            const onlyText = (element: HTMLElement) => (element.textContent ?? "").replace(ZERO_WIDTH_SPACE, "") === text;
            let top: Node | null = textNode;
            while (top && top.parentNode !== root) top = top.parentNode;
            const line: ChildNode | null = textNode.parentNode === root ? textNode as Text
              : top instanceof HTMLElement && top.tagName === "P" && onlyText(top) ? top : null;
            const heading = /^(#{1,3})$/u.exec(text);
            const item = parent?.closest<HTMLElement>("li");
            const li = item && item.dataset.task !== "true" && item.parentElement?.parentNode === root && onlyText(item) ? item : null;
            const task = li ? /^\[([ xX])\]$/u.exec(text) : null;
            if ((line && (heading || text === ">")) || task) {
              event.preventDefault();
              noteTypingEdit();
              if (line) {
                const block = document.createElement(heading ? `h${heading[1].length}` : "blockquote");
                block.appendChild(document.createElement("br"));
                line.replaceWith(block);
                placeSelection(block, 0);
              } else if (li && task) {
                const checked = task[1].toLowerCase() === "x";
                li.dataset.task = "true";
                li.dataset.checked = String(checked);
                li.parentElement?.classList.add("core-md-task-list");
                const box = document.createElement("span");
                box.className = "core-md-task-box";
                box.contentEditable = "false";
                box.textContent = checked ? "✓" : "";
                const rest = document.createTextNode(String.fromCharCode(0x200b));
                li.replaceChildren(box, rest);
                placeSelection(rest, 1);
              }
              const next = markdownFromCoreHtml(root);
              lastValue.current = next;
              onChange(next, editorCaretOffset(root));
              return;
            }
          }
        }
        if (event.ctrlKey && event.altKey && !event.metaKey && event.key.toLowerCase() === "f" && !readOnly) {
          event.preventDefault();
          addFootnote();
          return;
        }
        // 3.5: Obsidian-style auto-close — typing an opening bracket inserts
        // the pair with the caret left in between, only when nothing is
        // selected (a selection should wrap, which callers can add later).
        const closer = BRACKET_PAIRS[event.key];
        const selection = window.getSelection();
        // Typing the closer that auto-close already put there steps over it
        // instead of doubling it — otherwise `A[Start]` comes out `A[Start]]`.
        if (BRACKET_CLOSERS.has(event.key) && selection?.isCollapsed && selection.rangeCount > 0 && !event.altKey && !event.ctrlKey && !event.metaKey) {
          const range = selection.getRangeAt(0);
          const node = range.startContainer;
          if (node instanceof Text && node.data[range.startOffset] === event.key) {
            event.preventDefault();
            placeSelection(node, range.startOffset + 1);
            // Stepping over the auto-closed ")" of `[text](url)` completes a
            // link: draw it now rather than when the note is next opened.
            if (event.key === ")" && !node.parentElement?.closest(".core-md-link, pre") && LINK_AT_END.test(node.data.slice(0, range.startOffset + 1))) rebuildKeepingCaret();
            // Same for the second "]" of a typed `[[link]]` (E8).
            else if (event.key === "]" && !node.parentElement?.closest(".core-md-wikilink, pre") && /\[\[[^[\]\n]+\]\]$/u.test(node.data.slice(0, range.startOffset + 1))) rebuildKeepingCaret();
            return;
          }
        }
        if (closer && selection?.isCollapsed && !event.altKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          document.execCommand("insertText", false, event.key + closer);
          const after = window.getSelection();
          if (after && after.rangeCount > 0) {
            const range = after.getRangeAt(0);
            range.setStart(range.startContainer, Math.max(0, range.startOffset - 1));
            range.collapse(true);
            after.removeAllRanges();
            after.addRange(range);
          }
          return;
        }
        onKeyDown(event);
      }}
      // A vertical move onto a picture's line parks the caret *before* the
      // image: it renders at the image's left edge and costs a second
      // ArrowDown to get past it. Word treats the picture as part of the
      // line, so hop to its far side — one press, one visual line. Done on
      // key*up* because that is the first point at which the browser has
      // finished applying the move.
      onKeyUp={(event) => { if (insidePluginRender(event.target)) return; if (event.key === "ArrowDown" || event.key === "ArrowUp") skipCaretPastImage(); }}
      // Mouse-only: a keyboard-driven selection change never lands on the
      // root itself between two block children, only a click through the
      // margin gap above an image does. See fixCaretInBlockGap.
      onMouseDown={() => { selectAllActive.current = false; }}
      // Text that arrives with no key press (emoji panel, dictation, IME)
      // replacing a Ctrl+A selection — the keydown path above never sees it.
      onBeforeInput={(event) => {
        if (insidePluginRender(event.target)) return; // E14B-ISOLATE
        if (!selectAllActive.current || readOnly) return;
        event.preventDefault();
        selectAllActive.current = false;
        replaceWholeNote((event.nativeEvent as InputEvent).data ?? "");
      }}
      onMouseUp={(event) => { if (insidePluginRender(event.target)) return; const root = internalRef.current; if (root) fixCaretInBlockGap(root); }}
      onBlur={onBlur}
      onScroll={onScroll}
    />
    {tableMenu && <div className="core-table-context-menu" role="menu" ref={tableMenuRef} style={{ position: "fixed", left: tableMenu.x, top: tableMenu.y }}>
      <button type="button" role="menuitem" onClick={() => { insertTableRow(tableMenu.cell.closest("tr")!, "before"); syncAfterTableEdit(); }}>{t("Insert row above")}</button>
      <button type="button" role="menuitem" onClick={() => { insertTableRow(tableMenu.cell.closest("tr")!, "after"); syncAfterTableEdit(); }}>{t("Insert row below")}</button>
      <button type="button" role="menuitem" onClick={() => { deleteTableRow(tableMenu.cell.closest("tr")!); syncAfterTableEdit(); }}>{t("Delete row")}</button>
      <div className="core-table-context-menu-divider" />
      <button type="button" role="menuitem" onClick={() => { const table = tableMenu.cell.closest("table"); if (table) insertTableColumn(table, Array.from(tableMenu.cell.parentElement?.children ?? []).indexOf(tableMenu.cell), "before"); syncAfterTableEdit(); }}>{t("Insert column left")}</button>
      <button type="button" role="menuitem" onClick={() => { const table = tableMenu.cell.closest("table"); if (table) insertTableColumn(table, Array.from(tableMenu.cell.parentElement?.children ?? []).indexOf(tableMenu.cell), "after"); syncAfterTableEdit(); }}>{t("Insert column right")}</button>
      <button type="button" role="menuitem" onClick={() => { const table = tableMenu.cell.closest("table"); if (table) deleteTableColumn(table, Array.from(tableMenu.cell.parentElement?.children ?? []).indexOf(tableMenu.cell)); syncAfterTableEdit(); }}>{t("Delete column")}</button>
    </div>}
    {codeMenu && <div className="core-table-context-menu" role="menu" ref={tableMenuRef} style={{ position: "fixed", left: codeMenu.x, right: codeMenu.right, top: codeMenu.y, bottom: codeMenu.bottom, maxHeight: codeMenu.maxHeight, overflowY: "auto" }} onKeyDown={(event) => {
      // Arrows move between the items; Esc (closed by the window listener) gives focus back to the Format button.
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]"));
      const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (step) { event.preventDefault(); items[(items.indexOf(document.activeElement as HTMLElement) + step + items.length) % items.length]?.focus(); }
      else if (event.key === "Escape") codeMenu.opener?.focus({ preventScroll: true });
      else if (event.key === "Tab") setCodeMenu(null);
    }}>
      {!codeMenu.opener && codeMenu.pre.querySelector(":scope > .core-code-render.nq-ready") && <button type="button" role="menuitem" onClick={() => { openRenderedCodeBlock(codeMenu.pre); setCodeMenu(null); }}>{t("Edit code")}</button>}
      {!codeMenu.opener && <button type="button" role="menuitem" onClick={() => { void navigator.clipboard.writeText(codeMenu.pre.querySelector("code")?.textContent ?? ""); setCodeMenu(null); }}>{t("Copy code")}</button>}
      {!readOnly && <>
        {!codeMenu.opener && <div className="core-table-context-menu-divider" />}
        {CODE_FORMAT_ACTIONS.filter((action) => !action.json || codeMenu.pre.dataset.lang === "json").map((action) => <button key={action.id} type="button" role="menuitem" data-code-format={action.id} onClick={() => formatCodeBlock(codeMenu.pre, action.id)}>{t(action.label)}</button>)}
      </>}
    </div>}
    {langMenu && <div className="core-table-context-menu core-code-lang-menu" role="menu" ref={tableMenuRef} style={{ position: "fixed", left: langMenu.x, top: langMenu.y, bottom: langMenu.bottom, maxHeight: langMenu.maxHeight, overflowY: "auto" }}>
      {CODE_LANGUAGES.map((lang) => <button key={lang || "text"} type="button" role="menuitemradio" aria-checked={(langMenu.pre.dataset.lang ?? "") === lang} onClick={() => setCodeLanguage(langMenu.pre, lang)}>{lang || "text"}</button>)}
    </div>}
  </div>;
});
