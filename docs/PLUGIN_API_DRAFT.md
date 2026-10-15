# Notible Plugin API — projekt v0

Status: **DRAFT / niestabilne**  
Ten dokument opisuje kierunek API. Nie wolno publikować pluginów produkcyjnych
przeciwko temu kontraktowi przed oznaczeniem go jako `v1`.

Pierwszy host rejestrów znajduje się w `src/core/extensions`, a dependency-free
kontrakt publiczny w `packages/plugin-api/src/index.ts`. Host ma lifecycle,
namespacing, cleanup, lokalny loader katalogu i ZIP-a, trwały rejestr SQLite,
hydrację aktywnych artefaktów oraz ekran zarządzania pluginami. Stabilność
`v1`, permissions i pełna weryfikacja podpisanych paczek pozostają kolejnymi
bramkami.

## 1. Zasada główna

Plugin korzysta z publicznego `PluginContext` z `@notible/plugin-api`. Nie
importuje komponentów z `src/components`, nie wykonuje prywatnego SQL-a i nie
zakłada struktury DOM.

```ts
export interface NotiblePlugin {
  manifest: PluginManifest;
  onload(ctx: PluginContext): void | Promise<void>;
  onunload?(): void | Promise<void>;
}
```

## 2. Manifest

```ts
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  description?: string;
  author?: string;
  entry: string;
  styles?: string[];
  dependencies?: Record<string, string>;
  permissions?: PluginPermission[];
  sync?: "none" | "settings" | "data";
}

export type PluginPermission =
  | "data.read"
  | "data.write"
  | "relations.write"
  | "workspace.ui"
  | "editor.extension"
  | "network"
  | "filesystem.read"
  | "filesystem.write";
```

Manifest musi być walidowany przed ładowaniem. `id` i `apiVersion` są
niezmienne dla danej linii kompatybilności. Uprawnienia są jawne i widoczne dla
użytkownika. Maszynowy opis obecnego, węższego manifestu developerskiego jest
w `docs/schemas/plugin-manifest-v0.schema.json`; pola takie jak `entry` i
`dependencies` pozostają częścią draftu docelowego, a nie obecnego loadera.

## 3. Plugin context

```ts
export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly app: AppApi;
  readonly data: DataApi;
  readonly events: EventApi;
  readonly commands: CommandApi;
  readonly views: ViewApi;
  readonly editor: EditorApi;
  readonly settings: SettingsApi;
  readonly ui: UiApi;
  readonly storage: PluginStorage;
  readonly i18n: I18nApi;
  readonly logger: PluginLogger;
}
```

Każdy rejestr zwraca funkcję cleanup albo jest automatycznie czyszczony przez
`onunload`. Plugin nie może pozostawić listenerów, timerów, komend ani stylów
po wyłączeniu.

`DataApi` jest filtrowane przez `manifest.permissions`: odczyt wymaga
`data.read`, zapisy `data.write`, a zapis relacji `relations.write`. Brak
uprawnienia kończy się jawnym błędem zamiast cichego dostępu.

## 4. Data API

```ts
export interface DataApi {
  objects: {
    get(id: string): Promise<NObject | null>;
    create(input: CreateObjectInput): Promise<NObject>;
    update(id: string, patch: ObjectPatch, opts?: UpdateOptions): Promise<NObject>;
    trash(id: string): Promise<NObject | null>;
    query(query: ObjectQuery): Promise<NObject[]>;
  };
  relations: {
    list(objectId: string, opts?: RelationQuery): Promise<Relation[]>;
    create(input: CreateRelationInput): Promise<Relation>;
    delete(input: DeleteRelationInput): Promise<void>;
  };
  types: {
    list(): Promise<TypeDef[]>;
    get(name: string): Promise<TypeDef | null>;
  };
}
```

Wszystkie zapisy używają wersjonowania i zwracają błąd konfliktu zamiast
cichego nadpisania. API nie przekazuje połączenia SQLite.

## 5. Events

