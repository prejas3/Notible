import { invoke as tauriInvoke, convertFileSrc } from "@tauri-apps/api/core";
import { devInvoke, isDevMockActive } from "./dev-mock-invoke.ts";
import type {
  DataApi,
  PluginObject,
  PluginObjectInput,
  PluginObjectPatch,
  PluginObjectQuery,
  PluginRelation,
  PluginType,
  PluginDataSource,
  ContentIndexEntry,
  DocumentBlock,
  ContentIndexQuery,
  SyncSnapshot,
  SyncApplyResult,
} from "../../../packages/plugin-api/src/index.ts";
import type { LocalPluginFileReader } from "../extensions/loader.ts";

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return isDevMockActive() ? devInvoke<T>(cmd, args) : tauriInvoke<T>(cmd, args);
}

function notifyWorkspaceChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("notible:workspace-changed"));
}

/**
 * Announce an object lifecycle change so Core can forward it onto the plugin
 * event bus. It travels as a DOM event rather than a direct `coreHost.emit`
 * because this module must not import the app shell — the shell imports this.
 * The same indirection `notifyWorkspaceChanged` already uses.
 *
 * Emitting here rather than at each UI call site means a change made by a
 * plugin is announced exactly like one made by Core, which is the property
 * that makes the event set trustworthy.
 */
function notifyObjectEvent(kind: "created" | "updated" | "trashed" | "opened", object: PluginObject | null) {
  if (!object || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("notible:object-event", {
    detail: { event: `object.${kind}`, payload: { id: object.id, type: object.type } },
  }));
}

/** Core calls this when the user opens an object; there is no invoke behind it.
 * `view` says whether the note editor or a plugin's object tab shows it —
 * sync plugins only stop holding back what the note editor shows. */
export function announceObjectOpened(object: PluginObject | null, view: "editor" | "tab") {
  if (!object || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("notible:object-event", {
    detail: { event: "object.opened", payload: { id: object.id, type: object.type, view } },
  }));
}

/**
 * The deliberately small data surface used by Core-only recovery mode.
 * The broad application data facade is not part of this dependency graph.
 */
export function listRootObjects(): Promise<PluginObject[]> {
  return invoke("list_root_objects");
}

export function listObjects(limit = 200): Promise<PluginObject[]> {
  return invoke("list_objects", { limit, offset: 0 });
}

export function searchObjects(query: string, limit = 200): Promise<PluginObject[]> {
  return invoke("search_objects", { query, limit });
}

/** Core's sidebar search: substring on title, content and props, in Rust. */
export function searchObjectsText(query: string, limit = 5000): Promise<PluginObject[]> {
  return invoke("search_objects_text", { query, limit });
}

export function getObject(id: string): Promise<PluginObject | null> {
  return invoke("get_object", { id });
}

/** `writer: "editor"` is the note editor's autosave: its history rows coalesce
 * into one per editing session. Everyone else (plugins included) omits it. */
export function updateObject(id: string, patch: PluginObjectPatch, expectedUpdatedAt?: number, writer?: "editor"): Promise<PluginObject> {
  return invoke<PluginObject>("update_object", { id, ...patch, expectedUpdatedAt, writer }).then((object) => { notifyWorkspaceChanged(); notifyObjectEvent("updated", object); return object; });
}

export type HistorySource = "local" | "sync" | "restore" | "baseline";
export interface HistoryMeta { id: number; ts: number; source: HistorySource; size: number }
export interface HistoryEntry { id: number; ts: number; source: HistorySource; patch: string }

/** Version history of one object, newest first — metadata only. */
export function listHistory(objectId: string): Promise<HistoryMeta[]> {
  return invoke("list_history", { objectId, limit: 100 });
}

export function getHistoryEntry(objectId: string, id: number): Promise<HistoryEntry | null> {
  return invoke("get_history_entry", { objectId, id });
}

/** Restore a version; the restore is itself a history row, so it can be undone. */
export function restoreVersion(objectId: string, versionId: number): Promise<PluginObject> {
  return invoke<PluginObject>("restore_version", { objectId, versionId }).then((object) => { notifyWorkspaceChanged(); notifyObjectEvent("updated", object); return object; });
}

