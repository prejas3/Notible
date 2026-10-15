# Notible 1.0 — pakiet danych do Gantta / bilingual Gantt data pack

Ten zestaw tworzy jeden spójny projekt produktowy: wydanie **Notible 1.0 — Project Planning & Gantt**.
Dodawaj elementy w kolejności ich identyfikatorów (`N01` → `N20`). W polu zależności wybieraj wskazany element jako **poprzednik**; typ relacji podano w nawiasie.

## Wspólne ustawienia / shared conventions

- **Projekt / Project:** `Notible 1.0 — Project Planning & Gantt`
- **Daty / Dates:** wpisuj w formacie `YYYY-MM-DD`.
- **Koniec / End:** dla Task i Issue użyj pola `Due`; dla Release użyj `Target date` (oraz `Start date`, jeśli dodasz to pole niestandardowe).
- **Zależność finish-to-start / Finish-to-start:** następny element zaczyna się po ukończeniu poprzednika.
- **Blokuje / Blocks:** element źródłowy blokuje element docelowy. Użyj tego typu wyłącznie tam, gdzie jest zaznaczony.
- **Treść / Body:** każda karta ma gotową wersję polską i angielską; wklej obie jako jedną treść albo tylko język używany w przestrzeni.

---

## N01 — Task

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Zatwierdzić cel wydania Notible 1.0 |
| Title EN | Approve the Notible 1.0 release objective |
| Początek / Start | 2026-09-01 |
| Koniec / Due | 2026-09-02 |
| Status | done |
| Priorytet / Priority | urgent |
| Tagi / Tags | `notible-1-0`, `product`, `planning` |
| Zależność / Dependency | Brak / None |

**Treść PL:** Notible 1.0 ma zamienić luźną listę pracy w plan, który można przeczytać w kilka sekund: kto pracuje nad czym, co jest zagrożone i co zatrzyma kolejną czynność. Zakres wydania obejmuje planowanie projektu, wykres Gantta i zależności pracy.

Zespół uzgadnia trzy mierniki sukcesu: użytkownik tworzy pierwszy harmonogram bez instrukcji, blokada jest widoczna przed terminem oraz widok pozostaje czytelny dla projektu z co najmniej 100 elementami. Poza zakresem pozostają automatyczne estymacje, rozliczanie czasu i planowanie zasobów.

Rezultatem ma być zatwierdzona karta celu, lista decyzji i wspólny język dla produktu, designu oraz inżynierii. Ta decyzja jest punktem odniesienia dla każdej późniejszej zmiany zakresu.

**Body EN:** Notible 1.0 should turn a loose work list into a plan that can be read in seconds: who is working on what, what is at risk, and what will stop the next activity. The release covers project planning, a Gantt chart, and work dependencies.

The team agrees on three success metrics: a user creates a first schedule without guidance, a blocker is visible before its deadline, and the view stays readable for a project with at least 100 items. Automatic estimates, time billing, and resource planning remain out of scope.

The outcome is an approved objective card, a decision list, and a shared language for product, design, and engineering. This decision becomes the reference point for every later scope change.

## N02 — Task

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Zebrać scenariusze użytkowników dla planowania |
| Title EN | Gather user scenarios for planning |
| Początek / Start | 2026-09-03 |
| Koniec / Due | 2026-09-05 |
| Status | done |
| Priorytet / Priority | high |
| Tagi / Tags | `notible-1-0`, `research`, `planning` |
| Zależność / Dependency | N01 (finish-to-start) |

**Treść PL:** Zbierz opisy pracy od osób prowadzących projekty, wykonujących zadania i odbierających raporty. Nie pytaj wyłącznie o funkcje — odtwórz sytuacje, w których termin przesuwa się, ktoś czeka na decyzję albo zespół musi szybko wyjaśnić opóźnienie.

Pięć scenariuszy ma objąć utworzenie planu, ustawienie dat, połączenie zależności, wykrycie blokady i eksport widoku dla zespołu. Do każdego dopisz punkt startowy, działanie użytkownika, oczekiwany rezultat oraz informację, co może pójść nie tak.

Wyniki posłużą jako podstawa makiet i testów odbiorowych. Szczególnie ważne jest rozróżnienie między relacją informacyjną a blokadą, która realnie zmienia kolejność pracy.

