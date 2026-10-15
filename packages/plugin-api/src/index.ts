/**
 * Public plugin contract. This package intentionally contains no Tauri,
 * React or SQLite imports, so an external plugin can type-check against it
 * without depending on Core internals.
 */

export const EXTENSION_API_VERSION = "1.28";

/**
 * Can a plugin declaring `declared` run on a host offering `host`?
 *
 * Rule: same major, and the host's minor must be at least the plugin's. A
 * plugin built against 1.0 runs on 1.3; one built against 1.3 does not run on
 * 1.0, because it may use something that did not exist yet. `0.x` is accepted
 * on a 1.x host as a one-time carry-over for packages written before the
 * freeze — there is no 0.x/1.0 incompatibility to protect against, since 1.0
 * only removed things that never worked.
 *
 * Until this existed the host compared nothing at all: a manifest could
 * declare any string, including a version from the future, and load.
 */
export function isApiVersionCompatible(declared: string, host: string = EXTENSION_API_VERSION): boolean {
  const parse = (value: string) => {
    const [major, minor] = value.trim().split(".");
    const majorNumber = Number(major);
    const minorNumber = minor === undefined ? 0 : Number(minor);
    return Number.isInteger(majorNumber) && majorNumber >= 0 && Number.isInteger(minorNumber) && minorNumber >= 0
      ? { major: majorNumber, minor: minorNumber }
      : null;
  };
  const wanted = parse(declared);
  const offered = parse(host);
  if (!wanted || !offered) return false;
  if (wanted.major === 0 && offered.major === 1) return true;
  return wanted.major === offered.major && wanted.minor <= offered.minor;
}

export class PluginManifestError extends Error {
  readonly manifestId?: string;

  constructor(message: string, manifestId?: string) {
    super(message);
    this.manifestId = manifestId;
    this.name = "PluginManifestError";
  }
}

/**
 * Marks a code-free package as a **theme pack**: styles only, chosen by the
 * user in the Themes screen and applied one at a time (never automatically on
 * install). Optional, so it needs no API version bump; a Core that predates it
 * treats the package as an ordinary stylesheet package.
 */
export interface ThemePackMeta {
  /** Shown in the Themes list. */
  name: string;
  /** The base the theme is drawn on; Core switches to it while the pack is active. */
  mode: "light" | "dark";
  description?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  description?: string;
  /**
   * Longer, human-readable usage notes shown in Settings → Plugins when this
   * plugin is selected, under "Instructions". Markdown (headings, lists, code
   * fences, links). For a walkthrough or a "how to get started"; the short
   * `description` is still what the list shows. Added in API 1.13. Capped at
   * 20 000 characters — anything longer belongs in your own docs, linked from
   * here.
   */
  guide?: string;
  /** Present on a theme pack: a package with styles and no code. See ThemePackMeta. */
  theme?: ThemePackMeta;
  /**
   * Who made this plugin — a name or handle, shown in Settings → Plugins under
   * "Author and signature" so an installed third-party plugin credits its
   * author next to its signed / unsigned state. Free text, keep it short.
   */
  author?: string;
  entry?: string;
  styles?: string[];
  /**
   * Translations shipped with the package, keyed by language tag: 
   * `{ "pl": "locales/pl.json" }`. Added in API 1.4.
   *
   * The file's strings land under **your plugin id**, whatever the file says
   * — a package cannot translate the application's own UI. A user-installed
   * locale file in `app_data/locales` overrides these, so the community can
   * add a language without touching your package.
   */
  locales?: Record<string, string>;
  dependencies?: Record<string, string>;
  minCoreVersion?: string;
  maxCoreVersion?: string | null;
  channel?: "stable" | "beta" | "nightly";
  permissions?: PluginPermission[];
  /**
   * API 1.28. The hosts this plugin talks to, e.g. `["openlibrary.org", "*.archive.org"]`
   * (`*.` = any subdomain, not the apex). Needs the `network` permission. Shown to the
   * user ("Talks to: …"). Enforced by Core for `media.importImageFromUrl`; for a plain
   * `fetch()` it is a disclosure only, because plugin code shares the app's realm.
   */
  networkHosts?: string[];
  sync?: "none" | "settings" | "data";
}

/**
 * Every value here has an API behind it. That is the rule for 1.0: the
 * install screen shows this list to the user, and advertising access that
 * nothing grants makes the screen a lie.
 *
 * Removed at 1.0 because they were declared with no API: `filesystem.read`,
 * `filesystem.write`, `files.private`, `files.granted`. A file API will
 * reintroduce named permissions when it exists — adding values later is a
 * minor bump and breaks nobody.
 */
/**
 * The single source of truth. The type below is derived from this array and
 * so is the runtime allowlist in `validatePluginManifest`.
 *
 * They used to be two hand-written lists. 1.2 added `data.sync` to the type,
 * the validator kept its own copy, and tsc saw nothing wrong — every package
 * declaring the new permission failed to install with "Unknown permission".
 * A type union cannot check a string at runtime; only one list can.
 */