```ts
export type NotibleEvent =
  | { type: "object.created"; object: NObject }
  | { type: "object.updated"; object: NObject; changedFields: string[] }
  | { type: "object.deleted"; objectId: string; deletedAt: number }
  | { type: "relation.created"; relation: Relation }
  | { type: "relation.deleted"; relation: Relation }
  | { type: "workspace.changed"; reason: string };

export interface EventApi {
  on<T extends NotibleEvent["type"]>(type: T, handler: EventHandler<T>): Disposable;
}
```

Eventy są dostarczane po zatwierdzeniu transakcji. Plugin nie powinien używać
eventu jako jedynego źródła prawdy — po restarcie musi móc odbudować stan z
`DataApi`.

## 6. Command API

```ts
export interface CommandApi {
  register(command: {
    id: string;
    name: string;
    description?: string;
    hotkey?: string;
    execute(args: CommandExecutionContext): unknown | Promise<unknown>;
  }): Disposable;
}
```

Identyfikator jest namespacowany przez plugin, chyba że Core jawnie dopuści
publiczne ID. Komenda może pojawić się w command palette, menu kontekstowym lub
skrótach, ale plugin nie może zakładać konkretnego układu ekranu.

## 7. Views, UI i editor

Rejestry muszą działać przez stabilne punkty rozszerzeń:

```ts
ctx.views.register({
  id: "my-view",
  title: "My view",
  render: MyView,
});

ctx.ui.registerSlot("editor.toolbar", {
  id: "my-action",
  render: MyAction,
});

ctx.editor.registerExtension({
  id: "my-node",
  extension: myTipTapExtension,
});
```

Zarejestrowany widok jest osobnym ekranem powłoki, a nie modalem, więc plugin
może do niego przejść sam:

```ts
if (!(await ctx.ui.openView("my-view"))) ctx.ui.modal({ title: "…", mount });
```

`openView` (API 1.8) siedzi na `ui`, nie na `views`, bo `views.*` to
rejestracja, a `ui.*` to nawigacja. Rozwiązuje wyłącznie widoki tego pluginu,
zwraca `false` na hoście, który nie ma gdzie renderować widoków, i rzuca
błędem przy id, którego plugin nigdy nie zarejestrował.

W pierwszej wersji nie obiecujemy stabilności wewnętrznych komponentów React.
Stabilne są sloty, typy propsów i lifecycle, nie przypadkowe klasy CSS ani
hierarchia DOM.

## 8. Storage pluginu

```ts
export interface PluginStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}
```

Storage jest namespacowany, wersjonowany i objęty backupem. Plugin nie może
zapisywać ustawień w globalnym `localStorage` pod przypadkowym kluczem.

## 9. Zasady kompatybilności

- `apiVersion` ma osobny semver od wersji Notible;
- zmiana istniejącego znaczenia pola wymaga major version;
- nowe opcjonalne pola mogą pojawić się w minor version;
- plugin musi deklarować minimalną i maksymalną wspieraną wersję API;
- Core zapewnia deprecation window i komunikat migracyjny;
- każdy breaking change ma fixture pluginu i test kontraktowy;
- dokumentacja referencyjna jest generowana z typów i przykładów.

## 10. Minimalny plugin testowy

Pierwszy plugin nie powinien być funkcją biznesową. Powinien sprawdzać runtime:

- rejestruje komendę;
- dodaje panel ustawień;
- nasłuchuje `object.created`;
- zapisuje dane w swoim storage;
- renderuje widok w publicznym slocie;
- ładuje i usuwa CSS;
- jest wyłączany bez pozostawienia efektów ubocznych.

## 11. Co musi zostać dopisane przed v1

- pełne JSON Schemas manifestu i wire types;
- błędy i kody konfliktów;
- pagination i limity zapytań;
- uprawnienia sieciowe i plikowe;
- lifecycle przy zmianie workspace'u;
- obsługa migracji danych pluginu;
- synchronizacja danych pluginu;
- testy bezpieczeństwa i złośliwego manifestu;
- przykłady TypeScript, JavaScript i deklaratywnego Work Packa;
- instrukcja publikowania i certyfikowania pluginu.