export function deleteHistoryEntry(objectId: string, id: number): Promise<boolean> {
  return invoke("delete_history_entry", { objectId, id });
}

export function clearHistory(objectId: string): Promise<number> {
  return invoke("clear_history", { objectId });
}

export function trashObject(id: string): Promise<PluginObject | null> {
  return invoke<PluginObject | null>("trash_object", { id }).then((object) => { notifyWorkspaceChanged(); notifyObjectEvent("trashed", object); return object; });
}

export function restoreObject(id: string): Promise<PluginObject | null> {
  return invoke<PluginObject | null>("restore_object", { id }).then((object) => { notifyWorkspaceChanged(); return object; });
}

/** Permanent: the object, its relations, history and orphaned images. Only for
 * items already in the trash (Delete forever, Empty trash). */
export function deleteObjectForever(id: string): Promise<boolean> {
  return invoke<boolean>("delete_object", { id }).then((deleted) => { notifyWorkspaceChanged(); return deleted; });
}

export function listTrash(): Promise<PluginObject[]> {
  return invoke<PluginObject[]>("list_trash");
}

export function listRelations(objectId: string): Promise<PluginRelation[]> {
  return invoke<PluginRelation[]>("list_relations", { objectId });
}

export function backupDatabase(): Promise<string> {
  return invoke("backup_database");
}

export interface BackupInfo {
  path: string;
  filename: string;
  size: number;
  modified_at: number;
}

export function listBackups(): Promise<BackupInfo[]> {
  return invoke("list_backups");
}

export function backupsDirectory(): Promise<string> {
  return invoke("backups_directory");
}

export function deleteBackup(path: string): Promise<void> {
  return invoke("delete_backup", { path });
}

/** How many newest backups to keep (both manual and automatic startup
 * backups prune down to this count). Defaults to 10 server-side. */
export function getBackupRetention(): Promise<number> {
  return invoke("get_backup_retention");
}

export function setBackupRetention(value: number): Promise<void> {
  return invoke("set_backup_retention", { value });
}

export function restoreDatabase(backupPath: string): Promise<string> {
  return invoke("restore_database", { backupPath });
}

/** Persists an image (e.g. a pasted screenshot) into app_data/media via the
 * backend; returns the absolute filesystem path for `convertFileSrc`. */
export function saveMedia(dataBase64: string, ext: string): Promise<string> {
  return invoke("save_media", { dataBase64, ext });
}

/** Media files in app_data/media that no note, property or restorable history
 * snapshot still mentions. `remove: false` only reports; `true` unlinks them. */
export interface MediaSweep { files: number; bytes: number; deleted: boolean }

/** One installed translation, already validated and trimmed by Rust. */
export interface LocaleBundle {
  locale: string;
  name: string;
  /** Set by the pack's author; how an update is told from what is installed. */
  version: string | null;
  author: string | null;
  strings: Record<string, Record<string, string | Record<string, string>>>;
  /** The filename it came from, so the user can see where it is from. */
  source: string;
  /** Entries Rust dropped for being oversized or malformed. */
  dropped_keys: number;
}

export function listLocales(): Promise<LocaleBundle[]> {
  return invoke<LocaleBundle[]>("list_locales");
}

/** Install a language pack from the text of its language.json. Rust validates
 * and re-writes it; the text itself is never stored. */
export function installLocale(json: string): Promise<LocaleBundle> {
  return invoke<LocaleBundle>("install_locale", { json });
}

export function removeLocale(tag: string): Promise<void> {
  return invoke<void>("remove_locale", { tag });
}

/** One image or font of an installed theme pack as a data: URI. Rust checks the
 * path, the file's real type and its size; a theme cannot read anything else. */
export function readThemeAsset(pluginId: string, path: string): Promise<string> {
  return invoke<string>("read_theme_asset", { pluginId, path });
}

/** Retexts the native system-tray menu/tooltip. The tray is built once in
 * Rust before any webview exists, in an English placeholder — this is the
 * one bridge that lets it catch up to the user's actual language, called
 * once on startup and again on every language change. See TrayHandles in
 * src-tauri/src/lib.rs. */
