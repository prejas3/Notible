import type {
  CodeBlockRegistration,
  CommandRegistration,
  Disposable,
  ExtensionSnapshot,
  NotiblePlugin,
  OauthApi,
  PluginContext,
  DataApi,
  PluginEvents,
  PluginErrorPhase,
  PluginManifest,
  PluginPermission,
  PluginRuntimeError,
  PluginPermissions,
  PluginStorage,
  PluginStore,
  SettingsRegistration,
  SlotRegistration,
  ObjectTabRegistration,
  ViewRegistration,
  UiApi,
  ProseMatch,
  ProseProfile,
  HelpTopic,
} from "./types";
import { buildHelpTopics, type KnowledgePage, type KnowledgePlugin } from "./help-topics.ts";
import { validatePluginManifest } from "./manifest.ts";
import { createPluginStore } from "./plugin-store.ts";
import { pluginGoogleAccessToken, pluginGoogleLogin, pluginGoogleRevoke, pluginShowNotification } from "../data/core-data-api.ts";
import { OBJECT_TAB_TYPES, UI_SLOTS } from "../../../packages/plugin-api/src/index.ts";

type RegistrationKind = "command" | "view" | "settings" | "slot" | "codeBlock" | "object-tab" | "proseProfile";
type HostChangeListener = () => void;
type HostErrorListener = (error: PluginRuntimeError) => void;

/** Built-in object type names a plugin's prose profile may not claim. Also
 * reused by Task 4's editor-side resolution. Module scope so a test can
 * import it rather than re-list it. */
export const BUILTIN_TYPE_NAMES = new Set(["note", "folder", "project", "space", "whiteboard", "table", "dashboard", "habit", "notification"]);

/** A registered prose profile. `id` is derived deterministically from the
 * match so a second registration for the same type/prop key collides. */
export interface ProseProfileRegistration {
  id: string;
  match: ProseMatch;
  profile: ProseProfile;
}

/** Floor for `context.scheduler.every`'s interval — see PluginScheduler in
 * the public contract for why this exists. Exported so a test can assert
 * against it directly rather than hardcoding it a second time. */
export const MIN_SCHEDULER_INTERVAL_MS = 60_000;

interface RegistrationRecord {
  pluginId: string;
  kind: RegistrationKind;
  id: string;
  slot?: string;
  value: CommandRegistration | ViewRegistration | SettingsRegistration | SlotRegistration | CodeBlockRegistration | ObjectTabRegistration | ProseProfileRegistration;
}

function namespacedId(pluginId: string, id: string) {
  const localId = id.trim();
  if (!localId) throw new Error(`Empty registration id for plugin ${pluginId}`);
  return `${pluginId}:${localId}`;
}

class MemoryPluginStorage implements PluginStorage {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | null {
    return this.values.has(key) ? (this.values.get(key) as T) : null;
  }

  set<T>(key: string, value: T) {
    this.values.set(key, value);
  }

  delete(key: string) {
    this.values.delete(key);
  }

  keys() {
    return [...this.values.keys()].sort();
  }
}

/** Longer than any honest onload (Sync may touch the network there); see enable(). */
const PLUGIN_ONLOAD_TIMEOUT_MS = 30_000;
const STORAGE_PREFIX = "notible.plugin-storage.";
/** Cannot occur in a plugin id, so no id can be a prefix of another. */
const SEPARATOR = String.fromCharCode(0);

/**
 * Plugin storage that survives a restart.
 *
 * `PluginStorage` is synchronous by contract, so this cannot be an `invoke`
 * into SQLite without a write-behind cache. localStorage is synchronous,
 * persistent and per-origin, which is the shape the contract already asks
 * for.
 *
 * ponytail: localStorage means plugin data is NOT in the workspace database
 * backup. Move to a write-behind SQLite table if a plugin ever stores
 * something a user would mind losing on a profile reset.
 */
class LocalPluginStorage implements PluginStorage {
  private readonly prefix: string;

  constructor(pluginId: string) {
    // The separator must be something a plugin id cannot contain, and ids may
    // contain dots. With a dot, `dataview` is a strict prefix of
    // `dataview.tasks`, so `keys()` listed the other plugin's keys and
    // `get`/`set` reached straight into them — through the *mediated* API,
    // which is the part that is supposed to be scoped. U+0000 cannot appear
    // in an id.
    this.prefix = `${STORAGE_PREFIX}${pluginId}${SEPARATOR}`;
  }

  get<T>(key: string): T | null {
    const raw = localStorage.getItem(this.prefix + key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A value written by an older version, or hand-edited. Losing one key
      // is better than throwing inside a plugin's onload.
      return null;
    }
  }

  set<T>(key: string, value: T) {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch {
      // Quota, or a value with a cycle in it. A failed write must not take
      // the plugin down with it.
    }
  }

  delete(key: string) {
    localStorage.removeItem(this.prefix + key);
  }

  keys() {
    const found: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(this.prefix)) found.push(key.slice(this.prefix.length));
    }
    return found.sort();
  }

  clear() {
    for (const key of this.keys()) this.delete(key);
  }
}

/**
 * Persistent storage in the app, in-memory in the headless check scripts —
 * which run in plain Node and have no localStorage.
 */
function createPluginStorage(pluginId: string): PluginStorage {
  return typeof localStorage === "undefined" ? new MemoryPluginStorage() : new LocalPluginStorage(pluginId);
}

class EventBus implements PluginEvents {
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  on<T>(event: string, handler: (payload: T) => void): Disposable {
    const set = this.handlers.get(event) ?? new Set<(payload: unknown) => void>();
    set.add(handler as (payload: unknown) => void);
    this.handlers.set(event, set);
    return {
      dispose: () => {
        set.delete(handler as (payload: unknown) => void);
        if (set.size === 0) this.handlers.delete(event);
      },
    };
  }

