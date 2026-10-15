---
id: plugin-editor-extensions
title: Editor extensions
keywords: editor code blocks syntax highlighting mermaid diagrams flowchart plugin
plugin: notible.editor-extensions
---

Adds richer blocks to notes: code blocks with syntax highlighting, and **Mermaid diagrams** — flowcharts, sequence diagrams, Gantt charts and more, drawn from text.

To add a diagram, type `/` in a note and pick **Mermaid diagram**. A drawn diagram hides its code; to change it, click the **mermaid · edit** bar above it, or right-click it and choose **Edit code**. The full diagram syntax is on [mermaid.js.org](https://mermaid.js.org).

Hover a drawn diagram for its buttons: **Expand** opens it full screen (scroll to zoom, drag to move, Esc to close), **Copy image** copies it as a picture you can paste into mail or a document, and **SVG** / **PNG** save it to a file.

**Changing how a diagram looks.** Settings go at the very top of the diagram's code, between two `---` lines, and travel with the note to every device:

```
---
config:
  theme: forest
  look: handDrawn
  layout: elk
---
flowchart TB
  A --> B
```

`theme` can be `default`, `neutral`, `dark`, `forest` or `base`. `look: handDrawn` gives a sketch style. `layout: elk` switches to a second layout engine that often arranges bigger diagrams more neatly. Every option is listed in [Mermaid's configuration docs](https://mermaid.js.org/config/schema-docs/config.html).

**On by default.**

[Open Settings → Plugins](settings:plugins)
