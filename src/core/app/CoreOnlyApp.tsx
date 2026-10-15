import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Bookmark,
  BookText,
  BookMarked,
  BookCopy,
  PenLine,
  User,
  MapPin,
  Spline,
  BriefcaseBusiness,
  CalendarDays,
  CircleAlert,
  ChevronRight,
  Download,
  Pencil,
  Copy,
  FileText,
  Folder,
  FolderPlus,
  Keyboard,
  LayoutGrid,
  LayoutDashboard,
  ListTodo,
  Maximize2,
  Minimize2,
  Network,
  CheckSquare,
  Plus,
  Puzzle,
  Search,
  Settings2,
  Shapes,
  Star,
  Table2,
  SlidersHorizontal,
  Languages,
  Trash2,
  Upload,
  CircleHelp,
  History,
  Info,
  LifeBuoy,
  PanelRight,
  Menu,
  Bot,
  Shield,
} from "lucide-react";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { ExtensionHost } from "../extensions/host.ts";
import { Select, DatePicker } from "../ui/index.ts";
import { LocalPluginManager } from "../extensions/manager.ts";
import { loadLocalPluginDirectory } from "../extensions/loader.ts";
import { hydrateActiveLocalPlugins } from "../extensions/hydrate.ts";
import { CoreOverlayHost, CorePluginViewPane, PluginCorner, PluginSlot, cornerCandidates, corePluginViewItems, coreOverlayApi, coreStyleSink, pickCornerOccupant, requestPluginSelection, setCorePluginBridge, useCodeBlockDecorator, useCornerChoice, useCorePluginHotkeys } from "./CorePluginSurfaces.tsx";
import { HELP_PAGES } from "../../help/pages.ts";
import { EXTENSION_API_VERSION, validatePluginManifest } from "../extensions/manifest.ts";
import { compareVersions } from "../extensions/update.ts";
import packageJson from "../../../package.json";
import {
  backupDatabase,
  backupsDirectory,
  deleteBackup,
  getBackupRetention,
  listBackups,
  restoreDatabase,
  setBackupRetention,
  type BackupInfo,
  coreLocalPluginFileReader,
  coreDataApi,
  createNote,
  announceObjectOpened,
  getObject,
  listObjects,
  searchObjectsText,
  listRelations,
  exportPluginDevkit,
  extractPluginZip,
  grantPluginTrust,
  grantThemeTrust,
  pickPluginPackage,
  scaffoldPlugin,
  listPluginRegistry,
  listTrash,
  deleteObjectForever,
  pickPluginFolder,
  readPluginFile,
  removePluginRegistry,
  restoreObject,
  revokeGrantedFolder,
  setPluginRegistryState,
  trashObject,
  upsertPluginRegistry,
  updateObject,
  sweepOrphanMedia,
  listLocales,
  installPluginZip,
  readThemeAsset,
  type LocaleBundle,
} from "../data/core-data-api.ts";
import type { CommandRegistration, PluginObject, PluginRelation, PluginType } from "../../../packages/plugin-api/src/index.ts";
import { SyncConflictView } from "./SyncConflictView.tsx";
import { conflictDescriptors, type ConflictDescriptor } from "../data/core-data-api.ts";
import { VersionHistoryPanel } from "./VersionHistoryPanel.tsx";
import { applyZoom, readZoom, stepZoom, ZOOM_STEPS } from "./zoom.ts";
import { applyCodeLook, CODE_LINE_HEIGHTS, CODE_LOOK_DEFAULT, CODE_SIZES, CODE_TAB_SIZES, readCodeLook, type CodeLook } from "./codeLook.ts";
import { NOTICE_SOUNDS, playNoticeSound, readNoticeSound, SOUND_KEY, type NoticeSound } from "./sounds.ts";
import { matchesAllWords, snippetFor } from "./search-results.ts";
import { expandSidebarTree, readSidebarTreeMode, saveSidebarTreeMode, type SidebarTreeMode } from "./sidebar-tree.ts";
import { applyInstalledLocales, currentLocaleTag, readCoreLanguage, setCoreLanguage, tCore, translateForPlugin, tr, useCoreI18n, type CoreLanguage } from "./core-i18n.ts";
import { CODE_FORMAT_COMMAND, CODE_FORMAT_COMMANDS, CORE_COMMANDS, CORE_COMMAND_REQUIRES, CORE_COMMAND_SOURCE, codeFormatCommandOffered, codeFormatInBody, objectMenuEntries, objectMenuMatches, pluginBlockInsertion } from "./coreCommands.ts";
import type { CodeFormatAction } from "./codeFormat.ts";
import { exportObjectTreeJson, importObjectTreeJson } from "./coreTransfer.ts";
import { CoreSwitch } from "./CoreSwitch.tsx";
import { McpCleanupPanel, listHeldIds, useMcpCleanupHeartbeat } from "./McpCleanupPanel.tsx";
import { settleDrafts } from "./settleDrafts.ts";
import { documentFromText, textFromDocument } from "./coreDocument.ts";
import { GrantedFolderSettings, PluginHotkeySettings } from "./CoreSettingsPanels.tsx";
import { mediaSharingStatus, saveMedia, setMediaSharing, setTrayTexts, setUiLanguage, setBeforeExit, quitApp, watchExternalChanges } from "../data/core-data-api.ts";
import { collapseMediaReference } from "./mediaRef.ts";
import { calendarSharingStatus, setCalendarSharing } from "../data/calendar-api.ts";
import { CoreMarkdownEditor, markdownFromCoreHtml, placeCaretAtMarkdownOffset, renderCoreMarkdown } from "./CoreMarkdownEditor.tsx";
import { CORE_PRINT_DEFAULTS, normalizeCorePrintOptions, printDocumentHtml, printableDocument, type CorePrintOptions } from "./corePrint.ts";
import { detectWikilinkTrigger, resolveBacklinks, resolveWikilinkTarget, wikilinkSuggestions } from "./coreBacklinks.ts";
import { countWords } from "./coreMarkdownMarks.ts";
import { CoreLanguagesPanel } from "./CoreLanguagesPanel.tsx";
import { isPluginUpdateCompatible } from "../extensions";
import { getThemePackState, selectThemePack, setThemePackHost, setThemePacks, useThemePacks, type ThemePackHost } from "./themePacks.ts";
import { fillThemeAssets, sanitizeThemeCss } from "./themeCss.ts";
import { arrayBufferToBase64, fetchWithByteCeiling, isOfficialReleaseUrl, isReservedPluginId, MAX_PACKAGE_BYTES, resolveGithubRelease, resolveRepoRelease, themeAsCatalogSource } from "./marketSource.ts";
import { CoreUpdateSection } from "./CoreUpdateSection.tsx";
// English only — see the file's own header comment. Rendered locally
// (Settings → About) instead of linking out, since notible.app/releases
// doesn't exist yet.
import RELEASE_NOTES_MD from "../../../docs/RELEASE_NOTES.md?raw";
import { HelpScreen } from "../../help/HelpScreen.tsx";
import { searchHelp } from "../../help/parse.ts";
import { HELP_SECTIONS } from "../../help/pages.ts";
import { CoreUpdateToast } from "./CoreUpdateToast.tsx";
import { ContainerModulePicker } from "../../product/ContainerModulePicker";
import "./core-only.css";
import "./midnight-theme.css";

/**
 * A screen in the shell.
 *
 * Plugin views are sections in their own right rather than a modal or a
 * parallel boolean: a registered view replaces the main content area exactly
 * the way Notes and Settings do, so navigation history, the Back button and
 * the "take me to that note" jump in `openObject` all keep working with no
 * special cases. The suffix is the `${pluginId}:${viewId}` key.
 */
type CorePluginViewSection = `plugin-view:${string}`;
type CoreSection = "notes" | "settings" | "help" | "sync-conflicts" | CorePluginViewSection;

const PLUGIN_VIEW_SECTION_PREFIX = "plugin-view:";
const pluginViewSection = (key: string): CorePluginViewSection => `${PLUGIN_VIEW_SECTION_PREFIX}${key}`;
const pluginViewKeyOf = (section: CoreSection): string | null =>
  section.startsWith(PLUGIN_VIEW_SECTION_PREFIX) ? section.slice(PLUGIN_VIEW_SECTION_PREFIX.length) : null;
type CoreSettingsSection = "appearance" | "languages" | "editor" | "files" | "hotkeys" | "plugins" | "recovery" | "ai-cleanup" | "updates" | "about";
type PluginsTab = "all" | "market";

const CONTAINER_KINDS = new Set(["project", "folder", "space"]);
/** localStorage prefix for a note's text whose save failed after the user left it. */
const UNSAVED_DRAFT_KEY = "notible.unsavedDraft.";

/**
 * Everything in Settings, as things you can search for.
 *
 * Written by hand rather than derived from the rendered panels, and that is a
 * real cost: add a setting and it is findable only once it is listed here.
 * The alternative — scraping the JSX — would index the words a developer
 * happened to use, and people search for what they want ("dark", "kopia",
 * "images"), not for our headings. `keywords` is where those live, including
 * the Polish ones, because the app is used in Polish and the panels are not
 * all translated.
 */
const SETTINGS_INDEX: { section: CoreSettingsSection; tab?: PluginsTab; label: string; hint: string; keywords: string }[] = [
  { section: "appearance", label: tr("Appearance"), hint: tr("Theme, dark mode, density"), keywords: "theme dark night midnight light paper colour color density compact motyw ciemny jasny wyglad" },
  { section: "appearance", label: tr("Sidebar tree"), hint: tr("Auto-expand to the open note"), keywords: "sidebar tree auto expand manual folders navigation drzewo boczny automatycznie rozwijanie recznie foldery" },
  { section: "languages", label: tr("Languages"), hint: tr("Interface language and language packs"), keywords: "language languages translation translate polish english pack install jezyk jezyki tlumaczenie polski angielski pakiet" },
  { section: "editor", label: tr("Editor"), hint: tr("Writing, slash menu, print"), keywords: "editor writing slash markdown pdf print font edytor pisanie drukuj backlinks document stats words characters odnosniki statystyki" },
  { section: "files", label: tr("Files & links"), hint: tr("Workspace structure and links"), keywords: "files links folders structure import export pliki linki foldery" },
  { section: "hotkeys", label: tr("Hotkeys"), hint: tr("Keyboard shortcuts"), keywords: "hotkeys keyboard shortcuts keys skroty klawisze klawiatura" },
  { section: "plugins", tab: "all", label: tr("Plugins"), hint: tr("Everything installed, plus the market"), keywords: "plugins features optional wtyczki funkcje enabled active core market install catalogue instalacja sklep katalog" },
  { section: "plugins", tab: "market", label: tr("Plugin market"), hint: tr("Install plugins from the market"), keywords: "install plugin folder zip developer pack instalacja wtyczka market sklep" },
  // Worth its own row: it is a switch people go looking for by name after
  // reading about it, and it lives three clicks deep.
  { section: "files", label: tr("Let plugins read pasted images"), hint: tr("Needed to sync pictures and to put them in reports"), keywords: "images pictures screenshots sync media reports export obrazy zdjecia zrzuty synchronizacja raport eksport" },
  { section: "files", label: tr("Let plugins read your calendars"), hint: tr("Needed to connect Google or Outlook in the Calendar tab"), keywords: "calendar google outlook events sync kalendarz wydarzenia synchronizacja" },
  { section: "plugins", tab: "all", label: tr("Plugin settings"), hint: tr("Configure active plugins"), keywords: "plugin settings configure ustawienia wtyczek panels panele" },
  { section: "recovery", label: tr("Recovery"), hint: tr("Backups, trash, restore"), keywords: "backup backups restore trash bin recovery safety kopia zapasowa kosz przywroc" },
  { section: "ai-cleanup", label: tr("MCP server"), hint: tr("Connect AI assistants, choose what they may do, review cleanup requests"), keywords: "ai mcp server cleanup delete trash assistant model claude codex connect edits finance serwer sprzatanie usun kosz polacz edycja finanse" },
  { section: "updates", label: tr("Updates"), hint: tr("Version and installing updates"), keywords: "update updates version install upgrade aktualizacja wersja" },
  { section: "about", label: tr("About"), hint: tr("Version, API, storage"), keywords: "about version wersja api storage build o programie informacje licencja" },
];

/** Rank settings rows against a typed query. Name first, then the words. */
function matchSettings(query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return SETTINGS_INDEX
    .map((entry) => {
      const label = entry.label.toLowerCase();
      if (label.startsWith(needle)) return { entry, rank: 0 };
      if (label.includes(needle)) return { entry, rank: 1 };
      if (entry.hint.toLowerCase().includes(needle)) return { entry, rank: 2 };
      if (entry.keywords.includes(needle)) return { entry, rank: 3 };
      return null;
    })
    .filter((hit): hit is { entry: typeof SETTINGS_INDEX[number]; rank: number } => hit !== null)
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 6)
    .map((hit) => hit.entry);
}

type CoreTheme = "paper" | "night";
type CoreThemeChoice = CoreTheme | "system";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Whether Windows is in dark mode right now, following it while it changes. */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia?.(DARK_QUERY).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY);
    if (!query) return;
    const update = () => setDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return dark;
}
type CoreDensity = "comfortable" | "compact";

/**
 * The host's own `:root{}` rule for runtime theme tokens (D4).
 *
 * Inline styles on `documentElement` beat every stylesheet regardless of order
 * or specificity, so applying the selected theme that way silently overrode any
 * theme a plugin injected. A real stylesheet rule, placed *before* the plugin
 * stylesheets, loses to them — which is the point.
 */
/** The id under which the active theme pack's stylesheet is attached (a colon can never be in a plugin id). */
const THEME_PACK_STYLE_ID = "theme-pack:active";
/** Set while a theme pack is being tried at startup; if it is still set next start, the app did not run cleanly with it. */

/** A registry row whose manifest marks it as a theme pack (those live on the Themes screen, not in the plugin list). */
function isThemePackEntry(manifest: string): boolean {
  try { return typeof (JSON.parse(manifest) as { theme?: unknown }).theme === "object"; } catch { return false; }
}

export const coreHost = new ExtensionHost(coreDataApi);
const corePluginManager = new LocalPluginManager(coreHost);

export interface MatrixSlotProps {
  /** Which plugins tab is showing. */
  tab: "all" | "market";
  /** Locally installed plugin registry entries (folder / .zip). */
  entries: { plugin_id: string; version: string; source: string; state: string; verified: boolean; manifest: string }[];
  /** DOM node of the detail pane beside the middle column. The slot portals
   * the selected plugin's detail (or `emptyState`) into it. */
  detailContainer: HTMLElement | null;
  /** Rendered into the detail pane when no plugin is selected. */
  emptyState: ReactNode;
  onToggleLocal: (pluginId: string) => void;
  onReloadLocal: (pluginId: string) => void;
  onRemoveLocal: (pluginId: string) => void;
  onError: (value: unknown) => void;
  /** Finishes a verified market install from an extracted directory. */
  onInstall: (installPath: string, sourceUrl?: string) => Promise<void>;
}

export interface CoreOnlyAppProps {
  /** Manifests of the plugins this product ships (on or off). Core needs them
   * for `context.help` (API 1.22): the host only knows the enabled ones. */
  builtinCatalog?: ReadonlyArray<{ id: string; name: string; description?: string; guide?: string }>;
  /** The plugins screen is a master/detail: the slot renders a minimalist
   * list in place and portals the selected plugin's detail into
   * `detailContainer`. */
  matrixSlot?: (props: MatrixSlotProps) => ReactNode;
  /** Renders a plugin-owned table/kanban/etc. surface for a folder/project
   * container, e.g. notible.views. Receives the container id and a
   * navigation callback; Core falls back to the plain text editor when this
   * is unset or the backing plugin isn't active, so Core-only never depends
   * on it. */
  containerSlot?: (containerId: string, objectType: string, onOpenObject: (id: string) => Promise<void>) => ReactNode;
  /** Renders a right-side properties panel (status/priority/assignee/dates,
   * from the object's real type schema) for the currently open record, e.g.
   * notible.properties. Core falls back to no panel at all when unset or
   * inapplicable — Core-only never depends on it. */
  propertiesSlot?: (objectId: string, objectType: string) => ReactNode;
}

function messageOf(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

function commandResultMessage(commandName: string, result: unknown) {
  if (typeof result === "string" && result.trim()) return `${commandName}: ${result}`;
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.title === "string" && typeof record.type === "string") {
      return `${commandName}: ${record.type.replaceAll("_", " ")} “${record.title}” is ready.`;
    }
    if (typeof record.packId === "string") return `${commandName}: work pack “${record.packId}” is ready.`;
    if (typeof record.modelCount === "number") return `${commandName}: ${record.modelCount} work models are available.`;
    if (Array.isArray(record.automations)) return `${commandName}: ${record.automations.length} automation rules loaded.`;
    if (typeof record.rootId === "string") return `${commandName}: workspace content is ready.`;
  }
  return `${commandName}: completed.`;
}


function isConflictError(value: unknown): boolean {
  return messageOf(value).toLowerCase().includes("conflict");
}

function sortNotes(objects: PluginObject[]) {
  return [...objects].sort((left, right) => right.updated_at - left.updated_at);
}

/** Keep in step with `.core-slash-menu`'s max-height in core-only.css. */
const SLASH_MENU_MAX_HEIGHT = 288;
/** Built-in tree containers. Plugin-declared types with `behaviour.container`
 * in their schema are merged in at runtime — see `containerTypes` useMemo. */
const STATIC_CONTAINER_TYPES = new Set(["space", "folder", "project"]);
/** Fixed set of lucide glyphs a plugin type may name in its schema `icon`
 * (same closed-set approach as `navIcon`). Anything else falls back to the
 * generic puzzle piece. Kept small on purpose. */
const PLUGIN_TYPE_ICONS: Record<string, typeof Puzzle> = {
  "book-text": BookText,
  "book-marked": BookMarked,
  "book-copy": BookCopy,
  "pen-line": PenLine,
  user: User,
  "map-pin": MapPin,
  spline: Spline,
};
/** Object types a plugin owns end-to-end (its own surface, its own list) that
 * must never surface as a note. "habit" from notible.habits is the first:
 * each one is a bare `data.objects.create` record with no document body, and
 * showing it in the note tree read as an empty "Water" / "Meds" note nobody
 * wrote. Plugin types with `behaviour.treeHidden` are merged in at runtime —
 * see `treeHiddenTypes` useMemo. */
const STATIC_TREE_HIDDEN = new Set(["habit", "notification"]);

/** Read the optional `behaviour` block a plugin can put in a type's schema
 * JSON (Plugin API 1.12). Malformed / absent schema -> no flags. */
function behaviourOf(schema: string): { container?: boolean; treeHidden?: boolean } {
  try {
    const b = JSON.parse(schema)?.behaviour;
    return b && typeof b === "object" ? b : {};
  } catch { return {}; }
}
/** Slash commands whose inserted block ends with the caret outside any
 * editable text run (a quote/table/etc, not a heading/list where typing
 * continues on the same line) — see selectSlashCommand. */
const TERMINAL_BLOCK_COMMAND_IDS = new Set(["quote", "code-block", "columns", "calendar", "divider", "query", "table"]);
const SLASH_CARET_INSIDE: Record<string, number> = { "code-block": "```\n".length, link: "[".length, table: "| ".length };
/** Types that mount a plugin-owned surface instead of the plain note editor
 * (via containerSlot), beyond the true tree containers in containerTypes —
 * a whiteboard is a leaf object, not a container, so it stays out of the
 * container set itself (that set also drives "Add inside"/expand logic). */
function hasContainerSurface(type: string, containerTypes: Set<string>, tabTypes: Set<string>): boolean {
  if (type === "whiteboard" || type === "table" || STATIC_CONTAINER_TYPES.has(type)) return true;
  // A plugin-declared container type (manuscript, part, chapter…) only gets a
  // mounted surface when a plugin actually contributes a tab for it. Without a
  // tab it falls through to the plain note editor rather than the dead-end
  // "No active plugin contributes a view" panel — and the tree still nests its
  // children, since that is driven by `containerTypes`, not this.
  return containerTypes.has(type) && tabTypes.has(type);
}

function objectParentId(object: PluginObject) {
  return object.parent_id ?? null;
}

/** Sidebar grouping, not alphabetical: folders/workspaces first, then
 * projects, then everything else ("bezpańskie" — plain notes/tasks/etc with
 * no special container role). Requested explicitly over alphabetical or
 * recency sort. */
function categoryRank(type: string): number {
  if (type === "folder" || type === "space") return 0;
  if (type === "project") return 1;
  return 2;
}

/** Manual drag-to-reorder position within a (parent, category) group, or
 * `created_at` as the natural fallback so untouched siblings keep insertion
 * order instead of jumping around alphabetically. */
function objectOrder(object: PluginObject): number {
  try {
    const props = JSON.parse(object.props || "{}") as Record<string, unknown>;
    if (typeof props._order === "number") return props._order;
  } catch { /* ignore malformed props */ }
  return object.created_at;
}

function typeLabel(type: string) {
  // I18N (Hive #28): the kind banner above a note read "NOTE" in Polish too.
  if (type === "note") return tCore("Note");
  if (type === "space") return tCore("Workspace");
  if (type === "folder") return tCore("Folder");
  if (type === "project") return tCore("Project");
  // Namespaced plugin types (`notible.typewriter.chapter`) read as just their
  // last segment — the full dotted id is noise in a dropdown or kind banner.
  const bare = (type.includes(".") ? type.slice(type.lastIndexOf(".") + 1) : type).replaceAll("_", " ");
  // A plugin type whose name is already a catalogue key ("Task") is translated too.
  return tCore(bare.charAt(0).toUpperCase() + bare.slice(1));
}

function objectTypeLabel(object: PluginObject) {
  return typeLabel(object.type);
}



