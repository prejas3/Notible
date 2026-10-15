# Przykładowe pluginy developerskie

`hello-plugin.ts` jest fixture dla obecnego, wewnętrznego `ExtensionHost`.
Nie jest jeszcze paczką instalowalną przez użytkownika i nie jest ładowany
automatycznie przez aplikację.

Uruchomienie fixture odbywa się przez test hosta:

```powershell
npm.cmd run test:extensions
```

Aktualny host udostępnia:

- manifest z walidacją identyfikatora;
- rejestrację komend, widoków, ustawień i slotów UI;
- namespacing identyfikatorów (`pluginId:localId`);
- event bus i automatyczne usuwanie subskrypcji;
- tymczasowy storage in-memory.

Katalog `hello-plugin/` jest osobnym fixturem lokalnego loadera. Zawiera
`plugin.json` oraz lokalny entrypoint ESM; test loadera czyta go bez sieci:

```powershell
npm.cmd run test:local-plugin-loader
```

Docelowy, publiczny kontrakt jest szerszy i opisany w
`docs/PLUGIN_API_DRAFT.md`. Ten katalog nie powinien być traktowany jako
stabilne API przed zakończeniem F2 i testów kontraktowych.