  emit<T>(event: string, payload: T) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

/**
 * What Core plugs into the host so `context.help` knows more than the enabled
 * plugins (API 1.22). The host only holds plugins that are on — `disable()`
 * forgets them — so the built-in catalogue, installed-but-off plugins and the
 * Help pages have to come from the shell.
 */
export interface KnowledgeProvider {
  pages(): KnowledgePage[];
  plugins(): KnowledgePlugin[];
}

/** Gap between two plugin-driven navigations (openHelp/openPluginSettings). */
export const PLUGIN_NAVIGATION_GAP_MS = 1_000;
/** How recent "the user just clicked this plugin" must be. */
export const PLUGIN_GESTURE_WINDOW_MS = 1_000;

/**
 * SYNC-NOTICE fix (Hive #16, F1): a notice's action button runs its plugin's
 * callback only for real input. Plugins share one document, so another plugin
 * can `button.click()`; that click is untrusted and must neither dismiss the
 * notice nor run the callback. A real pointer click and Enter/Space on the
 * focused button both arrive as trusted clicks.
 */
export function activateNoticeAction(event: { isTrusted: boolean }, dismiss: () => void, onSelect: () => unknown): boolean {
  if (!event.isTrusted) return false;
  dismiss();
  const warn = (error: unknown) => console.warn("[notible] notice action failed", error);
  try { void Promise.resolve(onSelect()).catch(warn); } catch (error) { warn(error); }
  return true;
}

/** What Core plugs into the host so `context.i18n` has something to resolve. */
export interface HostTranslator {
  /** `own`: the plugin's bundled translations (manifest.locales), by language. */
  translate(namespace: string, key: string, values?: Record<string, string | number>, own?: Record<string, Record<string, string>>): string;
  readonly locale: string;
}

export class ExtensionHost {
  private readonly plugins = new Map<string, NotiblePlugin>();
  private readonly records = new Map<string, RegistrationRecord>();
  private readonly pluginRecords = new Map<string, Set<string>>();
  private readonly pluginDisposables = new Map<string, Set<Disposable>>();
  // Namespaced object types each plugin has registered via `data.types.upsert`
  // this session. `data.types.upsert` is a DataApi call, not a `register()`
  // record, so it leaves no snapshot trace of its own — Core needs this to
  // tell "a type an enabled plugin provides" from "a type row that outlived
  // its plugin in the DB" (disabling a plugin never deletes its `types` rows).
  private readonly pluginTypes = new Map<string, Set<string>>();
  private readonly storage = new Map<string, PluginStorage>();
  private readonly stores = new Map<string, PluginStore>(); // STORE-API (Hive #5)
  private readonly events = new EventBus();
  private readonly changeListeners = new Set<HostChangeListener>();
  /** Registrations made while onload is running are published by enable()'s
   * single final notification; later registrations are microtask-batched. */
  private readonly loadingPlugins = new Set<string>();
  private changeNotificationQueued = false;
  private readonly errorListeners = new Set<HostErrorListener>();
  private readonly dataApi: DataApi;
  private readonly contexts = new Map<string, PluginContext>();
  private snapshotCache: ExtensionSnapshot[] | null = null;
  private overlays: CoreOverlayApi = unavailableUiApi;
  /**
   * How a plugin's `context.i18n` resolves. Core installs the real one; the
   * default returns the key, so a host with no translation layer (the test
   * harness) still renders readable English rather than blanks.
   */
  private translator: HostTranslator = { translate: (_namespace, key) => key, locale: "en-GB" };
  private knowledge: KnowledgeProvider = { pages: () => [], plugins: () => [] };
  /** Each plugin's bundled translations (manifest.locales), read from its package. */
  private readonly pluginLocales = new Map<string, Record<string, Record<string, string>>>();
  /** Plugins whose last enable() threw — `HelpTopic.state` "failed". */
  private readonly failedLoads = new Set<string>();
  private readonly knowledgeListeners = new Set<() => void>();
  private topicsCache: HelpTopic[] | null = null;
  private readonly lastNavigation = new Map<string, number>();
  /** When each plugin's command last ran (a hotkey, the / menu, a + entry). */
  private readonly lastCommandRun = new Map<string, number>();
  /** The last real click or key press, and the plugin whose UI it landed in. */
  private lastInput: { at: number; pluginId: string | null } = { at: -Infinity, pluginId: null };
  private inputTracked = false;
  /**
   * "Did the user just ask THIS plugin for something?" — a click or key press
   * inside its own UI (every mount Core makes carries `data-plugin`), or one
   * of its commands, within the last second. Browser user activation alone is
   * not enough: it stays live for seconds after a click anywhere, so a plugin
   * could navigate right after the user clicked something unrelated. A seam
   * so the Node checks, which have no DOM, can drive the gated calls.
   */
  private hasUserGesture: (pluginId: string) => boolean = (pluginId) => {
    const now = Date.now();
    if (now - (this.lastCommandRun.get(pluginId) ?? -Infinity) < PLUGIN_GESTURE_WINDOW_MS) return true;
    return this.lastInput.pluginId === pluginId && now - this.lastInput.at < PLUGIN_GESTURE_WINDOW_MS;
  };

  /** Installed once, in a host with a DOM: remembers where the last real input went. */
  private trackUserInput() {
    if (this.inputTracked || typeof document === "undefined") return;
    this.inputTracked = true;
    const record = (event: Event) => {
      if (!event.isTrusted) return;
      const owner = event.target instanceof Element ? event.target.closest("[data-plugin]") : null;
      this.lastInput = { at: Date.now(), pluginId: owner?.getAttribute("data-plugin") ?? null };
    };
    document.addEventListener("pointerdown", record, true);
    document.addEventListener("keydown", record, true);
  }

  constructor(dataApi?: DataApi, overlays?: CoreOverlayApi) {
    this.dataApi = dataApi ?? unavailableDataApi;
    if (overlays) this.overlays = overlays;
    this.trackUserInput();
  }

  /**
   * Core installs the real overlay implementation once its shell has mounted.
   * The host itself owns no DOM, so notices, modals and menus have to come
   * from the app — but they belong on `PluginContext`, so the indirection
   * lives here rather than leaking a Core import into the contract.
   */
  setTranslator(translator: HostTranslator) {
    this.translator = translator;
  }

  setOverlayApi(overlays: CoreOverlayApi) {
    this.overlays = overlays;
  }

  /** API 1.22. Core installs this once; see `KnowledgeProvider`. */
  setKnowledgeProvider(provider: KnowledgeProvider) {
    this.knowledge = provider;
    this.notifyKnowledgeChanged();
  }

  /** The shell's catalogue changed (installed, removed) — re-read it on next `topics()`. */
  notifyKnowledgeChanged() {
    this.topicsCache = null;
    for (const listener of this.knowledgeListeners) {
      try { listener(); } catch { /* one plugin's listener must not stop the rest */ }
    }
  }

  /** The package loader hands over a plugin's own translations before enabling it. */
  setPluginLocales(pluginId: string, locales: Record<string, Record<string, string>> | undefined) {
    if (locales && Object.keys(locales).length > 0) this.pluginLocales.set(pluginId, locales);
    else this.pluginLocales.delete(pluginId);
  }

  /** Test seam for the gesture gate on openHelp / openPluginSettings. */
  setUserGestureCheck(check: (pluginId: string) => boolean) {
    this.hasUserGesture = check;
  }