export function setTrayTexts(show: string, quit: string, tooltip: string): Promise<void> {
  return invoke<void>("set_tray_texts", { show, quit, tooltip });
}

export function setUiLanguage(language: string): Promise<void> {
  return invoke<void>("set_ui_language", { language });
}

export function sweepOrphanMedia(remove: boolean): Promise<MediaSweep> {
  return invoke<MediaSweep>("sweep_orphan_media", { delete: remove });
}

export function createNote(title = "Untitled note", content = "", parentId?: string): Promise<PluginObject> {
  return invoke<PluginObject>("create_object", {
    type: "note",
    title,
    content: JSON.stringify({ type: "doc", content: content ? [{ type: "paragraph", content: [{ type: "text", text: content }] }] : [{ type: "paragraph" }] }),
    props: JSON.stringify({}),
    parentId,
  }).then((object) => { notifyWorkspaceChanged(); notifyObjectEvent("created", object); return object; });
}

/**
 * Core-owned adapter for the public plugin contract. It talks directly to
 * the stable Tauri commands and deliberately does not import the broad legacy
 * data layer.
 */
export const coreDataApi: DataApi & { media: DataApi["media"] & { readOwned: (pluginId: string, ref: string) => Promise<string>; pickImageForPlugin: (pluginId: string) => Promise<string | null>; importImageForPlugin: (pluginId: string, url: string) => Promise<string> } } = {
  objects: {
    get: (id) => getObject(id),
    create: (input: PluginObjectInput) => invoke<PluginObject>("create_object", { ...input }).then((object) => { notifyWorkspaceChanged(); notifyObjectEvent("created", object); return object; }),
    update: (id, patch: PluginObjectPatch, expectedUpdatedAt) => updateObject(id, patch, expectedUpdatedAt),
    setType: async (id, newType, expectedUpdatedAt) => {
      const object = await invoke<PluginObject>("set_object_type", { id, newType, expectedUpdatedAt });
      notifyWorkspaceChanged();
      notifyObjectEvent("updated", object);
      return object;
    },
    move: async (id, parentId) => {
      // The Rust parameter is `new_parent_id`, so the key must be
      // `newParentId`. Passing `parentId` made every plugin's
      // `data.objects.move()` fail at runtime.
      await invoke("move_object", { id, newParentId: parentId });
      const object = await getObject(id);
      notifyWorkspaceChanged();
      if (!object) throw new Error("Moved object could not be reloaded.");
      return object;
    },
    trash: (id) => trashObject(id),
    query: (query: PluginObjectQuery = {}) => invoke("query_objects", { ...query }),
    // API 1.18. Reuses the `notible:object-event` DOM bus this module already
    // dispatches from every write above (`notifyObjectEvent`) — the same
    // event `created`/`updated`/`trashed` lifecycle listeners elsewhere in
    // Core use, so this fires for a change from the user's own editor
    // autosave or another plugin's `objects.update`, not only this plugin's.
    // A plain re-fetch on match rather than trusting the event payload
    // (which carries only `id`/`type`): the object may have changed again by
    // the time the listener runs, and the callback contract is "the current
    // object", not "what changed".
    //
    // A sync pull applies through `sync.apply` below, which announces the
    // whole workspace as changed rather than one id at a time (see the
    // comment there) — a rename that arrives purely via sync will not fire
    // this until something else touches the same object afterwards. Known
    // gap, not silently pretended away.
    onChange: (id, callback) => {
      const handler = (event: Event) => {
        const detail = (event as CustomEvent<{ event: string; payload: { id: string; type: string } }>).detail;
        if (detail?.payload?.id !== id) return;
        void getObject(id).then((object) => { if (object) callback(object); });
      };
      window.addEventListener("notible:object-event", handler);
      return { dispose: () => window.removeEventListener("notible:object-event", handler) };
    },
    findByTitle: (query, options) => invoke<PluginObject[]>("find_objects_by_title", { query, exact: options?.exact, limit: options?.exact ? undefined : 100 }),
  },
  relations: {
    list: (objectId) => invoke<PluginRelation[]>("list_relations", { objectId }),
    listForObjects: async (ids: string[]) => {
      const flat = await invoke<PluginRelation[]>("list_relations_bulk", { ids });
      const out: Record<string, PluginRelation[]> = {};
      for (const id of ids) out[id] = [];
      for (const r of flat) {
        if (out[r.from_id]) out[r.from_id].push(r);
        if (r.to_id !== r.from_id && out[r.to_id]) out[r.to_id].push(r);
      }
      return out;
    },
    create: async (fromId, toId, kind) => { const relation = await invoke<PluginRelation>("create_relation", { fromId, toId, kind }); notifyWorkspaceChanged(); return relation; },
    delete: async (fromId, toId, kind) => { const relation = await invoke<boolean>("delete_relation", { fromId, toId, kind }); notifyWorkspaceChanged(); return relation; },
  },
  types: {
    list: () => invoke<PluginType[]>("list_types"),
    upsert: async (name, schema, icon, color, pluginId?: string) => { const result = await invoke<PluginType>("upsert_type", { name, schema, icon, color, pluginId }); notifyWorkspaceChanged(); return result; },
  },
  index: {
    query: (query: ContentIndexQuery = {}) => invoke<ContentIndexEntry[]>("query_content_index", {
      kind: query.kind,
      value: query.value,
      objectId: query.objectId,
      limit: query.limit,
    }),
    forObject: (objectId: string) => invoke<ContentIndexEntry[]>("query_content_index", { objectId }),
  },
  document: {
    get: (objectId: string) => invoke<DocumentBlock[]>("project_document", { objectId }),
  },
  media: {
    read: (ref: string) => readReferencedMedia(ref),
    pickImage: () => pickMediaImage(),
    readOwned: (pluginId: string, ref: string) => readPluginOwnedMedia(pluginId, ref),
    pickImageForPlugin: (pluginId: string) => pickMediaImage(pluginId),
    // A bare call can't say which plugin's networkHosts apply; only the scoped host wrapper can.
    importImageFromUrl: async () => { throw new Error("importImageFromUrl needs a plugin context"); },
    importImageForPlugin: (pluginId: string, url: string) => invoke<string>("plugin_media_import_url", { pluginId, url }),
  },
  dataSources: {
    list: () => invoke<PluginDataSource[]>("list_data_sources"),
    upsert: async (name, definition, id) => { const result = await invoke<PluginDataSource>("upsert_data_source", { id, name, definition }); notifyWorkspaceChanged(); return result; },
    delete: async (id) => { const result = await invoke<boolean>("delete_data_source", { id }); notifyWorkspaceChanged(); return result; },
  },
  sync: {
    export: () => invoke<SyncSnapshot>("sync_export"),
    // A replication write touches arbitrarily many objects at once, so it
    // announces the workspace as changed rather than emitting per-object
    // lifecycle events — the sidebar and open views reload once instead of
    // once per row. A plugin that needs per-object granularity has the
    // snapshot it just applied.
    apply: async (request) => { const result = await invoke<SyncApplyResult>("sync_apply", { request }); notifyWorkspaceChanged(); return result; },
    markOutboxAttempts: (operationIds) => invoke<void>("sync_mark_outbox_attempts", { operationIds }),
    media: {
      missing: (filenames) => syncMediaMissing(filenames),
      read: (filename) => syncMediaRead(filename),
      write: (filename, dataBase64) => syncMediaWrite(filename, dataBase64),
    },
    // SYNC-TRANSPORT (Hive #9): Rust refuses every call outside an agent sandbox.
    sandboxFolder: {
      available: () => invoke<boolean>("sandbox_shared_available"),
      list: () => invoke<{ name: string; modified: string }[]>("sandbox_shared_list"),
      read: (name) => invoke<string>("sandbox_shared_read", { name }),
      write: (name, dataBase64, options) => invoke<boolean>("sandbox_shared_write", { name, dataBase64, ifAbsent: options?.ifAbsent ?? false }),
      remove: (name) => invoke<void>("sandbox_shared_delete", { name }),
    },
  },
};

