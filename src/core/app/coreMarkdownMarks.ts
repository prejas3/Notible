/** Pure inline-mark parsing shared by CoreMarkdownEditor.tsx, kept in a
 * plain .ts module (no JSX) so it can be imported and tested directly by a
 * Node script — CoreMarkdownEditor.tsx itself can't be, since
 * --experimental-strip-types can't load .tsx files. */

import { expandMediaReference } from "./mediaRef.ts";

export function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Inline mark syntax this dialect recognizes, checked in this order so
 * `**bold**` matches before the single-star italic pattern does. */
export const INLINE_MARK_PATTERN = /\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|==(.+?)==|\*(.+?)\*|!\[([^\]]*)\]\(([^)]*)\)|(\[\[([^\]|]+)(?:\|[^\]]+)?\]\])|(\[\^([^\]\s]+)\])|\[([^[\]]+)\]\(((?:https?:\/\/|mailto:)[^\s()]+)\)/gu;

/** A web or mail address a link may point at — nothing else (no javascript:,
 * no file:), since a link in a synced note is untrusted input. */
export const LINK_URL = /^(?:https?:\/\/|mailto:)[^\s()]+$/iu;

export function inlineHtml(value: string) {
  return escapeHtml(value).replace(INLINE_MARK_PATTERN, (_match, bold, underline, strike, highlight, italic, imageAlt, imageSrc, wikilink, wikilinkTarget, footnote, footnoteLabel, linkText, linkUrl) => {
    // `[text](url)` keeps every character as text, like a wikilink: the spans
    // carry no mark delimiter, so it serializes and caret-measures as plain
    // text. CSS hides the two `.core-md-link-mark` parts until the caret is
    // in the link (`.is-editing`), leaving the text and a small arrow.
    if (linkUrl !== undefined) return `<span class="core-md-link" data-url="${linkUrl}" title="Ctrl+click to open ${linkUrl}"><span class="core-md-link-mark">[</span>${linkText}<span class="core-md-link-mark">](${linkUrl})</span></span>`;
    if (bold !== undefined) return `<strong>${bold}</strong>`;
    if (underline !== undefined) return `<u>${underline}</u>`;
    if (strike !== undefined) return `<s>${strike}</s>`;
    if (highlight !== undefined) {
      const colour = highlightColourOf(highlight);
      return colour
        ? `<mark class="core-md-highlight" data-highlight="${colour.name}">${colour.text}</mark>`
        : `<mark class="core-md-highlight">${highlight}</mark>`;
    }
    if (italic !== undefined) return `<em>${italic}</em>`;
    if (imageSrc !== undefined) return `<img class="core-md-image" alt="${imageAlt}" src="${escapeHtml(expandMediaReference(imageSrc))}">`;
    // A footnote marker keeps its literal `[^n]` text inside the span, so it
    // serializes and caret-measures exactly like a wikilink (unknown span = transparent).
    if (footnote !== undefined) return `<span class="core-md-fnref" data-fn="${footnoteLabel}">${footnote}</span>`;
    return `<span class="core-md-wikilink" data-core-wikilink="${escapeHtml((wikilinkTarget as string).trim())}" role="link" tabindex="0">${wikilink}</span>`;
  // A tab (Tab key in text) would collapse to a space in normal text flow;
  // this span keeps it a real gap and, being delimiter-free, stays "\t".
  }).replaceAll("\t", '<span class="core-md-tab">\t</span>');
}


/**
 * The pens available for highlighting.
 *
 * Named rather than free-form on purpose. The colour travels inside the note
 * as `==green:text==`, which means anything before a colon could be read as a
 * colour — so only these words are, and `==note: call them back==` stays the
 * plain yellow highlight it looks like. A fixed set is also the only way the
 * pens stay legible in both themes; a colour picker would let someone write
 * dark grey on near-black.
 */
export const HIGHLIGHT_COLOURS = ["yellow", "green", "blue", "pink", "purple", "orange"] as const;
export type HighlightColour = (typeof HIGHLIGHT_COLOURS)[number];

const HIGHLIGHT_PREFIX = new RegExp(`^(${HIGHLIGHT_COLOURS.join("|")}):([\\s\\S]+)$`, "u");

/** Split `green:text` into its pen and its text, or null for plain yellow. */
export function highlightColourOf(inner: string): { name: HighlightColour; text: string } | null {
  const match = HIGHLIGHT_PREFIX.exec(inner);
  if (!match) return null;
  return { name: match[1] as HighlightColour, text: match[2] as string };
}

/** Matches a footnote definition line: `[^1]: the source or the note`. */
export const FOOTNOTE_DEFINITION = /^\[\^([^\]\s]+)\]:\s?/u;

