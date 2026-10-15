import { useCallback, useEffect, useState } from "react";
import bundledPolishLocale from "../../../locales/pl.json";

/** A BCP-47-ish tag: the built-ins ("en", "pl") or an installed language pack. */
export type CoreLanguage = string;

/** A translation is either one string or the plural forms a language needs. */
type Translation = string | Partial<Record<Intl.LDMLPluralRule, string>>;

const legacyPolish: Record<string, Translation> = {
  "Show Notible": "Pokaż Notible",
  Quit: "Zakończ",
  "Notible - a place for what matters": "Notible - miejsce na to, co ważne",
  "Core navigation": "Core navigation",
  "Workspace notes": "Notatki przestrzeni roboczej",
  "Search notes…": "Search notes…",
  "Search notes": "Search notes",
  "Note title": "Note title",
  "Start writing…": "Start writing…",
  "Note content": "Note content",
  "Core settings sections": "Core settings sections",
  "Optional command input": "Optional command input",
  "Plugin commands": "Komendy pluginów",
  "Writing commands": "Komendy edytora",
  "Backlinks and document stats": "Odnośniki zwrotne i statystyki dokumentu",
  "Search results": "Wyniki wyszukiwania",
  Workspace: "Przestrzeń robocza",
  "No notes yet.": "Brak notatek.",
  "Create the first note": "Utwórz pierwszą notatkę",
  "Untitled note": "Notatka bez tytułu",
  "New note": "Nowa notatka",
  "Use table/board view": "Użyj widoku tabeli/tablicy",
  "Use plain note editor": "Użyj zwykłego edytora notatki",
  Backlinks: "Odnośniki zwrotne",
  "No backlinks yet": "Brak odnośników zwrotnych",
  "Link another note with [[title]] to see it here.": "Użyj [[tytuł]] w innej notatce, aby zobaczyć ją tutaj.",
  "Open source note": "Otwórz notatkę źródłową",
  "Optional text or JSON input": "Opcjonalny tekst lub dane JSON",
  "Active plugin settings": "Aktywne ustawienia pluginów",
  "Create": "Utwórz",
  "Back to parent": "Wróć do elementu nadrzędnego",
  "Move to trash": "Przenieś do kosza",
  "Move to…": "Przenieś do…",
  "Top level": "Najwyższy poziom",
  "Add inside": "Dodaj wewnątrz",
  "Search notes and settings": "Szukaj w notatkach i ustawieniach",
  "Search notes and settings…": "Szukaj w notatkach i ustawieniach…",
  "Notes": "Notatki",
  "Settings": "Ustawienia",
  "Plugin screens": "Ekrany wtyczek",
  // Update notice
  "Notible {version} is ready": "Notible {version} jest gotowy",
  "Downloading and installing…": "Pobieranie i instalowanie…",
  "The update could not be installed. Try again from Settings → Updates.": "Nie udało się zainstalować aktualizacji. Spróbuj z Ustawienia → Aktualizacje.",
  "Signed update. Notible closes and reopens on the new version.": "Podpisana aktualizacja. Notible zamknie się i otworzy w nowej wersji.",
  "Update now": "Zaktualizuj teraz",
  "Installing": "Instalowanie",
  "Not now": "Nie teraz",
  // Import/export
  "Download as Markdown (.md)": "Pobierz jako Markdown (.md)",
  "Import Markdown": "Importuj Markdown",
  // Two-step delete confirmation.
  //
  // These used to be sentence fragments assembled around a count in
  // CoreOnlyApp ("contains" + n + "items"), which forced the Polish to keep
  // the English word order and produced "zawiera 1 elementów". Fragments
  // cannot be translated: their order is fixed by JSX, so no locale file can
  // repair the grammar. They are whole sentences with a {count} placeholder
  // now, and a language with plural forms supplies them as an object.
  //
  // The destructive verbs and the irreversibility warning are deliberately
  // NOT here — see UNTRANSLATABLE. A hostile translation of
  // "This cannot be undone." is valid JSON and costs a user their data.
  "{name} contains {count} items.": {
    one: "{name} zawiera {count} element.",
    few: "{name} zawiera {count} elementy.",
    many: "{name} zawiera {count} elementów.",
  },
  "Deleting it deletes everything inside.": "Usunięcie spowoduje usunięcie całej zawartości.",
  "{count} items will be deleted, including {name}.": {
    one: "Zostanie usunięty {count} element, w tym {name}.",
    few: "Zostaną usunięte {count} elementy, w tym {name}.",
    many: "Zostanie usuniętych {count} elementów, w tym {name}.",
  },
  Close: "Zamknij",
  "No matches": "Brak wyników",
  "Search…": "Szukaj…",
  Search: "Szukaj",
  // Plugin host / authoring
  "Re-read this plugin from disk": "Wczytaj ponownie ten plugin z dysku",
  "No folder chosen": "Nie wybrano folderu",
  "Choose…": "Wybierz…",
  // Workspace dashboard (notible.views). Resolved through the shared `app`
  // namespace, so these are translated once for the product rather than once
  // per plugin. Whole sentences with {count}: this surface used to build
  // "za " + n + " dni" by hand, which no locale file could have fixed.
  "No due date": "Bez terminu",
  "no due date": "bez terminu",
  overdue: "po terminie",
  today: "dziś",
  tomorrow: "jutro",
  yesterday: "wczoraj",
  "this week": "ten tydzień",
  "{count} days ago": { one: "{count} dzień temu", few: "{count} dni temu", many: "{count} dni temu" },
  // I18N (Hive #58): the plugin detail pane's count line, through the same plural objects.
  "{count} places in the interface": { one: "{count} miejsce w interfejsie", few: "{count} miejsca w interfejsie", many: "{count} miejsc w interfejsie" },
  "{count} more commands": { one: "{count} inne polecenie", few: "{count} inne polecenia", many: "{count} innych poleceń" },
  "in {count} days": { one: "za {count} dzień", few: "za {count} dni", many: "za {count} dni" },
  Overdue: "Po terminie",
  "Due today": "Dziś",
  "This week": "Ten tydzień",
  "Later (up to 14 days)": "Dalej (do 14 dni)",
  "Needs attention": "Wymaga uwagi",
  "Nothing is due in the next two weeks.": "Nic nie ma terminu w najbliższych dwóch tygodniach.",
  Ignore: "Ignoruj",
  "Stop showing this item under “No due date”": "Nie pokazuj tego elementu w „bez terminu”",
  "Everything without a due date is ignored.": "Wszystko bez terminu jest zignorowane.",
  "Restore ignored ({count})": "Przywróć zignorowane ({count})",
  Projects: "Projekty",
  "{open} open · {done} closed": "{open} otwarte · {done} zamknięte",
  "Recently opened": "Ostatnio otwierane",
  "Unfinished in notes": "Niezrobione w notatkach",
  Untitled: "Bez tytułu",
  "Loading…": "Wczytywanie…",
  "This view needs a workspace.": "Ten widok potrzebuje przestrzeni roboczej.",
  "This workspace is empty. Add a project or a note to see something here.": "Ta przestrzeń jest pusta. Dodaj projekt lub notatkę, żeby coś tu zobaczyć.",
  // Embedded queries (notible.queries) syntax reference.
  "Embedded queries": "Zapytania w notatce",
  "Put a notible code block in any note and it becomes a live table of matching objects. The block stays editable; the table is drawn beneath it.": "Wstaw blok kodu notible w dowolnej notatce, a stanie się żywą tabelą pasujących obiektów. Blok zostaje edytowalny; tabela rysuje się pod nim.",
  Syntax: "Składnia",
  "Required. One to four types, comma separated.": "Wymagane. Od jednego do czterech typów po przecinku.",
  "Only objects inside this note's container.": "Tylko obiekty w kontenerze tej notatki.",
  "Any field on the type's schema. A comma means “either”.": "Dowolne pole ze schematu typu. Przecinek znaczy „albo”.",
  "Accepts <= +7d, < today, >= 2026-09-01 or none.": "Przyjmuje <= +7d, < today, >= 2026-09-01 albo none.",
  "Part of the title.": "Fragment tytułu.",
  "A field, optionally desc. Empty values always sort last.": "Pole, opcjonalnie desc. Puste wartości zawsze na końcu.",
  "50 by default, 200 at most.": "Domyślnie 50, maksymalnie 200.",
  "table, list or count.": "table, list albo count.",
  "Table columns.": "Kolumny tabeli.",
  "An unknown key is an error shown in the block, never silently skipped — a filter that vanished is a query lying about your workspace.": "Nieznany klucz jest błędem pokazanym w bloku, nigdy po cichu pominiętym — filtr, który zniknął, to zapytanie kłamiące o Twojej przestrzeni roboczej.",
  "Fields available in this workspace": "Pola dostępne w tej przestrzeni",
  "No type has schema fields yet.": "Żaden typ nie ma jeszcze pól w schemacie.",
  // Builtin plugin surfaces: aria-labels, placeholders and titles. These
  // were the last untranslated UI in the product — and the worst place
  // for it, since a screen reader reads them out.
  "Action property": "Właściwość akcji",
  "Action text": "Tekst akcji",
  "Action type": "Typ akcji",
  "Action value": "Wartość akcji",
  "Add tag…": "Dodaj tag…",
  "AI work desk": "Pulpit AI",
  "Calendar integrations": "Integracje kalendarza",
  "Close filters": "Zamknij filtry",
  "Condition combinator": "Łącznik warunków",
  "Condition field": "Pole warunku",
  "Condition operator": "Operator warunku",
  "Condition value": "Wartość warunku",
  "Created record title": "Tytuł tworzonego rekordu",
  "Created record type": "Typ tworzonego rekordu",
  "Delete action": "Usuń akcję",
  "Delete condition": "Usuń warunek",
  "Delete rule": "Usuń regułę",
  "Drag to link a dependency": "Przeciągnij, aby połączyć zależność",
  "Drag to reorder": "Przeciągnij, aby zmienić kolejność",
  "Drag to resize the name column": "Przeciągnij, aby zmienić szerokość kolumny nazwy",
  "Due date": "Termin",
  "Editor extensions": "Rozszerzenia edytora",
  "Expand rule": "Rozwiń regułę",
  "Filter combinator": "Łącznik filtrów",
  "Filter field": "Pole filtru",
  "Filter operator": "Operator filtru",
  "Filter value": "Wartość filtru",
  Finance: "Finanse",
  "Import and export": "Import i eksport",
  "Move target": "Cel przeniesienia",
  "Next month": "Następny miesiąc",
  "Paste an object id…": "Wklej identyfikator obiektu…",
  Plugins: "Pluginy",
  "Previous month": "Poprzedni miesiąc",
  "Print / Save as PDF": "Drukuj / Zapisz jako PDF",
  Project: "Projekt",
  "Property name": "Nazwa właściwości",
  "Recurring frequency": "Częstotliwość cyklu",
  "Recurring interval": "Interwał cyklu",
  "Relation kind": "Rodzaj relacji",
  "Relation target": "Cel relacji",
  "Remove filter": "Usuń filtr",
  "Remove group": "Usuń grupę",
  "Remove property": "Usuń właściwość",
  "Resize the name column": "Zmień szerokość kolumny nazwy",
  "Search and backlinks": "Wyszukiwanie i odnośniki",
  "Search notes, tasks, projects…": "Szukaj notatek, zadań, projektów…",
  "Tasks, Issues and Projects": "Zadania, zgłoszenia i projekty",
  Themes: "Motywy",
  "Trigger field": "Pole wyzwalacza",
  "Trigger value": "Wartość wyzwalacza",
  "Type here…": "Pisz tutaj…",
  Value: "Wartość",
  "View filters": "Filtry widoku",
  "What happened…": "Co się wydarzyło…",
  "What is it called?": "Jak się nazywa?",
  Whiteboard: "Tablica",
  "Zoom in": "Powiększ",
  "Zoom out": "Pomniejsz",
  // Plugin Matrix
  "Search plugins": "Szukaj pluginów",
  "Search plugins…": "Szukaj pluginów…",
  // Community plugin market (Model A — unsigned install)
  Install: "Zainstaluj",
  "Install {name} {version}?": "Zainstalować {name} {version}?",
  "Published by {author}. It is not reviewed or verified by Notible for this version. Once installed it runs with full access to your notes and the internet, like any plugin.":
    "Publikowany przez {author}. Nie jest przeglądany ani weryfikowany przez Notible dla tej wersji. Po instalacji działa z pełnym dostępem do Twoich notatek i internetu, jak każdy plugin.",
  "Community plugins are published by other people and are not reviewed by Notible. You install them at your own risk.":
    "Pluginy społeczności są publikowane przez inne osoby i nie są przeglądane przez Notible. Instalujesz je na własną odpowiedzialność.",
  // Container module picker
  project: "projekt",
  folder: "folder",
  workspace: "przestrzeń robocza",
  Modules: "Moduły",
  "New {kind}": "Nowy: {kind}",
  "Modules for this {kind}": "Moduły dla: {kind}",
  "Turn tabs on or off for this {kind}. Turning one off hides its tab; the data stays.":
    "Włącz lub wyłącz zakładki dla tego elementu ({kind}). Wyłączenie ukrywa zakładkę; dane pozostają.",
  "Pick what this {kind} starts with. You can change this any time from the tab strip.":
    "Wybierz, od czego zaczyna ten element ({kind}). Możesz to zmienić w każdej chwili z paska zakładek.",
  "Use defaults": "Użyj domyślnych",
  Save: "Zapisz",
};