**Body EN:** Gather work stories from project leads, task doers, and report recipients. Do not ask only about features—reconstruct moments when a deadline moves, someone waits for a decision, or a team must quickly explain a delay.

The five scenarios must cover creating a plan, setting dates, linking dependencies, detecting a blocker, and exporting a team view. For each, record the starting point, user action, expected result, and possible failure mode.

The results will drive wireframes and acceptance tests. The most important distinction is between an informational relation and a blocker that actually changes work order.

## N03 — Task

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Zaprojektować model danych Gantta |
| Title EN | Design the Gantt data model |
| Początek / Start | 2026-09-06 |
| Koniec / Due | 2026-09-09 |
| Status | done |
| Priorytet / Priority | urgent |
| Tagi / Tags | `notible-1-0`, `architecture`, `gantt` |
| Zależność / Dependency | N02 (finish-to-start) |

**Treść PL:** Opisz model, w którym każdy element pracy może mieć datę rozpoczęcia, termin, status, priorytet i zestaw relacji. Daty są datami lokalnymi, aby harmonogram nie przesuwał się po zmianie strefy lub czasu letniego.

Zdefiniuj semantykę relacji finish-to-start, start-to-start, finish-to-finish i blocks, włącznie z kierunkiem strzałki w widoku. Przykład relacji musi zawsze odpowiadać temu, co użytkownik czyta: poprzednik prowadzi do następcy.

Uwzględnij elementy bez pełnego zakresu dat, relacje do elementów ukrytych przez filtr i odrzucanie pętli zależności. Dokument ma też wskazać, które wartości są wymagane do rysowania paska, a które są tylko wzbogaceniem danych.

**Body EN:** Describe a model in which every work item can have a start date, due date, status, priority, and a set of relations. Dates are local dates so schedules do not shift across time zones or daylight-saving changes.

Define the semantics of finish-to-start, start-to-start, finish-to-finish, and blocks, including arrow direction in the view. A relation example must always match what the user reads: a predecessor leads to a successor.

Cover items without a full date range, relations to items hidden by filters, and cycle rejection. The document must also state which values are required to draw a bar and which merely enrich the data.

## N04 — Issue

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Nieprawidłowe przesunięcie strefy czasowej w osi czasu |
| Title EN | Timeline timezone offset is incorrect |
| Początek / Start | 2026-09-08 |
| Koniec / Due | 2026-09-10 |
| Status | resolved |
| Priorytet / Priority | high |
| Tagi / Tags | `notible-1-0`, `bug`, `timeline` |
| Zależność / Dependency | N03 (finish-to-start) |

**Treść PL:** W widoku Gantta data zapisana bez godziny pojawia się u części osób dzień wcześniej. Błąd dotyczy zwłaszcza projektów otwieranych w strefach na zachód od miejsca utworzenia danych i podważa zaufanie do całego planu.

Ustal jedną ścieżkę przetwarzania dat: wartości typu `YYYY-MM-DD` traktujemy jako lokalne daty kalendarzowe, bez niejawnego przeliczania na UTC. Sprawdź import, zapis, sortowanie, etykiety oraz pozycję paska na osi.

Dodaj testy regresji dla zwykłego dnia i przejścia czasu letniego. Zgłoszenie można oznaczyć jako rozwiązane dopiero po potwierdzeniu zgodności w co najmniej dwóch strefach czasowych.

**Body EN:** In the Gantt view, a date stored without a time appears one day early for some people. The issue is especially visible in projects opened west of the place where the data was created, undermining trust in the whole plan.

Establish one date-processing path: values in `YYYY-MM-DD` format are local calendar dates, with no implicit UTC conversion. Check import, storage, sorting, labels, and bar position on the timeline.

Add regression tests for an ordinary day and a daylight-saving transition. Mark the issue resolved only after confirming consistent results in at least two time zones.

## N05 — Task

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Przygotować makiety widoku Gantta |
| Title EN | Prepare Gantt view wireframes |
| Początek / Start | 2026-09-10 |
| Koniec / Due | 2026-09-14 |
| Status | done |
| Priorytet / Priority | high |
| Tagi / Tags | `notible-1-0`, `design`, `gantt` |
| Zależność / Dependency | N03 (finish-to-start) |

**Treść PL:** Przygotuj makiety widoku, w którym lista pracy po lewej stronie i oś czasu po prawej są jednym narzędziem, a nie dwoma niezależnymi ekranami. Użytkownik ma odczytać tytuł, status, priorytet i zakres dat bez otwierania karty.