export function CoreOnlyApp({ matrixSlot, containerSlot, propertiesSlot, builtinCatalog }: CoreOnlyAppProps = {}) {
  const { t } = useCoreI18n();
  const [language, setLanguageChoice] = useState<CoreLanguage>(readCoreLanguage);
  // The native system tray is built in Rust before any webview exists, so it
  // starts in an English placeholder — this is what catches it up to the
  // user's actual language, once on mount and again on every language
  // change (`t`'s identity changes with `language`, see useCoreI18n).
  // Failure is silent: a tray stuck on its placeholder text costs nothing
  // the app itself needs to keep working.
  useEffect(() => {
    void setTrayTexts(t("Show Notible"), t("Quit"), t("Notible - a place for what matters")).catch(() => undefined);
  }, [t]);
  // Spell checking follows this language from the next start (E11, see
  // set_ui_language in lib.rs). Silent like the tray: it never blocks the app.
  useEffect(() => {
    void setUiLanguage(language).catch(() => undefined);
  }, [language]);
  // Installed translations, read once. Failure is silent on purpose: a broken
  // or absent locale folder must cost the user their translation, never the
  // application's start.
  const [installedLocales, setInstalledLocales] = useState<LocaleBundle[]>([]);
  /** Re-read installed languages after a pack is installed or removed. */
  const refreshLocales = useCallback(async () => {
    const bundles = await listLocales();
    setInstalledLocales(bundles);
    applyInstalledLocales(bundles);
  }, []);
  useEffect(() => {
    void listLocales().then((bundles) => {
      setInstalledLocales(bundles);
      applyInstalledLocales(bundles);
    }).catch(() => undefined);
  }, []);
  const [section, setSection] = useState<CoreSection>("notes");
  const [helpTarget, setHelpTarget] = useState<{ id: string; slug?: string }>({ id: "getting-started" });
  const [settingsSection, setSettingsSection] = useState<CoreSettingsSection>("appearance");
  const [pluginsTab, setPluginsTab] = useState<PluginsTab>("all");
  const [objects, setObjects] = useState<PluginObject[]>([]);
  /** Unfiltered workspace, for lookups that must not follow the search filter. */
  const [allObjects, setAllObjects] = useState<PluginObject[]>([]);
  const allObjectsRef = useRef(allObjects);
  allObjectsRef.current = allObjects;
  const [trashObjects, setTrashObjects] = useState<PluginObject[]>([]);
  /** Ids waiting for "Delete forever" confirmation (one item, or the whole trash). */
  const [purgeConfirm, setPurgeConfirm] = useState<{ ids: string[]; label: string } | null>(null);
  /** Registered object types (built-in + plugin), reloaded alongside `objects`.
   * Drives the runtime `containerTypes` / `treeHiddenTypes` behaviour sets. */
  const [loadedTypes, setLoadedTypes] = useState<PluginType[]>([]);
  const containerTypes = useMemo(() => {
    const s = new Set(STATIC_CONTAINER_TYPES);
    for (const type of loadedTypes) if (behaviourOf(type.schema).container) s.add(type.name);
    return s;
  }, [loadedTypes]);
  const treeHiddenTypes = useMemo(() => {
    const s = new Set(STATIC_TREE_HIDDEN);
    for (const type of loadedTypes) if (behaviourOf(type.schema).treeHidden) s.add(type.name);
    return s;
  }, [loadedTypes]);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupsDir, setBackupsDir] = useState("");
  const [backupRetention, setBackupRetentionState] = useState(10);
  const newestBackup = backups.length === 0 ? null : backups.reduce((latest, item) => item.modified_at > latest.modified_at ? item : latest);
  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null);
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Narrow windows (D5): the sidebar slides over the page; going anywhere closes it.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selected, setSelected] = useState<PluginObject | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // The filter chips show when asked for (F3), and stay while any filter is set.
  const [filtersShown, setFiltersShown] = useState(false);
  /** Structured search filters, applied on top of the free-text query.
   * Empty string = "any". A project/folder id in `container` narrows to that
   * subtree; `from`/`to` are yyyy-mm-dd strings compared against updated_at. */
  const [filters, setFilters] = useState({ kind: "", container: "", tag: "", from: "", to: "" });
  const filtersActive = filters.kind !== "" || filters.container !== "" || filters.tag !== "" || filters.from !== "" || filters.to !== "";
  const [dirty, setDirty] = useState(false);
  // A count, not a flag: when two operations overlap, the first to finish
  // must not clear the other's busy state. Saving the note and reloading the
  // list are NOT counted — see `saving` and reload().
  const [busyCount, setBusyCount] = useState(0);
  const busy = busyCount > 0;
  const setBusy = useCallback((on: boolean) => setBusyCount((count) => Math.max(0, count + (on ? 1 : -1))), []);
  const [saving, setSaving] = useState(false);
  // A brief "Saved" after a save lands: "Saving shortly…" fading out alone
  // never told anyone the note was safe (CW45, XW07).
  const [justSaved, setJustSaved] = useState(false);
  const wasSavingRef = useRef(false);
  useEffect(() => {
    if (saving) { wasSavingRef.current = true; setJustSaved(false); return; }
    if (!wasSavingRef.current) return;
    wasSavingRef.current = false;
    setJustSaved(true);
    const timer = window.setTimeout(() => setJustSaved(false), 1600);
    return () => window.clearTimeout(timer);
  }, [saving]);
  // The global "+" button disables while `busy` (creating/deleting/saving
  // objects) to stop double-clicks — correct, but most of those operations
  // (e.g. switching a Views layout) resolve in under 30ms, so the raw flag
  // flashed the button's disabled look on and off on nearly every click
  // anywhere in the app. Only show that visually once busy has actually
  // lasted a moment; still clears the instant it's done either way.
  const [busyVisible, setBusyVisible] = useState(false);
  useEffect(() => {
    if (!busy) { setBusyVisible(false); return; }
    const timer = setTimeout(() => setBusyVisible(true), 150);
    return () => clearTimeout(timer);
  }, [busy]);
  const [error, setError] = useState("");
  // A notice may carry one action (Undo after a delete, D10).
  const [notice, setNotice] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const [snapshots, setSnapshots] = useState(() => coreHost.getSnapshot());
  /** Object types some active plugin contributes a container tab for — drives
   * `hasContainerSurface` for plugin-declared container types. */
  const objectTabTypes = useMemo(() => {
    const s = new Set<string>();
    for (const snapshot of snapshots) for (const tab of snapshot.objectTabs ?? []) for (const type of tab.objectTypes) s.add(type);
    return s;
  }, [snapshots]);
  // Latest container/tab sets for code that runs outside a render (openObject
  // can be a stale closure — see its comment; refreshOpenNote runs from timers).
  const containerSetsRef = useRef<{ containerTypes: Set<string>; objectTabTypes: Set<string> }>({ containerTypes: new Set(), objectTabTypes: new Set() });
  containerSetsRef.current = { containerTypes, objectTabTypes };
  /** Namespaced object types a currently-enabled plugin provides — registered
   * via `data.types.upsert` this session, or implied by an object tab / prose
   * profile it registered. Disabling a plugin does NOT delete its `types`
   * rows, so `loadedTypes` alone can't tell a live type from a stranded one. */
  const providedTypes = useMemo(() => {
    const s = new Set<string>();
    for (const snapshot of snapshots) {
      for (const name of snapshot.providedTypes ?? []) s.add(name);
      for (const tab of snapshot.objectTabs ?? []) for (const type of tab.objectTypes) s.add(type);
      for (const p of snapshot.proseProfiles ?? []) for (const type of p.match?.types ?? []) s.add(type);
    }
    return s;
  }, [snapshots]);
  /** Namespaced types whose providing plugin is gone. Their objects are hidden
   * from the tree and the search list (kept in the DB — re-enabling the plugin
   * brings them straight back). Only dotted types can be orphaned; a bare
   * kernel type (`note`, `task`, …) is structurally safe. */
  const orphanTypes = useMemo(() => {
    const s = new Set<string>();
    for (const type of loadedTypes) {
      if (type.name.includes(".") && !providedTypes.has(type.name)) s.add(type.name);
    }
    return s;
  }, [loadedTypes, providedTypes]);
  /** The prose profile a plugin registered for the open note, if any. Resolves
   * by namespaced type first, then a `props[key] === value` predicate. A note
   * matching nothing keeps today's behaviour (dash-list on, theme font). */
  const selectedProps = useMemo(() => {
    try { return JSON.parse(selected?.props || "{}") as Record<string, unknown>; } catch { return {}; }
  }, [selected]);
  const proseProfile = useMemo(() => {
    if (!selected) return null;
    const profiles = snapshots.flatMap((snapshot) => snapshot.proseProfiles ?? []);
    const byType = profiles.find((entry) => entry.match.types?.includes(selected.type));
    if (byType) return byType;
    const byProp = profiles.find((entry) => entry.match.propEquals && selectedProps[entry.match.propEquals.key] === entry.match.propEquals.value);
    return byProp ?? null;
  }, [selected, snapshots, selectedProps]);
  const editorFont = useMemo(() => {
    const pr = proseProfile?.profile;
    if (!pr?.fontProp) return undefined;
    const raw = selectedProps[pr.fontProp];
    return (raw != null && pr.fontMap?.[String(raw)]) || undefined;
  }, [proseProfile, selectedProps]);
  // Long-form focus mode is not a second toggle: when the open note's prose
  // profile asks for it, Core's own focus mode (the Minimize2 button, which
  // already hides the sidebar / properties / toolbar chrome) also drives the
  // prose treatment — narrow measure, typewriter-centred caret, dimmed
  // paragraphs. One button, one concept.
  const focusModeAvailable = proseProfile?.profile.focusMode ?? false;
  // Focus mode is a Typewriter-only feature: the button itself only shows up
  // when the open note's prose profile asks for it, so there is no "raw"
  // toggle independent of availability to fall out of sync with.
  // Views registered through the public `views.register` API. Driven off the
  // same snapshot subscription as commands and slots, so enabling, disabling,
  // reloading or uninstalling a plugin adds and removes its nav entry live.
  const pluginViews = useMemo(() => corePluginViewItems(snapshots), [snapshots]);
  // Every registered view is a real, navigable section (openView, an object
  // tab's viewId) — `pluginViews` above stays unfiltered so those keep
  // resolving. A nav CARD next to "Notes" is opt-in (`nav: true`): most
  // registered views are one domain plugin's settings/config screen or an
  // object tab's target, and giving every one of those a top-level card is
  // how a workspace with a dozen active plugins gets a dozen identically-
  // iconed rows above the note tree. See ViewRegistration.nav in
  // packages/plugin-api.
  const navPluginViews = useMemo(() => pluginViews.filter((item) => item.registration.nav === true), [pluginViews]);
  // I18N (Hive #54): builtin titles are Core's own strings, so Core translates them.
  // An external plugin translates its own title (context.i18n); it never goes through t() here.
  const shownTitle = (pluginId: string, title: string) => (builtinCatalog?.some((manifest) => manifest.id === pluginId) ? t(title) : title);
  /** Two plugins may register the same title; show the owner when they do. */
  const ambiguousPluginViewTitles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of navPluginViews) counts.set(item.registration.title, (counts.get(item.registration.title) ?? 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([title]) => title));
  }, [navPluginViews]);
  const activePluginViewKey = pluginViewKeyOf(section);
  const activePluginView = pluginViews.find((item) => item.key === activePluginViewKey);
  const [pluginEntries, setPluginEntries] = useState<Awaited<ReturnType<typeof listPluginRegistry>>>([]);
  const [pluginBusy, setPluginBusy] = useState(false);
  // Which object opens automatically on launch — device-local (not synced),
  // one at a time: picking a new favourite replaces the old one.
  const [favouriteId, setFavouriteId] = useState<string | null>(() => localStorage.getItem("notible-core-favourite") || null);
  const triedFavouriteRef = useRef(false);
  const [themeChoice, setThemeChoice] = useState<CoreThemeChoice>(() => (localStorage.getItem("notible-core-theme") as CoreThemeChoice | null) ?? "paper");
  const systemDark = useSystemDark();
  const theme: CoreTheme = themeChoice === "system" ? (systemDark ? "night" : "paper") : themeChoice;
  const themePacks = useThemePacks();
  const activeThemePack = themePacks.packs.find((pack) => pack.id === themePacks.activeId) ?? null;
  /** A theme pack is drawn on its own base (light or dark); the Appearance choice comes back when it is off. */
  const effectiveTheme: CoreTheme = activeThemePack ? (activeThemePack.mode === "dark" ? "night" : "paper") : theme;
  // Notification sound (SND1), per device; None by default.
  const [noticeSound, setNoticeSound] = useState<NoticeSound>(readNoticeSound);
  useEffect(() => { try { localStorage.setItem(SOUND_KEY, noticeSound); } catch { /* this session only */ } }, [noticeSound]);
  // A plugin notification while Notible is in front: a notice here, with the sound (SND1).
  const showNoticeRef = useRef<(text: string) => void>(() => {});
  useEffect(() => {
    coreHost.setInAppNotice((text) => { showNoticeRef.current(text); playNoticeSound(); });
    return () => coreHost.setInAppNotice(null);
  }, []);
  // Interface size (L7), per device; applied once at start and on every change.
  const [zoom, setZoom] = useState(readZoom);
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; void applyZoom(zoom); }, [zoom]);
  const [codeLook, setCodeLook] = useState(readCodeLook);
  useEffect(() => applyCodeLook(codeLook), [codeLook]);
  const changeCodeLook = (patch: Partial<CodeLook>) => setCodeLook((current) => ({ ...current, ...patch }));
  const markDefault = (label: string, isDefault: boolean) => (isDefault ? t("{value} (default)", { value: label }) : label);
  const [density, setDensity] = useState<CoreDensity>(() => (localStorage.getItem("notible-core-density") as CoreDensity | null) ?? "comfortable");
  const [focusMode, setFocusMode] = useState<boolean>(() => localStorage.getItem("notible-core-focus") === "true");
  /** Prose treatment rides on Core's focus mode when the note's profile asks. */
  const focusModeOn = focusModeAvailable && focusMode;
  const draftVersion = useRef(0);
  // What this editor last loaded or saved — a conflict whose fresh row differs
  // from it was written by someone else (sync, a plugin).
  const lastPersistedRef = useRef<{ title: string; content: string }>({ title: "", content: "" });
  // A ref, not the `dirty` state: async callbacks must read today's value.
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const selectedIdRef = useRef<string | null>(null);
  const selectedUpdatedAtRef = useRef<number | undefined>(undefined);
  const titleRef = useRef("");
  // Set right after "+"-menu creation: the next render of that object puts the caret in its title with the default text selected, so typing names it.
  const focusTitleFor = useRef<string | null>(null);
  const bodyRef = useRef("");
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const lastSaveFailedRef = useRef(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [rowCreateMenuFor, setRowCreateMenuFor] = useState<{ id: string; x: number; y: number } | null>(null);
  const [modulePicker, setModulePicker] = useState<{
    kind: "project" | "folder" | "space";
    parentId?: string;
    pluginCreate?: { pluginId: string; command: CommandRegistration & { creates: NonNullable<CommandRegistration["creates"]> } };
  } | null>(null);
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null);
  // 1.7: deleting a tree row. A container (folder/project/space) needs two
  // warning screens naming the total descendant count before it commits,
  // since that action trashes every object underneath it too; a leaf note
  // needs only one.
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; step: 1 | 2 } | null>(null);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  // Row actions in a collection live under the right button (standing project
  // convention), which is also what keeps a collection row one line high.
  // Off unless the user turned it on. Both switches render in Settings →
  // Files & links. Read once when that section opens rather than at mount:
  // they are Settings-only controls and the command hits the DB.
  const [mediaSharing, setMediaSharingState] = useState(false);
  const [calendarSharing, setCalendarSharingState] = useState(false);
  useEffect(() => {
    if (section !== "settings" || settingsSection !== "files") return;
    void mediaSharingStatus().then(setMediaSharingState).catch(() => {});
    void calendarSharingStatus().then(setCalendarSharingState).catch(() => {});
  }, [section, settingsSection]);
  // The object whose version history panel is open, if any.
  // Hive #7: Core-owned recovery remains navigable with sync disabled.
  const [conflictCopyId, setConflictCopyId] = useState<string | undefined>();
  const [syncConflicts, setSyncConflicts] = useState<ConflictDescriptor[]>([]);
  function conflictCopyFor(id: string) {
    const direct = syncConflicts.find(d => d.copyId === id);
    if (direct) return direct.copyId;
    const related = syncConflicts.filter(d => d.originalId === id);
    return related.length === 1 ? related[0].copyId : undefined;
  }
  const openSyncConflictsRef = useRef<(copyId?:string)=>Promise<void>>(async()=>{});
  openSyncConflictsRef.current = async (copyId) => {
    await flushPendingSaveStrict(); setConflictCopyId(copyId); setSection("sync-conflicts");
  };
  useEffect(() => {
    const refresh = () => { void conflictDescriptors().then(setSyncConflicts).catch(showError); };
    refresh(); window.addEventListener("notible:workspace-changed",refresh);
    return () => window.removeEventListener("notible:workspace-changed",refresh);
  }, []);
  const [historyFor, setHistoryFor] = useState<PluginObject | null>(null);
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; items: { label: string; danger?: boolean; run: () => void }[] } | null>(null);
  const [statsEnabled, setStatsEnabled] = useState(() => localStorage.getItem("notible-core-stats") !== "false");
  const [printOptions, setPrintOptions] = useState<CorePrintOptions>(() => {
    try { return normalizeCorePrintOptions(JSON.parse(localStorage.getItem("notible-core-print") ?? "{}")); } catch { return CORE_PRINT_DEFAULTS; }
  });
  const [selectedRelations, setSelectedRelations] = useState<PluginRelation[]>([]);
  const [sidebarTreeMode, setSidebarTreeMode] = useState<SidebarTreeMode>(readSidebarTreeMode);
  // Async creation/move callbacks must use the current preference too.
  const sidebarTreeModeRef = useRef(sidebarTreeMode);
  sidebarTreeModeRef.current = sidebarTreeMode;
  useEffect(() => { saveSidebarTreeMode(sidebarTreeMode); }, [sidebarTreeMode]);
  // Remembered across restarts (N8): a tree that folds itself up on every
  // start makes people re-open the same folders each morning.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("notible-core-expanded") ?? "[]") as string[]); } catch { return new Set(); }
  });
  useEffect(() => { try { localStorage.setItem("notible-core-expanded", JSON.stringify([...expandedIds])); } catch { /* not remembered */ } }, [expandedIds]);
  function revealInSidebar(ids: readonly string[]) {
    setExpandedIds((current) => expandSidebarTree(current, ids, sidebarTreeModeRef.current));
  }
  /** Drag over a row: its top quarter puts the item above it, the rest puts it inside (N7). */
  const [dragMode, setDragMode] = useState<"before" | "inside">("before");
  /** The row being renamed in place (N6: Rename, F2, double-click). */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [rowExportOpen, setRowExportOpen] = useState(false);
  /** Below 1200 px the Properties panel is folded behind a toolbar button (V-SURFACES-01). */
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [rowNewOpen, setRowNewOpen] = useState(false);
  const [createAtTop, setCreateAtTop] = useState(false);
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const importJsonRef = useRef<HTMLInputElement | null>(null);
  /** Which object "Import here…" was chosen on; null means top level. */
  const importTargetRef = useRef<string | null>(null);
  const rowCreateMenuRef = useRef<HTMLDivElement | null>(null);
  const movePickerRef = useRef<HTMLDivElement | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);
  const sidebarSearchRef = useRef<HTMLInputElement | null>(null);
  // B6: slash-command trigger inside the note body textarea (see the slash
  // menu detection/selection helpers and render block near the editor).
  const [useLegacyContainer, setUseLegacyContainer] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  /** The same popup serves "/" commands and "[[" note links. One menu, because
   * two would need two carets, two key handlers and two ways to be dismissed. */
  const [menuMode, setMenuMode] = useState<"command" | "wikilink">("command");
  const [slashFilter, setSlashFilter] = useState("");
  const [slashRange, setSlashRange] = useState<{ start: number; end: number } | null>(null);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashMenuPosition, setSlashMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const bodyEditorRef = useRef<HTMLDivElement | null>(null);
  // The menu is positioned against this element, so the caret maths must use it
  // too. It used to use `editor.parentElement`, which is `.core-editor-content-wrap`
  // — `display: contents`, so its rect is all zeros and the menu landed at an
  // arbitrary spot well below the caret.
  const bodyWrapRef = useRef<HTMLDivElement | null>(null);
  // Where the caret must land once the editor has re-rendered the document a
  // slash command just changed. requestAnimationFrame is not enough: it can
  // still run before React commits, and the caret then lands against the old
  // DOM (that is how typing ended up on the wrong side of a task checkbox, or
  // nowhere at all). A child's effects run before its parent's, so an effect
  // keyed on `body` here is guaranteed to see the new HTML.
  const pendingCaretRef = useRef<number | null>(null);

  // Real navigation history (B5): every explicit section/settings-section nav
  // click pushes the current location so "Back" can unwind more than one
  // level, instead of always jumping straight to Notes.
  const historyRef = useRef<Array<{ section: CoreSection; settingsSection?: CoreSettingsSection }>>([]);
  useEffect(() => { setSidebarOpen(false); }, [section, selectedId]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setSidebarOpen(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sidebarOpen]);

  function navigateToSection(next: CoreSection) {
    historyRef.current.push({ section, settingsSection });
    setSection(next);
  }
  function navigateToSettingsSection(next: CoreSettingsSection, tab?: PluginsTab) {
    historyRef.current.push({ section, settingsSection });
    setSettingsSection(next);
    if (next === "plugins" && tab) setPluginsTab(tab);
    setSection("settings");
  }
  function openHelp(id = "getting-started", slug?: string) {
    setHelpTarget({ id, slug });
    // Help has its own contents; an open search only crowds it (V-SCREENS-01).
    if (searchOpen) closeSearch();
    // Page-to-page moves inside Help push no history: one Back leaves Help.
    if (section !== "help") navigateToSection("help");
  }
  // The global hotkey effect is registered once ([] deps); read the current
  // openHelp through a ref so F1 never pushes a stale section into history.
  const openHelpRef = useRef(openHelp);
  openHelpRef.current = openHelp;
  const navigateToSettingsSectionRef = useRef(navigateToSettingsSection);
  navigateToSettingsSectionRef.current = navigateToSettingsSection;
  const openObjectRef = useRef(openObject);
  openObjectRef.current = openObject;
  // A plugin view can have its own internal sub-states (ReportIt's builder vs.
  // generated-preview screen) that never touch `section`, so the history stack
  // above knows nothing about them. Without this, Back skips straight past
  // them to whatever section was open before the plugin view, which reads as
  // "Back ignored the screen I'm actually looking at". A plugin registers a
  // guard while it has such a sub-state to unwind; the guard returns true to
  // consume the Back press (and is expected to update its own DOM), or false
  // to let normal section history apply.
  const pluginBackGuardRef = useRef<(() => boolean) | null>(null);
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ handler: (() => boolean) | null }>).detail;
      pluginBackGuardRef.current = detail?.handler ?? null;
    };
    window.addEventListener("notible:plugin-back-guard", listener);
    return () => window.removeEventListener("notible:plugin-back-guard", listener);
  }, []);
  function goBack() {
    if (pluginBackGuardRef.current?.()) return;
    let previous = historyRef.current.pop();
    // Back from Settings leaves Settings. Walking back through every section
    // clicked on the way (Plugins → Appearance → …) read as a dead button.
    if (section === "settings" || section === "help") while (previous?.section === section) previous = historyRef.current.pop();
    if (previous) {
      setSection(previous.section);
      if (previous.section === "settings" && previous.settingsSection) setSettingsSection(previous.settingsSection);
    } else {
      setSection("notes");
    }
  }

  // TODO(plugins): folder / .zip / scaffold install UI was removed from
  // Settings in 0.71.7. The handlers (`installPluginFolder`,
  // `installPluginPackage`, `createPluginFolder`) stay wired but nothing
  // calls them from the UI any more, so there is now NO way to sideload a
  // local plugin for testing — every install has to go through the market.
  // Re-add the three actions somewhere on the Plugins screen: a small
  // "Developer" affordance in About (next to Developer pack), or an
  // "Advanced" row under the Market tab. This `void` keeps them from tripping
  // noUnusedLocals until then.
  void [installPluginFolder, installPluginPackage, createPluginFolder];

  // The detail pane lives beside the Settings shell (3rd grid column). The
  // plugin list slot portals the selected plugin's detail into it.
  const [pluginsDetailEl, setPluginsDetailEl] = useState<HTMLElement | null>(null);

  // Shown in the plugin detail pane when nothing is selected: just the hint.
  // A plugin's own settings live in its detail (see PluginDetail); Core-level
  // preferences that used to sit here moved to Editor / Files & links.
  const pluginsEmptyState = (
    <div className="core-plugin-detail is-empty">
      <p className="core-matrix-hint">{t("Pick a plugin from the list to see what it does, its instructions, and its settings.")}</p>
    </div>
  );

  const pluginsMatrixNode = matrixSlot?.({
    tab: pluginsTab,
    entries: pluginEntries.filter((entry) => !isThemePackEntry(entry.manifest)),
    detailContainer: pluginsDetailEl,
    emptyState: pluginsEmptyState,
    onToggleLocal: (pluginId) => { const entry = pluginEntries.find((item) => item.plugin_id === pluginId); if (entry) void changePluginState(entry, entry.state === "active" ? "disabled" : "active"); },
    onReloadLocal: (pluginId) => { const entry = pluginEntries.find((item) => item.plugin_id === pluginId); if (entry) void reloadPlugin(entry); },
    onRemoveLocal: (pluginId) => { const entry = pluginEntries.find((item) => item.plugin_id === pluginId); if (entry) void uninstallPlugin(entry); },
    onError: showError,
    onInstall: (installPath, sourceUrl) => installFromRoot(installPath, "package", sourceUrl),
  });

  // Generic, plugin-driven "+" menu: any active plugin can opt a command
  // into first-class object creation next to "New note"/"New folder" simply
  // by attaching `creates` metadata to its CommandRegistration (see
  // packages/plugin-api). Core never hardcodes plugin- or type-specific
  // knowledge here — a pure-Core workspace with no plugins active naturally
  // yields an empty list, since `snapshots` then has no commands at all.
  const creatableCommands = useMemo(
    () =>
      snapshots.flatMap((snapshot) =>
        snapshot.commands
          .filter((command): command is CommandRegistration & { creates: NonNullable<CommandRegistration["creates"]> } => Boolean(command.creates))
          .map((command) => ({ pluginId: snapshot.pluginId, command })),
      ),
    [snapshots],
  );
  // The twin of `creatableCommands`, for commands that act on an object that
  // already exists: they appear in the right-click menu of a row whose type
  // matches `objectMenu.objectTypes` (all rows when the list is omitted).
  //
  // `objectMenu` arrives from plugin code and is spread into the snapshot
  // unvalidated, so it is checked here rather than trusted: a bad shape is
  // dropped, not rendered. (A union in the .d.ts proves nothing at runtime —
  // that is exactly how data.sync shipped broken in 0.48.0.)
  const objectMenuCommands = useMemo(() => objectMenuEntries(snapshots), [snapshots]);
  // API 1.22: plugins offering a corner helper, and who sits there now.
  const cornerHelpers = useMemo(() => cornerCandidates(snapshots), [snapshots]);
  const [cornerChoice, setCornerChoice] = useCornerChoice();
  const cornerOccupant = pickCornerOccupant(cornerHelpers, cornerChoice);
  // B6: all active plugin commands, used by the in-note "/" trigger — unlike
  // creatableCommands above, this is not restricted to commands that create
  // objects — but it is restricted to commands that do something *here*.
  //
  // Every plugin registers diagnostics ("Show search status", "Install work
  // models", "Manage automations"). They belong in the command palette; in a
  // note they either do nothing visible or open a screen that is not where
  // the caret is, which is exactly the "half of these commands make no sense"
  // complaint. A command earns a place in "/" by writing into the note (Core's
  // own) or by creating an object (`creates`), which the "+" menu already
  // treats as first-class.
  const allCommands = useMemo(
    () => [
      ...CORE_COMMANDS
        .filter((command) => { const needs = CORE_COMMAND_REQUIRES[command.id]; return !needs || snapshots.some((snapshot) => snapshot.pluginId === needs); })
        .map((command) => ({ pluginId: CORE_COMMAND_SOURCE, command })),
      ...CODE_FORMAT_COMMANDS.map((command) => ({ pluginId: CORE_COMMAND_SOURCE, command })),
      ...snapshots.flatMap((snapshot) => snapshot.commands.filter((command) => (command.creates && command.creates.slashMenu !== false) || command.insertsBlock).map((command) => ({ pluginId: snapshot.pluginId, command }))),
    ],
    [snapshots],
  );
  const wikilinkMatches = useMemo(() => {
    if (!slashMenuOpen || menuMode !== "wikilink") return [];
    // allObjects, not objects: the picker must offer the whole workspace, not
    // whatever the sidebar search happens to be filtered to.
    return wikilinkSuggestions(slashFilter, allObjects.filter((object) => object.id !== selectedId));
  }, [allObjects, menuMode, selectedId, slashFilter, slashMenuOpen]);
  const slashMatches = useMemo(() => {
    if (!slashMenuOpen || menuMode !== "command") return [];
    const needle = slashFilter.trim().toLocaleLowerCase();
    // CODE-FORMAT (Hive #35): code block tools only inside a code block.
    return allCommands
      .filter(({ command }) => codeFormatCommandOffered(command.id, body, slashRange?.start ?? -1))
      .filter(({ pluginId, command }) => !needle || command.name.toLocaleLowerCase().includes(needle) || t(command.name).toLocaleLowerCase().includes(needle) || command.id.toLocaleLowerCase().includes(needle) || pluginId.toLocaleLowerCase().includes(needle) || (command.description ?? "").toLocaleLowerCase().includes(needle))
      .slice(0, 40);
  }, [allCommands, body, menuMode, slashFilter, slashMenuOpen, slashRange, t]);

  /** Detects an unclosed "/query" token immediately before the cursor, on
   * the current line, with no whitespace inside it — e.g. "/manage" narrows
   * to "Manage automations". Returns null when there is nothing to trigger
   * on (no leading "/", or the token contains whitespace). */
  function detectSlashTrigger(value: string, cursor: number): { start: number; end: number; filter: string } | null {
    const uptoCursor = value.slice(0, cursor);
    const breakIndex = Math.max(uptoCursor.lastIndexOf("\n"), uptoCursor.lastIndexOf(" "));
    const start = breakIndex + 1;
    const token = uptoCursor.slice(start);
    if (token.startsWith("/") && !/\s/.test(token.slice(1))) return { start, end: cursor, filter: token.slice(1) };
    // A space may continue a match while it still names a command:
    // "/heading 1" keeps the menu on "Heading 1" (E13).
    const line = uptoCursor.slice(uptoCursor.lastIndexOf("\n") + 1);
    const slash = /(?:^|\s)\/([^/\n]*)$/u.exec(line);
    if (!slash || !/\s/u.test(slash[1]) || /\s\s|^\s/u.test(slash[1])) return null;
    const filter = slash[1];
    const needle = filter.toLocaleLowerCase();
    if (!allCommands.some(({ command }) => command.name.toLocaleLowerCase().startsWith(needle))) return null;
    return { start: cursor - filter.length - 1, end: cursor, filter };
  }

  /** Position the menu against the real contenteditable caret. */
  const updateSlashMenuPosition = useCallback(() => {
    const editor = bodyEditorRef.current;
    const wrap = bodyWrapRef.current;
    const selection = window.getSelection();
    if (!editor || !wrap || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const wrapRect = wrap.getBoundingClientRect();
    const markerRect = range.getBoundingClientRect();
    const menuWidth = Math.min(420, Math.max(0, wrap.clientWidth - 12));
    const maxLeft = Math.max(6, wrap.clientWidth - menuWidth - 6);
    const left = Math.min(maxLeft, Math.max(6, markerRect.left - wrapRect.left));
    const belowTop = markerRect.bottom - wrapRect.top + 6;
    const menuHeight = Math.min(SLASH_MENU_MAX_HEIGHT, Math.max(140, wrap.clientHeight - 12));
    // Room is measured against the window, not the wrap: in a short note the
    // wrap ends just under the text, which flipped the menu above the caret
    // even with the whole screen free below (E13).
    const roomBelow = window.innerHeight - markerRect.bottom - 6;
    const roomAbove = markerRect.top - Math.max(0, wrapRect.top) - 6;
    const top = roomBelow >= menuHeight || roomBelow >= roomAbove
      ? belowTop
      : Math.max(6, markerRect.top - wrapRect.top - menuHeight - 6);

    setSlashMenuPosition({ top, left });
  }, []);

  function closeSlashMenu() {
    setSlashMenuOpen(false);
    setMenuMode("command");
    setSlashFilter("");
    setSlashRange(null);
    setSlashActiveIndex(0);
    setSlashMenuPosition(null);
  }

  /** Replace the trigger token with `text` and put the caret after it. Shared by
   * both menu modes so the caret bookkeeping exists once. */
  function replaceTriggerWith(text: string) {
    if (!slashRange) {
      requestAnimationFrame(() => bodyEditorRef.current?.focus());
      return;
    }
    const nextBody = body.slice(0, slashRange.start) + text + body.slice(slashRange.end);
    draftVersion.current += 1;
    bodyRef.current = nextBody;
    setBody(nextBody);
    setDirty(true);
    setSlashInsertNonce((current) => current + 1);
    pendingCaretRef.current = slashRange.start + text.length;
  }

  function applyTitle(value: string) {
    draftVersion.current += 1;
    titleRef.current = value;
    setTitle(value);
    setSelected((current) => current ? { ...current, title: value } : current);
    setObjects((current) => current.map((item) => item.id === selectedIdRef.current ? { ...item, title: value } : item));
    // Backlinks and [[link]] labels read allObjects, which only a reload
    // refreshed, so they kept the old title ("Untitled note", CP61).
    setAllObjects((current) => current.map((item) => item.id === selectedIdRef.current ? { ...item, title: value } : item));
    setDirty(true);
  }

  /** Enter in the title goes to the start of the body, like Tab. Text after
   * the caret goes with it as the body's first line (E1). */
  function enterBodyFromTitle(field: HTMLTextAreaElement) {
    const editable = bodyWrapRef.current?.querySelector<HTMLElement>(".core-editor-content");
    if (!editable) return; // container pages (projects, boards) have no body
    const tail = field.value.slice(field.selectionEnd).trim();
    if (!tail) {
      placeCaretAtMarkdownOffset(editable, 0);
      return;
    }
    applyTitle(field.value.slice(0, field.selectionStart).trimEnd());
    const nextBody = body ? `${tail}\n${body}` : tail;
    bodyRef.current = nextBody;
    setBody(nextBody);
    setSlashInsertNonce((current) => current + 1);
    pendingCaretRef.current = 0;
  }

  function selectWikilink(object: PluginObject) {
    // The title is written into the note, so a later rename leaves the link
    // pointing at a title that no longer exists. That is the same trade the
    // Markdown body makes everywhere else: what is stored is what is readable.
    replaceTriggerWith(`[[${object.title || "Untitled note"}]]`);
    closeSlashMenu();
  }

  useEffect(() => {
    if (!slashMenuOpen) return;
    const syncPosition = () => updateSlashMenuPosition();
    syncPosition();
    window.addEventListener("resize", syncPosition);
    return () => window.removeEventListener("resize", syncPosition);
  }, [slashFilter, slashMenuOpen, updateSlashMenuPosition]);

  /** "/Image": a picture from a file goes where the command was typed, stored
   * the same way as a pasted one (E14). */
  async function insertImageFromFile(at: number) {
    const noteId = selectedIdRef.current;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    const file = await new Promise<File | null>((resolve) => {
      input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
      input.addEventListener("cancel", () => resolve(null));
      input.click();
    });
    if (!file || selectedIdRef.current !== noteId) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const ext = (file.type.split("/")[1] || "png").toLowerCase();
      const markdown = `![${file.name.replace(/[[\]]/gu, "")}](${collapseMediaReference(await saveMedia(btoa(binary), ext))})`;
      if (selectedIdRef.current !== noteId) return;
      const current = bodyRef.current;
      const position = Math.min(at, current.length);
      const nextBody = current.slice(0, position) + markdown + current.slice(position);
      draftVersion.current += 1;
      bodyRef.current = nextBody;
      setBody(nextBody);
      setDirty(true);
      setSlashInsertNonce((value) => value + 1);
      pendingCaretRef.current = position + markdown.length;
    } catch (value) {
      showError(value);
    }
  }

  // E14B-SLASH-BLOCK (Hive #2): a plugin's "/" block. execute() runs once and
  // is awaited; if the user moved to another note or kept typing meanwhile, the
  // result is dropped rather than pasted into the wrong place. No
  // runPluginCommand: no second execute, no notice, no reload.
  async function insertPluginBlock(entry: { pluginId: string; command: CommandRegistration }, range: { start: number; end: number }) {
    const language = entry.command.insertsBlock?.language ?? "";
    const noteId = selectedIdRef.current;
    const version = draftVersion.current;
    let source: unknown;
    try { source = await entry.command.execute(); } catch (value) { showError(value); return; }
    if (selectedIdRef.current !== noteId || draftVersion.current !== version || typeof source !== "string") return;
    const inserted = pluginBlockInsertion(bodyRef.current, range.start, range.end, language, source);
    if (!inserted) return;
    draftVersion.current += 1;
    bodyRef.current = inserted.body;
    setBody(inserted.body);
    setDirty(true);
    setSlashInsertNonce((current) => current + 1);
    pendingCaretRef.current = inserted.caret;
  }
  function selectSlashCommand(entry: { pluginId: string; command: CommandRegistration }) {
    // CODE-FORMAT (Hive #35): rewrite the code block the "/" was typed in.
    if (entry.pluginId === CORE_COMMAND_SOURCE && entry.command.id.startsWith(CODE_FORMAT_COMMAND)) {
      const formatted = slashRange ? codeFormatInBody(body, slashRange.start, slashRange.end, entry.command.id.slice(CODE_FORMAT_COMMAND.length) as CodeFormatAction) : null;
      if (formatted) {
        if (formatted.error) showNotice(t(formatted.error.error, formatted.error.values));
        draftVersion.current += 1;
        bodyRef.current = formatted.body;
        setBody(formatted.body);
        setDirty(true);
        setSlashInsertNonce((current) => current + 1);
        pendingCaretRef.current = formatted.caret;
      }
      closeSlashMenu();
      return;
    }
    if (entry.pluginId !== CORE_COMMAND_SOURCE && entry.command.insertsBlock) {
      if (slashRange) void insertPluginBlock(entry, slashRange);
      closeSlashMenu();
      return;
    }
    const replacement = entry.pluginId === CORE_COMMAND_SOURCE ? entry.command.execute() : "";
    if (slashRange) {
      let insertion = typeof replacement === "string" ? replacement : "";
      // Quote/code/table/columns/calendar/divider all end with the caret
      // OUTSIDE any editable text run. renderCoreMarkdown skips blank
      // lines entirely (no <p> for them), so with nothing after the
      // inserted block, clicking "below" it just lands back inside the
      // block itself — there's nowhere else to go. When the command is
      // one of these and nothing follows in the note, append an empty
      // paragraph placeholder so a normal typing spot actually exists.
      if (entry.pluginId === CORE_COMMAND_SOURCE && TERMINAL_BLOCK_COMMAND_IDS.has(entry.command.id) && !body.slice(slashRange.end).trim()) {
        insertion += `\n${String.fromCharCode(0x200b)}`;
      }
      const nextBody = body.slice(0, slashRange.start) + insertion + body.slice(slashRange.end);
      // Where the caret lands inside a block that needs typing into: a code
      // block's empty line (after it, code became plain paragraphs, E9), a
      // link's text, a table's first cell (E14).
      const caretInside = entry.pluginId === CORE_COMMAND_SOURCE ? SLASH_CARET_INSIDE[entry.command.id] : undefined;
      const caretTarget = slashRange.start + (caretInside ?? insertion.length);
      if (entry.pluginId === CORE_COMMAND_SOURCE && entry.command.id === "image") void insertImageFromFile(slashRange.start);
      draftVersion.current += 1;
      bodyRef.current = nextBody;
      setBody(nextBody);
      setDirty(true);
      setSlashInsertNonce((current) => current + 1);
      pendingCaretRef.current = caretTarget;
    } else {
      requestAnimationFrame(() => bodyEditorRef.current?.focus());
    }
    closeSlashMenu();
    if (entry.pluginId !== CORE_COMMAND_SOURCE) void runPluginCommand(entry.pluginId, entry.command);
  }
  // Where the open item lives (N1, N11): its containers, outermost first.
  const selectedPath = useMemo(() => {
    const path: PluginObject[] = [];
    let parentId = selected ? objectParentId(selected) : null;
    while (parentId && path.length < 20) {
      const parent = allObjects.find((object) => object.id === parentId) ?? objects.find((object) => object.id === parentId);
      if (!parent) break;
      path.unshift(parent);
      parentId = objectParentId(parent);
    }
    return path;
  }, [allObjects, objects, selected]);
  // Auto mode reveals the open item (N11); Manual keeps the user's tree.
  useEffect(() => {
    if (selectedPath.length === 0) return;
    revealInSidebar(selectedPath.map((ancestor) => ancestor.id));
  }, [selectedPath, sidebarTreeMode]);
  const selectedText = selected ? textFromDocument(selected.content) : "";
  const backlinks = useMemo(() => resolveBacklinks(selected, allObjects, selectedRelations), [allObjects, selected, selectedRelations]);
  const wikilinkTitle = useCallback((target: string) => {
    const object = resolveWikilinkTarget(target, allObjects);
    return object ? object.title || t("Untitled note") : null;
  }, [allObjects, t]);
  const noteStats = useMemo(() => ({
    backlinks: backlinks.length,
    words: countWords(selectedText),
    characters: selectedText.length,
  }), [backlinks.length, selectedText]);
  const sortedObjects = useMemo(() => sortNotes(objects), [objects]);
  // The tree itself must stay in a stable order — sorting it by updated_at
  // (recency) reshuffled the whole sidebar on every keystroke, since
  // autosave bumps updated_at while typing (recency sort is only
  // appropriate for the flat search-results list below), and alphabetical
  // ignores the folders-then-projects-then-everything-else hierarchy and
  // any manual drag order. So: category rank first, then manual order
  // (drag position, falling back to creation order for untouched items).
  // The sidebar TREE (and only the tree) excludes treeHidden types. The Core
  // note search list is built from `sortedObjects` (unfiltered `objects`), so
  // hidden types stay linkable / searchable / backlink-resolvable — the filter
  // is applied here at render, never in reload().
  const treeOrderObjects = useMemo(() => [...objects]
    .filter((object) => !treeHiddenTypes.has(object.type) && !orphanTypes.has(object.type))
    .sort((left, right) => {
      const rankDiff = categoryRank(left.type) - categoryRank(right.type);
      if (rankDiff !== 0) return rankDiff;
      return objectOrder(left) - objectOrder(right);
    }), [objects, treeHiddenTypes, orphanTypes]);
  const visibleObjects = useMemo(() => {
    // yyyy-mm-dd → ms at local midnight; NaN if empty/unparseable (no bound).
    const dayStartMs = (value: string) => value ? new Date(`${value}T00:00:00`).getTime() : NaN;
    // Search list: hide objects of a stranded plugin type (a tree-hidden type
    // like a habit stays searchable as before — only orphans drop out).
    if (query.trim() || filtersActive) {
      // `filters.container` narrows to a subtree: collect that container's
      // descendant ids from the unfiltered parent map (independent of what
      // the text query left in `objects`).
      let subtree: Set<string> | null = null;
      if (filters.container) {
        subtree = new Set<string>();
        const childrenOf = new Map<string | null, string[]>();
        for (const object of allObjects) {
          const parent = objectParentId(object);
          const bucket = childrenOf.get(parent) ?? [];
          bucket.push(object.id);
          childrenOf.set(parent, bucket);
        }
        const stack = [filters.container];
        while (stack.length) {
          const id = stack.pop()!;
          for (const child of childrenOf.get(id) ?? []) if (!subtree.has(child)) { subtree.add(child); stack.push(child); }
        }
      }
      const fromMs = dayStartMs(filters.from);
      const toMs = dayStartMs(filters.to);
      return sortedObjects
        .filter((object) => !orphanTypes.has(object.type))
        .filter((object) => {
          if (filters.kind && object.type !== filters.kind) return false;
          if (subtree && !subtree.has(object.id)) return false;
          if (filters.tag) {
            try {
              const tags = (JSON.parse(object.props || "{}") as { tags?: unknown }).tags;
              if (!Array.isArray(tags) || !tags.includes(filters.tag)) return false;
            } catch { return false; }
          }
          if (!Number.isNaN(fromMs) && object.updated_at < fromMs) return false;
          if (!Number.isNaN(toMs) && object.updated_at > toMs + 86_400_000) return false;
          return true;
        })
        .map((object) => ({ object, depth: 0 }));
    }
    const byParent = new Map<string | null, PluginObject[]>();
    for (const object of treeOrderObjects) {
      const parent = objectParentId(object);
      const bucket = byParent.get(parent) ?? [];
      bucket.push(object);
      byParent.set(parent, bucket);
    }
    const result: Array<{ object: PluginObject; depth: number }> = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const object of byParent.get(parentId) ?? []) {
        result.push({ object, depth });
        if (containerTypes.has(object.type) && expandedIds.has(object.id)) walk(object.id, depth + 1);
      }
    };
    walk(null, 0);
    // B2: the walk above only visits objects reachable through expanded
    // containers, so children of a collapsed-but-existing folder never
    // appear here — that is correct, they should stay hidden until the
    // folder is expanded. Only true orphans (parent id does not exist in
    // the workspace at all) get a fallback depth-0 row; anything whose
    // parent does exist just isn't visible yet, not a duplicate to flatten.
    const knownIds = new Set(treeOrderObjects.map((object) => object.id));
    const included = new Set(result.map((item) => item.object.id));
    for (const object of treeOrderObjects) {
      if (included.has(object.id)) continue;
      const parent = objectParentId(object);
      if (parent && knownIds.has(parent)) continue;
      result.push({ object, depth: 0 });
    }
    return result;
  }, [expandedIds, query, filters, filtersActive, allObjects, sortedObjects, treeOrderObjects, containerTypes, orphanTypes]);
  /** Option lists for the search filter row, from the whole workspace. */
  const filterOptions = useMemo(() => {
    const kinds = new Set<string>();
    const tags = new Set<string>();
    const containers: Array<{ id: string; title: string }> = [];
    for (const object of allObjects) {
      if (!orphanTypes.has(object.type)) kinds.add(object.type);
      // "Anywhere" scopes search to a workspace LOCATION — a Space/Folder/
      // Project — not every `behaviour.container` type. Plugin types like
      // Typewriter's Chapter/Part are containers too (they nest Scenes/
      // Chapters, and belong in the Move-to picker and tree), but they are
      // document structure, not places a person thinks of as "where" a note
      // lives, so they stay out of this specific dropdown.
      if (STATIC_CONTAINER_TYPES.has(object.type)) containers.push({ id: object.id, title: object.title || "Untitled" });
      try {
        const raw = (JSON.parse(object.props || "{}") as { tags?: unknown }).tags;
        if (Array.isArray(raw)) for (const tag of raw) if (typeof tag === "string" && tag.trim()) tags.add(tag);
      } catch { /* malformed props */ }
    }
    return {
      kinds: [...kinds].sort((a, b) => a.localeCompare(b)),
      tags: [...tags].sort((a, b) => a.localeCompare(b)),
      containers: containers.sort((a, b) => a.title.localeCompare(b.title)),
    };
  }, [allObjects, containerTypes, orphanTypes]);

  useEffect(() => {
    const listener = coreHost.onChange(() => setSnapshots(coreHost.getSnapshot()));
    return () => listener.dispose();
  }, []);

  // Disabling or uninstalling the plugin you are looking at must not leave an
  // empty pane behind. Unmounting the pane is also what disposes the mount.
  useEffect(() => {
    if (activePluginViewKey && !activePluginView) setSection("notes");
  }, [activePluginViewKey, activePluginView]);

  useEffect(() => {
    const listener = () => setSettingsSection("appearance");
    window.addEventListener("notible:core-settings-back", listener);
    return () => window.removeEventListener("notible:core-settings-back", listener);
  }, []);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ section?: CoreSection; settingsSection?: CoreSettingsSection }>).detail;
      if (detail?.settingsSection) navigateToSettingsSection(detail.settingsSection);
      else if (detail?.section) navigateToSection(detail.section);
    };
    window.addEventListener("notible:core-settings-navigate", listener);
    return () => window.removeEventListener("notible:core-settings-navigate", listener);
  }, []);

  useEffect(() => {
    localStorage.setItem("notible-core-theme", themeChoice);
  }, [themeChoice]);
  useEffect(() => { coreHost.emit("theme.changed", { mode: effectiveTheme }); }, [effectiveTheme]);
  useEffect(() => { localStorage.setItem("notible-core-density", density); }, [density]);
  useEffect(() => { localStorage.setItem("notible-core-focus", String(focusMode)); }, [focusMode]);
  // Leaving the Typewriter note the toggle was turned on for drops the
  // feature's availability; clear the toggle itself so it doesn't silently
  // re-arm (chrome hidden with no way to see it) the next time a Typewriter
  // note is opened.
  useEffect(() => { if (!focusModeAvailable && focusMode) setFocusMode(false); }, [focusModeAvailable, focusMode]);
  // Capture both complete layouts and interpolate their snapshots as one continuous transition.
  const toggleFocusMode = useCallback(() => {
    const apply = () => setFocusMode((current) => !current);
    const documentWithTransitions = document as Document & {
      startViewTransition?: (update: () => void) => { finished: Promise<void> };
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !documentWithTransitions.startViewTransition) {
      apply();
      return;
    }
    // `.core-main`/`.core-sidebar` only need `view-transition-name` for the
    // few hundred ms a transition is actually running — see the
    // `.core-transitioning` scoped rules in core-only.css. Tagging them
    // permanently (the old, simpler way) made Chromium/WebView2 treat those
    // elements as always-promoted compositing layers: a fixed-position
    // context menu positioned elsewhere in the DOM could render underneath
    // `.core-main` regardless of z-index, and any unrelated animation inside
    // it (e.g. the Views plugin's layout cross-fade) could flash its static
    // children (the back/+ buttons) as the layer got re-composited.
    document.documentElement.classList.add("core-transitioning");
    const transition = documentWithTransitions.startViewTransition(apply);
    void transition.finished.finally(() => document.documentElement.classList.remove("core-transitioning"));
  }, []);
  useEffect(() => { localStorage.setItem("notible-core-stats", String(statsEnabled)); }, [statsEnabled]);
  useEffect(() => { localStorage.setItem("notible-core-print", JSON.stringify(printOptions)); }, [printOptions]);
  useEffect(() => { if (favouriteId) localStorage.setItem("notible-core-favourite", favouriteId); else localStorage.removeItem("notible-core-favourite"); }, [favouriteId]);
  // MCP-CLEANUP (Hive #13): lets MCP see the app is open, and protects the favourite.
  const cleanupPending = useMcpCleanupHeartbeat(favouriteId, () => showNotice(t("An AI assistant asks to move notes to the Trash."), { label: t("Review"), run: () => navigateToSettingsSection("ai-cleanup") }));

  useEffect(() => {
    if (!selected?.id) {
      setSelectedRelations([]);
      return;
    }
    let active = true;
    void listRelations(selected.id)
      .then((relations) => { if (active) setSelectedRelations(relations); })
      .catch(() => { if (active) setSelectedRelations([]); });
    return () => { active = false; };
  }, [selected?.id, objects]);

  useEffect(() => {
    if (!createMenuOpen) return;

    const closeWhenOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !createMenuRef.current?.contains(target)) setCreateMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCreateMenuOpen(false);
      }
    };
    const closeWhenFocusLeaves = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && !createMenuRef.current?.contains(next)) setCreateMenuOpen(false);
    };

    window.addEventListener("pointerdown", closeWhenOutside);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("focusout", closeWhenFocusLeaves);
    return () => {
      window.removeEventListener("pointerdown", closeWhenOutside);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("focusout", closeWhenFocusLeaves);
    };
  }, [createMenuOpen]);

  useEffect(() => {
    if (!rowCreateMenuFor) return;
    const closeWhenOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !rowCreateMenuRef.current?.contains(target)) { setRowCreateMenuFor(null); setDeleteConfirm(null); }
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setRowCreateMenuFor(null); setDeleteConfirm(null); } };
    window.addEventListener("pointerdown", closeWhenOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeWhenOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [rowCreateMenuFor]);

  // The menu opens at the cursor; near the bottom of a long tree a container's
  // longer menu ran past the window and its last items were unreachable. Shift
  // it back inside the viewport before paint (again when the delete
  // confirmation changes its height). CSS max-height covers a window too short
  // for the whole menu.
  useLayoutEffect(() => {
    const menu = rowCreateMenuRef.current;
    if (!menu || !rowCreateMenuFor) return;
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rowCreateMenuFor.x, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(rowCreateMenuFor.y, window.innerHeight - height - 8))}px`;
  }, [rowCreateMenuFor, deleteConfirm]);

  useEffect(() => {
    if (!rowMenu) return;
    const closeWhenOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !rowMenuRef.current?.contains(target)) setRowMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setRowMenu(null); };
    window.addEventListener("pointerdown", closeWhenOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeWhenOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [rowMenu]);

  useEffect(() => {
    if (!showReleaseNotes) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setShowReleaseNotes(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showReleaseNotes]);

  // Right-clicking a card in a plugin-rendered view (Kanban today) asks Core
  // for the object menu. An event rather than a prop chain: the view sits
  // behind the plugin surface boundary, and the actions below are Core's, not
  // the view's. Nothing here acts on its own — the user still picks an item.
  useEffect(() => {
    const openMenu = (event: Event) => {
      const detail = (event as CustomEvent).detail as { id?: string; x?: number; y?: number } | undefined;
      const object = objects.find((candidate) => candidate.id === detail?.id);
      if (!object) return;
      setRowMenu({
        x: Number(detail?.x) || 0,
        y: Number(detail?.y) || 0,
        items: [
          { label: t("Download as Markdown (.md)"), run: () => exportObjectAsMarkdown(object) },
          { label: t("Print / Save as PDF"), run: () => printObjectAsPdf(object) },
          { label: t("Export JSON (with children)"), run: () => exportObjectTreeAsJson(object) },
        ],
      });
    };
    window.addEventListener("notible:object-menu", openMenu);
    return () => window.removeEventListener("notible:object-menu", openMenu);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the export helpers are function declarations, new on every render
  }, [objects, t]);

  useEffect(() => {
    if (!movePickerOpen) return;
    const closeWhenOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !movePickerRef.current?.contains(target)) setMovePickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMovePickerOpen(false); };
    window.addEventListener("pointerdown", closeWhenOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeWhenOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [movePickerOpen]);

  useEffect(() => {
    function onHotkey(event: KeyboardEvent) {
      // Global search opener works from anywhere, including while typing in
      // a note — matches the Alt+Space convention several other apps use.
      if (event.key === "F1" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        openHelpRef.current();
        return;
      }
      // Alt+Left: back to the note opened before this one (E21), the browser's key.
      if (event.altKey && !event.ctrlKey && !event.shiftKey && event.key === "ArrowLeft") {
        const previous = backStackRef.current.pop();
        if (!previous) return;
        event.preventDefault();
        goingBackRef.current = true;
        // A note deleted meanwhile never reaches loadEditor, which resets the flag.
        void openObjectRef.current(previous).finally(() => { goingBackRef.current = false; });
        return;
      }
      if (event.altKey && event.code === "Space") {
        event.preventDefault();
        navigateToSection("notes");
        setSearchOpen(true);
        return;
      }
      // Ctrl+K opens search too (D14): Alt+Space is also Windows' window menu.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        navigateToSection("notes");
        setSearchOpen(true);
        return;
      }
      // Ctrl+= / Ctrl+- / Ctrl+0: the interface size (L7). Same keys as a browser.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === "=" || event.key === "+" || event.key === "-" || event.key === "0")) {
        event.preventDefault();
        setZoom(stepZoom(zoomRef.current, event.key === "0" ? 0 : event.key === "-" ? -1 : 1));
        return;
      }
      // Ctrl+N / Ctrl+, mean nothing inside a text field, so they work while
      // typing too (E12: Ctrl+N in a note did nothing).
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void addNote();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        navigateToSection("settings");
      }
    }
    window.addEventListener("keydown", onHotkey);
    return () => window.removeEventListener("keydown", onHotkey);
  }, []);

  // Overlays and the mount bridge are Core-owned and installed once the shell
  // exists. The host holds them for the lifetime of the app, so nothing here
  // may close over render-scoped state — the bridge is re-set when the theme
  // changes instead.
  useEffect(() => {
    coreHost.setOverlayApi(coreOverlayApi);
    // Plugins translate through the host, not by importing Core internals.
    // Functions rather than a snapshot: the language changes while plugins
    // stay loaded, and a captured dictionary would freeze them at the
    // language that happened to be active when they were enabled.
    coreHost.setTranslator({
      translate: (namespace, key, values, own) => translateForPlugin(namespace, key, values, own),
      get locale() { return currentLocaleTag(); },
    });
    corePluginManager.setStyleSink(coreStyleSink);
  }, []);
  // Bumped by every block/link insertion: forces the editor to re-render and
  // the caret effect below to run, even when the body text did not change.
  const [slashInsertNonce, setSlashInsertNonce] = useState(0);
  useEffect(() => {
    const target = pendingCaretRef.current;
    if (target === null) return;
    pendingCaretRef.current = null;
    // The editor owns its own DOM and rewrites it from `value` on its own
    // schedule, so "React committed" is not the same as "the new document is
    // in the DOM". Placing the caret too early silently drops it at the root,
    // and the next keystroke goes nowhere. Wait for the editor's content to
    // actually match, then place — bounded, so a mismatch can never spin.
    let frames = 0;
    // Compared without zero-width placeholders: the body keeps the one a block
    // command appends, the editor's Markdown never has it, so the two never
    // matched, the caret waited all 10 frames, and what was typed meanwhile
    // landed at the old caret (`function` saved as `tion … }func`, round 3).
    const comparable = (value: string) => value.replace(/​/gu, "").trimEnd();
    const place = () => {
      const root = bodyEditorRef.current;
      if (!root) return;
      if (comparable(markdownFromCoreHtml(root)) !== comparable(body) && frames < 10) {
        frames += 1;
        requestAnimationFrame(place);
        return;
      }
      placeCaretAtMarkdownOffset(root, target);
    };
    place();
    // slashInsertNonce too: picking "[[Alpha notes]]" after typing that whole
    // title leaves the body unchanged, so [body] alone never fired, the caret
    // stayed inside the brackets and the rest of the sentence went into the
    // link (`[[Alpha notes ]informs …]]`, Codex round 3).
  }, [body, slashInsertNonce]);
  useCorePluginHotkeys();
  const decorateCodeBlocks = useCodeBlockDecorator(selectedIdRef.current ?? undefined);

  // Re-decoration trigger. A code-block renderer that shows live data (a query
  // table) has no way to refresh itself: the editor only redecorates when the
  // note's own text changes, so a block would keep whatever it drew when the
  // note was opened, and a block just typed would not draw at all. Both DOM
  // events land here — `notible:object-event` for object writes and
  // `notible:workspace-changed` for everything else (restore, import, sync) —
  // debounced, because a burst of writes is one redraw.
  const [decorateNonce, setDecorateNonce] = useState(0);
  // Bumped on every slash-command/wikilink insertion — see
  // CoreMarkdownEditor's forceRebuildNonce for why this exists: a screenshot
  // pasted into a list item writes the DOM directly (not through the usual
  // Markdown-string rebuild) and sets `lastValue.current` itself, so a LATER
  // insertion elsewhere in the note that only changes `body`'s string value
  // is not guaranteed to be seen as "changed" by that ref comparison. This
  // forces the rebuild regardless.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setDecorateNonce((current) => current + 1), 400);
    };
    window.addEventListener("notible:object-event", bump);
    window.addEventListener("notible:workspace-changed", bump);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("notible:object-event", bump);
      window.removeEventListener("notible:workspace-changed", bump);
    };
  }, []);
  useEffect(() => {
    setCorePluginBridge({
      themeMode: theme,
      openObject: (id) => openObject(id),
      // API 1.8 — `ui.openView`. A registered view IS a section here, so
      // navigating to it is the same `pluginViewSection()` the nav card uses;
      // rebuilding the string by hand is how the two would drift apart.
      // Always `true`: this shell can always render a view, and the host has
      // already refused a view id the plugin never registered.
      //
      // The functional `setSection` form is load-bearing. This bridge is
      // installed once per theme change and the host keeps it for the lifetime
      // of the app, so anything captured from render scope here is frozen at
      // the theme's last change — which is exactly the stale-state bug
      // `openObject` below carries the same warning about. Like `openObject`,
      // this does not push onto the Back stack: it is a jump the plugin made,
      // not a click the user made on a nav card.
      openView: async (key) => {
        const next = pluginViewSection(key);
        setSection((current) => (current === next ? current : next));
        return true;
      },
      notifyChanged: () => window.dispatchEvent(new Event("notible:workspace-changed")),
      // API 1.22. Through refs: this bridge outlives the render it was made in.
      openSyncConflicts: (copyId) => openSyncConflictsRef.current(copyId),
      openHelp: (pageId, slug) => openHelpRef.current(pageId && HELP_PAGES.has(pageId) ? pageId : undefined, slug),
      openPluginSettings: (pluginId) => {
        // Before navigating: the list takes the pending selection when it
        // mounts, and its 500 ms click guard must already be running then.
        requestPluginSelection(pluginId);
        navigateToSettingsSectionRef.current("plugins", "all");
      },
    });
  }, [theme]);

  // API 1.22: what `context.help` may know. The host holds only enabled
  // plugins, so the shell supplies the catalogue: Help pages, the shipped
  // plugins (on or off) and installed ones. Public text only — never paths,
  // versions or settings. Read through refs, re-read on every change.
  const knowledgeRef = useRef({ builtinCatalog, pluginEntries });
  knowledgeRef.current = { builtinCatalog, pluginEntries };
  useEffect(() => {
    coreHost.setKnowledgeProvider({
      pages: () => [...HELP_PAGES.values()].map((page) => ({ id: page.id, title: page.title, keywords: page.keywords, body: page.body, plugin: page.plugin })),
      plugins: () => {
        const { builtinCatalog: shipped = [], pluginEntries: installed } = knowledgeRef.current;
        const fromRegistry = installed.flatMap((entry) => {
          try {
            const manifest = JSON.parse(entry.manifest) as { id?: unknown; name?: unknown; description?: unknown; guide?: unknown; theme?: unknown };
            if (typeof manifest.theme === "object") return [];
            return [{
              id: entry.plugin_id,
              name: typeof manifest.name === "string" ? manifest.name : entry.plugin_id,
              description: typeof manifest.description === "string" ? manifest.description : "",
              guide: typeof manifest.guide === "string" ? manifest.guide : undefined,
            }];
          } catch { return []; }
        });
        return [...shipped.map((manifest) => ({ id: manifest.id, name: manifest.name, description: manifest.description ?? "", guide: manifest.guide })), ...fromRegistry];
      },
    });
  }, []);
  useEffect(() => { coreHost.notifyKnowledgeChanged(); }, [builtinCatalog, pluginEntries]);

  // D9 — Core's own event emission. The data layer announces object lifecycle
  // changes as DOM events (it cannot import this module), and this is the one
  // place that forwards them onto the plugin bus. Notifications only: a
  // handler cannot cancel or alter what already happened, so plugin ordering
  // never becomes load-bearing.
  useEffect(() => {
    function onObjectEvent(event: Event) {
      const detail = (event as CustomEvent<{ event: string; payload: unknown }>).detail;
      if (detail?.event) coreHost.emit(detail.event, detail.payload);
    }
    function onWorkspaceChanged() {
      coreHost.emit("workspace.changed", {});
    }
    window.addEventListener("notible:object-event", onObjectEvent);
    window.addEventListener("notible:workspace-changed", onWorkspaceChanged);
    coreHost.emit("app.ready", {});
    return () => {
      window.removeEventListener("notible:object-event", onObjectEvent);
      window.removeEventListener("notible:workspace-changed", onWorkspaceChanged);
    };
  }, []);

  async function refreshPlugins() {
    // Delegates to the shared hydration routine used at real Core startup
    // (hydrate.ts) instead of keeping a second, slightly different copy of
    // this loop here — see the duplication item in section D of the
    // 2026-08-08 bug audit.
    const entries = await listPluginRegistry();
    const { failed } = await hydrateActiveLocalPlugins(entries, coreLocalPluginFileReader, corePluginManager);
    for (const failure of failed) {
      await setPluginRegistryState(failure.id, failure.version, "failed", failure.error);
    }
    setPluginEntries(await listPluginRegistry());
    setSnapshots(coreHost.getSnapshot());
    const picked = getThemePackState();
    if (picked.activeId && !picked.packs.some((pack) => pack.id === picked.activeId)) selectThemePack(null);
  }

  async function refreshTrash() {
    setTrashObjects(await listTrash());
  }

  function formatBackupSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatBackupDate(modifiedAtMs: number): string {
    return new Date(modifiedAtMs).toLocaleString();
  }

  function matchesNoteSearch(object: PluginObject, value: string) {
    // Every word, anywhere in the item (R5 F1).
    return matchesAllWords([object.title, textFromDocument(object.content), object.props], value);
  }

  useEffect(() => { void refreshPlugins().catch(showError); }, []);
  useEffect(() => {
    if (section === "settings" && settingsSection === "recovery") { void refreshTrash().catch(showError); void refreshBackups(); }
  }, [section, settingsSection]);

  function showError(value: unknown) {
    setError(messageOf(value));
    setNotice(null);
  }

  /**
   * Core's own status message. It clears itself after a few seconds — it used
   * to stay on screen until something else replaced it, so "X reloaded" sat
   * above whatever you opened next and read as part of that note.
   */
  showNoticeRef.current = (text: string) => showNotice(text);
  function showNotice(value: string, action?: { label: string; run: () => void }) {
    setNotice({ text: value, action });
    setError("");
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), action ? 8000 : 4000);
  }

  async function runPluginCommand(pluginId: string, command: { name: string; execute: (input?: unknown) => unknown | Promise<unknown> }, input?: unknown) {
    try {
      const result = await command.execute(input);
      showNotice(`${coreHost.getPluginContext(pluginId)?.manifest.name ?? pluginId} · ${commandResultMessage(command.name, result)}`);
      await reload();
    } catch (value) {
      showError(value);
    }
  }

  useEffect(() => {
    if (!selected || focusTitleFor.current !== selected.id) return;
    const field = document.querySelector<HTMLTextAreaElement>(".core-title-input");
    if (!field) return;
    focusTitleFor.current = null;
    field.focus();
    field.select();
  }, [selected]);

  // The note that was open before the current one: where deleting the current note returns to.
  const previousSelectedIdRef = useRef<string | null>(null);
  const backStackRef = useRef<string[]>([]);
  const goingBackRef = useRef(false);

  /** Write the note being left, from a snapshot taken before the editor is
   * reloaded. Same conflict rule as saveNote: typing wins. */
  /** An editor save that wins conflicts: typing wins (Rust makes our write
   * newer, and the other writer's version is already in history). One retry
   * was not enough against a plugin that writes the same object several times
   * a second, such as Tables saving a cell on every Enter: the second attempt
   * lost too, a bare "conflict" was shown and the new title was dropped
   * (Codex round 3, 01.10). Retries with a fresh timestamp until it lands.
   * `fresh` is the version that was on disk when a conflict happened. */
  async function updateWinningConflicts(id: string, patch: { title: string; content?: string }, expected: number | undefined): Promise<{ updated: PluginObject; fresh?: PluginObject }> {
    try {
      return { updated: await updateObject(id, patch, expected, "editor") };
    } catch (first) {
      if (!isConflictError(first)) throw first;
      for (let attempt = 1; ; attempt += 1) {
        const fresh = await getObject(id);
        if (!fresh) throw first;
        try {
          return { updated: await updateObject(id, patch, fresh.updated_at, "editor"), fresh };
        } catch (value) {
          if (!isConflictError(value) || attempt >= 8) throw value;
        }
      }
    }
  }

  async function saveLeftNote(note: { id: string; title: string; content: string; updatedAt: number | undefined }) {
    const patch = { title: note.title, content: note.content };
    try {
      const { updated } = await updateWinningConflicts(note.id, patch, note.updatedAt);
      setObjects((current) => current.map((item) => item.id === updated.id ? updated : item));
      // allObjects too: links and backlinks read it, and a save can bring new
      // props from Rust (a renamed note's previousTitles, E22).
      setAllObjects((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (value) {
      // The editor has already moved on to the next note, so this text exists
      // nowhere else: keep it, and loadEditor puts it back when the note is opened.
      try { localStorage.setItem(UNSAVED_DRAFT_KEY + note.id, JSON.stringify({ title: note.title, content: note.content })); } catch { /* storage unavailable */ }
      showError(value);
    }
  }

  function loadEditor(object: PluginObject) {
    // E14B-LEAVE-BLUR: a keyboard switch (Alt+Left, Ctrl+N) never blurs a
    // block's input; blur it now so its change lands in this note's body
    // before the snapshot below. dirtyRef only catches up in an effect, so
    // mark it here when the blur changed the body.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(".core-editor-content .core-code-render")) {
      const bodyBefore = bodyRef.current;
      active.blur();
      if (bodyRef.current !== bodyBefore) dirtyRef.current = true;
    }
    // Leaving a note within the autosave delay (700 ms) used to drop the last
    // words typed: switching clears the pending timer and resets `dirty`
    // below. Save them from a snapshot first.
    if (dirtyRef.current && selectedIdRef.current && selectedIdRef.current !== object.id) {
      void saveLeftNote({ id: selectedIdRef.current, title: titleRef.current.trim(), content: documentFromText(bodyRef.current), updatedAt: selectedUpdatedAtRef.current });
    }
    if (selectedIdRef.current && selectedIdRef.current !== object.id) {
      previousSelectedIdRef.current = selectedIdRef.current;
      // Alt+Left goes back through the notes opened before this one (E21).
      if (!goingBackRef.current) backStackRef.current = [...backStackRef.current.slice(-49), selectedIdRef.current];
    }
    goingBackRef.current = false;
    closeSlashMenu();
    setUseLegacyContainer(false);
    draftVersion.current += 1;
    selectedIdRef.current = object.id;
    selectedUpdatedAtRef.current = object.updated_at;
    setSelected(object);
    setSelectedId(object.id);
    // The stored title is the source of truth, empty included — the title
    // field shows a placeholder rather than a real "Untitled note" string to
    // delete (see the core-title-input textarea).
    const titleValue = object.title ?? "";
    setTitle(titleValue);
    titleRef.current = titleValue;
    const bodyValue = textFromDocument(object.content);
    setBody(bodyValue);
    bodyRef.current = bodyValue;
    setDirty(false);
    dirtyRef.current = false;
    lastPersistedRef.current = { title: object.title ?? "", content: object.content ?? "" };
    restoreUnsavedDraft(object);
  }

  /** Text whose save failed as the user left the note (see saveLeftNote) comes
   *  back into the editor as an unsaved edit, so the normal autosave retries it. */
  function restoreUnsavedDraft(object: PluginObject) {
    let draft: { title?: unknown; content?: unknown } | null = null;
    try {
      const raw = localStorage.getItem(UNSAVED_DRAFT_KEY + object.id);
      if (!raw) return;
      localStorage.removeItem(UNSAVED_DRAFT_KEY + object.id);
      draft = JSON.parse(raw) as { title?: unknown; content?: unknown };
    } catch { return; }
    if (typeof draft?.content !== "string" || typeof draft.title !== "string") return;
    if (draft.content === (object.content ?? "") && draft.title === (object.title ?? "")) return;
    setTitle(draft.title);
    titleRef.current = draft.title;
    const bodyValue = textFromDocument(draft.content);
    setBody(bodyValue);
    bodyRef.current = bodyValue;
    setDirty(true);
    dirtyRef.current = true;
  }

  // Not a busy operation: it runs after every save anywhere, and disabling
  // unrelated buttons for it read as random flicker.
  async function reload(nextQuery = query, options?: { keepEmpty?: boolean }) {
    try {
      // Plugins can own object types that are never notes — a habit tracked
      // by notible.habits has no document body and lives entirely in its own
      // surface/sidebar widget. Left in `objects`, it shows up as an empty,
      // untitled-looking note the user never created on purpose. treeHiddenTypes
      // (STATIC_TREE_HIDDEN + any plugin type with behaviour.treeHidden) is the
      // one place this exclusion lives; add a type there, not a per-plugin flag
      // in props, so the rule stays visible and singular. The filter applies to
      // the SIDEBAR/SEARCH list only — `allObjects` keeps every type so
      // [[title]] links, backlinks and search still resolve against hidden
      // types (TypeBehaviour.treeHidden: "this affects the tree only").
      // Searching only filters: the workspace list is reloaded when the query
      // is empty, and a search asks Rust for its matches instead of pulling
      // every object's content over IPC on each keystroke.
      const needle = nextQuery.trim();
      const [allSource, nextTypes, found] = await Promise.all([
        needle && allObjectsRef.current.length ? allObjectsRef.current : listObjects(5000),
        coreDataApi.types.list(),
        needle ? searchObjectsText(needle) : null,
      ]);
      setLoadedTypes(nextTypes);
      // The treeHidden filter is NOT applied here — it lives in the render-time
      // tree memo (see `treeObjects` ~:948). `objects` is the unfiltered
      // workspace so the Core note SEARCH, [[title]] links and backlinks all
      // resolve against hidden types too ("this affects the tree only"); the
      // sidebar tree excludes them at render. Keeping the filter out of
      // reload() also means a background reload can never carry a stale
      // treeHiddenTypes set from a since-changed `loadedTypes`.
      // Rust matches raw content (a legacy note is Tiptap JSON); the JS check
      // keeps the old semantics on the text the user actually sees.
      const next = sortNotes(found ? found.filter((object) => matchesNoteSearch(object, nextQuery)) : allSource);
      setObjects(next);
      // `objects` is the SEARCH RESULT, not the workspace. Backlinks resolve
      // [[title]] against a full list, so they must not shrink to whatever the
      // sidebar filter happens to show — typing in the search box used to drop
      // the backlink count to zero on a note whose linkers stopped matching.
      setAllObjects(sortNotes(allSource));
      // Read the ref, not the `selectedId` state closed over by whichever
      // render defined this reload() call — the notible:workspace-changed
      // listener only re-registers when [dirty, query] change, so a stale
      // closure here previously kept reloading whatever note was selected
      // BEFORE the user navigated to a project/whiteboard/etc, silently
      // dragging them back to it on every background save anywhere.
      const currentSelectedId = selectedIdRef.current;
      if (currentSelectedId) {
        // Look in the whole workspace, not the search result: a search only
        // filters the list. Closing the open note because it didn't match the
        // query also skipped its pending autosave (saveNote needs the id).
        const current = allSource.find((object) => object.id === currentSelectedId);
        if (!current) {
          setSelected(null);
          setSelectedId(null);
          selectedIdRef.current = null;
        }
        // Found: only the sidebar list (`objects`, set above) needs
        // refreshing. Do NOT call loadEditor() here — it resets `body`,
        // forcing a full contenteditable DOM rebuild that discards the
        // caret position and the plugin container view's own state, even
        // though the selected object itself hasn't changed.
      } else {
        // Cold-start fallback: open the first REAL note, never a treeHidden
        // record (a habit/character has no body — it would open blank) and
        // never a stranded plugin type (its editor surface is gone).
        // Not after a delete (keepEmpty): the user is sent back to where they came from instead.
        const first = options?.keepEmpty ? undefined : next.find((object) => !treeHiddenTypes.has(object.type) && !orphanTypes.has(object.type));
        if (first) {
          const current = await getObject(first.id);
          if (current) loadEditor(current);
        }
      }
    } catch (value) {
      showError(value);
    }
  }

  useEffect(() => { void reload(""); }, []);

  // Open the favourite once, the first time the workspace has loaded — not on
  // every reload, or it would drag the user back to it every background sync
  // (the same trap `reload()`'s own comment above warns about for `selectedId`).
  useEffect(() => {
    if (triedFavouriteRef.current || allObjects.length === 0) return;
    triedFavouriteRef.current = true;
    if (!favouriteId) return;
    if (allObjects.some((object) => object.id === favouriteId)) void openObject(favouriteId);
    else setFavouriteId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openObject is a function declaration, new every render; guarded by the ref above
  }, [allObjects, favouriteId]);

  useEffect(() => {
    if (!searchOpen) return;
    const timer = window.setTimeout(() => { void reload(query); }, 180);
    return () => window.clearTimeout(timer);
  }, [query, searchOpen]);

  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => sidebarSearchRef.current?.focus());
  }, [searchOpen]);

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
    setFilters({ kind: "", container: "", tag: "", from: "", to: "" });
    void reload("");
  }

  useEffect(() => watchExternalChanges(), []);

  useEffect(() => {
    const onWorkspaceChanged = () => { if (!dirty) void reload(); };
    window.addEventListener("notible:workspace-changed", onWorkspaceChanged);
    return () => window.removeEventListener("notible:workspace-changed", onWorkspaceChanged);
  }, [dirty, query]);

  // Picks up an open note that another writer (a sync pull, a plugin) changed
  // on disk. `reload()` deliberately never touches the open note. Race-free:
  // `draftVersion` moves on every keystroke, so anything typed while the fetch
  // is in flight cancels the reload — reading the `dirty` state here (as this
  // used to) saw the value from before the await and could drop a keystroke.
  // Notes in the note editor only: a plugin's object tab keeps its own state.
  async function refreshOpenNote() {
    const id = selectedIdRef.current;
    if (!id || dirtyRef.current || savingRef.current) return;
    const version = draftVersion.current;
    const fresh = await getObject(id);
    if (!fresh || selectedIdRef.current !== id || draftVersion.current !== version || dirtyRef.current || savingRef.current) return;
    if (fresh.updated_at === selectedUpdatedAtRef.current) return;
    const { containerTypes: ct, objectTabTypes: tt } = containerSetsRef.current;
    if (hasContainerSurface(fresh.type, ct, tt)) return;
    loadEditor(fresh);
  }
  const refreshOpenNoteRef = useRef(refreshOpenNote);
  refreshOpenNoteRef.current = refreshOpenNote;
  useEffect(() => {
    const run = () => { void refreshOpenNoteRef.current(); };
    // Right after a sync run (data.sync.apply announces workspace changes)…
    window.addEventListener("notible:workspace-changed", run);
    // …and a slow backstop for writers that announce nothing.
    const timer = window.setInterval(run, 30_000);
    return () => { window.removeEventListener("notible:workspace-changed", run); window.clearInterval(timer); };
  }, []);

  // The theme class lives on the document element, not on .core-shell. On the
  // shell it redefined the tokens *below* :root, so a plugin theme written
  // against :root could never win in night mode — D3's promise, silently
  // broken. On :root the host theme rule and plugin themes compete normally.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("core-night", effectiveTheme === "night");
    root.classList.toggle("core-paper", effectiveTheme === "paper");
    // Stable hooks for theme packs (docs/THEME_PACKS.md): selectors that do not depend on class names.
    root.dataset.notibleMode = effectiveTheme === "night" ? "dark" : "light";
  }, [effectiveTheme]);
  useEffect(() => {
    const root = document.documentElement;
    if (themePacks.activeId) root.dataset.notibleTheme = themePacks.activeId; else delete root.dataset.notibleTheme;
  }, [themePacks.activeId]);

  // --- Theme packs ---------------------------------------------------------------------
  // Installed packs are listed, never applied on their own. The one the user picks
  // is sanitised (see themeCss.ts), its images are read by Rust as data: URIs, and
  // the result is attached as a single stylesheet.
  const themeHostRef = useRef<ThemePackHost | null>(null);
  themeHostRef.current = {
    install: async (source) => installThemeRelease(await resolveGithubRelease(themeAsCatalogSource(source))),
    installFromRepo: async (repo) => installThemeRelease(await resolveRepoRelease(repo)),
    remove: async (id) => {
      for (const entry of pluginEntries.filter((candidate) => candidate.plugin_id === id)) await uninstallPlugin(entry);
      if (getThemePackState().activeId === id) selectThemePack(null);
    },
  };
  async function installThemeRelease(resolved: Awaited<ReturnType<typeof resolveGithubRelease>>) {
    const { manifest, zipUrl } = resolved;
    // The theme catalogue is for themes only: a release that is not a theme pack is refused before it is downloaded.
    if (!manifest.isTheme) throw new Error(t("That release is not a theme pack."));
    if (!isPluginUpdateCompatible({ plugin: { apiVersion: manifest.apiVersion, minCoreVersion: manifest.minCoreVersion, maxCoreVersion: manifest.maxCoreVersion } }, packageJson.version, EXTENSION_API_VERSION)) {
      throw new Error(t("This theme needs a different version of Notible."));
    }
    const bytes = (await fetchWithByteCeiling(zipUrl, MAX_PACKAGE_BYTES)).buffer;
    const extracted = await installPluginZip(arrayBufferToBase64(bytes), manifest.id, manifest.version);
    await installFromRoot(extracted.install_path, "package", zipUrl);
  }
  useEffect(() => {
    const sync = () => setThemePacks(corePluginManager.themePacks().map(({ styles: _styles, ...info }) => info));
    corePluginManager.onThemePacksChanged(sync);
    sync();
    setThemePackHost({
      install: (source) => themeHostRef.current!.install(source),
      installFromRepo: (repo) => themeHostRef.current!.installFromRepo(repo),
      remove: (id) => themeHostRef.current!.remove(id),
    });
    return () => setThemePackHost(null);
  }, []);
  // The way out of a theme that makes the app hard to use: always the same keys, and the Themes screen (protected) can also switch it off.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        selectThemePack(null);
        showNotice(t("Theme turned off."));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (themePacks.recovered) showNotice(t("The theme was turned off because Notible did not start cleanly with it.")); }, [themePacks.recovered]);
  const activePackKey = activeThemePack ? `${activeThemePack.id}@${activeThemePack.version}` : "";
  useEffect(() => {
    const id = themePacks.activeId;
    if (!id) { coreStyleSink.remove(THEME_PACK_STYLE_ID); return; }
    const source = corePluginManager.themePacks().find((pack) => pack.id === id);
    if (!source) return; // not loaded yet (startup) or gone: refreshPlugins clears a missing pick
    let cancelled = false;
    (async () => {
      try {
        let css = "";
        let total = 0;
        for (const sheet of source.styles) {
          const clean = sanitizeThemeCss(sheet.css);
          const uris = await Promise.all(clean.assets.map((path) => readThemeAsset(id, path)));
          total += uris.reduce((sum, uri) => sum + uri.length, 0);
          if (total > 12 * 1024 * 1024) throw new Error("that theme's images are too large");
          css += `${fillThemeAssets(clean.css, uris)}\n`;
        }
        if (cancelled) return;
        // Marked as "being tried": cleared once the app has run with it for a few seconds.
        try { localStorage.setItem("notible-theme-pack-pending", id); } catch { /* fine */ }
        coreStyleSink.apply(THEME_PACK_STYLE_ID, [{ path: "theme", css }]);
        window.setTimeout(() => { try { localStorage.removeItem("notible-theme-pack-pending"); } catch { /* fine */ } }, 4000);
      } catch (value) {
        if (!cancelled) { showError(value); selectThemePack(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [themePacks.activeId, activePackKey]);

  async function openObject(id: string) {
    setBusy(true);
    try {
      const object = await getObject(id);
      if (object) {
        // Searching from Settings and picking a note means "take me to that
        // note", not "load it behind this screen".
        // Functional update on purpose: the plugin bridge installs this
        // closure only when the theme changes, so a plain `section` read here
        // can be stale — and a plugin view calling openObject would then stay
        // on its own pane instead of showing the note it just asked for.
        setSection((current) => current === "notes" ? current : "notes");
        loadEditor(object);
        const { containerTypes: ct, objectTabTypes: tt } = containerSetsRef.current;
        announceObjectOpened(object, hasContainerSurface(object.type, ct, tt) ? "tab" : "editor");
      }
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }

  // The top "+" always creates a new top-level item — it must never guess
  // a parent from whatever happens to be selected. Nesting under a
  // specific space/folder/project is only ever explicit, via that
  // container's own "+" in the sidebar (rowCreateMenuFor) passing its id.
  async function addNote(parentId?: string) {
    setBusy(true);
    try {
      const object = await createNote("", "", parentId);
      setObjects((current) => [object, ...current.filter((item) => item.id !== object.id)]);
      if (parentId) revealInSidebar([parentId]);
      focusTitleFor.current = object.id;
      loadEditor(object);
      setSection("notes");
      setCreateMenuOpen(false);
      setRowCreateMenuFor(null);
      showNotice("New note created.");
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }

  async function importMarkdownFile(file: File) {
    setBusy(true);
    try {
      const raw = await file.text();
      const lines = raw.replace(/\r\n/gu, "\n").split("\n");
      const titled = lines[0]?.startsWith("# ");
      const title = titled ? lines[0].slice(2).trim() : file.name.replace(/\.mdx?$/iu, "");
      const body = (titled ? lines.slice(1) : lines).join("\n").replace(/^\n+/u, "");
      const object = await createNote(title, "");
      const updated = await coreDataApi.objects.update(object.id, { content: documentFromText(body) }, object.updated_at);
      setObjects((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
      loadEditor(updated);
      setSection("notes");
      showNotice(`Imported "${title}".`);
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }

  function exportObjectAsMarkdown(object: PluginObject) {
    const markdown = `# ${object.title || "Untitled"}\n\n${textFromDocument(object.content)}\n`;
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(object.title || "untitled").replace(/[\\/:*?"<>|]/gu, "_")}.md`;
    link.click();
    URL.revokeObjectURL(url);
    showNotice(`Downloaded "${link.download}".`);
  }

  /** "Print / Save as PDF": the note goes through the editor's own renderer,
   * so pasted screenshots (data: URIs) and code blocks survive — unlike
   * exporting .md and feeding it to an outside converter. */
  function printObjectAsPdf(object: PluginObject) {
    const title = object.title || "Untitled";
    const html = printableDocument(title, renderCoreMarkdown(textFromDocument(object.content)), printOptions);
    void printDocumentHtml(html, document, title || "Untitled");
    showNotice(`Opening the print dialog for "${title}" — choose "Save as PDF".`);
  }

  /** The whole subtree as JSON. Markdown export above is one note as prose;
   * this one keeps types, properties and the parent/child structure, which is
   * what you want when handing a project over or moving it between vaults. */
  function exportObjectTreeAsJson(object: PluginObject) {
    const json = exportObjectTreeJson(object.id, objects);
    const count = JSON.parse(json).objects.length as number;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(object.title || "untitled").replace(/[\/:*?"<>|]/gu, "_")}.notible.json`;
    link.click();
    URL.revokeObjectURL(url);
    showNotice(`Exported ${count} object${count === 1 ? "" : "s"} to "${link.download}".`);
  }

  async function importObjectTreeFile(file: File) {
    setBusy(true);
    try {
      const count = await importObjectTreeJson(await file.text(), importTargetRef.current, {
        create: (input) => coreDataApi.objects.create(input),
      });
      await reload();
      showNotice(`Imported ${count} object${count === 1 ? "" : "s"}.`);
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
      importTargetRef.current = null;
    }
  }

  function exportSelectedAsMarkdown() {
    if (selected) exportObjectAsMarkdown(selected);
  }

  function addWorkspace(parentId?: string) {
    setCreateMenuOpen(false);
    setModulePicker({ kind: "space", parentId });
  }

  /** A folder is just a name (S3): no dialog, the title is ready to type. */
  function addFolder(parentId?: string) {
    setCreateMenuOpen(false);
    setRowCreateMenuFor(null);
    void createContainer("folder", parentId, []);
  }

  async function createContainer(kind: "folder" | "space", parentId: string | undefined, moduleIds: string[], name?: string) {
    setBusy(true);
    try {
      // An empty selection means "back to all/default" — never write `_modules: []`,
      // which `filterTabsByModules` reads as "show every tab" anyway. Omit the key.
      const props = moduleIds.length ? JSON.stringify({ _modules: moduleIds }) : "{}";
      const title = name ?? (kind === "space" ? t("New workspace") : t("New folder"));
      const object = await coreDataApi.objects.create({ type: kind, title, content: documentFromText(""), props, parentId });
      setObjects((current) => [object, ...current.filter((item) => item.id !== object.id)]);
      if (parentId) revealInSidebar([parentId]);
      // No name typed yet: the title is selected, so typing names it (S3).
      if (!name) focusTitleFor.current = object.id;
      loadEditor(object);
      setSection("notes");
      setCreateMenuOpen(false);
      setRowCreateMenuFor(null);
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }


  async function runObjectMenuCommand(command: CommandRegistration, object: PluginObject) {
    setBusy(true);
    try {
      await command.execute({ objectId: object.id, objectType: object.type });
      await reload();
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }

  async function addPluginObject(pluginId: string, command: CommandRegistration & { creates: NonNullable<CommandRegistration["creates"]> }, parentId?: string) {
    if (CONTAINER_KINDS.has(command.creates.objectType)) {
      setCreateMenuOpen(false);
      setRowCreateMenuFor(null);
      setModulePicker({ kind: command.creates.objectType as "project" | "folder" | "space", parentId, pluginCreate: { pluginId, command } });
      return;
    }
    await runPluginCreate(pluginId, command, parentId, undefined);
  }

  async function runPluginCreate(
    _pluginId: string, // kept for callers; the toast no longer names the plugin
    command: CommandRegistration & { creates: NonNullable<CommandRegistration["creates"]> },
    parentId: string | undefined,
    modules: string[] | undefined,
    name?: string,
  ) {
    setBusy(true);
    try {
      const result = await command.execute({ parentId, ...(modules ? { modules } : {}), ...(name ? { title: name } : {}) });
      const object = result as PluginObject;
      if (!object || typeof object !== "object" || typeof object.id !== "string") {
        throw new Error(`${command.name} did not return a created object`);
      }
      setObjects((current) => [object, ...current.filter((item) => item.id !== object.id)]);
      if (parentId) revealInSidebar([parentId]);
      if (!name) focusTitleFor.current = object.id;
      loadEditor(object);
      setSection("notes");
      setCreateMenuOpen(false);
      setRowCreateMenuFor(null);
      // The command may have registered its object type only just now (a
      // plugin-declared container type). Reload types/objects so the tree and
      // `hasContainerSurface` see it without waiting for the next sync.
      window.dispatchEvent(new Event("notible:workspace-changed"));
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }

  async function moveObjectTo(objectId: string, parentId: string | null) {
    setBusy(true);
    try {
      const updated = await coreDataApi.objects.move(objectId, parentId);
      setObjects((current) => current.map((item) => item.id === updated.id ? updated : item));
      // allObjects too: links and backlinks read it, and a save can bring new
      // props from Rust (a renamed note's previousTitles, E22).
      setAllObjects((current) => current.map((item) => item.id === updated.id ? updated : item));
      if (selectedIdRef.current === updated.id) setSelected(updated);
      setMovePickerOpen(false);
      // Show where it went (N8).
      if (parentId) revealInSidebar([parentId]);
      showNotice(parentId ? t("Moved.") : t("Moved to top level."));
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    const id = selectedIdRef.current;
    if (!id) return;
    // B3: a debounced save can still be in flight when the next one fires
    // (e.g. the request itself is slow). Serialize instead of firing a
    // second overlapping request that would carry a stale expectedUpdatedAt
    // and lose the newest edit to an optimistic-locking conflict.
    if (savingRef.current) {
      pendingSaveRef.current = true;
      return;
    }
    savingRef.current = true;
    lastSaveFailedRef.current = false;
    const versionAtStart = draftVersion.current;
    const selectedIdAtStart = id;
    setSaving(true);
    try {
      // An empty title is persisted as-is; every list/export site already
      // falls back to "Untitled note" for display, and the title field shows a
      // placeholder instead of a literal string the user has to delete.
      const patch: { title: string; content?: string } = { title: titleRef.current.trim(), content: documentFromText(bodyRef.current) };

      // Saves are serialized (savingRef), so a conflict means another writer.
      // Typing wins; theirs is already in history (sync and plugin writes record it).
      const { updated, fresh } = await updateWinningConflicts(id, patch, selectedUpdatedAtRef.current);
      const changedElsewhere = fresh ? fresh.title !== lastPersistedRef.current.title || fresh.content !== lastPersistedRef.current.content : false;
      lastPersistedRef.current = { title: updated.title, content: updated.content };

      selectedUpdatedAtRef.current = updated.updated_at;
      setObjects((current) => current.map((item) => item.id === updated.id ? updated : item));
      // allObjects too: links and backlinks read it, and a save can bring new
      // props from Rust (a renamed note's previousTitles, E22).
      setAllObjects((current) => current.map((item) => item.id === updated.id ? updated : item));
      if (draftVersion.current === versionAtStart && selectedIdRef.current === selectedIdAtStart) {
        // Autosave must not reload the contenteditable: replacing its DOM
        // would discard the browser selection and make the caret disappear.
        setSelected(updated);
        setDirty(false);
        setNotice(null);
      } else {
        setSelected((current) => current?.id === updated.id ? updated : current);
      }
      // After the reset above, which would otherwise wipe it straight away.
      if (changedElsewhere) showNotice(t("This note was also changed elsewhere. The other version is in Version history."));
    } catch (value) {
      lastSaveFailedRef.current = true;
      showError(value);
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        void saveNote();
      }
    }
  }

  // Save what is typed but not yet autosaved (the autosave waits 700 ms) and
  // wait out a save in flight — so a restore right after typing keeps that
  // text in history instead of replacing it unsaved.
  async function flushPendingSave() {
    if (dirtyRef.current && !savingRef.current) await saveNote();
    for (let i = 0; i < 40 && (savingRef.current || pendingSaveRef.current); i++) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }

  // MCP-CLEANUP (Hive #22): before approving an AI cleanup the open note must be
  // saved for real, so its fingerprint check sees the text on screen.
  async function flushPendingSaveStrict() {
    await settleDrafts({
      busy: () => savingRef.current || pendingSaveRef.current,
      dirty: () => dirtyRef.current,
      save: async () => { await saveNote(); return !lastSaveFailedRef.current; },
    }, t("The open note has changes that could not be saved, so nothing was moved. Save it and try again."));
  }

  // Quitting from the tray (request_quit in lib.rs) or installing an update
  // saves the open note first. Rust exits on its own after 3 s if the page never answers.
  const flushRef = useRef(flushPendingSave);
  flushRef.current = flushPendingSave;
  useEffect(() => {
    setBeforeExit(() => flushRef.current());
    const onQuit = () => void quitApp();
    window.addEventListener("notible:quit-requested", onQuit);
    return () => window.removeEventListener("notible:quit-requested", onQuit);
  }, []);

  // Arriving somewhere new starts at its top (N14), not at the scroll
  // position the previous screen happened to have.
  useEffect(() => { document.querySelector(".core-main")?.scrollTo({ top: 0 }); }, [section, settingsSection, selectedId]);

  // F2 renames the open item from anywhere but a text field (N6).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F2" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))) return;
      if (!selectedIdRef.current) return;
      event.preventDefault();
      setRenamingId(selectedIdRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Context menu closed: the next one starts with Export folded.
  useEffect(() => { if (!rowCreateMenuFor) { setRowExportOpen(false); setRowNewOpen(false); } }, [rowCreateMenuFor]);
  useEffect(() => { if (!createMenuOpen) setCreateAtTop(false); }, [createMenuOpen]);

  useEffect(() => {
    if (!selected || !dirty) return;
    const timer = window.setTimeout(() => { void saveNote(); }, 700);
    return () => window.clearTimeout(timer);
  }, [body, dirty, selected?.id, title]);

  function descendantIdsOf(id: string): string[] {
    const ids: string[] = [];
    const stack = [id];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const candidate of objects) {
        if (objectParentId(candidate) === current) { ids.push(candidate.id); stack.push(candidate.id); }
      }
    }
    return ids;
  }

  /**
   * After the open note is deleted: go back to the note the user came from, or else to its parent
   * (deleting a captured thought opened from Workspace returns to Workspace). Never to whatever
   * happens to be first in the list, which is what the cold-start fallback in reload() would do.
   */
  async function returnAfterDelete(deletedIds: string[], parentId: string | null) {
    const candidates = [previousSelectedIdRef.current, parentId].filter((value): value is string => !!value && !deletedIds.includes(value));
    for (const candidate of candidates) {
      const target = await getObject(candidate);
      if (target) { await openObject(candidate); return; }
    }
  }

  /** Rename from the tree (N6). The open note goes through the editor's own
   * title path, so its pending save cannot overwrite the new name. */
  async function renameObject(id: string, value: string) {
    setRenamingId(null);
    const next = value.trim();
    const current = allObjects.find((object) => object.id === id) ?? objects.find((object) => object.id === id);
    if (!current || !next || next === current.title) return;
    if (selectedIdRef.current === id) { applyTitle(next); return; }
    try {
      const { updated } = await updateWinningConflicts(id, { title: next }, current.updated_at);
      setObjects((list) => list.map((item) => item.id === updated.id ? updated : item));
      setAllObjects((list) => list.map((item) => item.id === updated.id ? updated : item));
    } catch (value) {
      showError(value);
    }
  }

  /** A copy beside the original, without what is inside it (N6). */
  async function duplicateObject(object: PluginObject) {
    setBusy(true);
    try {
      const copy = await coreDataApi.objects.create({ type: object.type, title: t("{name} (copy)", { name: object.title || t("Untitled note") }), content: object.content, props: object.props, parentId: objectParentId(object) ?? undefined });
      await reload(query, { keepEmpty: true });
      await openObject(copy.id);
      showNotice(t("Duplicated."));
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }

  async function deleteTreeRow(id: string) {
    const ids = [id, ...descendantIdsOf(id)];
    const openParentId = selected && ids.includes(selected.id) ? objectParentId(selected) : null;
    const wasOpen = !!selectedIdRef.current && ids.includes(selectedIdRef.current);
    setBusy(true);
    try {
      for (const targetId of ids) await trashObject(targetId);
      if (wasOpen) {
        setSelected(null);
        setSelectedId(null);
        selectedIdRef.current = null;
        setTitle("");
        setBody("");
      }
      setDeleteConfirm(null);
      setRowCreateMenuFor(null);
      await reload(query, { keepEmpty: true });
      if (wasOpen) await returnAfterDelete(ids, openParentId);
      showNotice(t("{count} items moved to the trash.", { count: ids.length }), { label: t("Undo"), run: () => void undoDelete(ids, wasOpen ? id : null) });
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }

  async function removeNote() {
    if (!selected) return;
    const deletedId = selected.id;
    const openParentId = objectParentId(selected);
    setBusy(true);
    try {
      await trashObject(deletedId);
      setSelected(null);
      setSelectedId(null);
      selectedIdRef.current = null;
      setTitle("");
      setBody("");
      await reload(query, { keepEmpty: true });
      await returnAfterDelete([deletedId], openParentId);
      showNotice(t("{count} items moved to the trash.", { count: 1 }), { label: t("Undo"), run: () => void undoDelete([deletedId], deletedId) });
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }

  /** Undo in the delete notice: everything that went to the trash comes back,
   * and the item that was open opens again. */
  async function undoDelete(ids: string[], reopenId: string | null) {
    setBusy(true);
    try {
      for (const id of ids) await restoreObject(id);
      await reload();
      await refreshTrash();
      if (reopenId) await openObject(reopenId);
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }

  /** A trashed item and the trashed items inside it (a deleted folder's notes). */
  function trashTreeIds(id: string): string[] {
    const ids = [id];
    for (let index = 0; index < ids.length; index += 1) {
      for (const candidate of trashObjects) if (objectParentId(candidate) === ids[index] && !ids.includes(candidate.id)) ids.push(candidate.id);
    }
    return ids;
  }

  /** Delete forever: the item and anything of it still in the trash. */
  /** MCP-CLEANUP (Hive #13): `_protected` is app-owned; MCP cannot change `_` properties. */
  function isCleanupProtected(object: PluginObject) {
    try { return "_protected" in (JSON.parse(object.props || "{}") ?? {}) && JSON.parse(object.props)._protected !== false; } catch { return true; }
  }

  async function toggleCleanupProtection(object: PluginObject) {
    const current = await getObject(object.id);
    if (!current) return;
    let props: Record<string, unknown> = {};
    try { props = JSON.parse(current.props || "{}") ?? {}; } catch { /* unreadable props: start clean */ }
    if (isCleanupProtected(current)) delete props._protected; else props._protected = true;
    await updateObject(current.id, { props: JSON.stringify(props) });
    await reload();
    showNotice(props._protected ? t("Protected from AI.") : t("No longer protected from AI."));
  }

  async function deleteForever(ids: string[]) {
    setBusy(true);
    try {
      // MCP-CLEANUP (Hive #13): an AI cleanup can be undone for 24 hours, so its notes stay (Rust refuses them too).
      const held = new Set(await listHeldIds().catch(() => [] as string[]));
      const deletable = ids.filter((id) => !held.has(id));
      for (const id of deletable) await deleteObjectForever(id);
      await refreshTrash();
      setPurgeConfirm(null);
      showNotice(deletable.length < ids.length
        ? t("{count} items deleted for good. {held} from an AI cleanup stay until its 24-hour undo ends.", { count: deletable.length, held: ids.length - deletable.length })
        : t("{count} items deleted for good.", { count: ids.length }));
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }

  async function restoreFromTrash(id: string) {
    setBusy(true);
    try {
      const restored = await restoreObject(id);
      if (!restored) throw new Error("Object not found in Trash");
      await reload();
      await refreshTrash();
      showNotice(t("Restored."));
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }

  /** "All notes" in the breadcrumb: the top of the tree, nothing open. */
  async function goToTopLevel() {
    await flushPendingSave();
    setSelected(null);
    setSelectedId(null);
    selectedIdRef.current = null;
    setTitle("");
    setBody("");
  }

  async function goToParent() {
    const parentId = selected ? objectParentId(selected) : null;
    if (parentId) await openObject(parentId);
    // Leaving into the parent means the search that got us here is done —
    // otherwise a single-result search stays "armed" and silently reopens
    // that note the next time the user clicks a view switch.
    if (searchOpen) closeSearch();
  }

  async function refreshBackups() {
    try {
      const [list, dir, retention] = await Promise.all([listBackups(), backupsDirectory(), getBackupRetention()]);
      setBackups(list);
      setBackupsDir(dir);
      setBackupRetentionState(retention);
    } catch (value) {
      showError(value);
    }
  }

  async function changeBackupRetention(value: number) {
    const next = Math.max(1, Math.round(value) || 1);
    setBackupRetentionState(next);
    try {
      await setBackupRetention(next);
    } catch (value) {
      showError(value);
    }
  }

  // Pasted screenshots live as real files in app_data/media. Nothing used to
  // remove them, so the folder only ever grew and a deleted note left its
  // pictures readable on disk. Deleting an object now collects its own images;
  // this sweep catches everything that accumulated before that, plus images
  // dropped by an edit rather than a deletion.
  const [mediaSweep, setMediaSweep] = useState<{ files: number; bytes: number } | null>(null);

  async function checkOrphanMedia(remove: boolean) {
    setBusy(true);
    try {
      const result = await sweepOrphanMedia(remove);
      setMediaSweep({ files: result.files, bytes: result.bytes });
      if (remove) showNotice(result.files === 0 ? "No unused images to remove." : `Removed ${result.files} unused image${result.files === 1 ? "" : "s"}.`);
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }

  async function makeBackup() {
    setBusy(true);
    try {
      const path = await backupDatabase();
      showNotice(`Backup created: ${path}`);
      await refreshBackups();
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }

  async function doRestore(backup: BackupInfo) {
    setBusy(true);
    try {
      await restoreDatabase(backup.path);
      // The live connection was swapped out from under every already-loaded
      // object; reload rather than trying to reconcile in-memory state.
      window.location.reload();
    } catch (value) {
      showError(value);
      setBusy(false);
    }
  }

  async function doDeleteBackup(backup: BackupInfo) {
    setBusy(true);
    try {
      await deleteBackup(backup.path);
      await refreshBackups();
    } catch (value) {
      showError(value);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Write a starter plugin the user can immediately install and edit. Deliberately
   * not a documentation link: the fastest way to learn this API is to have a
   * working plugin in front of you.
   */
  async function createPluginFolder() {
    setPluginBusy(true);
    try {
      const parent = await pickPluginFolder();
      if (!parent) return;
      const created = await scaffoldPlugin(parent, `local.plugin-${Date.now().toString(36)}`);
      showNotice(`Starter plugin written to ${created}. Add it with "Add plugin folder".`);
    } catch (value) {
      showError(value);
    } finally {
      setPluginBusy(false);
    }
  }

  /** Save the guide, the full reference, editor types and a worked example. */
  async function downloadDevkit() {
    setPluginBusy(true);
    try {
      const parent = await pickPluginFolder();
      if (!parent) return;
      const created = await exportPluginDevkit(parent);
      showNotice(`Developer pack written to ${created}. Start with START.md.`);
    } catch (value) {
      showError(value);
    } finally {
      setPluginBusy(false);
    }
  }

  /** Unpack a .zip and install it through the same trust flow as a folder. */
  async function installPluginPackage() {
    setPluginBusy(true);
    try {
      const archive = await pickPluginPackage();
      if (!archive) return;
      const extracted = await extractPluginZip(archive);
      await installFromRoot(extracted.install_path, "package");
      // The zip is already extracted into app-owned storage (plugin_install_dir,
      // always readable); nothing reads the original file again. Leaving its
      // grant around is exactly the "20 stale zip links" clutter in Files &
      // links, so drop it the moment install succeeds.
      void revokeGrantedFolder(archive).catch(() => {});
    } catch (value) {
      showError(value);
    } finally {
      setPluginBusy(false);
    }
  }

  /**
   * Re-read a plugin from disk and swap it in place. Without this, changing
   * one line means uninstall-then-reinstall, which is the difference between
   * an API someone tries and one they abandon.
   */
  async function reloadPlugin(entry: typeof pluginEntries[number]) {
    setPluginBusy(true);
    try {
      // Reload is an install of whatever is on disk right now, so it runs the
      // same order as one — and for the same reason.
      //
      // The first version of this function called loadLocalPluginDirectory
      // (which imports and executes the entry module) as its very first
      // action, and checked trust against the *old* registry row. That turned
      // a one-time consent into a standing grant over whatever bytes happened
      // to be at install_path when the button was pressed. It also left the
      // row incoherent: the upsert below resets user_trusted, so without an
      // unconditional re-grant the plugin ran while the database said it was
      // untrusted, and vanished on restart.
      //
      // The cost is one native dialog per reload. That is deliberate: the
      // whole value of the trust prompt is that no code runs without it, and
      // an exception for "but the developer is iterating" is exactly how that
      // guarantee gets lost.
      const preview = await readPluginFile(`${entry.install_path}/plugin.json`, 256 * 1024);
      if (preview.kind !== "text" || preview.truncated) throw new Error("plugin.json must be a complete text file");
      const manifest = JSON.parse(preview.content) as { id: string; name: string; version: string; apiVersion: string; entry?: string; styles?: string[] };
      validatePluginManifest(manifest);
      if (manifest.id !== entry.plugin_id) {
        throw new Error("the folder now contains a different plugin; install it separately");
      }
      await upsertPluginRegistry({
        plugin_id: manifest.id,
        version: manifest.version,
        source: entry.source,
        install_path: entry.install_path,
        manifest: JSON.stringify(manifest),
        verified: false,
      });
      const granted = manifest.entry
        ? await grantPluginTrust(manifest.id, manifest.version)
        : await grantThemeTrust(manifest.id, manifest.version);
      const trusted = granted.verified || granted.user_trusted;
      if (!trusted) throw new Error("plugin was not trusted");

      const artifact = await loadLocalPluginDirectory(entry.install_path, coreLocalPluginFileReader, trusted);
      if (artifact.manifest.id !== manifest.id || artifact.manifest.version !== manifest.version) {
        throw new Error("plugin package changed between the trust prompt and loading");
      }
      await corePluginManager.disable(entry.plugin_id).catch(() => {});
      await corePluginManager.install({ ...artifact, source: entry.source, verified: trusted });
      await setPluginRegistryState(artifact.manifest.id, artifact.manifest.version, "active");
      await refreshPlugins();
      showNotice(`${artifact.manifest.name} reloaded.`);
    } catch (value) {
      showError(value);
    } finally {
      setPluginBusy(false);
    }
  }

  async function installPluginFolder() {
    setPluginBusy(true);
    try {
      const root = await pickPluginFolder();
      if (!root) return;
      await installFromRoot(root, "local-file");
    } catch (value) {
      showError(value);
    } finally {
      setPluginBusy(false);
    }
  }

  /**
   * `source` distinguishes a folder the user still owns (`"local-file"` —
   * Notible must never delete it) from one Notible extracted itself into its
   * own managed directory (`"package"` — safe to delete once superseded).
   * Passing the wrong one for a zip-derived install is exactly what left
   * every updated plugin's old version sitting on disk forever: {@link
   * removePluginRegistry}'s Rust side only ever deletes files for a
   * non-`"local-file"` source.
   */
  async function installFromRoot(root: string, source: "local-file" | "package", sourceUrl?: string) {
    {
      const preview = await readPluginFile(`${root}/plugin.json`, 256 * 1024);
      if (preview.kind !== "text" || preview.truncated) throw new Error("plugin.json must be a complete text file");
      const manifest = JSON.parse(preview.content) as { id: string; name: string; version: string; apiVersion: string; entry?: string; styles?: string[] };
      validatePluginManifest(manifest);
      // `notible.` ids belong to Notible's own plugins: a
      // package may use one only when it comes from an official release.
      // A developer's local folder still may (it is never shown as trusted).
      if (source === "package" && isReservedPluginId(manifest.id) && !isOfficialReleaseUrl(sourceUrl)) {
        throw new Error(t("Plugin ids starting with “notible.” are reserved for Notible's own plugins."));
      }
      if (!manifest.entry && !manifest.styles?.length) {
        throw new Error("plugin.json declares neither entry nor styles");
      }
      // A package with no entry is a theme. It executes nothing, and under
      // this app's CSP css has no remote sink to exfiltrate through, so it
      // installs without the warning screen — which is the whole point of
      // splitting the format by executability rather than by author.
      const hasCode = Boolean(manifest.entry);

      // Order matters, and it is the whole point of this function.
      //
      // This used to call loadLocalPluginDirectory first — which imports and
      // runs the plugin's entry module — and only then write a registry row
      // with a hardcoded `verified: true`. So a folder install executed
      // arbitrary code before the user had been told anything, and recorded a
      // trust level nothing had checked.
      //
      // Now: record what we read off disk, ask the user about *that* record,
      // and execute only if they said yes.
      await upsertPluginRegistry({
        plugin_id: manifest.id,
        version: manifest.version,
        source,
        install_path: root,
        manifest: JSON.stringify(manifest),
        verified: false,
      });
      // D2 — but note *why* nothing is done here.
      //
      // The consent screen is a native OS dialog (`blocking_show` in Rust),
      // drawn outside the webview. Plugin CSS cannot reach it, so it needs no
      // protection: the native dialog is a stronger boundary than any in-app
      // surface could be. Wrapping this in `withoutPluginStyles` protected
      // nothing and cost a visible flicker of unstyled plugin panels behind
      // the dialog, which is how it was found.
      //
      // `withoutPluginStyles` stays in CorePluginSurfaces for the moment
      // consent moves in-app — at which point it becomes required, because a
      // shadow root does not hold (custom properties inherit through it, and
      // the token contract hands them to plugins on purpose).
      const granted = hasCode
        ? await grantPluginTrust(manifest.id, manifest.version, sourceUrl)
        : await grantThemeTrust(manifest.id, manifest.version);
      const trusted = granted.verified || granted.user_trusted;
      if (!trusted) throw new Error("plugin was not trusted");

      const artifact = await loadLocalPluginDirectory(root, coreLocalPluginFileReader, trusted);
      if (artifact.manifest.id !== manifest.id || artifact.manifest.version !== manifest.version) {
        throw new Error("plugin package changed between the trust prompt and loading");
      }
      try {
        await corePluginManager.install({ ...artifact, source, verified: trusted });
        await setPluginRegistryState(artifact.manifest.id, artifact.manifest.version, "active");
      } catch (value) {
        await setPluginRegistryState(artifact.manifest.id, artifact.manifest.version, "failed", messageOf(value));
        throw value;
      }
      // The old version's registry row (and, for a package install, its
      // files) existed as this app's own rollback path in case the new one
      // failed to load. It didn't fail, so there is nothing left to roll
      // back to — keeping it around only grows the plugin list with a
      // version nobody will look at again. Non-fatal: the new version is
      // active either way, and "Remove" on the Plugin host screen is exactly
      // what a failed cleanup here leaves for the user to finish by hand.
      try {
        const superseded = (await listPluginRegistry()).filter((candidate) =>
          candidate.plugin_id === artifact.manifest.id
          && candidate.version !== artifact.manifest.version
          && compareVersions(candidate.version, artifact.manifest.version) < 0,
        );
        for (const candidate of superseded) {
          await corePluginManager.uninstall(candidate.plugin_id, candidate.version);
          await removePluginRegistry(candidate.plugin_id, candidate.version);
        }
      } catch { /* see above */ }
      await refreshPlugins();
      showNotice(`${artifact.manifest.name} installed and activated.`);
    }
  }

  async function changePluginState(entry: typeof pluginEntries[number], state: "active" | "disabled") {
    setPluginBusy(true);
    try {
      if (state === "active") {
        const trusted = entry.verified || entry.user_trusted;
        const loaded = await loadLocalPluginDirectory(entry.install_path, coreLocalPluginFileReader, trusted);
        await corePluginManager.install({ ...loaded, source: entry.source, verified: trusted });
      } else {
        await corePluginManager.disable(entry.plugin_id);
      }
      await setPluginRegistryState(entry.plugin_id, entry.version, state);
      await refreshPlugins();
    } catch (value) {
      showError(value);
    } finally {
      setPluginBusy(false);
    }
  }

  async function uninstallPlugin(entry: typeof pluginEntries[number]) {
    setPluginBusy(true);
    try {
      await corePluginManager.uninstall(entry.plugin_id, entry.version);
      await removePluginRegistry(entry.plugin_id, entry.version);
      await refreshPlugins();
      showNotice(`${entry.plugin_id} removed from Core registry.`);
    } catch (value) {
      showError(value);
    } finally {
      setPluginBusy(false);
    }
  }

  /** Drag-to-reorder: dropping `draggedId` onto `targetId` moves it directly
   * before the target within their shared (parent, category) sibling group
   * — dragging across categories (e.g. a note onto a folder) is a no-op,
   * since category rank always wins over manual order in the sort above.
   * Reassigns `props._order` (spaced by 10) for every sibling in the group
   * so future manual drags have room to slot in without renumbering. */
  async function reorderRow(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const dragged = objects.find((candidate) => candidate.id === draggedId);
    const target = objects.find((candidate) => candidate.id === targetId);
    if (!dragged || !target) return;
    if (objectParentId(dragged) !== objectParentId(target)) return;
    if (categoryRank(dragged.type) !== categoryRank(target.type)) return;
    const siblings = objects
      .filter((candidate) => objectParentId(candidate) === objectParentId(dragged) && categoryRank(candidate.type) === categoryRank(dragged.type))
      .sort((left, right) => objectOrder(left) - objectOrder(right));
    const withoutDragged = siblings.filter((candidate) => candidate.id !== draggedId);
    const targetIndex = withoutDragged.findIndex((candidate) => candidate.id === targetId);
    withoutDragged.splice(targetIndex, 0, dragged);
    const updates = withoutDragged
      .map((candidate, index) => ({ candidate, order: (index + 1) * 10 }))
      .filter(({ candidate, order }) => objectOrder(candidate) !== order);
    if (updates.length === 0) return;
    setObjects((current) => current.map((item) => {
      const update = updates.find(({ candidate }) => candidate.id === item.id);
      if (!update) return item;
      const props = (() => { try { return JSON.parse(item.props || "{}") as Record<string, unknown>; } catch { return {}; } })();
      return { ...item, props: JSON.stringify({ ...props, _order: update.order }) };
    }));
    try {
      for (const { candidate, order } of updates) {
        const props = (() => { try { return JSON.parse(candidate.props || "{}") as Record<string, unknown>; } catch { return {}; } })();
        await coreDataApi.objects.update(candidate.id, { props: JSON.stringify({ ...props, _order: order }) }, candidate.updated_at);
      }
    } catch (value) {
      showError(value);
      await reload();
    }
  }

  const iconForObjectType = (type: string) => {
    if (type === "note") return <FileText size={14} />;
    if (type === "space") return <FolderPlus size={14} />;
    if (type === "folder") return <Folder size={14} />;
    if (type === "project") return <BriefcaseBusiness size={14} />;
    if (type === "task" || type === "todo") return <ListTodo size={14} />;
    if (type === "issue") return <CircleAlert size={14} />;
    if (type === "calendar") return <CalendarDays size={14} />;
    if (type === "table") return <Table2 size={14} />;
    if (type === "dashboard") return <LayoutDashboard size={14} />;
    if (type === "whiteboard") return <Shapes size={14} />;
    if (type === "bookmark") return <Bookmark size={14} />;
    // A plugin type names one of a fixed set of lucide glyphs in its schema
    // `icon` (same idea as `navIcon`), so manuscript / part / chapter / …
    // each read distinctly instead of collapsing to one puzzle piece.
    const named = loadedTypes.find((entry) => entry.name === type)?.icon ?? "";
    const Named = PLUGIN_TYPE_ICONS[named];
    return Named ? <Named size={14} /> : <Puzzle size={14} />;
  };
  const navIconFor = (navIcon: string | undefined) => navIcon === "network" ? <Network size={15} /> : navIcon === "check-square" ? <CheckSquare size={15} /> : navIcon === "file-text" ? <FileText size={15} /> : <Puzzle size={15} />;
  // S4: + creates inside what you are looking at — the open container, or the
  // container the open item sits in. "Top level instead" stays one click away.
  const createTarget = selected && section === "notes"
    ? (containerTypes.has(selected.type) ? selected : objects.find((object) => object.id === objectParentId(selected)) ?? null)
    : null;
  const createParentId = createTarget && !createAtTop ? createTarget.id : undefined;
  // N7: notes are places too, but never the item itself or anything inside it.
  const moveTargets = selected ? (() => {
    const inside = new Set(descendantIdsOf(selected.id));
    return objects.filter((candidate) => candidate.id !== selected.id && !inside.has(candidate.id));
  })() : [];
  const settingsMatches = matchSettings(query);
  // Plain call, not a hook: tens of sections, and it sits below early returns.
  const helpMatches = searchOpen ? searchHelp(HELP_SECTIONS, query) : [];
  const searching = Boolean(query.trim());
  const noteTree = <div className="core-object-list">{visibleObjects.length === 0 && (query.trim() || filtersActive) ? <div className="core-empty">{t("Nothing matches this search.")}</div> : visibleObjects.length === 0 ? <div className="core-empty">{t("No notes yet.")}<br /><button type="button" className="core-inline-action" onClick={() => void addNote()}><Plus size={14} /> {t("Create the first note")}</button></div> : visibleObjects.map(({ object, depth }) => {
    const hasChildren = objects.some((candidate) => objectParentId(candidate) === object.id);
    const container = containerTypes.has(object.type);
    return <div
      className={`core-object-tree-row${dragOverRowId === object.id ? (dragMode === "inside" ? " is-drag-into" : " is-drag-over") : ""}`}
      key={object.id}
      style={{ paddingLeft: depth * 14 }}
      onContextMenu={(event) => { event.preventDefault(); setDeleteConfirm(null); setRowCreateMenuFor({ id: object.id, x: event.clientX, y: event.clientY }); }}
      draggable
      onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDraggedRowId(object.id); }}
      onDragOver={(event) => {
        if (!draggedRowId || draggedRowId === object.id || descendantIdsOf(draggedRowId).includes(object.id)) return;
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        setDragMode(event.clientY - box.top < box.height * 0.25 ? "before" : "inside");
        setDragOverRowId(object.id);
      }}
      onDragLeave={() => setDragOverRowId((current) => current === object.id ? null : current)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOverRowId(null);
        if (draggedRowId && dragMode === "inside") { if (objectParentId(objects.find((item) => item.id === draggedRowId) ?? object) !== object.id) void moveObjectTo(draggedRowId, object.id); }
        else if (draggedRowId) void reorderRow(draggedRowId, object.id);
        setDraggedRowId(null);
      }}
      onDragEnd={() => { setDraggedRowId(null); setDragOverRowId(null); }}
    >
      <button type="button" className={`core-tree-toggle ${container || hasChildren ? "is-visible" : ""}`} aria-label={container ? `${expandedIds.has(object.id) ? "Collapse" : "Expand"} ${object.title}` : ""} onClick={() => { if (hasChildren) setExpandedIds((current) => { const next = new Set(current); if (next.has(object.id)) next.delete(object.id); else next.add(object.id); return next; }); }} disabled={!hasChildren}>{hasChildren ? <ChevronRight size={14} className={expandedIds.has(object.id) ? "is-expanded" : ""} /> : null}</button>
      {renamingId === object.id
        ? <input className="core-object-row-rename" autoFocus defaultValue={object.title} aria-label={t("Rename")} onFocus={(event) => event.currentTarget.select()} onBlur={(event) => void renameObject(object.id, event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } else if (event.key === "Escape") { event.preventDefault(); setRenamingId(null); } }} />
        : <button type="button" className={`core-object-row ${selectedId === object.id ? "is-selected" : ""}`} onClick={() => void openObject(object.id)} onDoubleClick={() => setRenamingId(object.id)} onKeyDown={(event) => { if (event.key === "F2") { event.preventDefault(); setRenamingId(object.id); } }}><span className="core-object-row-icon">{iconForObjectType(object.type)}</span><strong title={object.title || undefined}>{object.title || t("Untitled note")}</strong>{favouriteId === object.id && <Star size={12} className="core-object-row-favourite" aria-label={t("Opens on start")} />}</button>}
      {rowCreateMenuFor?.id === object.id && <div className="core-create-menu core-row-context-menu" role="menu" ref={rowCreateMenuRef} style={{ position: "fixed", left: rowCreateMenuFor.x, top: rowCreateMenuFor.y }}>
        {!deleteConfirm && <>
          {objectMenuCommands.filter((entry) => objectMenuMatches(entry, object.type)).map(({ pluginId, command, label }) => <button type="button" key={`row-action:${object.id}:${pluginId}:${command.id}`} onClick={() => { void runObjectMenuCommand(command, object); setRowCreateMenuFor(null); }}><Puzzle size={15} /> {label}</button>)}
          <button type="button" onClick={() => { setRowCreateMenuFor(null); setRenamingId(object.id); }}><Pencil size={15} /> {t("Rename")}<kbd className="core-menu-hint">F2</kbd></button>
          <button type="button" onClick={() => { setRowCreateMenuFor(null); void openObject(object.id).then(() => setMovePickerOpen(true)); }}><FolderPlus size={15} /> {t("Move to…")}</button>
          {/* Creating comes after the row's own actions, folded (audit V-SCREENS-08):
              seven "New …" items first read as things done to this row. */}
          {container && <button type="button" aria-expanded={rowNewOpen} onClick={() => setRowNewOpen((current) => !current)}><Plus size={15} /> {t("New inside…")}<ChevronRight size={13} className={`core-menu-chevron${rowNewOpen ? " is-expanded" : ""}`} /></button>}
          {container && rowNewOpen && <div className="core-menu-group">
            <button type="button" onClick={() => { void addNote(object.id); setRowCreateMenuFor(null); }}><FileText size={15} /> {t("New note")}</button>
            <button type="button" onClick={() => { void addFolder(object.id); setRowCreateMenuFor(null); }}><Folder size={15} /> {t("Folder")}</button>
            {creatableCommands.map(({ pluginId, command }) => <button type="button" key={`row-create:${object.id}:${pluginId}:${command.id}`} onClick={() => { void addPluginObject(pluginId, command, object.id); setRowCreateMenuFor(null); }}>{iconForObjectType(command.creates.objectType)} {command.creates.label}</button>)}
          </div>}
          {!container && <button type="button" onClick={() => { setRowCreateMenuFor(null); void duplicateObject(object); }}><Copy size={15} /> {t("Duplicate")}</button>}
          {/* Rare actions under one entry (N6): the menu was a wall of exports. */}
          <button type="button" aria-expanded={rowExportOpen} onClick={() => setRowExportOpen((current) => !current)}><Download size={15} /> {t("Export and print")}<ChevronRight size={13} className={`core-menu-chevron${rowExportOpen ? " is-expanded" : ""}`} /></button>
          {rowExportOpen && <div className="core-menu-group">
            <button type="button" onClick={() => { exportObjectAsMarkdown(object); setRowCreateMenuFor(null); }}>{t("Download as Markdown (.md)")}</button>
            <button type="button" onClick={() => { exportObjectTreeAsJson(object); setRowCreateMenuFor(null); }}>{t("Export JSON (with children)")}</button>
            {container && <button type="button" onClick={() => { importTargetRef.current = object.id; setRowCreateMenuFor(null); importJsonRef.current?.click(); }}>{t("Import here…")}</button>}
            <button type="button" onClick={() => { printObjectAsPdf(object); setRowCreateMenuFor(null); }}>{t("Print / Save as PDF")}</button>
          </div>}
          {syncConflicts.some(d=>d.copyId===object.id || d.originalId===object.id) && <button type="button" onClick={()=>{setRowCreateMenuFor(null);void openSyncConflictsRef.current(conflictCopyFor(object.id)).catch(showError);}}>{t("Resolve conflict")}</button>}
          {!container && !syncConflicts.some(d=>d.copyId===object.id || d.originalId===object.id) && <button type="button" onClick={()=>{setRowCreateMenuFor(null);void openSyncConflictsRef.current(object.id).catch(showError);}}>{t("Compare with…")}</button>}
          <button type="button" onClick={() => { setRowCreateMenuFor(null); void openObject(object.id).then(() => setHistoryFor(object)); }}><History size={15} /> {t("Version history")}</button>
          <button type="button" onClick={() => { setFavouriteId((current) => current === object.id ? null : object.id); setRowCreateMenuFor(null); }}><Star size={15} /> {favouriteId === object.id ? t("Don't open on start") : t("Open on start")}</button>
          {object.type === "note" && <button type="button" onClick={() => { setRowCreateMenuFor(null); void toggleCleanupProtection(object).catch(showError); }}><Shield size={15} /> {isCleanupProtected(object) ? t("Stop protecting from AI") : t("Protect from AI")}</button>}
          <button type="button" className="core-menu-item-danger" onClick={() => setDeleteConfirm({ id: object.id, step: 1 })}><Trash2 size={15} /> {t("Delete")}</button>
        </>}
        {deleteConfirm?.id === object.id && <>
          {deleteConfirm.step === 1 && !container && <>
            <p>{t("Move {name} to the trash?", { name: `"${object.title || t("Untitled note")}"` })} {t("You can restore it from Settings → Recovery.")}</p>
            <div className="core-row-delete-actions"><button type="button" onClick={() => setDeleteConfirm(null)}>{t("Cancel")}</button><button type="button" className="core-button-danger" onClick={() => void deleteTreeRow(object.id)} disabled={busy}>{t("Delete")}</button></div>
          </>}
          {deleteConfirm.step === 1 && container && <>
            <p>{t("{name} contains {count} items.", { name: `"${object.title || t("Untitled note")}"`, count: descendantIdsOf(object.id).length })} {t("Everything inside goes to the trash with it.")}</p>
            <div className="core-row-delete-actions"><button type="button" onClick={() => setDeleteConfirm(null)}>{t("Cancel")}</button><button type="button" className="core-button-danger" onClick={() => setDeleteConfirm({ id: object.id, step: 2 })}>{t("Continue")}</button></div>
          </>}
          {deleteConfirm.step === 2 && <>
            <p>{t("{count} items will move to the trash, including {name}.", { count: descendantIdsOf(object.id).length + 1, name: `"${object.title || t("Untitled note")}"` })} {t("You can restore them from Settings → Recovery.")}</p>
            <div className="core-row-delete-actions"><button type="button" onClick={() => setDeleteConfirm(null)}>{t("Cancel")}</button><button type="button" className="core-button-danger" onClick={() => void deleteTreeRow(object.id)} disabled={busy}>{t("Delete all")}</button></div>
          </>}
        </>}
      </div>}
    </div>;
  })}</div>;

  return (
    <main className={`core-shell core-${density}${focusModeOn ? " core-focus-mode" : ""}${sidebarOpen ? " is-sidebar-open" : ""}`} data-core-only="true" data-notible-density={density}>
      {sidebarOpen && <div className="core-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <aside className="core-sidebar" data-notible-region="sidebar" id="core-sidebar">
        <div className="core-brand"><img className="core-brand-mark" src="/brand/notible-icon.svg" alt="" aria-hidden="true" /><strong className="core-brand-text">Notible</strong></div>
        <PluginSlot name="workspace.ribbon" inline />
        <div className="core-sidebar-actions">
          <div className="core-create-wrap" ref={createMenuRef}>
            <button type="button" className="core-new-button" onClick={() => { if (searchOpen) closeSearch(); setCreateMenuOpen((current) => !current); }} disabled={busyVisible} aria-expanded={createMenuOpen} aria-label={t("Create a note, folder or project")} title={t("Create a note, folder or project")}><Plus size={17} /></button>
            {/* One line per item: first-time users could not tell Workspace from
                Folder from Project without leaving for Help. */}
            {createMenuOpen && <div className="core-create-menu core-create-menu-described" role="menu">
              {createTarget && <p className="core-create-target"><span>{createAtTop ? t("At the top level") : t("Inside {name}", { name: createTarget.title || t("Untitled note") })}</span><button type="button" onClick={() => setCreateAtTop((current) => !current)}>{createAtTop ? t("Inside instead") : t("Top level instead")}</button></p>}
              <button type="button" onClick={() => void addNote(createParentId)}><FileText size={15} /><span><strong>{t("New note")}</strong><small>{t("A page to write in.")}</small></span></button>
              <button type="button" onClick={() => void addWorkspace(createParentId)}><FolderPlus size={15} /><span><strong>{t("Workspace")}</strong><small>{t("Overview of several projects.")}</small></span></button>
              <button type="button" onClick={() => void addFolder(createParentId)}><Folder size={15} /><span><strong>{t("Folder")}</strong><small>{t("Groups related things.")}</small></span></button>
              {creatableCommands.map(({ pluginId, command }) => <button type="button" key={`create:${pluginId}:${command.id}`} onClick={() => void addPluginObject(pluginId, command, createParentId)}>{iconForObjectType(command.creates.objectType)}<span><strong>{command.creates.label}</strong>{command.description && <small title={t(command.description)}>{t(command.description)}</small>}</span></button>)}
              {/* M6: the way to more kinds of things, from where you create them. */}
              <button type="button" className="core-create-more" onClick={() => { setCreateMenuOpen(false); navigateToSettingsSection("plugins"); }}><Puzzle size={15} /><span><strong>{t("More with plugins…")}</strong><small>{t("Timelines, finance, automations, tables and more.")}</small></span></button>
            </div>}
          </div>
          <button type="button" className={`core-search-action${searchOpen ? " is-active" : ""}`} onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)} aria-expanded={searchOpen} aria-label={t("Search notes and settings")} title={t("Search notes and settings")}><Search size={17} /></button>
        </div>
        <nav className="core-nav" aria-label={t("Core navigation")}>
          <button type="button" className={section === "notes" ? "is-active" : ""} onClick={() => { if (searchOpen) closeSearch(); navigateToSection("notes"); }}><FileText size={15} /><span>{t("Notes")}</span></button>
          {navPluginViews.map((item) => <button
            type="button"
            key={item.key}
            className={`is-plugin-view${section === pluginViewSection(item.key) ? " is-active" : ""}`}
            title={item.pluginId}
            onClick={() => navigateToSection(pluginViewSection(item.key))}
          >{navIconFor(item.registration.navIcon)}<span>{shownTitle(item.pluginId, item.registration.title)}</span>{ambiguousPluginViewTitles.has(item.registration.title) && <small>{item.pluginId}</small>}</button>)}
        </nav>
        {/* Search is not part of the notes screen any more. Someone looking
            for "backups" does not first check which screen they are on, and
            the old placement meant the box vanished exactly where the answer
            lived. Results are grouped by what they are, and picking a
            settings row goes there. */}
        {/* Always there (N5): leaving for Settings or Help used to empty the
            sidebar, so the way back to a note was gone. */}
        <section className="core-sidebar-notes" aria-label={t("Workspace notes")}>
          {searchOpen && <div className="core-search"><Search size={15} /><input ref={sidebarSearchRef} spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") closeSearch(); }} placeholder={t("Search notes and settings…")} aria-label={t("Search notes and settings")} /><button type="button" className={`core-search-filters-toggle${filtersShown || filtersActive ? " is-active" : ""}`} aria-expanded={filtersShown || filtersActive} aria-label={t("Filters")} title={t("Filters")} onClick={() => setFiltersShown((shown) => !shown)}><SlidersHorizontal size={14} aria-hidden="true" /></button></div>}
          {searchOpen && (filtersShown || filtersActive) && <div className="core-search-filters">
            <Select value={filters.kind} className={`core-search-chip${filters.kind ? " is-active" : ""}`} onChange={(value) => setFilters((current) => ({ ...current, kind: value }))} ariaLabel={t("Filter by kind")} placeholder={t("Any kind")}
              options={[{ value: "", label: t("Any kind") }, ...filterOptions.kinds.map((kind) => ({ value: kind, label: typeLabel(kind) }))]} />
            <Select value={filters.container} className={`core-search-chip${filters.container ? " is-active" : ""}`} onChange={(value) => setFilters((current) => ({ ...current, container: value }))} ariaLabel={t("Filter by project or folder")} placeholder={t("Anywhere")}
              options={[{ value: "", label: t("Anywhere") }, ...filterOptions.containers.map((entry) => ({ value: entry.id, label: entry.title }))]} />
            <Select value={filters.tag} className={`core-search-chip${filters.tag ? " is-active" : ""}`} onChange={(value) => setFilters((current) => ({ ...current, tag: value }))} ariaLabel={t("Filter by tag")} placeholder={t("Any tag")} disabled={filterOptions.tags.length === 0}
              options={[{ value: "", label: t("Any tag") }, ...filterOptions.tags.map((tag) => ({ value: tag, label: tag }))]} />
            <span className={`core-search-chip-dates${filters.from || filters.to ? " is-active" : ""}`}>
              <CalendarDays size={12} aria-hidden />
              <DatePicker value={filters.from} max={filters.to || undefined} ariaLabel={t("From")} placeholder={t("From")} onChange={(value) => setFilters((current) => ({ ...current, from: value }))} />
              <span className="core-search-chip-dash" aria-hidden>–</span>
              <DatePicker value={filters.to} min={filters.from || undefined} ariaLabel={t("To")} placeholder={t("To")} onChange={(value) => setFilters((current) => ({ ...current, to: value }))} />
            </span>
            {filtersActive && <button type="button" className="core-inline-action core-search-chip-clear" onClick={() => setFilters({ kind: "", container: "", tag: "", from: "", to: "" })}>{t("Clear filters")}</button>}
          </div>}
          {searching && visibleObjects.length > 0 && <>
            <div className="core-list-heading"><span>{visibleObjects.some(({ object }) => object.type !== "note") ? t("Results") : t("Notes")}</span><small>{visibleObjects.length}</small></div>
            <div className="core-object-list core-search-hits">
              {visibleObjects.map(({ object }) => {
                const parent = allObjects.find((candidate) => candidate.id === objectParentId(object));
                const snippet = snippetFor(textFromDocument(object.content), query);
                return <button type="button" key={object.id} className={`core-object-row core-search-setting core-search-hit${selectedId === object.id ? " is-selected" : ""}`} aria-current={selectedId === object.id ? "true" : undefined} onClick={() => void openObject(object.id)}>
                  <span className="core-object-row-icon">{iconForObjectType(object.type)}</span>
                  <strong title={object.title || undefined}>{object.title || t("Untitled note")}</strong>
                  {(parent || snippet) && <small>{parent && <span className="core-search-hit-where">{parent.title || t("Untitled note")}</span>}{snippet && <span className="core-search-hit-snippet">{snippet}</span>}</small>}
                </button>;
              })}
            </div>
          </>}
          {searching && visibleObjects.length === 0 && settingsMatches.length === 0 && helpMatches.length === 0 && <div className="core-empty">{t("Nothing matches this search.")}</div>}
          {searchOpen && settingsMatches.length > 0 && <>
            <div className="core-list-heading"><span>{t("Settings")}</span><small>{settingsMatches.length}</small></div>
            <div className="core-object-list">
              {settingsMatches.map((entry) => <button
                type="button"
                key={`${entry.section}:${entry.tab ?? ""}:${entry.label}`}
                className="core-object-row core-search-setting"
                onClick={() => { navigateToSettingsSection(entry.section, entry.tab); closeSearch(); }}
              >
                <span className="core-object-row-icon"><Settings2 size={14} /></span>
                <strong>{t(entry.label)}</strong>
                <small>{t(entry.hint)}</small>
              </button>)}
            </div>
          </>}
          {searchOpen && helpMatches.length > 0 && <>
            <div className="core-list-heading"><span>{t("Help")}</span><small>{helpMatches.length}</small></div>
            <div className="core-object-list">
              {helpMatches.map((hit) => <button
                type="button"
                key={`${hit.pageId}#${hit.slug}`}
                className="core-object-row core-search-setting"
                onClick={() => { openHelp(hit.pageId, hit.slug || undefined); closeSearch(); }}
              >
                <span className="core-object-row-icon"><CircleHelp size={14} /></span>
                <strong>{hit.heading}</strong>
                <small>{hit.slug ? hit.pageTitle : t("Help")}</small>
              </button>)}
            </div>
          </>}
          {!searching && <>
            <div className="core-list-heading"><span>{filtersActive ? t("Notes") : t("All notes")}</span><small>{visibleObjects.length}</small></div>
            {noteTree}
          </>}
        </section>
        <PluginSlot name="workspace.sidebar" />
        <input ref={importFileRef} type="file" accept=".md,.markdown,text/markdown" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importMarkdownFile(file); }} />
        <input ref={importJsonRef} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importObjectTreeFile(file); }} />
        <button type="button" className="core-settings-launcher" onClick={() => importFileRef.current?.click()} disabled={busyVisible}><Upload size={15} /><span>{t("Import Markdown")}</span></button>
        <button type="button" className={`core-settings-launcher ${section === "help" ? "is-active" : ""}`} onClick={() => openHelp()}><CircleHelp size={15} /><span>{t("Help")}</span></button>
        <button type="button" className={`core-settings-launcher ${section === "settings" ? "is-active" : ""}`} onClick={() => navigateToSection("settings")}><Settings2 size={15} /><span>{t("Settings")}</span></button>
      </aside>

      <section className="core-main" data-notible-region="main">
        <header className="core-topbar"><button type="button" className="core-menu-toggle" aria-controls="core-sidebar" aria-expanded={sidebarOpen} aria-label={t("Show notes and menu")} title={t("Show notes and menu")} onClick={() => setSidebarOpen((open) => !open)}><Menu size={18} aria-hidden="true" /></button><div>{section === "notes" && selected && !activePluginView
          ? <nav className="core-eyebrow core-breadcrumb" aria-label={t("Where this is")}>
            <button type="button" onClick={() => { void goToTopLevel(); }}>{t("All notes")}</button>
            {selectedPath.map((ancestor) => <span key={ancestor.id}><span aria-hidden="true">›</span><button type="button" onClick={() => void openObject(ancestor.id)}>{ancestor.title || t("Untitled note")}</button></span>)}
          </nav>
          : <p className="core-eyebrow">{activePluginView ? shownTitle(activePluginView.pluginId, coreHost.getPluginContext(activePluginView.pluginId)?.manifest.name ?? "") : "Notible"}</p>}<h1>{activePluginView ? shownTitle(activePluginView.pluginId, activePluginView.registration.title) :section === "notes" ? t("Notes") : section === "help" ? t("Help") : t("Settings")}</h1></div><div className="core-top-actions">{section !== "notes" && <button type="button" className="core-back-button" onClick={goBack}><ArrowLeft size={15} /> {t("Back")}</button>}</div></header>
        {error && <div className="core-alert" role="alert"><span>{error}</span><button type="button" className="core-notice-action" onClick={() => setError("")} aria-label={t("Close")}>×</button></div>}
        {notice && <div className="core-notice" role="status">{notice.text}{notice.action && <button type="button" className="core-notice-action" onClick={() => { const action = notice.action; setNotice(null); action?.run(); }}>{notice.action.label}</button>}</div>}

        {section === "sync-conflicts" && <SyncConflictView copyId={conflictCopyId} t={t} beforeAction={flushPendingSaveStrict}
          onClose={()=>setSection("notes")} onOpen={openObject}
          onChanged={(object)=>{if(selectedIdRef.current===object.id)loadEditor(object);}} onNotice={showNotice} />}
        {section === "notes" && <section className="core-editor-only core-view-in">
          <section className={`core-editor-panel${selected && !hasContainerSurface(selected.type, containerTypes, objectTabTypes) ? " is-note" : ""}`}>
            {!selected ? <div className="core-editor-empty"><div className="core-empty-icon"><FileText size={21} /></div><h2>{allObjects.length ? t("Pick something on the left") : t("Start with a note")}</h2><p>{t("Use + to create a note, project or whiteboard. Inside a note, type / for headings, lists, checklists and more.")}</p></div> : <>
              {syncConflicts.some(d=>d.copyId===selected.id || d.originalId===selected.id) && <div className="core-conflict-banner"><span>{t("A saved version needs review.")}</span><button type="button" className="core-button" onClick={()=>void openSyncConflictsRef.current(conflictCopyFor(selected.id)).catch(showError)}>{t("Resolve conflict")}</button></div>}
              <div className="core-editor-toolbar"><div className="core-editor-status-group"><span className={`core-dirty${dirty || saving || justSaved ? " is-visible" : ""}${justSaved && !dirty && !saving ? " is-saved" : ""}`} role="status">{saving ? t("Saving…") : dirty ? t("Saving shortly…") : t("Saved")}</span>{proseProfile && !focusModeAvailable && <span className="core-editor-rules core-focus-keep">{t("editing rules")} · {proseProfile.pluginName}</span>}</div><div>{/* Not on projects and workspaces: their tabs are the point, and "plain note editor" read as "lose my dashboard". */}{containerSlot && hasContainerSurface(selected.type, containerTypes, objectTabTypes) && selected.type !== "project" && selected.type !== "space" && <button type="button" className="core-icon-action" onClick={() => setUseLegacyContainer((current) => !current)} title={useLegacyContainer ? t("Use table/board view") : t("Use plain note editor")} aria-label={useLegacyContainer ? t("Use table/board view") : t("Use plain note editor")}>{useLegacyContainer ? <Table2 size={15} /> : <FileText size={15} />}</button>}{selected && objectParentId(selected) && <button type="button" className="core-icon-action" onClick={() => void goToParent()} disabled={busyVisible} title={t("Back to parent")} aria-label={t("Back to parent")}><ArrowLeft size={15} /></button>}{propertiesSlot && !hasContainerSurface(selected.type, containerTypes, objectTabTypes) && <button type="button" className={`core-icon-action core-properties-toggle${propertiesOpen ? " is-active" : ""}`} onClick={() => setPropertiesOpen((current) => !current)} aria-pressed={propertiesOpen} title={t("Properties")} aria-label={t("Properties")}><PanelRight size={15} /></button>}<div className="core-move-wrap" ref={movePickerOpen ? movePickerRef : undefined}><button type="button" className="core-icon-action" onClick={() => setMovePickerOpen((current) => !current)} title={t("Move to…")} aria-label={t("Move to…")}><FolderPlus size={15} /></button>{movePickerOpen && selected && <div className="core-create-menu core-move-menu" role="menu">
                {moveTargets.length === 0 && !objectParentId(selected) && <p className="core-menu-empty">{t("Nothing to move it into yet. Create a folder first.")}</p>}
                {objectParentId(selected) && <button type="button" onClick={() => void moveObjectTo(selected.id, null)}><ArrowLeft size={15} /> {t("Top level")}</button>}
                {moveTargets.map((candidate) => <button type="button" key={candidate.id} disabled={objectParentId(selected) === candidate.id} onClick={() => void moveObjectTo(selected.id, candidate.id)}>{iconForObjectType(candidate.type)} {candidate.title || t("Untitled note")}</button>)}
              </div>}</div><button type="button" className="core-icon-action" onClick={() => exportSelectedAsMarkdown()} title={t("Download as Markdown (.md)")} aria-label={t("Download as Markdown (.md)")}><Download size={15} /></button><button type="button" className="core-icon-action" onClick={() => void removeNote()} title={t("Move to trash")} aria-label={t("Move to trash")}><Trash2 size={15} /></button><PluginSlot name="editor.toolbar" objectId={selected?.id} inline />{focusModeAvailable && <button type="button" className="core-icon-action core-focus-keep" onClick={toggleFocusMode} title={t(focusMode ? "Exit focus mode" : "Focus mode")} aria-label={t(focusMode ? "Exit focus mode" : "Focus mode")}>{focusMode ? <Maximize2 size={15} /> : <Minimize2 size={15} />}</button>}</div></div>
              <div className="core-object-kind-banner"><strong>{objectTypeLabel(selected)}</strong></div>
              <textarea className="core-title-input" rows={1} spellCheck={false} value={title} placeholder={t("Untitled note")} onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); if (!event.nativeEvent.isComposing) enterBodyFromTitle(event.currentTarget); }} onChange={(event) => applyTitle(event.target.value)} aria-label={t("Note title")} />
              {/* Static breadcrumb text, not part of the note body. Clicking in the
                  gap right below the title (between it and the first block, e.g.
                  an image) used to land the browser's plain-text selection here
                  instead of the editor — a dead end, since this paragraph is not
                  contentEditable: arrow keys then had no editable caret to move,
                  so ArrowDown silently did nothing. Redirect the mousedown into
                  the real editor at its first position, same as clicking past the
                  last line of a Word document. */}
              <p
                className="core-editor-meta"
                onMouseDown={(event) => {
                  const editable = bodyWrapRef.current?.querySelector<HTMLElement>(".core-editor-content");
                  if (!editable) return;
                  event.preventDefault();
                  placeCaretAtMarkdownOffset(editable, 0);
                }}
              />
              {containerSlot && hasContainerSurface(selected.type, containerTypes, objectTabTypes) && !(useLegacyContainer && selected.type !== "project" && selected.type !== "space") ? containerSlot(selected.id, selected.type, openObject) : <>
              <div className="core-editor-body-wrap" ref={bodyWrapRef} style={{ ["--nb-editor-font" as string]: editorFont }}>
                <CoreMarkdownEditor
                  value={body}
                  dashList={proseProfile?.profile.dashList ?? true}
                  focusMode={focusModeOn}
                  pageBreaks={proseProfile?.profile.pageBreaks ?? false}
                  decorate={decorateCodeBlocks}
                  decorateNonce={decorateNonce}
                  forceRebuildNonce={slashInsertNonce}
                  onChange={(nextBody, caret) => {
                    draftVersion.current += 1;
                    bodyRef.current = nextBody;
                    setBody(nextBody);
                    const draftContent = documentFromText(nextBody);
                    setSelected((current) => current ? { ...current, content: draftContent } : current);
                    setObjects((current) => current.map((item) => item.id === selectedIdRef.current ? { ...item, content: draftContent } : item));
                    setDirty(true);
                    // "[[" wins over "/": inside a link the slash is part of
                    // the title being typed, not the start of a command.
                    const wikilink = detectWikilinkTrigger(nextBody, caret);
                    const trigger = wikilink ?? detectSlashTrigger(nextBody, caret);
                    if (trigger) {
                      setSlashMenuOpen(true);
                      setMenuMode(wikilink ? "wikilink" : "command");
                      setSlashFilter(trigger.filter);
                      setSlashRange({ start: trigger.start, end: trigger.end });
                      setSlashActiveIndex(0);
                      requestAnimationFrame(() => updateSlashMenuPosition());
                    } else if (slashMenuOpen) {
                      closeSlashMenu();
                    }
                  }}
                  onKeyDown={(event) => {
                    const count = menuMode === "wikilink" ? wikilinkMatches.length : slashMatches.length;
                    if (!slashMenuOpen || count === 0) {
                      if (event.key === "Escape" && slashMenuOpen) closeSlashMenu();
                      return;
                    }
                    if (event.key === "ArrowDown") { event.preventDefault(); setSlashActiveIndex((current) => (current + 1) % count); }
                    else if (event.key === "ArrowUp") { event.preventDefault(); setSlashActiveIndex((current) => (current - 1 + count) % count); }
                    else if (event.key === "Enter" || event.key === "Tab") {
                      event.preventDefault();
                      if (menuMode === "wikilink") selectWikilink(wikilinkMatches[slashActiveIndex] ?? wikilinkMatches[0]);
                      else selectSlashCommand(slashMatches[slashActiveIndex] ?? slashMatches[0]);
                    }
                    else if (event.key === "Escape") { event.preventDefault(); closeSlashMenu(); }
                  }}
                  onBlur={() => { if (slashMenuOpen) closeSlashMenu(); }}
                  onNotice={(message) => showNotice(message)}
                  onScroll={() => { if (slashMenuOpen) updateSlashMenuPosition(); }}
                  wikilinkTitle={wikilinkTitle}
                  onWikilinkClick={(target) => {
                    const object = resolveWikilinkTarget(target, allObjects);
                    if (object) void openObject(object.id);
                    else showNotice(`No note found for [[${target}]].`);
                  }}
                  ref={bodyEditorRef}
                  placeholder={selected.type === "project" ? "Describe the project…" : selected.type === "folder" ? "Describe this folder…" : t("Start writing…")}
                  ariaLabel={t("Note content")}
                />
                {slashMenuOpen && menuMode === "wikilink" && wikilinkMatches.length > 0 && (
                  <div className="core-slash-menu" role="listbox" aria-label={t("Link a note")} style={slashMenuPosition ?? undefined}>
                    {wikilinkMatches.map((object, index) => (
                      <button
                        type="button"
                        key={`wikilink:${object.id}`}
                        role="option"
                        aria-selected={index === slashActiveIndex}
                        ref={index === slashActiveIndex ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
                        className={`core-command-row core-slash-row${index === slashActiveIndex ? " is-active" : ""}`}
                        onMouseDown={(event) => { event.preventDefault(); selectWikilink(object); }}
                        onMouseMove={() => { if (index !== slashActiveIndex) setSlashActiveIndex(index); }}
                      >
                        <div><strong>{object.title || "Untitled note"}</strong><small>{object.type}</small></div>
                      </button>
                    ))}
                  </div>
                )}
                {slashMenuOpen && menuMode === "command" && slashMatches.length > 0 && (
                  <div className="core-slash-menu" role="listbox" aria-label={t("Writing commands")} style={slashMenuPosition ?? undefined}>
                    {slashMatches.map(({ pluginId, command }, index) => (
                      <button
                        type="button"
                        key={`slash:${pluginId}:${command.id}`}
                        role="option"
                        aria-selected={index === slashActiveIndex}
                        ref={index === slashActiveIndex ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
                        className={`core-command-row core-slash-row${index === slashActiveIndex ? " is-active" : ""}`}
                        onMouseDown={(event) => { event.preventDefault(); selectSlashCommand({ pluginId, command }); }}
                        // Move, not enter: a menu that opens under a resting
                        // pointer must keep the first item selected (E13).
                        onMouseMove={() => { if (index !== slashActiveIndex) setSlashActiveIndex(index); }}
                      >
                        <div><strong>{pluginId === CORE_COMMAND_SOURCE ? t(command.name) : command.name}</strong><small>{command.description ? t(command.description) : ""}</small></div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {statsEnabled && <>
                <footer className="core-editor-stats"><span>{t("{count} backlinks", { count: noteStats.backlinks })}</span><span>{t("{count} words", { count: noteStats.words })}</span><span>{t("{count} characters", { count: noteStats.characters })}</span><PluginSlot name="editor.footer" objectId={selected?.id} inline />{selected && <span className="core-editor-created">{t("Created {when}", { when: new Date(selected.created_at).toLocaleString() })}</span>}{selected && <button type="button" className="core-editor-edited" onClick={() => setHistoryFor(selected)} title={t("Version history")}>{t("Edited {when}", { when: new Date(selected.updated_at).toLocaleString() })}</button>}</footer>
                <section className="core-backlinks" aria-label={t("Backlinks")}>
                  <div className="core-backlinks-heading"><strong>{t("Backlinks")}</strong><span>{backlinks.length}</span></div>
                  {backlinks.length === 0
                    ? <div className="core-backlinks-empty"><p>{t("No backlinks yet")}</p><small>{t("Link another note with [[title]] to see it here.")}</small></div>
                    : <div className="core-backlinks-list">{backlinks.map((backlink) => (
                      <button key={backlink.source.id} type="button" className="core-backlink-row" onClick={() => void openObject(backlink.source.id)} title={t("Open source note")}>
                        <span><strong>{backlink.source.title || "Untitled note"}</strong><small>{backlink.fromRelation ? t(backlink.context) : backlink.context}</small></span>
                        <ArrowLeft size={14} className="core-backlink-arrow" aria-hidden="true" />
                      </button>
                    ))}</div>}
                </section>
              </>}
              </>}
            </>}
          </section>
          {propertiesSlot && selected && !hasContainerSurface(selected.type, containerTypes, objectTabTypes) && <aside className={`core-properties-aside${propertiesOpen ? " is-open" : ""}`}>{propertiesSlot(selected.id, selected.type)}<PluginSlot name="object.properties" objectId={selected.id} /></aside>}
        </section>}



        {/* A registered plugin view gets the whole main area — the same card
            Notes and Settings get — not a floating window. */}
        {activePluginView && <section className="core-plugin-view-pane" data-plugin-view={activePluginView.key} aria-label={shownTitle(activePluginView.pluginId, activePluginView.registration.title)}>
          <CorePluginViewPane item={activePluginView} />
        </section>}

        {section === "help" && <HelpScreen
          target={helpTarget}
          onNavigate={(id, slug) => setHelpTarget({ id, slug })}
          onOpenSettingsPlugins={() => navigateToSettingsSection("plugins", "all")}
        />}

        {section === "settings" && <section className={`core-settings-shell core-view-in${settingsSection === "plugins" ? " has-plugins-detail" : ""}`}>
          <aside className="core-settings-nav" aria-label={t("Core settings sections")}>
            <p className="core-eyebrow">{t("Settings sections")}</p>
            <button type="button" className={settingsSection === "appearance" ? "is-active" : ""} onClick={() => navigateToSettingsSection("appearance")} title={t("Theme and density")}><SlidersHorizontal size={16} /><span><strong>{t("Appearance")}</strong></span></button>
            <button type="button" className={settingsSection === "languages" ? "is-active" : ""} onClick={() => navigateToSettingsSection("languages")} title={t("Language packs")}><Languages size={16} /><span><strong>{t("Languages")}</strong></span></button>
            <button type="button" className={settingsSection === "editor" ? "is-active" : ""} onClick={() => navigateToSettingsSection("editor")} title={t("Writing and slash commands")}><FileText size={16} /><span><strong>{t("Editor")}</strong></span></button>
            <button type="button" className={settingsSection === "files" ? "is-active" : ""} onClick={() => navigateToSettingsSection("files")} title={t("Workspace structure")}><Folder size={16} /><span><strong>{t("Files & links")}</strong></span></button>
            <button type="button" className={settingsSection === "hotkeys" ? "is-active" : ""} onClick={() => navigateToSettingsSection("hotkeys")} title={t("Keys for commands")}><Keyboard size={16} /><span><strong>{t("Hotkeys")}</strong></span></button>
            <button type="button" className={settingsSection === "plugins" ? "is-active" : ""} onClick={() => navigateToSettingsSection("plugins")} title={t("Enabled, catalogue, market")}><LayoutGrid size={16} /><span><strong>{t("Plugins")}</strong></span></button>
            <button type="button" className={settingsSection === "recovery" ? "is-active" : ""} onClick={() => navigateToSettingsSection("recovery")} title={t("Backups and trash")}><LifeBuoy size={16} /><span><strong>{t("Recovery")}</strong></span></button>
            <button type="button" className={settingsSection === "ai-cleanup" ? "is-active" : ""} onClick={() => navigateToSettingsSection("ai-cleanup")} title={t("Connect AI assistants, choose what they may do, review cleanup requests")}><Bot size={16} /><span><strong>{t("MCP server")}{cleanupPending > 0 && <span className="core-settings-nav-count" aria-label={t("{count} waiting", { count: cleanupPending })}>{cleanupPending}</span>}</strong></span></button>
            <button type="button" className={settingsSection === "updates" ? "is-active" : ""} onClick={() => navigateToSettingsSection("updates")} title={t("Check and install")}><Download size={16} /><span><strong>{t("Updates")}</strong></span></button>
            <button type="button" className={settingsSection === "about" ? "is-active" : ""} onClick={() => navigateToSettingsSection("about")} title={t("Version and API")}><Info size={16} /><span><strong>{t("About")}</strong></span></button>
          </aside>
          <div className="core-settings-detail">
            {settingsSection === "appearance" && <article className="core-settings-section core-view-in">
              <div className="core-settings-section-heading"><div><p className="core-eyebrow">{t("Appearance")}</p><h2>{t("How Notible looks")}</h2><p>{t("These settings apply to this device and do not change your notes.")}</p></div><span className="core-settings-mark"><SlidersHorizontal size={21} /></span></div>
              <div className="core-setting-row"><div><label htmlFor="core-theme">{t("Theme")}</label><small>{t("Light, dark, or whatever Windows is set to.")}</small></div><Select id="core-theme" ariaLabel={t("Theme")} value={themeChoice} onChange={(next) => setThemeChoice(next as CoreThemeChoice)} options={[{ value: "system", label: t("Follow system") }, { value: "paper", label: t("Daylight") }, { value: "night", label: t("Midnight") }]} /></div>
              <div className="core-setting-row"><div><label htmlFor="core-notice-sound">{t("Notification sound")}</label><small>{t("Played when a reminder or a plugin's notification shows inside Notible. Windows notifications keep their own sound.")}</small></div><div className="core-setting-inline"><button type="button" className="core-secondary-action" disabled={noticeSound === "none"} onClick={() => playNoticeSound(noticeSound)}>{t("Preview")}</button><Select id="core-notice-sound" ariaLabel={t("Notification sound")} value={noticeSound} onChange={(next) => { setNoticeSound(next as NoticeSound); playNoticeSound(next as NoticeSound); }} options={NOTICE_SOUNDS.map((sound) => ({ value: sound, label: sound === "none" ? t("None") : sound === "chime" ? t("Soft chime") : sound === "bell" ? t("Bell") : t("Pop") }))} /></div></div>
              <div className="core-setting-row"><div><label htmlFor="core-zoom">{t("Interface size")}</label><small>{t("Bigger or smaller everything. Ctrl and + or − change it anywhere, Ctrl+0 resets it.")}</small></div><Select id="core-zoom" ariaLabel={t("Interface size")} value={String(zoom)} onChange={(next) => setZoom(Number(next))} options={ZOOM_STEPS.map((step) => ({ value: String(step), label: `${Math.round(step * 100)} %` }))} /></div>
              <div className="core-setting-row"><div><label htmlFor="core-density">{t("Density")}</label><small>{t("Change spacing in lists, cards and the editor.")}</small></div><Select id="core-density" ariaLabel={t("Density")} value={density} onChange={(next) => setDensity(next as CoreDensity)} options={[{ value: "comfortable", label: t("Comfortable") }, { value: "compact", label: t("Compact") }]} /></div>
              <div className="core-setting-row core-setting-sidebar-tree"><div><label htmlFor="core-sidebar-tree">{t("Sidebar tree")}</label></div><Select id="core-sidebar-tree" ariaLabel={t("Sidebar tree")} value={sidebarTreeMode} onChange={(next) => setSidebarTreeMode(next as SidebarTreeMode)} options={[{ value: "auto", label: t("Auto-expand to the open note") }, { value: "manual", label: t("Manual (only what I expand)") }]} /></div>
              <div className="core-settings-group-heading core-code-look-heading"><div><h3>{t("Code blocks")}</h3><p>{t("How code looks in notes on this device. Text settings above do not change it.")}</p></div><button type="button" className="core-secondary-action" disabled={JSON.stringify(codeLook) === JSON.stringify(CODE_LOOK_DEFAULT)} onClick={() => setCodeLook(CODE_LOOK_DEFAULT)}>{t("Reset")}</button></div>
              <div className="core-setting-row"><div><label htmlFor="core-code-size">{t("Code font size")}</label></div><Select id="core-code-size" ariaLabel={t("Code font size")} value={String(codeLook.size)} onChange={(next) => changeCodeLook({ size: Number(next) })} options={CODE_SIZES.map((size) => ({ value: String(size), label: markDefault(`${size} px`, size === CODE_LOOK_DEFAULT.size) }))} /></div>
              <div className="core-setting-row"><div><label htmlFor="core-code-line-height">{t("Code line height")}</label></div><Select id="core-code-line-height" ariaLabel={t("Code line height")} value={String(codeLook.lineHeight)} onChange={(next) => changeCodeLook({ lineHeight: Number(next) })} options={CODE_LINE_HEIGHTS.map((height) => ({ value: String(height), label: markDefault(String(height), height === CODE_LOOK_DEFAULT.lineHeight) }))} /></div>
              <div className="core-setting-row"><div><label htmlFor="core-code-wrap">{t("Long code lines")}</label></div><Select id="core-code-wrap" ariaLabel={t("Long code lines")} value={codeLook.wrap} onChange={(next) => changeCodeLook({ wrap: next === "scroll" ? "scroll" : "wrap" })} options={[{ value: "wrap", label: markDefault(t("Wrap"), true) }, { value: "scroll", label: t("Scroll sideways") }]} /></div>
              <div className="core-setting-row"><div><label htmlFor="core-code-tab-size">{t("Tab width")}</label><small>{t("In spaces.")}</small></div><Select id="core-code-tab-size" ariaLabel={t("Tab width")} value={String(codeLook.tabSize)} onChange={(next) => changeCodeLook({ tabSize: Number(next) })} options={CODE_TAB_SIZES.map((size) => ({ value: String(size), label: markDefault(String(size), size === CODE_LOOK_DEFAULT.tabSize) }))} /></div>
            </article>}
            {settingsSection === "languages" && <CoreLanguagesPanel installed={installedLocales} language={language} onUse={(next) => { setLanguageChoice(next); setCoreLanguage(next); }} onChanged={refreshLocales} />}
            {settingsSection === "editor" && <article className="core-settings-section core-view-in">
              <div className="core-settings-section-heading"><div><p className="core-eyebrow">{t("Editor")}</p><h2>{t("Writing")}</h2><p>{t("Type / in a note for headings, lists, checklists and blocks from your plugins. Use the arrow keys and Enter to pick one.")}</p></div><span className="core-settings-mark"><FileText size={21} /></span></div>
              <div className="core-setting-row"><div><label>{t("Backlinks and document stats")}</label><small>{t("Show backlinks, words and characters below the note.")}</small></div><CoreSwitch checked={statsEnabled} label={t("Backlinks and document stats")} onChange={setStatsEnabled} /></div>
            </article>}
            {settingsSection === "files" && <article className="core-settings-section core-files-settings core-view-in">
              <div className="core-settings-section-heading"><div><p className="core-eyebrow">{t("Files & links")}</p><h2>{t("Files & links")}</h2><p>{t("What plugins may read, how a note prints, and folders you have linked.")}</p></div><span className="core-settings-mark"><Folder size={21} /></span></div>
              <div className="core-settings-group-heading"><h3>{t("Plugin permissions")}</h3><p>{t("Off until you turn them on. Each asks once when you do.")}</p></div>
              <div className="core-setting-row"><div><label>{t("Let plugins read pasted images")}</label><small title={t("Turning it on asks once, natively. While on, every active plugin can read every image you have pasted and send it anywhere.")}>{t("Needed to sync pictures between devices and to put them in reports.")}</small></div><CoreSwitch checked={mediaSharing} label={t("Let plugins read pasted images")} onChange={(value) => { void setMediaSharing(value).then(setMediaSharingState).catch(showError); }} /></div>
              <div className="core-setting-row"><div><label>{t("Let plugins read your calendars")}</label><small title={t("Turning it on asks once, natively. The Calendar tab can then open a Google or Microsoft sign-in and read the calendars you pick.")}>{t("Lets a project's Calendar tab show your Google or Outlook calendar.")}</small></div><CoreSwitch checked={calendarSharing} label={t("Let plugins read your calendars")} onChange={(value) => { void setCalendarSharing(value).then(setCalendarSharingState).catch(showError); }} /></div>
              <div className="core-settings-group-heading"><h3>{t("PDF export")}</h3><p>{t("Applied to “Print / Save as PDF” from a note.")}</p></div>
              <div className="core-setting-row"><div><label htmlFor="core-print-font">{t("PDF text size")}</label><small>{t("Body size in points for “Print / Save as PDF”. Headings scale with it.")}</small></div><Select id="core-print-font" ariaLabel={t("PDF text size")} value={String(printOptions.fontPt)} onChange={(next) => setPrintOptions((current) => ({ ...current, fontPt: Number(next) }))} options={[9, 10, 11, 12, 14].map((size) => ({ value: String(size), label: `${size} pt` }))} /></div>
              <div className="core-setting-row"><div><label htmlFor="core-print-margin">{t("PDF page margin")}</label><small>{t("Applied on every side of the printed page.")}</small></div><Select id="core-print-margin" ariaLabel={t("PDF page margin")} value={String(printOptions.marginMm)} onChange={(next) => setPrintOptions((current) => ({ ...current, marginMm: Number(next) }))} options={[10, 15, 18, 25].map((size) => ({ value: String(size), label: `${size} mm` }))} /></div>
              <div className="core-setting-row"><div><label>{t("PDF title heading")}</label><small>{t("Print the note name as a heading on the first page.")}</small></div><CoreSwitch checked={printOptions.title} onChange={(value) => setPrintOptions((current) => ({ ...current, title: value }))} label={t("PDF title heading")} /></div>
              <div className="core-setting-row"><div><label>{t("PDF export date")}</label><small>{t("Print today's date under the title.")}</small></div><CoreSwitch checked={printOptions.date} onChange={(value) => setPrintOptions((current) => ({ ...current, date: value }))} label={t("PDF export date")} /></div>
              <div className="core-setting-row"><div><label>{t("PDF full-width images")}</label><small>{t("Stretch every screenshot to the text width instead of its own size.")}</small></div><CoreSwitch checked={printOptions.wideImages} onChange={(value) => setPrintOptions((current) => ({ ...current, wideImages: value }))} label={t("PDF full-width images")} /></div>
              <GrantedFolderSettings />
            </article>}
            {settingsSection === "hotkeys" && <article className="core-settings-section core-view-in">
              <div className="core-settings-section-heading"><div><p className="core-eyebrow">{t("Hotkeys")}</p><h2>{t("Keyboard shortcuts")}</h2><p>{t("Shortcuts stay close to the writing workflow and avoid adding permanent toolbar controls.")}</p></div><span className="core-settings-mark"><Keyboard size={21} /></span></div>
              <div className="core-settings-group-heading"><h3>{t("Core shortcuts")}</h3><p>{t("Built into Core and not configurable.")}</p></div><div className="core-hotkey-list"><div><strong><kbd>Ctrl</kbd><span>+</span><kbd>N</kbd></strong><span>{t("New note")}</span></div><div><strong><kbd>Ctrl</kbd><span>+</span><kbd>,</kbd></strong><span>{t("Open settings")}</span></div><div><strong><kbd>Alt</kbd><span>+</span><kbd>Space</kbd></strong><span>{t("Open search")}</span></div><div><strong><kbd>Alt</kbd><span>+</span><kbd>←</kbd></strong><span>{t("Back to the previous note")}</span></div><div><strong><kbd>/</kbd></strong><span>{t("Open plugin commands in the editor")}</span></div><div><strong><kbd>Esc</kbd></strong><span>{t("Close the active menu")}</span></div></div>
              <PluginHotkeySettings />
            </article>}
            {settingsSection === "plugins" && <article className="core-settings-section core-view-in">
              <div className="core-settings-section-heading"><div><p className="core-eyebrow">{t("Plugins")}</p><h2>{t("Plugins")}</h2><p>{t("Everything installed, and the market to add more. Pick one to read what it does and change its settings.")}</p></div><span className="core-settings-mark"><LayoutGrid size={21} /></span></div>
              <div className="core-object-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={pluginsTab === "all"} className={pluginsTab === "all" ? "is-active" : ""} onClick={() => setPluginsTab("all")}>{t("All")}</button>
                <button type="button" role="tab" aria-selected={pluginsTab === "market"} className={pluginsTab === "market" ? "is-active" : ""} onClick={() => setPluginsTab("market")}>{t("Market")}</button>
              </div>

              {cornerHelpers.length > 0 && <div className="core-setting-row"><div><label htmlFor="core-corner-helper">{t("Corner helper")}</label><small>{t("Which plugin sits in the bottom-left corner of your notes.")}</small></div><Select id="core-corner-helper" ariaLabel={t("Corner helper")} value={cornerOccupant?.pluginId ?? "none"} onChange={(next) => setCornerChoice(next)} options={[...cornerHelpers.map((candidate) => ({ value: candidate.pluginId, label: coreHost.getPluginContext(candidate.pluginId)?.manifest.name ?? candidate.pluginId })), { value: "none", label: t("None") }]} /></div>}
              {pluginsMatrixNode ?? <p className="core-settings-hint">{t("The plugin catalogue is available in the full app.")}</p>}
            </article>}
            {settingsSection === "ai-cleanup" && <McpCleanupPanel projects={allObjects.filter((object) => object.type === "project" && !object.trashed_at)} flush={flushPendingSaveStrict} onTrashed={async () => { await reload(); await refreshTrash(); }} onError={showError} onNotice={showNotice} />}
            {settingsSection === "recovery" && <article className="core-settings-section core-view-in">
              <div className="core-settings-section-heading"><div><p className="core-eyebrow">{t("Recovery")}</p><h2>{t("Workspace safety")}</h2><p>{t("Recovery works from real backup files on disk — create one, restore from one, or drop one in from elsewhere.")}</p></div><span className="core-settings-mark"><LifeBuoy size={21} /></span></div>
              <div className="core-settings-group-heading"><h3>{t("Backup")}</h3><p>{t("Copies of the workspace database, kept on disk.")}</p></div><div className="core-settings-action"><div><strong>{t("Database backup")}</strong><p>{t("Create a copy of the current database before installing or changing plugins.")}</p></div><button type="button" className="core-button core-button-primary" onClick={() => void makeBackup()} disabled={busy}>{busy ? t("Creating…") : t("Create database backup")}</button></div>

              <div className="core-setting-row"><div><label htmlFor="core-backup-retention">{t("Keep newest backups")}</label><small>{t("Older backups beyond this count are deleted automatically, on both manual and automatic startup backups.")}</small></div><input id="core-backup-retention" type="number" className="core-settings-field" min={1} max={200} value={backupRetention} onChange={(event) => void changeBackupRetention(Number(event.target.value))} /></div>

              {/* A status bar plus a <details>: the screen answers "am I safe?"
                  at a fixed height whether there are two backups or two
                  hundred. Row actions are under the right button, which is
                  what keeps a row one line tall. */}
              <div className="core-collection">
                <div className="core-collection-summary">
                  <div>
                    <strong>{t("Backups")}</strong>
                    <p>{backups.length === 0
                      ? t("None yet — create one above, or drop a .db file into the backups folder.")
                      : t("Latest: {when} · {size} · keeping {count} of {max}", { when: formatBackupDate(newestBackup!.modified_at), size: formatBackupSize(newestBackup!.size), count: backups.length, max: backupRetention })}</p>
                  </div>
                  {backupsDir && backups.length > 0 && <button type="button" className="core-button" title={backupsDir} onClick={() => void openPath(backupsDir).catch(showError)}>{t("Open folder")}</button>}
                </div>
                {backups.length > 0 && <details className="core-collection-disclosure">
                  <summary>{t("Show all {count}", { count: backups.length })}</summary>
                  {backups.map((backup) => <div className="core-collection-row" key={backup.path} onContextMenu={(event) => { event.preventDefault(); setRowMenu({ x: event.clientX, y: event.clientY, items: [
                    { label: t("Restore from this backup"), run: () => setRestoreTarget(backup) },
                    { label: t("Delete backup"), danger: true, run: () => void doDeleteBackup(backup) },
                  ] }); }}>
                    <div><strong>{backup.filename}</strong><span className="core-collection-meta">{formatBackupDate(backup.modified_at)} · {formatBackupSize(backup.size)}</span></div>
                    {/* Visible, not right-click only: restoring is this list's whole job (D7). */}
                    <button type="button" className="core-secondary-action" onClick={() => setRestoreTarget(backup)} disabled={busy}>{t("Restore")}</button>
                  </div>)}
                </details>}
                {backups.length > 0 && <p className="core-settings-hint">{t("Right-click a backup to delete it. A .db file copied into the backups folder shows up here too.")}</p>}
              </div>

              {restoreTarget && <div className="core-restore-confirm" role="alertdialog">
                <p><strong>{t("Restore {name}?", { name: restoreTarget.filename })}</strong> {t("This replaces the current workspace database with this backup. The app will reload immediately after.")}</p>
                <div className="core-restore-confirm-actions">
                  <button type="button" className="core-button" onClick={() => setRestoreTarget(null)} disabled={busy}>{t("Cancel")}</button>
                  <button type="button" className="core-button core-button-danger" onClick={() => void doRestore(restoreTarget)} disabled={busy}>{busy ? t("Restoring…") : t("Restore and reload")}</button>
                </div>
              </div>}

              <div className="core-settings-group-heading"><h3>{t("Storage cleanup")}</h3><p>{t("Pasted images that no note uses any more.")}</p></div><div className="core-settings-action"><div><strong>{t("Unused pasted images")}</strong><p>{mediaSweep === null ? t("Screenshots pasted into notes are stored as files. Check for ones no note, property or restorable version still uses.") : mediaSweep.files === 0 ? t("Nothing to clean up — every stored image is still in use.") : `${mediaSweep.files} unused image${mediaSweep.files === 1 ? "" : "s"} · ${formatBackupSize(mediaSweep.bytes)}`}</p></div>{mediaSweep && mediaSweep.files > 0
                ? <button type="button" className="core-button core-button-danger" onClick={() => void checkOrphanMedia(true)} disabled={busy}>{t("Delete {count} unused files", { count: mediaSweep.files })}</button>
                : <button type="button" className="core-button" onClick={() => void checkOrphanMedia(false)} disabled={busy}>{t("Check for unused images")}</button>}</div>

              <div className="core-collection">
                <div className="core-collection-summary">
                  <div><strong>{t("Trash")}</strong><p>{trashObjects.length === 0 ? t("Empty.") : t("{count} items · restored to where they were, unchanged.", { count: trashObjects.length })}</p></div>
                  {trashObjects.length > 0 && <button type="button" className="core-button core-button-danger" onClick={() => setPurgeConfirm({ ids: trashObjects.map((object) => object.id), label: t("everything in the trash") })} disabled={busy}>{t("Empty trash")}</button>}
                </div>
                {/* Visible buttons, not right-click: this list exists only to
                    restore or finish deleting (D7). */}
                {trashObjects.length > 0 && <details className="core-collection-disclosure" open={trashObjects.length <= 5 || undefined}>
                  <summary>{t("Show all {count}", { count: trashObjects.length })}</summary>
                  {trashObjects.map((object) => <div className="core-collection-row" key={object.id}>
                    <div><strong>{object.title || t("Untitled note")}</strong><span className="core-collection-meta">{objectTypeLabel(object)}</span></div>
                    <span className="core-collection-actions">
                      <button type="button" className="core-secondary-action" onClick={() => void restoreFromTrash(object.id)} disabled={busy}>{t("Restore")}</button>
                      <button type="button" className="core-secondary-action core-secondary-action-danger" onClick={() => setPurgeConfirm({ ids: trashTreeIds(object.id), label: `"${object.title || t("Untitled note")}"` })} disabled={busy}>{t("Delete forever")}</button>
                    </span>
                  </div>)}
                </details>}
                {purgeConfirm && <div className="core-restore-confirm" role="alertdialog">
                  <p><strong>{t("Delete {name} for good?", { name: purgeConfirm.label })}</strong> {t("This cannot be undone.")}</p>
                  <div className="core-restore-confirm-actions">
                    <button type="button" className="core-button core-button-secondary" onClick={() => setPurgeConfirm(null)} disabled={busy}>{t("Cancel")}</button>
                    <button type="button" className="core-button core-button-danger" onClick={() => void deleteForever(purgeConfirm.ids)} disabled={busy}>{t("Delete forever")}</button>
                  </div>
                </div>}
              </div>
              <div className="core-settings-note"><strong>{t("How restoring works")}</strong><p>{t("Backups stay on this computer. Restoring replaces your current notes with the backup, and the backup is checked before anything is replaced.")}</p></div>
            </article>}
            {settingsSection === "updates" && <CoreUpdateSection />}
            {settingsSection === "about" && <article className="core-settings-section core-view-in">
              <div className="core-settings-section-heading"><div><p className="core-eyebrow">{t("About")}</p><h2>Notible</h2><p>{t("Which version you are running, and what is new in it.")}</p></div><span className="core-settings-mark"><Info size={21} /></span></div>
              <div className="core-setting-row"><div><label>{t("Version")}</label></div><span className="core-setting-value">{packageJson.version}</span></div>
              <div className="core-setting-row"><div><label>{t("Your notes are stored")}</label></div><span className="core-setting-value">{t("On this computer")}</span></div>
              <div className="core-settings-action"><div><strong>{t("Release notes")}</strong><p>{t("What changed in this version.")}</p></div><button type="button" className="core-button core-button-primary" onClick={() => setShowReleaseNotes(true)}>{t("Release notes")}</button></div>
              {/* Developer facts, collapsed: they were the loudest thing on the
                  page for people who only take notes. */}
              <details className="core-collection-disclosure core-about-technical">
                <summary>{t("Technical details")}</summary>
                <div className="core-setting-row"><div><label>{t("Plugin API")}</label><small>{t("Contract version every installed plugin is checked against.")}</small></div><span className="core-setting-value">{EXTENSION_API_VERSION}</span></div>
                <div className="core-setting-row"><div><label>{t("Database")}</label><small>{t("Engine that stores your notes.")}</small></div><span className="core-setting-value">SQLite · local-first</span></div>
                <div className="core-setting-row"><div><label>{t("Frontend")}</label><small>{t("Bundle served by the app shell.")}</small></div><span className="core-setting-value">dist-core</span></div>
                <div className="core-settings-action"><div><strong>{t("Plugin API reference")}</strong><p>{t("For people writing plugins. Opens in your browser.")}</p></div><button type="button" className="core-button" onClick={() => void openUrl("https://notible.app/docs/plugin-api").catch(showError)}>{t("Plugin API")}</button></div>
                <div className="core-settings-action"><div><strong>{t("Developer pack")}</strong><p>{t("A working two-file plugin plus the API types and reference docs, saved to a folder you pick.")}</p></div><button type="button" className="core-button" onClick={() => void downloadDevkit()} disabled={pluginBusy}><Download size={14} /> {t("Developer pack")}</button></div>
              </details>
            </article>}
            {showReleaseNotes && <div className="core-modal-backdrop" role="presentation" onClick={() => setShowReleaseNotes(false)}>
              <div className="core-modal core-modal-wide" role="dialog" aria-modal="true" aria-labelledby="core-release-notes-title" onClick={(event) => event.stopPropagation()}>
                <div className="core-modal-head">
                  <h3 id="core-release-notes-title">{t("Release notes")}</h3>
                  <button type="button" className="core-button" onClick={() => setShowReleaseNotes(false)}>{t("Close")}</button>
                </div>
                {/* Shown locally — notible.app/releases doesn't exist yet. Content
                    is docs/RELEASE_NOTES.md, English only (release:check enforces it). */}
                <div className="core-plugin-guide" dangerouslySetInnerHTML={{ __html: renderCoreMarkdown(RELEASE_NOTES_MD) }} />
              </div>
            </div>}
          </div>
          {settingsSection === "plugins" && <aside className="core-plugins-detail-pane" ref={setPluginsDetailEl} aria-label={t("Plugin details")} />}
        </section>}
      </section>
      {historyFor && <VersionHistoryPanel
        object={selected && selected.id === historyFor.id ? selected : historyFor}
        isNote={!hasContainerSurface(historyFor.type, containerTypes, objectTabTypes)}
        toText={textFromDocument}
        beforeRestore={async () => { if (selectedIdRef.current === historyFor.id) await flushPendingSave(); }}
        t={t}
        onRestored={(restored) => { setHistoryFor(restored); if (selectedIdRef.current === restored.id) loadEditor(restored); }}
        onError={showError}
        onNotice={showNotice}
        onClose={() => setHistoryFor(null)}
      />}
      {rowMenu && <div className="core-create-menu core-row-context-menu" role="menu" ref={rowMenuRef} style={{ position: "fixed", left: rowMenu.x, top: rowMenu.y }}>
        {rowMenu.items.map((item) => <button type="button" key={item.label} className={item.danger ? "core-menu-item-danger" : undefined} disabled={busy} onClick={() => { item.run(); setRowMenu(null); }}>{item.label}</button>)}
      </div>}
      <CoreUpdateToast />
      <PluginCorner
        hidden={section === "settings" || section === "help" || focusModeOn}
        // Built in, signed, or a market package with a `notible.` id — which
        // only an official release can install (see installFromRoot).
        isTrusted={(pluginId) => Boolean(builtinCatalog?.some((manifest) => manifest.id === pluginId)) || pluginEntries.some((entry) => entry.plugin_id === pluginId && (entry.verified || (entry.source === "package" && isReservedPluginId(entry.plugin_id))))}
      />
      <CoreOverlayHost />
      {modulePicker && (
        <ContainerModulePicker
          objectKind={modulePicker.kind}
          onCancel={() => setModulePicker(null)}
          onConfirm={(moduleIds, name) => {
            const picked = modulePicker;
            setModulePicker(null);
            if (!picked) return;
            const modules = moduleIds.length ? moduleIds : undefined;
            if (picked.pluginCreate) { void runPluginCreate(picked.pluginCreate.pluginId, picked.pluginCreate.command, picked.parentId, modules, name); return; }
            void createContainer(picked.kind as "folder" | "space", picked.parentId, moduleIds, name);
          }}
        />
      )}
    </main>
  );
}