/** Polish ships with Notible. The file is imported into the frontend bundle,
 * so changing the language works in an installed build without asking the
 * user to copy a source-repository file into app_data/locales. The older
 * inline dictionary remains as a fallback for plural forms and keys that have
 * not moved to the catalogue yet. */
const polish: Record<string, Translation> = {
  ...legacyPolish,
  ...(bundledPolishLocale.strings?.app as Record<string, Translation> | undefined),
};

/** English needs plural forms too: the key itself is the "other" form, so
 * without these a count of one reads "1 items" / "1 words". */
const english: Record<string, Translation> = {
  "{count} backlinks": { one: "{count} backlink", other: "{count} backlinks" },
  "{count} places in the interface": { one: "{count} place in the interface", other: "{count} places in the interface" },
  "{count} more commands": { one: "{count} more command", other: "{count} more commands" },
  "{count} words": { one: "{count} word", other: "{count} words" },
  "{count} characters": { one: "{count} character", other: "{count} characters" },
  "{count} items": { one: "{count} item", other: "{count} items" },
  "{name} contains {count} items.": { one: "{name} contains {count} item.", other: "{name} contains {count} items." },
  "{count} items will move to the trash, including {name}.": { one: "{count} item will move to the trash, including {name}.", other: "{count} items will move to the trash, including {name}." },
  "{count} days ago": { one: "{count} day ago", other: "{count} days ago" },
  "in {count} days": { one: "in {count} day", other: "in {count} days" },
  "{count} days": { one: "{count} day", other: "{count} days" },
  "{count} items moved to the trash.": { one: "{count} item moved to the trash.", other: "{count} items moved to the trash." },
  "{count} items deleted for good.": { one: "{count} item deleted for good.", other: "{count} items deleted for good." },
  "Create {count} tasks": { one: "Create {count} task", other: "Create {count} tasks" },
  "{count} items · restored to where they were, unchanged.": { one: "{count} item · restored to where it was, unchanged.", other: "{count} items · restored to where they were, unchanged." },
  "{count} plugin package files from “Install .zip”, already unpacked and no longer needed.": { one: "{count} plugin package file from “Install .zip”, already unpacked and no longer needed.", other: "{count} plugin package files from “Install .zip”, already unpacked and no longer needed." },
};