Zaprojektuj skalę czasu, wiersze pracy, paski czasu, legendę statusów oraz panel tworzenia zależności. Pokaż zachowanie dla pojedynczego dnia, długiego zadania, elementu bez daty i elementu z aktywną blokadą.

Makiety muszą obejmować mały ekran, poziome przewijanie i projekt z dużą liczbą elementów. W decyzjach wizualnych priorytetem jest czytelność kolejności pracy, a nie dekoracyjna gęstość.

**Body EN:** Prepare wireframes for a view where the work list on the left and the timeline on the right are one tool, not two disconnected screens. A user should read title, status, priority, and date range without opening a card.

Design the time scale, work rows, timeline bars, status legend, and dependency-creation panel. Show behavior for a single-day item, a long task, an undated item, and an item with an active blocker.

Wireframes must cover small screens, horizontal scrolling, and a project with many items. In visual decisions, the priority is readable work order rather than decorative density.

## N06 — Task

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Zaimplementować obliczanie zakresów dat |
| Title EN | Implement date-range calculation |
| Początek / Start | 2026-09-11 |
| Koniec / Due | 2026-09-16 |
| Status | done |
| Priorytet / Priority | urgent |
| Tagi / Tags | `notible-1-0`, `frontend`, `gantt` |
| Zależność / Dependency | N04 (finish-to-start) |

**Treść PL:** Zaimplementuj funkcję, która przelicza datę rozpoczęcia i termin na pozycję oraz szerokość paska względem widocznego zakresu osi. Wynik musi być stabilny przy zmianie powiększenia z dni na tygodnie i miesiące.

Dla elementu z jedną datą pokaż jednoznaczny znacznik, a dla zakresu częściowo poza widokiem przytnij pasek do granicy osi. Gdy termin jest wcześniejszy niż początek, nie renderuj ujemnej szerokości — pokaż stan wymagający korekty danych.

Dodaj przykłady testowe dla zadań jedno- i wielodniowych, końca miesiąca oraz daty na granicy widocznego zakresu. Implementacja będzie bazą zarówno dla zwykłych pasków, jak i późniejszego wyróżnienia krytycznej ścieżki.

**Body EN:** Implement a function that converts a start date and due date into a bar position and width relative to the visible timeline range. The output must remain stable when zooming from days to weeks and months.

For an item with one date, show an unambiguous marker; for a range partly outside the view, clip the bar to the timeline edge. If a due date precedes a start date, never render a negative width—show a data-correction state.

Add test examples for one- and multi-day tasks, month boundaries, and dates at the visible-range edge. This implementation will support both ordinary bars and later critical-path highlighting.

## N07 — Task

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Zbudować interakcję tworzenia zależności |
| Title EN | Build the dependency-creation interaction |
| Początek / Start | 2026-09-15 |
| Koniec / Due | 2026-09-18 |
| Status | in-progress |
| Priorytet / Priority | urgent |
| Tagi / Tags | `notible-1-0`, `frontend`, `dependencies` |
| Zależność / Dependency | N05 (finish-to-start), N06 (finish-to-start) |

**Treść PL:** Zbuduj prostą ścieżkę utworzenia relacji: użytkownik wskazuje poprzednika, następcę i jeden z obsługiwanych typów. Interakcja ma działać zarówno z poziomu karty, jak i widoku Gantta, bez wymuszania znajomości technicznych nazw.

Przed zapisem pokaż zdanie podsumowujące, na przykład „Projekt makiet musi zakończyć się przed rozpoczęciem implementacji”. To podsumowanie ma odwracać uwagę od kierunku zapisu w bazie i zapobiegać błędnej interpretacji relacji.

Zablokuj połączenie elementu z samym sobą oraz duplikaty. Po zapisie odśwież linię na wykresie i zapewnij możliwość usunięcia relacji z tym samym poziomem pewności.

**Body EN:** Build a simple relation-creation flow: the user selects a predecessor, successor, and one supported type. The interaction must work from both a card and the Gantt view without requiring technical names.

Before saving, show a sentence such as “Wireframe design must finish before implementation can start.” This summary should hide database-direction details and prevent a mistaken interpretation of the relation.

Block self-links and duplicates. After saving, refresh the chart line and provide an equally dependable way to remove the relation.