  /** What every plugin's `context.help.topics()` returns: built once per change. */
  helpTopics(): HelpTopic[] {
    this.topicsCache ??= buildHelpTopics(this.knowledge.pages(), this.knowledge.plugins(), (id) =>
      this.plugins.has(id) ? "enabled" : this.failedLoads.has(id) ? "failed" : "disabled");
    return this.topicsCache;
  }

  /**
   * Gate for a plugin moving the user somewhere: only inside a click or key
   * press, and not twice within a second. Without it a plugin could open
   * Settings → Plugins under the user's cursor so their next click lands on a
   * switch they never meant to touch (security review, 01.10).
   */
  private requireUserNavigation(pluginId: string, what: string) {
    if (!this.hasUserGesture(pluginId)) throw new Error(`${what} only works right after the user clicks or presses a key in this plugin`);
    const now = Date.now();
    if (now - (this.lastNavigation.get(pluginId) ?? -Infinity) < PLUGIN_NAVIGATION_GAP_MS) throw new Error(`${what} was called again too soon`);
    this.lastNavigation.set(pluginId, now);
  }

  private requireUserGesture(pluginId: string, what: string) {
    if (!this.hasUserGesture(pluginId)) throw new Error(`${what} only works right after the user clicks or presses a key in this plugin`);
  }

  /**
   * The live context of an enabled plugin. Core needs it to build a
   * `ViewMountContext` when it renders that plugin's UI; nothing outside
   * Core's own rendering should reach for this.
   */
  getPluginContext(pluginId: string): PluginContext | null {
    return this.contexts.get(pluginId) ?? null;
  }

  onChange(listener: HostChangeListener): Disposable {
    this.changeListeners.add(listener);
    return { dispose: () => this.changeListeners.delete(listener) };
  }

  onError(listener: HostErrorListener): Disposable {
    this.errorListeners.add(listener);
    return { dispose: () => this.errorListeners.delete(listener) };
  }

  async enable(plugin: NotiblePlugin): Promise<void> {
    validatePluginManifest(plugin.manifest);
    if (this.plugins.has(plugin.manifest.id)) {
      throw new Error(`Plugin already enabled: ${plugin.manifest.id}`);
    }
    const missingDependencies = Object.keys(plugin.manifest.dependencies ?? {}).filter((id) => !this.plugins.has(id));
    if (missingDependencies.length > 0) {
      throw new Error(`Plugin ${plugin.manifest.id} requires ${missingDependencies.join(", ")} to be enabled first`);
    }

    const pluginId = plugin.manifest.id;
    const recordIds = new Set<string>();
    const disposables = new Set<Disposable>();
    this.pluginRecords.set(pluginId, recordIds);
    this.pluginDisposables.set(pluginId, disposables);
    const context = this.contextFor(plugin.manifest, recordIds, disposables);
    this.contexts.set(pluginId, context);
    this.loadingPlugins.add(pluginId);
    try {
      // Plugins load one after another, so an onload that never settles would
      // hold back every plugin queued behind it. Give up on it instead; if it
      // finishes later, undo what it registered unless it was enabled again.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const loading = Promise.resolve(plugin.onload(context));
      await Promise.race([
        loading,
        new Promise<never>((_, reject) => { timer = setTimeout(() => {
          void loading.then(() => {
            if (this.pluginRecords.has(pluginId)) return;
            for (const id of recordIds) this.records.delete(id);
            for (const disposable of disposables) disposable.dispose();
            this.invalidateSnapshot();
            this.notifyChanged();
          }, () => {});
          reject(new Error(`Plugin ${pluginId} did not finish loading within ${PLUGIN_ONLOAD_TIMEOUT_MS / 1000} s`));
        }, PLUGIN_ONLOAD_TIMEOUT_MS); }),
      ]).finally(() => clearTimeout(timer));
      this.loadingPlugins.delete(pluginId);
      this.plugins.set(pluginId, plugin);
      this.failedLoads.delete(pluginId);
      this.notifyChanged();
      this.notifyKnowledgeChanged();
    } catch (error) {
      this.loadingPlugins.delete(pluginId);
      this.reportError(plugin.manifest, "load", error);
      this.removeRecords(pluginId);
      this.failedLoads.add(pluginId);
      this.notifyKnowledgeChanged();
      throw error;
    }
  }

  async disable(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    const dependents = [...this.plugins.values()].filter((candidate) => candidate.manifest.id !== pluginId && pluginId in (candidate.manifest.dependencies ?? {}));
    if (dependents.length > 0) {
      throw new Error(`Cannot disable ${pluginId}: required by ${dependents.map((candidate) => candidate.manifest.id).join(", ")}`);
    }
    try {
      await plugin.onunload?.();
    } catch (error) {
      this.reportError(plugin.manifest, "unload", error);
      throw error;
    } finally {
      this.removeRecords(pluginId);
      this.plugins.delete(pluginId);
      this.notifyChanged();
      this.notifyKnowledgeChanged();
    }
    return true;
  }

