# Publishing a plugin to the Notible community market

The catalog and the full submission procedure now live in a dedicated public
repo:

**https://github.com/prejas3/notible-market** — see its `CONTRIBUTING.md`.

In short:

1. **Package** — your build produces `plugin.json` and `<id>.zip` (zip root
   holds `plugin.json` + the `entry` file, no top-level folder; 50 MiB / 1000
   entries / 10 MiB per file; no symlinks or `..`). `id` is namespaced
   lowercase and identical everywhere.
2. **Publish a GitHub Release** on your plugin's *public* repo with both files
   as assets named exactly `plugin.json` and `<id>.zip`. The client always
   reads `releases/latest/download/…`, so "latest" must point at the release
   users should get. A newer release ships an update — no re-review.
3. **Open a PR** to `prejas3/notible-market` adding one entry to `catalog.json`.
   On merge, CI validates, regenerates `index.json` and uploads it to R2.

Notible does not host or sign community plugins. Every install shows the user a
warning that the plugin is not reviewed by Notible for that version.
