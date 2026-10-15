# Notible release and update operations

Last confirmed: 2026-10-12

## Migration freeze

Ten dokument opisuje istniejące artefakty i docelowe operacje publikacyjne, ale
nie jest instrukcją aktywacji Cloudflare podczas przebudowy architektury.
Publikacja, hosting, D1/R2 i zdalne aktualizacje pozostają zamrożone do czasu
przejścia lokalnej bramki `GO` dla pełnego rozdzielenia Core/pluginów. W fazie
lokalnej nie nadpisujemy produkcyjnych manifestów ani bucketu.

## Current release

- The published release is `0.96.0` (`latest.json` pub_date 2026-10-08). Next: `0.97.0`, see `RELEASE_CHECKLIST_0.97.0.md` (internal, not published).
- Cloudflare R2 bucket: `notible-updates`.
- Objects are uploaded at the bucket root; do not create a version subfolder.
- Public update manifest: `https://updates.szymonjankiewicz.com/latest.json`.
- `latest.json` points the Windows updater to the signed NSIS installer:
  `https://updates.szymonjankiewicz.com/Notible_0.96.0_x64-setup.exe`.
- Intended rule: old installers stay in the bucket and are never removed by a release. No script in this repo deletes or lifecycle-expires bucket objects; uploads are manual (dashboard or `wrangler r2 object put`).
- Checked 12.10.2026 with read-only HEAD requests, this is not what the bucket holds: `Notible_<v>_x64-setup.exe` returns 404 for every version from 0.22.0 to 0.81.2 (0.80.2 among them), 200 for 0.81.3 through 0.96.0. Cause outside the repo; see "Old installers" below.

Published `0.96.0` objects (the same six-file layout for every release):

- `Notible_0.96.0_x64-setup.exe`
- `Notible_0.96.0_x64-setup.exe.sig`
- `Notible_0.96.0_x64_en-US.msi`
- `Notible_0.96.0_x64_en-US.msi.sig`
- `latest.json`
- `SHA256SUMS`

## Tauri updater decisions

- Updating from `0.22.0` to `0.23.0` is an in-place update; users do not need to uninstall first.
- This is not a byte-level delta update. The signed updater downloads the signed installer artifact and replaces the installed application.
- The same Tauri signing key pair must be used for future releases. Never generate a replacement key unless the public key is intentionally rotated and the update path is planned.
- The public key is stored in `src-tauri/tauri.conf.json`.
- The private key remains local at `%USERPROFILE%\.notible\notible.key`. Never commit it, upload it, or paste it into chat.
- The matching public-key file is also kept locally at `%USERPROFILE%\.notible\notible.key.pub` for operator verification. It is not uploaded as a release artifact.
- The private key is password-protected. A release build must have the key available through `TAURI_SIGNING_PRIVATE_KEY` and its password available locally to the signing process.

## Release procedure

1. Update all version metadata and run `npm run release:check`.
2. Run `npm test` and `npm run build`.
3. Close all running Notible instances before `npm run tauri build`; a running `notible.exe` or installed `NotibleApp.exe` can lock the release binary and cause Windows error 5.
4. Build with the existing Tauri private key and enter its password when requested.
5. Confirm both installers and both `.sig` files exist.
6. Run `npm run release:updater-package` for the NSIS installer with the MSI passed as `--extra-artifact`; this creates `latest.json`, both signatures and both SHA-256 entries in one step.
7. Confirm the MSI and its signature are present in the same publish folder.
8. Run `npm run release:validate-package`; it must confirm exactly six files, both installer hashes, the manifest version and the signed NSIS URL.
9. Upload all six objects directly into the root of the `notible-updates` R2 bucket. Replace `latest.json` and `SHA256SUMS` when prompted.
10. Verify `latest.json` reports the new version and the signed NSIS URL before testing “Check for updates”.

## Canonical local release layout

Only the current release package is intended for upload:

`release/<version>/updater/`

It contains exactly two signed installers, two `.sig` files, `latest.json` and
`SHA256SUMS`. Older local installers belong in an archive and must not be mixed
with the upload directory. The Cloudflare R2 bucket remains flat: these six
objects are uploaded at its root, without a version subfolder.

## Release notes in latest.json