export const PLUGIN_PERMISSIONS = [
  "data.read",
  "data.write",
  "relations.write",
  "workspace.ui",
  "editor.extension",
  "data.sync",
  "network",
  "notifications",
  "media.read",
  "media.write",
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

/**
 * Accepted for one more release so a package written before 1.0 still loads,
 * then rejected. They grant nothing and are not shown on the install screen.
 */
export const RETIRED_PERMISSIONS: readonly string[] = [
  "filesystem.read",
  "filesystem.write",
  "files.private",
  "files.granted",
];

export type PluginErrorPhase = "load" | "unload" | "command" | "scheduler";

export interface PluginRuntimeError {
  pluginId: string;
  version: string;
  phase: PluginErrorPhase;
  message: string;
  cause: unknown;
}

export interface Disposable {
  dispose(): void;
}

/**
 * Optional metadata that marks a command as an object-creator. When present,
 * Core's "+" menu renders a first-class creation button for this command
 * (alongside the native "New note"/"New folder" actions) instead of only
 * exposing it through the generic command palette. This is how a plugin
 * (e.g. Work Models) opts a command into the "+" menu without Core having to
 * know anything specific about that plugin or object type — see the
 * core-design rule that enabling a plugin should surface new first-class
 * creation actions, not just a palette entry.
 */
export interface CommandCreatesMeta {
  objectType: string;
  label: string;
  icon?: string;
  /** API 1.24: false keeps the command in the "+" menu only, out of "/". */
  slashMenu?: boolean;
}

/**
 * Optional metadata that puts a command into Core's right-click menu on a
 * workspace row, for commands that act on an *existing* object (`creates`
 * above is its twin, for commands that make a new one).
 *
 * `objectTypes` filters by `object.type`, so a plugin can offer "Export as
 * PDF" on a note and "Roll up progress" on a project without either showing
 * up on the other. Omit it to appear on every row. Core does not interpret
 * the strings — it compares them to the object's own type, so plugin object
 * types work exactly like Core's own ("note", "project", "folder", "space").
 *
 * The command's `execute` receives `{ objectId, objectType }`. Menu order is
 * registration order; Core owns the icon and the placement.
 */
export interface CommandObjectMenuMeta {
  label: string;
  objectTypes?: string[];
}

export interface CommandRegistration {
  id: string;
  name: string;
  description?: string;
  execute: (input?: unknown) => unknown | Promise<unknown>;
  creates?: CommandCreatesMeta;
  /**
   * API 1.24 (E14B-API, Hive #2): the command shows in the note's "/" menu and
   * inserts a ```` ```language ```` fenced block whose body is the string
   * `execute()` resolves to (called once, no input). `language` is a lowercase
   * id (`a-z`, `0-9`, `-`). Pair it with a code-block renderer for the language.
   */
  insertsBlock?: { language: string };
  objectMenu?: CommandObjectMenuMeta;
  /**
   * Default binding, e.g. `"Mod+Shift+K"` — `Mod` is Ctrl on Windows and Linux
   * and Cmd on macOS. Modifiers in any order; the key is matched
   * case-insensitively.
   *
   * Core dispatches it, and refuses a binding already claimed by another
   * plugin or by Core itself: first registration wins and later ones are
   * ignored rather than silently shadowing. Nothing fires while the user is
   * typing in a field or a note, unless `whileTyping` says so.
   */
  hotkey?: string;
  /**
   * Also fire while the user is typing in a field or a note. Added in API 1.23. Honoured only
   * for a binding with Ctrl/Cmd (`Mod`) or Alt, so a plugin can never take plain typing or
   * Shift+letter; on any other binding it is ignored.
   */
  whileTyping?: boolean;
}

/**
 * What the host hands a plugin when it mounts UI.
 *
 * The host owns the element and disposes the registration on unload. A plugin
 * renders into `container` with whatever it likes and depends on none of the
 * host's UI framework.
 */
export interface ViewMountContext {
  container: HTMLElement;
  /** The plugin's own context — data, storage, events, commands, ui. */
  plugin: PluginContext;
  /** Present when the surface was opened for a specific object. */
  objectId?: string;
  /** Present when the surface was opened inside a container object. */
  containerId?: string;
  theme: { mode: "paper" | "night"; token(name: string): string };
  openObject(id: string): Promise<void>;
  /** Tell the host this surface changed data it does not own. */
  notifyChanged(): void;
}

export type ViewMount = (context: ViewMountContext) => Disposable | void;

/**
 * `render` carries the host's own internal React descriptor. It is typed
 * `unknown` and is NOT part of what a third-party plugin may use — Core's
 * builtins are the only writers. It stays on the type because the host and
 * the builtins share these interfaces; a plugin that sets it gets nothing.
 */
interface InternalRenderSlot {
  render?: unknown;
}

export interface ViewRegistration extends InternalRenderSlot {
  id: string;
  title: string;
  /** The rendering contract. Give Core an element, render into it. */
  mount?: ViewMount;
  /**
   * Give this view its own card in the shell's primary navigation, next to
   * "Notes". Defaults to `false` — a registered view is still a real,
   * navigable section (reachable through `ui.openView`, or as the surface a
   * `registerObjectTab` mounts), it just does not headline the sidebar.
   *
   * Most registered views are a configuration screen for one object type
   * (Automations' rules, a project's calendar) or the target of an object
   * tab — putting a nav card next to Notes for each of those is how a
   * workspace with a dozen active domain plugins ends up with a dozen
   * identically-iconed rows above the note tree before the user has written
   * anything. Set this only for a view that is somewhere the user goes
   * directly and often, on its own — a whole workspace tool like Habits or
   * Graph, not a settings panel that happens to be built as a view.
   */
  nav?: boolean;
  /**
   * Which icon the nav card uses. One of a fixed set Core knows how to draw;
   * an unrecognized or missing value falls back to a generic puzzle-piece
   * icon — so a plugin built before this field existed keeps working
   * unchanged, and declaring it needs no API version bump.
   */
  navIcon?: "network" | "check-square" | "file-text";
}

/**
 * Object types Core mounts a container surface for. A tab registered for
 * anything else is reported and skipped.
 *
 * Note the difference from `objectMenu`, where Core does NOT interpret the
 * type strings: here it does, because mounting a surface is limited to this
 * set inside Core itself (CONTAINER_TYPES plus whiteboard and table). A
 * runtime list, not only a TS union — a union validates nothing at runtime.
 */
export const OBJECT_TAB_TYPES = ["space", "folder", "project", "whiteboard", "table"] as const;
export type ObjectTabType = (typeof OBJECT_TAB_TYPES)[number];

export interface ObjectTabContext {
  objectId: string;
  objectType: string;
}

/**
 * A tab on a container object's screen. Added in API 1.5. Requires
 * `workspace.ui`.
 *
 * There is no isolation here: `element` is an ordinary node in the same
 * document, so a plugin can read and change any part of the interface,
 * including Core's own tab strip. `objectId` is a navigation convenience, not
 * a scope limit — `data.read` opens the whole workspace regardless of which
 * object the tab is mounted on.
 */
export interface ObjectTabRegistration {
  id: string;
  /** Shown to the user. Translatable, so it is NOT the sort key. */
  label: string;
  /** One of the built-in container types, or a plugin's own namespaced
   * container type (`plugin.ns.type` with `behaviour.container` in its
   * schema). A bare unknown name is reported and skipped at registration. */
  objectTypes: Array<ObjectTabType | (string & {})>;
  /** 0-100, clamped. Builtin tabs always sort before plugin ones. */
  order?: number;
  mount(element: HTMLElement, context: ObjectTabContext): Disposable | void;
}

/**
 * What a code-block renderer is handed for one fenced block.
 *
 * `source` is the block's exact text. The fence stays visible and editable
 * above your output — this is a live editor, not a preview pane — and you draw
 * into a separate, non-editable element below it. Nothing you render can
 * corrupt what gets saved: the note still round-trips as plain Markdown even if
 * your renderer misbehaves or the plugin is uninstalled.
 */
export interface CodeBlockContext {
  /** Host-owned, `contenteditable="false"`. Render into it; do not detach it. */
  container: HTMLElement;
  /** Lower-cased info string, e.g. `mermaid` for ```` ```mermaid ````. */
  language: string;
  source: string;
  /** The note the block lives in, when the host knows it. */
  objectId?: string;
  plugin: PluginContext;
  theme: { mode: "paper" | "night"; token(name: string): string };
  /** API 1.24: true when the note cannot be edited; do not call `updateSource` then. */
  readOnly: boolean;
  /**
   * API 1.24 (E14B-API, Hive #2): replace this block's source in the note. It is
   * one step on the note's undo stack and is saved with the note. Returns false
   * (and changes nothing) when the block is no longer in the note. Pair it with
   * `persistent: true`, or the write remounts your renderer.
   */
  updateSource(next: string): boolean;
}

export type CodeBlockRenderer = (context: CodeBlockContext) => Disposable | void;

/** Added in API 1.20. `toSvg` lets other plugins print your drawing via
 *  `editor.renderCodeBlockSvg`: return the finished SVG markup for `source`. */
export interface CodeBlockRendererOptions {
  toSvg?: (source: string, mode: "paper" | "night") => Promise<string>;
  /**
   * API 1.24 (E14B-API, Hive #2): keep the mount alive across redraws while the
   * block's source is unchanged (an interactive widget that must keep focus).
   * Default renderers are still disposed and called again on every redraw.
   * A persistent renderer shares the document with the note: it must ignore
   * document/window events whose target is outside its container.
   */
  persistent?: boolean;
}

/**
 * **Lifecycle (API 1.3).** Your renderer is not called once per block. The host
 * disposes every mounted renderer and calls all of them again whenever it
 * redraws the note — on open, and, since 1.3, a short time after workspace data
 * changes anywhere, so a renderer that shows live data can follow it.
 *
 * Two obligations follow, and a renderer doing async work must honour both:
 *
 * - **Be idempotent.** Draw from the `container` you were handed this time.
 * - **Stop after `dispose()`.** Anything you `await` can finish after your
 *   container is gone, and writing into it then is at best invisible and at
 *   worst draws your output twice, next to the new mount's.
 */

/**
 * The editor surface a plugin may extend.
 *
 * Deliberately narrow. Core's editor is `CoreMarkdownEditor` — a contenteditable
 * over plain Markdown text, not a ProseMirror document — so there is no node
 * schema, transaction or plugin pipeline to expose, and pretending otherwise
 * would be a contract Core cannot honour. Rendering a fenced block is the piece
 * that is both genuinely useful and expressible against what Core actually is.
 */

export interface ProseMatch {
  /** Namespaced type names this plugin owns. */
  types?: string[];
  /** OR a prop predicate: a note matches when `props[key] === value`.
   *  `key` MUST be prefixed with the calling plugin's id. */
  propEquals?: { key: string; value: string };
}

export interface ProseProfile {
  /** Default true. false = a leading "- " / "1. " is NOT auto-converted to
   *  a list, so dialogue dashes survive. */
  dashList?: boolean;
  /** Core reads `props[fontProp]`, maps it through `fontMap`, and sets
   *  `--nb-editor-font` on the editor for that note. A value absent from
   *  the map falls back to the theme font. */
  fontProp?: string;
  fontMap?: Record<string, string>;
  /** Long-form writing mode (part of the 1.12 prose profile — an optional
   *  field, so it needs no version bump). Core narrows the editor to a prose
   *  measure, keeps the caret line vertically centred as you type, and dims
   *  every paragraph except the one being written. The reader can switch it
   *  off from the editor toolbar; this only sets the default. */
  focusMode?: boolean;
  /** Draw a faint, dashed, unnumbered rule after every ~3300 characters of text,
   *  about one printed A4 page of body text, at the text line where that page
   *  would end. Counting characters (not pixels) keeps it right when paragraph
   *  spacing or the font change, but it is an estimate, not a print layout.
   *  Optional, so it needs no version bump. */
  pageBreaks?: boolean;
}

export interface EditorApi {
  /**
   * Draw fenced blocks tagged with `language`. Requires `editor.extension`.
   *
   * One renderer per language; a second registration for a language already
   * taken is refused, on the same first-wins rule as hotkeys. Matching is
   * case-insensitive.
   */
  registerCodeBlockRenderer(language: string, render: CodeBlockRenderer, options?: CodeBlockRendererOptions): Disposable;
  /**
   * Added in API 1.20. No permission needed. The same drawing a note shows for
   * a fenced block, as standalone SVG markup — for output outside the editor
   * (a printed report, an export). Resolves `null` when no enabled plugin draws
   * `language` as SVG (see `CodeBlockRendererOptions.toSvg`); rejects when the
   * source cannot be drawn (a diagram syntax error). `mode` defaults to `paper`.
   */
  renderCodeBlockSvg(language: string, source: string, options?: { mode?: "paper" | "night" }): Promise<string | null>;
  /**
   * Added in API 1.12. Requires the `editor.extension` permission. First
   * registration wins per matched type and per prop key (same first-wins
   * rule as code-block languages). A `types` entry must be a type this
   * plugin owns; a built-in type name or a non-namespaced `propEquals.key`
   * is refused. Does not change the Markdown dialect — `dashList` is a
   * typing guard, the font is a CSS variable.
   */
  registerProseProfile(match: ProseMatch, profile: ProseProfile): Disposable;
}

/** A single control on a declaratively described settings panel. */
export type SettingsField =
  | { kind: "text"; key: string; label: string; description?: string; default?: string; placeholder?: string }
  | { kind: "number"; key: string; label: string; description?: string; default?: number; min?: number; max?: number; step?: number }
  | { kind: "toggle"; key: string; label: string; description?: string; default?: boolean }
  | { kind: "select"; key: string; label: string; description?: string; default?: string; options: Array<{ value: string; label: string }> }
  | { kind: "folder"; key: string; label: string; description?: string }
  | { kind: "hotkey"; key: string; label: string; description?: string; commandId: string };

export interface SettingsSchema {
  sections: Array<{ title?: string; description?: string; fields: SettingsField[] }>;
}

export interface SettingsRegistration extends InternalRenderSlot {
  id: string;
  title: string;
  /**
   * Declare the panel and Core renders it natively, so every plugin's
   * settings look like the rest of the app. Values are read from and written
   * to the plugin's own storage under `key`.
   */
  schema?: SettingsSchema;
  /** Escape hatch for genuinely custom panels. */
  mount?: ViewMount;
}

export interface SlotRegistration extends InternalRenderSlot {
  id: string;
  mount?: ViewMount;
}

export interface MenuItem {
  id: string;
  label: string;
  /** Rendered in a disabled, non-interactive state. */
  disabled?: boolean;
  /** Draws a divider above this item. */
  separatorBefore?: boolean;
  onSelect(): void | Promise<void>;
}

/**
 * Overlays are Core-owned. A plugin supplies content; Core owns the element,
 * escape handling, the attribution line naming your plugin, which overlay is on
 * top, and the focus trap: while a modal, menu or suggest is open, Tab stays
 * inside it and focus returns to where it was when it closes.
 *
 * This exists as much for safety as for convenience: without it, a plugin
 * that needs a dialog has no option but to paint its own overlay on
 * `document.body`, which is precisely what the trust-decision surfaces must
 * never be confused with.
 */
/** An option in a themed `<Select>` / `mountSelect`. Plain data. */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Options for `UiApi.mountSelect` (API 1.11). */
export interface SelectMountOptions {
  value: string;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  onChange(value: string): void;
}

/** Options for `UiApi.mountDatePicker` (API 1.11). Value is ISO `yyyy-mm-dd`
 *  (optionally `+THH:mm` when `time`). */
export interface DatePickerMountOptions {
  value: string;
  time?: boolean;
  min?: string;
  max?: string;
  disabled?: boolean;
  ariaLabel?: string;
  onChange(value: string): void;
}

export interface UiApi {
  /**
   * A notice shows for `timeoutMs` (default 4000). `action` adds one button
   * (label capped at 40 characters); clicking it closes the notice and calls
   * `onSelect`, which counts as a user gesture in your plugin. API 1.25; older
   * Cores ignore it and show the text alone.
   */
  notice(message: string, options?: { timeoutMs?: number; action?: { label: string; onSelect(): void | Promise<void> } }): Disposable;
  modal(options: { title: string; mount: ViewMount }): Disposable;
  menu(items: MenuItem[], at: { x: number; y: number }): Disposable;
  /**
   * Render a themed `<Select>` / date picker into a plugin-owned element and
   * return a `Disposable` that removes it. Added in API 1.11.
   *
   * No permission required: this grants no capability a plugin does not
   * already have — Notible does not sandbox plugin code, so a plugin can
   * already draw any control it likes. These exist only so a plugin's inputs
   * match the host's look and follow the active theme, not as a boundary.
   *
   * `onChange` receives the selected value / ISO date string — never a DOM
   * or synthetic event.
   */
  mountSelect(el: HTMLElement, options: SelectMountOptions): Disposable;
  mountDatePicker(el: HTMLElement, options: DatePickerMountOptions): Disposable;
  /**
   * Write text to the workspace exports folder and return the absolute path.
   * Added in API 1.15. Requires `workspace.ui` like the other overlays. Core
   * sanitises `filename` (path separators stripped); a name that sanitises to
   * empty rejects. The file lands in `<app data>/exports/` — a fixed location
   * the user can already reach. Chunk large content in the caller.
   */
  exportFile(filename: string, content: string): Promise<string>;
  /**
   * Write binary data (base64) to the workspace exports folder and return the
   * absolute path. Added in API 1.16 — like `exportFile` but for bytes (a
   * generated spreadsheet, a rendered image). Requires `workspace.ui`. Core
   * sanitises `filename`; a name that sanitises to empty rejects. 50 MB cap.
   * `mime` is advisory.
   */
  exportBinary(filename: string, dataBase64: string, mime: string): Promise<string>;
  /**
   * Write binary data (base64) to a location the USER picks via the native
   * "Save As" dialog — unlike `exportBinary`, not a fixed folder. Added in
   * API 1.19, after `exportBinary`'s fixed `exports/` folder turned out to
   * be a real point of confusion (a saved file with no visible confirmation
   * of *where* reads as "nothing happened"). Requires `workspace.ui`.
   * `filename` is only the suggested/default name — the dialog is the
   * source of truth for both name and folder. Resolves to the chosen path,
   * or `null` if the user cancels the dialog (not an error).
   */
  exportBinaryAs(filename: string, dataBase64: string, mime: string): Promise<string | null>;
  suggest<T>(items: T[], render: (item: T) => string, options?: { placeholder?: string }): Promise<T | null>;
  /**
   * Bring the workspace to an object — the same navigation the sidebar does.
   * Added in API 1.1: before it, only a mounted view could navigate, so a
   * command bound to a hotkey could create today's note but not open it.
   * Resolves once the object is showing; a missing id is a no-op.
   */
  openObject(id: string): Promise<void>;
  /**
   * Bring the shell to one of *this plugin's* registered views — the same
   * screen the user reaches by clicking its nav entry. Added in API 1.8.
   *
   * It lives on `ui` rather than on `views` on purpose: `views.*` is
   * registration, while `ui.*` is "change what the user is looking at",
   * which is where `openObject` already lives.
   *
   * The view id is resolved against the calling plugin's own registrations.
   * A plugin cannot open another plugin's view, and there is no argument for
   * naming one — the caller's id comes from the host, never from the call.
   * That is deliberate, not an oversight: a surface the user opened is a
   * surface the user chose to trust, and a plugin that could push a stranger's
   * screen in front of them would be forging exactly that choice.
   *
   * Resolves `true` when the shell navigated and `false` when this host has
   * nowhere to render views at all. The two are different problems and only
   * the second is worth a fallback, so write it as:
   *
   * ```ts
   * if (!(await context.ui.openView("surface"))) openMyModal();
   * ```
   *
   * A view id this plugin never registered **throws** instead of resolving
   * `false`. A typo is a programming error, not an environment difference,
   * and collapsing the two would leave an author staring at a working
   * fallback wondering why the nav card is never used. Requires
   * `workspace.ui`, like every other visible action; it grants no read the
   * plugin did not already have, since it shows the plugin's own surface.
   */
  openView(viewId: string): Promise<boolean>;
  /**
   * Added in API 1.18. A themed "are you sure" dialog, resolving `true` on
   * confirm and `false` on cancel, Escape or dismissing the backdrop —
   * mirrors `suggest`'s resolve-on-dismiss behaviour, never hangs the
   * caller. Requires `workspace.ui`, like every other overlay: it puts
   * pixels on the screen and blocks input to the rest of the app while
   * open.
   *
   * Before this there was no confirm primitive anywhere in the public API,
   * so a destructive plugin action either had no "are you sure" step or
   * painted its own ad-hoc one straight onto `document.body` — exactly the
   * kind of unmediated overlay the rest of this API exists to avoid (see the
   * note on `UiApi` above `SelectOption`).
   *
   * `message` and `options.title`/`options.confirmLabel` are rendered as
   * text, never parsed as markup, same as every other plugin-supplied string
   * on an overlay. `options.danger` styles the confirm button as a
   * destructive action; it changes no behaviour.
   */
  confirm(message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
  /**
   * Added in API 1.22. Open Core's Help at a page and, optionally, a heading
   * (`HelpTopic.helpPageId` / `HelpTopicSection.slug`). An unknown id opens
   * Help's first page. Requires `workspace.ui`, and only works right after
   * the user clicked or pressed a key inside this plugin's own UI, or ran one
   * of its commands (within a second); otherwise, or more than once a second,
   * it rejects. It changes nothing, it only navigates.
   */
  openHelp(pageId?: string, slug?: string): Promise<void>;
  /** API 1.26. Open Core conflict recovery. Navigation only; workspace.ui + user gesture. */
  openSyncConflicts(copyId?: string): Promise<void>;
  /**
   * Added in API 1.22. Open Settings → Plugins with that plugin selected, so
   * the user can turn it on themselves. Same gate as `openHelp`. It never
   * enables, installs or changes anything: the switch stays the user's.
   */
  openPluginSettings(pluginId: string): Promise<void>;
  /**
   * Added in API 1.22. Markdown (a Help section, a guide) to HTML that is safe
   * to assign to `innerHTML`: raw HTML in the input is escaped, links are
   * inert (`data-url`, no `href`), and images are dropped. No permission: it
   * only formats text.
   */
  renderMarkdown(markdown: string): string;
}

export interface PluginObject {
  id: string;
  type: string;
  title: string;
  content: string;
  props: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  trashed_at: number | null;
  parent_id?: string | null;
}

export interface PluginObjectInput {
  type: string;
  title: string;
  content?: string;
  props?: string;
  parentId?: string;
}

export interface PluginObjectPatch {
  title?: string;
  content?: string;
  props?: string;
}

export interface PluginObjectQuery {
  parentId?: string;
  type?: string;
  tag?: string;
  includeArchived?: boolean;
  limit?: number;
}

export interface PluginRelation {
  from_id: string;
  to_id: string;
  kind: string;
}

export interface PluginType {
  name: string;
  schema: string;
  icon: string | null;
  color: string | null;
}

export interface PluginDataSource {
  id: string;
  name: string;
  definition: string;
  created_at: number;
  updated_at: number;
}

/** Something found inside a note's body by Core's content index. */
export interface ContentIndexEntry {
  object_id: string;
  kind: "heading" | "tag" | "link" | "task";
  value: string;
  /** Heading depth 1-6; null for other kinds. */
  level: number | null;
  /** Whether a task is ticked; null for other kinds. */
  checked: boolean | null;
  /** Zero-based line the entry was found on. */
  line: number;
}

export interface ContentIndexQuery {
  kind?: ContentIndexEntry["kind"];
  /** Exact, case-insensitive match on the entry value. */
  value?: string;
  objectId?: string;
  limit?: number;
}

/**
 * Read-only view of what is written *inside* notes — headings, tags, wiki
 * links and task items. This is the substrate for query-style plugins.
 *
 * It is a structured filter, deliberately not a query language: nothing a
 * plugin passes reaches SQL.
 */
export interface ContentIndexApi {
  query(query?: ContentIndexQuery): Promise<ContentIndexEntry[]>;
  forObject(objectId: string): Promise<ContentIndexEntry[]>;
}

/** One block of a note body, in document order. */
export interface DocumentBlock {
  kind: "paragraph" | "heading" | "code" | "quote" | "list" | "task" | "image" | "divider";
  /** Plain text with the Markdown marker stripped. */
  text: string;
  /** Heading depth 1-6; null otherwise. */
  level: number | null;
  /** Fence info string, e.g. `rust`; null otherwise. */
  language: string | null;
  /** Whether a task is ticked; null otherwise. */
  checked: boolean | null;
  /** Zero-based block index, matching `line` on ContentIndexEntry. */
  line: number;
}

/**
 * D13 — an ordered, read-only projection of a note's body.
 *
 * Where `index` answers "where does this tag appear across the workspace",
 * this answers "what is in this note, in order" — the shape an outline,
 * table-of-contents or export plugin needs.
 *
 * Read-only on purpose. Writing back would need a faithful inverse, and Core's
 * stored-document conversion is explicitly lossy in that direction; a write API
 * built on it would silently rewrite notes. Change a note through
 * `objects.update` with Markdown text instead.
 *
 * Computed on demand from the stored body, so it cannot go stale.
 */
export interface DocumentApi {
  get(objectId: string): Promise<DocumentBlock[]>;
}

/**
 * Behaviour flags for a plugin-declared type. Placed inside the `schema`
 * JSON string passed to `types.upsert`, under a `"behaviour"` key:
 *
 *   types.upsert("acme.card", JSON.stringify({
 *     fields: { … },
 *     behaviour: { container: true },
 *   }))
 *
 * The host injects the calling plugin's id and the Rust command REJECTS a
 * behaviour-carrying schema whose type name is not prefixed
 * `<pluginId>.`. This is anti-collision, not a security boundary — plugin
 * code runs in the same realm as Core and can call the raw Tauri command.
 */
export interface TypeBehaviour {
  /** The sidebar tree descends into records of this type (expand affordance,
   *  "Add inside", valid Move-to target). */
  container?: boolean;
  /** Records of this type are not shown as sidebar tree rows. They REMAIN
   *  linkable (`[[title]]`), searchable and backlink-resolvable — this
   *  affects the tree only. */
  treeHidden?: boolean;
}

export interface DataApi {
  objects: {
    get(id: string): Promise<PluginObject | null>;
    create(input: PluginObjectInput): Promise<PluginObject>;
    update(id: string, patch: PluginObjectPatch, expectedUpdatedAt?: number): Promise<PluginObject>;
    /** Added in API 1.17. Change an object's `type` in place — title, content,
     *  props and relations are kept. `data.write`. */
    setType(id: string, newType: string, expectedUpdatedAt?: number): Promise<PluginObject>;
    move(id: string, parentId: string | null): Promise<PluginObject>;
    trash(id: string): Promise<PluginObject | null>;
    query(query?: PluginObjectQuery): Promise<PluginObject[]>;
    /**
     * Added in API 1.18. Subscribe to changes on one object — title, content
     * or props — fired regardless of who wrote it: the user editing in
     * Core's own editor, a sync pull, or another plugin's `objects.update`.
     * Requires `data.read`, the same permission `objects.get` needs; this
     * reaches nothing `get` does not already expose, just when it changes.
     *
     * For a surface showing one object (e.g. a title used to build an export
     * filename) that must react to a rename that happened elsewhere, without
     * itself being closed and reopened. Call `dispose()` on the returned
     * value when the surface unmounts — the subscription otherwise outlives
     * it and leaks.
     */
    onChange(id: string, callback: (object: PluginObject) => void): Disposable;
    /**
     * Added in API 1.18. Indexed title lookup, `exact` for an
     * case-insensitive equality match and unset/`false` for a substring
     * match, both against Core's own title index — the same one the editor's
     * `[[...]]` link autocomplete resolves against. Requires `data.read`.
     *
     * Exists so a plugin resolving `[[Title]]`-style references does not have
     * to pull the whole workspace through `objects.query({ limit: 5000 })`
     * and filter client-side, a pattern that is both slow and silently wrong
     * past the 5000-row cap.
     */
    findByTitle(query: string, options?: { exact?: boolean }): Promise<PluginObject[]>;
  };
  relations: {
    list(objectId: string): Promise<PluginRelation[]>;
    /** Added in API 1.12. One round trip for many objects — every relation
     *  with `from_id` or `to_id` in `ids`, grouped by the id it matched.
     *  Read-only, `data.read`. */
    listForObjects(ids: string[]): Promise<Record<string, PluginRelation[]>>;
    create(fromId: string, toId: string, kind: string): Promise<PluginRelation>;
    delete(fromId: string, toId: string, kind: string): Promise<boolean>;
  };
  types: {
    list(): Promise<PluginType[]>;
    /** `pluginId` is injected by the host's scoped wrapper so the Rust
     *  validator can namespace-gate behaviour flags; a plugin never passes
     *  it. Added in API 1.12. */
    upsert(name: string, schema: string, icon?: string, color?: string, pluginId?: string): Promise<PluginType>;
  };
  /** Requires `data.read`. */
  index: ContentIndexApi;
  /** Requires `data.read`. */
  document: DocumentApi;
  /** Requires `media.read`. Added in API 1.14. */
  media: MediaApi;
  dataSources: {
    list(): Promise<PluginDataSource[]>;
    upsert(name: string, definition: string, id?: string): Promise<PluginDataSource>;
    delete(id: string): Promise<boolean>;
  };
  /** Requires `data.sync`. Added in API 1.2. */
  sync: SyncApi;
}

/**
 * The bytes behind a `media/<uuid-v4>.<ext>` reference in note content —
 * added in API 1.14, for a plugin that needs to embed a pasted image in
 * something it renders (a report, an export).
 *
 * This is a thin wrapper over the same primitive `data.sync.media.read`
 * uses, so a plugin no longer has to declare the heavyweight `data.sync`
 * permission just to read one image. It reaches no bytes that primitive does
 * not, through the same user gate: reading pasted images is off until the
 * user turns on "Let plugins read images pasted into your notes" in
 * Settings → Files & links — for every plugin at once, because this runtime
 * cannot tell plugins apart. Expect `read` to reject and say why.
 *
 * SVG is refused here even though the underlying store accepts it: it is the
 * one image type that can carry script, and the point of this call is to
 * turn the bytes into an `<img>`/`data:` URI.
 */
export interface MediaApi {
  /**
   * One referenced image's bytes, base64. `ref` must be exactly
   * `media/<uuid-v4>.<ext>` with `<ext>` one of png|jpg|jpeg|gif|webp|bmp.
   * Rejects on a malformed ref, an SVG, a missing file, a file over 20 MB,
   * or the user not having enabled image reading.
   */
  read(ref: string): Promise<string>;
  /** Open Notible's native image picker. Requires `media.write`. Added in API 1.27. */
  pickImage(): Promise<string | null>;
  /**
   * Download one https image into managed media and return its `media/<uuid>.<ext>` ref,
   * which `read` returns to this plugin and sync/GC treat like a pasted image. Requires
   * `media.write` and `network`, and the URL's host (and every redirect hop, max 3) must
   * match the manifest's `networkHosts`. Core checks all of it in Rust: https only, public
   * IP addresses only, 15 s, 20 MB, PNG/JPEG/WebP/GIF by content. Added in API 1.28.
   */
  importImageFromUrl(url: string): Promise<string>;
}

/**
 * The workspace change journal, added in API 1.2.
 *
 * This is deliberately a different door from `objects.query`, which is built
 * for reading a slice of the workspace and is wrong for replication in four
 * ways: it caps at 5000 rows with no offset, hides archived and trashed
 * objects, strips `props.$._projectCalendarEvents`, and exposes only the
 * first `in` relation. A replicator that reads through it infers deletions
 * from absence and eventually trashes live notes on the other device.
 *
 * `export` reads the journal Core already maintains on every write: real
 * tombstones, every relation kind, a stable device id, and untouched props.
 * `apply` writes objects back under their own ids and timestamps, which the
 * `objects.*` API deliberately does not allow.
 *
 * Object ids are workspace-global UUIDs, so a plugin needs no identity
 * mapping of its own. Two same-titled projects created independently on two
 * devices are two different ids and stay two objects — merging them is a
 * product decision, not something replication should do behind the user's
 * back.
 */
export interface SyncApi {
  export(): Promise<SyncSnapshot>;
  apply(request: SyncApplyRequest): Promise<SyncApplyResult>;
  markOutboxAttempts(operationIds: string[]): Promise<void>;
  /** Pasted images, added in API 1.6. See `SyncMediaApi`. */
  media: SyncMediaApi;
  /** Agent sandboxes only (Hive #9): a local folder two sandboxes share in
   *  place of a cloud drive, so sync can be tested end to end. Absent or
   *  refusing everywhere else; a real build has no code behind it. */
  sandboxFolder?: SandboxSyncFolderApi;
}

/** Flat file names only (`[A-Za-z0-9][A-Za-z0-9._-]*`, max 160). Bytes are base64. */
export interface SandboxSyncFolderApi {
  available(): Promise<boolean>;
  /** `modified` is a revision: it changes exactly when the content does. */
  list(): Promise<{ name: string; modified: string }[]>;
  read(name: string): Promise<string>;
  /** True when written. With `ifAbsent`, an existing file is kept and false
   *  comes back (atomic, so two creators agree on one winner). */
  write(name: string, dataBase64: string, options?: { ifAbsent?: boolean }): Promise<boolean>;
  remove(name: string): Promise<void>;
}

/**
 * The bytes behind a `media/<uuid>.<ext>` reference in note content, so a
 * replication plugin can carry a pasted screenshot to the other machine.
 *
 * `read` is the one call here that hands out data the workspace does not
 * otherwise expose, and the user has to switch it on in Settings → Plugins
 * → Enabled first — for every plugin at once, because this runtime cannot tell
 * plugins apart. Expect it to fail, and say why when it does.
 *
 * `write` never overwrites: the filename is a v4 UUID, so a name that
 * already exists is already this file.
 */
export interface SyncMediaApi {
  /** Which of these filenames this machine does not have. */
  missing(filenames: string[]): Promise<string[]>;
  /** One file's bytes, base64. Rejects when the user has not allowed it. */
  read(filename: string): Promise<string>;
  /** Store one file that arrived from another machine. */
  write(filename: string, dataBase64: string): Promise<void>;
}

export interface SyncTombstone {
  object_id: string;
  deleted_at: number;
}

export interface SyncRelation {
  from_id: string;
  to_id: string;
  kind: string;
  created_at: number;
}

export interface SyncRelationTombstone {
  from_id: string;
  to_id: string;
  kind: string;
  deleted_at: number;
}

export interface SyncOutboxEntry {
  operation_id: string;
  event: string;
  object_id: string | null;
  object_type: string;
  occurred_at: number;
  /** JSON string. Opaque: a newer client may add operation kinds. */
  payload: string;
  attempts: number;
  state: string;
}

/** API 1.26. Optional durable recovery pairing, never inferred from a title. */
export interface SyncConflictDescriptor {
  originalId: string;
  copyId: string;
  fields: ("content" | "title" | "props" | "parent_id" | "type" | "archived_at" | "trashed_at")[];
}

export interface SyncSnapshot {
  conflicts?: SyncConflictDescriptor[];
  /** Stable for this workspace on this machine. Generated on first export. */
  deviceId: string;
  /** Where this export sits in local history; pass it back to `apply`. */
  cursor: number;
  objects: PluginObject[];
  relations: SyncRelation[];
  tombstones: SyncTombstone[];
  relationTombstones: SyncRelationTombstone[];
  outbox: SyncOutboxEntry[];
}

export interface SyncApplyRequest {
  /** API 1.26. Accepted only alongside an included, non-stale copy. Invalid descriptors are ignored. */
  conflicts?: SyncConflictDescriptor[];
  /** The `cursor` of the export this request was planned from. Core refuses
   *  `expected` ids moved, trashed, restored or archived after it. */
  cursor: number;
  objects: PluginObject[];
  relations: SyncRelation[];
  tombstones: SyncTombstone[];
  relation_tombstones: SyncRelationTombstone[];
  acknowledged_operations?: string[];
  /**
   * Object id -> the local `updated_at` you planned against (null: it did not
   * exist). Core refuses a row that changed since (the user saved meanwhile,
   * or moved, trashed, restored or archived it after the export `cursor`),
   * applying nothing about it (row, tombstone, relations). Sending it, even
   * `{}`, checks the cursor against every id the request touches, tombstones
   * and relation `from_id`s included; without it nothing is checked. Core
   * lists refused ids in `staleObjects`, and places rows it took under their
   * `parent_id`. An older Core ignores it (no `staleObjects`).
   */
  expected?: Record<string, number | null>;
}

export interface SyncApplyResult {
  appliedObjects: number;
  addedRelations: number;
  deletedRelations: number;
  deletedObjects: number;
  acknowledgedOperations: number;
  cursor: number;
  /** Ids refused because they changed after the `expected` plan; retry them. */
  staleObjects?: string[];
}

export interface PluginStorage {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
  keys(): string[];
}

/** API 1.25. Plugin-scoped key -> text store for data too big for storage. Holds data derived from this workspace database: restoring a backup empties it. Not isolated from other plugins (same JS realm). */
export interface PluginStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Keys starting with `prefix` (all keys when omitted), sorted. */
  keys(prefix?: string): Promise<string[]>;
  /** Deletes every key starting with `prefix` (non-empty); returns how many. */
  deletePrefix(prefix: string): Promise<number>;
  getMany(keys: string[]): Promise<(string | null)[]>;
  /** One transaction; a batch over a cap rejects as a whole. */
  setMany(entries: [string, string][]): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
}

export interface PluginEvents {
  on<T>(event: string, handler: (payload: T) => void): Disposable;
  emit<T>(event: string, payload: T): void;
}

/**
 * Runs work on a schedule for as long as the plugin stays enabled — not just
 * while one of its views happens to be open. Every subscription is disposed
 * automatically when the plugin unloads, the same as `events.on`.
 *
 * There is deliberately no `at(date, task)` or cron-string form: a plugin
 * that wants "every day at 9am" checks its own condition inside `every`'s
 * task (Core's own Automations plugin does exactly this for a `recurring`
 * rule) rather than Core parsing schedule expressions on a third party's
 * behalf.
 */
export interface PluginScheduler {
  /**
   * Runs `task` on a fixed interval. `intervalMs` is clamped to a minimum of
   * one minute — a plugin has no legitimate reason to poll faster than that,
   * and nothing stops a runaway interval from being set by accident rather
   * than by design. `task` rejecting (or throwing) is reported as a plugin
   * runtime error rather than raised as an unhandled rejection; it does not
   * stop future runs.
   */
  every(intervalMs: number, task: () => void | Promise<void>): Disposable;
}

/**
 * Events Core emits. These are notifications, not hooks: a handler cannot
 * cancel or alter what happened, so plugin ordering never becomes
 * load-bearing. A plugin may emit its own events under its own namespace.
 */
export interface CoreEvents {
  "object.created": { id: string; type: string };
  "object.updated": { id: string; type: string };
  "object.trashed": { id: string; type: string };
  /** `view` (Core 0.90.1+): "editor" when the note editor shows the object, "tab" when a plugin's object tab does. */
  "object.opened": { id: string; type: string; view?: "editor" | "tab" };
  "relation.created": { fromId: string; toId: string; kind: string };
  "relation.deleted": { fromId: string; toId: string; kind: string };
  "workspace.changed": Record<string, never>;
  "theme.changed": { mode: "paper" | "night" };
  "app.ready": Record<string, never>;
}

export const CORE_EVENTS = [
  "object.created",
  "object.updated",
  "object.trashed",
  "object.opened",
  "relation.created",
  "relation.deleted",
  "workspace.changed",
  "theme.changed",
  "app.ready",
] as const satisfies readonly (keyof CoreEvents)[];

/**
 * Translation for plugin UI, added in API 1.4.
 *
 * Resolution order is your own plugin id, then the shared `app` namespace, then
 * the key itself. `app` is Core and every builtin — one product, released
 * together — so a common word like "Cancel" is translated once for the whole
 * application rather than once per plugin.
 *
 * The key **is** the English sentence, and it must be a whole sentence with
 * `{placeholders}`, never a fragment glued to a number: fragment order is
 * fixed by your markup, so no translation can repair the grammar around it.
 * Pass a `count` value and the right plural form is chosen for the language.
 *
 * **What `t` returns is untrusted text.** A translation is a file a stranger
 * wrote. Set it with `textContent`; never build markup out of it.
 */
/**
 * One piece of help the user's current build actually has. Added in API 1.22.
 *
 * Built by Core from its own Help pages and from every plugin it knows about
 * (built-in or installed), so a helper can answer only what this build can
 * do. A disabled plugin's topic keeps its `summary` (what it would do) but
 * has no `sections`: the helper can say "turn it on", not teach a feature
 * the user cannot use.
 */
export interface HelpTopic {
  /** `core:<help page id>` or `plugin:<plugin id>`. Unique. */
  id: string;
  title: string;
  source: "core" | "plugin";
  /** The plugin this topic belongs to. Absent for Core pages about Core. */
  pluginId?: string;
  /** "failed" = enabled but its onload threw. */
  state: "enabled" | "disabled" | "failed";
  /** First paragraph of the page, or the plugin's manifest description. */
  summary: string;
  keywords: string;
  /** The full text, split at headings. Empty unless `state` is "enabled". */
  sections: HelpTopicSection[];
  /** Core Help page id to pass to `ui.openHelp`. Absent for plugin guides. */
  helpPageId?: string;
}

export interface HelpTopicSection {
  heading: string;
  /** Pass to `ui.openHelp(helpPageId, slug)` to open at this heading. */
  slug: string;
  /** Markdown. Render it with `ui.renderMarkdown`, never as raw HTML. */
  text: string;
}

/**
 * Read-only knowledge about Help and plugins. Added in API 1.22. Needs no
 * permission: it exposes public text (Help pages, manifest descriptions and
 * guides) and which plugins are on, and never install paths, versions or
 * settings.
 */
export interface HelpApi {
  /** A snapshot; the same array until something changes. Do not mutate it. */
  topics(): HelpTopic[];
  /** A plugin was turned on or off, installed or removed. Disposed with the plugin. */
  onChange(listener: () => void): Disposable;
}

export interface PluginI18n {
  t(key: string, values?: Record<string, string | number>): string;
  /** BCP-47 tag for `Intl` formatting — dates are part of a language too. */
  readonly locale: string;
}

export interface PluginPermissions {
  has(permission: PluginPermission): boolean;
  require(permission: PluginPermission): void;
}

/**
 * Sign in to a third-party account through the system browser. Added in 1.7.
 *
 * The plugin names a `provider`; Core owns the OAuth client and the scopes it
 * asks for. A plugin cannot widen them, cannot substitute its own client, and
 * cannot reach a provider Core does not list — otherwise any plugin could put
 * a genuine Google consent screen in front of the user asking for anything.
 *
 * Known providers:
 * - `"google.drive.file"` — files this application created on the user's
 *   Google Drive. Not the rest of the Drive, and no other Google product.
 *
 * The refresh token is handed back to the plugin, which stores it. Treat it
 * as a credential: `context.storage` is readable by every other installed
 * plugin, so call `revoke` when the user signs out rather than only
 * forgetting it.
 */
export interface OauthApi {
  readonly google: {
    signIn(provider: string): Promise<{ refreshToken?: string; accessToken: string; expiresIn: number; idToken?: string }>;
    accessToken(provider: string, refreshToken: string): Promise<{ accessToken: string; expiresIn: number }>;
    revoke(refreshToken: string): Promise<void>;
  };
}

/**
 * A native OS notification, shown even while the app window is unfocused or
 * minimized — the piece Habits' reminders and Automations' recurring rules
 * were both missing before 1.10. Requires `notifications`.
 *
 * There is no "click to open" callback: the notification is fire-and-forget,
 * the same boundary `context.editor` draws around code-block rendering — the
 * OS notification centre is not part of this application's own UI, so it
 * cannot hand back an event.
 */
export interface PluginNotifications {
  /** Resolves once the OS has been asked to show it — not once the user has
   * seen it, which no platform reports back. */
  show(options: { title: string; body?: string }): Promise<void>;
}

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly permissions: PluginPermissions;
  readonly data: DataApi;
  /** Added in API 1.7. Requires `network`. */
  readonly oauth: OauthApi;
  readonly commands: {
    register(command: CommandRegistration): Disposable;
  };
  readonly views: {
    register(view: ViewRegistration): Disposable;
    /** Added in API 1.5. Requires `workspace.ui`. */
    registerObjectTab(tab: ObjectTabRegistration): Disposable;
  };
  readonly settings: {
    register(section: SettingsRegistration): Disposable;
  };
  readonly ui: {
    registerSlot(slot: string, registration: SlotRegistration): Disposable;
  } & UiApi;
  readonly editor: EditorApi;
  readonly events: PluginEvents;
  /** Added in API 1.9. Needs no permission: it only runs the plugin's own
   * code on a timer, the same as `events.on` runs it on a notification. */
  readonly scheduler: PluginScheduler;
  /** Added in API 1.10. Requires `notifications`. */
  readonly notifications: PluginNotifications;
  readonly storage: PluginStorage;
  readonly store: PluginStore;
  /** Added in API 1.4. Needs no permission: it reads text, not data. */
  readonly i18n: PluginI18n;
  /** Added in API 1.22. Needs no permission: see `HelpApi`. */
  readonly help: HelpApi;
}