  /**
   * Replace one active version and restore the previous instance if the new
   * lifecycle fails. File staging and signature verification belong to the
   * future update manager; this method protects the in-memory activation step.
   */
  async replace(plugin: NotiblePlugin): Promise<{ replaced: boolean; rolledBack: boolean }> {
    const previous = this.plugins.get(plugin.manifest.id);
    if (!previous) {
      await this.enable(plugin);
      return { replaced: false, rolledBack: false };
    }

    let unloadError: unknown;
    try {
      await this.disable(plugin.manifest.id);
    } catch (error) {
      unloadError = error;
    }
    if (unloadError) {
      await this.enable(previous);
      throw unloadError;
    }

    try {
      await this.enable(plugin);
      return { replaced: true, rolledBack: false };
    } catch (error) {
      try {
        await this.enable(previous);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Plugin replacement failed and rollback failed: ${plugin.manifest.id}`);
      }
      return { replaced: false, rolledBack: true };
    }
  }

  /**
   * The snapshot is cached and only rebuilt when registrations actually
   * change.
   *
   * This is not an optimisation. `useSyncExternalStore` compares what
   * `getSnapshot` returns with `Object.is` on every render, so returning a
   * freshly-built array each time reads as "the store changed" and loops
   * render → getSnapshot → render until React throws "Maximum update depth
   * exceeded" (#185). Any caller that subscribes to this needs a stable
   * reference between changes, so the stability lives here rather than in
   * each caller.
   */
  /**
   * While Notible is the window in front, a plugin's notification is shown inside it (a notice,
   * with the chosen sound) instead of as a Windows notification on top of it (SND1). Core sets it.
   */
  private inAppNotice: ((text: string) => void) | null = null;
  setInAppNotice(handler: ((text: string) => void) | null) {
    this.inAppNotice = handler;
  }

  getSnapshot(pluginId?: string): ExtensionSnapshot[] {
    if (pluginId === undefined && this.snapshotCache) return this.snapshotCache;
    const snapshot = this.buildSnapshot(pluginId);
    if (pluginId === undefined) this.snapshotCache = snapshot;
    return snapshot;
  }

  private invalidateSnapshot() {
    this.snapshotCache = null;
  }

  private buildSnapshot(pluginId?: string): ExtensionSnapshot[] {
    // Asking about one plugin used to return an entry unconditionally, so a
    // disabled or never-installed id came back as a phantom snapshot with
    // empty command/view/slot arrays instead of nothing at all.
    const ids = pluginId
      ? (this.plugins.has(pluginId) ? [pluginId] : [])
      : [...this.plugins.keys()].sort();
    return ids.map((id) => {
      const records = [...this.records.values()].filter((record) => record.pluginId === id);
      const slots: Record<string, SlotRegistration[]> = {};
      for (const record of records) {
        if (record.kind === "slot" && record.slot) {
          const values = slots[record.slot] ?? [];
          values.push(record.value as SlotRegistration);
          slots[record.slot] = values;
        }
      }
      return {
        pluginId: id,
        commands: records.filter((record) => record.kind === "command").map((record) => record.value as CommandRegistration),
        views: records.filter((record) => record.kind === "view").map((record) => record.value as ViewRegistration),
        settings: records.filter((record) => record.kind === "settings").map((record) => record.value as SettingsRegistration),
        slots,
        codeBlocks: records.filter((record) => record.kind === "codeBlock").map((record) => record.value as CodeBlockRegistration),
        objectTabs: records.filter((record) => record.kind === "object-tab").map((record) => record.value as unknown as ObjectTabRegistration),
        providedTypes: [...(this.pluginTypes.get(id) ?? [])].sort(),
        proseProfiles: records.filter((record) => record.kind === "proseProfile").map((record) => {
          const value = record.value as ProseProfileRegistration;
          return {
            pluginId: record.pluginId,
            pluginName: this.plugins.get(record.pluginId)?.manifest.name ?? record.pluginId,
            match: value.match,
            profile: value.profile,
          };
        }),
      };
    });
  }

  emit<T>(event: string, payload: T) {
    this.events.emit(event, payload);
  }

  private notifyChanged() {
    this.invalidateSnapshot();
    for (const listener of this.changeListeners) listener();
  }

  /** Publish registrations made after onload without rendering once per call. */
  private scheduleChanged() {
    this.invalidateSnapshot();
    if (this.changeNotificationQueued) return;
    this.changeNotificationQueued = true;
    queueMicrotask(() => {
      this.changeNotificationQueued = false;
      this.notifyChanged();
    });
  }

  private reportError(manifest: PluginManifest, phase: PluginErrorPhase, cause: unknown) {
    const error: PluginRuntimeError = {
      pluginId: manifest.id,
      version: manifest.version,
      phase,
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    };
    for (const listener of this.errorListeners) listener(error);
  }

  private contextFor(manifest: PluginManifest, recordIds: Set<string>, disposables: Set<Disposable>): PluginContext {
    const permissions = scopedPermissions(manifest);
    const register = <T extends CommandRegistration | ViewRegistration | SettingsRegistration | SlotRegistration | CodeBlockRegistration | ObjectTabRegistration | ProseProfileRegistration>(
      kind: RegistrationKind,
      value: T,
      slot?: string,
    ): Disposable => {
      // Only registrations that actually mount UI need the workspace.ui
      // permission; a plugin that registers only headless commands must not
      // be forced to declare it (see C8 in the 2026-08-08 bug audit).
      if (kind === "codeBlock" || kind === "proseProfile") permissions.require("editor.extension");
      else if (kind !== "command") permissions.require("workspace.ui");
      // An unknown slot name is reported and skipped, not thrown. Throwing
      // happens inside onload, which fails the *whole* plugin — so a package
      // that registers five good slots and one stale name would vanish
      // entirely. Core renders nothing for the unknown name either way.
      if (kind === "slot" && slot !== undefined && !(UI_SLOTS as readonly string[]).includes(slot)) {
        this.reportError(manifest, "load", new Error(`unknown UI slot "${slot}"; known slots are ${UI_SLOTS.join(", ")}`));
        return { dispose: () => {} };
      }
      // Same treatment for an object tab asking for a type Core never mounts a
      // container surface for: report and skip. Without this the tab is simply
      // invisible for ever, with nothing anywhere saying why.
      if (kind === "object-tab") {
        const tab = value as ObjectTabRegistration;
        // A namespaced type (`plugin.ns.type`) exists only because a plugin
        // registered it with `behaviour.container` in its schema, and Core
        // mounts a container surface for every such type (see `containerTypes`
        // in CoreOnlyApp). Bare names stay whitelisted to OBJECT_TAB_TYPES so a
        // plain typo like "task" is still reported rather than silently lost.
        const unsupported = (tab.objectTypes ?? []).filter((type: string) => !(OBJECT_TAB_TYPES as readonly string[]).includes(type) && !type.includes("."));
        if (unsupported.length > 0 || (tab.objectTypes ?? []).length === 0) {
          this.reportError(manifest, "load", new Error(`object tab "${tab.id}": unsupported object type(s) ${unsupported.join(", ") || "(none given)"}; supported types are ${OBJECT_TAB_TYPES.join(", ")} or a plugin's own namespaced container type`));
          return { dispose: () => {} };
        }
        // Clamped, not rejected: `order` is a number from the plugin, and
        // without this `order: -999999` puts a third-party tab first, which
        // means it is the one that opens by default on a project screen.
        value = { ...tab, order: Math.min(100, Math.max(0, Math.trunc(tab.order ?? 50))) } as T;
      }
      // Registration ids share one namespace across kinds, so a plugin whose
      // tab names the view it mounts ("canvas" + "canvas") would collide with
      // itself. Tabs get their own prefix rather than a rule telling authors
      // to invent a second name for the same thing.
      const id = namespacedId(manifest.id, kind === "object-tab" ? `tab:${value.id}` : value.id);
      if (this.records.has(id)) throw new Error(`Duplicate registration: ${id}`);
      const registration = kind === "command"
        ? {
            ...value,
            execute: (input?: unknown) => {
              this.lastCommandRun.set(manifest.id, Date.now());
              try {
                const result = (value as CommandRegistration).execute(input);
                return result instanceof Promise
                  ? result.catch((error) => {
                      this.reportError(manifest, "command", error);
                      throw error;
                    })
                  : result;
              } catch (error) {
                this.reportError(manifest, "command", error);
                throw error;
              }
            },
          } as T
        : value;
      const record: RegistrationRecord = { pluginId: manifest.id, kind, id, slot, value: registration };
      this.records.set(id, record);
      recordIds.add(id);
      if (this.loadingPlugins.has(manifest.id)) this.invalidateSnapshot();
      else this.scheduleChanged();
      return {
        dispose: () => {
          if (this.records.get(id) !== record) return;
          this.records.delete(id);
          recordIds.delete(id);
          if (this.loadingPlugins.has(manifest.id)) this.invalidateSnapshot();
          else this.scheduleChanged();
        },
      };
    };

