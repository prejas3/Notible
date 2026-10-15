import { invoke } from "@tauri-apps/api/core";
import type { LocalPluginFileReader } from "../core/extensions/loader";

export interface NObject {
  id: string;
  type: string;
  title: string;
  /** JSON string */
  content: string;
  /** JSON string */
  props: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  trashed_at: number | null;
}

export interface McpInfo {
  bundled: boolean;
  command: string;
  serverScript: string;
  databasePath: string;
  clientConfig: string;
}

export function getMcpInfo(): Promise<McpInfo> {
  return invoke("mcp_info");
}

export interface AiProviderStatus {
  provider: "codex" | "claude";
  installed: boolean;
  loggedIn: boolean;
  apiConfigured: boolean;
  executable: string | null;
  detail: string;
}

export function startAiProviderLogin(provider: "codex" | "claude"): Promise<string> {
  return invoke("ai_provider_login", { provider });
}

export function startAiProviderInstall(provider: "codex" | "claude"): Promise<string> {
  return invoke("ai_provider_install", { provider });
}

export function configureAiMcp(provider: "codex" | "claude"): Promise<string> {
  return invoke("ai_configure_mcp", { provider });
}

export function setAiApiKey(provider: "codex" | "claude", apiKey: string): Promise<string> {
  return invoke("ai_set_api_key", { provider, apiKey });
}

export function clearAiApiKey(provider: "codex" | "claude"): Promise<string> {
  return invoke("ai_clear_api_key", { provider });
}

export interface AiProposal {
  kind: "update" | "create";
  objectId: string | null;
  objectType: string | null;
  expectedUpdatedAt: number | null;
  title: string | null;
  content: string | null;
  props: Record<string, unknown> | null;
  parentId: string | null;
  reason: string;
}

export interface AiTurnResult { answer: string; proposals: AiProposal[] }

let aiStatusCache: { value: AiProviderStatus[]; expiresAt: number } | null = null;
let aiStatusRequest: Promise<AiProviderStatus[]> | null = null;

export async function getAiProviderStatus(force = false): Promise<AiProviderStatus[]> {
  if (!force && aiStatusCache && aiStatusCache.expiresAt > Date.now()) return aiStatusCache.value;
  if (aiStatusRequest) return aiStatusRequest;
  aiStatusRequest = invoke<AiProviderStatus[]>("ai_provider_status");
  try {
    const value = await aiStatusRequest;
    aiStatusCache = { value, expiresAt: Date.now() + 15_000 };
    return value;
  } finally {
    aiStatusRequest = null;
  }
}

export function runAiTurn(
  provider: "codex" | "claude",
  messages: { role: "user" | "assistant"; content: string }[],
  mode: "subscription" | "api" = "subscription",
): Promise<AiTurnResult> {
  return invoke("ai_run_turn", { request: { provider, messages, mode } });
}

export interface Relation {
  from_id: string;
  to_id: string;
  kind: string;
}

export interface TypeDef {
  name: string;
  /** JSON string */
  schema: string;
  icon: string | null;
  color: string | null;
}

export interface DataSourceRecord {
  id: string;
  name: string;
  /** JSON-encoded DataSourceDefinition. */
  definition: string;
  created_at: number;
  updated_at: number;
}

/** An object that references a target, flattened with the relation kind. */
export type Backlink = NObject & { kind: string };

export function createObject(
  type: string,
  title: string,
  content?: string,
  props?: string,
  parentId?: string,
): Promise<NObject> {
  return invoke("create_object", { type, title, content, props, parentId });
}

export function getObject(id: string): Promise<NObject | null> {
  return invoke("get_object", { id });
}

/** Partial atomic update. Pass expectedUpdatedAt for optimistic locking —
 * rejects with "conflict" if the object changed since that timestamp. */
export function updateObject(
  id: string,
  fields: { title?: string; content?: string; props?: string },
  expectedUpdatedAt?: number,
): Promise<NObject> {
  return invoke("update_object", { id, ...fields, expectedUpdatedAt });
}

/** Change an object's `type` in place (keeps title/content/props/relations). */
export function setObjectType(
  id: string,
  newType: string,
  expectedUpdatedAt?: number,
): Promise<NObject> {
  return invoke("set_object_type", { id, newType, expectedUpdatedAt });
}

export function trashObject(id: string): Promise<NObject | null> {
  return invoke("trash_object", { id });
}

export function restoreObject(id: string): Promise<NObject | null> {
  return invoke("restore_object", { id });
}

export function listTrash(): Promise<NObject[]> {
  return invoke("list_trash");
}