/**
 * Slots Core renders plugin content into. An unknown name is reported and
 * skipped — the registration is a no-op, the rest of the plugin loads
 * normally. This list is the contract.
 */
export const UI_SLOTS = [
  "workspace.sidebar",
  "workspace.ribbon",
  "editor.toolbar",
  "editor.footer",
  "object.properties",
  "settings.section",
  // API 1.22. One floating box in the bottom-left corner of the note area,
  // for a helper character. One occupant at a time: the user picks it in
  // Settings → Plugins. Core draws "Helper · name (id)" under it.
  "workspace.corner",
] as const;

export type UiSlot = (typeof UI_SLOTS)[number];

export interface NotiblePlugin {
  manifest: PluginManifest;
  onload(context: PluginContext): void | Promise<void>;
  onunload?: () => void | Promise<void>;
}

/** `id` is the language. */
export interface CodeBlockRegistration {
  id: string;
  render: CodeBlockRenderer;
  toSvg?: CodeBlockRendererOptions["toSvg"];
  /** API 1.24: see `CodeBlockRendererOptions.persistent`. */
  persistent: boolean;
}

export interface ExtensionSnapshot {
  pluginId: string;
  commands: CommandRegistration[];
  views: ViewRegistration[];
  settings: SettingsRegistration[];
  slots: Record<string, SlotRegistration[]>;
  codeBlocks: CodeBlockRegistration[];
  objectTabs: ObjectTabRegistration[];
  /** Added in API 1.12. Registered prose profiles, in registration order.
   *  Cross-plugin first-wins is resolved by Core at read time. */
  proseProfiles: Array<{ pluginId: string; pluginName: string; match: ProseMatch; profile: ProseProfile }>;
  /** Added in 0.74.2. Object types this plugin has registered via
   *  `data.types.upsert` this session. Core uses it to hide objects whose
   *  type row outlived a since-disabled plugin. */
  providedTypes: string[];
}