/** The built-in dictionary for a language: Polish ships with Notible, and
 * English only carries its plural forms. */
function builtIn(language: CoreLanguage): Record<string, Translation> {
  return language === "pl" ? polish : language === "en" ? english : {};
}

/**
 * Strings that must never come from a translation.
 *
 * Kept in step with `UNTRANSLATABLE` in `scripts/extract-locale-keys.mjs`,
 * which the quality gate compares against this list. A hostile translation is
 * valid JSON: relabelling a destructive control, or turning
 * "This cannot be undone." into "You can restore this from Trash at any time.",
 * destroys a user's data while they read a sentence saying it is safe. These
 * stay English in every language — a wrong warning is worse than an English
 * one.
 */
const UNTRANSLATABLE = new Set([
  "Delete", "Delete all", "Cancel", "Continue", "This cannot be undone.",
  "Move to trash", "Delete forever", "Empty trash",
  "Restore", "Restore and reload",
  "Add plugin folder", "Install .zip", "Remove",
  "Revoke", "Unlink folder",
]);

/**
 * Core owns its own language preference, and deliberately does not read the
 * legacy app's.
 *
 * `src/lib/theme.ts` persists a `language` inside `notible.theme` and its
 * default is **"pl"** — a leftover from when the legacy app was Polish-first.
 * The obvious-looking fix here (read that value, since `useCoreI18n` already
 * listens for the `notible:preferences` event it broadcasts) would silently
 * start the English application in Polish for every existing user. So Core
 * keeps its own key with an English default, and the two never share a store.
 */
