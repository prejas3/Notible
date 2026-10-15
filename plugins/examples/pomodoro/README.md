# Pomodoro — example external plugin

The simplest complete Notible plugin: two files, zero dependencies, zero build
step. What you write in `main.js` is what runs — Notible serves that file to
the webview over the `plugin:` scheme and imports it as an ES module.

```
pomodoro/
├── plugin.json   ← manifest
└── main.js       ← code, export default { manifest, onload, onunload }
```

## Install and test

1. Settings → Plugins → Market tab → **Add plugin folder**.
2. Point it at this directory.
3. A native warning appears with the name, version and permissions. This is the
   moment when **nothing has run yet** — the code loads only after you click
   "Install and run".
4. The timer appears at the bottom of the sidebar, above "Import Markdown".

What to look at:

- **Start / Pause / Reset / Skip** work, the clock counts down.
- **Skip** ends the phase and shows a toast in the bottom-right corner — that
  is an overlay belonging to Core (`ui.notice`), not something the plugin drew
  itself.
- The completed-session counter goes up.
- Switch the theme in Settings — the panel moves to Night with the app,
  because it uses host tokens instead of its own colours.
- **Disable the plugin** in Settings → the panel disappears and the countdown
  stops.
- **Restart the app** → the plugin should still be there. That was the broken
  thing before 0.40.0.

## What this example touches

| Contract element | Where |
|---|---|
| `ui.registerSlot` + `mount` | panel in the sidebar |
| `ui.notice` | toast at the end of a phase |
| `commands.register` + `hotkey` | "Pomodoro: start or pause" |
| `storage` | completed-session counter |
| `Disposable` from `mount` | unsubscribing when the panel is removed |
| `onunload` | stopping `setInterval` |

## Known limitations — this is the state of the API, not of this plugin

- **`styles[]` is not loaded yet**, so styles are applied inline from JS.
  Eventually the plugin will ship its own stylesheet (decision D5).
- ~~Colours come from `--core-*`.~~ The D3/D6 migration is done: the plugin
  uses the public `--notible-*`.
- **`storage` is in memory**, so the session counter does not survive a
  restart.
- **Only the `workspace.sidebar` slot is rendered.** The other five names from
  `UI_SLOTS` pass validation, but there is no rendering site for them yet.

## Automated test

```
npm run test:pomodoro-example
```

Loads this directory through the real loader and the real `ExtensionHost`,
runs the commands, mounts the panel and checks cleanup after uninstall.
