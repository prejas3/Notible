# Struktura repo, buildy i release — dla Ciebie i dla AI

Status: aktualne po kasacji legacy 2026-09-03. To jest pierwszy dokument do
przeczytania, jeśli pytanie brzmi „co tu jest, i jak to zbudować”.

> **2026-09-03: legacy usunięte.** Repo trzyma teraz jedną aplikację (Core +
> pluginy). Stary produkt domenowy (`src/App.tsx`, `src/components/*`, domenowe
> `src/lib/*`, `tauri.legacy.conf.json`) skasowany — nie był kanałem
> aktualizacji od 2026-08-10. Referencja: historia git albo
> `github.com/prejas3/Notible@main`. Praca nad równoważnością per-domena
> (`docs/CORE_PLUGIN_MIGRATION_MATRIX.md`) toczy się teraz względem tych
> referencji, nie działającego legacy buildu.

## 1. Aplikacja w tym repo — Core + pluginy

To jest **jedyna wersja**. Minimalny Core (SQLite,
sync, recovery, host UI) plus 14 builtin pluginów ładowanych przez publiczne
`@notible/plugin-api` (patrz `docs/CORE_PLUGIN_BOUNDARY.md`,
`docs/PLUGIN_API_DRAFT.md`). Ma też mechanizm instalowania pluginów spoza
builtin (folder lub ZIP, `Settings → Plugins`).

- Frontend: `src/core/`, `src/product/`, `plugins/builtin/`, `packages/plugin-api/`.
- Punkt wejścia: `src/product/test-host/` (`test-host-main.tsx` →
  `UnifiedTestHostApp` → `CoreOnlyApp` z podłączonymi slotami: Plugin Matrix,
  plugin settings, container/properties surfaces).
- Vite: `vite.test-host.config.ts` (build) — brak osobnego dev-serwera z
  danymi w przeglądarce, bo wymaga Tauri IPC (`invoke`).
- Tauri: **`src-tauri/tauri.conf.json`** — to jest teraz config **domyślny**
  (bez `--config`). Produkt: `Notible`, identyfikator `com.notible.app`,
  updater i podpisywanie włączone.
- Domyślnie aktywne pluginy po świeżej instalacji: `notible.properties`,
  `notible.search`, `notible.whiteboard`, `notible.views`,
  `notible.work-models`, `notible.editor-extensions` (ustalone
  2026-08-10, `src/product/matrix-controller.ts` → `DEFAULT_BUILTIN_SELECTION`).
  Reszta (`planning`, `automations`, `finance`, `calendar`,
  `import-export`, `themes`) startuje jako `inactive` — user włącza sam w
  Plugin Matrix.
- Ustalone dziś: `notible.ai` (`plugins/builtin/ai.ts`) istnieje w kodzie, ale
  **nie jest** zaimportowany w `plugins/builtin/index.ts` — nie liczy się do
  14 aktywnych builtinów. Nie zmieniałem tego — to decyzja do podjęcia
  osobno.
- Zasady UI dla ekranów Settings: `docs/SETTINGS_UI_GUIDELINES.md`.
- Otwarte braki funkcjonalne (parity z legacy, audyt 14 pluginów, edytor P0):
  `PLAN_AUDYTU_PLUGINOW_I_TEST_HOST_2026-08-09.md` (dokument wewnętrzny, nieopublikowany),
  `PLAN_POPRAWEK_TEST_HOST_2026-08-08.md` (dokument wewnętrzny, nieopublikowany).

### Legacy — USUNIĘTE 2026-09-03

Poprzednia aplikacja domenowa (Finance/Planning/Gantt wbudowane wprost, bez
plugin API) została skasowana: `src/App.tsx`, `src/main.tsx`, `index.html`,
`src/components/*`, 29 domenowych `src/lib/*`, `vite.config.ts`,
`src-tauri/tauri.legacy.conf.json`, skrypty npm `dev`/`build`/`tauri:legacy:*`,
~12 testów porównawczych legacy↔plugin. Współdzielone i zachowane:
`src/lib/{api,i18n,theme,calendarFormatting}.ts`.

Jeśli kiedykolwiek potrzebna implementacja referencyjna (kaskada Gantta, eksport
Finance itd.): `git log` / `git show <commit>:src/lib/gantt.ts` albo snapshot
`github.com/prejas3/Notible@main`.

- Dokumentacja użytkownika w `README.md`, `docs/PODRECZNIK_UZYTKOWNIKA.md`,
  `docs/SCENARIUSZ_DEMO.md`, `docs/PAKIET_DEMO.md` opisuje **stary** produkt —
  nie jest jeszcze zaktualizowana do Core+pluginów.

**Backend wspólny (był i zostaje):** Rust (`src-tauri/src/*.rs` — SQLite, sync,
recovery, AI, calendar OAuth), `src-tauri/Cargo.toml`, ikony, `mcp-server/`,
`server/` (Cloudflare Worker do sync), `packages/plugin-api/`.