/** Same rule as Rust's `media_import::valid_host_pattern`: a lowercase DNS name with a dot, optionally `*.`-prefixed; no scheme, port, path or IP. */
export function isNetworkHostPattern(pattern: string): boolean {
  const name = pattern.startsWith("*.") ? pattern.slice(2) : pattern;
  const labels = name.split(".");
  return name.length <= 253 && labels.length >= 2
    && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    && !/^[0-9]+$/.test(labels[labels.length - 1]);
}

export function validatePluginManifest(manifest: PluginManifest): void {
  if (!/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(manifest.id)) {
    throw new PluginManifestError(`Invalid plugin id: ${manifest.id}`, manifest.id);
  }
  if (!manifest.name.trim() || !manifest.version.trim() || !manifest.apiVersion.trim()) {
    throw new PluginManifestError(`Incomplete manifest: ${manifest.id}`, manifest.id);
  }
  if (!isApiVersionCompatible(manifest.apiVersion)) {
    throw new PluginManifestError(
      `Plugin ${manifest.id} needs API ${manifest.apiVersion}; this host offers ${EXTENSION_API_VERSION}`,
      manifest.id,
    );
  }
  const allowedPermissions = new Set<string>(PLUGIN_PERMISSIONS);
  for (const permission of manifest.permissions ?? []) {
    // A retired value is ignored rather than fatal: rejecting it would stop an
    // already-installed package from loading after an update, which is a worse
    // outcome than granting nothing — which is all it ever did.
    if (RETIRED_PERMISSIONS.includes(permission)) continue;
    if (!allowedPermissions.has(permission)) {
      throw new PluginManifestError(`Unknown permission: ${permission}`, manifest.id);
    }
  }
  if (manifest.networkHosts !== undefined) {
    const hosts = manifest.networkHosts as unknown;
    if (!Array.isArray(hosts) || hosts.length > 20 || !hosts.every((host) => typeof host === "string" && isNetworkHostPattern(host))) {
      throw new PluginManifestError(`networkHosts must be up to 20 host names like "example.org" or "*.example.org": ${manifest.id}`, manifest.id);
    }
    if (hosts.length > 0 && !(manifest.permissions ?? []).includes("network")) {
      throw new PluginManifestError(`networkHosts needs the network permission: ${manifest.id}`, manifest.id);
    }
  }
  if (manifest.sync !== undefined && !["none", "settings", "data"].includes(manifest.sync)) {
    throw new PluginManifestError(`Unknown sync mode: ${manifest.sync}`, manifest.id);
  }
  if (manifest.theme !== undefined) {
    const theme = manifest.theme as unknown;
    const fail = (message: string) => { throw new PluginManifestError(message, manifest.id); };
    if (typeof theme !== "object" || theme === null) fail(`theme must be an object: ${manifest.id}`);
    const meta = theme as Record<string, unknown>;
    if (typeof meta.name !== "string" || !meta.name.trim() || meta.name.length > 60) fail(`theme.name must be 1-60 characters: ${manifest.id}`);
    if (meta.mode !== "light" && meta.mode !== "dark") fail(`theme.mode must be "light" or "dark": ${manifest.id}`);
    if (meta.description !== undefined && (typeof meta.description !== "string" || meta.description.length > 300)) fail(`theme.description must be up to 300 characters: ${manifest.id}`);
    // A theme is styles only. Code plus a theme flag would let a package hide behind the softer install path.
    if (manifest.entry) fail(`a theme pack cannot contain code (entry): ${manifest.id}`);
    if (!manifest.styles?.length) fail(`a theme pack must declare styles: ${manifest.id}`);
  }
  if (manifest.guide !== undefined) {
    if (typeof manifest.guide !== "string") {
      throw new PluginManifestError(`guide must be a markdown string: ${manifest.id}`, manifest.id);
    }
    if (manifest.guide.length > 20_000) {
      throw new PluginManifestError(`guide is over 20 000 characters: ${manifest.id}`, manifest.id);
    }
  }
}