## N08 — Issue

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Można utworzyć cykliczną zależność między zadaniami |
| Title EN | A circular task dependency can be created |
| Początek / Start | 2026-09-16 |
| Koniec / Due | 2026-09-19 |
| Status | in-progress |
| Priorytet / Priority | urgent |
| Tagi / Tags | `notible-1-0`, `bug`, `dependencies` |
| Zależność / Dependency | N07 (blocks — N08 blocks N07) |

**Treść PL:** Obecnie można utworzyć relację A → B → C → A. Taki graf nie ma logicznego początku, przez co użytkownik może błędnie sądzić, że harmonogram jest poprawny, choć żadna z prac nie może ruszyć.

Przed zapisem nowej relacji przejdź graf od następcy do wszystkich jego kolejnych elementów. Jeżeli ścieżka wraca do poprzednika, odrzuć operację bez zmieniania istniejących danych.

Komunikat powinien wskazać konfliktną ścieżkę prostym językiem, na przykład „Testy prowadzą już do Projektu makiet”. To zgłoszenie blokuje N07, bo bez tej ochrony interfejs zachęcałby do zapisywania niespójnych danych.

**Body EN:** It is currently possible to create A → B → C → A. Such a graph has no logical beginning, so a user may think the schedule is valid even though none of the work can start.

Before saving a new relation, traverse the graph from the successor through all of its successors. If a path returns to the predecessor, reject the operation without changing existing data.

The message should identify the conflicting path in plain language, for example, “Testing already leads back to Wireframe Design.” This issue blocks N07 because, without this guard, the interface would encourage inconsistent data.

## N09 — Task

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Dodać filtry statusu, priorytetu i tagów |
| Title EN | Add status, priority, and tag filters |
| Początek / Start | 2026-09-19 |
| Koniec / Due | 2026-09-22 |
| Status | todo |
| Priorytet / Priority | high |
| Tagi / Tags | `notible-1-0`, `filters`, `ux` |
| Zależność / Dependency | N07 (finish-to-start) |

**Treść PL:** Dodaj filtry statusu, priorytetu i tagów, aby osoba prowadząca projekt mogła odizolować pracę zablokowaną, pilną lub należącą do danego obszaru. Każdy filtr ma działać w trybie wielokrotnego wyboru i mieć jasny stan aktywności.

Lista pracy i oś czasu muszą zmieniać się w tym samym momencie. Obok filtrów pokaż licznik widocznych elementów oraz prostą akcję przywrócenia pełnego widoku.

Zapisz decyzję, czy różne grupy filtrów łączą się jako „i”, a wartości wewnątrz jednej grupy jako „lub”. Ta reguła ma być identyczna w widoku Gantta, tabeli i Kanbanie.

**Body EN:** Add status, priority, and tag filters so a project lead can isolate blocked, urgent, or area-specific work. Every filter must support multiple selections and make its active state clear.

The work list and timeline must update together. Next to the filters, show a visible-item counter and a simple action to restore the full view.

Document whether different filter groups combine as “and” and values within one group as “or.” This rule must be identical in the Gantt, table, and Kanban views.

## N10 — Task

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Zaimplementować oznaczenia blokad i krytycznej ścieżki |
| Title EN | Implement blocker and critical-path indicators |
| Początek / Start | 2026-09-20 |
| Koniec / Due | 2026-09-24 |
| Status | todo |
| Priorytet / Priority | high |
| Tagi / Tags | `notible-1-0`, `gantt`, `dependencies` |
| Zależność / Dependency | N08 (finish-to-start) |

**Treść PL:** Dodaj wyraźne oznaczenie elementów, które nie mogą rozpocząć się lub zostać ukończone z powodu aktywnej pracy poprzedzającej. Widok ma wspierać rozmowę o ryzyku, a nie tylko prezentować dekoracyjne linie.

Po najechaniu lub ustawieniu fokusu pokaż tytuł blokującego elementu, typ relacji i jego bieżący status. Wyróżnienie ma korzystać z tekstu, ikony i odpowiedniego kontrastu, a nie wyłącznie z koloru.

Zasady krytycznej ścieżki opisz ostrożnie: w tej wersji podświetlamy istotny łańcuch zależności, nie obiecujemy pełnego silnika harmonogramowania. Dzięki temu komunikacja produktu pozostaje zgodna z rzeczywistą funkcją.

**Body EN:** Add a clear indicator for items that cannot start or finish because preceding work is still active. The view should support a risk conversation, not merely display decorative lines.

