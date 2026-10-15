# Your first Notible plugin in five minutes

You don't need npm, a bundler, TypeScript or an account anywhere. A Notible
plugin is **two files**, and the app loads them from disk exactly as you wrote
them.

## 1. Generate a skeleton

Settings → **Plugins** → **Market** tab → **Create plugin folder**. Point it at
the directory where you want to keep your plugins.

A subdirectory is created with three files:

```
local.plugin-abc123/
├── plugin.json    ← manifest: who the plugin is and what it wants
├── main.js        ← code
└── README.md
```

If you prefer to start by hand, the first two are enough.

## 2. Install it

In the same place: **Add plugin folder** → point it at the folder you created.

You'll see a native warning with the name, version and permission list. Read it
once, carefully — it appears before anything runs, and Notible **does not
sandbox plugin code** (see [Trust model](#trust-model)). Click *Install and
run*.

A "Hello from …" panel appears in the sidebar, and "Say hello" appears in the
command palette.

## 3. Change something

Open `main.js` in any editor, change the text, save. Go back to Settings →
Plugins → **Enabled** tab and click **Reload** next to your plugin. The change
is visible immediately — you don't have to uninstall or restart the app.

That's the whole work loop.

## What `plugin.json` looks like

```json
{
  "id": "acme.focus",
  "name": "Focus tools",
  "version": "0.1.0",
  "apiVersion": "1.28",
  "description": "In short: what this plugin does.",
  "author": "Your name",
  "entry": "main.js",
  "permissions": ["data.read", "workspace.ui"]
}
```

- **`id`** — lowercase letters, digits, dots and hyphens (`acme.focus`,
  `acme-focus`). Must be unique and **can never change again**: it is how
  Notible recognises updates.
- **`apiVersion`** — today `"1.28"`. The host checks it at load time.
- **`entry`** — a path relative to the plugin directory, `.js` or `.mjs`.
  Paths that leave the directory (`../`) are rejected.
- **`permissions`** — see [Permissions](REFERENCE.md#permissions). Declare only
  what you actually use: this list is shown to the user at install time.

**The manifest must appear twice** — in `plugin.json` and in the code — and
`id`, `version` and `apiVersion` must match. Notible compares them at load time
and refuses if they differ.

## What `main.js` looks like

```js
export default {
  manifest: {
    id: "acme.focus",
    name: "Focus tools",
    version: "0.1.0",
    apiVersion: "1.28",
    permissions: ["data.read", "workspace.ui"],
  },

  onload(context) {
    // Register everything the plugin contributes here.
  },

  onunload() {
    // Clean up anything you didn't cover with a Disposable here.
  },
};
```

`onload` receives a [`PluginContext`](REFERENCE.md#plugincontext) — the only
thing you need. You don't import anything from inside Notible.

## Four things you can do right away

### A command

```js
context.commands.register({
  id: "archive-old",
  name: "Archive old notes",
  hotkey: "Mod+Shift+A",
  execute: async () => {
    const notes = await context.data.objects.query({ type: "note" });
    return { found: notes.length };
  },
});
```

### A panel in the UI

```js
context.ui.registerSlot("workspace.sidebar", {
  id: "panel",
  mount({ container, plugin }) {
    const box = document.createElement("div");
    box.textContent = "Hi";
    container.append(box);
    return { dispose: () => box.remove() };
  },
});
```

`mount` receives a ready-made element and must return something to clean up.
You can use any library inside it — or, as above, plain DOM.

### Reacting to events

```js
context.events.on("object.created", ({ id, type }) => {
  if (type === "note") context.ui.notice("New note");
});
```

### Your own settings

```js
context.settings.register({
  id: "settings",
  title: "Focus tools",
  schema: {
    sections: [{
      fields: [
        { kind: "number", key: "minutes", label: "Minutes", default: 25, min: 1 },
        { kind: "toggle", key: "loud", label: "Notifications", default: true },
      ],
    }],
  },
});
```

You **declare settings, you don't draw them** — Notible renders them natively,
so they look like the rest of the app. Read values with
`context.storage.get("minutes")`.

## Trust model

Notible follows Obsidian's path: **plugin code is not sandboxed**. A plugin
with code can do anything the user can on that machine — read and change any
note, reach the network, invoke any app command.

What this means for you as an author:

- `permissions[]` is a **declaration of intent**, enforced on the mediated API
  (`context.data`, `context.ui`), but bypassable by code that calls the backend
  directly. Do not treat it as a security boundary — treat it as a promise made
  to the user.
- The install screen shows your name, description and permissions. Write them
  honestly.
- A package **without** `entry`, containing only CSS, installs without a
  warning — because CSS alone cannot exfiltrate anything.

## Publishing to the market

Notible does not host or sign community plugins. You host yours on **GitHub
Releases**; the market is a catalog of pointers, reviewed once per plugin.

1. **Build** `plugin.json` and `<id>.zip` (zip root holds `plugin.json` + the
   `entry` file — no top-level folder). `id` is namespaced lowercase
   (`somedevs.kanban`) and identical in the manifest, the zip name and the
   catalog entry. `plugin.json` needs `id`, `name`, `version`, `apiVersion`,
   `minCoreVersion`, `entry`.
2. **Publish a GitHub Release** on your plugin's *public* repo with both files
   attached as assets, named exactly `plugin.json` and `<id>.zip`. Notible
   always reads `https://github.com/<owner>/<repo>/releases/latest/download/…`,
   so "latest" must point at the release users should get. A newer release
   ships an update automatically — no re-review.
3. **Open a PR** to
   [`github.com/prejas3/notible-market`](https://github.com/prejas3/notible-market)
   adding one entry to `catalog.json`. Its `CONTRIBUTING.md` has the exact
   steps and the review checklist. On merge, the plugin is live in the market
   within a minute. This PR is only needed once per plugin (a new id, or a
   change of repo/author) — every later version bump needs nothing here,
   since the client always resolves `releases/latest` live at install/update
   time.

The install screen tells the user the plugin is not reviewed by Notible for
that version — write your name, description and permissions honestly.

## What next

- [Full API documentation](REFERENCE.md) — every type, method and slot.
- `examples/pomodoro/` in this pack — a complete, working plugin using
  everything above.
- `notible-plugin-api.d.ts` — types to wire into your editor if you want
  autocomplete and type checking without configuring TypeScript.

## Common problems

| Symptom | Cause |
|---|---|
| "plugin path must stay inside package" | `entry` leaves the directory or is not `.js`/`.mjs` |
| "plugin entry manifest does not match plugin.json" | `id`, `version` or `apiVersion` differ between the files |
| "lacks permission workspace.ui" | you register UI without `"workspace.ui"` in `permissions` |
| "Duplicate registration" | the same registration `id` twice in one plugin |
| "unknown UI slot" | a slot name outside the [list](REFERENCE.md#slots); the registration is skipped, the rest of the plugin runs |
| Panel disappears after Reload | `mount` didn't return a `Disposable`, or `dispose` doesn't remove elements |
