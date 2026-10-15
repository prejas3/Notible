# Zasady UI dla ekranów Settings

Status: przyjęte na podstawie istniejącego wzorca Core Settings
Referencja: `src/core/app/CoreOnlyApp.tsx` (sekcje `Appearance`, `Editor`, `Files & links`,
`Hotkeys`) i `src/core/app/core-only.css` (`.core-settings-*`)

Ten dokument nie wprowadza nowego designu. Opisuje wzorzec, który już działa w
`Appearance` i `Editor`, i czyni go obowiązkowym kontraktem dla każdego kolejnego
ekranu Settings — w tym Plugin Matrix, Plugin settings i przyszłych kart audytu
13 builtin pluginów (patrz `PLAN_AUDYTU_PLUGINOW_I_TEST_HOST_2026-08-09.md` (dokument wewnętrzny, nieopublikowany)).

## Zasada 1 — jeden kontener, dwie kolumny

Cały ekran Settings to jeden `.core-settings-shell`: siatka `nav | detail`,
nigdy osobny, konkurencyjny layout dla pojedynczej sekcji (patrz błąd Plugin
Matrix opisany w `PLAN_AUDYTU...md` (dokument wewnętrzny, nieopublikowany), już naprawiony przenosinami do wspólnej
obudowy). Nowa sekcja nie dostaje własnego paddingu, własnej szerokości ani
własnego tła — dziedziczy je z `.core-settings-section`.

## Zasada 2 — nawigacja zostaje w miejscu

`.core-settings-nav` ma reprezentować pełną listę sekcji przez cały czas
przeglądania treści. Zaimplementowane: `.core-settings-nav` ma
`position: sticky; top: 0` (`core-only.css:220`) w obrębie przewijanego
`.core-main`, więc przy długiej sekcji (np. Recovery z listą backupów) nav
zostaje widoczny, a rozciągnięcie `align-self: stretch` ogranicza zasięg
przyklejenia do wysokości treści w danej sekcji. Poniżej 680px (jedna kolumna,
`core-only.css:320`) sticky jest wyłączone (`position: static`), bo nav i
treść są wtedy w jednym pionowym stosie — przyklejanie samego nav zajmowałoby
tam za dużo miejsca.

- Wybór aktywnej sekcji (`is-active`) nie przesuwa się względem viewportu na
  desktopie i tabletowym breakpoincie — użytkownik klika dowolną pozycję w nav
  bez przewijania do góry.
- Nowa sekcja nie może dodawać własnego `overflow`/`position` do
  `.core-settings-nav` ani do `.core-settings-shell` — zmieniłoby to zachowanie
  sticky dla wszystkich pozostałych sekcji.

## Zasada 3 — trzy poziomy czytania szczegółów

Każda sekcja ma dokładnie trzy warstwy informacji, nigdy więcej naraz:

1. **Nagłówek** (`.core-settings-section-heading`): `eyebrow` (kategoria),
   `h2` (nazwa sekcji w języku użytkownika, nie nazwa techniczna), jedno
   zdanie kontekstu. Ikona w `.core-settings-mark` po prawej — czysto
   dekoracyjna, nigdy jedyny nośnik znaczenia.
2. **Wiersz ustawienia** (`.core-setting-row` / `.core-plugin-preference`):
   `label` + `small` opisujące *co się zmieni*, kontrolka wyrównana do prawej
   w stałej kolumnie (`190px` w desktopowym układzie). Jeden wiersz = jedna
   decyzja użytkownika.
3. **Notatka kontekstowa** (`.core-settings-note`, opcjonalna): dopowiedzenie
   „dlaczego”, oddzielone akcentowanym lewym obramowaniem, zawsze na końcu
   sekcji, nigdy między wierszami ustawień.

Zakaz czwartego poziomu: bez zagnieżdżonych tooltipów-w-tooltipach, bez
rozwijanych paneli wewnątrz wiersza ustawienia. Jeśli sekcja potrzebuje więcej
głębi (np. Recovery z listą backupów), to dodatkowa treść dostaje własny blok
(`.core-backup-list`, `.core-trash-list`) z tym samym rytmem: nagłówek listy +
liczba + wiersze, nie kolejny poziom hierarchii typograficznej.

## Zasada 4 — prostota nad kontrolą

- Kontrolka odpowiada bezpośrednio za jedną wartość: `select`, `CoreSwitch`,
  przycisk akcji. Żadnych własnych, jednorazowych komponentów formularza na
  sekcję.
- Stan `disabled`, `loading` i `error` używają tych samych klas co reszta
  aplikacji (`core-button`, `core-plugin-status`) — sekcja nie wymyśla
  własnego słownictwa wizualnego dla tych stanów.
- Sekcja diagnostyczna/deweloperska (np. `Core boundary`) zostaje schowana pod
  `<details>` „Advanced diagnostics”, nie w głównej liście nav — zgodnie z
  zasadą, że ekrany deweloperskie nie mieszają się ze zwykłym przepływem
  (patrz `PLAN_POPRAWEK_TEST_HOST...md` (dokument wewnętrzny, nieopublikowany), „Ukryć z normalnego przepływu”).

## Zasada 5 — elegancja przez ograniczenie szerokości

Treść sekcji ma `max-width: 760px` niezależnie od szerokości okna
(`.core-settings-section-heading`, `.core-setting-row`, `.core-settings-note`
— wszystkie już to robią). Settings nigdy nie rozciąga się na pełną szerokość
dużego monitora — to читelność list ustawień, nie dashboard.

## Checklist dla nowej sekcji Settings

- [ ] Wpis w `.core-settings-nav` z ikoną, `strong` (nazwa) i `small` (jedno
  zdanie), zgodnie z istniejącym wzorcem przycisków w `CoreOnlyApp.tsx:1216-1223`.
- [ ] Zawartość w `<article className="core-settings-section">` z
  `.core-settings-section-heading` (eyebrow + h2 + opis + `.core-settings-mark`).
- [ ] Każde ustawienie jako `.core-setting-row` lub `.core-plugin-preference`,
  max-width 760px, bez własnych niestandardowych layoutów.
- [ ] Stany loading/empty/error używają istniejących klas, nie nowych.
- [ ] Sekcja mieści się w trzech poziomach czytania z Zasady 3.
- [ ] Sprawdzone w Paper i Night, przy zwężeniu okna (breakpointy
  `core-only.css:301`, `:320`) i przy długiej treści — sticky nav (Zasada 2)
  nie chowa się przy scrollu na desktopie/tablecie.

## Poza zakresem tego dokumentu

Layout `Settings.tsx` (legacy modal, `settings-overlay`/`settings-modal`) ma
inny, starszy wzorzec i nie jest tu unifikowany — decyzja o ujednoliceniu
legacy Settings z Core Settings zależy od wyniku migracji Core/plugin opisanej
w `CORE_PLUGIN_BOUNDARY.md`.