const LANGUAGE_KEY = "notible-language";
const BUILT_IN_LANGUAGES: readonly CoreLanguage[] = ["en", "pl"];

/** The stored choice is honoured when it is built in or an installed pack; a
 * language whose pack was removed falls back to English rather than to nothing. */
export function readCoreLanguage(): CoreLanguage {
  const stored = localStorage.getItem(LANGUAGE_KEY);
  if (stored && (BUILT_IN_LANGUAGES.includes(stored) || Object.prototype.hasOwnProperty.call(installed, stored))) return stored;
  return "en";
}

/** Persist and broadcast. The event is the same one the legacy app uses, so a
 * single listener in each hook covers both sources of change. */
export function setCoreLanguage(language: CoreLanguage) {
  localStorage.setItem(LANGUAGE_KEY, language);
  window.dispatchEvent(new Event("notible:preferences"));
}

export const CORE_LANGUAGES: ReadonlyArray<{ value: CoreLanguage; label: string }> = [
  { value: "en", label: "English" },
  { value: "pl", label: "Polski" },
];

/** `{name}` / `{count}` filled in after the form is chosen, never before: a
 * translator must be able to move a placeholder to where the grammar needs it. */
function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole);
}

/**
 * `entry` is typed as possibly missing on purpose. Every caller reaches it by
 * index — `polish[key]`, `installed[language]?.[key]` — and TypeScript types an
 * index read as present unless `noUncheckedIndexedAccess` is on. Without the
 * guard below, any key with a `count` that had no translation crashed on
 * `entry[rule]`, which is the *default English* path: a missing translation is
 * the normal case, not the exception.
 */
