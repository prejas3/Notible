# Macierz migracji Core/pluginów

Data: 2026-08-08

> **2026-09-03: legacy UI usunięte** (`src/App.tsx`, `src/components/*`,
> domenowe `src/lib/*`, `tauri.legacy.conf.json`). Kolumna „Równoważność
> legacy" jest teraz oceniana względem historii git / snapshotu
> `github.com/prejas3/Notible@main`, nie działającego legacy buildu. Praca
> per-domena (część A z
> `2026-09-03-core-plugin-boundary-closure-design-CORRECTED.md` (dokument wewnętrzny, nieopublikowany))
> trwa: każdy wiersz `PARTIAL` → decyzja PASS / lukę doportować w pluginie /
> świadoma strata z podpisem.

> **2026-09-03: Część A zamknięta** — wszystkie 5 domen-dźwigni PASS (Views,
> Planning, Finance, Whiteboard, Automations) + Work Packs = 6/13 PASS.
> Rozpoczęta **Część C = etap Work Packs (composable workspace, dług D3)**,
> audyt `work_packs_audit_and_roadmap.md` Faza 1-4:
> - **C1 (Faza 1) — layouty w dowolnym kontenerze: ✅** objectTabs `notible.planning`
>   (Tasks/Timeline/Planning/Calendar/Finance), `notible.views` (Table) i
>   `notible.automations` rozszerzone z `["project"]` na `["project","folder","space"]`.
>   `project-dashboard-ui` jest container-agnostic (queruje dzieci po `containerId`).
>   Whiteboard-jako-zakładka-dowolnego-kontenera nadal D3 (wymaga miejsca na dok tablicy).
> - **C2 (Faza 2) — scalenie `bug`→`issue`: ✅** (0.78.4) `migrateBugToIssue`
>   w `work-models.ts` (fire-and-forget w `onActivate`): retype rekordów `bug`
>   przez nowe API `context.data.objects.setType` (API 1.17 / Rust
>   `set_object_type`), przepisanie `_views` `typeFilter`/query `"bug"`→`"issue"`.
>   Idempotentne, no-op gdy nic nie zostało. Pakiet Development traci typ `bug`
>   (widok „Bugs" filtruje teraz `issue`). **Residuum:** wiersz typu `bug`
>   zostaje w tabeli `types` (brak `types.delete` w API) — bez obiektów i bez
>   providera, inertny.
> - **C3 (Faza 3) — nowy pakiet „Client Work & Delivery": ✅** (0.78.4)
>   `id: "client-delivery"`, folder, widoki intake/tasks/board; Timeline +
>   Finance z zakładek kontenera C1. Miniatury `ViewMockup` = layout-true.
>   Cztery istniejące pakiety bez zmian (additive).
> - **C4 (Faza 4) — rename `canvas`→`gallery`: ✅** (0.78.4) tolerant-read,
>   BEZ przepisywania bazy — stare `_views` z `"canvas"` renderują się jako
>   siatka gallery i zapisują jako `"gallery"` przy pierwszej edycji.

> **2026-09-03: dług D1 — 4 podpisy „świadoma strata".** Po kasacji legacy UI
> (część B) w `src/` NIE MA już martwych paneli AI / Themes / Import. To, co
> „pozostaje" dla tych domen, to **kod platformowy Core, który z założenia tam
> zostaje** — nie luka pluginu:
> - **Calendar** → PASS/podpis. `calendar_oauth.rs` (broker OAuth) +
>   `src/core/data/calendar-api.ts` (most Core-internal) to platforma, ta sama
>   klasa co `context.oauth`. Plugin `notible.calendar` jest właścicielem UI
>   konfiguracji projektu. Wtyczka NIE może trzymać sekretów OAuth ani pętli
>   loopback per-provider.
> - **AI** → PASS/podpis. Cała domena = lokalna heurystyka rankingu w pluginie;
>   brak in-app LLM z założenia ([[notible-ai-architecture]] — provider przez
>   zewnętrzny klient MCP). Nie ma czego migrować.
> - **Import/Export** → PASS/podpis. Plugin robi transfer JSON; `coreTransfer.ts`
>   + Rust `backup`/`restore` to funkcja bezpieczeństwa Core — odtworzenie
>   całego workspace nie może być pluginem (zaufanie).
> - **Themes** → PASS/podpis. Aplikacja tokenów `--notible-*` na `:root` jest
>   Core z założenia ([[notible-token-migration-plan]] — „klasa motywu należy do
>   `:root`, nie `.core-shell`"). Plugin wybiera manifest.
>
> **2026-09-03 (druga runda podpisów): Search + Editor extensions też PASS/podpis.**
> - **Search** → wyszukiwarka i backlinki to funkcja powłoki Core (`CoreOnlyApp`):
>   FTS5 `objects_fts`/`search_objects`, panel Backlinks (`coreBacklinks.ts`),
>   autouzupełnianie `[[…]]`. `notible.search` to dodatkowy panel, nie cel
>   równoważności. Graph = osobny plugin.
> - **Editor extensions** → `CoreMarkdownEditor` = contenteditable nad markdownem,
>   nie ProseMirror. Kontrakt `EditorApi` celowo minimalny (`registerCodeBlockRenderer`
>   + `registerProseProfile`); D15 „rich editor extensions" wycofane w specu API 1.0.
>
> **2026-09-03 (trzecia runda): Work Models też PASS/podpis.** „UI dokumentu/
> properties" = powłoka Core (`CoreMarkdownEditor`) + `notible.properties`
> (foundational plugin, `propertiesSlot` w `UnifiedTestHostMain`, domyślnie ON,
> `PropertiesEditor` sterowany schematem) + `notible.work-models` (schematy +
> `create-*`). Wszystko shipuje. Nota „brak równoważności" mierzyła względem
> usuniętego bespoke edytora `src/components`.
>
> **MACIERZ: 13/13 PASS.** D3-residuum (Whiteboard jako zakładka kontenera)
> ZROBIONE w 0.78.5 — `notible.whiteboard` drugi `objectTabs` +
> `ensureContainerBoard` (dedykowana tablica-dziecko). **Granica Core/plugin
> domknięta, brak otwartych punktów.**

Zasada: zielony test kontraktu pluginu nie jest automatycznie zgodą na usunięcie
legacy UI. Legacy można usunąć dopiero po teście równoważności i decyzji
migracyjnej zapisanej w tej macierzy.

| Funkcja | Plugin / publiczna operacja | Test osobno/pakiet | Równoważność legacy | Decyzja teraz |
|---|---|---|---|---|
| Work Packs | `notible.work-packs` (usunięty) | — | — | **Usunięte w 0.78.7** — zwinięte w moduły kontenera (`props._modules` + `ContainerModulePicker`). Plugin, jego UI, spakowana kopia, katalog, ekran Settings i test równoważności skasowane. Residuum (`props._workPack` / `_views` / dzieci o własnych typach / skopiowane reguły `pack:*`) zostawione jako nieszkodliwe. Wiersz zachowany dla historii. Zob. `2026-09-03-container-modules-design.md` (dokument wewnętrzny, nieopublikowany). |
| Work Models | `notible.work-models`; 6 modeli, instalacja i tworzenie rekordów przez `DataApi` | `test:work-models-plugin`, `test:domain-plugin-surfaces` | **PASS / świadoma strata** (2026-09-03) — „UI dokumentu/properties" w shipowanej apce składa się z trzech warstw, wszystkie shipują: (1) **treść** = `CoreMarkdownEditor` (powłoka Core, platforma); (2) **panel properties** = `notible.properties` (foundational plugin, `extraViews:"panel"` → `PropertiesEditor` sterowany schematem typu: status/priority/assignee/daty/każde pole) wpięty przez `CoreOnlyApp` `propertiesSlot` → `CorePluginPropertiesPanel` → `UnifiedTestHostMain`, domyślnie ON; (3) **schematy** = `notible.work-models` instaluje task/issue/project/milestone/cycle/release na aktywacji (idempotentnie, `mergeSchema`, z polem `deps`), a `create-*` komendy trafiają do „+" menu przez `creates`. Zarządzanie rekordami na poziomie kontenera = zakładki Planning/Views/Finance. Nota „brak równoważności" była z 2026-08-08, mierzona względem **usuniętego** (część B) bespoke edytora `src/components` — nie ma czego migrować. Migracje DB (`src-tauri`) zostają w Ruście niezależnie. | domena domknięta — residuum to powłoka Core + foundational plugin `notible.properties` (wpięty przez publiczną rejestrację widoku + slot) |
| Views | `notible.views`; persystencja `_views`, layouty, typ-filter, source scope, plugin-owned query builder, CRUD rekordów i inline status/priority przez publiczny `DataApi` | `test:plugin-views`, `test:views-parity`, `test:domain-plugin-surfaces` | **PASS** (2026-09-03) — tabela sort / resizable szerokości / filtry per-kolumna (`@tanstack/react-table`, stan w `_views[]`); import CSV (`<input type=file>` + `parseDelimited`) + eksport CSV (`context.ui.exportFile`, API 1.15). **Świadoma strata:** wbudowany panel automatyzacji — pokrywa zakładka `notible.automations` + hook wykonania w tle (0.75.3), do zweryfikowania empirycznie (spec §7, data: `________`) | domena domknięta; spec `2026-09-03-views-parity-design.md` (dokument wewnętrzny, nieopublikowany) |
| Planning | `notible.planning`; modele, tworzenie itemów i własny panel modeli/rekordów przez publiczny `DataApi` | `test:builtin-domains`, `test:planning-plugin` (asercja edge-resize), `test:workflows` (`gantt-cascade-check`) | **PASS** (2026-09-03) — Gantt `project-dashboard-ui` `GanttChart`: paski move + **resize obu krawędzi** (start/end handle, `beginBarEdit` z `mode`), kaskada `cascadeDependents` (FS/SS/FF/SF, cykle, multi-predecessor), zależności `props.deps`, milestone/cycle/release, drag-to-connect, zoom day/week/month. Kalendarz = `CalendarMonthView` (bogatszy niż legacy). **Świadome rozbieżności:** (a) model zależności `props.deps` (nie workspace-relacje jak legacy `ganttDependencies.ts`) — bez migracji, stare relacyjne deps po prostu bez strzałek; (b) zakładka Planning grupuje po rodzaju (milestone/release/cycle), nie po statusie czasowym (current/upcoming/completed) jak legacy `cycleGroup` — przyjęte | domena domknięta; brainstorming 2026-09-03 |
| Automations | `notible.automations`; plugin-owned edycja reguł, nested conditions, actions, execution log i manual/date execution przez publiczny `DataApi` | `test:automations-plugin` (**end-to-end hook w tle**: `record_created`/`property_changed`/`relation_changed` odpalają się i aplikują akcje bez otwierania panelu), `test:builtin-domains`, `test:builtin-together` | **PASS** (2026-09-03) — plugin jest **nadzbiorem** legacy: 6 typów triggerów (record_created / property_changed / relation_changed / date_reached / recurring / manual), nested conditions, execution log, dedup przez `automationExecutionKey`, weekend policy, dayOfMonth. `automationsOnActivate` (od 0.75.3, backlog #17) wire'uje `object.created`/`object.updated`/relation events + seeduje `propsCache` przy aktywacji → reguła odpala się niezależnie od tego które UI zrobiło edycję. `manual` celowo tylko z panelu. Weryfikacja empiryczna: §7 w `RELEASE_CHECKLIST_0.78.x` (edycja status w tabeli Views → reguła `property_changed` odpala w tle). | domena domknięta — plugin bogatszy niż legacy |
| Finance | `notible.finance`; typy, wpisy i summary przez `DataApi` | `test:finance-parity` (math + CSV + XLSX), `test:planning-plugin` (asercje finance-tab), `test:builtin-domains` | **PASS** (2026-09-03) — zakładka Finance projektu równoważna: panel budżetu (`plannedBudget`/`approvedBudget`/`openingCash`/`baseCurrency`/`budgetAlertThreshold`) + alerty; `computeFinanceSummary` (forecast / burn rate / runway / variance / budget %); osobny formularz `time_entry`; tygodniowy grafik `_resourceSchedule` (osoba × tydzień); import CSV (`<input type=file>` + `parseDelimited`) + eksport CSV (`context.ui.exportFile`); eksport XLSX (`xlsxBytes` — własny store-only zip + SpreadsheetML — przez `context.ui.exportBinary`, API 1.16). **Świadoma strata:** import XLSX (import CSV pokrywa przypadek tabelaryczny; parser xlsx w JS poza zakresem) | domena domknięta; spec `2026-09-03-finance-parity-design.md` (dokument wewnętrzny, nieopublikowany) |
| Search | `notible.search`; workspace query/backlinks contract | `test:builtin-domains`, `test:domain-plugin-surfaces` | **PASS / świadoma strata** (2026-09-03) — wyszukiwarka i backlinki są **funkcją powłoki Core** i już shipują w `CoreOnlyApp`: FTS notatek (`search_objects` / `objects_fts` FTS5, filtry rodzaj/kontener/tag/data, globalny skrót), panel Backlinks w widoku notatki (`coreBacklinks.ts` `resolveBacklinks` — reguła „relacja LUB `[[wikilink]]`", ta sama co plugin), autouzupełnianie `[[…]]`, wyszukiwarka Ustawień. `notible.search` to **dodatkowy** panel (OFF domyślnie) — naiwny skan `includes()` po 5000 obiektach, świadomie słabszy. Nie ma „legacy search UI" do migracji — powłoka Core *jest* wyszukiwarką. (Graph = osobny plugin `notible.graph`, nie ten wiersz.) | domena domknięta — wyszukiwarka/backlinki to platforma powłoki Core |
| Whiteboard | `notible.whiteboard`; wersjonowany dokument przez `DataApi.objects` | `test:advanced-builtin`, `test:domain-plugin-surfaces` (asercje canvas-ui) | **PASS** (2026-09-03) — `canvas-ui.tsx` edytor równoważny + bogatszy: typy węzłów `card`/`note`/`shape`/`section`/`image`/`table`, krawędzie z elbow-routingiem, drag-to-connect, pan/zoom, resize, snapping. **Report** (tablica → markdown, eksport `.md` przez `exportFile`, „Create report note"), **Create tasks** (karty bez linku → obiekty `task` triage, węzeł staje się linkiem), **Export** dokumentu do `.json`. Plugin dodaje pan/zoom/snapping/elbow których legacy nie miał. **Świadoma rozbieżność:** obraz zapisywany jako `data:` URI inline w węźle (nie `media/<uuid>` jak desktop legacy) — tablica samowystarczalna, syncuje się z własną treścią, bez GC media | domena domknięta; brainstorming 2026-09-03 |
| Calendar | `notible.calendar`; bezpieczna metadata konfiguracji projektu | `test:advanced-builtin`, `test:domain-plugin-surfaces` | **PASS / świadoma strata** (2026-09-03) — plugin jest właścicielem UI konfiguracji projektu. `calendar_oauth.rs` (broker OAuth) + `src/core/data/calendar-api.ts` (most Core-internal) to **platforma Core**, ta sama klasa co `context.oauth` — wtyczka nie może trzymać sekretów/loopbacku per-provider. Nie luka. | domena domknięta — residuum to platforma Core |
| AI | `notible.ai`; ranking lokalnych rekordów | `test:advanced-builtin`, `test:domain-plugin-surfaces` | **PASS / świadoma strata** (2026-09-03) — cała domena = lokalna heurystyka rankingu w pluginie. Brak in-app LLM z założenia ([[notible-ai-architecture]] — provider przez zewn. klient MCP). Nie ma czego migrować. | domena domknięta |
| Editor extensions | `notible.editor-extensions`; language inspection | `test:advanced-builtin`, `test:domain-plugin-surfaces` | **PASS / świadoma strata** (2026-09-03) — „pełny EditorRegistry" nie istnieje **z założenia**. Edytor Core (`CoreMarkdownEditor`) to `contenteditable` nad markdownem, NIE ProseMirror/TipTap (`grep tiptap src/core/` = nic). Kontrakt `EditorApi` to celowo dwie metody: `registerCodeBlockRenderer` + `registerProseProfile` (API 1.12). **D15 „rich editor extensions" wycofane** w rewizji specu API 1.0 (`2026-08-16-plugin-api-design.md:551`, dokument wewnętrzny — „D15 named the wrong editor… node specs, input rules, decorations mają się do czego nie podłączyć. D15 is withdrawn."). Legacy używał tego samego `src/core/` edytora — nie ma osobnego „legacy editor". Plugin w pełni wykorzystuje kontrakt (renderer `mermaid` + panel inspekcji). | domena domknięta — edytor Core to platforma; kontrakt rozszerzeń celowo minimalny (D15) |
| Import/Export | `notible.import-export`; JSON transfer przez `DataApi` | `test:advanced-builtin`, `test:domain-plugin-surfaces` | **PASS / świadoma strata** (2026-09-03) — plugin robi transfer JSON. `coreTransfer.ts` + Rust `backup`/`restore` to **funkcja bezpieczeństwa Core** — odtworzenie całego workspace nie może być pluginem (zaufanie). Nie luka. | domena domknięta — residuum to platforma Core |
| Themes | `notible.themes`; manifest i selection w plugin storage | `test:advanced-builtin`, `test:domain-plugin-surfaces` | **PASS / świadoma strata** (2026-09-03) — plugin wybiera manifest. Aplikacja tokenów `--notible-*` na `:root` jest **Core z założenia** ([[notible-token-migration-plan]] — „klasa motywu należy do `:root`"). Nie luka. | domena domknięta — residuum to platforma Core |

## Test razem

`test:builtin-plugins` sprawdza loader, manifest, command/view/settings/slot i
cleanup każdego pluginu oraz zestawu. `test:plugin-views` dodatkowo wymaga
lazy view descriptora i sprawdza host osobno oraz razem dla wszystkich 14
pluginów. `test:builtin-together` wykonuje komendę każdego z 14 pluginów na
jednym fake `DataApi` i wyłącza cały zestaw.

## Decyzja migracyjna

- **Legacy UI usunięte w całości** (część B, 0.77.5): `src/App.tsx`,
  `src/components/*`, domenowe `src/lib/*`, `MainPanel`, `tauri.legacy.conf.json`,
  flaga `?views=plugin`. Shipowana apka = `CoreOnlyApp` + pluginy przez
  `CorePluginContainerPanel`. Nie ma już „fallbacku do legacy views".
- **Core-only:** `test:core-only` i `test:core-build` dowodzą, że minimalny Core
  nie wymaga żadnego pluginu ani normalnego `App`.
- **Stan domen (2026-09-03): 13/13 PASS.** Część A (Work Packs, Views, Planning,
  Finance, Whiteboard, Automations) + podpisy „świadoma strata" (Calendar, AI,
  Import/Export, Themes, Search, Editor extensions, Work Models — residuum to
  platforma Core / powłoki / foundational plugin, nie luka domeny).
- **D3-residuum ZROBIONE (0.78.5):** Whiteboard jako zakładka folder/projekt/
  space — `notible.whiteboard` drugi `objectTabs` + `canvas-ui` flaga
  `containerBoard` + `ensureContainerBoard` (dedykowana tablica-dziecko
  `props._containerBoard`, leniwa, bez duplikatów). Kontener zachowuje swoją
  notatkę markdown.
- **Kasacja legacy:** zakończona (część B). **Granica Core/plugin domknięta —
  13/13 PASS, brak otwartych punktów.**