On hover or focus, show the blocking item title, relation type, and current status. The indicator must use text, an icon, and sufficient contrast—not color alone.

Describe critical-path rules carefully: this release highlights an important chain of dependencies; it does not promise a full scheduling engine. This keeps product communication aligned with the actual feature.

## N11 — Issue

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Filtry pozostawiają nieaktualne linie zależności |
| Title EN | Filters leave stale dependency lines visible |
| Początek / Start | 2026-09-22 |
| Koniec / Due | 2026-09-25 |
| Status | open |
| Priorytet / Priority | medium |
| Tagi / Tags | `notible-1-0`, `bug`, `filters` |
| Zależność / Dependency | N09 (finish-to-start) |

**Treść PL:** Po ukryciu elementu przez filtr jego linia zależności pozostaje na wykresie i kończy się w pustym miejscu. Efekt sprawia wrażenie uszkodzonego diagramu oraz utrudnia odczytanie rzeczywistych powiązań.

Przy każdym przeliczeniu widoku buduj zestaw widocznych identyfikatorów, a następnie renderuj linię tylko wtedy, gdy widoczne są oba końce relacji. Nie usuwaj samej relacji z danych — jest jedynie niewidoczna w danym kontekście.

Dodaj test regresji dla filtrowania po statusie, tagu i priorytecie. Zgłoszenie pozostaje otwarte, dopóki filtr nie działa jednakowo po zmianie zakresu czasu i po ręcznym odświeżeniu widoku.

**Body EN:** After a filter hides an item, its dependency line remains on the chart and ends in empty space. The result looks like a broken diagram and makes actual relations harder to read.

On every view recalculation, build a set of visible IDs and render a line only when both endpoints are visible. Do not remove the relation from data—it is merely invisible in this context.

Add regression tests for filtering by status, tag, and priority. Keep the issue open until filtering behaves the same after a timeline-range change and a manual view refresh.

## N12 — Task

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Dodać dostępność klawiaturową do osi czasu |
| Title EN | Add keyboard accessibility to the timeline |
| Początek / Start | 2026-09-24 |
| Koniec / Due | 2026-09-27 |
| Status | todo |
| Priorytet / Priority | high |
| Tagi / Tags | `notible-1-0`, `accessibility`, `gantt` |
| Zależność / Dependency | N10 (finish-to-start) |

**Treść PL:** Użytkownik poruszający się klawiaturą musi móc przejść przez wiersz pracy, odpowiadający mu pasek oraz akcje tworzenia i usuwania zależności. Kolejność fokusu ma odpowiadać kolejności wizualnej i nie może skakać poza aktualny kontekst.

Każdy pasek otrzymuje etykietę zawierającą tytuł, zakres dat, status, priorytet oraz informację o blokadzie. Jeśli pozycja jest ukryta przez filtr, nie może pozostać osiągalna przez fokus.

Przetestuj obsługę Tab, Shift+Tab, Enter, Spacji i Escape z czytnikiem ekranu. Wynik ma zostać dołączony do kontroli jakości wydania, aby dostępność była warunkiem ukończenia, a nie późniejszym dodatkiem.

**Body EN:** A keyboard user must be able to move through a work row, its corresponding bar, and the actions for creating and removing dependencies. Focus order must match visual order and never jump outside the current context.

Each bar receives a label containing title, date range, status, priority, and blocker information. If an item is hidden by a filter, it must not remain reachable by focus.

Test Tab, Shift+Tab, Enter, Space, and Escape with a screen reader. Attach the result to release QA so accessibility is an exit condition, not a later add-on.

## N13 — Task

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Napisać testy jednostkowe grafu zależności |
| Title EN | Write dependency-graph unit tests |
| Początek / Start | 2026-09-25 |
| Koniec / Due | 2026-09-28 |
| Status | todo |
| Priorytet / Priority | high |
| Tagi / Tags | `notible-1-0`, `testing`, `dependencies` |
| Zależność / Dependency | N08 (finish-to-start) |

**Treść PL:** Przygotuj mały, czytelny zestaw przypadków dla wszystkich typów zależności: finish-to-start, start-to-start, finish-to-finish i blocks. Każdy przypadek powinien weryfikować kierunek relacji, opis dla użytkownika i wynik w grafie.