    const hostRef = this;
    const storage = this.storage.get(manifest.id) ?? createPluginStorage(manifest.id);
    this.storage.set(manifest.id, storage);
    const store = this.stores.get(manifest.id) ?? createPluginStore(manifest.id);
    this.stores.set(manifest.id, store);
    return {
      manifest,
      permissions,
      data: scopedDataApi(this.dataApi, manifest, (name) => {
        const owned = hostRef.pluginTypes.get(manifest.id) ?? new Set<string>();
        if (owned.has(name)) return;
        owned.add(name);
        hostRef.pluginTypes.set(manifest.id, owned);
        hostRef.notifyChanged();
      }, () => this.requireUserGesture(manifest.id, "pickImage")),
      // Google sign-in through the system browser, API 1.7. The plugin names
      // a provider; Core owns the client id and the scopes, so this cannot be
      // pointed at an OAuth client the plugin chose. Gated on `network`
      // because that is what the install screen must say out loud: this
      // plugin talks to a third party on the user's behalf.
      oauth: scopedOauthApi(manifest),
      commands: {
        register: (command) => {
          // E14B-API (Hive #2): the language becomes a fence info string in the note; refuse anything else.
          if (command?.insertsBlock !== undefined && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(command.insertsBlock?.language ?? ""))) {
            throw new Error(`Command ${String(command?.id)}: insertsBlock.language must be a lowercase id`);
          }
          return register("command", command);
        },
      },
      views: {
        register: (view) => register("view", view),
        registerObjectTab: (tab) => register("object-tab", tab),
      },
      settings: { register: (section) => register("settings", section) },
      i18n: {
        // Read at call time, not captured: a plugin enabled before Core
        // installed the translator must still follow the language later, and
        // the language changes while plugins stay loaded.
        // The plugin's own bundled translations were parsed by the package
        // loader and, until 0.93.1, never reached this call.
        t: (key, values) => this.translator.translate(manifest.id, key, values, this.pluginLocales.get(manifest.id)),
        get locale() { return hostRef.translator.locale; },
      },
      ui: {
        registerSlot: (slot, registration) => register("slot", registration, slot),
        // Overlays need workspace.ui for the same reason a slot does: they
        // put pixels on the screen. Read `this.overlays` at call time, not at
        // context-construction time, so a plugin enabled before the shell
        // mounted still gets the real implementation.
        notice: (message, options) => {
          permissions.require("workspace.ui");
          return this.overlays.notice(manifest.id, message, options);
        },
        modal: (options) => {
          permissions.require("workspace.ui");
          return this.overlays.modal(manifest.id, options);
        },
        menu: (items, at) => {
          permissions.require("workspace.ui");
          return this.overlays.menu(manifest.id, items, at);
        },
        suggest: (items, render, options) => {
          permissions.require("workspace.ui");
          return this.overlays.suggest(manifest.id, items, render, options);
        },
        // API 1.1. Gated on workspace.ui like every other visible action: it
        // changes what the user is looking at. It grants no read a plugin did
        // not already have — the object opens in Core's own editor.
        openObject: (id) => {
          permissions.require("workspace.ui");
          return this.overlays.openObject(manifest.id, id);
        },
        // API 1.8. "Did this plugin register this view?" is answered HERE and
        // nowhere else: the host owns `this.records`, so it is the only side
        // that can tell a typo apart from a shell that cannot render views —
        // and the shells (Test Host, legacy) would each need their own copy of
        // the same lookup to do it, which is how two answers drift apart.
        // Core's bridge therefore only reports whether it navigated.
        openView: (viewId) => {
          permissions.require("workspace.ui");
          const key = namespacedId(manifest.id, viewId);
          const record = this.records.get(key);
          if (!record || record.kind !== "view") {
            throw new Error(`Plugin ${manifest.id} has no registered view "${viewId}"`);
          }
          return this.overlays.openView(manifest.id, viewId);
        },
        // API 1.11. Themed form controls into a plugin-owned element. Gated on
        // workspace.ui like the other overlays — it paints pixels — though it
        // grants no capability a plugin lacks (Core does not sandbox plugin
        // code). Read `this.overlays` at call time, as above.
        mountSelect: (el, options) => {
          permissions.require("workspace.ui");
          return this.overlays.mountSelect(manifest.id, el, options);
        },
        mountDatePicker: (el, options) => {
          permissions.require("workspace.ui");
          return this.overlays.mountDatePicker(manifest.id, el, options);
        },
        // API 1.15. Writes one file to Core's sanitised exports folder and
        // returns the path. Gated on workspace.ui like the other overlays — it
        // is a visible, user-facing action — though it grants no capability
        // plugin code lacks. Read `this.overlays` at call time, as above.
        exportFile: (filename, content) => {
          permissions.require("workspace.ui");
          return this.overlays.exportFile(manifest.id, filename, content);
        },
        // API 1.16. Binary twin of exportFile — base64 bytes to the exports
        // folder. Same workspace.ui gate.
        exportBinary: (filename, dataBase64, mime) => {
          permissions.require("workspace.ui");
          return this.overlays.exportBinary(manifest.id, filename, dataBase64, mime);
        },
        // API 1.19. Native "Save As" — the user picks the folder, unlike
        // exportBinary's fixed exports/ folder. Same workspace.ui gate.
        exportBinaryAs: (filename, dataBase64, mime) => {
          permissions.require("workspace.ui");
          return this.overlays.exportBinaryAs(manifest.id, filename, dataBase64, mime);
        },
        // API 1.18. Themed "are you sure" dialog. Same workspace.ui gate as
        // every other overlay — it blocks input to the rest of the app while
        // open, which is a visible, user-facing action.
        confirm: (message, options) => {
          permissions.require("workspace.ui");
          return this.overlays.confirm(manifest.id, message, options);
        },
        // API 1.22. Navigation a helper needs; gated on workspace.ui and on a
        // real user gesture (see requireUserNavigation). Async so the gate's
        // refusal reaches the caller as a rejection, like every other ui call.
        // Hive #7: navigation only, same real-gesture gate as Help.
        openSyncConflicts: async (copyId) => {
          permissions.require("workspace.ui");
          this.requireUserNavigation(manifest.id, "openSyncConflicts");
          if (copyId !== undefined && (typeof copyId !== "string" || !/^[0-9a-f-]{36}$/iu.test(copyId))) throw new Error("Invalid copy id");
          return this.overlays.openSyncConflicts(manifest.id, copyId);
        },
        openHelp: async (pageId, slug) => {
          permissions.require("workspace.ui");
          this.requireUserNavigation(manifest.id, "openHelp");
          return this.overlays.openHelp(manifest.id, pageId, slug);
        },
        openPluginSettings: async (pluginId) => {
          permissions.require("workspace.ui");
          if (typeof pluginId !== "string" || !pluginId) throw new Error("openPluginSettings needs a plugin id");
          this.requireUserNavigation(manifest.id, "openPluginSettings");
          return this.overlays.openPluginSettings(manifest.id, pluginId);
        },
        // API 1.22. No permission: it only formats text.
        renderMarkdown: (markdown) => this.overlays.renderMarkdown(manifest.id, String(markdown ?? "")),
      },
      // API 1.22. Read-only and permission-free; see HelpApi.
      help: {
        topics: () => hostRef.helpTopics(),
        onChange: (listener) => {
          hostRef.knowledgeListeners.add(listener);
          const disposable = {
            dispose: () => {
              hostRef.knowledgeListeners.delete(listener);
              disposables.delete(disposable);
            },
          };
          disposables.add(disposable);
          return disposable;
        },
      },
      editor: {
        // The language is the registration id, so a second plugin claiming an
        // already-rendered language hits the existing duplicate-id guard rather
        // than silently replacing the first one.
        registerCodeBlockRenderer: (language, render, options) =>
          register("codeBlock", { id: language.trim().toLowerCase(), render, toSvg: options?.toSvg, persistent: options?.persistent === true }),
        renderCodeBlockSvg: async (language, source, options) => {
          const id = language.trim().toLowerCase();
          const block = [...this.records.values()].find((record) => record.kind === "codeBlock" && (record.value as CodeBlockRegistration).id === id)?.value as CodeBlockRegistration | undefined;
          return block?.toSvg ? block.toSvg(String(source), options?.mode === "night" ? "night" : "paper") : null;
        },
        registerProseProfile: (match, profile) => {
          // Both a `propEquals` key and a `types` entry must be namespaced to
          // the calling plugin. This is a pure anti-collision check (same tier
          // as the propEquals rule) — the Rust upsert validator gates who may
          // FLAG a type's behaviour, not who may attach a prose profile to it.
          if (match.propEquals && !match.propEquals.key.startsWith(`${manifest.id}.`)) {
            throw new Error(`propEquals.key must be prefixed "${manifest.id}."`);
          }
          for (const t of match.types ?? []) {
            if (BUILTIN_TYPE_NAMES.has(t)) throw new Error(`cannot profile built-in type "${t}"`);
            if (!t.startsWith(`${manifest.id}.`)) throw new Error(`registerProseProfile: type "${t}" must be prefixed "${manifest.id}."`);
          }
          if (!match.types?.length && !match.propEquals) {
            throw new Error("registerProseProfile: match must specify `types` or `propEquals`");
          }
          // Deterministic id: a second registration for the same type set or
          // prop predicate from this plugin hits register()'s duplicate guard
          // (intra-plugin first-wins). Cross-plugin first-wins is Task 6.
          const regId = match.types?.length
            ? `type:${[...match.types].sort().join(",")}`
            : `prop:${match.propEquals!.key}=${match.propEquals!.value}`;
          return register("proseProfile", { id: regId, match, profile });
        },
      },
      events: {
        on: (event, handler) => {
          const subscription = this.events.on(event, handler);
          const disposable = {
            dispose: () => {
              subscription.dispose();
              disposables.delete(disposable);
            },
          };
          disposables.add(disposable);
          return disposable;
        },
        emit: (event, payload) => this.events.emit(event, payload),
      },
      scheduler: {
        every: (intervalMs, task) => {
          const safeIntervalMs = Math.max(MIN_SCHEDULER_INTERVAL_MS, intervalMs);
          const timer = setInterval(() => {
            // A rejection here is the plugin's own task failing — reported the
            // same way a failing command is, not an unhandled rejection that
            // would otherwise crash the whole host on this plugin's behalf.
            void Promise.resolve()
              .then(() => task())
              .catch((error) => this.reportError(manifest, "scheduler", error));
          }, safeIntervalMs);
          const disposable = {
            dispose: () => {
              clearInterval(timer);
              disposables.delete(disposable);
            },
          };
          disposables.add(disposable);
          return disposable;
        },
      },
      notifications: {
        show: (options) => {
          permissions.require("notifications");
          const focused = typeof document !== "undefined" && document.hasFocus();
          if (focused && this.inAppNotice) {
            this.inAppNotice(options.body ? `${options.title} — ${options.body}` : options.title);
            return Promise.resolve();
          }
          return pluginShowNotification(options.title, options.body);
        },
      },
      storage,
      store,
    };
  }

  /**
   * Fully forgets a plugin's Core-owned runtime state (currently its
   * in-memory PluginStorage). Call this only when a plugin is being removed
   * for good, not on a plain disable() — disable() intentionally keeps
   * storage around so re-enabling the same plugin/version still sees its
   * previous data. See C7 in the 2026-08-08 bug audit.
   */
  forgetStorage(pluginId: string) {
    // Persistent storage outlives the process, so dropping the map entry is
    // no longer enough — an uninstall has to erase what was written to disk
    // too, or reinstalling resurrects the old plugin's data.
    const storage = this.storage.get(pluginId) ?? createPluginStorage(pluginId);
    if (storage instanceof LocalPluginStorage) storage.clear();
    this.storage.delete(pluginId);
    this.stores.delete(pluginId); // Rust wipes the rows when the last registry version goes
  }

  private removeRecords(pluginId: string) {
    this.invalidateSnapshot();
    for (const id of this.pluginRecords.get(pluginId) ?? []) this.records.delete(id);
    for (const disposable of this.pluginDisposables.get(pluginId) ?? []) disposable.dispose();
    this.pluginRecords.delete(pluginId);
    // The plugin's `types` rows stay in the DB (re-enable must see its data),
    // but it no longer *provides* them — so Core hides their objects again.
    this.pluginTypes.delete(pluginId);
    this.pluginDisposables.delete(pluginId);
    // Drop the context too, so a surface that outlives its plugin fails
    // visibly ("plugin is not active") instead of rendering against a
    // context whose disposables have already run.
    this.contexts.delete(pluginId);
  }
}

