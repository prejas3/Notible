# Notible — plugin author documentation

API version: **1.28** (frozen on 1.x)

The same content is available from inside the app: Settings → **Plugins** →
**Market** tab → **Developer pack**. The button writes to disk a complete set
of files matching **exactly the version of the app** you have installed — the
documentation is compiled into the binary, so it cannot drift from what
actually runs.

## What's in the pack

| File | Purpose |
|---|---|
| [`START.md`](START.md) | **Start here.** A working plugin in five minutes, no npm and no bundler. |
| [`REFERENCE.md`](REFERENCE.md) | Full documentation: every type, method, slot, event and permission. |
| `notible-plugin-api.d.ts` | Types for editor autocomplete and checking. Optional. |
| `examples/pomodoro/` | A complete, working plugin: panel, commands, settings, notifications, storage. |
| [`THEME_PACKS.md`](../THEME_PACKS.md) | Community themes: styling tokens and stable selectors, packaging, publishing. Example in `examples/theme-glass/`. |
| [`LANGUAGE_PACKS.md`](../LANGUAGE_PACKS.md) | Community languages: translate one JSON file (start from `examples/language/en.json`) and publish it. |

## In three sentences

A Notible plugin is a folder with a `plugin.json` and a JavaScript module. The
app loads that module straight from disk — there is no build step, no
dependencies, no registration anywhere. The only thing you get and the only
thing you need is the `PluginContext` object passed to `onload`.

```js
export default {
  manifest: { id: "acme.hello", name: "Hello", version: "0.1.0", apiVersion: "1.22", permissions: ["workspace.ui"] },
  onload(context) {
    context.commands.register({ id: "hi", name: "Say hi", execute: () => context.ui.notice("Hi") });
  },
};
```

## Before you start

Notible **does not sandbox plugin code** — a deliberate decision, the same one
Obsidian makes. A plugin with code can do anything the user can on that
machine. For you as an author that means one thing: the permission list and
description you put in the manifest are shown to the user at install time and
are the only thing they base their decision on. Write them honestly.

Details: [START.md → Trust model](START.md#trust-model).