Dodaj testy dla odwróconej kolejności zapisu, duplikatu relacji, samoodniesienia i odrzucania cyklu złożonego z trzech elementów. Testy nie powinny zależeć od pikselowej implementacji interfejsu, tylko od stabilnego modelu grafu.

Uwzględnij regresję nieaktualnych linii po filtrach jako test integracyjny warstwy widoku. Pakiet testów ma być szybki na tyle, by uruchamiano go przy każdej zmianie zależności.

**Body EN:** Prepare a small, readable case set for every dependency type: finish-to-start, start-to-start, finish-to-finish, and blocks. Each case should verify relation direction, user-facing text, and graph output.

Add tests for reversed storage order, duplicate relations, self-reference, and rejection of a three-item cycle. Tests should depend on the stable graph model rather than pixel-level interface implementation.

Include the stale-filter-line regression as a view-layer integration test. The suite must be fast enough to run on every dependency change.

## N14 — Task

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Przeprowadzić testy użyteczności planowania |
| Title EN | Run planning usability testing |
| Początek / Start | 2026-09-28 |
| Koniec / Due | 2026-10-01 |
| Status | todo |
| Priorytet / Priority | medium |
| Tagi / Tags | `notible-1-0`, `research`, `ux` |
| Zależność / Dependency | N09 (finish-to-start), N12 (finish-to-start) |

**Treść PL:** Zaproś pięć osób o różnych rolach: osobę zarządzającą projektem, projektantkę, inżyniera, osobę z operacji oraz osobę, która sporadycznie odbiera status. Daj im wspólny fikcyjny projekt, ale różne zadania do wykonania.

Scenariusz obejmuje utworzenie zadania, zmianę terminu, dodanie blokady i odnalezienie pracy zagrożonej opóźnieniem. Obserwuj momenty zawahania, błędne rozumienie strzałek oraz reakcje na filtr i komunikat o cyklu.

Zapisz bariery, cytaty i rekomendacje z priorytetem. Materiał powinien rozstrzygnąć, które poprawki są konieczne przed wydaniem, a które mogą wejść do pierwszego wydania utrzymaniowego.

**Body EN:** Invite five people with different roles: a project manager, designer, engineer, operations person, and occasional status reader. Give them one shared fictional project but different tasks to complete.

The scenario covers creating a task, changing a date, adding a blocker, and finding work at risk of delay. Observe hesitation, misunderstanding of arrows, and reactions to filtering and the cycle message.

Record barriers, quotes, and prioritized recommendations. The material should decide which fixes are necessary before release and which can enter the first maintenance release.

## N15 — Issue

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Pasek Gantta nachodzi na etykietę przy krótkim terminie |
| Title EN | Gantt bar overlaps its label on short durations |
| Początek / Start | 2026-09-29 |
| Koniec / Due | 2026-10-02 |
| Status | open |
| Priorytet / Priority | medium |
| Tagi / Tags | `notible-1-0`, `bug`, `responsive` |
| Zależność / Dependency | N05 (finish-to-start) |

**Treść PL:** Dla zadań jednodniowych i dwudniowych tekst etykiety nachodzi na pasek na węższym ekranie. Problem jest szczególnie widoczny przy dużym powiększeniu osi, gdy użytkownik najbardziej potrzebuje precyzji.

Przygotuj regułę wyboru wariantu: krótki tytuł może pojawić się w pasku, dłuższy przechodzi obok niego, a w skrajnym przypadku pozostaje czytelny w zamrożonej kolumnie listy. Nie skracaj nazw w sposób, który usuwa ich rozróżniającą część.

Sprawdź rozwiązanie dla nazw polskich i angielskich oraz przy powiększeniu interfejsu do 200%. Zgłoszenie można zamknąć, gdy żadna etykieta nie zasłania wskaźnika terminu ani kontroli zależności.

**Body EN:** For one- and two-day tasks, the label overlaps the bar on narrow screens. The problem is especially visible at high timeline zoom, when the user most needs precision.

Prepare a variant-selection rule: a short title may appear inside the bar, a longer one moves beside it, and in the extreme case it remains readable in the sticky list column. Do not truncate names in a way that removes their distinguishing part.

Check the solution for Polish and English names and at 200% interface zoom. Close the issue when no label obscures a due-date indicator or dependency control.