function scopedPermissions(manifest: PluginManifest): PluginPermissions {
  const permissions = new Set(manifest.permissions ?? []);
  return {
    has: (permission) => permissions.has(permission),
    require: (permission) => {
      if (!permissions.has(permission)) {
        throw new Error(`plugin ${manifest.id} lacks permission ${permission}`);
      }
    },
  };
}

/**
 * Google sign-in, gated on `network`.
 *
 * `network` rather than a permission of its own: what the user is agreeing to
 * is "this plugin talks to a third party on my behalf", and that is exactly
 * what the install screen already says for `network`. A separate permission
 * would add a line nobody can tell apart from this one.
 *
 * The provider name travels to Rust, which resolves it to a client id and a
 * fixed scope set and refuses anything it does not recognise. Nothing here
 * needs to validate it — and nothing here should pretend to, or the next
 * reader will trust this layer instead of the one that decides.
 */
function scopedOauthApi(manifest: PluginManifest): OauthApi {
  const permissions = new Set(manifest.permissions ?? []);
  const guard = <Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      if (!permissions.has("network")) {
        throw new Error(`plugin ${manifest.id} lacks permission network`);
      }
      return operation(...args);
    };
  return {
    google: {
      signIn: guard(pluginGoogleLogin),
      accessToken: guard(pluginGoogleAccessToken),
      revoke: guard(pluginGoogleRevoke),
    },
  };
}