/** Hard delete: removes the object, its relations and its history. */
export function deleteObject(id: string): Promise<boolean> {
  return invoke("delete_object", { id });
}

export function listRootObjects(): Promise<NObject[]> {
  return invoke("list_root_objects");
}

/** Snapshot the SQLite DB into the backups dir; returns the backup path. */
export function backupDatabase(): Promise<string> {
  return invoke("backup_database");
}

/** Replace the complete workspace database with a validated local backup. */
export function restoreDatabase(backupPath: string): Promise<string> {
  return invoke("restore_database", { backupPath });
}

export interface BackupInfo {
  path: string;
  filename: string;
  size: number;
  modified_at: number;
}

/** All local backups, newest first. */
export function listBackups(): Promise<BackupInfo[]> {
  return invoke("list_backups");
}

/** The folder backups live in — drop a backup copied in from elsewhere here. */
export function backupsDirectory(): Promise<string> {
  return invoke("backups_directory");
}

export function deleteBackup(path: string): Promise<void> {
  return invoke("delete_backup", { path });
}

export interface HistoryEntry {
  id: number;
  ts: number;
  /** JSON snapshot {title, content, props} */
  patch: string;
}

export function listHistory(objectId: string, limit?: number): Promise<HistoryEntry[]> {
  return invoke("list_history", { objectId, limit });
}

/** Restore the snapshot with the given history id; the restore is itself undoable. */
export function restoreVersion(objectId: string, versionId: number): Promise<NObject> {
  return invoke("restore_version", { objectId, versionId });
}

/** Write export content into app_data/exports/<filename>; returns the path. */
export function writeExport(filename: string, content: string): Promise<string> {
  return invoke("write_export", { filename, content });
}

/** Write base64-decoded bytes into app_data/exports/<filename>; returns the path. */
export function saveExportBinary(filename: string, dataBase64: string): Promise<string> {
  return invoke("save_export_binary", { filename, dataBase64 });
}

/** Like saveExportBinary, but through a native "Save As" dialog — the user
 *  picks the folder and file name. Resolves to null on cancel. */
export function saveExportBinaryAs(filename: string, dataBase64: string): Promise<string | null> {
  return invoke("save_export_binary_as", { filename, dataBase64 });
}

export function writeXlsx(filename: string, headers: string[], rows: string[][]): Promise<string> {
  return invoke("write_xlsx", { filename, headers, rows });
}

/** Save a base64-encoded image into app_data/media; returns the absolute path. */
export function saveMedia(dataBase64: string, ext: string): Promise<string> {
  return invoke("save_media", { dataBase64, ext });
}

/** Import a Markdown file from disk as a new note. */
export function importMarkdown(path: string, parentId?: string): Promise<NObject> {
  return invoke("import_markdown", { path, parentId });
}

export function importDelimited(path: string, parentId?: string): Promise<NObject[]> {
  return invoke("import_delimited", { path, parentId });
}

export interface TabularPreview {
  headers: string[];
  rows: string[][];
  total_rows: number;
  truncated: boolean;
}

export interface ImportColumnMapping {
  source_index: number;
  target: string;
}

export function previewTabular(path: string): Promise<TabularPreview> {
  return invoke("preview_tabular", { path });
}

export function importMappedTabular(
  path: string,
  parentId: string | undefined,
  objectType: string,
  mapping: ImportColumnMapping[],
): Promise<NObject[]> {
  return invoke("import_mapped_tabular", { path, parentId, objectType, mapping });
}

export function importFinanceFile(path: string, parentId: string): Promise<NObject[]> {
  return invoke("import_finance_file", { path, parentId });
}

/** Update with optimistic locking against `expectedUpdatedAt`.
 * A conflict is intentionally surfaced to the caller. Retrying against a
 * freshly fetched timestamp would silently overwrite another window's edit. */
export async function updateObjectSafe(
  id: string,
  fields: { title?: string; content?: string; props?: string },
  expectedUpdatedAt: number,
): Promise<NObject> {
  return updateObject(id, fields, expectedUpdatedAt);
}

export function archiveObject(id: string): Promise<NObject | null> {
  return invoke("archive_object", { id });
}

export function listObjects(
  type?: string,
  limit?: number,
  offset?: number,
): Promise<NObject[]> {
  return invoke("list_objects", { type, limit, offset });
}

export function searchObjects(query: string, limit?: number): Promise<NObject[]> {
  return invoke("search_objects", { query, limit });
}

export function createRelation(
  fromId: string,
  toId: string,
  kind: string,
): Promise<Relation> {
  return invoke("create_relation", { fromId, toId, kind });
}

