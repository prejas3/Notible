/**
 * Notible Plugin API — typy dla edytora.
 *
 * Ten plik nie jest potrzebny, żeby napisać plugin: Notible ładuje zwykły
 * JavaScript. Jest po to, żeby edytor podpowiadał i sprawdzał typy.
 *
 * Użycie w czystym JS, bez konfigurowania TypeScriptu — dodaj na górze
 * swojego `main.js`:
 *
 *     /** @type {import("./notible-plugin-api").NotiblePlugin} *\/
 *     export default { manifest: { ... }, onload(context) { ... } };
 *
 * Wygenerowane z packages/plugin-api/src/index.ts dla apiVersion 1.0.
 */

/**
 * Public plugin contract. This package intentionally contains no Tauri,
 * React or SQLite imports, so an external plugin can type-check against it
 * without depending on Core internals.
 */

export declare const EXTENSION_API_VERSION: "1.5";

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
export declare function isApiVersionCompatible(declared: string, host?: string): boolean;

export declare class PluginManifestError extends Error {
  readonly manifestId?: string;
  constructor(message: string, manifestId?: string);
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  description?: string;
  author?: string;
  entry?: string;
  styles?: string[];
  dependencies?: Record<string, string>;
  minCoreVersion?: string;
  maxCoreVersion?: string | null;
  channel?: "stable" | "beta" | "nightly";
  permissions?: PluginPermission[];
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
export declare const PLUGIN_PERMISSIONS: readonly [
  "data.read",
  "data.write",
  "relations.write",
  "workspace.ui",
  "editor.extension",
  "data.sync",
  "network",
];

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

/**
 * Accepted for one more release so a package written before 1.0 still loads,
 * then rejected. They grant nothing and are not shown on the install screen.
 */
export declare const RETIRED_PERMISSIONS: readonly string[];

export type PluginErrorPhase = "load" | "unload" | "command";

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
  objectMenu?: CommandObjectMenuMeta;
  /**
   * Default binding, e.g. `"Mod+Shift+K"` — `Mod` is Ctrl on Windows and Linux
   * and Cmd on macOS. Modifiers in any order; the key is matched
   * case-insensitively.
   *
   * Core dispatches it, and refuses a binding already claimed by another
   * plugin or by Core itself: first registration wins and later ones are
   * ignored rather than silently shadowing. Nothing fires while the user is
   * typing in a field or a note.
   */
  hotkey?: string;
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
}

/**
 * Object types Core mounts a container surface for. A tab registered for
 * anything else is reported and skipped.
 *
 * Note the difference from `objectMenu`, where Core does NOT interpret the
 * type strings: here it does, because mounting a surface is limited to this
 * set inside Core itself (CONTAINER_TYPES plus whiteboard). A runtime list,
 * not only a TS union — a union validates nothing at runtime.
 */
export declare const OBJECT_TAB_TYPES: readonly ["space", "folder", "project", "whiteboard"];
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
  objectTypes: ObjectTabType[];
  /** 0-100, clamped. Builtin tabs always sort before plugin ones. */
  order?: number;
  mount(element: HTMLElement, context: ObjectTabContext): Disposable | void;
}

/**
 * What a code-block renderer is handed for one fenced block.
 *
 * `source` is the block's exact text. The fence stays visible and editable
 * above your output; you draw into a separate, non-editable element below it,
 * so nothing you render can corrupt what gets saved.
 */
export interface CodeBlockContext {
  /** Host-owned, `contenteditable="false"`. Render into it; do not detach it. */
  container: HTMLElement;
  /** Lower-cased info string, e.g. `mermaid`. */
  language: string;
  source: string;
  objectId?: string;
  plugin: PluginContext;
  theme: { mode: "paper" | "night"; token(name: string): string };
}

export type CodeBlockRenderer = (context: CodeBlockContext) => Disposable | void;

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
 * Deliberately narrow: Core's editor is a contenteditable over plain Markdown,
 * not a ProseMirror document, so there is no node schema to expose.
 */
