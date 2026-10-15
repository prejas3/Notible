---
id: plugin-queries
title: Embedded queries
keywords: queries live list block filter tasks due status notible code block plugin
plugin: notible.queries
---

Lets a note ask a question instead of holding a copy. Type `/` and pick **Live list of matching items**, then describe what you want — for example, open tasks due within the next seven days (overdue ones included):

```
type: task
status: open
due: <= +7d
```

The note answers with whatever matches each time you open it. The rows are the real items: clicking one opens it. The block explains every option underneath itself.

**Off by default.** The `/` menu offers this block only while the plugin is on.

[Open Settings → Plugins](settings:plugins)
