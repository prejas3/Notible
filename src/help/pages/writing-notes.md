---
id: writing-notes
title: Writing notes
keywords: write editor format bold italic underline highlight heading list checklist quote code columns divider link backlink footnote image paste undo markdown
---

Notes are written in plain text with a few marks, the way Markdown works. What you type is what gets saved, so a note exported as Markdown looks the same anywhere.

## Blocks from the / menu

Type `/` in a note to insert a block:

| Block | What it is |
|---|---|
| Heading 1, 2, 3 | Section titles |
| Bullet list, Numbered list | Lists; `Enter` on an empty item ends the list |
| Task list | A checklist — click the box to tick an item |
| Quote | A quoted passage; `Enter` continues below it, `Shift+Enter` adds a line inside it |
| Code block | Code or any text kept exactly as typed |
| Columns | A two-column block |
| Divider | A horizontal line |
| Table | A small table |
| Link | A link to a web page |
| Image | A picture from a file |

A code block's top bar has a **Format** button: it sorts lines, removes duplicate lines, trims spaces, changes the case, and in a `json` block pretty prints or minifies. Right-clicking the block offers the same tools.

## Typing a block

You can also start a block by typing its mark at the start of any line, followed by a space: `#`, `##` or `###` for a heading, `>` for a quote, `-` for a bullet, `1.` for a numbered list, and `- [ ]` for a checklist item. The line changes as soon as you press the space.

Press `Enter` in a note's title to start writing underneath it.

The menu also creates a whiteboard, project, task or issue without leaving the keyboard. Plugins add more blocks, such as Mermaid diagrams ([Editor extensions](help:plugin-editor-extensions)) or live lists ([Embedded queries](help:plugin-queries)).

## Bold, italic and highlights

Select text and use the small toolbar that appears above it, or type the marks yourself:

| You type | You get |
|---|---|
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `__underline__` | underlined text |
| `~~strike~~` | struck-through text |
| `==highlight==` | a yellow highlight |
| `==green:highlight==` | a highlight in green, blue, pink, purple or orange |

## Links between notes

Type `[[` and start typing a note's title, then pick it from the list. The link shows the note's title; `Ctrl+click` opens it, and a plain click puts the cursor in it so you can change it. `Alt+←` takes you back to the note you came from. Rename a note and every link to it shows the new title. The bottom of a note lists the other notes that link to it — its **backlinks** — while **Backlinks and document stats** is on in Settings → Editor.

## The Tab key

In a note, `Tab` adds a gap in text, indents in a code block (`Shift+Tab` takes it back; with several lines selected, all of them move), and jumps to the next cell in a table. To leave the note with the keyboard, press `Esc` and then `Tab`.

## Links to web pages

Select some text and paste a web address: the text becomes a link. Pasting an address with nothing selected gives a link too, and text copied from a web page keeps its links. You can also type one yourself: `[text](https://address)`.

A link shows only its text with a small arrow. Put the cursor in it to see and change the address. `Ctrl+click` opens it in your browser; a plain click just places the cursor, so the text is easy to edit.

## Footnotes

Press `Ctrl+Alt+F` to add a numbered footnote at the cursor. Its text goes at the end of the note. Ctrl+click a footnote number to jump between the mark and its text.

## Images

Paste a screenshot or an image straight into a note. It is stored with your workspace.

## Undo

`Ctrl+Z` undoes, `Ctrl+Y` redoes.
