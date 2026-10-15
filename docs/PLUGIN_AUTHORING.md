# Tworzenie pluginu Notible lokalnie

To jest aktualna ścieżka developerska. API stoi na `1.8`; host porównuje
`apiVersion` z manifestu z własną wersją i wpuszcza plugin tylko przy tym samym
majorze i minorze nie wyższym niż jego własny. Plugin nie powinien deklarować
wersji wyższej, niż faktycznie potrzebuje, bo odetnie się od starszych hostów
bez powodu.

## Minimalny układ

```text
my-plugin/
├── plugin.json
└── index.js              # ESM: export default plugin
```

`plugin.json` musi zawierać `id`, `name`, `version`, `apiVersion` oraz — dla
zewnętrznego pakietu — bezpieczną względną ścieżkę `entry`.

```json
{
  "id": "acme.focus",
  "name": "Focus tools",
  "version": "0.1.0",
  "apiVersion": "1.8",
  "entry": "index.js",
  "permissions": ["data.read", "workspace.ui"],
  "sync": "settings"
}
```

Kod korzysta z `@notible/plugin-api`. Nie importuje `src/components`, prywatnego
SQL-a ani przypadkowych klas DOM. Każda komenda, widok, ustawienie i slot jest
namespacowany przez Core identyfikatorem pluginu.

## Zasady UI pluginu

Zarejestrowany widok (`context.views.register({ id, title, mount })`) jest od
0.61.0 realnym ekranem powłoki: Core daje mu wpis w nawigacji obok „Notes"
i pełną szerokość okna. Wcześniej rejestracja przechodziła, ale wysyłany host
nic nie rysował, więc pluginy obchodziły to `ui.modal` — to obejście nie jest
już potrzebne. Do przejścia na własny widok służy `ui.openView(viewId)`
(API 1.8); zwraca `false` na hoście, który nie ma gdzie renderować widoków,
i rzuca przy id, którego plugin nigdy nie zarejestrował. Szczegóły w
[`plugin-api/REFERENCE.md`](./plugin-api/REFERENCE.md).

Core jest właścicielem ramy aplikacji: nawigacji głównej, obszaru roboczego,
modalów, toastów, focus managementu, obsługi błędów oraz podstawowych tokenów
koloru, typografii i odstępów. Plugin dostarcza własną powierzchnię funkcjonalną
wewnątrz zarejestrowanego widoku, ustawień lub slotu; nie przebudowuje całego
okna i nie zakłada konkretnej szerokości ekranu.

- Style pluginu muszą być namespacowane pod identyfikatorem pluginu lub
  korzeniem przekazanej powierzchni. Nie wolno stylować globalnie `body`,
  `button`, `input` ani klas Core.
- Do kolorów, odstępów, promieni i stanów interakcji należy używać tokenów
  udostępnionych przez hosta. Plugin nie może wymuszać jasnego tła ani własnego
  resetu CSS; musi działać w trybie Paper i Night oraz przy Compact density.
- Widok powinien skalować się do dostępnego kontenera (`width: 100%`, bez
  stałego 1200 px) i zachować użyteczność przy zwężeniu okna. Dla złożonych
  paneli preferuj CSS Grid/Flex oraz container queries, gdy są potrzebne.
- Interakcje muszą mieć widoczny focus klawiatury, etykiety dla kontrolek,
  komunikat pustego stanu i czytelny komunikat błędu. Animacje respektują
  `prefers-reduced-motion`.
- Plugin rejestruje tylko własne komendy, widoki, settings i sloty. Core
  zapewnia ich miejsce, lifecycle oraz granicę błędów; plugin nie może
  manipulować DOM-em poza własną powierzchnią.

Przed zgłoszeniem pluginu sprawdź go w Core Test (lokalny folder) oraz w Plugin
Matrixie. Minimalny test UI powinien obejmować Paper/Night, Compact/Comfortable,
zwężenie okna, pusty stan, błąd ładowania oraz wyłączenie pluginu z pełnym
cleanupem rejestracji.

Rejestracje komend, widoków, ustawień i slotów wymagają `workspace.ui`. Operacje
DataApi wymagają odpowiednio `data.read`, `data.write` lub `relations.write`.
`context.permissions.has/require` pozwala sprawdzić uprawnienie przed
wykonaniem opcjonalnej ścieżki. `network` stoi od 1.7 za `context.oauth`
i niczym więcej. `filesystem.read` i `filesystem.write` są WYCOFANE
(`RETIRED_PERMISSIONS`): nadal się ładują, ale nic nie dają i nie pokazują się
na ekranie instalacji. Lokalny trusted runtime nie jest sandboxem.

## Lifecycle

`onload(context)` rejestruje zasoby i może być asynchroniczne. `onunload()` musi
zwolnić własne zasoby. Core czyści rejestracje i subskrypcje nawet wtedy, gdy
plugin zostanie wyłączony po błędzie. Błędy ładowania, wyładowania i komend są
raportowane do rejestru pluginu jako ostatni błąd; błąd komendy nie zatrzymuje
Core. Plugin nie powinien uruchamiać trwałych timerów ani listenerów poza
cleanupem.

## Lokalna weryfikacja

Uruchom z katalogu repozytorium:

```powershell
npm.cmd run test:plugin-api
npm.cmd run test:plugin-package
npm.cmd run test:extensions
npm.cmd run build
```

W desktopowym Core instalacja katalogu lub ZIP-a jest świadomym zaufaniem do
kodu JavaScript. Lokalny installer sprawdza manifest, ścieżki, zgodność
entrypointu, limity ZIP-a i staging atomowy, ale nie tworzy sandboxa.

## Desktop E2E ZIP/Tauri

W debug buildzie można uruchomić test z izolowanym katalogiem danych:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/run-tauri-plugin-e2e.ps1
```

Runner tworzy prawdziwy ZIP z fixture `example.hello`, ustawia
`NOTIBLE_TEST_APP_DATA_DIR` i uruchamia Tauri. W `Settings → Plugins` należy
wykonać: instalacja ZIP-a, restart aplikacji, wyłączenie pluginu oraz instalacja
nowszej wersji i rollback. Zmienna testowa działa tylko w debug buildzie;
release zawsze korzysta ze standardowego katalogu Tauri.

Ten scenariusz testuje lokalne zaufanie do kodu. Market społecznościowy nie
podpisuje pluginów — instalacja z katalogu przechodzi przez modal zaufania, a
recenzja odbywa się wcześniej przez PR do `catalog.json` (patrz
`docs/PLUGIN_UPDATES.md` i `docs/PLUGIN_SUBMISSION.md`).

## Reguła dla modeli LLM

Przed wygenerowaniem kodu model powinien sprawdzić `apiVersion`, przeczytać
manifest i istniejące testy kontraktowe, nazwać wymagane uprawnienia, zaplanować
cleanup oraz nie zmieniać Core bez wskazania publicznego punktu rozszerzeń.
Po zmianie powinien uruchomić testy pluginu, test typów i build, a wynik oraz
niezweryfikowane założenia zapisać w opisie zmiany.