/** Labels of `[^n]` markers in running text (definition lines are not markers). */
export function footnoteMarkerLabels(markdown: string): Set<string> {
  const labels = new Set<string>();
  for (const line of markdown.split("\n")) {
    if (FOOTNOTE_DEFINITION.test(line)) continue;
    for (const match of line.matchAll(/\[\^([^\]\s]+)\]/gu)) labels.add(match[1]);
  }
  return labels;
}

/** Labels that have a `[^n]: …` definition line. */
export function footnoteDefinitionLabels(markdown: string): Set<string> {
  const labels = new Set<string>();
  for (const line of markdown.split("\n")) {
    const match = FOOTNOTE_DEFINITION.exec(line);
    if (match) labels.add(match[1]);
  }
  return labels;
}

/**
 * Definitions whose marker this edit just deleted. Only a label that HAD a
 * marker before and has none now qualifies, so a definition written ahead of
 * its marker is never touched — and a half-deleted marker (`[^1` while the
 * user retypes it) is left alone until it is really gone.
 */
export function orphanedFootnotes(previous: string, next: string): string[] {
  const before = footnoteMarkerLabels(previous);
  const after = footnoteMarkerLabels(next);
  const defined = footnoteDefinitionLabels(next);
  const running = next.split("\n").filter((line) => !FOOTNOTE_DEFINITION.test(line)).join("\n");
  // A marker missing its first or last character is being retyped, not deleted.
  return [...before].filter((label) => !after.has(label) && defined.has(label) && !running.includes(`[^${label}`) && !running.includes(`^${label}]`));
}

/**
 * Insert the next numbered footnote marker at a Markdown offset and open its
 * definition at the end of the document. Definitions are plain `[^n]: text`
 * lines (standard Markdown), so they export and sync as ordinary text.
 * Returns the new body and a caret position inside the fresh definition.
 */
export function insertFootnote(body: string, offset: number): { body: string; caret: number; label: string } {
  const used = [...body.matchAll(/\[\^(\d+)\]/gu)].map((match) => Number(match[1]));
  const label = String(Math.max(0, ...used) + 1);
  const at = Math.min(Math.max(offset, 0), body.length);
  const withMarker = `${body.slice(0, at)}[^${label}]${body.slice(at)}`.replace(/\s+$/u, "");
  const lastLine = withMarker.slice(withMarker.lastIndexOf("\n") + 1);
  const separator = FOOTNOTE_DEFINITION.test(lastLine) ? "\n" : "\n\n";
  const next = `${withMarker}${separator}[^${label}]: `;
  return { body: next, caret: next.length, label };
}

export const MARK_DELIMITERS: Record<string, string> = { strong: "**", b: "**", em: "*", i: "*", u: "__", s: "~~", strike: "~~", del: "~~", mark: "==" };


/**
 * What an inline element opens with in Markdown, pen included.
 *
 * Kept here, away from the DOM, because it is arithmetic the caret depends
 * on: the editor walks Markdown characters to find a DOM position, so an
 * opening run it mis-measures puts the caret in the wrong place for the rest
 * of the line. `==green:` is six characters longer than `==`.
 */
export function markdownOpenFor(tagName: string, highlightColour?: string): string {
  const delimiter = MARK_DELIMITERS[tagName.toLowerCase()] ?? "";
  if (!delimiter) return "";
  // Only a highlight carries a pen. Without this an element that happened to
  // have a `data-highlight` attribute would be measured as six characters
  // longer than it is — and the caret arithmetic would follow it.
  if (delimiter !== MARK_DELIMITER_BY_KIND.highlight) return delimiter;
  const known = HIGHLIGHT_COLOURS.includes(highlightColour as HighlightColour);
  return known && highlightColour !== "yellow" ? `${delimiter}${highlightColour}:` : delimiter;
}

export type InlineMarkKind = "bold" | "italic" | "underline" | "strike" | "highlight";
const MARK_DELIMITER_BY_KIND: Record<InlineMarkKind, string> = { bold: "**", italic: "*", underline: "__", strike: "~~", highlight: "==" };

/** Toggle one inline mark over `body[start:end]`. Wraps plain selections;
 * unwraps a selection that already carries exactly that delimiter on both
 * ends, so clicking the same toolbar button twice is a real toggle. */
/** Words in a note's Markdown: tokens with a letter or digit in them, so
 * bullets, task boxes and heading or quote marks are not counted (E18). */
