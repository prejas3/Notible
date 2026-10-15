# Theme packs

A theme pack is a **styles-only package** on a GitHub release. Anyone can publish
one; nobody has to ask the Notible developer. Notible lists packs in
**Settings → Themes** (never in the plugin market) and installs them with one
click, or straight from a GitHub repository you paste in. Daylight and Midnight
are built into the app, chosen in Settings → Appearance, and unaffected by packs.

A theme is **pure CSS**. It cannot contain code, and Notible checks and rebuilds
its CSS before wearing it.

## Package layout

```
plugin.json     manifest (see below)
theme.css       your styles (listed in "styles")
assets/…        optional images and fonts (png jpg jpeg webp gif woff2, 1.4 MB each, 24 max)
```

```json
{
  "id": "yourname.glass",
  "name": "Glass",
  "version": "1.0.0",
  "apiVersion": "1.0",
  "author": "Your name",
  "description": "…",
  "styles": ["theme.css"],
  "theme": { "name": "Glass", "mode": "dark", "description": "…" }
}
```

* No `entry`: a package with `theme` and code is rejected.
* `theme.mode` (`light` | `dark`) is the base Notible switches to while the pack
  is active. Your CSS is drawn on top of it.

## What you can style

Three levels, from safest to most powerful. Prefer the first two: they are the
**stable contract** and keep working across Notible versions.

### 1. Colour tokens

Override on `:root`: `--notible-background --notible-surface --notible-raised
--notible-hover --notible-active --notible-border --notible-border-subtle
--notible-text --notible-muted --notible-faint --notible-accent
--notible-accent-hover --notible-on-accent --notible-selected
--notible-selected-soft --notible-danger --notible-success --notible-warning`.
Fonts: `--notible-font-sans --notible-font-serif --notible-font-mono`
(ship a font as woff2 with `@font-face`).

### 2. Layout tokens (one value per surface, no selectors)

| Token | What it paints | Default |
|---|---|---|
| `--notible-app-backdrop` | background of the whole app: any `background` value, a gradient or `url("assets/bg.jpg")` | the background colour |
| `--notible-sidebar-background` | sidebar background | the background colour |
| `--notible-sidebar-filter` | `backdrop-filter` of the sidebar, e.g. `blur(18px)` for glass | `none` |
| `--notible-main-background` | the main work area, drawn over the app backdrop | transparent |
| `--notible-editor-font-size` | note text size | `15px` |
| `--notible-editor-line-height` | note line height | `1.7` |

Glass tip: for the sidebar to look frosted, give the app a backdrop that is not
flat (gradient or image), a translucent `--notible-sidebar-background` and a
`--notible-sidebar-filter`. Note that a sidebar filter can shift pop-ups drawn
from inside the sidebar; if you see that, leave the filter off.

### 3. Stable selectors

Attributes that never change name, so a theme can target a situation without
relying on internal class names:

| Selector | Meaning |
|---|---|
| `:root[data-notible-mode="light"]` / `"dark"` | the base the theme is drawn on |
| `:root[data-notible-theme="your.id"]` | present only while *your* theme is active |
| `[data-notible-region="sidebar"]` | the sidebar |
| `[data-notible-region="main"]` | the main work area |
| `[data-notible-region="editor"]` | the note text area |
| `.core-shell[data-notible-density="comfortable"]` / `"compact"` | the Density setting |

Motion: `@keyframes`, `transition`, `@media`, `@supports`, `@container`,
`@font-face` (woff2 from the package) and `@property` are all allowed. Other
`.core-*` classes work too but are internal and may change between versions.
Reference package files as `url("assets/bg.jpg")` (relative path only).

## What is removed

Notible drops, silently, anything it cannot verify: `@import`, `image-set()`,
`element()`, `paint()`, any `url()` that is not a relative file inside your
package (no `http:`, no `data:`, no `..`), `!important`, and anything it does not
understand. CSS is limited to 512 KB.

Some UI is **protected** and cannot be hidden or restyled into something
misleading: the Themes screen itself, delete/restore confirmations and dialogs.
If a theme ever makes the app hard to use, **Ctrl+Alt+Shift+T** turns the theme off,
and Notible turns a theme off by itself if the previous start with it did not
complete.

## Publishing

1. Create a GitHub repository, for example `you/notible-glass`, with the files above.
2. Zip them as `<id>.zip` (files at the zip root, not inside a folder) and make a
   GitHub **release** with exactly two assets: `<id>.zip` and `plugin.json`.
   Raise `version` in `plugin.json` for every release; the *latest* release is the
   one that gets installed.
3. Anyone can now paste `you/notible-glass` into
   **Settings → Plugins → Themes → Install from GitHub**. A release that is not a
   theme pack is refused.
4. Test it yourself first: install your own release, switch light/dark in
   Settings → Appearance, and check the sidebar, a note, Settings and a dialog.

## Get it listed (optional)

To appear under **Available** for everyone, add an entry to `themes/index.json` in
the market repository (`prejas3/notible-market`) with a pull request:

```json
{
  "schemaVersion": 1,
  "themes": [
    { "id": "you.glass", "name": "Glass", "author": "Your name", "description": "Frosted glass", "repo": "you/notible-glass" }
  ]
}
```

The file is served at `https://updates.szymonjankiewicz.com/themes/index.json`. It is
separate from the plugin catalogue on purpose: the market shows only plugins, the
Themes screen only themes, and Settings → Languages only languages.

A working example lives in `examples/theme-glass/`.

## Image tips

* Keep each image **under 1.4 MB** (Notible refuses larger files). The browser
  engine silently drops a CSS value bigger than about 2 MB once the image is
  embedded, so a bigger picture would simply not show. A full-screen background
  is fine as a **JPEG or WebP around 1920 px wide** (typically 200 to 600 KB);
  PNG screenshots of artwork are usually several times larger.
* The extension must match the real format: Notible checks the file's first
  bytes, and a PNG renamed to `.jpg` is refused.