Trzeci config, `src-tauri/tauri.core.conf.json` (`Notible Core Test`,
`com.notible.app.core-test`), to osobny, mniejszy build diagnostyczny: Core
bez żadnych pluginów, do testowania granicy Core/plugin. Nie jest to build do
wydania.

## 2. Jak zbudować — deweloperka

| Cel | Komenda |
|---|---|
| Podgląd w przeglądarce (bez danych — brak Tauri IPC) | `npm run dev:plugins` |
| Pełny desktop (Tauri, z danymi) | `npm run tauri:dev` (config domyślny) lub `npm run tauri:test-host:dev` |
| Core-only (bez pluginów, diagnostyka) | `npm run tauri:core:dev` |

Po świeżym klonie uruchom raz `npm run setup:node-runtime`. Pobiera Node
v24.21.0 (`win-x64/node.exe` z nodejs.org, sprawdza SHA-256) do
`mcp-server/runtime/node.exe` — plik jest w `.gitignore`, a bez niego
`cargo check` / `tauri dev` nie przejdą (`bundle.resources`). Wersja i hash:
`mcp-server/runtime/README.md` i `scripts/fetch-node-runtime.mjs` (zmieniać
razem). `scripts/release-build.ps1` uruchamia ten krok sam.

## 3. Jak zbudować release (6 plików: setup.exe/.sig, msi/.sig, latest.json, SHA256SUMS)

Release przez `src-tauri/tauri.conf.json` (config domyślny).

1. Podbij wersję w `package.json` (i `src-tauri/tauri.conf.json` →
   `version`, muszą się zgadzać — sprawdza to `npm run release:check`).
2. Dodaj `RELEASE_CHECKLIST_<wersja>.md` w `docs/releases/` (katalog lokalny, poza gitem; kopia poprzedniego
   jako wzór), wpis w
   `docs/AKTUALIZACJE.md` (PL, wewnętrzny dziennik zmian) **i** wpis
   `## <wersja>` w `docs/RELEASE_NOTES.md` — `release:check` wymaga
   wszystkich trzech. **`docs/RELEASE_NOTES.md` MUSI być zawsze po
   angielsku** — jest wbudowany do apki i widoczny użytkownikowi
   (Settings → About → Release notes), `release:check` odrzuca sekcję
   zawierającą polskie znaki diakrytyczne (ą ć ę ł ń ó ś ź ż).
3. Upewnij się, że klucz podpisujący jest na miejscu:
   `%USERPROFILE%\.notible\notible.key` i `notible.key.pub` (hasło znasz
   Ty, skrypt zapyta o nie interaktywnie — nigdy nie zapisuj go w pliku ani
   nie podawaj mi go w rozmowie).
4. Uruchom:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-build.ps1
   ```
   Skrypt: sprawdza wersję → buduje przez `npm run tauri:build` (czyli
   domyślny config = aktualna wersja) → podpisuje → pakuje `latest.json` +
   `SHA256SUMS` → waliduje kompletność paczki. Wynik ląduje w
   `release/<wersja>/updater/` — dokładnie 6 plików.
5. Wgraj zawartość `release/<wersja>/updater/` pod
   `https://updates.szymonjankiewicz.com/` (poza zakresem tego repo — ręcznie
   albo Twoim istniejącym procesem wgrywania).

`scripts/release-build.ps1` zastępuje poprzednie, ręcznie kopiowane skrypty
`release-0.24.0.ps1` … `release-0.26.2.ps1` (usunięte — były jednorazowe,
przypięte do konkretnej wersji i konkretnej ścieżki `CARGO_TARGET_DIR`).
Jeden uniwersalny skrypt czyta wersję z `package.json` za każdym razem.

## 4. Klucze i sekrety

- Klucz podpisujący aktualizacje (minisign/Tauri updater):
  `%USERPROFILE%\.notible\notible.key` (prywatny) i `notible.key.pub`
  (publiczny, jego skrót jest już wpisany jako `pubkey` w `tauri.conf.json`).
  Hasło do klucza zna tylko właściciel klucza — żaden skrypt go nie zapisuje, żaden
  dokument go nie zawiera.
- To repo, żaden skrypt AI ani ja nie mamy dostępu do tego katalogu poza
  odczytem przy buildzie — nie kopiuj klucza nigdzie indziej, nie wklejaj go
  do czatu ani do commitów.

## 5. Legacy — skasowane 2026-09-03

Kod starej aplikacji domenowej został fizycznie usunięty (patrz sekcja 1).
Wcześniej żył obok jako „punkt odniesienia dopóki Core+pluginy nie osiągną
parytetu"; okazał się głównie źródłem pomyłek (design mylił go z shipowanym
drzewem). Parytet per-domena jest teraz oceniany względem historii git /
snapshotu `github.com/prejas3/Notible@main` — patrz
`docs/CORE_PLUGIN_MIGRATION_MATRIX.md` i
`2026-09-03-core-plugin-boundary-closure-design-CORRECTED.md` (dokument wewnętrzny, nieopublikowany).
