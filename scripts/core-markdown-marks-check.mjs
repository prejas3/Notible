import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const { countWords, inlineHtml, toggleHeading, toggleInlineMark, wrapLink, highlightColourOf, markdownOpenFor, HIGHLIGHT_COLOURS, insertFootnote, orphanedFootnotes } = await import(pathToFileURL(resolve(root, "src/core/app/coreMarkdownMarks.ts")).href);
const renderCoreMarkdown = (value) => `<p>${inlineHtml(value)}</p>`;

assert.match(renderCoreMarkdown("**bold**"), /<p><strong>bold<\/strong><\/p>/, "bold did not parse");
assert.match(renderCoreMarkdown("*italic*"), /<p><em>italic<\/em><\/p>/, "italic did not parse");
assert.match(renderCoreMarkdown("__underline__"), /<p><u>underline<\/u><\/p>/, "underline did not parse");
assert.match(renderCoreMarkdown("~~strike~~"), /<p><s>strike<\/s><\/p>/, "strikethrough did not parse");
assert.match(renderCoreMarkdown("==highlight=="), /<p><mark class="core-md-highlight">highlight<\/mark><\/p>/, "highlight did not parse");
assert.match(renderCoreMarkdown("**bold** and *italic*"), /<strong>bold<\/strong> and <em>italic<\/em>/, "mixed marks on one line did not parse");
assert.match(renderCoreMarkdown("plain [[Wiki Link]] text"), /core-md-wikilink/, "wikilink parsing regressed after adding mark alternatives");

// --- a tab stays a visible gap and stays "\t" as text
assert.equal(inlineHtml("a\tb"), 'a<span class="core-md-tab">\t</span>b', "a tab should render as a gap span");

// --- hyperlinks: every character stays text (caret math), only web/mail URLs
const linked = inlineHtml("see [SAP TM docs](https://help.sap.com/tm?a=1&b=2) now");
assert.match(linked, /<span class="core-md-link" data-url="https:\/\/help\.sap\.com\/tm\?a=1&amp;b=2"/, "link did not parse");
assert.equal(linked.replace(/<[^>]+>/gu, "").replaceAll("&amp;", "&"), "see [SAP TM docs](https://help.sap.com/tm?a=1&b=2) now", "a link must keep every character as text");
assert.match(inlineHtml("[mail me](mailto:a@b.pl)"), /core-md-link/, "mailto link did not parse");
assert.doesNotMatch(inlineHtml("[x](javascript:alert(1))"), /core-md-link/, "javascript: must never become a link");
assert.doesNotMatch(inlineHtml("[x](notes/page)"), /core-md-link/, "a relative path is not a link");
assert.match(inlineHtml("![alt](media/a.png)"), /<img/, "image parsing regressed after adding links");
assert.match(inlineHtml("[^1] and [[Page]]"), /core-md-fnref[\s\S]*core-md-wikilink/, "footnote/wikilink parsing regressed after adding links");

const wrapped = toggleInlineMark("hello world", 0, 5, "bold");
assert.equal(wrapped.body, "**hello** world", "toggleInlineMark should wrap plain text");
assert.equal(wrapped.caret, 9, "toggleInlineMark caret should land after the closing delimiter");
// E6 (01.10): a selection across lines used to write the opening mark on one
// line and the closing one on the next, which pushed list items out of their
// list. Marks stay inside each line, after its list/heading/quote mark.
const across = toggleInlineMark("- \tDesigner role\n- Office move", 12, 25, "highlight", "blue");
assert.equal(across.body, "- \tDesigner ==blue:role==\n- ==blue:Office== move", "a mark across lines must be applied per line, after each line's prefix");
assert.equal(across.caret, "- \tDesigner ==blue:role==\n- ==blue:Office==".length, "the caret lands after the last marked piece");
assert.equal(toggleInlineMark("# Title\n\n## Sub", 2, 15, "bold").body, "# **Title**\n\n## **Sub**", "headings keep their # and blank lines stay blank");
assert.equal(toggleInlineMark("- [ ] buy\n> quote", 6, 17, "italic").body, "- [ ] *buy*\n> *quote*", "task boxes and quote marks stay outside the mark");
// E5: nested bullets are written with leading tabs; the mark goes after them too.
assert.equal(toggleInlineMark("- Hiring\n\t- Frontend role", 2, 25, "bold").body, "- **Hiring**\n\t- **Frontend role**", "a nested bullet keeps its tabs and dash outside the mark");
assert.equal(toggleHeading("\t- item", 3, 7).body, "\t- item", "a nested list item is left alone by Heading");
assert.equal(countWords("- a\n\t- b c"), 3, "nested bullets are not words");
// A double-click on Windows selects the word plus its trailing space; the
// mark must still hug the word ("==Designer== role", not "==Designer ==role").
assert.equal(toggleInlineMark("Designer role", 0, 9, "highlight", "blue").body, "==blue:Designer== role", "a mark never starts or ends with a space");
const unwrapped = toggleInlineMark(wrapped.body, 0, 9, "bold");
assert.equal(unwrapped.body, "hello world", "toggleInlineMark should unwrap an already-bold selection");

// --- coloured highlighting
// The pen travels inside the note as `==green:text==`, so the parser has to
// tell a pen from ordinary text that merely starts with a word and a colon.
assert.match(inlineHtml("==green:done=="), /<mark class="core-md-highlight" data-highlight="green">done<\/mark>/);
assert.match(inlineHtml("==plain=="), /<mark class="core-md-highlight">plain<\/mark>/, "no pen means the default");
assert.match(inlineHtml("==note: call them back=="), /<mark class="core-md-highlight">note: call them back<\/mark>/,
  "an ordinary colon must not be read as a pen");