export interface CoreFilePreview {
  kind: "text" | "image" | "binary";
  content: string;
  truncated: boolean;
  size: number;
  ext: string;
}

export type CorePluginRegistryState = "active" | "disabled" | "failed" | "installed";

export interface CorePluginRegistryEntry {
  plugin_id: string;
  version: string;
  source: "builtin" | "local-file" | "package";
  install_path: string;
  manifest: string;
  /** Rust checked an Ed25519 signature against the embedded key set. */
  verified: boolean;
  /** The user accepted the warning for these exact bytes. See grantPluginTrust. */
  user_trusted: boolean;
  state: CorePluginRegistryState;
  last_error: string | null;
}

export function pickPluginFolder(): Promise<string | null> {
  return invoke("pick_folder");
}

/** Folders the user has linked. Every one of them is readable by every plugin,
 * which is exactly why Settings has to show them. */
export function listGrantedFolders(): Promise<string[]> {
  return invoke("list_granted_folders");
}

export function revokeGrantedFolder(path: string): Promise<string[]> {
  return invoke("revoke_granted_folder", { path });
}

/** Containment is enforced in Rust against the folders the user picked, so
 * no root travels from here — see resolve_granted in src-tauri/src/files.rs. */
export function readPluginFile(path: string, maxBytes = 2 * 1024 * 1024): Promise<CoreFilePreview> {
  return invoke("read_file_preview", { path, maxBytes });
}

