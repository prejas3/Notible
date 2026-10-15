# Aktualizacje pluginów Notible

Notible ma **dwa niezależne kanały**: instalator aplikacji (`Notible.exe`) i
pluginy społecznościowe. Nie mają wspólnego manifestu, wersjonowania ani
zaufania.

## Kanał Core (`Notible.exe`)

Bez zmian. Updater Tauri czyta `latest.json` spod stałego adresu HTTPS
(`https://updates.szymonjankiewicz.com/latest.json`), instalator Windows jest
podpisany kluczem Tauri, a aktualizacja aplikacji nie instaluje ani nie
aktualizuje żadnych pluginów. Pełny proces publikacji Core opisuje
`docs/AKTUALIZACJE.md`. Ten kanał nadal ma własny klucz podpisujący i jest to
jedyne miejsce w projekcie, gdzie coś się podpisuje.

## Kanał pluginów — model społecznościowy (Model A)

Wzorowany na Obsidianie. **Notible nie hostuje i nie podpisuje pluginów
społecznościowych.** Autorzy hostują je sami na GitHub Releases, a market to
moderowany katalog *wskaźników* — nie repozytorium artefaktów.

### Katalog

Katalog żyje w osobnym **publicznym** repo:
[`github.com/prejas3/notible-market`](https://github.com/prejas3/notible-market).
`catalog.json` (schemat v2) jest tam jedynym zapisem tego, co jest na markecie.
Każdy wpis to same wskaźniki:

```json
{
  "id": "somedevs.kanban",
  "name": "Kanban",
  "author": "SomeDevs",
  "description": "A board view for tasks.",
  "repo": "somedevs/notible-kanban",
  "minCoreVersion": "0.80.0",
  "apiVersion": "1.11"
}
```

Zgłoszenie = PR do tego repo. Po merge do `main` GitHub Action waliduje
`catalog.json`, generuje `index.json` i wgrywa go na
`https://updates.szymonjankiewicz.com/plugins/index.json` (sekrety
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` w repo `notible-market`).
`index.json` niesie tylko metadane katalogu i `repo` — żadnych URL-i paczek,
rozmiarów ani hashy. Aplikacja waliduje pobrany `index.json` własną kopią
walidatora v2 (`src/core/extensions/update.ts`) — bramka runtime u każdego
użytkownika.

### Hosting po stronie autora

Autor publikuje **GitHub Release** z dwoma assetami o dokładnych nazwach
`plugin.json` i `{id}.zip`. Klient czyta je zawsze spod
`https://github.com/{repo}/releases/latest/download/plugin.json` oraz
`.../releases/latest/download/{id}.zip` — bez GitHub API, więc bez limitów
zapytań. „latest" musi wskazywać wydanie, które użytkownicy mają dostać;
opublikowanie nowszego wydania to aktualizacja, bez ponownej recenzji.

`plugin.json` to zwykły manifest pluginu (`id`, `name`, `version`,
`apiVersion`, `minCoreVersion`, `entry`). Nie ma podpisu ani osobnego manifestu
aktualizacji. `{id}.zip` ma `plugin.json` w katalogu głównym, maks. 50 MiB /
1000 wpisów / 10 MiB na plik, bez symlinków i ścieżek `..`.

### Instalacja

Klient rozwiązuje każdy wpis katalogu do wydania GitHuba, porównuje `id` i
zgodność wersji Core/API, po czym instaluje ZIP komendą Rust
`install_plugin_zip` **za modalem zaufania**. Modal mówi wprost, że plugin nie
jest recenzowany przez Notible dla tej wersji i że to kod z pełnym dostępem do
workspace. W ścieżce instalacji ze społecznościowego marketu nie ma żadnej
kontroli integralności paczki (ani podpisu, ani hasha). Zakładka **All**
oznacza taki plugin jako `unsigned`.

Recenzja odbywa się **przed** publikacją, przez PR do
`github.com/prejas3/notible-market` — pełna procedura w `CONTRIBUTING.md` tego
repo (skrót też w [`PLUGIN_SUBMISSION.md`](./PLUGIN_SUBMISSION.md) i w sekcji
„Publishing" Developer Packa).

## Czego już nie ma

Usunięty został cały kod podpisu pluginów: `TRUSTED_RELEASE_KEYS`,
weryfikacja Ed25519, `verify_package_signature`, podpisane manifesty
aktualizacji, `VITE_NOTIBLE_PLUGIN_UPDATE_KEYS`, ścieżki R2
`plugins/<id>/<channel>/manifest.json` oraz skrypty `release:plugin-update` /
`release:plugin-market` w ich starej roli. Plik klucza
`~/.notible/notible-plugins.key` może zostać na dysku — jest nieużywany, nie
wymaga rotacji.

## Lokalny development bez sieci

Bez zmian. Plugin można rozwijać jako katalog z `plugin.json` i lokalnym
entrypointem ESM (`loadLocalPluginDirectory`) albo instalować ręcznie wybrany
ZIP. Obie ścieżki to jawne zaufanie do kodu JS/TS; extractor wymaga
`plugin.json` w katalogu głównym, odrzuca traversal / ścieżki absolutne /
duplikaty / symlinki, ogranicza liczbę wpisów i rozmiary, zapisuje do stagingu
i wykonuje atomową zmianę do `app_data/plugins/<id>/versions/<version>`, nie
nadpisując istniejącej wersji.

## Zaufanie

Plugin to zaufany kod JS/TS z dostępem do Data API. Brak podpisu niczego nie
zmienia w modelu zagrożeń desktopu — instalacja zawsze była świadomym
zaufaniem. Modal zaufania i recenzja PR to warstwa proceduralna, nie sandbox.