function scopedDataApi(dataApi: DataApi, manifest: PluginManifest, onTypeUpsert?: (name: string) => void, requireMediaGesture?: () => void): DataApi {
  const permissions = new Set(manifest.permissions ?? []);
  const guard = <Args extends unknown[], Result>(permission: PluginPermission, operation: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      if (!permissions.has(permission)) {
        throw new Error(`plugin ${manifest.id} lacks permission ${permission}`);
      }
      return operation(...args);
    };
  return {
    objects: {
      get: guard("data.read", dataApi.objects.get),
      create: guard("data.write", dataApi.objects.create),
      update: guard("data.write", dataApi.objects.update),
      setType: guard("data.write", dataApi.objects.setType),
      move: guard("data.write", dataApi.objects.move),
      trash: guard("data.write", dataApi.objects.trash),
      query: guard("data.read", dataApi.objects.query),
      // API 1.18. Synchronous like every other `register()` call — a plugin
      // wires this up during mount and expects the Disposable back
      // immediately, not after a microtask. Same permission as `get`: this
      // reaches nothing `get` does not already expose, just when it changes.
      onChange: (id, callback) => {
        if (!permissions.has("data.read")) throw new Error(`plugin ${manifest.id} lacks permission data.read`);
        if (!dataApi.objects.onChange) throw new Error("objects.onChange is not available in this host");
        return dataApi.objects.onChange(id, callback);
      },
      findByTitle: guard("data.read", dataApi.objects.findByTitle ?? unavailableDataApi.objects.findByTitle),
    },
    // Tolerate a host that predates the content index rather than throwing
    // while building the context — a partial DataApi should degrade to "this
    // capability is unavailable", not take the whole plugin down at load.
    index: {
      query: guard("data.read", dataApi.index?.query ?? unavailableDataApi.index.query),
      forObject: guard("data.read", dataApi.index?.forObject ?? unavailableDataApi.index.forObject),
    },
    document: {
      get: guard("data.read", dataApi.document?.get ?? unavailableDataApi.document.get),
    },
    // API 1.14. Its own permission, not `data.sync`: reading one embedded
    // image is a far narrower thing than the replication journal. `read`
    // additionally needs the user's "Let plugins read pasted images" switch,
    // which Rust enforces on `sync_media_read` underneath — this guard only
    // establishes that the plugin asked for `media.read` at install time.
    media: {
      read: async (ref) => {
        const media = dataApi.media as DataApi["media"] & { readOwned?: (pluginId: string, ref: string) => Promise<string> };
        if (permissions.has("media.write") && media.readOwned) {
          try { return await media.readOwned(manifest.id, ref); }
          catch (error) { if (!permissions.has("media.read")) throw error; }
        }
        if (!permissions.has("media.read")) throw new Error(`plugin ${manifest.id} lacks permission media.read`);
        return (media.read ?? unavailableDataApi.media.read)(ref);
      },
      pickImage: async () => {
        if (!permissions.has("media.write")) throw new Error(`plugin ${manifest.id} lacks permission media.write`);
        requireMediaGesture?.();
        const media = dataApi.media as DataApi["media"] & { pickImageForPlugin?: (pluginId: string) => Promise<string | null> };
        return media.pickImageForPlugin
          ? media.pickImageForPlugin(manifest.id)
          : (media.pickImage ?? unavailableDataApi.media.pickImage)();
      },
      // API 1.28. These checks are only the early, readable refusal: Rust re-reads the
      // stored manifest and enforces permissions + networkHosts itself (media_import.rs).
      importImageFromUrl: async (url) => {
        for (const needed of ["media.write", "network"] as const) {
          if (!permissions.has(needed)) throw new Error(`plugin ${manifest.id} lacks permission ${needed}`);
        }
        if (!manifest.networkHosts?.length) throw new Error(`plugin ${manifest.id} declares no networkHosts`);
        const media = dataApi.media as DataApi["media"] & { importImageForPlugin?: (pluginId: string, url: string) => Promise<string> };
        if (!media.importImageForPlugin) return unavailableDataApi.media.importImageFromUrl(url);
        return media.importImageForPlugin(manifest.id, String(url));
      },
    },
    relations: {
      list: guard("data.read", dataApi.relations.list),
      listForObjects: guard("data.read", dataApi.relations.listForObjects),
      create: guard("relations.write", dataApi.relations.create),
      delete: guard("relations.write", dataApi.relations.delete),
    },
    types: {
      list: guard("data.read", dataApi.types.list),
      // Inject the calling plugin's id so the Rust validator can namespace-gate
      // behaviour flags. The plugin never passes its own id.
      upsert: guard("data.write", (name: string, schema: string, icon?: string, color?: string) =>
        dataApi.types.upsert(name, schema, icon, color, manifest.id).then((result) => {
          onTypeUpsert?.(name);
          return result;
        })),
    },
    dataSources: {
      list: guard("data.read", dataApi.dataSources.list),
      upsert: guard("data.write", dataApi.dataSources.upsert),
      delete: guard("data.write", dataApi.dataSources.delete),
    },
    // `data.sync` is its own permission and does not fall back to
    // read/write. Reading the journal exposes tombstones and every relation
    // kind, and writing through it sets ids and timestamps that `objects.*`
    // refuses — that is a strictly larger capability than `data.write`, so a
    // plugin has to ask for it by name and the install screen has to say so.
    sync: {
      export: guard("data.sync", dataApi.sync?.export ?? unavailableDataApi.sync.export),
      apply: guard("data.sync", dataApi.sync?.apply ?? unavailableDataApi.sync.apply),
      markOutboxAttempts: guard("data.sync", dataApi.sync?.markOutboxAttempts ?? unavailableDataApi.sync.markOutboxAttempts),
      // Pasted image bytes, API 1.6. Same permission as the rest of sync:
      // carrying media is part of replicating a workspace, not a separate
      // capability a plugin could want on its own. `read` additionally
      // needs the user's switch, which Rust enforces — this guard only
      // establishes that the plugin asked for data.sync at install time.
      media: {
        missing: guard("data.sync", dataApi.sync?.media?.missing ?? unavailableDataApi.sync.media.missing),
        read: guard("data.sync", dataApi.sync?.media?.read ?? unavailableDataApi.sync.media.read),
        write: guard("data.sync", dataApi.sync?.media?.write ?? unavailableDataApi.sync.media.write),
      },
      // SYNC-TRANSPORT (Hive #9): agent sandboxes only. Rust compiles the
      // commands out of release builds and refuses them outside a sandbox
      // with a shared folder; this guard adds the data.sync permission.
      sandboxFolder: dataApi.sync?.sandboxFolder && {
        available: guard("data.sync", dataApi.sync.sandboxFolder.available),
        list: guard("data.sync", dataApi.sync.sandboxFolder.list),
        read: guard("data.sync", dataApi.sync.sandboxFolder.read),
        write: guard("data.sync", dataApi.sync.sandboxFolder.write),
        remove: guard("data.sync", dataApi.sync.sandboxFolder.remove),
      },
    },
  };
}