export const coreLocalPluginFileReader: LocalPluginFileReader = {
  async readText(_root, path) {
    const preview = await readPluginFile(path);
    if (preview.kind !== "text" || preview.truncated) throw new Error(`plugin file is not a complete text file: ${path}`);
    return preview.content;
  },
  /**
   * Plugin entries are imported from the `plugin:` scheme, because
   * `script-src 'self'` rejects the `data:` URL the loader used before and no
   * third-party plugin could load in a packaged build. `convertFileSrc`
   * handles the per-platform spelling (`plugin://localhost/…` vs
   * `http://plugin.localhost/…`). Rust re-checks containment on every
   * request; see resolve_plugin_script in src-tauri/src/files.rs.
   */
  scriptUrl(_root, path) {
    if (isDevMockActive()) return null;
    // Normalise Windows separators before the path is percent-encoded into a
    // URL. Windows accepts forward slashes everywhere, and it keeps `%5C` out
    // of the request URI where URL parsers are inconsistent about it.
    const url = convertFileSrc(path.replaceAll("\\", "/"), "plugin");
    // A module graph is cached by URL for the lifetime of the document, so a
    // stable URL made "Reload" a lie: it re-imported the copy already in
    // memory and the edited file on disk could not get in until the whole
    // window was reloaded. An author editing a plugin saw their old code and
    // had no way to tell. The counter makes every load a distinct URL.
    return `${url}${url.includes("?") ? "&" : "?"}reload=${nextModuleLoad()}`;
  },
};

/** Monotonic, so two loads in the same millisecond still differ. */
let moduleLoadCounter = 0;
function nextModuleLoad() {
  moduleLoadCounter += 1;
  return `${Date.now()}-${moduleLoadCounter}`;
}

export function listPluginRegistry(): Promise<CorePluginRegistryEntry[]> {
  return invoke("list_plugin_registry");
}

export function upsertPluginRegistry(input: {
  plugin_id: string;
  version: string;
  source: CorePluginRegistryEntry["source"];
  install_path: string;
  manifest: string;
  verified: boolean;
}): Promise<CorePluginRegistryEntry> {
  // Tauri exposes a command's snake_case Rust parameters as camelCase keys,
  // so the registry entry's own snake_case field names cannot be forwarded
  // as-is — doing that fails at runtime with "missing required key pluginId"
  // and nothing in TypeScript can see it. scripts/invoke-args-check.mjs now
  // asserts this mapping for every invoke in the app.
  return invoke("upsert_plugin_registry", {
    pluginId: input.plugin_id,
    version: input.version,
    source: input.source,
    installPath: input.install_path,
    manifest: input.manifest,
    verified: input.verified,
  });
}