export interface EditorApi {
  /** Requires `editor.extension`. One renderer per language, first wins. */
  registerCodeBlockRenderer(language: string, render: CodeBlockRenderer): Disposable;
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
export interface UiApi {
  notice(message: string, options?: { timeoutMs?: number }): Disposable;
  modal(options: { title: string; mount: ViewMount }): Disposable;
  menu(items: MenuItem[], at: { x: number; y: number }): Disposable;
  suggest<T>(items: T[], render: (item: T) => string, options?: { placeholder?: string }): Promise<T | null>;
  /**
   * Bring the workspace to an object — the same navigation the sidebar does.
   * Added in API 1.1: before it, only a mounted view could navigate, so a
   * command bound to a hotkey could create today's note but not open it.
   * Resolves once the object is showing; a missing id is a no-op.
   */
  openObject(id: string): Promise<void>;
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
  level: number | null;
  language: string | null;
  checked: boolean | null;
  line: number;
}

/**
 * D13 — an ordered, read-only projection of a note's body. Computed on demand,
 * so it cannot go stale. Read-only on purpose: Core's stored-document
 * conversion is lossy in the write direction.
 */
export interface DocumentApi {
  get(objectId: string): Promise<DocumentBlock[]>;
}

export interface DataApi {
  objects: {
    get(id: string): Promise<PluginObject | null>;
    create(input: PluginObjectInput): Promise<PluginObject>;
    update(id: string, patch: PluginObjectPatch, expectedUpdatedAt?: number): Promise<PluginObject>;
    move(id: string, parentId: string | null): Promise<PluginObject>;
    trash(id: string): Promise<PluginObject | null>;
    query(query?: PluginObjectQuery): Promise<PluginObject[]>;
  };
  relations: {
    list(objectId: string): Promise<PluginRelation[]>;
    create(fromId: string, toId: string, kind: string): Promise<PluginRelation>;
    delete(fromId: string, toId: string, kind: string): Promise<boolean>;
  };
  types: {
    list(): Promise<PluginType[]>;
    upsert(name: string, schema: string, icon?: string, color?: string): Promise<PluginType>;
  };
  /** Requires `data.read`. */
  index: ContentIndexApi;
  /** Requires `data.read`. */
  document: DocumentApi;
  dataSources: {
    list(): Promise<PluginDataSource[]>;
    upsert(name: string, definition: string, id?: string): Promise<PluginDataSource>;
    delete(id: string): Promise<boolean>;
  };
  /** Requires `data.sync`. Added in API 1.2. */
  sync: SyncApi;
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

export interface SyncSnapshot {
  /** Stable for this workspace on this machine. Generated on first export. */
  deviceId: string;
  cursor: number;
  objects: PluginObject[];
  relations: SyncRelation[];
  tombstones: SyncTombstone[];
  relationTombstones: SyncRelationTombstone[];
  outbox: SyncOutboxEntry[];
}

export interface SyncApplyRequest {
  cursor: number;
  objects: PluginObject[];
  relations: SyncRelation[];
  tombstones: SyncTombstone[];
  relation_tombstones: SyncRelationTombstone[];
  acknowledged_operations?: string[];
}

export interface SyncApplyResult {
  appliedObjects: number;
  addedRelations: number;
  deletedRelations: number;
  deletedObjects: number;
  acknowledgedOperations: number;
  cursor: number;
}


export interface PluginStorage {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
  keys(): string[];
}

export interface PluginEvents {
  on<T>(event: string, handler: (payload: T) => void): Disposable;
  emit<T>(event: string, payload: T): void;
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
  "object.opened": { id: string; type: string };
  "workspace.changed": Record<string, never>;
  "theme.changed": { mode: "paper" | "night" };
  "app.ready": Record<string, never>;
}

export declare const CORE_EVENTS: readonly (keyof CoreEvents)[];

/**
 * Translation for plugin UI, added in API 1.4.
 *
 * Resolution order is your own plugin id, then the shared `app` namespace,
 * then the key itself. `app` is Core and every builtin — one product,
 * released together — so a common word like "Cancel" is translated once for
 * the whole application rather than once per plugin.
 *
 * The key **is** the English sentence, and it must be a whole sentence with
 * `{placeholders}`, never a fragment glued to a number: fragment order is
 * fixed by your markup, so no translation can repair the grammar around it.
 * Pass a `count` value and the right plural form is chosen for the language.
 *
 * **What `t` returns is untrusted text.** A translation is a file a stranger
 * wrote. Set it with `textContent`; never build markup out of it.
 */
export interface PluginI18n {
  t(key: string, values?: Record<string, string | number>): string;
  /** BCP-47 tag for `Intl` formatting — dates are part of a language too. */
  readonly locale: string;
}

export interface PluginPermissions {
  has(permission: PluginPermission): boolean;
  require(permission: PluginPermission): void;
}

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly permissions: PluginPermissions;
  readonly data: DataApi;
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
  readonly storage: PluginStorage;
  /** Added in API 1.4. Needs no permission: it reads text, not data. */
  readonly i18n: PluginI18n;
}

/**
 * Slots Core renders plugin content into. An unknown name is reported and
 * skipped — the registration is a no-op, the rest of the plugin loads normally.
 * This list is the contract.
 */
export declare const UI_SLOTS: readonly [
  "workspace.sidebar",
  "workspace.ribbon",
  "editor.toolbar",
  "editor.footer",
  "object.properties",
  "settings.section",
];

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
}

export interface ExtensionSnapshot {
  pluginId: string;
  commands: CommandRegistration[];
  views: ViewRegistration[];
  settings: SettingsRegistration[];
  slots: Record<string, SlotRegistration[]>;
  codeBlocks: CodeBlockRegistration[];
}

export declare function validatePluginManifest(manifest: PluginManifest): void;