assert.equal(highlightColourOf("blue:x").name, "blue");
assert.equal(highlightColourOf("teal:x"), null, "only the pens that exist");
assert.equal(highlightColourOf("green:"), null, "a pen with no text is not a highlight");

// Applying, recolouring and removing, which is where a naive implementation
// nests `==blue:==green:text====` or leaves the pen behind as literal text.
const painted = toggleInlineMark("hello world", 0, 5, "highlight", "blue");
assert.equal(painted.body, "==blue:hello== world");
const repainted = toggleInlineMark(painted.body, 0, painted.caret, "highlight", "pink");
assert.equal(repainted.body, "==pink:hello== world", "recolouring must replace the pen, not stack it");
const removed = toggleInlineMark(repainted.body, 0, repainted.caret, "highlight");
assert.equal(removed.body, "hello world", "unwrapping must take the pen with it");
const yellow = toggleInlineMark("hello world", 0, 5, "highlight", "yellow");
assert.equal(yellow.body, "==hello== world", "the default pen is written as no pen at all");
assert.equal(HIGHLIGHT_COLOURS[0], "yellow");

// The caret walks Markdown characters to find a DOM position, so the opening
// run of every element has to be measured exactly. A pen it does not count
// puts the caret six characters off for the rest of the line — the bug this
// pair of functions exists to prevent.
assert.equal(markdownOpenFor("mark"), "==");
assert.equal(markdownOpenFor("mark", "yellow"), "==", "the default pen is not written, so it costs nothing");
assert.equal(markdownOpenFor("mark", "green"), "==green:");
assert.equal(markdownOpenFor("mark", "green").length, "==".length + "green:".length);
assert.equal(markdownOpenFor("mark", "teal"), "==", "a colour that does not exist was never written into the note");
assert.equal(markdownOpenFor("strong"), "**");
assert.equal(markdownOpenFor("strong", "green"), "**", "only a highlight carries a pen");
assert.equal(markdownOpenFor("p"), "", "a block element opens with nothing inline");

// Footnotes: the marker keeps its literal text inside the span, so the caret
// arithmetic and the serializer see the same characters as before.
assert.equal(inlineHtml("word[^1] more"), "word<span class=\"core-md-fnref\" data-fn=\"1\">[^1]</span> more");
assert.equal(inlineHtml("[[Note]] then [^a]").includes("core-md-wikilink"), true, "wikilinks still parse beside footnotes");
{
  const first = insertFootnote("Hello world.", 5);
  assert.equal(first.body, "Hello[^1] world.\n\n[^1]: ", "first footnote: marker in text, definition opened at the end");
  assert.equal(first.caret, first.body.length, "caret lands inside the new definition");
  const second = insertFootnote("A[^1] and B.\n\n[^1]: Source one", 12);
  assert.equal(second.label, "2", "next label follows the highest existing one");
  assert.equal(second.body, "A[^1] and B.[^2]\n\n[^1]: Source one\n[^2]: ", "later definitions stack under earlier ones");
  assert.equal(insertFootnote("x", 999).body, "x[^1]\n\n[^1]: ", "offset is clamped to the note");
}

// A deleted marker orphans its definition — but only when the marker is really gone.
{
  const before = "Hello[^1] world[^2].\n\n[^1]: One\n[^2]: Two";
  assert.deepEqual(orphanedFootnotes(before, "Hello world[^2].\n\n[^1]: One\n[^2]: Two"), ["1"], "marker deleted -> its note is orphaned");
  assert.deepEqual(orphanedFootnotes(before, "Hello world.\n\n[^1]: One\n[^2]: Two"), ["1", "2"], "deleting a run of text orphans every note inside it");
  assert.deepEqual(orphanedFootnotes(before, "Hello[^1 world[^2].\n\n[^1]: One\n[^2]: Two"), [], "a half-deleted marker (being retyped) is left alone");
  assert.deepEqual(orphanedFootnotes(before, "Hello^1] world[^2].\n\n[^1]: One\n[^2]: Two"), [], "a marker missing its opening bracket is being retyped too");
  assert.deepEqual(orphanedFootnotes("Text.\n\n[^7]: written first", "Text more.\n\n[^7]: written first"), [], "a definition typed before its marker is never removed");
  assert.deepEqual(orphanedFootnotes(before, before), [], "no change, no orphans");
}


// --- E18 (01.10): the word count counts words, not Markdown marks.
assert.equal(countWords("- [ ] buy milk\n- [x] call Anna"), 4, "checklist boxes and bullets are not words");
assert.equal(countWords("## Next steps\n> a quote\n1. first"), 5, "heading, quote and number marks are not words");
assert.equal(countWords("**bold** and [[Meeting notes]]"), 4, "marked words still count once");
assert.equal(countWords("   "), 0);

// --- E17 (01.10): Heading and Link buttons in the selection toolbar.
assert.deepEqual(toggleHeading("intro text\nmore", 2, 5), { body: "## intro text\nmore", caret: 13 }, "Heading makes the selected line an H2");
assert.deepEqual(toggleHeading("## intro text", 4, 8), { body: "intro text", caret: 10 }, "Heading on a heading turns it back into text");
assert.equal(toggleHeading("a\nb\nc", 0, 3).body, "## a\n## b\nc", "every selected line becomes a heading");
assert.equal(toggleHeading("- item", 2, 6).body, "- item", "a list item is left alone");
assert.deepEqual(wrapLink("see the docs now", 4, 12), { body: "see [the docs](https://) now", caret: 23 }, "Link wraps the selection and leaves the caret in the address");
assert.equal(wrapLink("see the docs now", 4, 13).body, "see [the docs](https://) now", "a trailing space stays outside the link");

console.log("Core markdown mark parsing checks passed.");