## N16 — Task

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Poprawić responsywność widoku Gantta |
| Title EN | Improve Gantt view responsiveness |
| Początek / Start | 2026-10-02 |
| Koniec / Due | 2026-10-05 |
| Status | todo |
| Priorytet / Priority | high |
| Tagi / Tags | `notible-1-0`, `responsive`, `frontend` |
| Zależność / Dependency | N15 (finish-to-start) |

**Treść PL:** Dopracuj widok dla małej szerokości bez redukowania go do nieczytelnej miniatury. Osoba pracująca na laptopie lub tablecie powinna nadal rozpoznać element, jego termin i blokadę.

Uporządkuj poziome przewijanie, zamrożoną kolumnę nazw oraz zachowanie etykiet na węższym ekranie. Stan przewinięcia ma być przewidywalny, a nagłówek skali czasu nie może odjeżdżać względem pasków.

Nie ukrywaj statusu ani informacji o blokadzie tylko dlatego, że brakuje miejsca. Zamiast tego zastosuj zwarte oznaczenia z pełnym opisem dostępnym po fokusie lub otwarciu szczegółów.

**Body EN:** Refine the small-width experience without reducing it to an unreadable miniature. A person working on a laptop or tablet should still recognize an item, its due date, and its blocker.

Improve horizontal scrolling, the sticky name column, and label behavior on narrow screens. Scroll state must be predictable, and the time-scale header must not drift relative to bars.

Do not hide status or blocker information merely because space is limited. Instead, use compact indicators with a full description available on focus or in details.

## N17 — Task

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Przygotować dokumentację funkcji planowania |
| Title EN | Prepare planning-feature documentation |
| Początek / Start | 2026-10-01 |
| Koniec / Due | 2026-10-06 |
| Status | todo |
| Priorytet / Priority | medium |
| Tagi / Tags | `notible-1-0`, `docs`, `planning` |
| Zależność / Dependency | N10 (finish-to-start) |

**Treść PL:** Napisz dokumentację dla osoby, która po raz pierwszy porządkuje projekt w Notible. Zacznij od konfiguracji dat i prostego przykładu: makieta, implementacja, test płatności.

Opisz wszystkie typy zależności, znaczenie blokady, filtry i ograniczenia wykresu. Pokaż nie tylko gdzie kliknąć, ale też kiedy wybrać relację finish-to-start, a kiedy zwykłe powiązanie informacyjne.

Dodaj sekcję rozwiązywania problemów: brak paska, data poza zakresem, niewidoczna linia po filtrze i komunikat o cyklu. Materiał ma być zrozumiały po polsku i angielsku, a przykłady muszą używać tych samych nazw co interfejs.

**Body EN:** Write documentation for a person organizing a project in Notible for the first time. Start with date setup and a simple example: wireframe, implementation, payment test.

Explain every dependency type, blocker meaning, filters, and chart limitations. Show not only where to click, but also when to choose finish-to-start versus an ordinary informational relation.

Add troubleshooting for a missing bar, a date outside the range, a line hidden by a filter, and a cycle message. The material must be understandable in Polish and English, with examples using the same names as the interface.

## N18 — Task

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Wykonać pełną kontrolę jakości wydania |
| Title EN | Run full release quality assurance |
| Początek / Start | 2026-10-06 |
| Koniec / Due | 2026-10-09 |
| Status | todo |
| Priorytet / Priority | urgent |
| Tagi / Tags | `notible-1-0`, `qa`, `release` |
| Zależność / Dependency | N11 (finish-to-start), N13 (finish-to-start), N14 (finish-to-start), N16 (finish-to-start), N17 (finish-to-start) |

**Treść PL:** Wykonaj pełną kontrolę jakości na wersji kandydującej do wydania, używając projektu testowego z datami, tagami, różnymi statusami i zależnościami. Przejdź scenariusze podstawowe od utworzenia zadania do publikacji widoku.

Sprawdź regresję grafu zależności, dostępność klawiaturową, mały ekran, filtrację oraz eksport. Każdy znaleziony problem zapisz jako Issue z reprodukcją, oczekiwanym wynikiem i oceną wpływu na wydanie.

Kryterium zakończenia jest jednoznaczne: brak otwartych błędów krytycznych lub wysokich, a wszystkie elementy pilne mają udokumentowany wynik testu. Dopiero wtedy Release może zmienić status na `ready`.

**Body EN:** Run full quality assurance on the release candidate using a test project with dates, tags, varied statuses, and dependencies. Walk through core scenarios from task creation to view publication.

