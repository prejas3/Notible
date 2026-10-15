# System aktualizacji Notible

## 0.97.0

Core 0.97.0 · API pluginów 1.28 · oficjalne pluginy: Graph 0.11.7, Habits 0.9.2, Notifications 0.1.8, ReportIt 0.1.17, Sync 0.4.9, Sync Simple 0.5.10, Tables 0.7.1, Teams 0.1.3, Nib 0.2.2, Library 0.3.0, Note schemas 0.2.0.

### Nowości

- **Serwer MCP wraca do aplikacji:** serwer MCP jest znów dołączony do Notible, więc Ustawienia → Serwer MCP działa w zainstalowanej aplikacji. Pobieranie jest większe: około 40 MB zamiast 9 MB.
- **Blok kodu wygląda inaczej:** Ustawienia → Wygląd → **Bloki kodu** ustawiają rozmiar czcionki kodu, wysokość linii, długie linie (zawijanie albo przewijanie w bok) i szerokość tabulatora, osobno od ustawień tekstu. Działają od razu, są zapisane na tym komputerze, a **Przywróć** przywraca zwykły wygląd. Bloki porównania kodu korzystają z rozmiaru, wysokości linii i szerokości tabulatora. Wydruk zachowuje własny wygląd kodu. (Hive #32)
- **Kolory diagramów:** Ustawienia → Wtyczki → Rozszerzenia edytora → **Wygląd diagramów** dodaje wybieraki kolorów: tła, wypełnienia węzła, obramowania, tekstu, linii i strzałek oraz wypełnienia i obramowania grup. Każdy jest na Auto, dopóki nie wybierzesz koloru, a podgląd odświeża się przy każdej zmianie. Nowy domyślny motyw **Notible** rysuje diagramy kolorami aplikacji i podąża za Daylight, Midnight i pakietami motywów; grupy nie są już zawsze niebieskie. Diagram Mermaid w Midnight nie stoi na białym polu, a etykiety są czytelne. Front matter diagramu nadal ma pierwszeństwo. (Hive #41)

### Ulepszenia

- **Po polsku w Ustawieniach → Wtyczki:** gdy Notible jest po polsku, nazwy wbudowanych pluginów, ich szczegóły (tytuły ustawień, teksty „Na przykład”, linia „Najpierw włącz” i liczby miejsc w interfejsie) oraz nazwy i opisy poleceń menu **/** są przetłumaczone. Płótno tablicy nazywa się wszędzie „Płótno”. (Hive #51, #54, #58)

## 0.96.0

Core 0.96.0 · API pluginów 1.28.

### Nowości

- **Pluginy mogą pobierać obrazy z internetu:** API pluginów 1.28 dodaje `context.data.media.importImageFromUrl(url)` i listę `networkHosts` w `plugin.json`. Core sam pobiera obraz i zapisuje go w folderze mediów Notible, więc działa bez internetu i się synchronizuje. Wszystko sprawdza w Rust: tylko https, tylko hosty zadeklarowane przez plugin (także po przekierowaniu), żadnych adresów z sieci lokalnej, 15 sekund, 20 MB i prawdziwa zawartość PNG, JPEG, WebP lub GIF. Okno instalacji i szczegóły pluginu pokazują teraz, z jakimi hostami plugin się łączy („Łączy się z”). (Hive #45)

- **Przycisk Formatuj na blokach kodu:** każdy blok kodu ma przycisk **Formatuj** obok **Kopiuj**. Otwiera narzędzia bloku kodu (sortowanie wierszy, usuwanie powtórzeń, przycinanie spacji, zmiana wielkości liter, a w bloku `json` ładne formatowanie lub minimalizację) bez kliknięcia prawym przyciskiem, także z klawiatury. (Hive #43)
## 0.95.1

Core 0.95.1 · API pluginów 1.27.

### Nowości

- **Narzędzia bloku kodu:** kliknij blok kodu prawym przyciskiem albo wpisz w nim `/`, aby posortować wiersze, usunąć powtórzone wiersze, obciąć spacje na końcach, połączyć wiersze, zamienić tabulatory na spacje (i spacje na początku na tabulatory) albo zmienić wielkość liter. Blok `json` można też ładnie sformatować albo zminifikować. Każde narzędzie to jeden krok **Ctrl+Z**. JSON niepoprawny, z powtórzonym kluczem, z liczbą całkowitą powyżej 2^53−1 albo z liczbą, której nie da się zachować dokładnie, zostaje bez zmian, z komunikatem. (Hive #35)
- **Biblioteka:** oficjalny plugin Library przechowuje książki, filmy, seriale i gry z ocenami, statusami, tagami i okładkami, pokazuje je jako siatkę lub listę i pozwala filtrować oraz sortować kolekcję. API pluginów 1.27 dodaje bezpieczny wybór obrazu przez `context.data.media.pickImage()` i uprawnienie `media.write`; plik wybiera użytkownik w natywnym oknie, a Core sprawdza format i limit 20 MB. (Hive #30)
- **Schematy notatek:** plugin Note schemas wypełnia nowe elementy danego rodzaju wzorem tytułu (z licznikiem), właściwościami i tagami. Pozycja nowego schematu w menu **+** pojawia się od razu, bez ponownego uruchomienia: Core odświeża menu, gdy plugin doda polecenie po załadowaniu. (Hive #31, #37)
- **Porównanie kodu:** wpisz `/` i wybierz **Code comparison**, aby dodać blok `compare`. Stary kod wpisz nad wierszem `=====`, a nowy pod nim: oba pokazują się obok siebie, z numerami wierszy i oznaczeniem wierszy dodanych, usuniętych i zmienionych. W wąskiej notatce panele układają się jeden pod drugim. Blok bez wiersza `=====` mówi o tym. Blok zostaje zwykłym Markdownem, więc druk i eksport zachowują jego źródło. (Hive #33)
- **Wygląd diagramów:** Ustawienia → Wtyczki → Editor extensions → **Wygląd diagramów** ustawia motyw Mermaid (Automatycznie dopasowuje się do jasnego lub ciemnego wyglądu Notible, albo Default, Neutral, Forest, Base), wygląd odręczny i układ ELK dla większych diagramów. Ustawienie jest zapisane na tym komputerze i działa w edytorze, w druku i w eksporcie. Własny front matter diagramu nadal ma pierwszeństwo. (Hive #34)

### Ulepszenia

- **Ustawienia → Serwer MCP** (wcześniej **Sprzątanie przez AI**): pokazuje konfigurację połączenia i możliwości asystenta. **Pozwól na edycję** pozostaje domyślnie włączone, a **Uwzględnij dane finansowe** wyłączone. Przełączniki dostępu i zakresy sprzątania zmienia się bezpośrednio w panelu; Rust wyświetla natywne potwierdzenie Windows przed każdą zmianą rozszerzającą dostęp, także gdy wywołanie pochodzi z pluginu. Wyłączenie dostępu nie wymaga potwierdzenia. Ustawienia są tylko na tym komputerze; zmienne środowiskowe klienta mogą jedynie zawężać dostęp, a wbudowane AI Notible nadal tylko proponuje zmiany. Akcja notatki to **Chroń przed AI**. Serwer MCP 1.3.0. (Hive #29, #38)
- **Polski wszędzie:** oficjalne pluginy mówią po polsku, gdy Notible jest po polsku: Tables, Sync, Sync Simple, Graph, Habits, Notifications, ReportIt (także tworzony raport), Teams i Nib. Przetłumaczone są też pozostałe etykiety Core i wbudowanych pluginów, np. rodzaj nad notatką („Notatka”), teksty Typewritera, Whiteboardu i Automatyzacji oraz podpowiedź „edytuj” bloku kodu. Wersje pluginów: Tables 0.7.1, Sync 0.4.8, Sync Simple 0.5.9, Graph 0.11.7, Habits 0.9.2, Notifications 0.1.8, ReportIt 0.1.17, Teams 0.1.3, Nib 0.2.3. (Hive #28)

### Poprawki

- Panel Właściwości nie cofa już zmian wprowadzonych, gdy był otwarty. Zapisywał całą swoją kopię właściwości elementu, więc wartość ustawiona w tym czasie przez plugin, automatyzację albo synchronizację z innego komputera ginęła przy następnej edycji. Teraz zapisuje tylko zmienione pola i pokazuje aktualne wartości, gdy coś innego je zmieni. (Hive #36)

## 0.95.0

Core 0.95.0 · API pluginów 1.26 · Notible Sync 0.4.7 · Sync Simple 0.5.8 · Notible Tables 0.7.0 · Notible Teams 0.1.2. Pluginy synchronizacji zaktualizuj na każdym komputerze.

### Nowości

- **Widok „Rozwiąż konflikt”:** powiadomienie o konflikcie synchronizacji otwiera teraz jeden wspólny ekran **Rozwiąż konflikt**. Przechodzisz przez różnice po kolei i zostawiasz bieżący tekst, zapisaną wersję albo obie, a potem zapisujesz. W pełni przejrzana kopia trafia do kosza i można to **Cofnąć**. Jeśli notatka zmieniła się w międzyczasie, trzeba ją przejrzeć jeszcze raz; wszystko poza tekstem zostaje w kopii konfliktu. Pluginy mogą otworzyć ten ekran przez `context.ui.openSyncConflicts` (API pluginów 1.26). (Hive #7)
- **Tabele w notatce:** wpisz w notatce `/New data table`, a edytowalna tabela pojawi się od razu w tekście i zapisze razem z notatką (Notible Tables 0.7.0, API pluginów 1.24). Tabela danych z menu **+** nadal działa jako osobny element. Sync i Sync Simple łączą zmiany w różnych komórkach takiej tabeli z dwóch komputerów bez kopii konfliktu. (Hive #2)
- **Sprzątanie przez AI:** asystent AI połączony przez MCP może poprosić o przeniesienie do kosza najwyżej 20 notatek. Nic się nie przenosi, dopóki nie zatwierdzisz każdej notatki w **Ustawienia → Sprzątanie przez AI** i nie potwierdzisz. Najpierw powstaje kopia zapasowa, każde sprzątanie trafia do dziennika i przez 24 godziny można je cofnąć — także po ponownym uruchomieniu i także wtedy, gdy inny komputer w tym czasie opróżnił swój kosz. Funkcja jest wyłączona, dopóki nie pozwolisz na nią w całym obszarze roboczym albo w wybranym projekcie, a notatki oznaczone **Chroń przed sprzątaniem przez AI** (oraz ta otwierana na starcie) nigdy nie są brane pod uwagę. (Hive #13, #22)
- **Drzewo w pasku bocznym:** w **Ustawienia → Wygląd → Drzewo w pasku bocznym** możesz zostawić automatyczne rozwijanie do otwartej notatki albo wybrać tryb **Ręcznie (tylko to, co rozwinę)** — wtedy otwarte zostają tylko gałęzie rozwinięte przez ciebie. (Hive #3)
- **Powiadomienia o scalaniu:** gdy synchronizacja zostawi wersję z innego urządzenia zamiast twojej, przywróci usuniętą przez ciebie notatkę albo zapisze kopię konfliktu, krótki komunikat powie o tym prostymi słowami (po polsku albo angielsku), np. „Synchronizacja zachowała Twoją zmianę w »Lista zakupów«: notatkę usunięto na urządzeniu Laptop”. Jeden komunikat na synchronizację, nigdy po jednym na notatkę: **Otwórz** prowadzi do notatki, a **Szczegóły** pojawiają się, gdy dotyczy to kilku notatek. Wyłączysz je przełącznikiem **Pokazuj powiadomienia o scalaniu przy synchronizacji** w ustawieniach pluginu. Pluginy mogą dodać do komunikatu jeden przycisk (API pluginów 1.25). (Hive #11)
- **Dla autorów pluginów:** pluginy dostają `context.store`, większy magazyn klucz–wartość we własnym pliku. Nie trafia do kopii zapasowych, jest czyszczony przy przywracaniu kopii i znika razem z pluginem (API pluginów 1.25). (Hive #5)

### Ulepszenia

- **Synchronizacja łączy zmiany zamiast wybierać jedną:** notatka zmieniona na dwóch komputerach między synchronizacjami zachowuje obie zmiany, jeśli dotyczą różnych linii; tak samo tytuły i właściwości. Kopia konfliktu powstaje tylko wtedy, gdy ta sama linia, tytuł albo właściwość zmieniły się po obu stronach lub gdy nie da się ustalić kolejności wersji. Komputery ze starszą wersją pluginu działają po staremu. (Hive #5, #10)
- **Tablice, plansze i karty widoków łączą się element po elemencie:** przesunięcie karty na jednym komputerze i edycja innej karty (albo tekstu tej samej) na drugim zostają obie, bez kopii konfliktu. Dotyczy to tablic (whiteboard), planszy fabuły w Typewriterze (pozycje kart, ramki, oś czasu) oraz kart widoków folderu lub projektu. Gdy oba komputery przesuną tę samą kartę albo zmienią ten sam widok, wygrywa nowsza zmiana, bez kopii; tylko różny tekst wpisany w tę samą kartę, tytuł ramki lub znacznik trafia do kopii konfliktu. (Hive #6)
- **Tagi i zależności:** tagi i zależności zadań dodane na dwóch komputerach między synchronizacjami zostają wszystkie, zamiast żeby jedna lista zastępowała drugą. Usunięcie wygrywa, chyba że drugi komputer zmienił ten sam wpis. (Hive #24)
- **Pełniejsze powiadomienia o scalaniu:** dowiaduje się też komputer, którego zmiana przegrała, nawet gdy tylko pobiera scalenie z drugiego. Komunikat nie ginie, gdy wysyłanie na końcu synchronizacji się nie powiedzie. Kopie konfliktu są zawsze nazwane i policzone, także kilka kopii jednej notatki o tej samej nazwie, a długi komunikat ciągnie się w następnym zamiast się urywać. Konflikt archiwizacji nie jest już nazywany przeniesieniem, a ustawienie jest też po polsku. (Hive #16, #20)
- **Dla testerów (bez zmian dla użytkowników):** pluginy synchronizacji łączą się z Dyskiem Google przez jedną małą warstwę transportu, więc dwie testowe kopie Notible mogą synchronizować się przez wspólny folder lokalny w testach automatycznych. Ten folder działa tylko w testowych kompilacjach debug, odrzuca dowiązania prowadzące poza niego, ma limity rozmiaru plików, ich liczby i łącznej wielkości, a skrypty testowe sprzątają tylko kopie, które same uruchomiły. (Hive #9, #17)

### Poprawki

- **Synchronizacja nie gubi już zmian w tych sytuacjach — zostają obie wersje, jedna jako kopia konfliktu:** pisanie w notatce w trakcie stosowania synchronizacji; pierwsza synchronizacja notatki na komputerze, który jeszcze jej nie znał; zmiana w notatce w koszu; usunięcie kolumny tabeli na jednym komputerze, gdy na drugim edytowano komórkę w tej kolumnie; uszkodzona tabela; a także wyczyszczenie lub błąd odczytu magazynu samego pluginu. Notatka przeniesiona podczas scalania i kopia konfliktu trafiają teraz do właściwego folderu. Długie tytuły z emoji nie psują już kopii konfliktu. (Hive #14)
- **Synchronizacja nie gubi zmiany, gdy inny komputer przywrócił w międzyczasie stary tekst notatki** (najczęściej po przywróceniu bazy z kopii albo ponownym sparowaniu). Po przywróceniu bazy może pojawić się kopia konfliktu ze starszym, przywróconym tekstem notatki zmienionej od czasu kopii. (Hive #12)
- **Notatka przeniesiona, wyrzucona do kosza, przywrócona lub zarchiwizowana w trakcie synchronizacji zostaje tam, gdzie ją zostawiłeś:** synchronizacja uwzględni to przy następnym przebiegu zamiast cofać zmianę, nawet gdy drugi komputer tylko usunął notatkę albo zmienił jej folder. Zmiana folderu trzyma się też wtedy, gdy zegar innego komputera się spieszy. (Hive #18, #19)
- **Widok obszaru roboczego:** kopie konfliktu z Sync lub Teams nie pojawiają się już na listach obszaru roboczego (projekty, terminy); zostają w pasku bocznym obok oryginału. **Notible Teams 0.1.2:** wspólny projekt edytowany na dwóch komputerach nie tworzy już w sobie projektu „Notible (conflict copy, …)”. (Hive #1)

### Bezpieczeństwo

- **Okno zaufania pluginu:** ostrzeżenie przed instalacją pluginu z kodem jest pomijane tylko dla paczki, którą Notible samo pobrało z oficjalnego wydania i zainstalowało. Wcześniej dowolny plugin mógł podać oficjalne źródło i bez pytania uzyskać zaufanie dla innej paczki. Oficjalne instalacje z marketu nadal przechodzą bez okna, a pluginy społeczności zawsze je pokazują. (Hive #8, #21, #23)
- **Przyciski w powiadomieniach:** przycisk komunikatu reaguje tylko na prawdziwe kliknięcie lub klawisz, nigdy na skrypt innego pluginu. (Hive #16)
- **Bezpieczeństwo wydań (bez zmian dla użytkowników):** kompilacja wydania zatrzymuje się, jeśli aplikację przypadkiem zbudowano z włączonymi sprawdzeniami debug, które odsłoniłyby funkcje tylko do testów, a automatyczne kopie testowe odmawiają uruchomienia kompilacji nietestowej, więc nigdy nie otworzą twoich prawdziwych notatek. (Hive #15)

## 0.94.2

Po 0.94.1 (użytkownik, tablica Northwind): z 0.93.3 kolumny Kanbana miały stałe 272 px i przy 4 kolumnach zostawiały pół ekranu pustego — wraca `minmax(260px, 1fr)`; test w `r4-projects.cjs` „columns fill the board” (wypełniają, gdy się mieszczą; przewijanie tylko przy minimum 260 px). Appearance → Notification sound: „Posłuchaj” przed listą, lista w jednej linii z innymi (120 px przy prawej krawędzi).

## 0.94.1

Poprawka po 0.94.0 (użytkownik: Kanban projektów Acme/Northwind „pusty”). Od 0.93.3 Kanban pokazywał wszystkie kolumny schematu, także puste — przy 11 statusach osiem pustych kolumn spychało Done/Closed/No status poza ekran. Teraz puste kolumny tylko przy krótkim przepływie (≤ 6 statusów, czyli 4 nowego projektu); przy 11 tylko kolumny w użyciu, a pusty projekt pokazuje „Nothing here yet”. Test w `r4-projects.cjs`: projekt bez `statusSet` z 5 zadaniami Done → jedna kolumna, wszystkie karty na ekranie; przy „Show all 11 statuses” brak pustych kolumn. Whiteboard: Esc w karcie zdejmuje fokus, więc treść karty od razu przeciąga (przegląd Codexa R-USE-01, test w `r4-projects.cjs`).

## 0.94.0

Plan naprawczy, wydanie R5 „Every screen” (L1, L2, L6, L7, F1–F4, G10; L3/L4/L5 załatwione w 0.93.1). Test: `scripts/cdp/scenarios/r5-every-screen.cjs` (`--shots`), `zoom-check.mjs`, `search-results-check.mjs`, test Rust `text_search_matches_fragments_and_polish_case` (+ wiele słów). (L1, D5) poniżej 700 px pasek boczny jako warstwa (`.is-sidebar-open`, tło, Esc, zamyka się przy zmianie sekcji/elementu), przycisk menu w `.core-topbar`; zastępuje stary układ „pasek nad treścią”. (L7) `src/core/app/zoom.ts`: Tauri `setZoom` (nie CSS zoom — matematyka wskaźnika na tablicach), kroki 80–150 %, `localStorage notible-ui-zoom`, Ctrl+=/-/0, wiersz „Interface size” w Appearance; capability `core:webview:allow-set-webview-zoom`. (F4, D14) Ctrl+K otwiera wyszukiwanie. (F1) Rust `search_objects_text` i JS `matchesAllWords`: każde słowo, dowolna kolejność, fragment słowa; wyniki jako płaska lista przed Settings/Help, z rodzicem i fragmentem tekstu (`snippetFor`), nagłówek „Results” gdy są nie-notatki; (F2) „Nothing matches” tylko gdy wszystkie grupy puste; (F3) filtry za przyciskiem w polu wyszukiwania, zaznaczony otwarty wynik. (L2) stopka notatki pod tekstem (`is-note` body bez flex-grow, min-height 180 px), zawija się. (L6) pełny tytuł w `title` wiersza drzewa, min. szerokość menu wiersza. (G10) pomiar WCAG w Midnight (tekst ≥ 4.5, kontrolki ≥ 3) — wszystko przechodzi, bez zmian kolorów. Pomoc: Ctrl+K, rozmiar interfejsu, wąskie okno, nowa kolejność wyników. (M6) „More with plugins…” na końcu menu + (Settings → Plugins). (M4) `foundAt()` w CoreMatrixPanel: „Where to find it” dla zainstalowanych pluginów z marketu z tego, co zarejestrowały (creates, objectTabs, widoki nav, bloki kodu, róg); ikona pobierania tylko gdy jest co pobrać. (M1) `ReleaseManifest.permissions` z plugin.json wydania; szczegóły w markecie przed instalacją pokazują „Will be allowed to” słowami z `PERMISSION_WORDS`. (SND1) `src/core/app/sounds.ts` (Web Audio, None/Soft chime/Bell/Pop, domyślnie None, `sounds-check.mjs` na atrapie kontekstu audio), wiersz w Appearance z „Posłuchaj”; `host.setInAppNotice`: powiadomienie pluginu przy aktywnym oknie → notice w Notible + dźwięk, inaczej toast Windows (bez podwójnego dźwięku). Wybór dźwięku przez plugin — na później (wymaga API). (API 1.23) `CommandRegistration.whileTyping` — tylko dla skrótów z Ctrl/Cmd/Alt; Nib 0.2.2 go używa (backlog: skrót w trakcie pisania); `plugin-api-check`, REFERENCE, d.ts.

## 0.93.3

Plan naprawczy, wydanie R4 „Projects that plan” (T1–T11, T13; D2, D3, D8). Testy: `scripts/cdp/scenarios/r4-projects.cjs` (`--size`, `--theme`, `--shots`; 45 sprawdzeń, przechodzi na 1366×768 paper, 1024×700 night, 1920×1080 paper), `task-statuses-check.mjs`, `whiteboard-place-check.mjs`, `container-modules-check.mjs` (+ alias, oferty, kolejność), `builtin-calendar-check.mjs` (+ `moveEventToDay`). (T1/T2, D2) `plugins/builtin/task-statuses.ts`: nowy projekt dostaje `statusSet: "simple"` (`createWorkRecord`, przycisk w pustym workspace), pokazuje todo/in-progress/blocked/done; brak znacznika = 11 jak dotąd; „⋯ → Show all 11 statuses” przełącza `statusSet`; Kanban pokazuje wszystkie kolumny (także puste, bez stanu „Nothing here yet”), szerokość 272 px, menu kolumny zamyka Esc, Triage ma podpowiedź; Properties zadania biorą statusy z rodzica (hook przed wczesnym returnem). (T3) szybkie dodawanie: Title pierwszy z fokusem, opcjonalne Status/Priority, „Create and add another”, Esc; reguła `.plugin-view-create-form button` malowała Select/DatePicker na niebiesko — zawężona. (T4) menu karty/wiersza: Open/Rename (w miejscu)/Status/Priority/Due date/Move to trash, bez „Open” na liście statusów, flyouty w lewo przy prawej krawędzi, Esc; karty zrobione przygaszone i przekreślone; bez chipa „None”; bez kolorowego paska na kartach In progress. (T5) „Showing” przy typie, „Duplicate view”, podpowiedź na przełączniku układu. (T7) tabela: Due jako data ISO (sortowanie, puste na końcu), DatePicker w komórce, kolumna Type ukryta przy jednym typie, `minWidth: 100%`, wiersze wyrównane. (T8) nowy widok od razu w trybie zmiany nazwy, × tylko po najechaniu, Undo po usunięciu; zapisy `_views` w kolejce (Undo przegrywało z zapisem usunięcia). (T9) Core ustawia `<html lang>` (wcześniej zawsze „en”), `plugins/builtin/app-locale.ts` dla dat w widokach, automatyzacjach i planowaniu; kalendarz widoków: dzisiaj zaznaczone, dwuklik dodaje zadanie w dniu, przeciąganie zmienia due; kalendarz wydarzeń: formularz obok dwukliku, przeciąganie wydarzeń. (T10) DatePicker przeskakuje do wpisywanej daty; `dateLabel` w formacie pickera (lokalny dzień dla znaczników czasu); placeholdery Assignee/Team; Manual = kolejność utworzenia. (T11) `freeSpot()` w `link-geometry.ts`, nowa karta z fokusem, przeciąganie za treść karty (bez ruchu = kursor), przycisk ⋯ zamiast „Right-click for more”, Report opisany. (T13, D3/D8) zakładka Finance przeniesiona z Planning do pluginu Finance (`extraViews` + `objectTabs`), alias `notible.planning:finance` → `notible.finance:finance` w `normaliseModules`; Moduły pokazują „More with plugins” z „Turn on” (`turnOnBuiltin` w `matrix-controller.ts`, ten sam wybór co Settings → Plugins); sekcja „Where to find it” w szczegółach pluginów (`PLUGIN_WHERE`); oś czasu: daty na górze, klucz kolorów, zablokowane na pomarańczowo, Dependencies nie na całą szerokość. (T6) `.core-container-slot` już nie przewija się osobno — przewija się `.core-main`. Etykieta „todo” → „To do”. 45 nowych tłumaczeń PL; przy porządkowaniu pl.json przywrócono klucze z HEAD.

## 0.93.2

Przegląd Pomocy przez Codexa 02.10 (2 agentów: LOOK — wygląd w 3 rozmiarach i 2 motywach, TRUTH — każda strona sprawdzona w działającej aplikacji; raporty w `Notible-feedback/2026-10-02-codex-help/`). Test: `scripts/cdp/scenarios/help-review.cjs` (1024×700 i 1920×1080, oba motywy, `--shots`) + `help-check.mjs` (klawisze, nazwa wpisu `/`). Bloki kodu w Pomocy dostały style notatki (wcześniej reguły były tylko pod `.core-editor-content`, więc „text” i „Copy” były gołymi szarymi przyciskami), etykieta „text”/pusta ukryta, Copy działa (obsługa kliknięcia w `HelpScreen`); kod w linii z obrysem. Aktywna strona spisu: obrys akcentu zamiast wypełnienia i paska `inset 3px` (zasada obrys-nie-wypełnienie). Poniżej 1180 px spis treści jako rozwijana warstwa nad artykułem (`position: absolute`, własne przewijanie, Esc i klik poza zamyka). `inlineCode()` w `render.ts`: kod w linii będący klawiszem/skrótem (`Ctrl+N`, `F1`, `[[`, `/`) renderuje się jak `HotkeyCaps`; pogrubione klawisze w stronach zamienione na kod. Nagrania: `help:media` nagrywa też `.dark.webm`, Pomoc podmienia wideo pod Midnight; wszystkie zrzuty i nagrania odświeżone (project-board z „⋯”, help-search bez ucinania liter). Treść (TRUTH-01…11): Hotkeys — zmienia się tylko skróty pluginów; tabela `/` + Table/Link/Image i tworzenie elementów; CSV pod „⋯”; Backlinks zależą od Settings → Editor; Finance w Planning wymaga pluginu Finance; eksport JSON jest w Core; Properties nie dla projektów/folderów; zapytanie `due: <= +7d` obejmuje zaległe; bez żargonu „container”/„information layer”/„object”; menu wiersza „New inside…”; Automations: „To start…”. Wpis `/` „Live list of matching objects” → „Live list of matching items” (coreCommands, queries.plugin, opis pluginu + pl.json).

## 0.93.1

Porządki wizualne po audycie Codexa 02.10 (3 agentów: ekrany, powierzchnie, pluginy; raporty i plan w `Notible-feedback/2026-10-02-codex-visual-audit/`) plus poprawki z pracy nad Nibem. Nowa stała zasada: każda poprawka przechodzi kontrolę czystości UI (1024×700 i 1920×1080, oba motywy). Test: `scripts/cdp/scenarios/v-cleanup.cjs` (99 sprawdzeń w 4 wariantach rozmiar×motyw, `--shots <dir>` zapisuje zrzuty do obejrzenia). (A) Plugins: wiersze 36 px, bez ikony Reload w wierszu (prawy klik: Reload/Remove), chip Update tylko przy aktualizacji; poniżej 1400 px lista albo szczegóły (`data-plugin-open` na `.core-settings-shell`, „← All plugins”); paczka z id `notible.` jest oficjalna bez czekania na katalog; nazwa z katalogu/manifestu zamiast z id; opis, uprawnienia i przewodnik z własnego manifestu pluginu z marketu (wcześniej wszystkie „Plugin surface for…”); przewodnik zwinięty; uprawnienia zwykłymi słowami; nowe opisy wbudowanych pluginów (tr()); wewnętrzne komendy `status` ukryte w „Adds right now”; szczegóły z marketu z opisem i przyciskiem wstecz. (B) nawigacja Settings w jednej linii (podtytuł jako tooltip), Help <1180 px: przycisk Contents, wejście w Help zamyka wyszukiwanie, równe odstępy spisu; Recovery: podsumowanie zawija się; About/Updates bez powtórzeń; Files & links krótsze teksty; menu wiersza: tworzenie w „New inside…”. (C) Properties poniżej 1200 px za przyciskiem w pasku (`.core-properties-toggle`); kolumna notatki 860 px wyśrodkowana (`.core-editor-panel.is-note`); menu „/” w jednej linii, hover obrysem (dwa wiersze nie wyglądają na zaznaczone); okno nowego projektu mieści się (flex, przewija się tylko lista); zakładki projektu w osobnym przewijaczu z maską, Modules poza nim; widoki i Finanse: „⋯” na import/eksport, jeden rozmiar tekstu w pasku; tabela: przypięta kolumna Title, widoczny pasek; Finanse: zdanie zamiast siedmiu zer; Typewriter: zwarte puste stany, rękopis 980 px. (Core) `manifest.locales` pluginu wreszcie trafia do tłumacza (`host.setPluginLocales`, `translateForPlugin(..., own)`; test w help-api-check §7); podpis w rogu tylko dla pomocników spoza Notible; id `notible.` dla paczek tylko z oficjalnego wydania (`installFromRoot`, motywy przekazują `zipUrl`); motywy nie mogą pisać tekstu przez `content:` (theme-css-check); Appearance bez wiersza Language; menu „+” w jednej linii; Hotkeys: skróty pluginów jako klawisze; Help: wstęp i słowa kluczowe strony „Move, export and delete”. Gdy w rogu jest pomocnik, Backlinks dostają 96 px marginesu na dole, więc koniec notatki da się przewinąć spod niego (sprawdza `nib-plugin.cjs`). Nib 0.2.0 (pixel art) wydany osobno; Nib 0.2.1: nowy wygląd (złożona karteczka, 7 nastrojów na canvasie 24×24).

## 0.93.0

Plan naprawczy 01.10, wydanie R3 „Structure and trust” (S2–S6, S8, N1–N9, N11, N12, N14, N15, T12). Test: `scripts/cdp/scenarios/r3-structure.cjs` (40 sprawdzeń, własny sandbox). (S4) `createTarget` = otwarty kontener albo kontener otwartego elementu; menu „+” pokazuje „Inside X” i przełącznik „Top level instead” (`createAtTop`, zerowany przy zamknięciu menu). Zadania z kart tablicy dostają `parentId` tablicy (`object.parent_id`). (S2/S8) `ContainerModulePicker`: `<form role="dialog" aria-labelledby>`, pole Name z autofocusem, Enter tworzy, bez „Use defaults”, bez „tab strip”; nazwa idzie do `createContainer(..., name)` i `runPluginCreate(..., name)` jako `title`. (S3) folder bez okna — `createContainer("folder", parentId, [])` z `focusTitleFor`. (S5) pusty przegląd przestrzeni: przyciski New project / New note (`plugin.data.objects.create` + `ui.openObject`). (S6) Modules jako przycisk-pigułka z ikoną. (N1/N11) `selectedPath` (przodkowie z `allObjects`), breadcrumb w nagłówku zamiast „NOTIBLE”, kroki klikalne, „All notes” → `goToTopLevel`; mały duplikat tytułu pod tytułem pusty (element zostaje jako cel kliknięcia); przodkowie rozwijani w drzewie. (N2) `.core-main > .core-notice` i `.core-alert` jako `position: fixed` (błąd ma ×); komunikaty w listach (market) zostają w miejscu. (N3) `notice` z akcją: „Undo” przywraca wszystkie id (`undoDelete`) i otwiera ponownie; 8 s zamiast 4. (N4) Kosz: Restore / Delete forever (z potwierdzeniem, razem z elementami w środku w koszu — `trashTreeIds`) / Empty trash; `deleteObjectForever` → istniejące `delete_object` (z tombstone dla synchronizacji). „Delete forever”, „Empty trash” w UNTRANSLATABLE. (N5) drzewo zawsze w panelu bocznym. (N6) Rename w miejscu (`renamingId`, input; F2 globalnie poza polami, dwuklik; otwarta notatka przez `applyTitle`, inna przez `updateWinningConflicts`), Move to… z menu wiersza, Duplicate (bez zawartości, tylko nie-kontenery), grupa „Export and print”. (N7) przeciąganie: górna ćwiartka wiersza = przed (stare `reorderRow`), reszta = do środka (`moveObjectTo`), nigdy do własnego potomka; Move to… pokazuje też notatki, bez siebie i potomków. (N8) rozwinięcia w `localStorage notible-core-expanded`, cel przeniesienia rozwijany. (N9) „Nothing to move it into yet. Create a folder first.”. (N12) historia: nazwa notatki w nagłówku, otwiera notatkę, podgląd renderowany (`renderCoreMarkdown` bez paska kodu; HTML escapowany, CSP bez zdalnych obrazów). (N14) `.core-main` przewijany do góry przy zmianie sekcji/elementu. (N15) „+” i „Notes” zamykają wyszukiwanie. (T12) okno wyboru kart (domyślnie zaznaczona karta albo wszystkie), „Create N tasks”. Poprawki API 1.22 po przeglądzie projektu Nib: `renderMarkdown` usuwa `<img>` (CSP pozwala na `data:`, więc tekst pluginu mógł narysować fałszywy baner), niepodpisany pomocnik w rogu ma podpis „nazwa, unverified”. Projekt pluginu Nib: `2026-10-02-nib-plugin-design.md` (dokument wewnętrzny, nieopublikowany).

## 0.92.2

Plan naprawczy 01.10, wydanie R2 „Plain words and polish” + API 1.22 dla pomocnika „Nib” + poprawki z rundy 3 Codexa i prośby użytkownika (Kanban, szczegóły pluginów). R2: (S1/D1-A) menu „+” z opisem w jednej linii (`core-create-menu-described`), nagłówek drzewa „All notes”, Help mówi to samo. (S7) „+” ma nazwę i podpowiedź „Create a note, folder or project” — scenariusze CDP szukają teraz tej nazwy. (G1) „Core workspace” → „How Notible looks”, zdanie o SQLite → „How restoring works”, About: Plugin API / SQLite / dist-core / Developer pack w zwiniętym `<details>` „Technical details”, „Relation: links_to” → „Links here” (`RELATION_LABELS`, tłumaczone przy rysowaniu, `coreBacklinks.ts` zostaje czyste dla Node), „6 of 14 plugins on” → „{on} of {count} turned on”. (G2) Editor bez udawanych wierszy ustawień. (G3) Files & links: bez wierszy tylko do odczytu, grupa „Plugin permissions”, rozmiary czcionek jak na innych stronach (usunięte nadpisania `.core-files-settings`). (G4) język wybiera się tylko w Languages (Appearance ma przycisk), przykład w polu GitHub, podpowiedź wyjaśnia, skąd wziąć adres; PL podtytuły nawigacji krótsze i łamane. (G5) Hotkeys: nazwa pluginu zamiast id, bez wewnętrznych komend `status` każdego wbudowanego pluginu (stąd był też podwójny „Create whiteboard”), „—” zamiast „off”. (G6) widoczny przycisk Restore przy kopii i w koszu (D7-A), „Open folder” tylko gdy są kopie, ścieżka w podpowiedzi, poprawione zdanie o obrazach. (G7) wynik „Check for updates” jako zielony chip; autostart domyślnie wyłączony w kodzie (włącza go tylko przełącznik), więc bez zmian. (G8) ikony Info/LifeBuoy, hover jaśniejszy niż zaznaczenie (dwa „zaznaczone” to był hover), skok tytułu o 4 px: `.core-settings-shell` miał `min-height: calc(100dvh - 132px)` o 4 px za dużo → `.core-main` przewijał się; teraz `flex: 1 0 auto` (to samo usuwa zbędny pasek przewijania, L8). (G9) „Follow system” (`useSystemDark`, matchMedia), lista Select/Combobox w rozmiarze czcionki kontrolki (portal dziedziczył 16 px), Compact naprawdę ciaśniejszy (reguły na końcu CSS z klasą powłoki; wiersz ustawień 73 → 55 px). (G12) liczba mnoga po angielsku: słownik `english` w core-i18n (wcześniej EN brał klucz = forma „other”). (N10) nazwy dostępności dla przycisków paska, bez „Use plain note editor” na projektach i przestrzeniach (też nie zostaje „przyklejone”). (N13) „Open on start”. (E15) w menu „/” tylko opis, bez nazwy pluginu. (E23) „Saved” przez 1,6 s po zapisie, kolor neutralny. (M2) Market: sekcje Official i Community, ostrzeżenie tylko nad Community, opis w wierszu. (M3) okno instalacji przez portal do `body` (animowany przodek był blokiem zawierającym `position: fixed`, stąd „nie na środku”), Cancel jako `core-button-secondary`. (M5) Refresh jako ikona, „Installing…” w wierszu. (L8) `text-wrap: balance` w pustym stanie. (L9) rozdział z jedną stroną bez nagłówka, aktywna strona z paskiem akcentu, zrzuty Help w wersji ciemnej: `help-media` robi `<name>.dark.webp` po przełączeniu na Midnight, HelpScreen podmienia przy `core-night` (z powrotem na jasny, gdy pliku brak). API 1.22 (spec `2026-10-01-helper-api-design.md` (dokument wewnętrzny, nieopublikowany), przerobiony wg krytyków i decyzji użytkownika): `context.help.topics()/onChange` z `buildHelpTopics` (czysta funkcja, `help-topics.ts`), dane przez `host.setKnowledgeProvider` (strony Help + `builtinCatalog` z produktu + rejestr; bez ścieżek, wersji, ustawień), stan `enabled/disabled/failed` (host pamięta nieudane `enable`), cache do zmiany, `onChange` sprzątane z pluginem. Strony `plugin-*.md` mają `plugin: notible.*` w front matter. `ui.openHelp`/`ui.openPluginSettings`: `workspace.ui` + gest użytkownika (`navigator.userActivation`) + najwyżej raz na sekundę; po otwarciu ustawień przez plugin lista pluginów ignoruje kliknięcia 500 ms. `ui.renderMarkdown` = renderer edytora bez paska bloku kodu (HTML escapowany, linki bez `href`). Slot `workspace.corner`: jeden lokator (wybór w Settings → Plugins → Corner helper, domyślnie pierwszy po id, „None”), lewy dolny róg obszaru notatki (z dala od karty aktualizacji i powiadomień po prawej), `contain: layout paint`, limity rozmiaru, podpis Core „Helper · nazwa (id)” poza pudełkiem; nazwa z „Notible” u niezaufanego pluginu → „Community plugin”; ukryty CSS-em (nie odmontowany) w Settings, Help, przy modalu i w trybie skupienia. CSP `form-action 'none'` (csp-check pilnuje). `PLUGIN_API_VERSION` 1.22 w Rust, REFERENCE/README/START, `.d.ts`, plugin-api-check, plugin-docs-check. Przykład `plugins/examples/corner-helper`. Testy: `scripts/help-api-check.mjs` (w `test:extensions`), scenariusze `r2-plain-words.cjs` i `nib-corner-helper.cjs`. Sandbox: `start --size WxH` zmienia rozmiar natywnego okna (Rust, tylko sandbox); `Browser.setWindowBounds` przez CDP zmieniał tylko WebView, więc aplikacja rysowała się poza oknem (to widział użytkownik) — scenariusz Kanbana używa teraz `--size`, zakaz opisany w AGENT_SANDBOX.md. Wcześniej w tej wersji (round 3 i prośby użytkownika): cytat Enter/Shift+Enter, `- ` po liście, ponawianie konfliktu zapisu tytułu (`updateWinningConflicts`), kursor po `/Code block` (ZWSP), wybór `[[` (`slashInsertNonce`), pasek formatowania i menu języka przy dolnej krawędzi, Kanban o stałej wysokości, szczegóły pluginów na niskim oknie.

## 0.92.1

Plan naprawczy 01.10, wydanie R1b „Text integrity” (E5–E11, E14, E16–E22, E26, CP61). Każda zmiana ma test: `core-markdown-marks-check.mjs`, `core-only-check.mjs`, test Rust `renaming_a_linked_note_keeps_its_links`, scenariusze CDP `r1b-text-integrity.cjs` (28), `e14-slash-blocks.cjs` (6, Tables z marketu), `e11-spellcheck.cjs` (4, z restartem sandboxa). (E6) Przyczyna: renderer zjadał tabulator po znaczniku listy/nagłówka (`-\s+`, `\s*` w zadaniach), a `nodeMarkdown` go zostawiał — ekran o znak krótszy od zapisu, offsety przesunięte, podświetlenie wyrzucało punkt z listy. Teraz po znaczniku zdejmowane są tylko spacje; `applyEdit` znaczy Markdown zbudowany z DOM, nie `lastValue`; znaczniki nigdy nie przechodzą przez koniec linii (`toggleInlineMark` per linia, po prefiksie bloku) i obejmują tekst bez spacji brzegowych. (E7) `detectWikilinkTrigger` zjada automatycznie domknięte `]]`; `beforeinput` wychodzi też z `.core-md-wikilink`. (E8) `labelWikilinks`: link pokazuje `data-current-title` przez `::before` (surowy tekst ma font-size 0, więc offsety bez zmian), przy kursorze w środku — `is-editing` pokazuje surowy tekst; przejście przez `]]` przebudowuje. (E22, D11-B) Rust: zmiana tytułu dopisuje stary tytuł do `props.previousTitles` w tym samym UPDATE, tylko gdy jakaś notatka z relacją `links_to` ma `[[stary]]` w treści (połowiczne tytuły z autosave nie trafiają); `find_object_id_by_title` szuka też w `previousTitles` (aktualny tytuł wygrywa). Wcześniej kolejny zapis notatki linkującej kasował relację. JS: `resolveWikilinkTarget` woli tytuł od aliasu; `allObjects` aktualizowane przy edycji tytułu i po każdym zapisie (CP61). (E21) Ctrl+klik otwiera link, zwykły klik edytuje, Alt+← wraca (stos w `loadEditor`). (E5) Tab/Shift+Tab w liście punktowanej i zadań zmienia `data-indent` (płaska lista, CSS), Markdown `\t- item`; listy numerowane bez zmian. (E9) kursor w pustej linii bloku kodu (`SLASH_CARET_INSIDE`), pusty `<code>` z ZWSP, offsety bloku kodu liczą linię płotka, etykieta języka to przycisk z menu (raw `<select>` zabroniony przez ui-baseline). (E14) Table/Link/Image w menu „/”; tabele w końcu mają matematykę kursora (`tableCellOffsets`). CE28 („/tab” zostawał) nie odtwarza się po poprawce E2. (E20) Tab w ostatniej komórce dodaje wiersz. (E11) przyczyna: wry ustawia WebView2 `language` na język Windows i działa tylko ten słownik. `set_ui_language` zapisuje `ui-language` w app data; `run()` przed startem webview dopisuje `--accept-lang=` do `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` (z domyślnymi flagami wry). Zmierzone: 333 → 0 czerwonych pikseli pod poprawnym angielskim. Bez sprawdzania pisowni w tytule, wyszukiwarce i kodzie. (E17) pasek formatowania pod zaznaczeniem, przyciski Heading/Link (`toggleHeading`, `wrapLink`), H bez wypełnienia. (E18) `countWords` liczy tokeny z literą/cyfrą po zdjęciu prefiksów bloku. (E19/E26) H1–H3 mniejsze od tytułu, treść równo z tytułem (zmierzone 346/346 px). `extract-locale-keys` łapie `tCore(`. Sandbox: `NOTIBLE_SANDBOX_BROWSER_ARGS` dla dodatkowych flag WebView2.

## 0.92.0

Plan naprawczy 01.10 (`Notible-feedback/2026-10-01-repair-plan.md`), wydanie R1a „Writing works”, z testu nowych użytkowników 30.09. Każdy punkt ma scenariusz CDP `scripts/cdp/scenarios/r1a-writing.cjs` (własny sandbox, 32 sprawdzenia, kod wyjścia 1 przy błędzie); E1–E3 nie przechodziły na buildzie sprzed zmian. (E2) Pierwsza linia nowej notatki to goły węzeł tekstowy pod korzeniem edytora; `markdownOffsetAt` liczył linie przed blokiem z `root.children` (tylko elementy), więc kursor wypadał o całą linię za wcześnie i `detectSlashTrigger` nie widział „/”. Teraz `root.childNodes` przez wspólne `linesOfRootChild` (to samo co `markdownFromCoreHtml`). (E3) Bloki z Markdown nie zamieniały się w trakcie pisania w ogóle (na żadnej linii; tylko „- ”/„1. ” miały obsługę). Spacja po samym `#`/`##`/`###`/`>` w linii zamienia ją na h1–h3/blockquote, a po `[ ]`/`[x]` w punkcie listy — na zadanie (`event.key === " "`, za obsługą list, bo `prose-profile-check` wymaga, by pierwsza taka gałąź sprawdzała `dashList`). (E1) Enter w tytule: kursor na początek treści, tekst za kursorem idzie jako pierwsza linia (`enterBodyFromTitle`, `applyTitle` wspólne z onChange). (E4) Enter w liście zadań: przeglądarka klonuje `<li data-task>` bez pola — `addMissingTaskBoxes` przy `insertParagraph` dodaje puste pole; klik w pole przełącza `data-checked` (wcześniej nie było obsługi); niezaznaczone pole to sam obrys. (E10) `{t("Copy")}` w template stringu → `tCore("Copy")`, „Copied” też tłumaczone. (E12) Ctrl+N i Ctrl+, przed strażnikiem pól tekstowych. (E13) filtr menu „/” po opisie; spacja nie zamyka menu, dopóki tekst jest początkiem nazwy komendy; miejsce pod kursorem liczone względem okna, nie `bodyWrap`; zaznaczenie po `mousemove`, nie `mouseenter` (też w menu `[[`). (E24) tytuł i pole wyszukiwania bez globalnego `outline` (zostaje obramowanie + miękki pierścień), aktywny przycisk wyszukiwania bez wewnętrznego pierścienia przy fokusie. (N16) `<title>` w `src/product/test-host/index.html` → „Notible” (to ten HTML trafia do instalatora). Help: sekcja „Typing a block” w `writing-notes.md`. Poza Core, tego samego dnia: Tables 0.6.9 (P1, utrata danych przy szybkim wpisywaniu) wydane osobno.

## 0.91.3

Po buildzie 0.91.2 (29.09 20:04) trzy zgłoszenia użytkownika. (1) Kanban: na zainstalowanej 0.91.2 poziome przewijanie nie działało (przez CDP syntetyczne kółko przewijało — nie odtworzone, zależne od urządzenia). Nowe podejście: kolumny w naturalnej wysokości, przewija się strona; własny pasek tablicy ukryty, zamiast niego `.plugin-view-kanban-rail` (sticky do dołu okna) zsynchronizowany z `scrollLeft` tablicy; poziome kółko / Shift+kółko → `scrollLeft`; przeciąganie pustego tła przesuwa (karty, przyciski, pola wykluczone). Callback refy (state), bo element tablicy wymienia się przy zmianie widoku. Sprawdzone w hoście testowym (48 zadań / 6 kolumn, 1280×861). (2) Strona po logowaniu OAuth zawsze po angielsku — usunięty wariant PL i odczyt Accept-Language (`callback_page(ok)`). (3) Typ `note` miał pusty schemat (`{"fields":{}}`), więc Properties nic nie pokazywało, choć notatki mają `props.tags` (ręcznie i od agenta przez MCP). Migracja 030 `migrate_add_note_tags_field` — wspólny `add_tags_field` z migracją 023, tylko dopisuje pole. Poza repo: skill Hive `notible-worklog` przepisany — dokładne klucze i wartości dla note/task/issue, bo serwer MCP nie waliduje props względem schematu.

## 0.91.2

Zgłoszenie użytkownika 29.09 (Sync Simple): po zalogowaniu do Google w przeglądarce zostawał goły tekst „Authorization complete. You may close this window.” (text/plain). Teraz jedna wspólna `cloud_oauth::callback` dla wszystkich przepływów (plugin_oauth — Sync/Sync Simple, calendar_oauth — Google/Outlook, cloud_oauth); zduplikowana kopia z calendar_oauth usunięta. Odpowiedź to strona HTML: znak Notible (`public/brand/notible-icon.svg` przez include_str, kropka czerwona przy błędzie), jedno zdanie, motyw wg prefers-color-scheme, PL gdy Accept-Language zaczyna się od „pl”. Po odpowiedzi `show_main_window` (teraz pub(crate)) wyciąga okno Notible na wierzch. Karty nie da się zamknąć skryptem (przeglądarka nie pozwala zamknąć karty, której nie otworzył skrypt), więc strona o tym mówi. Własny schemat `notible://` świadomie pominięty (instalator + brak zysku przy Google loopback). Timeout kalendarza 120 s → 180 s jak reszta; komunikaty błędów ogólne („Sign-in…”), żaden kod JS ich nie dopasowuje. Test `callback_page_is_a_whole_page_in_both_languages`; strony obejrzane headless (Edge) w jasnym i ciemnym motywie.

Zgłoszenie użytkownika 29.09 (przed buildem 0.91.2): (1) Kanban na małym ekranie — poziomy pasek był pod najdłuższą kolumną, poziome kółko myszy nie działało. `.plugin-view-kanban` ma `max-height: max(420px, 100dvh - 120px)`, jeden wiersz `minmax(0,1fr)`, kolumny `overflow-y: auto`; nieprzekazywalny listener `wheel` (deltaX lub Shift+kółko → `scrollLeft`, pionowe kółko nietknięte). (2) „Nie ma Sort” — był, jako nieopisana lista „None”. Teraz etykieta „Sort”, „Manual” zamiast „None”, nowe pola Created/Updated (domyślnie malejąco), sortowanie zapisywane w widoku (`view.sort`, jak `columnSort` Tabeli). Sprawdzone w hoście testowym (48 zadań, okno 861 px): tablica 741 px, kółko przesuwa, pionowe nieprzechwycone, sort po przeładowaniu zostaje. (3) Zapisy spoza apki (serwer MCP z Hive) nie odświeżały drzewa: `watchExternalChanges` — przy fokusie/powrocie okna porównuje kursor `integration_events` i tylko przy zmianie woła `notible:workspace-changed`. Otwarta notatka miała już własny backstop 30 s. Tego nie dało się sprawdzić w hoście testowym (mock nie ma `integration_events`) — do sprawdzenia po buildzie.

API 1.21 (prototyp Notible Teams, spec `2026-09-29-notible-teams-prototype-design.md` (dokument wewnętrzny, nieopublikowany)): `plugin_oauth::Provider::GoogleIdentity` = `openid email profile` na kliencie Notible Sync, `access_type=online` + `prompt=select_account`, wynik `{accessToken, expiresIn, idToken}` BEZ refresh tokena (po przeglądzie bezpieczeństwa: refresh z `openid` mógłby bez końca wybijać ID tokeny w cudzym storage). `refreshToken` w typach opcjonalny. `PLUGIN_API_VERSION`/`EXTENSION_API_VERSION` 1.21, REFERENCE/README/START, plugin-api-check. Ryzyko opisane w komentarzu modułu: każdy plugin z `network` może dostać e-mail i ID token → serwer Teams ma własną białą listę kont.

## 0.91.1

Zgłoszenie użytkownika 25.09 po 0.91.0 + ReportIt 0.1.14: w raporcie z Northwind diagram jako zepsuty obrazek. Odtworzone headless na prawdziwym źródle z bazy (tylko odczyt): Mermaid w etykietach z `<br/>` zapisuje niezamknięte `<br>` w foreignObject; innerHTML w edytorze to wybacza, `<img>` z SVG (ścisły XML) nie — parsererror „Unexpected closing tag p != br”. Poprawka: `svgAsXml` w `toSvg` (DOMParser text/html → XMLSerializer). ReportIt 0.1.15 robi to samo po swojej stronie (`asXml`), więc działa już na 0.91.0. Test e2e w przeglądarce: ExtensionHost + editor-extensions + `renderCodeBlockSvg` → `<img>` ładuje się; ReportIt `asXml` na surowym SVG też.

## 0.91.0

Przegląd całości 25.09 (zewnętrzny review + weryfikacja w kodzie). (1) `reload()` szukał otwartej notatki w WYNIKU wyszukiwania (`next`), nie w całym workspace: każde wyszukiwanie czegoś innego zamykało notatkę, a `saveNote()` bez id nic nie robiło → tekst sprzed <0,7 s ginął. Teraz `allSource.find`. Headless (dev host 5391, Edge): stary kod → notatka zamknięta, znacznik NIEZAPISANY; nowy → otwarta, zapisany. (3a) `saveLeftNote` przy błędzie odkłada tekst w localStorage `notible.unsavedDraft.<id>`, `loadEditor` → `restoreUnsavedDraft` przywraca go jako brudną edycję (autosave ponawia). (3b) Tray „Quit”: Rust `request_quit` → `eval` zdarzenia `notible:quit-requested` → JS `quitApp()` = `flushPendingSave` → komenda `quit_app`; awaryjnie exit po 3 s. `installUpdate()` też najpierw woła `beforeExit` (flush). (5) `ExtensionHost.enable`: `onload` z limitem 30 s; spóźniony plugin sprząta po sobie, chyba że został włączony ponownie. Dalej w tej samej wersji (użytkownik: „wszystko jako 0.91.0”; 0.90.7 nie było budowane): (2) wyszukiwanie przez nową komendę Rust `search_objects_text` (podciąg, `to_lowercase` z polskimi znakami, bez kosza/archiwum), JS dofiltrowuje `matchesNoteSearch` na tekście widzianym przez użytkownika; przy aktywnym zapytaniu lista workspace nie jest pobierana ponownie (`allObjectsRef`). Świadomie NIE FTS: prefiksy nie znajdują `CAPSSFR` w `SEU_CHN_MA_SET_CAPSSFR_COMPLETE`. Limit 5000 dla backlinków zostaje (plan „large-workspace scaling”). (4) `busy` jako licznik (`setBusy(±1)`), zapis notatki ma własne `saving`, `reload()` nie ustawia busy; usunięte niesparowane `setBusy(false)` w `runPluginCommand`. (6) ok. 170 tekstów owiniętych w `t()` (skrypt + ręcznie: statystyki, „+ New view”, Board), `locale:extract`, 154 nowe tłumaczenia PL; `pl.json` pokrywa cały katalog (813). `PluginViewSurface.tsx` (stare drzewo `src/product`) pominięty. Styl przycisków `.core-button` = primary zostawiony — to wcześniejsza świadoma decyzja („one burgundy button style”). (7) z `CoreOnlyApp.tsx` wydzielone bez zmian `coreDocument.ts` (Tiptap↔Markdown) i `CoreSettingsPanels.tsx` (3230 → 3065 linii). Przegląd „stanu cicho porzucanego”: Properties zapisywały debounced props do obiektu z `objectRef` w chwili timera → zmiana A + przejście na B w <450 ms nadpisywała B (UTRATA/USZKODZENIE DANYCH); teraz cel ustalany przy edycji, flush przy zmianie obiektu i odmontowaniu. Whiteboard (`canvas-ui`) gubił ostatnią zmianę przy przełączeniu/zamknięciu → flush. API 1.20 `editor.renderCodeBlockSvg` + `toSvg` w `registerCodeBlockRenderer`; Mermaid przez `mermaidSvg()`. ReportIt 0.1.14 rysuje ```mermaid jako `<img>` z data-URI SVG (innerHTML zabroniony self-checkiem), starszy Core → kod. Headless: diagram w `<img>` z etykietami OK, błąd składni odrzucony bez śmieci w DOM. Repozytoria pluginów: Graph 0.11.5, Sync 0.4.5, Sync Simple 0.5.5 były wydane, ale repo stało na poprzedniej wersji — kod identyczny z wydanymi zipami (sha1), dosynchronizowane commitami. Nowy `scripts/release-plugin-repo.mjs` wydaje plugin z monorepo do jego repo jednym poleceniem.

## 0.90.6

Zgłoszenie użytkownika 25.09 (prod 0.90.5, CDP). (1) Projekt Northwind: tabela `Northwind data export…` jest w projekcie (relacja `in`), ale jedyny widok projektu ma `typeFilter: "task"`, a w selekcie Type nie było opcji powrotu do „All types”. Dodana opcja `""` → widok bez filtra pokazuje wszystkie rekordy (`passesTypeFilter` chowa tylko typy strukturalne). (2) Board, zapis nazwy: pointerdown na planszy/karcie ustawia drag/band, zanim input dostanie blur → `commitEdit` zapisywał tytuł, ale `load()` wracało od razu (`busyRef`), a później nic nie odświeżało stanu. Teraz `load` w trakcie gestu ustawia `pendingLoadRef` i przeładowanie rusza po końcu gestu i zapisów (`chainRef`), a tytuł zmienia się od razu lokalnie. (3) Board, „tło się nie powiększa”: ramka jest liczona tylko z członków; „Hol” nie był członkiem „Rozdział 1”. Pojedyncza karta upuszczona środkiem w ramce, do której nie należy, dołącza do najmniejszej ramki pod sobą (`joinFrameAt`). Na prośbę użytkownika dodana też odwrotna droga: prawy klik na karcie → podmenu „Add to frame” z listą istniejących ramek (bez tej, w której karta już jest). Przenosi kliknięty węzeł razem z resztą zaznaczonych węzłów, ramek nie. Wspólne `moveToFrame`.

## 0.90.5

Test na żywo 24.09 (CDP, prod 0.90.4 zbudowane 15:37, notatka Docs → Northwind: 4 obrazki + mermaid, bez żadnych zmian w notatce). (a) Obrazek w osobnej linii renderował się jako goły `<img>` pod rootem edytora, bez pozycji kursora obok. Klik na prawo od obrazka lądował w tekście „mermaid” na pasku bloku kodu (otwierał źródło), klik pod nim albo przy lewej krawędzi w `<code>`, a klik na obrazek w ROOT index 0, czyli na początku notatki. Teraz `renderCoreMarkdown` owija go w `p.core-md-picture` (img inline-block), a serializacja się nie zmienia (`<p>` → `![](…)`). (b) `.core-code-toolbar`/`.core-code-render` mają `user-select: none`. (c) Edytor kończył się równo z diagramem, więc nie było gdzie kliknąć pod ostatnim blokiem: `padding-bottom: 96px`, razem z `paragraphAfterTrailingCodeBlock`. (d) **Utrata danych, wykryta headless przy okazji:** przełączenie notatki w ciągu 700 ms od ostatniego klawisza gubiło tekst, bo cleanup efektu autozapisu kasował timer, a `loadEditor` zerował `dirty`. Dotyczyło wszystkich 8 wywołań `loadEditor`. Teraz `loadEditor` zapisuje migawkę opuszczanej notatki przez `saveLeftNote()` (konflikt: wygrywa pisanie). Test `switchsave.cjs`: 3× LOST → 3× kept. Zamknięcie okna chowa apkę do zasobnika, więc tam timer i tak się wykona; ryzyko zostaje tylko przy Quit z zasobnika w ciągu 0,7 s. (e) Macierz headless (użytkownik: „czy podobne zachowanie jest w innych scenariuszach, szczególnie przy screenshotach”): 12 typów bloków × (obrazek nad/pod, blok ostatni + klik pod nim, zrzut wklejony na końcu bloku) + wklejki tekstu/adresu/HTML w każdym bloku + Ctrl+A. Reset stanu bezpośrednio przez `devInvoke` z atrapy (ten sam moduł co apka), bo reset przez Ctrl+A+wklejkę sam był zepsuty. Znalezione i naprawione: (e1) **utrata danych:** `linesForElement` zapisywał blok `::: columns`/`calendar` jako pusty, więc każda edycja notatki kasowała zawartość kolumn; teraz linie ze `<span>`, a etykieta to `strong.core-md-block-label` z contenteditable=false, pomijana w serializacji i w arytmetyce kursora. (e2) Zrzut w bloku kodu/Mermaid/tabeli/kolumnach wstawiał się w środek (kod przecięty w pół linii, tabela rozcięta w nagłówku; `markdownOffsetAt` liczy pozycje w `pre`/`table`/`.core-md-block` błędnie); teraz ląduje w linii pod blokiem. (e3) Adres, HTML i wiele linii wklejane do komórki tabeli albo do linii kolumn trafiały do wiersza nagłówka lub w słowo `::: columns`; teraz idą przez `insertText` w DOM (jedna linia, link jako `[..](..)`). (e4) Ctrl+A i wklejenie, wpisanie znaku, Delete lub Ctrl+X zostawiały „skorupę” pierwszego bloku (kod, cytat) albo resztki diagramu; teraz flaga `selectAllActive` i `replaceWholeNote()` na poziomie markdownu, z obsługą AltGr i `onBeforeInput` dla emoji, dyktowania i IME; każdy klik lub inny klawisz ją kasuje. (e5) Klik pod ostatnią tabelą, linią poziomą, kolumnami lub obrazkiem tworzy nową linię (`TRAILING_BLOCKS`; tabela i linia pozioma wysyłały kursor na początek notatki); pod blokiem tekstowym kursor trafia na koniec bloku zamiast w miejsce pod myszą. Znane ograniczenie: zaznaczenie przeciągnięte myszą przez kilka bloków, zaczynające się w bloku kodu lub tabeli, dalej liczy pozycję przybliżenie (`markdownOffsetAt` nie zna prefiksu płotu ani kresek tabeli). Wyniki: matrix 67/0, textpaste 21/21, tablepaste 4/4, selectall 20/20, pictures 9/9, switchsave 3/3.

## 0.90.4

Backlog 24.09 (użytkownik: najpierw 4, potem 5 i 2). (4) Automatyzacje: sprawdzone na bazie, tylko do odczytu. Oryginalny projekt „Notible 1.0 — Project Planning & Gantt” (8e4a8ef0, 22 zadania) ma obie reguły `date_reached` WŁĄCZONE. Wyłączone są na kopii konfliktu b9f15a72 (0 zadań). Ostatni zapis logu powtórek: 14:02, stara wersja. Od instalacji 0.90.3 (14:35) dwa cykle 15 min bez zapisu, czyli poprawka działa w praktyce. Kodu nie zmieniano. (5a) `paragraphAfterTrailingCodeBlock()` w `CoreMarkdownEditor`: blok kodu jako ostatni blok notatki nie miał miejsca na kursor pod sobą. Klik pod nim i Ctrl+End trafiały do zwiniętego źródła diagramu, więc pisanie psuło diagram; to był „nie da się pisać po renderze” z backlogu 01.09. Teraz klik pod blokiem, Ctrl+End i strzałka w dół z ostatniej linii wstawiają akapit ZWSP pod blokiem. Duplikacja renderu z tamtego wpisu się nie reprodukuje (headless dev host: jeden kontener, jedno SVG po każdym kroku). (5b) Wklejenie obrazka w punkt listy usuwa zaznaczenie (`range.deleteContents()`). (2) Hiperłącza. Decyzje użytkownika: zwijany adres (styl Obsidiana) i Ctrl+klik. `coreMarkdownMarks.ts`: w `INLINE_MARK_PATTERN` nowa alternatywa `[tekst](url)`, tylko `LINK_URL` (http/https/mailto, bez nawiasów i białych znaków). Render: `span.core-md-link[data-url]` z dwiema częściami `.core-md-link-mark`, a każdy znak zostaje tekstem, więc serializacja i arytmetyka kursora działają jak przy wikilinku; `inlineMarkdownOf` i `markdownOffsetAt` bez zmian. CSS chowa części `mark` poza `.is-editing` i dokleja „↗”. `syncEditingCodeBlock` przełącza `.is-editing` także na linku. `beforeinput`: kursor na samym końcu linku (w ukrytym `](url)`) wychodzi za link, zanim wpadnie tekst. Link wpisany ręcznie rysuje się od razu: przeskok domkniętego `)` wywołuje `rebuildKeepingCaret()`, a `onInput` z `)` zostawia nieaktualne `lastValue`. Wklejanie: adres na zaznaczenie daje `[zaznaczenie](url)`; bez zaznaczenia etykietą jest tytuł `<a>` z text/html albo sam adres. `markdownFromPastedHtml`: `<a href>` zamienia na tekst `[..](..)` (dotąd usuwał href), inne href zostawia jako sam tekst; `body.normalize()`; fragment zdania bez bloku owija w `<p>` (dotąd każdy kawałek lądował w osobnej linii i ginęło pogrubienie). Wklejka jednej linii bez składni blokowej trafia w miejsce kursora. Spacja przed wklejką zostaje (`spaceBefore`; nbsp zamieniana na spację). Testy: `core-markdown-marks-check.mjs` (m.in. `javascript:` i ścieżka względna nie są linkami), headless dev host: 14/14. Pomoc: `writing-notes.md` → „Links to web pages”. (Tab) Zgłoszenie użytkownika: Tab w edytorze zawsze przenosił fokus (edytor w ogóle go nie obsługiwał), co utrudniało pisanie kodu. `handleTab()`: w komórce tabeli Tab/Shift+Tab przechodzi do następnej/poprzedniej komórki i zaznacza jej zawartość; w bloku kodu wstawia 2 spacje (nie `\t`, bo YAML w nagłówku `config:` Mermaida nie przyjmuje tabulatorów), przy zaznaczeniu wcina każdą linię, a Shift+Tab cofa wcięcie; w tekście `insertText "\t"`. `inlineHtml` rysuje `\t` jako `span.core-md-tab` (`white-space: pre`, span bez delimitera, więc dalej jest to `\t`). `nodeMarkdown` nie przycina już tabulatorów na początku (`/^[^\S\t]+|\s+$/`), wcześniej `.trim()` zjadał wcięcie przy przebudowie. Esc, a potem Tab, wyprowadza fokus z edytora (żeby nie było pułapki klawiatury). Menu `/` i `[[`: Tab wybiera pozycję (`CoreOnlyApp`). Plugin Tables ma własną obsługę Tab, bez zmian. Headless: `tab.cjs` 13/13, linki i blok kodu bez regresji.

## 0.90.3

Zgłoszenia użytkownika 24.09 (Mermaid). (1) `CoreMarkdownEditor` onPaste: każda gałąź (obraz, blok kodu, HTML, tabela, kod, wiele linii) wstawiała na `range.startOffset` i ignorowała koniec zaznaczenia; teraz `selectionEnd()` i wklejka zastępuje zaznaczenie. Wyjątek: obraz wklejony w punkt listy przy zaznaczeniu. (2) `syncEditingCodeBlock`: blok kodu zwija się też po utracie fokusu przez edytor (`focusin`/`focusout`), a nie tylko po przesunięciu kursora. (3) Mermaid: motyw `dark`/`neutral` wg `color-scheme` na `:root` zamiast stałego `neutral`. (4) Miganie notatki co ~2 min: każdy `notible:object-event`/`workspace-changed` podbija `decorateNonce`, więc diagram był niszczony i rysowany asynchronicznie od nowa (znikał, kod się rozwijał, notatka skakała). Teraz jest cache SVG wg motywu i źródła, więc przy ponownym rysowaniu diagram podmienia się synchronicznie. (5) Motyw diagramu z `theme.mode` z `CodeBlockContext` zamiast `color-scheme`. (6) Pasek po najechaniu na diagram: Expand (overlay na `document.body`, zoom kółkiem wokół kursora, przesuwanie, Esc; zmienia rozmiar SVG zamiast skalować CSS-em, więc tekst zostaje ostry), Copy image (PNG 2x przez canvas → `navigator.clipboard.write`), SVG / PNG przez `plugin.ui.exportBinaryAs` (API 1.19, uprawnienie `workspace.ui` już było). Tło PNG = tło notatki. Sprawdzone headless na Edge: SVG z `foreignObject` nie blokuje canvasu (tainting). (7) Nowa zależność `@mermaid-js/layout-elk` 1.0.0 (MIT, oficjalna, peer mermaid ^12), ładowana razem z mermaid przy pierwszym diagramie; `registerLayoutLoaders`. Domyślnie nadal dagre, ELK tylko przy `config: layout: elk`. (8) Pomoc (`plugin-editor-extensions.md` + guide pluginu): przyciski i nagłówek `config:`.

## 0.90.2

Wydanie poprawki automatyzacji: ponowne sprawdzenie wykonanej regu?y date_reached nie dopisuje logu i nie zapisuje projektu co 15 minut. Osobne wydania Sync 0.4.5 / Sync Simple 0.5.5: zmiana samego kosza nie tworzy kopii, rzeczywiste przegrane zmiany pozostaj? w koszu, tabele w koszu nie s? scalane. Wymagana aktualizacja pluginu na obu urz?dzeniach. Instalator Core buduje u?ytkownik.

## 0.90.1

Sync-safe edytor + historia wersji (spec `2026-09-23-sync-safe-editor-and-version-history-design.md` (dokument wewnętrzny, nieopublikowany), rev. 2 po krytykach). (1) Migracja 029 (`Migration::Fn`, idempotentna): `history.source` (`local`/`sync`/`restore`/`baseline`), `writer` (`editor`/NULL), `session_start`. (2) `record_history` jedynym miejscem zapisu historii: zapisy edytora łączą się w sesje (przerwa < 5 min, sesja < 30 min), limity 50 zwykłych + 10 z sync na obiekt, 2 MB na wersję, 256 MB na całą historię (po każdym `sync_apply`, najpierw najstarsze z sync). (3) `updated_at = max(now, poprzedni + 1)` — lokalny zapis zawsze nowszy od zastępowanego, nawet przy spieszącym się zegarze drugiego urządzenia. (4) Wiersz `baseline` przed pierwszą zmianą obiektu bez historii. (5) `list_history` zwraca same metadane; nowe `get_history_entry`, `delete_history_entry`, `clear_history`; `restore_version` przez `require_json`. (6) Edytor: `refreshOpenNote` na `notible:workspace-changed` + co 30 s, przerywany każdym naciśnięciem klawisza (`draftVersion`) — stary poller czytał nieaktualny `dirty` i mógł zjeść znak. Konflikt przy zapisie: wygrywa pisanie, komunikat. (7) `object.opened` ma `view: "editor" | "tab"` (API docs). (8) `VersionHistoryPanel.tsx`: „Edited …” w stopce + „Version history” w menu prawego kliknięcia. (9) Zgłoszenie użytkownika 23.09 wieczorem: 11 kopii „(conflict copy)” projektu z regułami `date_reached`. `runDueDateReachedRules` co 15 min logował „skipped — Already executed” dla każdego zadania po terminie, więc projekt zmieniał się na każdym urządzeniu, a sync widział edycję po obu stronach. Teraz powtórki (`ALREADY_EXECUTED`) nie trafiają do logu; test w `automations-clarity-check` (pada na starym kodzie). Po stronie pluginów: Sync Simple 0.5.4 / Sync 0.4.4 (wydane 23.09) nie liczą `_automationLog` w `objectHash`. (10) Menu prawego kliknięcia w drzewie: `useLayoutEffect` przesuwa `.core-row-context-menu` do wnętrza okna (także po zmianie wysokości przez potwierdzenie Delete), CSS `max-height` + przewijanie.

## 0.87.3

Uwagi użytkownika 21.09. (1) Details w Settings > Plugins: `.core-plugin-detail` ma animację `core-detail-in`, komponent
z `key` po id (remount przy zmianie). (2) Strzałka Reload obraca się na hover (`.core-plugin-index-reload`,
`.core-reload-button`, nowa ikona w Details). (3) Usunięcie otwartej notatki: `reload()` miało "cold-start fallback"
otwierający PIERWSZĄ notatkę z listy ("Notible 1.0"); teraz `reload(query,{keepEmpty:true})` + `returnAfterDelete`
(wraca do `previousSelectedIdRef`, potem do rodzica). (4) "Verified/Unverified" opierało się na fladze podpisu, której
Model A nie ma, więc wszystko było Unverified: teraz `isOfficialReleaseUrl` (owner github.com = prejas3; oficjalne =
pakiet źródła "package" + URL wydania z katalogu), etykiety Official/Community; to POCHODZENIE, nie podpis. (5) Graph
0.11.5: kamera podąża za układem (`easeToFit` co klatkę, 6%) zamiast skoku przy parkowaniu; zmierzone: max zmiana
widoku na klatkę 81,7% -> 0,84% (syntetyczny graf 90 węzłów).

## 0.87.2

Znalezione przy budowie motywu Synthwave (test społecznościowego pakietu). (1) `themeCss.ts`: `boostRoot` zapisuje każdy
`:root` z motywu jako `:root:root:root`, bo Midnight to `:root.core-night` (0,2,0) i wygrywał z motywem w trybie
dark. (2) `MAX_THEME_ASSET_BYTES` 4 MB -> 1400 KB: Chromium odrzuca wartość CSS >~2 MB, więc zasób jako data: URI
(+33%) większy niż ~1,5 MB po prostu się nie pokazywał. Test: `theme-css-check`. Dokumentacja THEME_PACKS.md: sekcja
Image tips. Przykład: `examples/theme-synthwave` (opublikowany osobno jako prejas3/notible-theme-synthwave).

## 0.87.1

Hooki motywów (decyzja użytkownika 21.09) + Developer pack z instrukcjami języków i motywów.

**Core (bez przebudowy):** tokeny `--notible-app-backdrop`, `-sidebar-background`, `-sidebar-filter`, `-main-background`,
`-editor-font-size`, `-editor-line-height` (`core-only.css`, domyślne = dotychczasowy wygląd); atrybuty
`data-notible-mode`/`-theme` (na `<html>`), `-density` (shell), `data-notible-region` sidebar/main/editor.
**Developer pack (`export_plugin_devkit`, DEVKIT_FILES):** +THEME_PACKS.md, LANGUAGE_PACKS.md, examples/theme-glass,
examples/language/en.json (`locales/en.json` z tego builda). `plugin-docs-check` pilnuje, że każdy hook jest w Core
i w dokumentacji; `theme-css-check` że sanitizer go nie gubi. Znane: sidebar-filter tworzy containing block dla
elementów fixed wewnątrz sidebara (opisane w THEME_PACKS.md).

## 0.87.0

Zawiera niezbudowane 0.86.0. Decyzje użytkownika z 21.09: pakiety językowe i motywy społeczności jako osobne
katalogi (`languages/index.json`, `themes/index.json`), widoczne tylko na swoich ekranach (nie w markecie).

**Języki:** `install_locale`/`remove_locale` (Rust, `sanitize` przepisuje plik), ekran Settings > Languages
(`CoreLanguagesPanel`), `docs/LANGUAGE_PACKS.md`. **Motywy:** paczka wtyczki z `manifest.theme`, bez `entry`,
tylko dozwolone pliki (`extract_plugin_zip`); CSS przez `themeCss.ts` (tokenizer, przebudowa z tokenów, bez
@import/image-set/!important, url() tylko względne); zasoby jako data: URI przez `read_theme_asset` (CSP bez
zmian); `themePacks.ts` = store Core<->ekran; `.core-critical` chroni ekran Themes i potwierdzenia; boot
guard `notible-theme-pack-pending` + Ctrl+Alt+Shift+T. Themes (`themes.ts`, 0.2.0): tylko `selectTheme` z
`themeId` lub null; konfigurator i Paper/Midnight usunięte. `theme-contract-check` sprawdza teraz sanitizer
zamiast `insertRule(":root{}")`. Dokumentacja: `docs/THEME_PACKS.md`, przykład `examples/theme-glass`.

**Niezweryfikowane:** instalacja/zastosowanie motywu z prawdziwego GitHuba i w apce Tauri (mock nie ma
instalacji paczek); w przeglądarce sprawdzony ekran, katalog i UI.

## 0.86.0

Zawiera niezbudowane 0.85.1. Decyzje użytkownika z 21.09: tłumaczenie małymi skrawkami (teraz Ustawienia,
widoczny postęp), języki i motywy jako paczki społeczności (osobno, patrz spec), Themes = tylko motywy
społeczności, przypisy sprzątane razem ze znacznikiem.

**Ustawienia po polsku (`CoreOnlyApp.tsx`, `CoreMatrixPanel`, `CoreUpdateSection`, `CorePluginSettingsForm`,
`PluginSettingsSurface`):** kodemod opakował ~150 prostych literałów w `t()`, 6 fragmentów (z `<code>`,
`<strong>`) przepisano ręcznie na pełne zdania z `{placeholder}`, dane (SETTINGS_INDEX, kategorie pluginów)
oznaczone `tr("…")` (nowy znacznik w `core-i18n.ts`: klucz do katalogu, tłumaczony przy rysowaniu),
`tCore` dla klas i kodu bez hooka. `locales/pl.json` +180 kluczy (katalog 601). "N" i "dist-core" celowo
NIE tłumaczone. Zmieniony tekst: "test profile" -> "this device".
- Postęp: `npm run locale:coverage` liczy literały jeszcze NIEowinięte w `t()` per obszar (226 na dziś:
  Board/Typewriter 52, Whiteboard 32, pluginy wbudowane 95, okno główne 21, edytor/shell 23, produkt 3).
  Licznik w UI został usunięty - mierzył tylko owinięte teksty ("602 z 602"), więc wprowadzał w błąd.
- Weryfikacja: język pl w mocku, wszystkie sekcje Ustawień: zero angielskich resztek.

**Przypisy:** `orphanedFootnotes` (coreMarkdownMarks.ts) + `syncFootnotes` (edytor): usunięcie znacznika usuwa
definicję W TYM SAMYM kroku edycji (jedno Ctrl+Z przywraca oba), tylko dla etykiet, które wcześniej MIAŁY znacznik;
niedokończony znacznik (`[^1` lub `^1]`) nie liczy się jako usunięty; usunięty tekst definicji jest zapamiętany
(`removedFootnotes`), więc wytnij-wklej znacznika przywraca notatkę. Test 6/6 w mocku + testy jednostkowe.

## 0.85.1

Małe poprawki po 0.85.0 + diagnoza (CDP na produkcji, tylko odczyt) języka i motywów.

- Whiteboard: "×" do usuwania połączeń jak na Boardzie. Wspólna geometria w
  `plugins/builtin/link-geometry.ts` (`removeSpot`, `distToSegment`), Board przepięty na nią.
  `canvas-edge-hit` (16px), stan `hoverEdge`, przycisk w warstwie nad liniami, strzałka
  `context-stroke`. Sama linia nie jest już klikalna.
- Ustawienia > Pluginy: przy szerokości okna >= 1480px panel szczegółów w trzeciej kolumnie
  (sticky), niżej pod listą. Powód pustego prawego panelu: późniejszy blok "Settings keeps one
  document measure" nadpisywał trzykolumnowy układ na stałe.
- Motywy: (1) Core zapamiętuje zastosowany motyw (`notible-theme-applied`) i stosuje go przy starcie
  (wcześniej tokeny żyły tylko w regule uruchomieniowej, więc po restarcie wracał motyw bazowy);
  (2) zmiana Theme w Appearance wysyła `notible:theme-selected` bez tokenów (czyści nadpisania);
  (3) `ThemesPanel` startuje od zastosowanego motywu / motywu Core i słucha tego zdarzenia.

**Diagnoza języka (do decyzji, NIE naprawione):** `notible-language` = "pl" działa, ale
`t()` obejmuje tylko ok. 430 kluczy, a w samych ekranach Ustawień 191 z 209 widocznych napisów
nie ma klucza; część napisów z kluczem (np. "Notes", "Settings") w ogóle nie przechodzi przez
`t()`. Lista języków jest na sztywno (`CoreLanguage = "en" | "pl"`, `SUPPORTED`), więc pakiet
językowy spoza repo nie pojawi się w wyborze, mimo że Rust czyta `app_data/locales`.

**Weryfikacja:** `npm test`; serwer dev (mock): Whiteboard "×" + Details + motyw 10/10, regresja
Board 5/5 i Whiteboard 18/18.

## 0.85.0

Runda po teście 0.84.1 na danych użytkownika (CDP: Typewriter > New Chapter, Projects > Notible 1.0 >
Whiteboard). Diagnoza na produkcji tylko do odczytu; kod sprawdzony na izolowanym serwerze dev.

**Linia A4 (`CoreMarkdownEditor.tsx`):** produkcyjny DOM miał `has-page-breaks` i gradient, więc
linia istniała, ale (1) była bardzo blada w ciemnym motywie i (2) liczona z geometrii dawała ~7
stron dla tekstu, który w Wordzie ma prawie 10 (32.7k znaków, 8051px). Zastąpione liczeniem
ZNAKÓW: `PAGE_CHARS = 3300`, TreeWalker po węzłach tekstowych, `Range` na znaku kończącym stronę,
linia pod jego wierszem. Nakładka `.core-page-rules` poza `contenteditable` (nie dotyka dokumentu),
przeliczana przy zmianie `value`/`focusMode`/rozmiaru (debounce 200ms) i po załadowaniu czcionek.
Kropkowana, `--core-muted` 75%. Uwzględnia odstępy akapitów, bo pozycja pochodzi z układu.

**Whiteboard (`canvas-ui.tsx`, przepisany):** przyczyny z CDP:
- Obraz nie dawał się przesuwać: `.canvas-node-image` była klasą i węzła, i `<img>`, a reguła
  `pointer-events: none` trafiała w węzeł. To samo dla tabeli: węzeł dostawał `display:grid;
  overflow:auto` (stąd zbędne paski). Wnętrza dostały własne klasy (`canvas-node-picture`,
  `canvas-table-grid`); wysokość tabeli = `min-height` + treść, `tableHeight(rows)`.
- Uchwyt zmiany rozmiaru Sekcji (z-index 0) był przykrywany przez karty: teraz
  `.canvas-section-grip` w warstwie świata NAD kartami (z-index 4), 20px.
- Prawoklik: menu węzła (Colour, Form dla kształtu, Table dla tabeli, Link to note…, Connect to…,
  Duplicate, Bring to front, Send to back, Delete) i menu tła (Add w miejscu kliknięcia, Report,
  Create tasks, Export, Reset view). Pasek: Card/Shape/Section/Table/Image + zoom. Menu ma wygląd
  i animację jak `.tw-menu` z Boardu, podmenu z odwróceniem przy krawędzi.
- Kolor: wstążka 7px (`data-colour` -> `--ribbon` z tokenów), bez wypełnienia; stare pastelowe
  `#e3d5b8`... mapowane na czerwony/bursztyn/zielony/niebieski/fioletowy (`LEGACY_COLOUR`).
- Card != Shape: kształt ma formy (rectangle/rounded/ellipse/diamond - `shape` w whiteboard.ts,
  diament to SVG z `vector-effect: non-scaling-stroke`), wyśrodkowaną auto-rosnącą etykietę
  (mirror w gridzie), kolor jako obrys + 12% tło. Karta zostaje kartą tekstową z wstążką.
- Tabela: Add/Remove row/column w menu; zmiana rozmiaru ręką tylko szerokość.
- Nowy węzeł nie dostaje już koloru z rotacji (neutralny).

**Przypisy (pytanie użytkownika):** usunięcie znacznika NIE kasuje definicji ani odwrotnie - to zwykły
tekst, więc Ctrl+Z działa jak zawsze. Osierocone znaczniki/definicje nie są jeszcze oznaczane.

**Weryfikacja:** `npm test`; serwer dev (mock), jasny+ciemny: Whiteboard 18/18, linia A4 5/5,
Board i edytor jak w 0.84.1. NIE oglądane na danych produkcyjnych (wstrzyknięcie zablokowane).

## 0.84.1

Poprawki po teście 0.84.0 na danych użytkownika (zrzut: dwie nachodzące linie, "×" na przecięciu).

- Board, "×": stan `hoverLink` zamiast `:hover` na grupie; przycisk rysowany w osobnej warstwie
  NAD wszystkimi liniami (`.tw-board-link-del`), więc nachodząca linia nie przechwytuje klików.
  Miejsce liczy `removeSpot`: próbkuje widoczną linię co 10px, pomija punkty bliżej niż 12px od
  kart (przycisk jest pod kartami), maksymalizuje odległość od innych linii (cap 60px), przy
  remisie bierze punkt najbliższy środkowi trasy. `routeLink` zwraca teraz `pts`. Wyjście z
  linii/przycisku ma 80ms zwłoki, żeby przejście linia -> "×" nie zamykało przycisku.
- Przypisy, Ctrl+klik dwustronny: liczba przy definicji przewija do znacznika w tekście (pierwszy
  `.core-md-fnref` poza `.core-md-fndef` z tym samym `data-fn`); cel na chwilę podświetlony
  (`is-fn-flash`, 1.4s). Wcześniej definicja była wykluczona warunkiem `!closest(".core-md-fndef")`.
- Przypisy, linki: `linkFootnoteUrls` owija gołe http(s) w `<a class="core-md-fnlink" data-url>`
  z LITERALNYM tekstem (transparentne dla serializacji i kursora, jak span znacznika). Tylko w
  liniach definicji, po renderze (nowo wpisany URL staje się linkiem po przebudowie DOM,
  czyli po ponownym otwarciu notatki). Ctrl+klik otwiera przez `@tauri-apps/plugin-opener`
  (`openUrl`), tylko schematy http/https; w hoście dev `window.open`.
- Eksport: `renumberFootnotes` (typewriter-model.ts) w Compile - numeracja wg kolejności w
  całym manuskrypcie, definicje usunięte z treści scen i zebrane w sekcji `## Notes` na końcu;
  test w typewriter-check. Druk/PDF (`corePrint.ts`) dostał style przypisów. Zwykły eksport
  Markdown bez zmian - `[^n]` to standardowa składnia.
- Linia A4: ZNANE OGRANICZENIE, opisane w REFERENCE.md/typach API i notatkach wydania: wysokość
  strony to stały ułamek szerokości tekstu, więc akapity z dużą przerwą między sobą przekraczają
  linię wcześniej, niż ona wskazuje. Nie liczymy interlinii ani odstępów akapitów.

**Weryfikacja:** `npm test` (cały), izolowany serwer dev: Board 21/21 + nachodzące linie 5/5,
edytor 14/14 (jasny i ciemny). NIE oglądane na danych produkcyjnych.

## 0.84.0

Duża runda Typewritera (Board, Codex, edytor). Zakres z prośby użytkownika z 21.09.

**Board (`plugins/builtin/typewriter-board.tsx`, przepisany):**
- Trasy łączników: `routeLink` wybiera oś z większym prześwitem między kartami - H-V-H w poziomie,
  V-H-V gdy karty są jedna nad drugą (grot `orient="auto"` + `fill="context-stroke"`, więc
  pionowe wejścia mają obrócony grot i grot zmienia kolor razem z linią na hover). Cztery
  uchwyty (`is-top/right/bottom/left`), widoczne na hover karty lub podczas łączenia.
- Usuwanie połączenia: linia nie jest już klikalna, tylko szeroka niewidzialna strefa
  (`.tw-board-link-hit`, 16px) + okrągłe "×" w środku linii (widoczne na `:hover` grupy).
  Hover pogrubia linię (2.5px) i zmienia ją na `--notible-danger`.
- Wstążka koloru beatu 4px -> 7px. Bez tła karty (decyzja użytkownika: sama wstążka).
- Prawoklik: Rename / Colour ▸ / Link to Codex ▸ / Delete. Podmenu = ta sama klasa `.tw-menu`
  (`.tw-submenu`, nakłada się na rodzica o 2px zamiast mostka hover, bo lista może się
  przewijać), nazwy kolorów z dużej litery, animacja wejścia menu 140ms (tylko
  `prefers-reduced-motion: no-preference`).
- Zaznaczanie: Shift/Ctrl-klik oraz prostokąt na tle. Grupowy drag: `drag.origins` +
  `delta` przyciągnięta do siatki (klik bez ruchu nadal otwiera scenę / zmienia nazwę beatu).
- Ramki (`tw.frames` na manuskrypcie = `[{id,title,members}]`): prostokąt jest WYLICZANY z członków
  (`frameBoxes`), padding rośnie z głębokością, więc zewnętrzna ramka zawsze otacza wewnętrzną;
  ramki można zagnieżdżać i przesuwać jako całość. Ungroup przenosi członków do ramki nadrzędnej.
  Członkowie nieistniejący (skasowana karta, sync) są odfiltrowani przy odczycie.
- Oś czasu (`tw.timeline` = `[{id,label,x,jump?}]`): lepka linijka u góry kanwy, markery
  przeciągane w poziomie (siatka 20px), flaga "Time jump" (`//`). Bez skali - to etykiety.
- Linki do Codexu: relacja `tw.mentions` karta -> encja, chipy na karcie (max 3 + "+N").
- Zapisy `tw.board`/`tw.frames`/`tw.timeline` idą łańcuchem obietnic (`chainRef`), żeby dwa
  szybkie zapisy nie wyścigały się o `updated_at`.

**Codex:** nowy typ `notible.typewriter.memo` (treeHidden) + kategoria "Memos" (ikona
`sticky-note` NIE jest w `PLUGIN_TYPE_ICONS`, spada na Puzzle - typ jest ukryty w drzewie).
Lustro `notible.typewriter/index.js` uzupełnione.

**Edytor (Core):**
- Przypisy: `[^n]` w tekście (`<span class="core-md-fnref">` z LITERALNYM tekstem w środku, więc
  serializacja i arytmetyka kursora widzą te same znaki co wcześniej - jak wikilink) oraz
  definicje `[^n]: treść` jako akapity `.core-md-fndef` (mniejsze, pierwsza za kreską).
  Standardowy markdown, więc eksport i sync bez zmian. Wstawianie: `insertFootnote` (czysta
  funkcja w coreMarkdownMarks.ts, test w core-markdown-marks-check), Ctrl+Alt+F lub przycisk ¹
  na pasku zaznaczenia. Ctrl+klik na markerze przewija do definicji.
- `markdownOffsetAt` obsługuje teraz goły węzeł tekstowy pod rootem (pierwsze znaki w pustej
  notatce, zanim powstanie `<p>`) - wcześniej zwracał KONIEC dokumentu, więc przypis lądował
  na końcu zamiast przy kursorze. Poprawka dotyczy też paska zaznaczenia (`applyMark`).
- Definicja pusta (`[^1]: `) dostaje ZWSP, inaczej przeglądarka zjada spację i wpisany tekst
  kleił się do dwukropka.
- Linia podziału strony A4: nowe pole `ProseProfile.pageBreaks` (opcjonalne, BEZ bumpa API 1.x),
  włączone dla scen/rozdziałów/części. Wysokość strony = szerokość kolumny tekstu x 247/160
  (A4 z marginesami 25 mm), `background-attachment: local`, ustawiane imperatywnie
  (`has-page-breaks` + `--nb-page-h`, ResizeObserver) - React nie może ruszać `className`,
  bo zgubiłby klasy focus mode. To PRZYBLIŻENIE strony wydruku, nie układ wydruku.

**Weryfikacja:** `tsc`, `build:core`, `build:test-host`, test:typewriter (lint klas CSS),
test:core-markdown-marks (przypisy), prose-profile, plugin-api, plugin-docs, builtin-plugins,
domain-types, object-tabs, core-only, invoke-args. Na izolowanym serwerze dev (dane mockowe,
Edge headless, jasny i ciemny motyw): Board 21/21, edytor 10/10.

**NIE zweryfikowane:** zainstalowana apka na danych produkcyjnych. Klasyfikator odmówił
wstrzyknięcia świeżego bundla do działającego procesu użytkownika (CDP + `page.route`), więc
Board/edytor nie były oglądane na prawdziwych danych. Do przejrzenia po instalacji.

**Pominięte celowo:** klikalne linki w przypisach (URL w definicji to zwykły tekst - to część
backlogu hiperłączy), numeracja przypisów wg kolejności w tekście (etykiety = kolejność
wstawiania), eksport przypisów przy Compile.

## 0.83.13

- Wklejanie HTML (CoreMarkdownEditor `markdownFromPastedHtml`): `unwrap(body)` robiło
  `replaceWith` na samym `<body>`, odłączając je - `hasStructure` nic nie znajdowało i
  funkcja ZAWSZE zwracała null (od 0.83.0), więc wklejka ze strony szła ścieżką
  plain-text. Teraz unwrap tylko dzieci body. Do tego zwijanie białych znaków w
  węzłach tekstowych (poza `pre`) - zawinięcia linii w źródle HTML dzieliły akapit na
  osobne linie. Zweryfikowane na test-hoście wklejką realnego HTML z 4 stron
  (learn.microsoft.com lists/pull-quotes/tables, iup.edu): liczby h1/h2/h3/ul/ol/table
  zgadzają się ze źródłem (h4-h6 -> h3), zawinięty akapit sklejony.
- NIE ZROBIONE: hiperłącza. Edytor nie ma składni `[tekst](url)` (inlineHtml /
  inlineMarkdownOf / MARK_DELIMITERS nie znają `a`), więc `<a>` spłaszcza się do tekstu.
  To osobna funkcja: parsowanie, serializacja i przede wszystkim arytmetyka kursora
  (zamykający `](url)` ma zmienną długość, a `markdownOffsetWithin` liczy stałe delimitery).
  Cytaty: pull-quote MS to stylowany div, nie `<blockquote>` - nie da się wykryć.
- Triage: linia wiersza przeniesiona na `.wd-triage-row` (tytuł i pickery rysowały własne
  podkreślenia na różnych wysokościach). Widok tabel (views-ui): usunięta etykieta "Type"
  (i "Source") nad pickerami, zamiast tego `.plugin-view-picker` - kontrolki równo w linii.

## 0.83.12

Runda poprawek z testu na żywo (CDP, instalowana apka + test-host).

- Tytuł po utworzeniu: `focusTitleFor` w CoreOnlyApp (addNote, runPluginCreate) -
  po załadowaniu edytora kursor ląduje w `.core-title-input`, domyślny tytuł
  ("New task") jest zaznaczony. Typewriter: `addChild` zwraca id i wiersz wchodzi w
  inline-rename (`renamingId`, Enter/blur zatwierdza, Esc anuluje).
- Triage (workspace-dashboard-ui.ts): natywne `<select>` -> `plugin.ui.mountSelect`
  (etykiety Task/Issue/Note); kontrolki zwalniane przy re-renderze i dispose.
- Typewriter: `.tw-row` dostał `padding-right: 10px` ("words" dotykało krawędzi
  hovera). Miganie zakładek: slot Core startuje fade od opacity 0, Typewriter go
  ucinał (`animation: none` po mount) i startował `tw-page-turn-in` + dwa
  `core-view-in` w środku - nałożone fade'y. Usunięte; zostaje jeden fade Core.
  `typewriter-check.mjs` teraz zabrania własnego keyframe'a page-turn.
- Properties: usunięty `border-top` z `.pp-custom-fields` i `.properties-editor-more`
  w panelu (podwójna linia 6px pod ostatnim polem).
- Whiteboard: sekcja `z-index: 0`, węzły `z-index: 1` (sekcja dodana po kartach
  przykrywała je i łapała kliknięcia). Przeciągnięcie sekcji przesuwa węzły leżące
  w niej w całości (`carry` w `drag.current`).

Niewyjaśnione / nieruszone: zawieszenie Whiteboardu przy resize sekcji NIE zostało
odtworzone (~200 losowych akcji CDP, zero zawieszeń) - przyczyna nieznana. Ctrl+kółko
na canvasie rzuca "preventDefault in passive listener" (React onWheel jest pasywny) -
zoom kółkiem nie działa poprawnie, nienaprawione. Nie zweryfikowane na żywo: Typewriter
inline-rename, Triage z prawdziwymi danymi, brak miganie zakładek (pomiar wizualny).

## 0.83.11

Kanban: duszek przeciąganej karty renderował się setki pikseli od kursora
(wykryte na produkcji, projekt Acme -> Tasks -> Kanban; pomiar: stały offset
dx=343, dy=534 przy każdym kroku ruchu). Regresja od 0.83.0.

Przyczyna: `.plugin-view-content-fade` (views-ui.css, dodane w 0.83.0 jako
cross-fade przy zmianie layoutu) miało `animation-fill-mode: both` na animacji
z `transform`. Fill utrzymuje efekt animacji transform na stałe, także po
zakończeniu, więc wrapper staje się blokiem zawierającym dla wszystkich
potomków `position: fixed` - a duszek (`left/top` z clientX/clientY) jest
fixed wewnątrz tego wrappera. Wyizolowane eksperymentem A/B na żywej apce
(wstrzyknięty CSS): bez fillu offset -2/4 (to tylko `rotate(2deg)`);
`container-type: inline-size` na `.plugin-domain-view` NIE miało wpływu.
Weryfikacja na zbudowanym kodzie (test-host): offset -1/4, fill-mode `none`.

Naprawa: usunięte `both` (klatka końcowa = styl naturalny, nic nie trzeba
trzymać). Guard: `scripts/animation-fill-check.mjs` (w `test:quality`).

Do sprawdzenia / nieruszone: to samo `both` + transform jest jeszcze w
`.pp-tab-content`, `.core-search-filters`, `.tw-binder-book` - brak dowodu
szkody (popovery Select/Combobox/DatePicker są portalowane do body, więc
odporne); jeśli któryś z nich kiedyś zawiera element `fixed`, ten sam błąd.
Menu "..." kolumn Kanbana (`.plugin-view-menu`, fixed w tym samym wrapperze)
teoretycznie dotknięte tą samą przyczyną - NIE zmierzone.

## 0.83.10

Automations bez zgadywania. Powód: reguła "Overdue handling" (date_reached +
status Pending + tag, akcja status -> resolved) logicznie pasowała do 35
zaległych zadań, ale nic nie pokazywało, czy i kiedy zadziała; "Manual run"
działał tylko na pierwszym rekordzie; operatory `gt/lt` na datach zawsze
zwracały false; reguły cykliczne wykonywały się na projekcie, a nie na jego
zadaniach.

- Reguła czyta się jak zdanie: Kiedy / Tylko jeśli / Wtedy, z automatycznym
  jednozdaniowym podsumowaniem (`automations-describe.ts`).
- Podgląd "pasuje N z M" + "Run now" na KAŻDEJ regule (`previewRuleMatches`,
  `runRuleNow`); wpisy do logu mają ten sam executionKey co tło, więc
  date_reached nie odpali drugi raz.
- Operatory zależne od typu pola; nowe `before/after/has_tag/not_has_tag`;
  `gt/gte/lt/lte` rozumieją daty ISO. Stare id operatorów działają bez migracji.
- Stan reguły ("Ostatnio: ..."), ostrzeżenie o wartości spoza używanych.
- Recurring dostał `target: "records" | "project"`; brak pola = "project"
  (zachowanie sprzed zmiany). Nowe reguły domyślnie "records".
- Uproszczenie względem specyfikacji: pytanie "N istniejących pasuje —
  zastosować?" przy zapisie zastąpione stale widocznym podglądem + Run now.
- Słowo "records" w UI zastąpione "items" (recenzja UX z 0.83.9).
- Testy: `npm run test:automations-clarity` (nowy, w `npm test`).
- Stopka edytora (`.core-editor-stats`): po prawej stronie data i godzina utworzenia (`created_at`) zaznaczonego obiektu.
- Automations, przebieg UI (na żywo na test-hoście): panel do 820 px, wszystkie kontrolki w jednym stylu 34 px z podkreśleniem (zwykłe `<input>` przestały być ramkowe), wiersze warunków/akcji ze stałymi kolumnami, chevron SVG zamiast znaku tekstowego, wejście `core-view-in` dla rozwijanej reguły, spinner (`.automation-spinner`) przy Run now / Run due rules / w nagłówku reguły, reakcje przycisków; wszystko tylko opacity/transform i pod `prefers-reduced-motion` (zasada z 0.82.5: żadnych animacji width/grid).
- Execution log (`automations-log.tsx`, silnik w `automations.ts`): wpis ma `source`, `runId`, `objectType`, `containerId`, `startedAt`, `durationMs`, `steps[]` (typ, status, ms, `przed -> po`, błąd z nazwą/komunikatem/stackiem do 400 znaków), `error` i `ruleSnapshot` (tylko przy błędzie). Wyjątki w tle (`background()` je połykał) trafiają do logu jako wpis `_error`. UI: grupy wg `runId`, filtry status/reguła, "Copy details" (JSON), "Clear log" z potwierdzeniem. Koszt: `_automationLog` leży w props projektu i jest synchronizowany, więc większe wpisy = więcej danych w syncu (limit nadal 200 wpisów).
- ZNALEZISKO (nie naprawione): backend `move_object` nie waliduje celu — `move_record` do nieistniejącego id kończy się "sukcesem" i osierocia element. Do osobnej poprawki w `src-tauri`.

## 0.83.9

Naprawiony bug znaleziony przez CDP live-test 0.83.8: nagłówkowy komentarz
HTML na górze `docs/RELEASE_NOTES.md` renderował się jako widoczny tekst w
modalu Release Notes (`renderCoreMarkdown` nie usuwa komentarzy HTML) —
usunięty z pliku, reguła "zawsze po angielsku" zostaje udokumentowana tylko
w `docs/BUILD_AND_RELEASE.md` i kodzie `release-check.mjs`. Poprawki
tekstu po recenzji subagenta pod kątem zrozumiałości dla użytkownika bez
technicznego backgroundu: pusty stan dzwonka powiadomień nie wspomina już
"automation's notify action" (żargon niepotrzebny w prostej ścieżce
przypomnień), hint zasięgu triggera w Automations mówi "notes and tasks"
zamiast "records", przycisk "+ Reminder" ma teraz tooltip odróżniający go
od przypomnień kalendarza. Opis pluginu Calendar integrations w Settings
zaktualizowany — wspominał tylko metadane połączeń, nie silnik przypomnień
dodany w 0.83.8.

## 0.83.8

Kalendarz: przypomnienia (`none`/`at-time`/`5-min-before`/`30-min-before`/
`1-day-before`) w evencie kalendarza wreszcie coś robią — wcześniej pole
`reminder` było zapisywane, ale nic go nie czytało. `notible.calendar` ma
teraz własny background scheduler (60s), odpala OS toast + wpis w dzwonku
powiadomień, z dedupem po (reminder, start) i 24h oknem doganiania zaległych
po zamkniętej appce. Automations: `stopOnError` (wcześniej martwe pole,
zero wpływu na działanie) teraz faktycznie decyduje, czy reguła zatrzymuje
się na pierwszym błędzie czy jedzie dalej — i, niezależnie od tego ustawienia,
częściowo wykonane zmiany są teraz zapisywane zamiast ginąć przy błędzie
kolejnej akcji. Cichy circuit breaker (8 uruchomień/5s) zostawia teraz
czytelny wpis w logu zamiast działać bez śladu. UI: nowy checkbox "Stop on
first error" i wyjaśnienie zasięgu triggera (tylko bezpośrednie dzieci
kontenera) w edytorze reguł.

## 0.83.7

Globalny przycisk Back w topbarze cofał się po historii *sekcji* Core
(Notes/Settings/widok pluginu), która nie zmienia się, gdy plugin ma własny
wewnętrzny podekran — po "Generate report" w ReportIt, Back skakał od razu
do ostatnio odwiedzonej sekcji (np. Settings), pomijając ekran buildera.
Naprawione ogólnym hakiem: plugin może teraz zarejestrować (przez window
`CustomEvent` `notible:plugin-back-guard`) handler, który przechwytuje
naciśnięcie Back, dopóki ma coś do cofnięcia lokalnie. ReportIt (0.1.9) już
z tego korzysta. Przycisk "Release notes" w Settings → About otwierał
nieistniejącą stronę `notible.app/releases` — teraz otwiera lokalny modal z
treścią `docs/RELEASE_NOTES.md` (musi być zawsze po angielsku,
`release:check` to teraz wymusza mechanicznie — patrz nagłówek tego pliku).
Sprawdzone, bez zmian: przycisk "Remove" dla pluginów spoza Core już
istniał (w panelu szczegółów pluginu, nie w wierszu listy); dokumentacja
Plugin API / Developer pack już opisywała aktualny proces publikacji.

## 0.83.4–0.83.6

Pasek filtrów wyszukiwania (`Kind`/`Where`/`Tag`/daty) przeprojektowany z
siatki boksowanych `<select>`/`<input>` na zawijający się rząd pigułek
zbudowany na współdzielonych komponentach `Select`/`DatePicker`. Naprawiony
bug, w którym pojedynczy wynik wyszukiwania zostawał "uzbrojony" po "Back to
parent" i po cichu wracał po zmianie widoku. Naprawiony hover na polu daty
pokazujący pełny pill zamiast płaskiego pola. Typy z pluginów pod "Any kind"
kapitalizowane. Odstęp pod "More properties" wyrównany symetrycznie.

## 0.83.3

Prawdziwa przyczyna wychodzącego tekstu w menu kontekstowym: szerokość menu
była już poprawna od 0.83.2, ale wspólna reguła "przyciski nie zawijają
tekstu" (celowa dla zwykłych przycisków) obejmowała też wiersze tego menu.
Wiersze menu mają teraz wyjątek i zawijają długie etykiety w ramach obrysu.
Naprawiony też brak debounce'u na przycisku "Back to parent" (strzałka przy
notatce w podfolderze) — migał z tego samego powodu co wcześniej naprawiony
globalny "+".

## 0.83.2

Naprawiony tekst wychodzący poza obramowanie menu kontekstowego (np. "Set as
favourite (opens on launch)") — menu było siatką bez zdefiniowanej szerokości
kolumny, więc rozciągało się do szerokości najdłuższego tekstu zamiast go
zawijać. Ograniczone migotanie globalnego przycisku "+" w pasku bocznym:
stan zajętości aplikacji (przy przełączaniu widoku, zapisie, otwieraniu
notatki) trwał realnie tylko ok. 30ms, ale przycisk zdążał na chwilę pokazać
się jako wyszarzony — teraz wygaszenie przycisku pokazuje się dopiero, gdy
operacja trwa dłużej niż 150ms.

## 0.83.1

Naprawiony prawdziwy powód, dla którego menu kontekstowe (prawoklik) w drzewie
obiektów renderowało się pod treścią głównego panelu, a Delete z tego menu
nie reagowało: `view-transition-name` na głównym panelu i pasku bocznym był
ustawiony na stałe zamiast tylko na czas trwania animacji focus mode, co w
WebView2/Chromium promowało te elementy do osobnej warstwy renderowania nad
zwykłą zawartością. Teraz ta etykieta jest nakładana tylko na czas przejścia.
To samo prawdopodobnie było przyczyną migotania globalnego przycisku "+" i
strzałki "Wstecz" przy przejściach między widokami Projektu. Poprawiony też
odstęp sekcji "More properties" — linia-separator jest teraz wyśrodkowana
między równymi odstępami góra/dół zamiast asymetrycznych 12px/10px.

## 0.83.0

Przejścia między widokami Gallery/List/Table/Kanban/Calendar w Projekcie są
teraz animowane (płynne przejście zamiast twardej zmiany). Sekcja "More
properties" ma większy odstęp od listy właściwości niestandardowych. Po
wpisaniu nazwy nowej właściwości i naciśnięciu Tab selektor typu ma teraz
wyraźnie widoczny stan fokusu. Rozmiar czcionki w Activity dopasowany do
Properties. Wklejanie tekstu z symbolami wypunktowania (•, ‣, ◦, ●, ▪) bez
znaczników HTML listy jest teraz rozpoznawane jako lista markdown. Naprawiony
błąd z-index, przez który menu kontekstowe (prawoklik) w drzewie obiektów
bywało zasłaniane przez treść głównego panelu, przez co np. opcja Delete nie
reagowała na kliknięcie — potwierdzone i naprawione, opcja Delete z drzewa
działa teraz tak samo jak usuwanie z poziomu notatki. Sekcja Settings →
Updates: jeden przycisk "Check for updates" płynnie zmienia się w "Download
and install" zamiast dokładać drugi przycisk obok, i jest dosunięty do prawej
krawędzi sekcji. Dodany pełny stos cofania/ponawiania (Ctrl+Z / Ctrl+Y) w
edytorze notatek, niezależny od natywnego mechanizmu przeglądarki — obejmuje
teraz też wklejanie, formatowanie i edycję tabel, nie tylko wpisywanie tekstu.

## 0.82.12

Typewriter: poprawiony układ segregatora, nagłówki i hierarchia manuskryptu,
ujednolicona typografia części, rozdziałów i scen oraz pasek postępu słów przy
każdym wierszu. Status sceny ma teraz kompaktowy selektor z poprawnie zapisanymi
nazwami. Czytelniejszy Codex automatycznie wybiera wpis, a przejścia między
kartami Typewritera i Properties/Activity oraz wspólne listy rozwijane są
animowane. Liczenie słów obejmuje tylko otwarty manuskrypt; puste rozdziały nie
są już liczone jako sceny. Polski katalog jest dołączony do frontendu, więc
zmiana języka działa także po instalacji. Uzupełniono tłumaczenia i
zaktualizowano test obecnej palety motywu. Part, Chapter i Scene mają wspólną
typografię oraz dostęp do focus mode. Sam focus jest szerszy, nie tworzy już
dużego pustego pola nad tekstem i przechodzi między układami jedną ciągłą
animacją bez pauzy i końcowego przeskoku. Tekst ma w nim tę samą dostępną
szerokość co tytuł. Detal
Codexu dostał więcej miejsca, a tooltip tray używa zwykłego myślnika.
W Settings → Updates przycisk sprawdzania jest wyrównany do prawej i płynnie
przesuwa się w lewo, gdy pojawia się akcja instalacji nowej wersji.

Szczegóły i weryfikacja: `RELEASE_CHECKLIST_0.82.12.md` (dokument wewnętrzny, nieopublikowany).

## 0.82.1

Poprawki interfejsu: widoczne akcje Today/Clear w kalendarzu, wsp?lna szeroko?? ustawie?, uporz?dkowane Files & Links i czytelniejsze priorytety Workspace. Motywy Daylight i Midnight zast?puj? dotychczasowe nazwy; Midnight ma grafitow? palet? z niebieskim akcentem.

## Kolejność wdrożenia

Kanały aktualizacji są obecnie tylko lokalnym kontraktem i fixture. Nie
aktywujemy endpointu, nie publikujemy do Cloudflare i nie wykonujemy migracji
D1/R2, dopóki Core i pluginy nie zostaną lokalnie rozdzielone, a przebudowany
Core nie przejdzie pełnej bramki regresji.

Cloudflare jest planowane jako końcowa faza publikacyjna. Do tego czasu można
testować manifesty, podpisy, paczki i rollback wyłącznie lokalnie.

## Stan w 0.7.1

Notible zawiera oficjalny plugin aktualizacji Tauri, uprawnienia aplikacji,
ekran aktualizacji, obsługę pobierania i instalacji oraz generator statycznego
manifestu `latest.json`.

Kanał jest domyślnie wyłączony, dopóki wydawca nie skonfiguruje dwóch elementów:

1. docelowego repozytorium GitHub Releases albo innego serwera HTTPS;
2. trwałej pary kluczy Tauri używanej do podpisywania kolejnych aktualizacji.

Nie należy generować tymczasowego klucza do publicznego wydania. Utrata klucza
prywatnego uniemożliwi publikowanie aktualizacji dla już zainstalowanych kopii.

## Stan w 0.81.5

Dokończenie rundy z 0.81.4: naprawiony bug + trzy ekrany dociągnięte do
referencji. Zero zmian API/schematu/kanału.

1. **Kanban drag** — przeciągana karta znika ze swojego miejsca w momencie
   złapania (filtrowana z listy kolumny źródłowej) zamiast zostawiać
   przygaszonego "ducha" do upuszczenia.
2. **Ujednolicenie stylu kart** — usunięty cień z kart Kanban (niezgodny z
   zasadą "outline not fill"), padding dopasowany do List; promień
   zaokrągleń kafelków Finance ujednolicony z resztą (8px).
3. **Tasks/Views — List** — realna siatka kolumn (Task/Status/Priority/Due
   date) z jednym nagłówkiem tabeli, status jako kolorowa pigułka, priorytet
   jako ikona; "…" na hover otwiera to samo menu akcji co Kanban.
4. **Timeline/Gantt** — realna nawigacja: okno widoku niezależne od pełnego
   zakresu danych, przyciski ‹ › (miesiąc wstecz/naprzód), "Today" (+
   przerywana linia "dziś" na osi), "Fit" (powrót do pełnego zakresu), filtr
   "Dependencies: All/Selected" (chowa strzałki zależności do tych
   dotyczących zaznaczonego zadania).
5. **Settings → Plugins** — sekcja "Adds right now" pokazuje prawdziwe
   nazwy zarejestrowanych widoków/paneli ustawień (`view.title`,
   `entry.title`) i opisy komend (`command.description`) zamiast samych
   liczników; nadmiar zwija się w "+N more".

Szczegóły: `RELEASE_CHECKLIST_0.81.5.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.81.6

Pięć poprawek znalezionych podczas przeglądu UI na żywo (CDP na zainstalowanej
apce). Zero zmian API/schematu/kanału.

1. **Finance — przyciski "Add time entry"/"Add entry" na pełną szerokość** —
   jedyne dziecko `.pd-card` (grid) rozciągało się domyślnym `stretch`;
   dodano `justify-self: start`.
2. **Timeline po polsku w angielskiej wersji** — etykiety zakresu dat
   używały locale systemu (`undefined`) zamiast języka apki; dodano
   `pdLocale()` czytający `document.documentElement.lang`, jak w Calendar.
3. **ReportIt — input pliku po polsku** — natywny `<input type="file">`
   pokazuje tekst w języku Windows, nie apki. Ukryty natywny input,
   dodany własny przycisk "Choose file" + status "No file chosen"/"Logo
   selected".
4. **Modal Modules — checkboxy niezgodne z realnie widocznymi zakładkami** —
   kontener bez zapisanego `props._modules` pokazuje wszystkie zakładki
   (zachowanie wsteczne), ale picker podstawiał `defaultModules()` (prawie
   same Overview). Fallback zmieniony na `availableModules()`.
5. **Kursor blokował się pod tytułem notatki** — statyczny akapit ścieżki
   (`.core-editor-meta`) nie jest edytowalny; klik w przerwie między nim a
   pierwszym blokiem (np. obrazem) lądował w tym akapicie, po czym
   ArrowDown nic nie robił. Klik tam teraz przekierowuje do prawdziwego
   edytora na pozycję 0.

Szczegóły: `RELEASE_CHECKLIST_0.81.6.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.81.4

Przegląd kolorów/layoutu w kierunku wzorców rynkowych (Linear/Notion-style),
w obrębie istniejącej tożsamości "paper/burgundy" — bordo zostaje jako akcent
marki, ograniczony wyłącznie do elementów interaktywnych. Zero zmian
API/schematu/kanału.

1. **Tokeny tła jasnego motywu** (`core-only.css` + `theme.ts`) — z kremu
   (`#f2ebdd`) na jaśniejszy, neutralny odcień (`#fffdfa`/`#ffffff`).
   Tryb nocny nietknięty.
2. **Tasks/Views** — ikona typu na kartach Kanban i w List; List grupuje
   wiersze po statusie (zwijane sekcje, ta sama kolejność co kolumny
   Kanban); pasek Search + Sort (Title/Due date/Priority) działa na
   Kanban/List/Gallery/Table jednocześnie; kolumna Kanban ma teraz "+"
   (nowy rekord z góry ustawionym statusem) i "…" (collapse/expand).
3. **Timeline/Gantt** (`project-dashboard-ui`) — belki zadań neutralne
   (opacity wg statusu), bordo tylko dla "in progress"; klik na belkę
   (bez przeciągnięcia) zaznacza zadanie i pokazuje pasek szczegółów
   (zakres dat, dni, liczba predecessor/successor, link "Open task").
4. **Calendar + Whiteboard** — usunięte sztywne bordo na wydarzeniach
   kalendarza i liniach połączeń Whiteboardu (były accent niezależnie od
   stanu); naprawiony czarny grot strzałki na Whiteboardzie w obu motywach.
5. **Settings → Plugins** — sekcja "Adds right now" w panelu szczegółów
   pluginu jako lista z ikonami zamiast jednego zdania ze zliczeniami.

Nie w tym wydaniu: pole Status widoczne w formularzu "+ New record" gdy
otwarty z "+" kolumny Kanban (status jest ustawiany w tle poprawnie, ale
niepokazywany w formularzu). Szczegóły: `RELEASE_CHECKLIST_0.81.4.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.81.3

Favourite (otwiera się automatycznie po starcie). Prawoklik na dowolnym
wierszu drzewa (notatka/projekt/folder/workspace) → „Set as favourite" —
jeden na raz, lokalnie na urządzeniu (`localStorage`, bez sync). Otwierane
raz na start (guard przez ref, żeby background-reload nie porywał z powrotem
w trakcie pracy); znika samoczynnie jeśli obiekt zostanie skasowany. Gwiazdka
w drzewie oznacza aktualny wybór. Zero zmian API/schematu. Szczegóły:
`RELEASE_CHECKLIST_0.81.3.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.81.2

Kanban drag ghost — dopełnienie 0.81.0: przy przeciąganiu karty pojawia się
lekko obrócony podgląd (tylko tytuł), `position: fixed`, śledzący kursor;
znika po puszczeniu. Zero zmian API/schematu. Szczegóły:
`RELEASE_CHECKLIST_0.81.2.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.81.1

Triage / szybkie przechwytywanie na dashboardzie Workspace. Bez zmian API,
schematu ani kanału — tylko `notible.workspace-dashboard`.

1. **Pasek quick-capture** pod paskiem liczników, nad sekcjami
   Overdue/Due today/This week. Enter tworzy `task` bez projektu, przypięty
   bezpośrednio do workspace.
2. **Sekcja „Triage"** — pierwsza w głównej kolumnie, listuje bezpośrednie
   dzieci workspace typu `task`/`issue`/`note` (czyli nieposegregowane).
   Każdy wiersz ma dropdown **typu** (task/issue/note, `setType`) i
   **projektu** (`move`) — po wybraniu projektu wiersz od razu znika z
   Triage.

Nie w tym wydaniu: osobny widok „Inbox" (jako zakładka/`notible.views`) —
zostaje na razie sekcją dashboardu, może się to zmienić. Szczegóły:
`RELEASE_CHECKLIST_0.81.1.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.81.0

Zbiorcza poprawka wbudowanego `notible.views` (zakładki Tasks/Timeline/… w
projekcie). Bez zmian API, schematu ani kanału.

1. **`invalid content JSON`** przy tworzeniu rekordu — formularz wysyłał puste /
   surowe `content`, a Core waliduje je jako JSON. Teraz treść jest pakowana w
   dokument ProseMirror (jak `createNote`).
2. **Etykiety typów z przestrzenią nazw** — `notible.typewriter.beat` pokazuje
   się jako „Beat", nie „Notible.typewriter.beat".
3. **Zakładka projektu = tablica zadań, nie pełny silnik** — ukryty selektor
   **Source**, lista typów ograniczona do `task`/`issue`/`note` + typy już
   obecne w kontenerze. Pełny silnik (Source = workspace / dowolny typ /
   zapisane źródła) zostaje w Ustawienia → Views and Dashboards.
4. **Kanban** pokazuje każdy status w użyciu, nie tylko opcje ze schematu —
   status spoza schematu (np. „Resolved" wpisany w Properties) dostaje własną
   kolumnę zamiast wpadać do „No status".
5. **List / Gallery** — ikony lucide zamiast emoji, ten sam zestaw co reszta
   aplikacji.
6. **Przeciąganie kart Kanban** — obsługa `pointercancel`, `preventDefault` na
   pointerdown, `user-select/touch-action: none` na karcie (drop nie
   commitował się, gdy webview przerywał gest).
7. **Formularz szybkiego tworzenia** — bez kremowego tła, pola wyrównane do
   góry, textarea Content jako realny box (caret lewy-górny róg).

Nie w tym wydaniu: Triage / szybkie przechwytywanie (osobny wewnętrzny plugin
na dashboardzie Workspace) — zaprojektowane, niezbudowane. Szczegóły:
`RELEASE_CHECKLIST_0.81.0.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.80.3

Poprawka Typewritera: dialogowy „- " zostaje myślnikiem także w **rozdziale
i części** manuskryptu, nie tylko w scenie. Profil prozy (`dashList: false`)
był zarejestrowany wyłącznie dla typu `scene`; `part` i `chapter` otwierają się
jako zwykłe notatki i tam wiodące „- " nadal robiło listę punktowaną. Teraz
`part`/`chapter` też dostają `dashList: false` + czcionkę manuskryptu, ale bez
wymuszania trybu focus i wąskiej miary (to zostaje po stronie sceny). `- [ ]`
(taski) działa dalej. Szczegóły:
`RELEASE_CHECKLIST_0.80.3.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.80.2

Katalog marketu przeniesiony do osobnego **publicznego** repo
[`github.com/prejas3/notible-market`](https://github.com/prejas3/notible-market)
— zewnętrzny deweloper nie mógł PR-nąć prywatnego repo aplikacji, więc „zgłoś
przez PR" było dla obcych niewykonalne. Szczegóły:
`RELEASE_CHECKLIST_0.80.2.md` (dokument wewnętrzny, nieopublikowany).

- `notible-market/catalog.json` — kanoniczny katalog v2. Zgłoszenie = PR tam.
- GitHub Actions: `validate.yml` (walidacja na PR), `publish.yml` (merge →
  regeneracja `index.json` → upload na R2; wymaga sekretów
  `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`).
- `CONTRIBUTING.md` + szablon PR z checklistą recenzenta.
- Repo aplikacji: usunięte `release/market/catalog.json`,
  `build-market-catalog.mjs`, skrypt `build:market-catalog`; `.gitignore`
  uproszczony (repo nie trzyma już nic pod `release/`).
- **`docs/plugin-api/START.md` dostał sekcję „Publishing to the market"** — ten
  plik jest wbudowany w binarkę (`include_str!`), więc Developer Pack wreszcie
  mówi autorom, jak publikować. Stąd bump wersji.

## Stan w 0.80.1

Naprawa i sprzątanie po 0.80.0. Szczegóły:
`RELEASE_CHECKLIST_0.80.1.md` (dokument wewnętrzny, nieopublikowany).

- **Pobieranie z GitHuba przez Rust (`market_fetch`).** `github.com` /
  `*.githubusercontent.com` nie zwracają `Access-Control-Allow-Origin`, więc
  `fetch` z webview był blokowany przez CORS — instalacja i nawet lista marketu
  cicho padały (`Failed to fetch`). Nowa komenda Tauri z allow-listą hostów
  (sprawdzaną na każdym redirecie), limitem bajtów i timeoutem. `index.json`
  z R2 (CORS otwarty) zostaje na zwykłym `fetch`.
- **Usunięte pole „Market source"** i cała martwa ścieżka Etapu B po stronie
  klienta (`fetchApiSources`, `normalizeMarketEndpoint`, `endpoint`,
  `problemEntry`, CSS, testy). Model A ma tylko statyczny katalog. Serwer
  Etapu B (`server/`) nietknięty.
- **Sprzątanie zaległości z review 0.80.0:** skasowane martwe skrypty
  `release:plugin-update` / `release:plugin-market`, nieużywana zależność
  `ed25519-dalek`, nieużywane `sha256Hex` / `verifyPluginPackageHash`.
- **Tytuł nowej notatki = placeholder, nie realny tekst.** Nowa notatka miała
  wpisany dosłownie tytuł „Untitled note", który trzeba było kasować. Teraz
  tytuł zapisuje się pusty, a pole pokazuje szary placeholder — klikasz i
  piszesz, nic nie usuwasz (jak w OneNote). Notatka bez tytułu dalej wyświetla
  się na liście jako „Notatka bez tytułu".

## Stan w 0.80.0

**Plugin Market — model społecznościowy (Model A), jak w Obsidianie.** Notible
przestaje hostować i podpisywać pluginy społecznościowe. Pełny opis:
`2026-09-09-plugin-market-model-a-design.md` (dokument wewnętrzny, nieopublikowany), lista zmian
w `RELEASE_CHECKLIST_0.80.0.md` (dokument wewnętrzny, nieopublikowany).

- **Bez podpisów pluginów.** Usunięty cały kod podpisu: `TRUSTED_RELEASE_KEYS`,
  weryfikacja Ed25519, `verify_package_signature`, podpisane manifesty
  aktualizacji, `VITE_NOTIBLE_PLUGIN_UPDATE_KEYS`. Updater `Notible.exe`
  (klucz Tauri, `latest.json`) **nietknięty**.
- **Hosting na GitHub Releases.** Autor publikuje wydanie z assetami
  `plugin.json` + `{id}.zip`; klient czyta je spod
  `https://github.com/{repo}/releases/latest/download/…` — bez GitHub API, bez
  limitów zapytań.
- **Recenzja przez PR do `release/market/catalog.json`** (schemat v2, same
  wskaźniki). `npm run build:market-catalog -- --write` generuje
  `plugins/index.json` na R2. Nowy `docs/PLUGIN_SUBMISSION.md`.
- **Modal zaufania przy instalacji.** ZIP instaluje nieoznakowana komenda Rust
  `install_plugin_zip`; przed nią modal mówi wprost, że plugin nie jest
  recenzowany przez Notible dla tej wersji. Zakładka All oznacza go `unsigned`.
- **Luka migracyjna:** `catalog.json` startuje pusty. 7 pluginów `notible.*`
  (graph, habits, notifications, reportit, sync, sync.simple, tables) **znika z
  zakładki Market** i przestaje dostawać aktualizacje, dopóki właściciel nie
  założy repo GitHub dla każdego, nie opublikuje wydania i nie zmerguje wpisu do
  `catalog.json`. Kopie już zainstalowane działają dalej. To nie jest zadanie
  kodu.

## Stan w 0.79.2

Etap B programu Plugin Market — **klient czyta API**. Szczegóły:
`RELEASE_CHECKLIST_0.79.2.md` (dokument wewnętrzny, nieopublikowany).

- **Ekran Plugins → Market** dostał pole „Market source" (URL + Use/Clear,
  zapisywane w `localStorage`). Puste → wbudowany katalog `index.json` jak
  dotąd; wpisany adres → lista z `/v1/market/*`. Zły URL → błąd w miejscu, bez
  pobierania. Licznik pokazuje „from the market" vs „published".
- Instalacja/aktualizacja/weryfikacja **bez zmian** — podpisany manifest
  wydania nadal pobierany i sprawdzany (Ed25519 + SHA-256) po stronie klienta.
  API to katalog, nie źródło zaufania.
- Prymitywy pobierania wydzielone do `src/core/app/marketSource.ts`
  (testowalne bez Reacta): `normalizeMarketEndpoint` (dozwolone `https://` lub
  loopback `http://localhost`), `fetchApiSources` (paginacja po kursorze,
  pomija wpisy bez wydania), `fetchStaticSources`.
- `MarketPluginCard` na serwerze niesie `manifestUrl` najnowszego wydania
  `published` — lista wystarcza do instalacji, bez dodatkowego zapytania.
- `connect-src` w `tauri.conf.json` dopuszcza `http://localhost:*` /
  `http://127.0.0.1:*` (lokalny `wrangler dev`); `https:` był już dozwolony.
- Test `npm run test:plugin-market` rozszerzony o allow-listę endpointu i
  paginację `fetchApiSources` (stubowany `fetch`).

## Stan w 0.79.1

Etap B programu Plugin Market — **read side** (backend katalogu). Tylko
`server/`, bez zmian klienta/Rust. Szczegóły:
`RELEASE_CHECKLIST_0.79.1.md` (dokument wewnętrzny, nieopublikowany).

- **Migracja** `server/migrations/0004-market-core.sql` (addytywna): tabele
  `market_authors`, `market_plugins`, `market_releases`. Ta sama DDL dopisana
  do `server/schema.sql`.
- **API** (`server/src/market.ts`, publiczne, bez auth):
  `GET /v1/market/plugins` (wyszukiwanie `q`, `category`, `sort`
  `recent`/`name`, paginacja keyset po kursorze, `limit` 1–50),
  `GET /v1/market/plugins/:id`, `GET /v1/market/plugins/:id/releases`.
  Zwraca wyłącznie `publication_status='listed'` i `status='published'`.
  Każde wydanie niesie `manifestUrl` — klient nadal sam weryfikuje podpis
  Ed25519 i hash. API to katalog, nie źródło zaufania.
- Strażnik `/v1/*` przepuszcza `GET /v1/market/*`; zapisy (oceny, zgłoszenia)
  nie są GET i dalej wymagają sesji.
- Test `npm run test:market`: czyste helpery + **offline e2e** — prawdziwe
  handlery Hono na prawdziwym SQLite z `schema.sql` (`node:sqlite`), bez
  wrangler/localhost. Pokrywa: tylko `listed`/`published`, 404 dla
  draft/delisted, `latestVersion` = najnowsze published, `q`/`category`/`sort`,
  paginacja keyset, brak `DB` → 503.
- **Niezrobione w Etapie B:** UI klienta czytające API (Core nie ma dziś
  wpiętego URL backendu — gated na decyzję o domenie), `wrangler deploy` +
  migracja (żeby trasy były w ogóle osiągalne — ale nic ich jeszcze nie woła),
  `index.json` jako generowany eksport.

## Stan w 0.79.0

Etap A programu Plugin Market (fundamenty i kontrakty) — pełny opis w
`2026-09-09-plugin-market-etap-a-design.md` (dokument wewnętrzny, nieopublikowany), lista zmian
w `RELEASE_CHECKLIST_0.79.0.md` (dokument wewnętrzny, nieopublikowany). Bez zasobów chmurowych, bez
endpointów serwera, bez moderacji.

- **Klient katalogu (`usePluginCatalog`):** pobieranie katalogu, manifestów i
  paczki ze strumieniowym limitem bajtów (odczyt przerywany po przekroczeniu;
  `Content-Length` tylko jako wskazówka; limit JSON liczony w bajtach).
  Manifesty pobierane maks. 4 naraz zamiast wszystkie w jednym rzucie. Błąd
  odczytu lokalnego rejestru pokazuje stan błędu, nie pustą listę
  „nic nie zainstalowano".
- **Zgodność:** jedna reguła — `isPluginUpdateCompatible` używa reguły
  major/minor API (jak loader manifestu) zamiast równości napisów; klient
  sprawdza też zakres min/max wersji Core.
- **Tożsamość pluginu:** klient odrzuca wpis, gdy `manifest.plugin.id` różni się
  od id z katalogu. Rust `extract_plugin_zip` odrzuca paczkę, której
  `plugin.json` `id`/`version` nie zgadza się z podpisanym manifestem.
- **Dokumentacja:** poprawiony nieaktualny opis kluczy podpisu w
  `docs/PLUGIN_UPDATES.md` (`notible-plugins-2026` jest przypięty, nie „puste").
- **Spisane kontrakty:** DTO API marketu, maszyna stanów zgłoszenia, model
  zagrożeń, szkic addytywnej migracji D1 (`0004-market-core.sql`) — jako
  specyfikacja dla etapów B–F.

## Stan w 0.78.12

Poprawki po niezależnej weryfikacji audytu (Codex, 2026-09-06) i po follow-up
review (2026-09-08) — pełny opis w `2026-09-06-review-results.md` (dokument wewnętrzny, nieopublikowany)
(sekcja „Runda 2"), lista zmian w `RELEASE_CHECKLIST_0.78.12.md` (dokument wewnętrzny, nieopublikowany).

- **Backend:** proxy modeli (`/v1/agent/turn`) niedostępne dla zwykłych kont —
  sesja potrzebuje `NOTIBLE_AI_ALLOW_SESSIONS=1`, wspólny sekret działa jak
  dotąd, niezalogowany zawsze odrzucony. `NOTIBLE_DISABLE_REGISTRATION=1` zamyka
  rejestrację. Decyzja wydzielona do `server/src/auth-gate.ts` + uruchamialny
  test `npm run test:server-auth`. Kwot ani limitów nie dodano.
- **Finance:** dashboard czyta budżet / opening cash / próg / walutę bazową z
  propsów projektu (wcześniej ignorowane), a realny błąd odczytu kontenera nie
  jest już wyciszany. Sumy są w jednej walucie raportowej; przy wielu walutach
  bez waluty bazowej **nie pokazujemy zmyślonej sumy** — pola pieniężne to `—`,
  jest za to rozbicie per waluta (bez przeliczania). Alerty mają stabilne
  klucze i18n. Eksport/import CSV: odwracalne kodowanie formuł na każdym polu
  tekstowym (z tytułem włącznie), `\r` cytowane, wspólne `financeImportRow`;
  `billable` round-tripuje jako bool.
- **Kalendarz (widok miesiąca):** nowy czysty moduł `calendar-month.ts`.
  Edycja zdarzenia zachowuje **oryginalne znaczniki czasu bajt-w-bajt** gdy
  pole nie było ruszane (osobne pola godziny startu i końca); `end < start`
  odrzucane widocznie, bez cichej podmiany. Rozwijanie wielodniowe przycinane
  do widocznej siatki (długie zdarzenia nie znikają), koniec całodniowy i o
  północy jest wyłączny, złe daty nie wywalają widoku. Cała komórka dnia znów
  klikalna myszą, numer dnia to `<button>` (klawiatura). Dni tygodnia z
  `Intl`, opcje przypomnień / błędy / tooltipy przez i18n.
- **DatePicker / popover:** „dziś" liczone lokalnie; pole czasu waliduje
  0–23 / 0–59 i nie kasuje zapisanej wartości; `placePopover` zwraca `maxHeight`
  gdy okno jest niższe niż panel (panel się mieści i przewija, cap CSS bez zmian).

## Stan w 0.78.7

**Moduły kontenera zastępują Work Packi.** Zakładki obiektu są teraz
**modułami**, które kontener (przestrzeń / projekt / folder) włącza i wyłącza.
Zbiór aktywnych modułów trzyma `props._modules` (`["<idPluginu>:<idZakładki>"]`);
**brak wartości → wszystkie zakładki, dokładnie jak dotąd** — istniejące
kontenery pozostają nietknięte.

- **Przy tworzeniu** kontenera pojawia się okno wyboru modułów właściwych dla
  danego rodzaju (`defaultFor` zaznaczone wstępnie, ścieżka „Użyj domyślnych").
- **Później** przycisk „Modules" w pasku zakładek kontenera otwiera ten sam
  wybór; wyłączenie modułu chowa jego zakładkę, dane zostają.
- Nowy **projekt** = Tasks + Automations. Nowa **przestrzeń** = Overview. Nowy
  **folder** = Tasks.
- **Work Packi usunięte**: plugin `notible.work-packs`, jego UI, spakowana
  kopia, katalog, ekran Settings → Work Packs i test równoważności. Residuum
  zostawione jako nieszkodliwe: `props._workPack` na starych kontenerach
  pakietów, ich `props._views`, dzieci o własnych typach (`ticket`, `risk`, …)
  oraz skopiowane do kontenera reguły automatyzacji `pack:*`.

Zob. `2026-09-03-container-modules-design.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.78.5

**Whiteboard jako zakładka kontenera (D3-residuum — ostatni punkt domknięcia
granicy Core/plugin).** Folder / projekt / przestrzeń ma teraz zakładkę
**„Whiteboard"**. Nie jest ona podpięta pod obiekt kontenera (jego `content` to
notatka markdown — zapis JSON tablicy by ją zniszczył), tylko pod **dedykowaną
tablicę-dziecko** kontenera: `canvas-ui` dostaje flagę `containerBoard` i przez
`ensureContainerBoard` znajduje/zakłada raz jeden obiekt `whiteboard`
(`props._containerBoard: true`, tworzony leniwie przy pierwszym otwarciu, nigdy
duplikowany). Tablica wersjonuje się, syncuje i otwiera jak każda inna, widać ją
w drzewie pod kontenerem. Plugin-only.

**Macierz migracji Core/plugin: 13/13 PASS — granica domknięta na poziomie
równoważności.** Calendar / AI / Import-Export / Themes / Search / Editor
extensions / Work Models podpisane jako „świadoma strata" — residuum to
platforma Core / powłoki / foundational plugin, nie luka domeny.

*(0.78.4 nigdy nie zbudowane — 0.78.5 zbiera całość: C2/C3/C4 + API 1.17 +
błędy UI + podpisy D1 + zakładka Whiteboard.)*

## Stan w 0.78.4 *(niezbudowane — patrz 0.78.5)*

**Etap Work Packs — C2 + C3 + C4 (composable workspace, dług D3).**

**C2 — `bug` scalony z `issue`.** Pakiet Development nie ma już własnego typu
`bug`; kanoniczny jest `issue` (z `notible.work-models`, schemat-nadzbiór z
`severity`). **Migracja danych** przy aktywacji `notible.work-models`
(`migrateBugToIssue`, idempotentna, bezstratna z założenia): każdy rekord
`bug` → `issue`, każdy widok kontenera filtrujący `"bug"` → `"issue"`.
⚠️ **Przed pierwszym uruchomieniem zrób backup workspace** (stała zasada:
żadna migracja bez kopii). Residuum: pusty wiersz typu `bug` zostaje w bazie
(brak `types.delete` w API), inertny.

**C3 — nowy pakiet „Client Work & Delivery".** Formularz intake + tabela zadań
+ tablica dostaw; zainstalowany folder dostaje też zakładki Timeline i Finance
(z C1). Miniatury w szczegółach pakietu są teraz zgodne z układem.

**C4 — layout `canvas` przemianowany na `gallery`.** Tolerant-read, bez
przepisywania bazy — stare `_views` renderują się jako siatka gallery i
zapisują jako `"gallery"` przy pierwszej edycji.

**Plugin API 1.17** — `context.data.objects.setType(id, newType,
expectedUpdatedAt?)` (bramka `data.write`) nad nową komendą Rust
`set_object_type`. Patch obiektu niesie tylko title/content/props, więc wtyczka
nie mogła zmienić typu rekordu. Wstecznie zgodne — wtyczki 1.16 działają bez zmian.

## Stan w 0.78.3

**Views — parytet tabeli.** Widok tabeli w `notible.views` używa teraz silnika
`@tanstack/react-table`: sortowanie po kliknięciu nagłówka, zmiana szerokości
kolumn przeciąganiem krawędzi, filtry per-kolumna (składają się z query
builderem). Stan zapisany w `_views[]` (`columnSort` / `columnWidths` /
`columnFilters`, opcjonalne — bez migracji).

**Import / eksport CSV kontenera.** „Import CSV" (`<input type=file>` →
mapowanie kolumn → obiekty potomne) i „Export CSV" (widoczne wiersze → plik w
`exports/` przez nowe API). Świadoma strata: wbudowany panel automatyzacji w
widoku (pokrywa zakładka Automations + hook w tle).

**Plugin API 1.15** — `context.ui.exportFile(filename, content)`: wtyczka pisze
tekst do folderu `exports/` i dostaje ścieżkę. Cienki wrapper nad istniejącym
`write_export`, bez nowego Rusta i bez nowego uprawnienia (bramka
`workspace.ui`). Wstecznie zgodne — wtyczki 1.14 działają bez zmian.

**Gantt — resize paska.** Pasek na osi czasu projektu można teraz rozciągać za
lewą (data startu) i prawą (data końca) krawędź, nie tylko przesuwać całość.
Zmiana kaskaduje przez zależności; nie da się przeciągnąć startu przed to, co
pozwala poprzednik. Diament kamienia milowego bez uchwytów (punkt w czasie).
Świadome rozbieżności vs stary kod: zależności trzymane w `props.deps` (nie w
relacjach workspace — bez migracji), zakładka Planning grupuje po rodzaju.

**Finance — przebudowana zakładka.** Zakładka Finance projektu dorównuje
staremu widokowi: panel budżetu (`plannedBudget`/`approvedBudget`/`openingCash`/
`budgetAlertThreshold`) z alertami (prog budżetu, forecast > budżet, runway <
3 mies., ujemna marża), bogatsze metryki (forecast at completion, budżet %),
osobny formularz wpisu czasu, tygodniowy grafik zasobów (osoba × tydzień),
import CSV, eksport CSV i **eksport XLSX** (własny generator .xlsx w pluginie).
Świadoma strata: import XLSX (CSV wystarcza).

**Plugin API 1.16** — `context.ui.exportBinary(filename, dataBase64, mime)`:
binarny odpowiednik `exportFile`, do plików nie-tekstowych (arkusz, obraz).
Wrapper nad nowym Rust `save_export_binary`. Wstecznie zgodne.

**Whiteboard — pełny edytor.** Tablica (`canvas-ui`) dorównuje staremu widokowi:
typy węzłów `shape` / `section` / `image` (upload, obraz osadzony w tablicy) /
`table` (edytowalna siatka) obok `card`/`note`. Przycisk **Report** (tablica →
markdown, eksport `.md`, „utwórz notatkę z raportem"), **Create tasks**
(niepowiązane karty → obiekty `task`), **Export** dokumentu do `.json`. Plugin
zachowuje własne dodatki (pan/zoom, snapping, elbow-connectory) których stary
widok nie miał. Rozbieżność: obraz jako `data:` URI w węźle (nie `media/<uuid>`).

**Composable workspace — krok 1.** Zakładki Tasks / Timeline / Planning /
Calendar / Finance (`notible.planning`), Table (`notible.views`) i Automations
są teraz dostępne na **każdym kontenerze** (folder / projekt / workspace), nie
tylko na projekcie. Panel dashboardu queruje dzieci po `containerId` —
nic w nim nie było projekto-specyficzne. Folder z pustą osią czasu pokazuje
stan „nothing yet". (Whiteboard jako zakładka dowolnego kontenera nadal
osobno — wymaga miejsca na dokument tablicy per-kontener.)

## Stan w 0.77.0

**Filtry wyszukiwarki.** Pasek wyszukiwania w Core dostał wiersz filtrów nad
polem tekstowym (widoczny gdy szukanie otwarte): **rodzaj** (lista typów
obiektów obecnych w workspace), **projekt/folder** (zawęża do całego poddrzewa
wybranego kontenera), **tag** (unia `props.tags` z całego workspace) oraz
zakres dat **Od / Do** na `updated_at` (natywne `input[type=date]`). Filtry
składają się z tekstem i ze sobą; „Clear filters" gdy coś ustawione; `Esc`
resetuje. (pkt 3)

**Autor i podpis wtyczki.** Detal wtyczki w Settings → Plugins → All dostał
blok „Author and signature": dla builtinów „Bundled with Notible", dla
zewnętrznych plakietka `signed` / `unsigned` + kredyt autora z
`manifest.author` i zdanie o tym, co status podpisu znaczy. `manifest.author`
był już w typie — bez zmiany wersji API, tylko komentarz. (pkt 7)

**Panel motywów wrócił do detalu.** `notible.themes` rejestruje panel przez
ścieżkę React `render`; przebudowa master/detail 0.71.8 filtrowała ustawienia
do `schema || mount`, więc picker motywów zniknął z UI. `PluginDetail`
renderuje teraz też wpisy `render` przez `PluginSettingsSurface`. (pkt 10)

**Most odczytu kalendarza (pkt 13a).** Zakładka Calendar w projekcie dostała
prawdziwe logowanie: panel „Connections" prowadzi sign-in Google / Microsoft
(loopback w przeglądarce) i picker kalendarzy — zaznaczone źródła pokazują
swoje wydarzenia w siatce miesiąca jako **tylko do odczytu** (nie zapisują
`props`, nie tworzą obiektów). Nowy przełącznik w Settings → Files & links
„Let plugins read your calendars" — dopóki wyłączony, panel pokazuje podpowiedź
„off". Współdzielenie kalendarzy jest wymuszane po stronie Rust
(`calendar_sharing_allowed` + limity zapytań, nieprzejrzyste id źródeł,
re-entrancy `calendar_connect`). Wszystko po stronie Core — bez zmiany wersji
API i bez republikacji wtyczki `calendar`.

Backlog `notible-backlog-2026-09-01` pkt 3, 7, 10, 13a. Szczegóły:
`RELEASE_CHECKLIST_0.77.0.md` (dokument wewnętrzny, nieopublikowany).
Zwija też niezbudowane 0.75.1 / 0.75.3 (patrz ich checklisty).

## Stan w 0.74.2

**Ukrywanie obiektów wyłączonej wtyczki.** Sync przenosi obiekty typów, których
druga maszyna nie obsługuje (np. `notible.typewriter.scene`, gdy Typewriter jest
tam wyłączony). Wyłączenie wtyczki nie kasuje jej wierszy w tabeli `types`, więc
Core dalej pokazywał te obiekty w drzewie i wyszukiwarce. Teraz `ExtensionHost`
zapisuje każde `data.types.upsert` per wtyczka w tej sesji
(`ExtensionSnapshot.providedTypes`), a `CoreOnlyApp` liczy `orphanTypes` =
wiersze `loadedTypes` z kropką w nazwie (typ z przestrzeni wtyczki), których
żadna włączona wtyczka nie dostarcza. Ich obiekty znikają z drzewa,
wyszukiwarki i auto-otwierania, ale **zostają w bazie** — włączenie wtyczki je
przywraca. Bare typy Core (`note`, `task`…) są strukturalnie bezpieczne (brak
kropki). Pluginy sync bez zmian. Cicho — brak licznika ukrytych (na później).

## Stan w 0.74.1

Dodaje **Plugin API 1.14** i zwija wszystko od 0.71.8, co nie zostało zbudowane
(0.72.0 / 0.73.x — numery wpadają tutaj): przebudowa ekranu Plugins na
master/detail, Market jako lista, `manifest.guide` (API 1.13), porządki w
pustym stanie ekranu Plugins, restyl panelu Sync, poprawki CSS Habits /
Notifications, usuwanie/szerokość/scroll w Data table, redesign Graph na kropki.

**Plugin API 1.14 — `context.data.media.read`.** Dla pluginu ReportIt (spec
`2026-08-31-media-read-api-1.14-design.md` (dokument wewnętrzny, nieopublikowany)). Plugin czyta
bajty (base64) wklejonego obrazka po referencji `media/<uuid>.<ext>` z treści
notatki, żeby wstawić go do czegoś co renderuje (raport, eksport). **Bez nowej
komendy Rust** — cienki wrapper (`readReferencedMedia`) nad istniejącym
`sync_media_read`, ta sama bramka użytkownika („Let plugins read pasted
images"). **Nowe uprawnienie `media.read`** (osobne od `data.sync`). **SVG
odrzucane** (aktywna treść). `media_path` w Rust odrzuca teraz symlinki w
`media/` (poprawia też `sync_media_read`). `navIcon: "file-text"` dodany do
zamkniętego zbioru. `EXTENSION_API_VERSION` / `PLUGIN_API_VERSION` 1.13 → 1.14.

**ReportIt płaskie tło (0.74.1).** `core-only.css`: wyjątek na kartę widoku
nav (`.core-plugin-view-pane` bez ramki/tła) obejmuje teraz też
`notible.reportit:` — obok Habits i Graph. ReportIt renderował się w kremowym
kontenerze zamiast na tle workspace. Trzecie id na sztywno; `ponytail:` mówi
uogólnić do flagi `flatSurface` w `views.register` przy czwartym.

**Globalny reset `input`** — `input:not(:where([type="checkbox"],[type="radio"]))`
zamiast `:not([type=…]):not([type=…])`. `:where()` nie dodaje specyficzności, więc
reguła zostaje na 0,0,1 i klasy `.x-input` znów ją nadpisują — wcześniejsze
podbicie do 0,2,1 opakowało w ramkę każdy tytuł notatki/projektu/taska/tabeli.
Checkboxy/radia dalej wykluczone (kwadratowe checkboxy Habits bez zmian).

**Data table** (`notible.tables` 0.5.4) — „Delete row" / „Delete column" w menu
prawokliku (czerwone, wyłączone przy ostatnim wierszu/kolumnie). Resize kolumny
poszerza tabelę i przewija w poziomie zamiast zwężać sąsiadów (`.ntbl-table`
`width: max-content`, bez `min-width: 100%`). **Scroll (po dwóch złych próbach):**
`.ntbl-scroll` przestał być kontenerem scrolla. 0.5.2 (`overflow-x:auto`) →
pasek za końcem wysokiej tabeli; 0.5.3 (`max-height`+`overflow:auto`) → drugi
pionowy pasek w środku. Teraz `.ntbl-scroll { min-width: 0 }` i tyle — tabela
`width:max-content` przelewa się do `.core-container-slot` Core (jedyny boks
scrolla związany z viewportem, infra Kanbana), który przewija OBIE osie przy
swoich krawędziach; sticky nagłówek trzyma się tego boksu. Jeden pionowy + jeden
poziomy pasek. Bez zmiany layoutu Core. Kwadracik „fill" repozycjonuje się przy
każdym scrollu. Komórki spłaszczone (globalny reset `input` Core opakowywał
każdą w 36px kartę). Przycisk „Lock widths" zamraża kolumny.

**WAŻNE — dlaczego 0.73.0 „nic nie zmieniło" w Data table / Notifications:**
te pluginy są zainstalowane w `%APPDATA%/com.notible.app/plugins/` (tables
**0.5.0**, notifications **0.1.3**). Rebuild Core NIE aktualizuje zainstalowanych
pluginów. Zmiany wchodzą dopiero po `release:plugin-update` → `release:plugin-market`
→ „Update" w aplikacji (albo reinstall z folderu `plugins/notible-*`).

**Plugin API 1.13** — `manifest.guide`: opcjonalny markdown (≤ 20 000 znaków),
dłuższe instrukcje pokazywane w Settings → Plugins pod nagłówkiem
„Instructions", gdy plugin jest wybrany. Krótkie `description` nadal steruje
listą. `EXTENSION_API_VERSION` 1.12 → 1.13 (d.ts, `lib.rs`, docsy).
`notible.queries` dostał pierwszy `guide`.

**Market jak All** — zakładka Market też jest teraz płaską listą + panelem
detalu: wiersz katalogu (ikona, nazwa, `New` / `Installed` / `Update` +
wersja), po kliknięciu detal pokazuje stan podpisu, wersję / API / min-core i
przycisk **Install / Update**. Cała weryfikacja podpisu/hasza/rozmiaru bez
zmian — logika fetch/verify/install przeniesiona 1:1 do
`usePluginCatalog.ts`, wspólna dla obu zakładek. `CorePluginMarketPanel.tsx`
skasowany.

**Przycisk reload/update w liście All** — po lewej od switcha, dla każdego
pluginu lokalnego (folder / .zip). Zwykły: przeładuj plugin z dysku.
Podświetlony (`is-update`), gdy wspólny katalog widzi nowszą podpisaną wersję —
jedno kliknięcie weryfikuje, instaluje i przeładowuje.

## Stan w 0.71.8

Ekran **Settings → Plugins** przebudowany na master/detail. Zamiast trzech
zakładek (Enabled / Core / Market) są dwie: **All** i **Market**. Środkowa
kolumna zachowuje wspólną szerokość ekranów Settings i pokazuje
**minimalistyczną, płaską listę** — ikona (jedna na kategorię), nazwa, meta,
przełącznik; hairline między wierszami, żadnych kart. **Trzecia kolumna
siatki** dokłada drugie tyle szerokości w pustej przestrzeni po prawej i
trzyma detal wybranego pluginu (sticky, własny scroll); poniżej ~1200 px
spada pod listę na całą szerokość.

Lista jest generowana wyłącznie z realnych źródeł (`buildPluginRows`) — żadna
mapa po id nie decyduje o widoczności, więc każdy nowy plugin pojawia się
automatycznie z działającym przełącznikiem; nieprzypisane do kategorii lądują
w grupie „Other" (guard: `npm run test:plugin-rows`). Detal: opis, przykład,
brakujące zależności, rejestracje, uprawnienia, panel `mount` (instrukcje) i
formularz ustawień danego pluginu. Stan pusty (nic nie wybrane): tylko podpowiedź
„wybierz plugin". Preferencje Core, które tam wcześniej wisiały, wróciły do
właściwych sekcji: „Backlinks and document stats" → **Editor**, „Let plugins read
pasted images" → **Files & links** (obok Linked folders). Panel Account & sync
pluginów synchronizacji przeszedł ze slotu `settings.section` na
`settings.register({ mount })` — renderuje się w detalu własnego pluginu, nie na
pustym ekranie dla wszystkich. Panel Sync: bez ramek per krok (hairline jak w
Core), status wyrównany do prawej, długie akapity → tooltipy, blok ostrzeżenia
„does not protect" → jedna linia + rozwijane „what this means".
Developer pack przeniesiony do **About**; przyciski folder/.zip/scaffold
usunięte z UI (handlery zostają). `CorePluginSettingsPanel` skasowany.

## Stan w 0.70.0

Dwa bloki. **Settings:** pięć osobnych ekranów pluginów (Core plugins, Plugin
Matrix, Plugin settings, Plugin panels, Plugin host) scalone w jeden ekran
„Plugins" z zakładkami Enabled / Core / Market; „Advanced diagnostics" i „Core
boundary" usunięte, w zamian ekran „About" (wersja, API, storage, linki).
Jednolita szerokość wszystkich ekranów Settings, kontrolki wyrównane do prawej
krawędzi, Unlink na czerwono, przyciski chrome na poziomie notatki (Back, +,
lupa) wypełnione bordo. **Typewriter:** prawdziwe nazwane czcionki manuskryptu
(stosy systemowe, 11 krojów, grupy Serif/Sans/Mono); kolory węzłów na Board;
dialogowy „- " nie zamienia się w bullet po ponownym otwarciu sceny;
przewijanie maszynowe trzyma kursor na środku; Typewriter w Ustawieniach
pokazuje pełny dashboard (4 zakładki + picker). Eksport i dołączone pliki
czcionek — do osobnego przemyślenia. Szczegóły:
`RELEASE_CHECKLIST_0.70.0.md` (dokument wewnętrzny, nieopublikowany).

## 0.71.6

- **Dependencies is always visible in Properties** — it was hidden inside the
  collapsed "More properties" section. It now renders in the open area, full
  width, straight after the main fields. The work-models plugin also
  re-applies its type schemas on every boot, so the `deps` field appears on
  existing workspaces with no "Install work models" step.
- **Gantt bar drag fixed.** Grabbing a bar no longer makes it lurch
  sideways; the bar and its dependency arrows now move together in whole-day
  steps; and on release the bar stays exactly where it was dropped instead
  of flashing back to its old date while the save round-trips. Broken arrow
  fragments during a drag are gone.

**Sync plugins** (`notible-sync` 0.4.1, `notible-sync-simple` 0.5.1 — separate
publish): every setup step in the panel is now collapsed by default and stays
collapsed after you close it. They used to force "Encryption key",
"Synchronise" and "Automatic synchronisation" back open on every re-render.

Details:
`RELEASE_CHECKLIST_0.71.6.md` (dokument wewnętrzny, nieopublikowany).

## 0.71.5

Follow-up to the 0.71.4 Gantt work (29 Aug feedback). 0.71.4 was never
built, so its changes ship here too.

- **Finish-start arrows no longer drop as a bare vertical line** when the
  successor sits directly below the predecessor and their dates are tangent.
  Below a `2 × STUB` horizontal gap the connector now wraps: out to the
  right of the finish edge, back left, then into the bar — a routed link
  rather than a degenerate drop. Overlapping bars still wrap under as the
  unsatisfied-constraint tell.
- **Right-click menu rebuilt as a nested rule → target menu.** Each of the
  four schedule rules ("After it finishes", "When it starts", "Finishes
  with it", "Can't finish before it starts") opens a fly-out list of
  eligible predecessors, filtered by a search box and by cycle detection.
  Existing links show their rule with an inline "Rule ▸" fly-out to switch
  it without opening Properties, plus Remove; an "Open note" action sits in
  the footer. Fly-outs open to the left when the menu is in the right half
  of the window.

Details:
`RELEASE_CHECKLIST_0.71.5.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.71.4

Poprawki rysowania zależności po testach 0.71.3. **Groty strzałek w końcu
działają** — `ResizeObserver` mierzący SVG nigdy się nie podpinał (był w
`useEffect([])`, który przy pustym stanie trafiał na `null`), więc trójkąt
grota liczył się z zerowego rozmiaru i nie powstawał. Teraz callback ref +
konektory rysowane w realnych pikselach (bez zniekształcającego `viewBox`),
więc linie dochodzą dokładnie do krawędzi słupka. **Routing ortogonalny per
typ:** finish-start jedno kolano / owinięcie pod spodem przy nachodzących
słupkach, start-start w lewym kanale, finish-finish w prawym, start-finish
w poprzek prawym kanałem; grot celuje w słupek następnika. **Kolory:** task
bordo, issue amber; konektory kolorowane typem logiki (FS ink, SS zielony,
FF niebieski, SF fioletowy). Menu prawokliku — kod klampu/scrolla z 0.71.2
jest poprawny, objaw w 0.71.3 to był świeży JS przy starym CSS w `dev:plugins`;
czysty build to zamyka. Szczegóły:
`RELEASE_CHECKLIST_0.71.4.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.71.3

Cztery typy zależności na Gantcie i poprawne rysowanie strzałek (po materiale
flexi-project.com). Model dostał czwarty typ **Start→Finish** (`start-finish`):
następnik nie może się skończyć, zanim poprzednik się zacznie — kaskada ciągnie
wtedy *koniec* następnika, nie start. W Properties → Dependencies to czwarta
pozycja reguły („Can't finish before it starts"). Konektory na wykresie
przestały używać jednego stałego zygzaka — każdy typ jest zakotwiczony do
konkretnych krawędzi słupków: finish-start z prawej krawędzi poprzednika w lewą
następnika (grot w prawo), start-start w lewym marginesie obu słupków,
finish-finish w prawym marginesie (grot w lewo), start-finish w poprzek do
końca następnika. Routing ortogonalny ze „stubem" trzymanym prosto od krawędzi,
z owinięciem gdy trzeba zawrócić (dla finish-start = sygnał niespełnionego
ograniczenia). Grot obraca się zależnie od krawędzi wejścia — wcześniej
finish-finish miał go w złą stronę. Bez zmian w schemacie `deps`. Szczegóły:
`RELEASE_CHECKLIST_0.71.3.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.71.2

Zależności zadań (Gantt) po feedbacku 28.08. Model przeszedł z jednego
poprzednika na wielu: `props.deps` to teraz lista `{ on, kind }`; stare pola
`dependsOn` / `dependsOnKind` czytane są nadal jako jednoelementowa lista, aż
do pierwszej edycji. **Kaskada dat** liczy najwcześniejszy możliwy start z
_najostrzejszego_ ze wszystkich poprzedników. **Blokada cykli:** dodanie
poprzednika, który (pośrednio) już zależy od zadania, jest odrzucane. **Linie
zależności** przestały być w kolorze akcentu (ten sam bordo co słupki, przez co
znikały na słupkach) — rysowane są w `--notible-text` z lekką przezroczystością,
grot pełny. **Prawoklik na słupku** = szybkie dodawanie/usuwanie poprzednika
(lista kandydatów bez tych, które dałyby cykl); reguła harmonogramu ustawiana
jest w Properties. **Properties → More properties → Dependencies:** nowy edytor
wielu poprzedników — wiersz na poprzednika (nazwa · reguła · usuń) + pole
dodawania; Gantt rysuje po jednym konektorze na wiersz. Reguły przemianowane na
zrozumiałe: „After it finishes" / „When it starts" / „Finishes with it".
**Podpowiedzi tagów** działają z klawiatury — ↑/↓ wybierają pozycję, Enter/Tab
zatwierdzają podświetloną (a nie wpisany fragment), Esc zamyka listę.
Wymaga jednorazowego „Install / update work models", żeby pole `deps` dołączyło
do schematu istniejących instalacji. Szczegóły:
`RELEASE_CHECKLIST_0.71.2.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.71.1

Fix sekcji Settings → Plugins. **Typewriter settings** usunięte (wszystko jest
na zakładkach obiektu manuskryptu, osobny ekran je dublował). **Work Packs
settings** przebudowane na master/detail: 4 packi listą po lewej, szczegóły
wybranego jako zwijane `<details>` po prawej, nie pod całą listą. **Core
(Plugin Matrix):** usunięty nagłówek „About a plugin" z pustego panelu i blok
„Open Plugin host" (prowadził do nieistniejącej po 0.70.0 sekcji). **Habits
i Graph** siedzą teraz płasko na tle workspace — bez jaśniejszej karty, ramki
i zaokrągleń wokół całości. **Habits (plugin 0.9.0, osobna publikacja):**
checkbox jako zaokrąglony kwadrat z tickiem zamiast natywnego; heatmapa ~25%
większa i bez capa szerokości, mieści pełny rok bez przewijania w prawo.
**Graph (plugin 0.10.0, osobna publikacja):** fizyka wyraźnie luźniejsza —
sprężyny ~4× słabsze, odpychanie mocniejsze, pull do środka minimalny; graf
przestaje agresywnie zwijać się do środka i ustala się w ~50–75 klatkach,
„rubber-band" między połączonymi zachowany (zmierzone skryptem). Usunięty
suwak „suggested strength"; statystyki zwinięte w „Totals"; legenda z
etykietami Edges/Types, krótkie nazwy typów pluginów, „+N more" z listą
w tooltipie. **Plugin Sync (oba warianty, 0.4.0 / 0.5.0, osobna publikacja):**
4 kroki to teraz zwijane sekcje — ukończony setup składa się do nagłówka,
kroki „Synchronise" i „Automatic" zostają otwarte; panel używa pełnej
szerokości zamiast twardego limitu 720 px. Szczegóły:
`RELEASE_CHECKLIST_0.71.1.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.71.0

Druga tura feedbacku 28.08.26. **Automations:** status/priorytet wybiera się
z `Combobox` (wygląd jak sąsiednie pola, podpowiada wartości użyte w projekcie,
wpisanie nowej nadal możliwe) zamiast gołego pola tekstowego. **About:** oba
przyciski obok „Documentation" wypełnione bordo. **Kanban:** menu prawoklik
karty to teraz tylko „Status ▸" i „Priority ▸" z rozwijanym flyoutem („Open"
w podliście Status); kartę można przeciągnąć na kolumnę (pointer-drag, bo
HTML5 DnD nie działa w webview Tauri) — również w zakładce Work projektu.
**Theme settings:** wszystko poniżej wyboru motywu (import z pliku + kreator
custom motywu z 11 pickerami) zwinięte w jedną rozwijaną sekcję, domyślnie
zamkniętą. Szczegóły:
`RELEASE_CHECKLIST_0.71.0.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.69.2

Runda 2 poprawek Typewritera: Codex/Progress/Board wcięte tak jak Manuscript;
tryb prozy scalony z wbudowanym focus mode Core (jeden przycisk, chowa całe UI
+ zawęża/wygasza prozę — koniec osobnej pigułki „Focus mode"); self-heal
`parent_id` encji Codexu (strzałka wstecz z „Edit notes"). **Board przebudowany
na mapę myśli**: węzły (nowy typ `beat`) + sceny na niewidzialnej siatce 20px,
ortogonalne konektory (`tw.leads`), przeciąganie z przyciąganiem do siatki,
pozycje w propie `tw.board` manuskryptu. Eksport i prawdziwe czcionki — do
osobnego przemyślenia. Szczegóły:
`RELEASE_CHECKLIST_0.69.2.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.69.1

Runda poprawek UI Typewritera po lokalnym buildzie 0.69.0: ikony typów w
lucide zamiast emoji (mapa `PLUGIN_TYPE_ICONS` w Core, wzorzec `navIcon`),
usuwanie encji Codexu, powrót z „Edit notes" (encje dostają `parentId`),
liczenie słów też z part/chapter, przyciski akcji na czerwono, szerokość
dashboardu ograniczona, Board pokazuje fabuły bez scen. Szczegóły:
`RELEASE_CHECKLIST_0.69.1.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.69.0

Typewriter v2: manuskrypt jest teraz pełnoprawnym typem kontenerowym jak
Projekt (pozycja pod „+", własny „folder" w drzewie, dashboard z zakładkami
Manuscript / Codex / Progress / Board). Core dostał powierzchnie kontenerowe
dla typów pluginowych z `behaviour.container` oraz `ProseProfile.focusMode`
(tryb prozy długiej formy w `CoreMarkdownEditor`). Bez zmian w kanale
aktualizacji ani w Plugin API 1.12 — `focusMode` to pole opcjonalne.
Szczegóły: `RELEASE_CHECKLIST_0.69.0.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.61.0

Kanał Core jest **aktywny**: `src-tauri/tauri.conf.json` wskazuje na
`https://updates.szymonjankiewicz.com/latest.json`, a bucket `notible-updates`
obsługuje też przestrzeń `plugins/`. Akapit „Kolejność wdrożenia" powyżej opisuje
stan sprzed uruchomienia kanału i należy go czytać jako historię, nie jako
obowiązującą blokadę.

Kanał wtyczek jest osobny i już używany — Notible Graph został opublikowany na
kanale `stable` w 0.60.0, a `release/market/catalog.json` jest w gicie i to on
jest zapisem tego, co opublikowano. Szczegóły w [`PLUGIN_UPDATES.md`](./PLUGIN_UPDATES.md).

0.61.0 podbija Plugin API z 1.7 na 1.8 (`ui.openView`). Podbicie jest
addytywne, więc paczka deklarująca `apiVersion: "1.7"` instaluje się i działa
bez zmian; nowe API jest po prostu niedostępne na starszym hoście. Wtyczka,
która zacznie wymagać 1.8, powinna to powiedzieć przez `minCoreVersion`
w manifeście aktualizacji, a nie przez samo `apiVersion`. Zakres wydania opisuje
`RELEASE_CHECKLIST_0.61.0.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.62.0

Plugin API zostaje 1.8 — żadna zmiana kontraktu, tylko nowe opcjonalne pole
`ViewRegistration.navIcon?: "network" | "check-square"` (fallback: ikona
puzzla), które nie wymaga bramki wersji, bo stary plugin bez tego pola dalej
działa bez zmian. Nowa natywna komenda Rust `set_tray_texts` (mostek
JS→Rust retekstujący tray po języku, patrz `TrayHandles` w `src-tauri/src/lib.rs`)
i nowy prop `CoreMarkdownEditor.forceRebuildNonce` to zmiany wyłącznie w
Core, nieujawnione żadnej wtyczce. Zakres wydania opisuje
`RELEASE_CHECKLIST_0.62.0.md` (dokument wewnętrzny, nieopublikowany).

## Stan w 0.68.0

Plugin API 1.11 → 1.12: deklarowalne typy domenowe (flagi `behaviour`
`container` / `treeHidden` w schemacie, wymuszona przestrzeń nazw pluginu),
`context.editor.registerProseProfile` (profil prozy per typ/prop — auto-lista
i czcionka edytora), `context.data.relations.listForObjects` (hurtowy odczyt
relacji). Podbicie addytywne. Nowy builtin `notible.typewriter` (v1: Manuscript
+ Codex). Zakres:
`RELEASE_CHECKLIST_0.68.0.md` (dokument wewnętrzny, nieopublikowany).

## Jednorazowa aktywacja kanału

1. Utworzyć właściwe repozytorium/release feed dla Notible. Obecny git remote
   wskazuje inne repozytorium i nie może być użyty jako kanał aktualizacji.
2. Wygenerować klucz poza repozytorium:

   `npm run tauri signer generate -- -w <bezpieczna-ścieżka>/notible.key`

3. Przechować klucz prywatny i jego hasło w menedżerze sekretów. Do
   `tauri.conf.json` trafia wyłącznie zawartość klucza publicznego.
4. Przenieść ustawienia z `src-tauri/tauri.updater.conf.example.json` do
   `src-tauri/tauri.conf.json`, podając publiczny klucz i adres HTTPS.
5. Podczas podpisanego builda ustawić w PowerShell:

   - `TAURI_SIGNING_PRIVATE_KEY` — ścieżka albo zawartość klucza prywatnego;
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — hasło klucza;
   - `VITE_NOTIBLE_UPDATER_ENABLED=true` — włącza przycisk aktualizacji w UI.

Pliki `.env` nie są używane przez signer Tauri.

## Publikacja wydania

1. Uruchomić pełne testy i `npm run release:check`.
2. Zbudować podpisane MSI i NSIS/EXE wraz z artefaktami updatera, używając
   prywatnej kopii konfiguracji z włączonym `createUpdaterArtifacts`:

   `npm run tauri build -- --config <prywatna-konfiguracja-updatera.json>`

   Punktem wyjścia jest `src-tauri/tauri.updater.conf.example.json`. Kopia musi
   zawierać prawdziwy klucz publiczny i endpoint. Klucza prywatnego ani hasła
   nie wolno zapisywać w konfiguracji ani commitować.
3. Przy `createUpdaterArtifacts: true` Tauri 2 podpisuje bezpośrednio instalator
   Windows (`.exe` i/lub `.msi`) oraz tworzy odpowiadający mu plik `.sig`.
   To są artefakty aktualizacji dla obecnej konfiguracji. Wariant
   `v1Compatible` tworzy zamiast tego paczki ZIP (`.nsis.zip` / `.msi.zip`).
   Podpisany artefakt aktualizuje istniejącą instalację bez ręcznej
   deinstalacji i ponownego przechodzenia pełnego instalatora.
4. Przygotować kompletny katalog publikacyjny:

   `npm run release:updater-package -- --artifact <plik.exe> --url <adres-https-pliku.exe>`

   Polecenie kopiuje artefakt i podpis do `release/<wersja>/updater`, generuje
   `latest.json` i sumę SHA-256. Nie tworzy fałszywego podpisu i kończy się
   błędem, jeśli pliku `.sig` brakuje. `notes` w `latest.json` to sekcja
   `## <wersja>` z `docs/RELEASE_NOTES.md` (nie `CHANGELOG.md`); brak tej
   sekcji zatrzymuje polecenie, zanim cokolwiek zapisze.
5. Alternatywnie utworzyć tylko manifest:

   `npm run release:manifest -- --url <adres-https-instalatora> --sig <plik.sig> --out latest.json`

6. Opublikować artefakt pod URL zapisanym w manifeście oraz `latest.json` pod
   stałym adresem skonfigurowanym w aplikacji.
7. Sprawdzić aktualizację na kopii poprzedniej wersji z zachowaniem bazy danych.

Na Windows instalacja aktualizacji zamyka aplikację. Tryb `passive` pokazuje
postęp instalatora i nie wymaga przechodzenia przez pełny kreator instalacji.

## Aktualizacje pluginów

Aktualizacje pluginów są osobnym kanałem i nie używają Core `latest.json`.
Od 0.80.0 pluginy społecznościowe działają w modelu jak w Obsidianie: hosting na
GitHub Releases (`plugin.json` + `{id}.zip`), katalog wskaźników
`release/market/catalog.json`, recenzja przez PR, **bez podpisu pluginów**,
modal zaufania przy instalacji. Kontrakt i procedurę opisują
[`PLUGIN_UPDATES.md`](./PLUGIN_UPDATES.md) i
[`PLUGIN_SUBMISSION.md`](./PLUGIN_SUBMISSION.md).
