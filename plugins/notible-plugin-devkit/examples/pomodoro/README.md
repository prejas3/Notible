# Pomodoro — przykładowy plugin zewnętrzny

Najprostszy kompletny plugin Notible: dwa pliki, zero zależności, zero kroku
budowania. To, co napiszesz w `main.js`, jest tym, co się uruchamia — Notible
serwuje ten plik do webview przez schemat `plugin:` i importuje go jako moduł
ES.

```
pomodoro/
├── plugin.json   ← manifest
└── main.js       ← kod, export default { manifest, onload, onunload }
```

## Instalacja i test

1. Settings → Plugin host → **Add plugin folder**.
2. Wskaż ten katalog.
3. Pojawi się natywne ostrzeżenie z nazwą, wersją i uprawnieniami. To jest
   moment, w którym **jeszcze nic się nie wykonało** — kod ładuje się dopiero
   po kliknięciu „Install and run".
4. Timer pojawi się na dole paska bocznego, nad „Import Markdown".

Na co patrzeć:

- **Start / Pause / Reset / Skip** działają, zegar odlicza.
- **Skip** kończy fazę i pokazuje toast w prawym dolnym rogu — to jest
  overlay należący do Core (`ui.notice`), nie coś, co plugin sam sobie
  narysował.
- Licznik ukończonych sesji rośnie.
- Przełącz motyw w Settings — panel przechodzi w Night razem z aplikacją, bo
  używa tokenów hosta zamiast własnych kolorów.
- **Wyłącz plugin** w Settings → panel znika, a odliczanie się zatrzymuje.
- **Zrestartuj aplikację** → plugin ma tam nadal być. To była ta zepsuta
  rzecz przed 0.40.0.

## Czego ten przykład dotyka

| Element kontraktu | Gdzie |
|---|---|
| `ui.registerSlot` + `mount` | panel w pasku bocznym |
| `ui.notice` | toast na koniec fazy |
| `commands.register` + `hotkey` | „Pomodoro: start or pause" |
| `storage` | licznik ukończonych sesji |
| `Disposable` z `mount` | odsubskrybowanie przy zdejmowaniu panelu |
| `onunload` | zatrzymanie `setInterval` |

## Znane ograniczenia — to stan API, nie tego pluginu

- **`styles[]` nie jest jeszcze wczytywane**, dlatego style są nakładane
  inline z JS. Docelowo plugin dołoży własny arkusz (decyzja D5).
- ~~Kolory biorą z `--core-*`.~~ Migracja D3/D6 zrobiona: plugin używa
  publicznych `--notible-*`.
- **`storage` jest w pamięci**, więc licznik sesji nie przeżywa restartu.
- **Renderowany jest tylko slot `workspace.sidebar`.** Pozostałych pięć nazw
  z `UI_SLOTS` przechodzi walidację, ale nie ma jeszcze miejsca renderowania.

## Test automatyczny

```
npm run test:pomodoro-example
```

Ładuje ten katalog przez prawdziwy loader i prawdziwy `ExtensionHost`,
uruchamia komendy, montuje panel i sprawdza sprzątanie po odinstalowaniu.
