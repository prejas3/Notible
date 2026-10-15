# Pierwszy plugin Notible w pięć minut

Nie potrzebujesz npm, bundlera, TypeScriptu ani konta nigdzie. Plugin Notible
to **dwa pliki**, a aplikacja ładuje je z dysku dokładnie tak, jak je napisałeś.

## 1. Wygeneruj szkielet

Ustawienia → *Advanced diagnostics* → **Plugin host** → **Create plugin
folder**. Wskaż katalog, w którym chcesz trzymać swoje pluginy.

Powstanie podkatalog z trzema plikami:

```
local.plugin-abc123/
├── plugin.json    ← manifest: kim jest plugin i czego chce
├── main.js        ← kod
└── README.md
```

Jeśli wolisz zacząć ręcznie, wystarczą dwa pierwsze.

## 2. Zainstaluj go

W tym samym miejscu: **Add plugin folder** → wskaż utworzony katalog.

Zobaczysz natywne ostrzeżenie z nazwą, wersją i listą uprawnień. Przeczytaj je
raz uważnie — pojawia się przed uruchomieniem czegokolwiek, a Notible **nie
izoluje kodu pluginów** (patrz [Model zaufania](#model-zaufania)). Kliknij
*Install and run*.

W pasku bocznym pojawi się panel „Hello from …", a w palecie komend — „Say
hello".

## 3. Zmień coś

Otwórz `main.js` w dowolnym edytorze, zmień tekst, zapisz. Wróć do Ustawienia →
Plugin host i kliknij **Reload** przy swoim pluginie. Zmiana jest widoczna od
razu — nie musisz odinstalowywać ani restartować aplikacji.

To jest cała pętla pracy.

## Jak wygląda `plugin.json`

```json
{
  "id": "acme.focus",
  "name": "Focus tools",
  "version": "0.1.0",
  "apiVersion": "1.2",
  "description": "Krótko: co ten plugin robi.",
  "author": "Twoje imię",
  "entry": "main.js",
  "permissions": ["data.read", "workspace.ui"]
}
```

- **`id`** — małe litery, cyfry, kropki i myślniki (`acme.focus`,
  `acme-focus`). Musi być unikalny i **nie może się już zmienić**: to po nim
  Notible rozpoznaje aktualizacje.
- **`apiVersion`** — dziś `"1.2"`. Host sprawdza ją przy ładowaniu.
- **`entry`** — ścieżka względna wewnątrz katalogu pluginu, `.js` lub `.mjs`.
  Ścieżki wychodzące poza katalog (`../`) są odrzucane.
- **`permissions`** — patrz [Uprawnienia](REFERENCE.md#uprawnienia).
  Deklarujesz tu tylko to, czego naprawdę używasz: ta lista jest pokazywana
  użytkownikowi przy instalacji.

**Manifest musi wystąpić dwa razy** — w `plugin.json` i w kodzie — a `id`,
`version` i `apiVersion` muszą się zgadzać. Notible porównuje je przy ładowaniu
i odmawia, jeśli się różnią.

## Jak wygląda `main.js`

```js
export default {
  manifest: {
    id: "acme.focus",
    name: "Focus tools",
    version: "0.1.0",
    apiVersion: "1.2",
    permissions: ["data.read", "workspace.ui"],
  },

  onload(context) {
    // Tu rejestrujesz wszystko, co plugin wnosi.
  },

  onunload() {
    // Tu sprzątasz to, czego nie objąłeś Disposable.
  },
};
```

`onload` dostaje [`PluginContext`](REFERENCE.md#plugincontext) — jedyną rzecz,
jakiej potrzebujesz. Nie importujesz niczego z wnętrza Notible.

## Cztery rzeczy, które umiesz zrobić od razu

### Komenda

```js
context.commands.register({
  id: "archive-old",
  name: "Zarchiwizuj stare notatki",
  hotkey: "Mod+Shift+A",
  execute: async () => {
    const notes = await context.data.objects.query({ type: "note" });
    return { found: notes.length };
  },
});
```

### Panel w interfejsie

```js
context.ui.registerSlot("workspace.sidebar", {
  id: "panel",
  mount({ container, plugin }) {
    const box = document.createElement("div");
    box.textContent = "Cześć";
    container.append(box);
    return { dispose: () => box.remove() };
  },
});
```

`mount` dostaje gotowy element i ma zwrócić coś do posprzątania. Możesz w nim
użyć dowolnej biblioteki — albo, jak wyżej, gołego DOM.

### Reakcja na zdarzenia

```js
context.events.on("object.created", ({ id, type }) => {
  if (type === "note") context.ui.notice("Nowa notatka");
});
```

### Własne ustawienia

```js
context.settings.register({
  id: "settings",
  title: "Focus tools",
  schema: {
    sections: [{
      fields: [
        { kind: "number", key: "minutes", label: "Minuty", default: 25, min: 1 },
        { kind: "toggle", key: "loud", label: "Powiadomienia", default: true },
      ],
    }],
  },
});
```

Ustawienia **deklarujesz, a nie rysujesz** — Notible renderuje je natywnie, więc
wyglądają jak reszta aplikacji. Wartości czytasz przez
`context.storage.get("minutes")`.

## Model zaufania

Notible idzie ścieżką Obsidiana: **kod pluginu nie jest izolowany**. Plugin z
kodem może wszystko to, co użytkownik na tej maszynie — czytać i zmieniać każdą
notatkę, sięgać do sieci, wywoływać dowolną komendę aplikacji.

Co z tego wynika dla Ciebie jako autora:

- `permissions[]` to **deklaracja intencji**, egzekwowana na mediowanym API
  (`context.data`, `context.ui`), ale możliwa do obejścia przez kod, który
  woła backend bezpośrednio. Nie traktuj jej jako zabezpieczenia — traktuj jako
  obietnicę złożoną użytkownikowi.
- Ekran instalacji pokazuje Twoją nazwę, opis i uprawnienia. Pisz je uczciwie.
- Paczka **bez** `entry`, zawierająca wyłącznie CSS, instaluje się bez
  ostrzeżenia — bo sam CSS nie może niczego wynieść.

## Co dalej

- [Pełna dokumentacja API](REFERENCE.md) — każdy typ, metoda i slot.
- `examples/pomodoro/` w tym pakiecie — kompletny, działający plugin
  wykorzystujący wszystko powyższe.
- `notible-plugin-api.d.ts` — typy do podpięcia w edytorze, jeśli chcesz
  podpowiadanie i sprawdzanie typów bez konfigurowania TypeScriptu.

## Najczęstsze problemy

| Objaw | Przyczyna |
|---|---|
| „plugin path must stay inside package" | `entry` wychodzi poza katalog albo nie jest `.js`/`.mjs` |
| „plugin entry manifest does not match plugin.json" | `id`, `version` lub `apiVersion` różnią się między plikami |
| „lacks permission workspace.ui" | rejestrujesz UI bez `"workspace.ui"` w `permissions` |
| „Duplicate registration" | dwa razy to samo `id` rejestracji w jednym pluginie |
| „unknown UI slot" | nazwa slotu spoza [listy](REFERENCE.md#sloty); rejestracja jest pomijana, reszta pluginu działa |
| Panel znika po Reload | `mount` nie zwrócił `Disposable` albo `dispose` nie usuwa elementów |