/**
 * Show the native install warning for an already-registered package and, if
 * the user accepts, record that decision. Rust reads the warning's text out
 * of the stored manifest rather than taking it from here, and it is the only
 * writer of `user_trusted` — so this must be called *before* the package's
 * code is loaded, never after.
 */
/**
 * `sourceUrl` is ignored by Rust since Hive #8 (TRUST-OFFICIAL-SOURCE): any
 * plugin could pass an official URL. Rust skips the dialog only for a package
 * it saw `market_fetch` download from an official release and
 * `install_plugin_zip` extract to the registry row's path.
 */
export function grantPluginTrust(pluginId: string, version: string, sourceUrl?: string): Promise<CorePluginRegistryEntry> {
  return invoke("grant_plugin_trust", { pluginId, version, sourceUrl });
}

/**
 * Trust a package that carries no code. No dialog: a theme executes nothing,
 * and prompting for it would train users to click through the prompt that
 * does matter. Rust re-reads the manifest and refuses if it has an `entry`.
 */
export function grantThemeTrust(pluginId: string, version: string): Promise<CorePluginRegistryEntry> {
  return invoke("grant_theme_trust", { pluginId, version });
}

/** Open the native picker for a plugin `.zip`. */
export function pickPluginPackage(): Promise<string | null> {
  return invoke("pick_file");
}

export interface CoreExtractedPlugin {
  plugin_id: string;
  version: string;
  install_path: string;
}

/** Unpack a plugin `.zip` into the app's plugin directory. */
export function extractPluginZip(path: string): Promise<CoreExtractedPlugin> {
  return invoke("extract_plugin_zip", { path });
}

/**
 * Write a working starter plugin into `folder`. The first step of writing a
 * plugin should be "you already have a running one", not "read this document".
 */
export function scaffoldPlugin(folder: string, pluginId: string): Promise<string> {
  return invoke("scaffold_plugin", { folder, pluginId });
}

/**
 * Write the plugin developer pack — guide, reference, editor types and a
 * worked example — into `folder`. The files are compiled into the binary, so
 * what lands on disk always matches the running build rather than whatever
 * the website happens to be serving.
 */
export function exportPluginDevkit(folder: string): Promise<string> {
  return invoke("export_plugin_devkit", { folder });
}

export function setPluginRegistryState(pluginId: string, version: string, state: CorePluginRegistryState, lastError?: string): Promise<CorePluginRegistryEntry> {
  return invoke("set_plugin_registry_state", { pluginId, version, pluginState: state, lastError });
}

export function removePluginRegistry(pluginId: string, version?: string): Promise<number> {
  return invoke("remove_plugin_registry", { pluginId, version });
}

/**
 * Ask the release feed whether a newer signed build exists; returns its
 * version, or null.
 *
 * Not `@tauri-apps/plugin-updater`. Its JS commands take `proxy` and
 * `allowDowngrades` from the caller and are reachable from any plugin in the
 * webview, which is a forced downgrade to an older — still correctly signed —
 * Notible. `updater:default` is off in the capability file; these two go
 * through Rust, which takes no arguments at all.
 */
export function checkForUpdate(): Promise<string | null> {
  return invoke("update_check");
}

/** Install what `checkForUpdate` found. The installer closes the app. */
/** Set by the app shell: saves what is typed but not yet autosaved. Both ways
 *  the process ends from inside the app run it first. */
let beforeExit: () => Promise<void> = async () => {};
export function setBeforeExit(flush: () => Promise<void>) {
  beforeExit = flush;
}

export async function installUpdate(): Promise<void> {
  await beforeExit().catch(() => {});
  return invoke("update_install");
}

export async function quitApp(): Promise<void> {
  await beforeExit().catch(() => {});
  return invoke("quit_app");
}

/** Whether Notible is registered to launch when the user signs in. */
export function isAutostartEnabled(): Promise<boolean> {
  return invoke("is_autostart_enabled");
}

/** Register or unregister Notible for launch at sign-in. */
export function setAutostart(enabled: boolean): Promise<void> {
  return invoke("set_autostart", { enabled });
}