export function countWords(markdown: string) {
  return markdown.split("\n").map((line) => line.replace(BLOCK_PREFIX, "")).join(" ")
    .split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** The toolbar's Heading button: each selected line becomes an H2, or back to
 * text when it already is a heading. List items, quotes and tasks keep their
 * own mark (E17). */
export function toggleHeading(body: string, start: number, end: number): { body: string; caret: number } {
  if (end > start && body[end - 1] === "\n") end -= 1;
  const from = body.lastIndexOf("\n", start - 1) + 1;
  const newline = body.indexOf("\n", end);
  const to = newline < 0 ? body.length : newline;
  const lines = body.slice(from, to).split("\n").map((line) => {
    if (/^#{1,3} /u.test(line)) return line.replace(/^#{1,3} /u, "");
    if (!line.trim() || /^\t*(?:> ?|- \[[ xX]\]|[-*+] |\d+\. )/u.test(line)) return line;
    return `## ${line}`;
  });
  const replaced = lines.join("\n");
  return { body: body.slice(0, from) + replaced + body.slice(to), caret: from + replaced.length };
}

/** The toolbar's Link button: `[selection](https://)`, caret at the end of the
 * address so the rest of it can be typed or pasted (E17). */
export function wrapLink(body: string, start: number, end: number): { body: string; caret: number } {
  while (end > start + 1 && /\s/u.test(body[end - 1] ?? "")) end -= 1;
  const text = body.slice(start, end);
  const link = `[${text}](https://`;
  return { body: `${body.slice(0, start)}${link})${body.slice(end)}`, caret: start + link.length };
}

/** A line's nesting tabs, block mark (heading, quote, task box, bullet, number) and leading tabs. */
const BLOCK_PREFIX = /^\t*(?:#{1,3} |> ?|- \[[ xX]\] ?|[-*+] |\d+\. )?\t*/u;

export function toggleInlineMark(
  body: string,
  start: number,
  end: number,
  kind: InlineMarkKind,
  colour?: HighlightColour,
): { body: string; caret: number } {
  if (!body.slice(start, end).includes("\n")) {
    // A double-click on Windows takes the trailing space too; the mark hugs the text.
    while (end > start + 1 && /\s/u.test(body[end - 1] ?? "")) end -= 1;
    while (start < end - 1 && /\s/u.test(body[start] ?? "")) start += 1;
    return toggleLineMark(body, start, end, kind, colour);
  }
  // A mark never crosses a line break. Across lines it used to open on one line
  // and close on the next, which pushed list items out of their list (E6), so
  // each line's own text is marked, after its block mark. Last line first, so
  // the earlier offsets stay valid.
  const pieces: Array<[number, number]> = [];
  let lineStart = start;
  for (const line of body.slice(start, end).split("\n")) {
    pieces.push([lineStart, lineStart + line.length]);
    lineStart += line.length + 1;
  }
  let next = body;
  let caret = end;
  let lengthAfterLast = body.length;
  let lastDone = false;
  for (let index = pieces.length - 1; index >= 0; index -= 1) {
    let [from, to] = pieces[index];
    if (index > 0) from += BLOCK_PREFIX.exec(body.slice(from, to))?.[0].length ?? 0;
    while (from < to && /\s/u.test(body[from] ?? "")) from += 1;
    while (to > from && /\s/u.test(body[to - 1] ?? "")) to -= 1;
    if (from >= to) continue;
    const result = toggleLineMark(next, from, to, kind, colour);
    if (!lastDone) { caret = result.caret; lengthAfterLast = result.body.length; lastDone = true; }
    next = result.body;
  }
  return { body: next, caret: caret + (next.length - lengthAfterLast) };
}

function toggleLineMark(
  body: string,
  start: number,
  end: number,
  kind: InlineMarkKind,
  colour?: HighlightColour,
): { body: string; caret: number } {
  const delimiter = MARK_DELIMITER_BY_KIND[kind];
  const selected = body.slice(start, end);
  const wrapped = selected.length >= delimiter.length * 2 && selected.startsWith(delimiter) && selected.endsWith(delimiter);
  if (wrapped) {
    const inner = selected.slice(delimiter.length, selected.length - delimiter.length);
    if (kind === "highlight") {
      const current = highlightColourOf(inner);
      const bare = current?.text ?? inner;
      const asked = colour ?? "yellow";
      // Picking a DIFFERENT pen over an existing highlight recolours it;
      // picking the same one again is the toggle that removes it. Without
      // this, choosing pink over blue would just clear the highlight and the
      // second click would be needed to get any colour at all.
      if (colour && asked !== (current?.name ?? "yellow")) {
        const pen = asked === "yellow" ? "" : `${asked}:`;
        const repainted = `${delimiter}${pen}${bare}${delimiter}`;
        return { body: body.slice(0, start) + repainted + body.slice(end), caret: start + repainted.length };
      }
      return { body: body.slice(0, start) + bare + body.slice(end), caret: start + bare.length };
    }
    return { body: body.slice(0, start) + inner + body.slice(end), caret: start + inner.length };
  }
  // Re-highlighting in a different colour must not nest: strip the pen that
  // is already there before writing the new one.
  const plain = kind === "highlight" ? (highlightColourOf(selected)?.text ?? selected) : selected;
  const pen = kind === "highlight" && colour && colour !== "yellow" ? `${colour}:` : "";
  const next = `${delimiter}${pen}${plain}${delimiter}`;
  return { body: body.slice(0, start) + next + body.slice(end), caret: start + next.length };
}