/**
 * Core's side of the overlay API. Identical to the public `UiApi` except that
 * every call carries the id of the plugin that made it: Core needs it to
 * build a mount context, and to attribute an overlay in the UI. Keeping it
 * out of the public shape means a plugin cannot claim to be another one.
 */
export interface CoreOverlayApi {
  notice(pluginId: string, ...args: Parameters<UiApi["notice"]>): ReturnType<UiApi["notice"]>;
  modal(pluginId: string, ...args: Parameters<UiApi["modal"]>): ReturnType<UiApi["modal"]>;
  menu(pluginId: string, ...args: Parameters<UiApi["menu"]>): ReturnType<UiApi["menu"]>;
  suggest<T>(pluginId: string, items: T[], render: (item: T) => string, options?: { placeholder?: string }): Promise<T | null>;
  openObject(pluginId: string, ...args: Parameters<UiApi["openObject"]>): ReturnType<UiApi["openObject"]>;
  /**
   * API 1.8. The shell answers one question only — "did I navigate?" — and
   * returns `false` when it has no addressable place to render a view. The
   * host has already established that `viewId` is one of this plugin's own
   * registrations, so an implementation here must not re-check it.
   */
  openView(pluginId: string, ...args: Parameters<UiApi["openView"]>): ReturnType<UiApi["openView"]>;
  /** API 1.11. Renders a themed control into `el`; the Disposable removes it. */
  mountSelect(pluginId: string, ...args: Parameters<UiApi["mountSelect"]>): ReturnType<UiApi["mountSelect"]>;
  mountDatePicker(pluginId: string, ...args: Parameters<UiApi["mountDatePicker"]>): ReturnType<UiApi["mountDatePicker"]>;
  /** API 1.15. Writes text to `<app data>/exports/<filename>` and returns the path. */
  exportFile(pluginId: string, ...args: Parameters<UiApi["exportFile"]>): ReturnType<UiApi["exportFile"]>;
  /** API 1.16. Writes base64 bytes to `<app data>/exports/<filename>` and returns the path. */
  exportBinary(pluginId: string, ...args: Parameters<UiApi["exportBinary"]>): ReturnType<UiApi["exportBinary"]>;
  /** API 1.19. Native "Save As" dialog; writes base64 bytes where the user picks, or resolves `null` on cancel. */
  exportBinaryAs(pluginId: string, ...args: Parameters<UiApi["exportBinaryAs"]>): ReturnType<UiApi["exportBinaryAs"]>;
  /** API 1.18. Themed confirm dialog; resolves `true`/`false`, never rejects. */
  confirm(pluginId: string, ...args: Parameters<UiApi["confirm"]>): ReturnType<UiApi["confirm"]>;
  /** API 1.26. The host has already checked workspace.ui and the user gesture. */
  openSyncConflicts(pluginId: string, ...args: Parameters<UiApi["openSyncConflicts"]>): ReturnType<UiApi["openSyncConflicts"]>;
  /** API 1.22. The host has already checked workspace.ui and the user gesture. */
  openHelp(pluginId: string, ...args: Parameters<UiApi["openHelp"]>): ReturnType<UiApi["openHelp"]>;
  openPluginSettings(pluginId: string, ...args: Parameters<UiApi["openPluginSettings"]>): ReturnType<UiApi["openPluginSettings"]>;
  renderMarkdown(pluginId: string, ...args: Parameters<UiApi["renderMarkdown"]>): ReturnType<UiApi["renderMarkdown"]>;
}

/**
 * Used until Core installs the real one, and in the headless check scripts,
 * which have no DOM. It fails loudly rather than silently doing nothing: a
 * plugin whose modal never appears is a much worse bug to chase than one
 * that throws.
 */
const unavailableUiApi: CoreOverlayApi = {
  notice: () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
  modal: () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
  menu: () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
  suggest: async () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
  openObject: async () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
  openView: async () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
  mountSelect: () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
  mountDatePicker: () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
  exportFile: async () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
  exportBinary: async () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
  exportBinaryAs: async () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
  confirm: async () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
  openSyncConflicts: async () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
  openHelp: async () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
  openPluginSettings: async () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
  renderMarkdown: () => { throw new Error("Core overlay API is not configured for this ExtensionHost"); },
};

const unavailableDataApi: DataApi = {
  objects: {
    get: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    create: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    update: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    setType: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    move: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    trash: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    query: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    onChange: () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    findByTitle: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
  },
  document: {
    get: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
  },
  relations: {
    list: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    listForObjects: () => { throw new Error("Core data API is not configured for this ExtensionHost"); },
    create: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    delete: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
  },
  types: {
    list: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    upsert: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
  },
  index: {
    query: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    forObject: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
  },
  media: {
    read: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    pickImage: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    importImageFromUrl: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
  },
  dataSources: {
    list: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    upsert: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    delete: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
  },
  sync: {
    export: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    apply: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    markOutboxAttempts: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    media: {
      missing: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
      read: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
      write: async () => { throw new Error("Core DataApi is not configured for this ExtensionHost"); },
    },
  },
};