/**
 * Install a community plugin from a downloaded .zip (Model A — no signing).
 * Rust runs `extract_plugin_zip`'s structural + id/version safety checks and
 * refuses a package whose `plugin.json` id/version does not match what the
 * catalog entry promised. Same route as `extractPluginZip`, one step earlier.
 */
export function installPluginZip(packageBase64: string, expectedId: string, expectedVersion: string): Promise<CoreExtractedPlugin> {
  return invoke("install_plugin_zip", { packageBase64, expectedId, expectedVersion });
}

/** Which of these media filenames this machine does not have. */
export function syncMediaMissing(filenames: string[]): Promise<string[]> {
  return invoke("sync_media_missing", { filenames });
}

/** One media file's bytes, base64. Refused unless the user allowed it. */
export function syncMediaRead(filename: string): Promise<string> {
  return invoke("sync_media_read", { filename });
}

/** `media/<uuid-v4>.<ext>`, `<ext>` in the set below — deliberately NOT `svg`,
 *  which can carry script and is what `sync_media_write` refuses. */
const REFERENCED_MEDIA = /^media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|jpeg|gif|webp|bmp)$/;

/**
 * `context.data.media.read` (API 1.14). A thin wrapper over `sync_media_read`
 * so a plugin can read one pasted image without declaring `data.sync`. Reaches
 * no bytes that call does not, through the same user gate. SVG is rejected
 * here before the invoke, because the caller turns the result into an
 * `<img>`/`data:` URI.
 */
export function readReferencedMedia(ref: string): Promise<string> {
  if (!REFERENCED_MEDIA.test(ref)) {
    return Promise.reject(new Error(`not an embeddable media reference: ${ref}`));
  }
  return invoke("sync_media_read", { filename: ref.slice("media/".length) });
}

/** Ask the user for an image and copy it into the managed media store. */
export function pickMediaImage(pluginId = ""): Promise<string | null> {
  return invoke("pick_media_image", { pluginId });
}

/** Read a cover this plugin selected itself, without exposing other pasted images. */
export function readPluginOwnedMedia(pluginId: string, ref: string): Promise<string> {
  if (!REFERENCED_MEDIA.test(ref)) return Promise.reject(new Error(`not an embeddable media reference: ${ref}`));
  return invoke("plugin_media_read", { pluginId, filename: ref.slice("media/".length) });
}

/** Store one media file that arrived from another machine. */
export function syncMediaWrite(filename: string, dataBase64: string): Promise<void> {
  return invoke("sync_media_write", { filename, dataBase64 });
}

/** Absolute path of this installation's media directory. */
export function mediaDirectory(): Promise<string> {
  return invoke("media_directory");
}

/** Id of the newest row in the durable change stream (`integration_events`),
 * starting from `after`. Every write to `objects` lands there via SQLite
 * triggers — including writers outside the app (the MCP server) that never
 * announce themselves. The table is capped at 2000 rows, so this is at most
 * a couple of pages. */
export async function latestIntegrationEventId(after = 0): Promise<number> {
  let cursor = after;
  for (;;) {
    const page = await invoke<Array<{ id: number }> | null>("list_integration_events", { after: cursor, limit: 1000 });
    if (!page?.length) return cursor;
    cursor = page[page.length - 1].id;
    if (page.length < 1000) return cursor;
  }
}

/** Refresh lists when the window regains focus and something outside the app
 * (e.g. an AI agent through MCP) changed the database meanwhile. The app's own
 * writes already announce themselves; this only catches the silent ones. */
export function watchExternalChanges(): () => void {
  let cursor: number | null = null;
  let busy = false;
  const check = async () => {
    if (busy || document.visibilityState === "hidden") return;
    busy = true;
    try {
      const latest = await latestIntegrationEventId(cursor ?? 0);
      if (cursor !== null && latest > cursor) notifyWorkspaceChanged();
      cursor = latest;
    } catch {
      // Best effort: the regular refresh paths still work without it.
    } finally {
      busy = false;
    }
  };
  void check();
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", check);
  return () => {
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", check);
  };
}

/** Whether plugins may read pasted images (Settings → Sync). */
export function mediaSharingStatus(): Promise<boolean> {
  return invoke("media_sharing_status");
}