Check dependency-graph regression, keyboard accessibility, narrow screens, filtering, and export. Record every finding as an Issue with reproduction steps, expected result, and release impact.

The exit criterion is explicit: no open critical or high-severity defects, and every urgent item has a documented test result. Only then may the Release move to `ready`.

## N19 — Task

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Przygotować notatki do wydania i komunikację |
| Title EN | Prepare release notes and announcement |
| Początek / Start | 2026-10-08 |
| Koniec / Due | 2026-10-10 |
| Status | todo |
| Priorytet / Priority | medium |
| Tagi / Tags | `notible-1-0`, `release`, `communication` |
| Zależność / Dependency | N17 (finish-to-start), N18 (finish-to-start) |

**Treść PL:** Przygotuj komunikację, która wyjaśnia wartość wydania bez obiecywania automatycznego zarządzania całym projektem. Najważniejszy przekaz: Notible pomaga zobaczyć kolejność, terminy i przeszkody w jednej przestrzeni pracy.

Notatki do wydania powinny wymienić planowanie, wykres Gantta, zależności, filtry i usprawnienia dostępności. Użyj krótkich przykładów korzyści zamiast listy wewnętrznych nazw technicznych.

Wyraźnie wskaż ograniczenia znane w dniu wydania, sposób zgłaszania opinii oraz następny krok dla obecnych użytkowników. Finalna treść musi przejść korektę produktu i QA przed publikacją.

**Body EN:** Prepare communication that explains release value without promising automatic management of an entire project. The key message is that Notible helps people see order, dates, and obstacles in one workspace.

Release notes should mention planning, the Gantt chart, dependencies, filters, and accessibility improvements. Use short benefit examples rather than a list of internal technical names.

Clearly state limitations known on release day, how to submit feedback, and the next step for existing users. Final copy must pass product and QA review before publication.

## N20 — Release

| Pole / Field | Wartość / Value |
|---|---|
| Tytuł PL | Notible 1.0 — Planowanie projektów i Gantt |
| Title EN | Notible 1.0 — Project Planning & Gantt |
| Wersja / Version | 1.0.0 |
| Początek / Start | 2026-09-01 *(pole niestandardowe, opcjonalne)* |
| Koniec / Target date | 2026-10-13 |
| Status | planned |
| Priorytet / Priority | urgent *(pole niestandardowe, opcjonalne)* |
| Tagi / Tags | `notible-1-0`, `release`, `gantt` *(pole niestandardowe, opcjonalne)* |
| Zależność / Dependency | N18 (finish-to-start), N19 (finish-to-start) |

**Treść PL:** Wydanie 1.0 dostarcza pełny przepływ planowania: terminy, widok Gantta, filtry, zależności i czytelne blokady. Jest to pierwszy moment, w którym Notible pozwala zespołowi nie tylko zapisywać pracę, lecz także rozumieć jej kolejność.

Zakres wydania obejmuje funkcje opisane w kartach N01–N19 oraz ich udokumentowane kryteria jakości. Wydanie jest gotowe do zmiany statusu na `ready` po zamknięciu kontroli jakości i zatwierdzeniu komunikacji.

Po publikacji ustaw status `released`, dołącz link do notatek wydania i zbierz pierwsze opinie użytkowników. Kolejne usprawnienia, takie jak automatyczne przesuwanie terminów, powinny trafić do osobnego projektu, aby nie zacierać granic wersji 1.0.

**Body EN:** Version 1.0 delivers the complete planning flow: dates, Gantt view, filters, dependencies, and clear blockers. It is the first moment when Notible lets a team not only record work but also understand its order.

The release scope includes the capabilities described in cards N01–N19 and their documented quality criteria. The release is ready to move to `ready` once QA is closed and communication is approved.

After publication, set the status to `released`, attach a link to the release notes, and collect early user feedback. Later improvements, such as automatic date shifting, should go into a separate project so the boundaries of version 1.0 remain clear.

## Szybka mapa zależności / quick dependency map

`N01 → N02 → N03 → {N04, N05}`  
`N04 → N06; {N05, N06} → N07; N08 blocks N07`  
`N07 → N09; N08 → {N10, N13}; N09 → {N11, N14}; N10 → {N12, N17}; N05 → N15 → N16`  
`{N11, N13, N14, N16, N17} → N18; {N17, N18} → N19; {N18, N19} → N20`
