# Language packs

A language pack is **one JSON file** on a GitHub release. Anyone can publish one;
nobody has to ask the Notible developer. Notible lists packs in
**Settings → Languages** (never in the plugin market) and installs them with one
click, or straight from a GitHub repository you paste in.

## 1. Start from the template

`npm run locale:extract` writes `locales/en.json`, the canonical list of every
translatable string. Copy `strings.app` into a new file and translate the
values:

```json
{
  "locale": "de",
  "name": "Deutsch",
  "version": "1.0.0",
  "author": "Your name",
  "strings": {
    "app": {
      "Settings": "Einstellungen",
      "Notes": "Notizen",
      "{count} days ago": {
        "one": "vor {count} Tag",
        "other": "vor {count} Tagen"
      }
    }
  }
}
```

- `locale` — a BCP-47 style tag (`de`, `pt-BR`). It is also the file name Notible
  stores, so only letters, digits and `-` (max 12 characters) are accepted.
  `en` is the source language and cannot be replaced.
- `name` — what people see in the list (max 60 characters).
- `version` — `x.y.z`. When the catalogue lists a newer version, Notible offers an update.
- `strings.app` — the interface. The key is the English text, the value is your translation.
  Keep the `{placeholders}` exactly as they are; you may move them where your grammar needs them.
- Plural forms use the categories of your language (`one`, `few`, `many`, `other`, …).
- A string you leave out simply stays in English.
- Other namespaces in `strings` are for plugins and must be a plugin id.

A few destructive words ("Delete", "Cancel", "Continue", "Remove", "Restore",
"This cannot be undone." and similar) always stay in English, whatever a pack
says. A wrong warning is worse than an English one.

Limits (anything beyond them is dropped, and the rest of the pack still works):
256 KB per file, 5 000 keys per namespace, 300 characters per string.

## 2. Publish it

1. Create a GitHub repository, for example `you/notible-de`.
2. Make a **release** and attach the file, named exactly `language.json`.
3. Anyone can now paste `you/notible-de` into **Settings → Languages → Install from GitHub**.
   The *latest* release is always the one installed.

## 3. Get it listed (optional)

To appear in **Available** for everyone, add an entry to `languages/index.json`
in the market repository (`prejas3/notible-market`) with a pull request:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-21T00:00:00Z",
  "languages": [
    { "locale": "de", "name": "Deutsch", "author": "Your name",
      "description": "German interface", "repo": "you/notible-de", "version": "1.0.0" }
  ]
}
```

The file is served next to the plugin catalogue at
`https://updates.szymonjankiewicz.com/languages/index.json`. It is a separate
document on purpose: the plugin catalogue is validated strictly by older
builds of Notible, and languages and plugins never appear in each other's lists.

## What Notible does with a pack

The pack is parsed and **re-written by Notible's native side**; the downloaded
text is never stored as-is. A pack cannot contain code, cannot read files, and
cannot change anything except interface text.