/** Turn plugin access to pasted images on or off. Turning it ON opens a
 * native confirmation; the returned value is what actually got stored, so a
 * cancelled dialog comes back as false. */
export function setMediaSharing(allowed: boolean): Promise<boolean> {
  return invoke("set_media_sharing", { allowed });
}

/**
 * Google sign-in through the system browser, on behalf of a plugin.
 *
 * `provider` is a name Core resolves to a client id and a fixed scope set —
 * see `plugin_oauth.rs`. A plugin cannot supply either, which is the whole
 * point: otherwise it could raise a real Google consent screen for scopes of
 * its choosing.
 */
export function pluginGoogleLogin(provider: string): Promise<{ refreshToken?: string; accessToken: string; expiresIn: number; idToken?: string }> {
  return invoke("plugin_google_login", { provider });
}

/** Trade a stored refresh token for a fresh access token. */
export function pluginGoogleAccessToken(provider: string, refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  return invoke("plugin_google_access_token", { provider, refreshToken });
}

/** Drop the grant on Google's side, not just locally. */
export function pluginGoogleRevoke(refreshToken: string): Promise<void> {
  return invoke("plugin_google_revoke", { refreshToken });
}

/** Native OS notification for the `notifications` permission (API 1.10). The
 *  host checks the permission; this only wraps the Tauri command. */
export function pluginShowNotification(title: string, body?: string): Promise<void> {
  return invoke("show_notification", { title, body });
}

// STORE-API (Hive #5).
export function pluginStoreGeneration() { return invoke<string>("plugin_store_generation"); }
export function pluginStoreGetMany(pluginId: string, keys: string[]) { return invoke<(string | null)[]>("plugin_store_get_many", { pluginId, keys }); }
export function pluginStoreSetMany(pluginId: string, generation: string, entries: [string, string][]) { return invoke<void>("plugin_store_set_many", { pluginId, generation, entries }); }
export function pluginStoreDeleteMany(pluginId: string, generation: string, keys: string[]) { return invoke<void>("plugin_store_delete_many", { pluginId, generation, keys }); }
export function pluginStoreKeys(pluginId: string, prefix: string) { return invoke<string[]>("plugin_store_keys", { pluginId, prefix }); }
export function pluginStoreDeletePrefix(pluginId: string, generation: string, prefix: string) { return invoke<number>("plugin_store_delete_prefix", { pluginId, generation, prefix }); }

// Hive #7: Core resolver data, deliberately outside the plugin write API.
export interface ConflictDescriptor { originalId: string; copyId: string; fields: string[] }
export interface ConflictPair { original: PluginObject; copy: PluginObject; descriptor: ConflictDescriptor | null; originalStamp: string; copyStamp: string }
export function conflictDescriptors(): Promise<ConflictDescriptor[]> { return invoke("sync_conflict_descriptors"); }
export function conflictQueue(offset=0): Promise<{descriptor:ConflictDescriptor;title:string;copyTitle:string;createdAt:number}[]> { return invoke("sync_conflict_list",{offset}); }
export function conflictPair(copyId:string, originalId?:string): Promise<ConflictPair> { return invoke("sync_conflict_pair",{copyId,originalId}); }
export function resolveConflict(pair:ConflictPair,content:string): Promise<{original:PluginObject;undoToken:string;copyTrashed:boolean}> {
  return invoke<{original:PluginObject;undoToken:string;copyTrashed:boolean}>("sync_conflict_resolve",{request:{copyId:pair.copy.id,originalId:pair.original.id,originalStamp:pair.originalStamp,copyStamp:pair.copyStamp,content}})
    .then(r=>{notifyWorkspaceChanged();notifyObjectEvent("updated",r.original);return r;});
}
export function undoConflict(token:string): Promise<{original:PluginObject|null;copyRestored:boolean;keptNewer:boolean;copyMissing:boolean}> {
  return invoke<{original:PluginObject|null;copyRestored:boolean;keptNewer:boolean;copyMissing:boolean}>("sync_conflict_undo",{token}).then(r=>{notifyWorkspaceChanged();return r;});
}