export function deleteRelation(
  fromId: string,
  toId: string,
  kind: string,
): Promise<boolean> {
  return invoke("delete_relation", { fromId, toId, kind });
}

export function listRelations(objectId: string): Promise<Relation[]> {
  return invoke("list_relations", { objectId });
}

export type GanttDependencyKind = "gantt_fs" | "gantt_ss" | "gantt_ff" | "blocks";

/** Planning dependencies always point from predecessor to successor. */
export function createGanttDependency(
  predecessorId: string,
  successorId: string,
  kind: GanttDependencyKind,
): Promise<Relation> {
  return invoke("create_gantt_dependency", { predecessorId, successorId, kind });
}

export function deleteGanttDependency(
  predecessorId: string,
  successorId: string,
  kind: GanttDependencyKind,
): Promise<boolean> {
  return invoke("delete_gantt_dependency", { predecessorId, successorId, kind });
}

export function queryObjects(opts: {
  parentId?: string;
  type?: string;
  tag?: string;
  includeArchived?: boolean;
  limit?: number;
} = {}): Promise<NObject[]> {
  return invoke("query_objects", {
    parentId: opts.parentId,
    type: opts.type,
    tag: opts.tag,
    includeArchived: opts.includeArchived,
    limit: opts.limit,
  });
}

export function listDataSources(): Promise<DataSourceRecord[]> {
  return invoke("list_data_sources");
}

export function upsertDataSource(
  name: string,
  definition: string,
  id?: string,
): Promise<DataSourceRecord> {
  return invoke("upsert_data_source", { id, name, definition });
}

export function deleteDataSource(id: string): Promise<boolean> {
  return invoke("delete_data_source", { id });
}

export function moveObject(
  id: string,
  newParentId: string | null,
): Promise<void> {
  return invoke("move_object", { id, newParentId });
}

export function listTypes(): Promise<TypeDef[]> {
  return invoke("list_types");
}

export function upsertType(
  name: string,
  schema: string,
  icon?: string,
  color?: string,
): Promise<TypeDef> {
  return invoke("upsert_type", { name, schema, icon, color });
}

export function getBacklinks(id: string): Promise<Backlink[]> {
  return invoke("get_backlinks", { id });
}

export function setTags(id: string, tags: string[]): Promise<NObject | null> {
  return invoke("set_tags", { id, tags });
}

export function listAllTags(): Promise<string[]> {
  return invoke("list_all_tags");
}

export interface IntegrationEvent {
  id: number;
  event: "object.created" | "object.updated" | "object.deleted";
  object_id: string;
  object_type: string;
  occurred_at: number;
  payload: string;
}

export function listIntegrationEvents(after = 0, limit = 100): Promise<IntegrationEvent[]> {
  return invoke("list_integration_events", { after, limit });
}

// --- Linked folders (read-only PC file access) ---

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

export interface DirTree {
  root: string;
  children: FileNode[];
  truncated: boolean;
}

export interface FilePreview {
  kind: "text" | "image" | "binary";
  content: string;
  truncated: boolean;
  size: number;
  ext: string;
}

/** Open the native folder picker; resolves to null when cancelled. */
export function pickFolder(): Promise<string | null> {
  return invoke("pick_folder");
}

/** Open the native picker for a local plugin ZIP package. */
export function pickFile(): Promise<string | null> {
  return invoke("pick_file");
}

export interface ExtractedPlugin {
  plugin_id: string;
  version: string;
  install_path: string;
  manifest: string;
}

export function extractPluginZip(path: string): Promise<ExtractedPlugin> {
  return invoke("extract_plugin_zip", { path });
}

export function hashPluginPackage(path: string): Promise<string> {
  return invoke("hash_plugin_package", { path });
}

/** Recursive listing of a linked folder (skips node_modules/.git/etc., capped). */
export function readDirTree(path: string, maxDepth?: number): Promise<DirTree> {
  return invoke("read_dir_tree", { path, maxDepth });
}

/**
 * Read-only preview of a file. Containment is decided in Rust against the
 * folders the user actually picked — the caller no longer supplies the root,
 * because a caller-supplied root made the check compare two attacker-chosen
 * values and pass unconditionally.
 */
export function readFilePreview(path: string, maxBytes?: number): Promise<FilePreview> {
  return invoke("read_file_preview", { path, maxBytes });
}