function resolve(entry: Translation | undefined, language: CoreLanguage, count?: number): string | undefined {
  if (entry === undefined) return undefined;
  if (typeof entry === "string") return entry;
  if (count === undefined) return undefined;
  // Polish needs one/few/many; English needs one/other. Asking Intl rather
  // than hardcoding the rule is what makes a new language a data change.
  const rule = new Intl.PluralRules(language).select(count);
  return entry[rule] ?? entry.other ?? entry.many;
}

/**
 * Installed translations, merged over the built-in dictionary.
 *
 * Module-level, not per-component state: `useCoreI18n` is instantiated in at
 * least five places, and a per-hook load would fetch the same files five times
 * and give each copy a different `t` identity.
 *
 * Mirrored into `localStorage` because the first paint must be correct. The
 * dictionary arrives from an async command *after* `createRoot().render()`, so
 * reading only from disk would flash English on every start and then jump.
 * The mirror is read synchronously, exactly as the built-in dictionary is, and
 * the disk read refreshes it afterwards.
 */
const MIRROR_KEY = "notible-locale-mirror";

let installed: Record<string, Record<string, Translation>> = readMirror();
/** Every namespace, keyed by language — what `translateForPlugin` reads. */
let installedByNamespace: Record<string, Record<string, Record<string, Translation>>> = {};

function readMirror(): Record<string, Record<string, Translation>> {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    return parsed && typeof parsed === "object" ? parsed as Record<string, Record<string, Translation>> : {};
  } catch {
    return {};
  }
}

/**
 * Replace the installed set. Called once at startup with what Rust validated.
 *
 * Only the `app` namespace is taken here: a locale file may also carry plugin
 * namespaces, and those are resolved by the plugin's own `t`, not by Core's.
 */
