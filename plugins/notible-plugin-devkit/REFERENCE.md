# Notible Plugin API — pełna dokumentacja

Dotyczy `apiVersion` **1.2** — kontrakt jest zamrożony na 1.x. Kontrakt źródłowy:
`packages/plugin-api/src/index.ts`.

Wszystko poniżej jest publiczne i **stabilne w obrębie 1.x**: dokładanie
rzeczy to wersja minor i nikogo nie łamie, usunięcie publicznego tokenu,
slotu, zdarzenia lub metody wymaga major. Host sprawdza teraz wersję przy
ładowaniu — plugin deklarujący nowszy minor niż oferowany zostanie odrzucony
z czytelnym komunikatem, zamiast ładować się i zawodzić w losowym miejscu.
Paczki napisane przed zamrożeniem (`apiVersion: "0.1"`) ładują się nadal. Cokolwiek nie jest
tu opisane — nazwy klas CSS Core, wewnętrzne komendy Tauri, struktura DOM —
jest prywatne i może zniknąć w dowolnym wydaniu.

- [Kształt pluginu](#kształt-pluginu)
- [Manifest](#manifest)
- [Uprawnienia](#uprawnienia)
- [PluginContext](#plugincontext)
- [Dane](#dane)
- [Komendy](#komendy)
- [Interfejs: widoki i sloty](#interfejs-widoki-i-sloty)
- [Nakładki: powiadomienia, modale, menu](#nakładki)
- [Edytor](#edytor)
- [Ustawienia](#ustawienia)
- [Zdarzenia](#zdarzenia)
- [Storage](#storage)
- [Cykl życia i sprzątanie](#cykl-życia-i-sprzątanie)
- [Czego jeszcze nie ma](#czego-jeszcze-nie-ma)

---

## Kształt pluginu

```ts
interface NotiblePlugin {
  manifest: PluginManifest;
  onload(context: PluginContext): void | Promise<void>;
  onunload?(): void | Promise<void>;
}
```

Moduł wejściowy eksportuje to jako `default` **albo** jako nazwany eksport
`plugin`. Obie formy są akceptowane.

`onload` może być asynchroniczne — Notible czeka na jego zakończenie. Jeśli
rzuci wyjątek, **cały plugin się nie włącza**, a rejestracje wykonane przed
wyjątkiem są wycofywane.

---

## Manifest

```ts
interface PluginManifest {
  id: string;            // wymagane, niezmienne
  name: string;          // wymagane
  version: string;       // wymagane
  apiVersion: string;    // wymagane, dziś "1.2"
  description?: string;
  author?: string;
  entry?: string;        // ścieżka do modułu; brak = paczka bez kodu
  styles?: string[];     // arkusze CSS, wstrzykiwane przez Core
  dependencies?: Record<string, string>;
  minCoreVersion?: string;
  maxCoreVersion?: string | null;
  channel?: "stable" | "beta" | "nightly";
  permissions?: PluginPermission[];
  sync?: "none" | "settings" | "data";
}
```

**`id`** musi pasować do `^[a-z0-9]+(?:[-.][a-z0-9]+)*$`. Uwaga: `acme.focus`,
`acme-focus` i `acme.focuss` to trzy różne, legalne identyfikatory — nikt ich
nie rezerwuje, więc wybierz prefiks, który realnie należy do Ciebie.

**`dependencies`** — mapa `id → wersja`. Notible odmówi włączenia pluginu,
zanim jego zależności nie będą włączone, i odmówi wyłączenia zależności, od
której coś zależy.

**`entry`** rozstrzyga o klasie paczki: z `entry` to paczka z kodem
(ostrzeżenie przy instalacji), bez — motyw, czyli sam CSS, instalowany bez
ostrzeżenia. Manifest musi deklarować przynajmniej jedno z dwojga.

---

## Uprawnienia

```ts
type PluginPermission =
  | "data.read"        // odczyt obiektów i relacji
  | "data.write"       // tworzenie, zmiana, przenoszenie, kosz
  | "relations.write"  // tworzenie i usuwanie relacji
  | "workspace.ui"     // jakiekolwiek rysowanie: widoki, sloty, nakładki
  | "editor.extension" // renderery bloków kodu w edytorze
  | "data.sync"        // dziennik zmian: replikacja workspace'u (nowe w 1.2)
  | "network";         // zarezerwowane, brak API
```

Zasady:

- Rejestracja **komendy** nie wymaga żadnego uprawnienia.
- Rejestracja widoku, slotu lub ustawień — oraz każda nakładka — wymaga
  **`workspace.ui`**.
- Renderer bloku kodu wymaga **`editor.extension`**.
- Każde wywołanie `context.data.*` sprawdza odpowiednie uprawnienie i rzuca
  `lacks permission …`, jeśli go nie zadeklarowałeś.

**Usunięte w 1.0:** `filesystem.read`, `filesystem.write`, `files.private`,
`files.granted`. Nie stało za nimi żadne API, a ekran instalacji pokazywał je
użytkownikowi jako przyznawany dostęp. Paczka, która je nadal deklaruje,
załaduje się (wartość jest ignorowana), ale nie używaj ich — API plików wróci
z własnymi nazwami, gdy będzie istniało.

---

## PluginContext

To jedyny obiekt, jaki dostajesz, i jedyne, czego potrzebujesz.

```ts
interface PluginContext {
  readonly manifest: PluginManifest;
  readonly permissions: PluginPermissions;
  readonly data: DataApi;
  readonly commands: { register(command: CommandRegistration): Disposable };
  readonly views: { register(view: ViewRegistration): Disposable };
  readonly settings: { register(section: SettingsRegistration): Disposable };
  readonly ui: { registerSlot(slot: string, registration: SlotRegistration): Disposable } & UiApi;
  readonly editor: EditorApi;
  readonly events: PluginEvents;
  readonly storage: PluginStorage;
}
```

```ts
interface PluginPermissions {
  has(permission: PluginPermission): boolean;
  require(permission: PluginPermission): void; // rzuca, jeśli brak
}
```

Każda metoda `register*` zwraca `Disposable` — możesz cofnąć rejestrację
wcześniej, ale nie musisz: Notible sprząta wszystko przy wyłączeniu pluginu.

---

## Dane

Notible nie przechowuje notatek jako plików. Wszystko jest **obiektem** w
bazie: notatka, folder, projekt, zadanie, wpis finansowy. Obiekty mają typ,
rodzica i dowolne właściwości.

```ts
interface PluginObject {
  id: string;
  type: string;          // "note", "project", "task", własne…
  title: string;
  content: string;       // dokument w JSON; linie markdownu w blokach
  props: string;         // JSON z właściwościami, jako tekst
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  trashed_at: number | null;
  parent_id?: string | null;
}
```

`content` i `props` są **tekstem zawierającym JSON**, nie obiektami. Sam je
parsuj i serializuj.

### Obiekty

```ts
context.data.objects.get(id): Promise<PluginObject | null>
context.data.objects.create(input): Promise<PluginObject>
context.data.objects.update(id, patch, expectedUpdatedAt?): Promise<PluginObject>
context.data.objects.move(id, parentId | null): Promise<PluginObject>
context.data.objects.trash(id): Promise<PluginObject | null>
context.data.objects.query(query?): Promise<PluginObject[]>
```

```ts
interface PluginObjectInput  { type: string; title: string; content?: string; props?: string; parentId?: string }
interface PluginObjectPatch  { title?: string; content?: string; props?: string }
interface PluginObjectQuery  { parentId?: string; type?: string; tag?: string; includeArchived?: boolean; limit?: number }
```

**`expectedUpdatedAt`** to kontrola współbieżności. Podaj `updated_at`
odczytanego obiektu; jeśli ktoś zmienił go w międzyczasie, zapis zostanie
odrzucony zamiast po cichu nadpisać cudzą zmianę. Pomiń, jeśli świadomie
chcesz nadpisać.

```js
const note = await context.data.objects.get(id);
await context.data.objects.update(id, { title: "Nowy" }, note.updated_at);
```

### Relacje

```ts
context.data.relations.list(objectId): Promise<PluginRelation[]>
context.data.relations.create(fromId, toId, kind): Promise<PluginRelation>
context.data.relations.delete(fromId, toId, kind): Promise<boolean>
```

`kind` to dowolny Twój string — nazwij go tak, by nie kolidował z cudzym
(`acme.blocks`, nie `blocks`).

### Typy

Typ to definicja własnego rodzaju obiektu: nazwa, schemat pól, ikona, kolor.

```ts
context.data.types.list(): Promise<PluginType[]>
context.data.types.upsert(name, schema, icon?, color?): Promise<PluginType>
```

`schema` to JSON jako tekst, w formacie `{"fields":{...}}`. `upsert` **scala**
z istniejącą definicją, więc dwukrotne uruchomienie nie niszczy pól dodanych
przez kogoś innego.

### Indeks treści

Notatki trzymają treść jako dokument, a składnia markdown żyje w środku. Core
czyta z niej to, co ma strukturę — **nagłówki, tagi, linki wiki i zadania** — i
udostępnia jako zapytanie. To jest podstawa pluginów typu „pokaż mi wszystkie
niezrobione zadania" albo „gdzie występuje ten tag".

```ts
interface ContentIndexEntry {
  object_id: string;
  kind: "heading" | "tag" | "link" | "task";
  value: string;
  level: number | null;    // głębokość nagłówka 1–6, inaczej null
  checked: boolean | null; // czy zadanie odhaczone, inaczej null
  line: number;            // numer linii, liczony od zera
}

context.data.index.query(query?): Promise<ContentIndexEntry[]>
context.data.index.forObject(objectId): Promise<ContentIndexEntry[]>
```

```ts
interface ContentIndexQuery {
  kind?: "heading" | "tag" | "link" | "task";
  value?: string;      // dopasowanie dokładne, bez rozróżniania wielkości liter
  objectId?: string;
  limit?: number;      // domyślnie 500, maksymalnie 5000
}
```

```js
// Wszystkie niezrobione zadania w przestrzeni roboczej.
const zadania = await context.data.index.query({ kind: "task", limit: 1000 });
const otwarte = zadania.filter((z) => !z.checked);

// W ilu notatkach występuje #projekt?
const trafienia = await context.data.index.query({ kind: "tag", value: "projekt" });
const notatki = new Set(trafienia.map((t) => t.object_id));
```

Co jest rozpoznawane:

| Rodzaj | Składnia |
|---|---|
| `heading` | `#` do `######` na początku linii, spacja po znakach |
| `task` | `- [ ] treść` lub `- [x] treść` (także z `*`) |
| `link` | `[[cel]]`, `[[cel\|etykieta]]`, `[[cel#sekcja]]` — zapisany jest sam cel |
| `tag` | `#słowo` niebędące nagłówkiem; dozwolone `-`, `_`, `/` |

Dwie rzeczy warte wiedzy:

- **Indeks liczony jest na żądanie**, przez odczyt treści obiektów, a nie
  trzymany w tabeli. Nie może więc być nieaktualny — również dla zmian
  przychodzących z synchronizacji, które nigdy nie przechodzą przez interfejs.
  Ceną jest przeglądanie notatek przy zapytaniu.
- Wynik jest **ograniczony**: maksymalnie 2000 wpisów na notatkę i 200 znaków
  na wartość. Jedna złośliwa notatka nie może zawiesić aplikacji.

Wymaga `data.read`.

### Projekcja dokumentu

```ts
context.data.document.get(objectId): Promise<DocumentBlock[]>
```

Uporządkowana lista bloków jednej notatki — to, czego potrzebuje spis treści,
outline albo eksport. Indeks treści odpowiada na pytanie „gdzie w przestrzeni
roboczej występuje ten tag", projekcja na „co jest w tej notatce, po kolei".

```ts
interface DocumentBlock {
  kind: "paragraph" | "heading" | "code" | "quote" | "list" | "task" | "image" | "divider";
  text: string;            // bez znacznika Markdown
  level: number | null;    // głębokość nagłówka 1-6
  language: string | null; // język bloku kodu
  checked: boolean | null; // stan zadania
  line: number;            // indeks bloku, zgodny z `line` w indeksie treści
}
```

Dwie rzeczy, które warto wiedzieć:

- **Liczona na żądanie**, jak indeks treści, więc nie może być nieaktualna.
- **Tylko do odczytu, świadomie.** Zapis wymagałby wiernej konwersji odwrotnej,
  a konwersja dokumentu w Core jest w tę stronę stratna — API zapisu zbudowane
  na niej po cichu przepisywałoby notatki. Zmieniaj notatkę przez
  `objects.update` zwykłym Markdownem.

Wymaga `data.read`.

### Źródła danych

```ts
context.data.dataSources.list(): Promise<PluginDataSource[]>
context.data.dataSources.upsert(name, definition, id?): Promise<PluginDataSource>
context.data.dataSources.delete(id): Promise<boolean>
```

### Dziennik zmian — replikacja (nowe w 1.2)

Wymaga uprawnienia **`data.sync`**. To osobne drzwi niż `objects.query` i
jedyne, którymi wolno budować synchronizację.

```ts
context.data.sync.export(): Promise<SyncSnapshot>
context.data.sync.apply(request: SyncApplyRequest): Promise<SyncApplyResult>
context.data.sync.markOutboxAttempts(operationIds: string[]): Promise<void>
```

`objects.query` jest do czytania wycinka workspace'u i do replikacji się nie
nadaje na cztery sposoby: tnie na 5000 wierszach bez offsetu, ukrywa obiekty
zarchiwizowane i te w koszu, wycina `props.$._projectCalendarEvents`, i
pokazuje tylko pierwszą relację `in`. Plugin, który replikuje przez nią,
wnioskuje kasowanie z nieobecności obiektu — i prędzej czy później wyrzuca
żywą notatkę do kosza na drugim urządzeniu.

`export` czyta dziennik, który Core prowadzi przy każdym zapisie: prawdziwe
tombstones, wszystkie rodzaje relacji, stabilne `deviceId`, nietknięte `props`,
bez limitu i bez filtrów. `apply` zapisuje obiekty pod ich własnymi `id` i
znacznikami czasu — czego `objects.create`/`update` świadomie nie pozwalają —
w jednej transakcji, rozstrzygając tombstone kontra zmianę po `updated_at`.

```ts
interface SyncSnapshot {
  deviceId: string;      // stabilne dla tego workspace'u na tej maszynie
  cursor: number;
  objects: PluginObject[];
  relations: SyncRelation[];
  tombstones: SyncTombstone[];
  relationTombstones: SyncRelationTombstone[];
  outbox: SyncOutboxEntry[];
}
```

`id` obiektów są globalnymi UUID-ami całego workspace'u, więc nie musisz
prowadzić własnego mapowania tożsamości. Dwa projekty o tym samym tytule,
utworzone niezależnie na dwóch urządzeniach, mają dwa różne `id` i **zostają
dwoma obiektami**. Ich scalenie to decyzja produktowa — replikacja nie robi
tego za plecami użytkownika.

Trzy rzeczy, na które uważaj:

- **Nie aplikuj zmian do notatki otwartej w edytorze.** Autozapis nadpisze je
  z bufora, który o nich nie wie. Kolejkuj do zamknięcia.
- **Filtruj własne zapisy**, jeśli reagujesz na `object.updated` — inaczej
  `apply` wywoła zdarzenie, które wywoła kolejny `apply`.
- **Waliduj cudzą migawkę przed zapisem.** `props` i `type` z obcego
  urządzenia to nieprzezroczysty JSON: parsuj do `Object.create(null)`,
  odrzucaj klucze `__proto__`, `constructor`, `prototype`, sprawdzaj `type`
  przeciw `types.list()` i nakładaj limity rozmiaru.

---

## Komendy

```ts
interface CommandRegistration {
  id: string;                  // unikalne w obrębie Twojego pluginu
  name: string;                // widoczne w palecie komend
  description?: string;
  hotkey?: string;             // np. "Mod+Shift+P" — Core to wykonuje
  creates?: CommandCreatesMeta;
  objectMenu?: CommandObjectMenuMeta;
  execute(input?: unknown): unknown | Promise<unknown>;
}
```

`Mod` to Ctrl na Windows/Linux i Cmd na macOS; modyfikatory w dowolnej
kolejności. **Core faktycznie wykonuje ten skrót.** Wygrywa pierwsza
rejestracja: skrót już zajęty przez inny plugin lub przez samą aplikację jest
ignorowany, a nie po cichu przesłaniany. Nic się nie odpala, gdy piszesz w
polu lub w notatce. Użytkownik może zmienić przypisanie albo je wyłączyć w
Ustawienia → Hotkeys; Twoja deklaracja jest wtedy tylko wartością domyślną.

**`creates`** wciąga komendę do menu „+" jako pełnoprawną akcję tworzenia,
obok „Nowa notatka":

```ts
interface CommandCreatesMeta {
  objectType: string;  // typ obiektu, który komenda tworzy
  label: string;       // etykieta w menu
  icon?: string;
}
```

**`objectMenu`** to bliźniak `creates` dla komend działających na *istniejącym*
obiekcie: wstawia pozycję do menu prawego przycisku myszy na wierszu w bocznym
panelu. `objectTypes` filtruje po typie obiektu, więc „Eksportuj do PDF" może
pojawiać się na notatce, a „Podsumuj postęp" na projekcie — bez pokazywania się
nawzajem. Pominięcie listy oznacza wszystkie typy.

```ts
interface CommandObjectMenuMeta {
  label: string;           // etykieta w menu prawokliku
  objectTypes?: string[];  // np. ["note", "task"]; brak = wszystkie wiersze
}
```

`execute` dostaje wtedy `{ objectId, objectType }`. Kolejność pozycji to
kolejność rejestracji; ikonę i miejsce w menu ustala Core. Po zakończeniu
komendy Core przeładowuje listę obiektów, więc zmiany w danych są widoczne od
razu.

Wyjątek rzucony w `execute` jest raportowany hostowi i nie wyłącza pluginu.

---

## Interfejs: widoki i sloty

### Kontrakt montowania

Wszystko, co plugin rysuje, przechodzi przez jedną funkcję:

```ts
type ViewMount = (context: ViewMountContext) => Disposable | void;

interface ViewMountContext {
  container: HTMLElement;      // element utworzony przez hosta — Twój
  plugin: PluginContext;       // ten sam kontekst co w onload
  objectId?: string;           // gdy powierzchnia dotyczy obiektu
  containerId?: string;        // gdy jest wewnątrz kontenera
  theme: { mode: "paper" | "night"; token(name: string): string };
  openObject(id: string): Promise<void>;
  notifyChanged(): void;       // powiadom hosta o zmianie danych
}
```

Host tworzy element, woła `mount` i wywołuje zwrócony `Disposable`, gdy
powierzchnia znika. **Nie zakładaj, że `mount` wywoła się raz** — panel może
zostać zdjęty i zamontowany ponownie w dowolnej chwili, więc trzymaj stan poza
nim (patrz `examples/pomodoro`).

Nie potrzebujesz Reacta ani żadnej biblioteki hosta. Możesz dołożyć własną.

### Sloty

```ts
context.ui.registerSlot(nazwa, { id, mount });
```

| Nazwa | Gdzie się pojawia |
|---|---|
| `workspace.sidebar` | pod drzewem obiektów |
| `workspace.ribbon` | pasek nad akcjami paska bocznego |
| `editor.toolbar` | rząd akcji edytora notatki |
| `editor.footer` | obok liczników słów i znaków |
| `object.properties` | pod panelem Właściwości |
| `settings.section` | osobny wpis „Plugin panels" w Ustawieniach |

Nazwa spoza tej listy jest **zgłaszana i pomijana**, ale nie wyłącza pluginu —
reszta rejestracji działa normalnie.

Kolejność między pluginami w tym samym slocie jest **nieokreślona**. Nie buduj
na niej niczego.

### Widoki

```ts
context.views.register({ id, title, mount });
```

Widok to pełnoekranowa powierzchnia dla obiektu, nie fragment. `objectId` i
`containerId` w `ViewMountContext` mówią, czego dotyczy.

### Style

Używaj tokenów hosta zamiast własnych kolorów — dzięki temu Twój panel
automatycznie działa w motywie jasnym i ciemnym:

```js
box.style.color = "var(--notible-text)";
box.style.background = "var(--notible-surface)";
box.style.borderColor = "var(--notible-border)";
```

Możesz też odczytać wartość przez `theme.token("--notible-text")` i sprawdzić
`theme.mode`.

Pełne słownictwo publiczne (API 1.x). Usunięcie któregokolwiek to zmiana
*major*:

| Grupa | Tokeny |
| --- | --- |
| Tła | `--notible-background`, `--notible-surface`, `--notible-raised`, `--notible-hover`, `--notible-active` |
| Ramki | `--notible-border`, `--notible-border-subtle` |
| Tekst | `--notible-text`, `--notible-muted`, `--notible-faint` |
| Akcent | `--notible-accent`, `--notible-accent-hover`, `--notible-on-accent`, `--notible-selected`, `--notible-selected-soft` |
| Status | `--notible-danger`, `--notible-danger-surface`, `--notible-success`, `--notible-success-surface`, `--notible-warning` |
| Kategorie | `--notible-color-blue`, `-green`, `-amber`, `-red`, `-violet` |
| Pozostałe | `--notible-scroll-thumb`, `--notible-scroll-thumb-strong`, `--notible-font-sans`, `--notible-font-serif` |

Motyw nadpisuje je w `:root` — wtedy zmienia się cały Notible, nie tylko panele
pluginów:

```css
:root { --notible-accent: #2f6f4f; --notible-surface: #f7fbf8; }
```

> `--core-*` to teraz **prywatne** aliasy hosta. Nie są kontraktem i mogą
> zniknąć bez zapowiedzi — nie używaj ich w pluginie.

### Własny arkusz stylów

Zadeklaruj pliki CSS w manifeście, a Core wstrzyknie je przy włączeniu pluginu
i usunie przy wyłączeniu:

```json
{ "styles": ["theme.css"] }
```

Zasady:

- maksymalnie **16** plików, każdy z rozszerzeniem `.css`, wewnątrz katalogu
  pluginu;
- nazwy klas namespace'uj swoim prefiksem. Plugin **nie stylizuje Core** —
  klasy `.core-*` są prywatne i zmienią się bez ostrzeżenia;
- kolejność między pluginami jest **nieokreślona**;
- ekran decyzji o zaufaniu jest **natywnym oknem systemowym**, rysowanym poza
  webview. Żaden motyw go nie dosięgnie — nie dlatego, że Core coś odpina, ale
  dlatego, że CSS tam nie sięga w ogóle.

**Paczka bez `entry`, mająca tylko `styles[]`, to motyw.** Instaluje się bez
ostrzeżenia, bo nie ma czego wykonać, a CSP tej aplikacji nie zawiera żadnego
zdalnego schematu w `img-src`, `font-src` ani `style-src` — więc CSS nie ma
gdzie wysłać tego, co widzi.

---

## Nakładki

Każda nakładka należy do Core. Plugin dostarcza treść; host odpowiada za
element, pułapkę fokusa, obsługę Escape i kolejność nakładania.

```ts
interface UiApi {
  notice(message: string, options?: { timeoutMs?: number }): Disposable;
  modal(options: { title: string; mount: ViewMount }): Disposable;
  menu(items: MenuItem[], at: { x: number; y: number }): Disposable;
  suggest<T>(items: T[], render: (item: T) => string, options?: { placeholder?: string }): Promise<T | null>;
  openObject(id: string): Promise<void>;   // 1.1
}
```

```js
context.ui.notice("Zapisano", { timeoutMs: 2000 });

const wybrany = await context.ui.suggest(
  notatki,
  (n) => n.title,
  { placeholder: "Wybierz notatkę…" },
);
if (wybrany) await context.data.objects.trash(wybrany.id);

context.ui.menu(
  [
    { id: "open", label: "Otwórz", onSelect: () => {} },
    { id: "del", label: "Usuń", separatorBefore: true, onSelect: () => {} },
  ],
  { x: event.clientX, y: event.clientY },
);
```

`suggest` zwraca `null`, gdy użytkownik zamknie okno bez wyboru.

### `openObject` — nawigacja (nowe w 1.1)

```js
const { id } = await context.data.objects.create({ type: "note", title: "2026-08-18" });
await context.ui.openObject(id);   // to samo przejście, co kliknięcie w pasku bocznym
```

Do 1.0 nawigować mógł wyłącznie zamontowany widok (`ViewMountContext.openObject`),
więc komenda pod skrótem klawiszowym potrafiła utworzyć dzisiejszą notatkę, ale
nie potrafiła jej otworzyć. `context.ui.openObject` jest dostępne wszędzie tam,
gdzie masz `context` — w komendzie, w obsłudze zdarzenia, w panelu ustawień.
Wymaga uprawnienia `workspace.ui`, bo zmienia to, co użytkownik ma na ekranie.
Nieznane id nic nie robi. Wewnątrz `mount()` obie drogi są równoważne.

**Nie rysuj własnych nakładek na `document.body`.** Nie tylko dlatego, że
wyjdą inaczej niż reszta aplikacji — ekrany decyzji o zaufaniu muszą być
nieodróżnialne od prawdziwych, a własne overlaye to dokładnie ten problem.

Wszystkie cztery metody wymagają `workspace.ui`.

---

## Ustawienia

Ustawienia **deklarujesz**, a Notible je rysuje.

```ts
context.settings.register({ id, title, schema });
```

```ts
interface SettingsSchema {
  sections: Array<{ title?: string; description?: string; fields: SettingsField[] }>;
}

type SettingsField =
  | { kind: "text";   key; label; description?; default?: string; placeholder?: string }
  | { kind: "number"; key; label; description?; default?: number; min?; max?; step? }
  | { kind: "toggle"; key; label; description?; default?: boolean }
  | { kind: "select"; key; label; description?; default?: string; options: Array<{ value: string; label: string }> }
  | { kind: "folder"; key; label; description? }   // zapisuje ścieżkę katalogu, NIE id obiektu
  | { kind: "hotkey"; key; label; description?; commandId: string };
```

Wartości trafiają do `context.storage` pod kluczem `key` — tam je czytasz:

```js
const minuty = context.storage.get("minutes") ?? 25;
```

Panel pojawia się w Ustawienia → **Plugin panels**.

Jeśli naprawdę potrzebujesz czegoś, czego schemat nie wyraża, podaj zamiast
niego `mount` — ale wtedy sam odpowiadasz za wygląd i dostępność.

`kind: "hotkey"` pozwala użytkownikowi nagrać nowy skrót. Wartość trafia do
ustawień Core, nie do `storage` pluginu pod `key` — plugin nie może przepisać
tego, jakie klawisze wybrał użytkownik.

---

## Zdarzenia

```ts
context.events.on(nazwa, handler): Disposable
context.events.emit(nazwa, payload): void
```

Zdarzenia emitowane przez Core:

| Zdarzenie | Payload |
|---|---|
| `object.created` | `{ id, type }` |
| `object.updated` | `{ id, type }` |
| `object.trashed` | `{ id, type }` |
| `object.opened` | `{ id, type }` |
| `workspace.changed` | `{}` |
| `theme.changed` | `{ mode: "paper" \| "night" }` |
| `app.ready` | `{}` |

To są **powiadomienia, nie haki**. Handler nie może anulować ani zmienić tego,
co się stało — dzięki temu kolejność pluginów nigdy nie staje się istotna.

Zdarzenia lecą również, gdy zmiany robi inny plugin, więc uważaj na pętle:
reagowanie na `object.updated` zapisem do tego samego obiektu jest łatwym
sposobem na nieskończoną rekurencję.

Możesz emitować własne zdarzenia — nazywaj je swoim prefiksem.

Subskrypcje są usuwane automatycznie przy wyłączeniu pluginu.

---

## Storage

```ts
interface PluginStorage {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
  keys(): string[];
}
```

Synchroniczne, prywatne dla Twojego pluginu, **przeżywa restart aplikacji**.
Wartości są serializowane do JSON, więc trzymaj tam dane, a nie funkcje czy
elementy DOM.

Dwie rzeczy warte wiedzy:

- Storage **nie znajduje się w kopii zapasowej bazy** workspace'u. Nie trzymaj
  tam niczego, czego utrata byłaby dla użytkownika bolesna — prawdziwe dane
  zapisuj jako obiekty przez `context.data`.
- Odinstalowanie pluginu **kasuje** jego storage. Wyłączenie — nie.

---

## Cykl życia i sprzątanie

```
instalacja → ostrzeżenie → onload(context) → aktywny
                                                ↓
                              wyłączenie → onunload() → nieaktywny
                                                ↓
                                        odinstalowanie → storage skasowany
```

Notible sprząta automatycznie: rejestracje komend, widoków, ustawień i slotów
oraz subskrypcje zdarzeń. **Sam musisz posprzątać** wszystko, co wykracza poza
API — `setInterval`, `setTimeout`, `addEventListener` na `window`, otwarte
połączenia:

```js
onload(context) {
  this._timer = setInterval(() => {}, 1000);
},
onunload() {
  clearInterval(this._timer);
},
```

Element `container` z `mount` jest czyszczony przez hosta, ale wszystko, co
podpiąłeś poza nim, zwróć w `Disposable`.

---

## Edytor

```ts
context.editor.registerCodeBlockRenderer(language, render): Disposable
```

Rysuj bloki kodu oznaczone danym językiem — diagramy, wykresy, cokolwiek.
Wymaga `editor.extension`.

```js
context.editor.registerCodeBlockRenderer("mermaid", ({ container, source }) => {
  container.textContent = `diagram: ${source.length} znaków`;
  return { dispose: () => container.replaceChildren() };
});
```

Kontrakt jest **celowo wąski**. Edytor Core to `CoreMarkdownEditor` —
contenteditable nad zwykłym Markdownem, a nie dokument ProseMirror. Nie ma więc
schematu węzłów ani transakcji do udostępnienia, a udawanie, że są, byłoby
obietnicą, której Core nie może dotrzymać.

Dlatego to jest bezpieczne: **oryginalny blok zostaje w dokumencie**, widoczny
i edytowalny, a Ty rysujesz pod nim, w osobnym elemencie z
`contenteditable="false"`. Serializator czyta wyłącznie ten blok źródłowy, więc
zepsuty renderer — albo odinstalowany plugin — kosztuje Cię rysunek, nigdy
notatkę. Źródło zostaje widoczne celowo: ukrycie go czyniło blok
nieedytowalnym.

Jeden renderer na język; drugi plugin zgłaszający zajęty język zostaje
odrzucony, tak samo jak przy skrótach.

## Czego jeszcze nie ma

Uczciwa lista, żebyś nie tracił czasu na szukanie:

| Obszar | Stan |
|---|---|
| Szersze rozszerzenia edytora | tylko renderery bloków kodu; nie ma schematu węzłów, bo Core nie jest ProseMirrorem |
| Zapis projekcji dokumentu | tylko odczyt; konwersja odwrotna jest stratna |
| Dostęp do plików | brak API; uprawnienia usunięte, wrócą razem z API |
| Uruchamianie zewnętrznych procesów | **świadomie poza zakresem, na stałe** |
| Wersje mobilne i webowe | poza zakresem |

Kierunek rozwoju: `2026-08-16-plugin-api-design.md` (dokument wewnętrzny, nieopublikowany).