/** Local-only file reader used by the plugin directory loader. */
export const localPluginFileReader: LocalPluginFileReader = {
  async readText(_root, path) {
    const preview = await readFilePreview(path, 2 * 1024 * 1024);
    if (preview.kind !== "text" || preview.truncated) throw new Error(`plugin file is not a complete text file: ${path}`);
    return preview.content;
  },
};

export type PluginRegistryState = "active" | "disabled" | "failed" | "installed";

export interface PluginRegistryEntry {
  plugin_id: string;
  version: string;
  source: "builtin" | "local-file" | "package";
  install_path: string;
  manifest: string;
  /** Rust checked an Ed25519 signature against the embedded key set. */
  verified: boolean;
  /** The user accepted the install warning for these exact bytes. */
  user_trusted: boolean;
  state: PluginRegistryState;
  last_error: string | null;
  installed_at: number;
  updated_at: number;
}

const PLUGIN_REGISTRY_FALLBACK_KEY = "notible.plugin-registry.preview.v1";

export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function readPreviewPluginRegistry(): PluginRegistryEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(PLUGIN_REGISTRY_FALLBACK_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed as PluginRegistryEntry[] : [];
  } catch {
    return [];
  }
}

function writePreviewPluginRegistry(entries: PluginRegistryEntry[]): void {
  localStorage.setItem(PLUGIN_REGISTRY_FALLBACK_KEY, JSON.stringify(entries));
}

export async function listPluginRegistry(): Promise<PluginRegistryEntry[]> {
  if (isDesktopRuntime()) return invoke("list_plugin_registry");
  return readPreviewPluginRegistry();
}

export async function upsertPluginRegistry(
  entry: Pick<PluginRegistryEntry, "plugin_id" | "version" | "source" | "install_path" | "manifest" | "verified">,
): Promise<PluginRegistryEntry> {
  if (isDesktopRuntime()) {
    return invoke("upsert_plugin_registry", {
      pluginId: entry.plugin_id,
      version: entry.version,
      source: entry.source,
      installPath: entry.install_path,
      manifest: entry.manifest,
      verified: entry.verified,
    });
  }
  const entries = readPreviewPluginRegistry();
  const now = Date.now();
  const current = entries.find((candidate) => candidate.plugin_id === entry.plugin_id && candidate.version === entry.version);
  const next: PluginRegistryEntry = {
    ...entry,
    // Browser-preview fallback only. Trust is never granted here: the real
    // writer is `grant_plugin_trust`, which shows a native dialog first.
    user_trusted: false,
    state: current?.state ?? "disabled",
    last_error: current?.last_error ?? null,
    installed_at: current?.installed_at ?? now,
    updated_at: now,
  };
  writePreviewPluginRegistry([...entries.filter((candidate) => candidate.plugin_id !== entry.plugin_id || candidate.version !== entry.version), next]);
  return next;
}

export async function setPluginRegistryState(
  pluginId: string,
  version: string,
  state: PluginRegistryState,
  lastError: string | null = null,
): Promise<PluginRegistryEntry> {
  if (isDesktopRuntime()) {
    return invoke("set_plugin_registry_state", { pluginId, version, pluginState: state, lastError });
  }
  const entries = readPreviewPluginRegistry();
  const target = entries.find((candidate) => candidate.plugin_id === pluginId && candidate.version === version);
  if (!target) throw new Error(`plugin is not registered: ${pluginId}@${version}`);
  const now = Date.now();
  const next = entries.map((candidate) => {
    if (candidate.plugin_id !== pluginId) return candidate;
    if (candidate.version === version) return { ...candidate, state, last_error: lastError, updated_at: now };
    return state === "active" && candidate.state === "active" ? { ...candidate, state: "disabled" as const, updated_at: now } : candidate;
  });
  writePreviewPluginRegistry(next);
  return next.find((candidate) => candidate.plugin_id === pluginId && candidate.version === version)!;
}

export async function removePluginRegistry(pluginId: string, version?: string): Promise<number> {
  if (isDesktopRuntime()) return invoke("remove_plugin_registry", { pluginId, version });
  const entries = readPreviewPluginRegistry();
  const remaining = entries.filter((candidate) => candidate.plugin_id !== pluginId || (version !== undefined && candidate.version !== version));
  writePreviewPluginRegistry(remaining);
  return entries.length - remaining.length;
}

/** See the note on the same pair in core-data-api.ts: the updater's own JS
 * commands take `proxy` and `allowDowngrades` from the caller, so they are
 * off in the capability file and updates go through Rust. */
export function checkForUpdate(): Promise<string | null> {
  return invoke("update_check");
}

export function installUpdate(): Promise<void> {
  return invoke("update_install");
}