export function applyInstalledLocales(bundles: Array<{ locale: string; strings: Record<string, Record<string, Translation>> }>) {
  const next: Record<string, Record<string, Translation>> = {};
  const byNamespace: Record<string, Record<string, Record<string, Translation>>> = {};
  for (const bundle of bundles) {
    if (bundle.strings.app) next[bundle.locale] = bundle.strings.app;
    byNamespace[bundle.locale] = bundle.strings;
  }
  installed = next;
  installedByNamespace = byNamespace;
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(next));
  } catch {
    // A full quota costs the head start on first paint, nothing else.
  }
  window.dispatchEvent(new Event("notible:preferences"));
}

/** MCP-SETTINGS-WINDOW (Hive #29): the MCP settings window trusts only the
 *  bundled dictionaries. The mirror lives in localStorage, which plugins in the
 *  main window can write, and a relabelled "Cancel" would be a trap there. */
export function ignoreInstalledLocales() {
  installed = {};
  installedByNamespace = {};
}

/** How many keys of the catalogue this language still has no translation for. */
export function untranslatedCount(language: CoreLanguage, catalogueKeys: readonly string[]): number {
  const dictionary = language === "pl" ? polish : {};
  const extra = installed[language] ?? {};
  return catalogueKeys.filter((key) => !(key in extra) && !(key in dictionary)).length;
}

/**
 * Resolve a key for a plugin: its own namespace first, then the shared `app`
 * one, then the key itself.
 *
 * Falling back to `app` is what lets a builtin's strings live in the same
 * namespace as Core's, so a translator writes "Cancel" once for the whole
 * product instead of once per plugin. It is a *read* fallback only — a plugin
 * may still supply nothing but its own namespace.
 */
export function translateForPlugin(
  namespace: string,
  key: string,
  values?: Record<string, string | number>,
  own?: Record<string, Record<string, string>>,
): string {
  const language = readCoreLanguage();
  const count = typeof values?.count === "number" ? values.count : undefined;
  if (UNTRANSLATABLE.has(key)) return values ? interpolate(key, values) : key;
  const bundle = installedByNamespace[language];
  const template =
    resolve(bundle?.[namespace]?.[key], language, count)
    // The plugin's own bundled file, after a language pack (which may improve it).
    ?? resolve(own?.[language]?.[key], language, count)
    ?? resolve(bundle?.app?.[key], language, count)
    ?? resolve(builtIn(language)[key], language, count)
    ?? key;
  return values ? interpolate(template, values) : template;
}

/** Marks a string for the catalogue without translating it here — for data lists
 *  (menu names, group headings) that are translated where they are drawn. */
export const tr = (key: string) => key;

/** For code that cannot use the hook (class components, module-level helpers). */
export const tCore = (key: string, values?: Record<string, string | number>) => translateForPlugin("app", key, values);

/** Date/number formatting tag for a language: the built-ins keep their regional
 * form, a pack uses its own tag when the platform knows it. */
function formatLocaleFor(language: CoreLanguage): string {
  if (language === "pl") return "pl-PL";
  if (language === "en") return "en-GB";
  try { return Intl.DateTimeFormat.supportedLocalesOf([language]).length > 0 ? language : "en-GB"; } catch { return "en-GB"; }
}

export function currentLocaleTag(): string {
  return formatLocaleFor(readCoreLanguage());
}

export function useCoreI18n() {
  const [language, setLanguage] = useState<CoreLanguage>(readCoreLanguage);
  // Dates in plugins format with <html lang>, not the Windows locale (R4 T9).
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => {
    const update = () => setLanguage(readCoreLanguage());
    window.addEventListener("notible:preferences", update);
    return () => window.removeEventListener("notible:preferences", update);
  }, []);
  const t = useCallback((value: string, values?: Record<string, string | number>) => {
    const count = typeof values?.count === "number" ? values.count : undefined;
    // An installed translation wins over the built-in one, and both lose to
    // UNTRANSLATABLE: a locale file is written by a stranger, and relabelling
    // a destructive control is valid JSON.
    const translated = UNTRANSLATABLE.has(value)
      ? undefined
      : resolve(installed[language]?.[value], language, count)
        ?? resolve(builtIn(language)[value], language, count);
    const template = translated ?? value;
    return values ? interpolate(template, values) : template;
  }, [language]);
  // Dates are part of a language too. Without this every date in Core and the
  // builtins formats with the OS locale, so a German UI shows Polish months.
  const locale = formatLocaleFor(language);
  return { t, locale };
}
