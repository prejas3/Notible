# Bundled Node runtime

`node.exe` in this folder runs `mcp-server/index.js` inside the installed app
(the `bundle.resources` mapping in `src-tauri/tauri.conf.json`). This README is
not in that mapping, so it does not ship in the installer.

| | |
|---|---|
| Version | v24.21.0 (Node 24, Krypton LTS line, ABI 137) |
| Release date | 2026-09-07 (nodejs.org/dist/index.json) |
| Source | https://nodejs.org/dist/v24.21.0/win-x64/node.exe |
| SHA-256 | `ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32` (equals the `win-x64/node.exe` line of https://nodejs.org/dist/v24.21.0/SHASUMS256.txt) |
| Size | 93,580,104 bytes |
| Signer | OpenJS Foundation (Authenticode status Valid, checked 12.10.2026) |
| Verified | 12.10.2026: hash, signature, `--version` v24.21.0, `process.versions.modules` 137 |

The previous runtime was v24.16.0 (SHA-256 `b3094d0b…290aa3`, 92,279,112 bytes).

## Update procedure

1. Take the highest v24.x.y in https://nodejs.org/dist/index.json. Do not change major: `better-sqlite3` is built for ABI 137.
2. Download `win-x64/node.exe` and `SHASUMS256.txt` from nodejs.org (HTTPS only, no mirrors). Check the SHA-256 against the `win-x64/node.exe` line, and check `Get-AuthenticodeSignature` is Valid with signer OpenJS Foundation.
3. `node.exe` is git-ignored: `npm run setup:node-runtime` (`scripts/fetch-node-runtime.mjs`) downloads it and checks the pinned hash. To update, change `VERSION` and `SHA256` there, run it, then run `./runtime/node.exe test.js` from `mcp-server/` and one stdio `initialize` against `index.js` with a throwaway `NOTIBLE_DB_PATH`.
4. Update the table above (version, date, size, SHA-256, verification date) in the same commit.