`latest.json`'s `notes` is the `## <version>` section of `docs/RELEASE_NOTES.md`,
cut to 8000 characters by `scripts/release-notes.mjs` (on whole lines, with "…" if it is ever longer). `CHANGELOG.md` is
not read: it stopped at 0.77.5 and shipped that text to every update until
12.10.2026. `npm run release:updater-package` and `release:manifest` fail when the
section is missing, and `release:validate-package` fails when the notes differ
from it. `npm run test:quality` runs `scripts/release-notes-check.mjs`.

## Bundled MCP server and Node runtime

`mcp-server/` ships inside the installer (`bundle.resources` in `src-tauri/tauri.conf.json`): `index.js`, `lib.js`, `package.json`, `node_modules` (production install) and `runtime/node.exe`. The runtime is Node v24.21.0; its source, SHA-256, signer and update steps are in `mcp-server/runtime/README.md`, which is not bundled. Before a release, check that `runtime/node.exe` still matches the hash recorded there. To update it, follow the procedure in that README, then run `mcp-server/test.js` under the new runtime.

## Old installers (checked 12.10.2026, HEAD only)

Probed `https://updates.szymonjankiewicz.com/Notible_<v>_x64-setup.exe`:

- 404: 0.22.0, 0.23.0, 0.24.0, 0.26.2, 0.31.4, 0.40.0, 0.50.0, 0.61.2, 0.71.6, 0.77.5, 0.79.2, 0.80.0, 0.80.1, 0.80.2, 0.80.3, 0.81.0, 0.81.1, 0.81.2.
- 200: 0.81.3, 0.81.4, 0.81.5, 0.81.6, 0.81.8, 0.81.11, 0.82.0 through 0.82.12, 0.83.0, 0.83.1, 0.83.7, 0.84.1, 0.87.6, 0.90.6, 0.93.0, 0.94.2, 0.95.0, 0.95.1, 0.96.0.
- `_x64_en-US.msi`, same probes: 404 for every probed version up to 0.81.0, 200 for 0.82.12 through 0.96.0. 0.81.1 to 0.81.11 MSIs were not probed.

Nothing in this repo removes objects, so the cause is outside it. Check in the
Cloudflare dashboard (R2 → `notible-updates`):

1. **Object lifecycle rules** (bucket Settings): a rule that expires or deletes
   objects. Remove it or make it match only temporary prefixes.
2. **Object listing**: search for `Notible_0.80.2` and `Notible_0.22.0`. If they
   are absent, a manual cleanup removed them. If present under another name or
   prefix, the sync from the old release layout is what differs.
3. Recover what can be recovered: re-upload the signed `.exe`/`.msi` and `.sig`
   from the local release archive (`release/<version>/updater/` or the
   `Notible_<v>_*` files kept on the build machine). Do not regenerate a `.sig`.

Stable link (proposal, not built): the release step could also upload the same
signed NSIS file as `Notible_latest_x64-setup.exe`, overwritten each release.
Cost: about 9 MB of storage that does not grow (overwrite), one extra Class A
write per release. R2 egress is free. Cloudflare's R2 pricing applies; check it
before adopting. The website can use `latest.json` instead, so this is optional.

## Plugin release channel

Core release objects above are never mixed with plugin release objects. A
plugin is published under `plugins/<plugin-id>/<channel>/` with its own
`manifest.json` and versioned ZIP package. Use the plugin package generator
and validation described in `docs/PLUGIN_UPDATES.md`; do not replace Core's
`latest.json` when publishing a plugin. Plugin signing keys are separate from
the Tauri updater key.

## Development limitation on this Windows machine

- `npm run dev` starts only the Vite frontend.
- The desktop development command is `npm run tauri dev`.
- On this machine, Windows Application Control blocks Rust `build-script-build` processes during debug builds, especially `tauri-plugin-opener`, with OS error `4551`.
- This is an environment policy issue, not an npm or signing-key issue. The production release and full test suite can still succeed after using the release build path and closing locked app processes.

## 0.23.0 changes included

- Desktop “Check for updates” is enabled and reports provider errors.
- AI provider status checks are cached, moved off the UI path and capped at two seconds.
- Optional direct OpenAI and Anthropic API connections work without installing their CLIs; API keys are stored in Windows Credential Manager.
- The editor floating toolbar is wider and preserves the selected text while changing the font.
