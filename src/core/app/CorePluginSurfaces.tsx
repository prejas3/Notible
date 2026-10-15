import { Component, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ErrorInfo, type ReactNode, type RefObject } from "react";
import type { CodeBlockRenderer, Disposable, ExtensionSnapshot, MenuItem, ViewMount, ViewMountContext, ViewRegistration } from "../extensions/types";
import type { CoreOverlayApi } from "../extensions/host.ts";
import { activateNoticeAction } from "../extensions/host.ts";
import type { PluginStyleSink } from "../extensions/manager.ts";
import { coreHost } from "./CoreOnlyApp";
import { tCore, useCoreI18n } from "./core-i18n.ts";
import { mountSelect, mountDatePicker } from "../ui/mount.tsx";
import { writeExport, saveExportBinary, saveExportBinaryAs } from "../../lib/api";
import { createPortal } from "react-dom";
import { renderCoreMarkdown } from "./CoreMarkdownEditor.tsx";
import { cornerCandidates, pickCornerOccupant } from "../extensions/corner.ts";
import { keepMount, sourceWriteAllowed, type CodeBlockEditorBridge, type MountKey } from "./codeBlockMounts.ts";
export { cornerCandidates, pickCornerOccupant };

/**
 * Core-owned rendering for third-party plugin UI.
 *
 * Two things live here, and they are related on purpose:
 *
 * - `PluginDomMount` runs a plugin's `mount(context)` against a host-created
 *   element (D7), so a plugin renders its own DOM without needing the host's
 *   React instance.
 * - `CoreOverlayHost` implements the notice/modal/menu/suggest API (D16).
 *   Core owns every overlay. Without this, a plugin that needs a dialog has
 *   no option but to paint over `document.body`, which is exactly what a
 *   trust-decision surface must never be confusable with.
 */

// ---------- host bridge ----------

interface HostBridge {
  themeMode: "paper" | "night";
  openObject(id: string): Promise<void>;
  /**
   * API 1.8. `key` is the `${pluginId}:${viewId}` view key that
   * `corePluginViewItems` builds. Returns whether the shell actually
   * navigated: a shell with no addressable place to show a plugin view answers
   * `false`, so the plugin can fall back to a modal instead of appearing dead.
   */
  openView(key: string): Promise<boolean>;
  notifyChanged(): void;
  /** API 1.22. Help at a page/heading; Settings → Plugins with a plugin selected. */
  openHelp(pageId?: string, slug?: string): void;
  openSyncConflicts(copyId?: string): Promise<void>;
  openPluginSettings(pluginId: string): void;
}

// What a shell that never installed a bridge gets — the legacy app among them,
// whose plugin-views screen is a local boolean rather than an addressable
// location. `false` rather than a throw: "this host cannot show views" is an
// answer the contract defines, and the plugin has a documented fallback for it.
let bridge: HostBridge = {
  themeMode: "paper",
  openObject: async () => {},
  openView: async () => false,
  notifyChanged: () => {},
  openHelp: () => {},
  openPluginSettings: () => {},
  openSyncConflicts: async () => {},
};

/** Core installs the real bridge once its shell knows how to navigate. */
export function setCorePluginBridge(next: HostBridge) {
  bridge = next;
}

function themeApi(): ViewMountContext["theme"] {
  return {
    mode: bridge.themeMode,
    token: (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
  };
}

// ---------- D5: plugin stylesheets ----------

/**
 * Injects a plugin's declared stylesheets and takes them down again.
 *
 * Two rules, both load-bearing:
 *
 * - The CSS is written with `textContent` on a detached `<style>`, never by
 *   concatenating markup. `script-src 'self'` means an HTML breakout would not
 *   give script, but it would give arbitrary DOM — which is precisely the
 *   consent-forgery capability the trust surfaces must not hand out.
 * - Every element is tagged with the plugin id so `remove` can be exact.
 *   Ordering between plugins is install order and is documented as
 *   unspecified; nothing may depend on it.
 */
export const coreStyleSink: PluginStyleSink = {
  apply(pluginId, styles) {
    coreStyleSink.remove(pluginId);
    for (const sheet of styles) {
      const element = document.createElement("style");
      element.dataset.notiblePlugin = pluginId;
      element.dataset.notibleStyle = sheet.path;
      element.textContent = sheet.css;
      document.head.append(element);
    }
  },
  remove(pluginId) {
    for (const element of document.querySelectorAll(`style[data-notible-plugin="${CSS.escape(pluginId)}"]`)) {
      element.remove();
    }
  },
};

/**
 * Detach every plugin stylesheet for the duration of `run`, then restore.
 *
 * This is the mechanism behind D2. A shadow root does not protect a
 * trust-decision surface: the host element sits in the light DOM and can
 * simply be hidden, and custom properties inherit through the boundary — which
 * the token contract hands to plugins deliberately. Removing the stylesheets
 * outright is the only version that holds, and it costs the user one briefly
 * unthemed dialog.
 */
export async function withoutPluginStyles<T>(run: () => Promise<T>): Promise<T> {
  const detached = [...document.querySelectorAll("style[data-notible-plugin]")];
  const anchor = detached.map((element) => element.nextSibling);
  for (const element of detached) element.remove();
  try {
    return await run();
  } finally {
    detached.forEach((element, index) => {
      const sibling = anchor[index];
      if (sibling?.parentNode === document.head) document.head.insertBefore(element, sibling);
      else document.head.append(element);
    });
  }
}

// ---------- D7: DOM mount adapter ----------

export function PluginDomMount({ mount, pluginId, objectId, containerId }: {
  mount: ViewMount;
  pluginId: string;
  objectId?: string;
  containerId?: string;
}) {
  const { t } = useCoreI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const plugin = coreHost.getPluginContext(pluginId);
    if (!plugin) {
      setError(`plugin ${pluginId} is not active`);
      return;
    }
    setError(null);
    let disposable: Disposable | void;
    try {
      // A DOM mount lives in its own root, so the React error boundaries that
      // catch the builtin React path do not apply here. Catching around both
      // mount and dispose is what keeps one broken plugin from taking the
      // surrounding view down with it.
      disposable = mount({
        container,
        plugin,
        objectId,
        containerId,
        theme: themeApi(),
        openObject: (id) => bridge.openObject(id),
        notifyChanged: () => bridge.notifyChanged(),
      });
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      return;
    }
    return () => {
      try {
        disposable?.dispose();
      } catch {
        // A plugin that throws on the way out must not block unmount.
      }
      container.replaceChildren();
    };
  }, [mount, pluginId, objectId, containerId]);

  if (error) {
    return <div className="core-plugin-surface-error" role="alert"><strong>{t("This plugin surface failed")}</strong><p>{error}</p></div>;
  }
  return <div className="core-plugin-mount" ref={ref} data-plugin={pluginId} />;
}

// ---------- plugin views as first-class app-shell panes ----------

/**
 * A React error boundary around one plugin view.
 *
 * `PluginDomMount` already catches a throw from `mount`/`dispose`, but the
 * pane is React-rendered and a throw on the React side (a bad registration, a
 * render-phase state update) would otherwise unmount the whole shell —
 * exactly the failure mode that took the host down when Plugin Settings was
 * opened. The boundary keeps the sidebar, nav and settings usable and shows
 * the failure inside the pane.
 */
class CorePluginViewBoundary extends Component<{ title: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Notible] plugin view failed: ${this.props.title}`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <div className="core-plugin-surface-error" role="alert"><strong>{tCore("This plugin view failed")}</strong><p>{this.state.error.message}</p></div>;
    }
    return this.props.children;
  }
}

export interface CorePluginViewItem {
  /** `${pluginId}:${registration.id}` — the same key the plugin-view host uses. */
  key: string;
  pluginId: string;
  registration: ViewRegistration;
}

/**
 * Every view registered through the public `views.register` API, flattened out
 * of a host snapshot so the shell can drive navigation off the same
 * subscription it already uses for commands and slots.
 */
export function corePluginViewItems(snapshots: ExtensionSnapshot[]): CorePluginViewItem[] {
  return snapshots.flatMap((snapshot) => snapshot.views.map((registration) => ({
    key: `${snapshot.pluginId}:${registration.id}`,
    pluginId: snapshot.pluginId,
    registration,
  })));
}

/**
 * One registered view, rendered as a whole screen.
 *
 * The mount itself is `PluginDomMount`, unchanged: it builds the container,
 * hands the plugin its own `PluginContext`, the live theme, `openObject` and
 * `notifyChanged` through the host bridge, and disposes the returned
 * `Disposable` when the pane unmounts or the registration is replaced. Nothing
 * about the contract is re-implemented here.
 */
export function CorePluginViewPane({ item }: { item: CorePluginViewItem }) {
  const { t } = useCoreI18n();
  const mount = item.registration.mount;
  if (!mount) {
    return <div className="core-plugin-surface-error" role="alert"><strong>{item.registration.title}</strong><p>{t("This view registered no mount, so Core has nothing to draw.")}</p></div>;
  }
  return (
    <CorePluginViewBoundary title={item.registration.title}>
      <PluginDomMount key={item.key} mount={mount} pluginId={item.pluginId} />
    </CorePluginViewBoundary>
  );
}

// ---------- D8: slot rendering ----------

/**
 * Renders every plugin registration for one slot.
 *
 * `inline` picks the row layout used by the editor toolbar and footer; the
 * default stacks, which is what the sidebar and properties panel want. A slot
 * with no registrations renders nothing at all — no empty box, no gap.
 */
export function PluginSlot({ name, objectId, containerId, inline }: { name: string; objectId?: string; containerId?: string; inline?: boolean }) {
  const snapshots = useSyncExternalStore(
    (listener) => { const subscription = coreHost.onChange(listener); return () => subscription.dispose(); },
    () => coreHost.getSnapshot(),
  );
  const entries = snapshots.flatMap((snapshot) =>
    (snapshot.slots[name] ?? []).map((registration) => ({ pluginId: snapshot.pluginId, registration })));
  if (entries.length === 0) return null;
  return (
    <div className={inline ? "core-plugin-slot is-inline" : "core-plugin-slot"} data-slot={name}>
      {entries.map(({ pluginId, registration }) => registration.mount
        ? <PluginDomMount key={`${pluginId}:${registration.id}`} mount={registration.mount} pluginId={pluginId} objectId={objectId} containerId={containerId} />
        : null)}
    </div>
  );
}

// ---------- editor contract: code-block renderers ----------

/**
 * Mounts plugin renderers over fenced code blocks in the editor.
 *
 * The design constraint that shaped this: Core's editor is a contenteditable
 * over plain Markdown, not a ProseMirror document, so there is no node view to
 * hook. What there is, is `renderCoreMarkdown` emitting
 * `<pre class="core-code-block" data-lang><code>…</code></pre>`, and
 * `markdownFromCoreHtml` reading that block back from its `<code>` alone.
 *
 * So: the `<code>` is left exactly as it was — visible, editable, and still the
 * only thing the serializer reads — and the plugin draws into a sibling that is
 * `contenteditable="false"`. The serializer is untouched, which is what makes
 * this safe: a broken renderer, or an uninstalled plugin, costs you a rendering
 * and never a note.
 */
export function useCodeBlockDecorator(objectId?: string): (root: HTMLElement, editor: CodeBlockEditorBridge) => void {
  const snapshots = useSyncExternalStore(
    (listener) => { const subscription = coreHost.onChange(listener); return () => subscription.dispose(); },
    () => coreHost.getSnapshot(),
  );
  const mounted = useRef<Disposable[]>([]);
  // E14B-KEEPALIVE (Hive #2): `persistent: true` renderers are kept across
  // redraws while their block is on screen with the same source and renderer.
  // A Map (not a WeakMap) so a pass can find and dispose the ones that left.
  const persistent = useRef(new Map<HTMLPreElement, MountKey & { dispose: () => void }>());

  const renderers = useMemo(() => {
    const byLanguage = new Map<string, { pluginId: string; render: CodeBlockRenderer; persistent: boolean }>();
    for (const snapshot of snapshots) {
      for (const registration of snapshot.codeBlocks ?? []) {
        // First registration wins, as with hotkeys: two plugins silently
        // fighting over ```mermaid is not something the user can diagnose.
        if (!byLanguage.has(registration.id)) byLanguage.set(registration.id, { pluginId: snapshot.pluginId, render: registration.render, persistent: registration.persistent === true });
      }
    }
    return byLanguage;
  }, [snapshots]);

  useEffect(() => () => {
    for (const record of persistent.current.values()) record.dispose();
    persistent.current.clear();
  }, []);

  return useCallback((root: HTMLElement, editor: CodeBlockEditorBridge) => {
    for (const disposable of mounted.current) {
      try { disposable.dispose(); } catch { /* a renderer's cleanup must not break the editor */ }
    }
    mounted.current = [];
    const seen = new Set<HTMLPreElement>();

    for (const pre of root.querySelectorAll<HTMLPreElement>("pre.core-code-block")) {
      const language = (pre.dataset.lang ?? "").trim().toLowerCase();
      const entry = renderers.get(language);
      const code = pre.querySelector("code");
      if (!entry || !code) continue;
      const plugin = coreHost.getPluginContext(entry.pluginId);
      if (!plugin) continue;
      const source = code.textContent ?? "";

      if (entry.persistent) {
        const record = persistent.current.get(pre);
        if (record && keepMount({ ...record, connected: root.contains(pre) && pre.contains(pre.querySelector(".core-code-render")) }, { language, source, render: entry.render })) {
          seen.add(pre);
          continue;
        }
        record?.dispose();
        persistent.current.delete(pre);
      }

      const container = document.createElement("div");
      container.className = "core-code-render";
      container.contentEditable = "false";
      container.dataset.notiblePlugin = entry.pluginId;
      // Appended *after* the source, which stays visible and editable. Hiding
      // it was the first attempt and it made every rendered block impossible to
      // edit — this is a live contenteditable, not a preview pane.
      pre.append(container);

      const record: MountKey & { dispose: () => void } = { language, source, render: entry.render, dispose: () => container.remove() };
      try {
        const disposable = entry.render({
          container,
          language,
          source,
          objectId,
          plugin,
          theme: themeApi(),
          readOnly: editor.readOnly,
          updateSource: (next: string) => {
            if (typeof next !== "string") return false;
            // E14B-WRITE-GUARD: never over a hand edit not yet redrawn, never out of the fence.
            if (!sourceWriteAllowed(pre.querySelector("code")?.textContent ?? "", record.source, next)) return false;
            const before = record.source;
            // Set first: the write can trigger a redraw, which must see the new
            // source and keep this mount instead of remounting it.
            record.source = next;
            const written = editor.updateSource(pre, next);
            if (!written) record.source = before;
            return written;
          },
        });
        record.dispose = () => {
          try { disposable?.dispose(); } catch { /* a renderer's cleanup must not break the editor */ } finally { container.remove(); }
        };
        if (entry.persistent) {
          persistent.current.set(pre, record);
          seen.add(pre);
        } else {
          mounted.current.push(record);
        }
      } catch {
        // A throwing renderer falls back to the plain code block rather than
        // taking the note's rendering down with it.
        container.remove();
      }
    }
    for (const [pre, record] of persistent.current) {
      if (seen.has(pre)) continue;
      record.dispose();
      persistent.current.delete(pre);
    }
  }, [renderers, objectId]);
}

// ---------- D18: plugin hotkeys ----------

/** Normalise a binding so "Mod+Shift+K" and "shift+mod+k" are one key. */
function normaliseHotkey(value: string): string | null {
  const parts = value.split("+").map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return null;
  const key = parts[parts.length - 1];
  if (key.length === 0 || ["mod", "ctrl", "control", "meta", "cmd", "alt", "shift"].includes(key)) return null;
  const modifiers = new Set(parts.slice(0, -1).map((part) => (part === "ctrl" || part === "control" || part === "cmd" || part === "meta" ? "mod" : part)));
  return [...["mod", "alt", "shift"].filter((name) => modifiers.has(name)), key].join("+");
}

function hotkeyOf(event: KeyboardEvent): string {
  const modifiers: string[] = [];
  if (event.ctrlKey || event.metaKey) modifiers.push("mod");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");
  return [...modifiers, event.key.toLowerCase()].join("+");
}

/**
 * Bindings Core already owns. A plugin cannot take these — the app's own
 * shortcuts have to keep working no matter what is installed.
 */
const RESERVED_HOTKEYS = new Set(["mod+n", "mod+,", "mod+f", "mod+s", "mod+z", "alt+ ", "f1"]);

/**
 * User rebindings, keyed `<pluginId>:<commandId>`.
 *
 * An empty string means "the user turned this binding off" and is deliberately
 * distinct from an absent key, which means "use whatever the plugin declared".
 * Without that distinction there is no way to disable a declared hotkey, and a
 * plugin that grabs a key you need would be unfixable short of uninstalling it.
 *
 * Core-owned, not plugin storage: a plugin must not be able to rewrite the
 * user's own keyboard decisions.
 */
const HOTKEY_OVERRIDES_KEY = "notible-core-hotkey-overrides";
const hotkeyListeners = new Set<() => void>();
let hotkeyOverrides: Record<string, string> = readHotkeyOverrides();

function readHotkeyOverrides(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(HOTKEY_OVERRIDES_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, value]) => typeof value === "string")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function hotkeyOverrideKey(pluginId: string, commandId: string): string {
  return `${pluginId}:${commandId}`;
}

/** The binding actually in force: the user's choice if any, else the plugin's. */
export function effectiveHotkey(pluginId: string, commandId: string, declared: string | undefined): string | null {
  const override = hotkeyOverrides[hotkeyOverrideKey(pluginId, commandId)];
  if (override !== undefined) return override === "" ? null : override;
  return declared ? normaliseHotkey(declared) : null;
}

/** `null` clears the override and restores whatever the plugin declared. */
export function setHotkeyOverride(pluginId: string, commandId: string, binding: string | null | "") {
  const key = hotkeyOverrideKey(pluginId, commandId);
  const next = { ...hotkeyOverrides };
  if (binding === null) delete next[key];
  else next[key] = binding === "" ? "" : (normaliseHotkey(binding) ?? "");
  hotkeyOverrides = next;
  try {
    localStorage.setItem(HOTKEY_OVERRIDES_KEY, JSON.stringify(next));
  } catch {
    // A full or blocked localStorage must not take the settings screen down.
  }
  for (const listener of hotkeyListeners) listener();
}

export function useHotkeyOverrides(): Record<string, string> {
  return useSyncExternalStore(
    (listener) => { hotkeyListeners.add(listener); return () => hotkeyListeners.delete(listener); },
    () => hotkeyOverrides,
  );
}

/**
 * Every plugin command, with the binding in force and who holds it.
 *
 * Resolution order matters and is the same one the dispatcher uses, so what
 * Settings shows is what actually fires — the two must never be computed
 * differently.
 */
export function resolveHotkeyBindings(snapshots: ReturnType<typeof coreHost.getSnapshot>) {
  const taken = new Map<string, string>();
  const rows: Array<{ pluginId: string; commandId: string; name: string; declared: string | null; binding: string | null; conflict: string | null }> = [];
  for (const snapshot of snapshots) {
    for (const command of snapshot.commands) {
      // ponytail: every built-in registers an internal "status" command
      // ("Install work models", "Inspect code block"); nobody binds a key to
      // plumbing, and Whiteboard's one duplicated "Create whiteboard".
      if (command.id === "status") continue;
      const binding = effectiveHotkey(snapshot.pluginId, command.id, command.hotkey);
      let conflict: string | null = null;
      if (binding) {
        if (RESERVED_HOTKEYS.has(binding)) conflict = "reserved by Notible";
        else if (taken.has(binding)) conflict = `already used by ${taken.get(binding)}`;
        else taken.set(binding, command.name);
      }
      rows.push({
        pluginId: snapshot.pluginId,
        commandId: command.id,
        name: command.name,
        declared: command.hotkey ? normaliseHotkey(command.hotkey) : null,
        binding,
        conflict,
      });
    }
  }
  return rows;
}

/** "mod+shift+h" as keycaps, the way Core's own shortcuts are shown (V-PLUGINS-08). */
function HotkeyCaps({ binding }: { binding: string }) {
  const names: Record<string, string> = { mod: "Ctrl", shift: "Shift", alt: "Alt", " ": "Space", arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓", escape: "Esc" };
  const parts = binding.split("+").map((part) => names[part] ?? (part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)));
  return <span className="core-hotkey-caps">{parts.map((part, index) => <span key={index}>{index > 0 && <span aria-hidden="true">+</span>}<kbd>{part}</kbd></span>)}</span>;
}

/**
 * Records a keystroke into a binding.
 *
 * Reads the key from the event rather than parsing typed text: "Mod+Shift+K"
 * written by hand is a spelling exercise, and the one thing the user actually
 * knows is which keys they pressed.
 */
export function HotkeyRecorder({ pluginId, commandId, declared, binding, conflict }: {
  pluginId: string; commandId: string; declared: string | null; binding: string | null; conflict: string | null;
}) {
  const [recording, setRecording] = useState(false);
  return (
    <span className="core-hotkey-recorder">
      <button
        type="button"
        className={`core-plugin-hotkey${recording ? " is-recording" : ""}${conflict ? " is-conflict" : ""}`}
        aria-label={tCore("Change shortcut")}
        onClick={() => setRecording((current) => !current)}
        onBlur={() => setRecording(false)}
        onKeyDown={(event) => {
          if (!recording) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") { setRecording(false); return; }
          // A bare modifier is a keystroke in progress, not a binding.
          if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
          setHotkeyOverride(pluginId, commandId, hotkeyOf(event.nativeEvent));
          setRecording(false);
        }}
      >{recording ? tCore("press keys…") : binding ? <HotkeyCaps binding={binding} /> : "—"}</button>
      {binding && !recording && (
        <button type="button" className="core-hotkey-clear" aria-label={tCore("Remove shortcut")} onClick={() => setHotkeyOverride(pluginId, commandId, "")}>×</button>
      )}
      {hotkeyOverrides[hotkeyOverrideKey(pluginId, commandId)] !== undefined && (
        <button type="button" className="core-hotkey-clear" onClick={() => setHotkeyOverride(pluginId, commandId, null)}>
          {declared ? tCore("reset") : tCore("clear")}
        </button>
      )}
      {conflict && <small className="core-hotkey-conflict">{conflict}</small>}
    </span>
  );
}

/**
 * Dispatches plugin command hotkeys.
 *
 * The `hotkey` field shipped in the public contract with a comment promising
 * that Core resolved conflicts and dispatched it, while nothing dispatched
 * anything. Either the comment or the behaviour had to go; this is the
 * behaviour, because a declared-but-dead field in a frozen 1.0 contract is
 * the hardest kind of promise to withdraw.
 *
 * First registration wins. A later plugin claiming a taken binding is
 * ignored rather than silently shadowing the first — two plugins fighting
 * over one key is a bug the user cannot see or diagnose.
 */
export function useCorePluginHotkeys() {
  const snapshots = useSyncExternalStore(
    (listener) => { const subscription = coreHost.onChange(listener); return () => subscription.dispose(); },
    () => coreHost.getSnapshot(),
  );
  // Re-arms when the user rebinds something; without this the dispatcher would
  // keep firing the old binding until the next plugin reload.
  const overrides = useHotkeyOverrides();

  useEffect(() => {
    const bindings = new Map<string, { pluginId: string; command: { name: string; whileTyping?: boolean; execute: (input?: unknown) => unknown } }>();
    for (const snapshot of snapshots) {
      for (const command of snapshot.commands) {
        const binding = effectiveHotkey(snapshot.pluginId, command.id, command.hotkey);
        if (!binding || RESERVED_HOTKEYS.has(binding) || bindings.has(binding)) continue;
        bindings.set(binding, { pluginId: snapshot.pluginId, command });
      }
    }
    if (bindings.size === 0) return;

    function onKeyDown(event: KeyboardEvent) {
      // Never while the user is writing. A plugin binding that fires mid-note
      // is worse than one that does not fire at all.
      // `instanceof Element`, not a cast: when focus sits on the document (or
      // the event is synthesised on `window`) the target has no `.matches` and
      // the cast turned a missed hotkey into a TypeError thrown out of a
      // keydown listener.
      const target = event.target;
      const typing = target instanceof Element && target.matches("input, textarea, select, [contenteditable='true']");
      const binding = hotkeyOf(event);
      const match = bindings.get(binding);
      if (!match) return;
      // API 1.23: a command may also fire while typing, but only on Ctrl/Cmd or Alt chords —
      // never plain keys or Shift+letter, which are someone's text.
      if (typing && !(match.command.whileTyping && /(^|\+)(mod|ctrl|alt|meta)(\+|$)/iu.test(binding))) return;
      event.preventDefault();
      try {
        void Promise.resolve(match.command.execute()).catch(() => {});
      } catch {
        // A throwing command must not take the keyboard down with it.
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [snapshots, overrides]);
}

// ---------- D16: overlays ----------

/**
 * Clean a plugin-supplied string before it appears in Core's own chrome.
 *
 * Mirrors `dialog_safe` in Rust, which does this for the native install
 * warning. Bidi format characters can reorder a line so it reads as the
 * opposite of what it says, and control characters can blank or split it —
 * on a surface the user reads as coming from the app.
 */
/** Display name of an installed plugin, falling back to its id. */
function pluginNameOf(pluginId: string): string {
  const context = coreHost.getPluginContext(pluginId);
  return overlaySafe(context?.manifest.name ?? pluginId, 60);
}

function overlaySafe(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[ --‎‏‪-‮⁦-⁩]/g, "")
    .slice(0, max);
}

type Overlay =
  | { kind: "notice"; key: number; pluginId: string; message: string; action?: { label: string; onSelect(): void | Promise<void> } }
  | { kind: "modal"; key: number; title: string; mount: ViewMount; pluginId: string }
  | { kind: "menu"; key: number; items: MenuItem[]; at: { x: number; y: number } }
  | { kind: "suggest"; key: number; entries: Array<{ label: string; value: unknown }>; placeholder?: string; resolve(value: unknown | null): void }
  | { kind: "confirm"; key: number; pluginId: string; message: string; title?: string; confirmLabel?: string; danger?: boolean; resolve(value: boolean): void };

let overlays: Overlay[] = [];
let nextKey = 1;
const overlayListeners = new Set<() => void>();

function publish() {
  overlays = [...overlays];
  for (const listener of overlayListeners) listener();
}

function dismiss(key: number) {
  const removed = overlays.find((overlay) => overlay.key === key);
  overlays = overlays.filter((overlay) => overlay.key !== key);
  // A suggest or confirm that is dismissed rather than chosen must still
  // settle its promise, or the calling plugin waits forever.
  if (removed?.kind === "suggest") removed.resolve(null);
  if (removed?.kind === "confirm") removed.resolve(false);
  publish();
}

/**
 * The overlay implementation handed to the extension host. Stable for the
 * lifetime of the app — the host holds it, so it must not close over React
 * state. Every method receives the calling plugin's id from the host, which
 * is why a plugin cannot open an overlay attributed to a different one.
 */
export const coreOverlayApi: CoreOverlayApi = {
  notice(pluginId, message, options) {
    const key = nextKey++;
    // Capped, and rendered as text, because this is attacker-controlled
    // content on a surface the user reads as coming from the app.
    const action = options?.action && typeof options.action.onSelect === "function"
      ? { label: overlaySafe(options.action.label, 40), onSelect: options.action.onSelect }
      : undefined;
    overlays.push({ kind: "notice", key, pluginId, message: overlaySafe(message, 300), action });
    publish();
    const timeout = window.setTimeout(() => dismiss(key), options?.timeoutMs ?? 4000);
    return { dispose: () => { window.clearTimeout(timeout); dismiss(key); } };
  },
  modal(pluginId, options) {
    const key = nextKey++;
    overlays.push({ kind: "modal", key, title: overlaySafe(options.title, 120), mount: options.mount, pluginId });
    publish();
    return { dispose: () => dismiss(key) };
  },
  menu(_pluginId, items, at) {
    const key = nextKey++;
    // Capped and clamped: an unbounded menu positioned at plugin-chosen
    // coordinates can cover the titlebar with Core-looking labels.
    const safeItems = items.slice(0, 40).map((item) => ({ ...item, label: overlaySafe(item.label, 80) }));
    const clamped = {
      x: Math.max(0, Math.min(Math.round(at.x), window.innerWidth - 200)),
      y: Math.max(0, Math.min(Math.round(at.y), window.innerHeight - 80)),
    };
    overlays.push({ kind: "menu", key, items: safeItems, at: clamped });
    publish();
    return { dispose: () => dismiss(key) };
  },
  suggest<T>(_pluginId: string, items: T[], render: (item: T) => string, options?: { placeholder?: string }): Promise<T | null> {
    const key = nextKey++;
    return new Promise<T | null>((resolve) => {
      overlays.push({
        kind: "suggest",
        key,
        entries: items.slice(0, 500).map((item) => ({ label: overlaySafe(render(item), 200), value: item })),
        placeholder: options?.placeholder,
        resolve: resolve as (value: unknown | null) => void,
      });
      publish();
    });
  },
  // API 1.1. Reuses the same navigation a mounted view already had, so a
  // command can finally open what it just created.
  openObject(_pluginId, id) {
    return bridge.openObject(id);
  },
  // API 1.8. The host has already established that this plugin registered
  // `viewId` — see the comment on `ui.openView` in host.ts — so there is
  // nothing to validate here. Build the same key `corePluginViewItems` builds
  // and let the shell report whether it could go there.
  openView(pluginId, viewId) {
    return bridge.openView(`${pluginId}:${viewId}`);
  },
  // API 1.11. Themed control rendered into the plugin's own element. The
  // option labels are attacker-controlled text — `<Select>` renders them as
  // text nodes and caps the list, same defence as `suggest` above.
  mountSelect(_pluginId, el, options) {
    return mountSelect(el, {
      ...options,
      options: options.options.slice(0, 500).map((option) => ({ ...option, label: overlaySafe(option.label, 200) })),
      placeholder: options.placeholder ? overlaySafe(options.placeholder, 120) : undefined,
    });
  },
  mountDatePicker(_pluginId, el, options) {
    return mountDatePicker(el, options);
  },
  exportFile(_pluginId, filename, content) {
    return writeExport(filename, content);
  },
  exportBinary(_pluginId, filename, dataBase64, _mime) {
    return saveExportBinary(filename, dataBase64);
  },
  // API 1.19. Native "Save As" — the user picks the folder, unlike exportBinary's fixed exports/ folder.
  exportBinaryAs(_pluginId, filename, dataBase64, _mime) {
    return saveExportBinaryAs(filename, dataBase64);
  },
  // API 1.18. Themed "are you sure" dialog. Resolves on choose, Escape or
  // backdrop dismiss (see `dismiss()` above) — never left pending.
  confirm(pluginId, message, options) {
    const key = nextKey++;
    return new Promise<boolean>((resolve) => {
      overlays.push({
        kind: "confirm",
        key,
        pluginId,
        message: overlaySafe(message, 300),
        title: options?.title ? overlaySafe(options.title, 120) : undefined,
        confirmLabel: options?.confirmLabel ? overlaySafe(options.confirmLabel, 40) : undefined,
        danger: options?.danger,
        resolve,
      });
      publish();
    });
  },
  async openSyncConflicts(_pluginId, copyId) {
    await bridge.openSyncConflicts(copyId);
  },
  async openHelp(_pluginId, pageId, slug) {
    bridge.openHelp(typeof pageId === "string" ? pageId : undefined, typeof slug === "string" ? slug : undefined);
  },
  async openPluginSettings(_pluginId, pluginId) {
    bridge.openPluginSettings(pluginId);
  },
  renderMarkdown(_pluginId, markdown) {
    // The editor's renderer escapes raw HTML and draws links as inert spans
    // (data-url, no href). Dropped: the code-block toolbar (editor chrome) and
    // every image — the CSP allows data: images, so Markdown from a plugin
    // could otherwise paint a fake Notible banner (Nib design review, 01.10).
    return renderCoreMarkdown(markdown)
      .replace(/<div class="core-code-toolbar"[\s\S]*?<\/div>/gu, "")
      .replace(/<img\b[^>]*>/gu, "");
  },
};

// ---------- API 1.22: the corner helper slot ----------

const CORNER_CHOICE_KEY = "notible-corner-helper";
const CORNER_CHOICE_EVENT = "notible:corner-helper";

export function useCornerChoice(): [string | null, (next: string | null) => void] {
  const read = () => { try { return localStorage.getItem(CORNER_CHOICE_KEY); } catch { return null; } };
  const [choice, setChoice] = useState<string | null>(read);
  useEffect(() => {
    const update = () => setChoice(read());
    window.addEventListener(CORNER_CHOICE_EVENT, update);
    return () => window.removeEventListener(CORNER_CHOICE_EVENT, update);
  }, []);
  const change = useCallback((next: string | null) => {
    try { if (next === null) localStorage.removeItem(CORNER_CHOICE_KEY); else localStorage.setItem(CORNER_CHOICE_KEY, next); } catch { /* the choice just will not persist */ }
    window.dispatchEvent(new Event(CORNER_CHOICE_EVENT));
  }, []);
  return [choice, change];
}

/** "Notible" in a name is for Notible's own plugins: a stranger's helper
 * called "Notible Updates" is a fake system surface (security review, 01.10). */
const RESERVED_NAME = /notible/iu;

/**
 * The corner box. Bottom-left of the note area, clear of the update card and
 * the notice stack (both bottom-right). Hidden with CSS, never unmounted, while
 * `hidden` is set, so a helper's conversation survives a visit to Settings.
 * Core draws the caption under the box; the plugin cannot remove or restyle it
 * because it is outside the plugin's container.
 */
export function PluginCorner({ hidden, isTrusted }: { hidden: boolean; isTrusted: (pluginId: string) => boolean }) {
  const { t } = useCoreI18n();
  const snapshots = useSyncExternalStore(
    (listener) => { const subscription = coreHost.onChange(listener); return () => subscription.dispose(); },
    () => coreHost.getSnapshot(),
  );
  const [choice] = useCornerChoice();
  const occupant = pickCornerOccupant(cornerCandidates(snapshots), choice);
  const [left, setLeft] = useState(16);
  useEffect(() => {
    const main = document.querySelector<HTMLElement>(".core-main");
    if (!main) return;
    const measure = () => setLeft(Math.round(main.getBoundingClientRect().left) + 16);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  if (!occupant) return null;
  const name = coreHost.getPluginContext(occupant.pluginId)?.manifest.name ?? occupant.pluginId;
  // Notible's own helpers stand alone, just the character (Szymon, 02.10).
  // Anyone else's is captioned, so a stranger's corner box can never pass
  // for part of Notible.
  const trusted = isTrusted(occupant.pluginId);
  const label = RESERVED_NAME.test(name) ? t("Community plugin") : t("{name}, unverified", { name });
  return createPortal(
    <aside className={`core-corner${hidden ? " is-hidden" : ""}`} style={{ left }} aria-label={t("Helper")} data-plugin-id={occupant.pluginId}>
      <div className="core-corner-box">
        <PluginDomMount key={occupant.pluginId} mount={occupant.mount} pluginId={occupant.pluginId} />
      </div>
      {!trusted && <p className="core-corner-caption">{t("Helper · {name} ({id})", { name: label, id: occupant.pluginId })}</p>}
    </aside>,
    document.body,
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps keyboard focus inside a blocking overlay while it is open, and gives it
 * back to whatever had it when the overlay closes.
 *
 * D16 claimed this existed before it did — a plugin "modal" was modal only to
 * the mouse. Tab walked straight out of it into the app behind, which is both
 * an accessibility failure and a trust one: a keyboard user could be typing
 * into Core while a plugin's dialog covered the screen.
 *
 * `key` is the overlay's identity, so the trap re-arms when one overlay
 * replaces another rather than staying pointed at the element that just left.
 */
function useOverlayFocusTrap(key: number | undefined) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (key === undefined || !container) return;
    const previous = document.activeElement as HTMLElement | null;
    // Recomputed on every Tab, never cached: plugin content mounts into the
    // overlay after this runs, and a cached list would ignore all of it.
    const focusable = () => [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null);

    if (!container.contains(document.activeElement)) (focusable()[0] ?? container).focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !container) return;
      const items = focusable();
      const active = document.activeElement as HTMLElement | null;
      const inside = container.contains(active);
      if (items.length === 0) {
        // Nothing to land on, but focus still must not escape.
        event.preventDefault();
        container.focus();
        return;
      }
      const edge = event.shiftKey ? items[0] : items[items.length - 1];
      if (!inside || active === edge) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0]).focus();
      }
    }

    // Capture phase: a plugin's own handler inside the overlay must not be able
    // to swallow Tab and defeat the trap.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [key]);

  return ref;
}

export function CoreOverlayHost() {
  const { t } = useCoreI18n();
  const current = useSyncExternalStore(
    (listener) => { overlayListeners.add(listener); return () => overlayListeners.delete(listener); },
    () => overlays,
  );
  // Notices stack in their own corner and never block, so the surface being
  // shown is the topmost *blocking* overlay. Taking the last of everything
  // meant a notice arriving while a modal was open hid the modal — it stayed
  // alive and reappeared when the notice expired, which reads as a glitch.
  const blocking = current.filter((overlay) => overlay.kind !== "notice");
  const topmost = blocking.length > 0 ? blocking[blocking.length - 1] : undefined;

  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    const blocking = overlays.filter((overlay) => overlay.kind !== "notice");
    const target = blocking.length > 0 ? blocking[blocking.length - 1] : undefined;
    if (target) {
      event.preventDefault();
      dismiss(target.key);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  const notices = current.filter((overlay) => overlay.kind === "notice");
  // Suggest owns its own trap: it is a separate component with its own root.
  const trapRef = useOverlayFocusTrap(topmost && topmost.kind !== "suggest" ? topmost.key : undefined);

  return (
    <>
      {notices.length > 0 && (
        <div className="core-plugin-notice-stack" role="status" aria-live="polite">
          {/* Attribution is not suppressible. A notice reading "Your session
              expired — re-enter your password" is otherwise indistinguishable
              from one Core wrote itself. */}
          {notices.map((notice) => (
            <div className="core-plugin-notice" key={notice.key}>
              <span className="core-plugin-notice-source">{pluginNameOf(notice.pluginId)}</span>
              {notice.message}
              {/* data-plugin: the click counts as the user's gesture in this
                  plugin, so its onSelect may navigate (openPluginSettings). */}
              {notice.action && (
                <button
                  type="button"
                  className="core-plugin-notice-action"
                  data-plugin={notice.pluginId}
                  onClick={(event) => { activateNoticeAction(event.nativeEvent, () => dismiss(notice.key), notice.action!.onSelect); }}
                >{notice.action.label}</button>
              )}
            </div>
          ))}
        </div>
      )}
      {topmost?.kind === "modal" && (
        <div className="core-overlay-backdrop" onMouseDown={() => dismiss(topmost.key)}>
          <div ref={trapRef} tabIndex={-1} className="core-overlay-modal" role="dialog" aria-modal="true" aria-label={topmost.title} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <span><strong>{topmost.title}</strong><small className="core-plugin-notice-source">{pluginNameOf(topmost.pluginId)}</small></span>
              <button type="button" onClick={() => dismiss(topmost.key)} aria-label={t("Close")}>×</button>
            </header>
            <PluginDomMount mount={topmost.mount} pluginId={topmost.pluginId} />
          </div>
        </div>
      )}
      {topmost?.kind === "menu" && (
        <div className="core-overlay-backdrop is-transparent" onMouseDown={() => dismiss(topmost.key)}>
          <div ref={trapRef} tabIndex={-1} className="core-overlay-menu" role="menu" style={{ left: topmost.at.x, top: topmost.at.y }} onMouseDown={(event) => event.stopPropagation()}>
            {topmost.items.map((item: MenuItem) => (
              <button
                type="button"
                role="menuitem"
                key={item.id}
                disabled={item.disabled}
                className={item.separatorBefore ? "has-separator" : undefined}
                onClick={() => { dismiss(topmost.key); void item.onSelect(); }}
              >{item.label}</button>
            ))}
          </div>
        </div>
      )}
      {topmost?.kind === "suggest" && <SuggestOverlay overlay={topmost} />}
      {topmost?.kind === "confirm" && <ConfirmOverlay overlay={topmost} trapRef={trapRef} />}
    </>
  );
}

function ConfirmOverlay({ overlay, trapRef }: { overlay: Extract<Overlay, { kind: "confirm" }>; trapRef: RefObject<HTMLDivElement | null> }) {
  const { t } = useCoreI18n();
  function choose(value: boolean) {
    overlay.resolve(value);
    overlays = overlays.filter((item) => item.key !== overlay.key);
    publish();
  }
  return (
    <div className="core-overlay-backdrop" onMouseDown={() => choose(false)}>
      <div ref={trapRef} tabIndex={-1} className="core-overlay-modal core-overlay-confirm" role="alertdialog" aria-modal="true" aria-label={overlay.title ?? overlay.message} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span><strong>{overlay.title ?? t("Are you sure?")}</strong><small className="core-plugin-notice-source">{pluginNameOf(overlay.pluginId)}</small></span>
          <button type="button" onClick={() => choose(false)} aria-label={t("Close")}>×</button>
        </header>
        <p className="core-overlay-confirm-message">{overlay.message}</p>
        <div className="core-overlay-confirm-actions">
          <button type="button" className="core-button" onClick={() => choose(false)}>{t("Cancel")}</button>
          <button type="button" className={overlay.danger ? "core-button core-button-danger" : "core-button core-button-primary"} onClick={() => choose(true)}>{overlay.confirmLabel ?? t("Confirm")}</button>
        </div>
      </div>
    </div>
  );
}

function SuggestOverlay({ overlay }: { overlay: Extract<Overlay, { kind: "suggest" }> }) {
  const { t } = useCoreI18n();
  const [query, setQuery] = useState("");
  const matches = overlay.entries.filter((entry) => entry.label.toLowerCase().includes(query.trim().toLowerCase()));
  function choose(value: unknown) {
    overlay.resolve(value);
    overlays = overlays.filter((item) => item.key !== overlay.key);
    publish();
  }
  const trapRef = useOverlayFocusTrap(overlay.key);
  return (
    <div className="core-overlay-backdrop" onMouseDown={() => dismiss(overlay.key)}>
      <div ref={trapRef} tabIndex={-1} className="core-overlay-suggest" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <input
          autoFocus
          type="search"
          value={query}
          placeholder={overlay.placeholder ?? "Search…"}
          aria-label={overlay.placeholder ?? "Search"}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && matches[0]) choose(matches[0].value); }}
        />
        <div className="core-overlay-suggest-list">
          {matches.length === 0
            ? <p className="core-overlay-empty">{t("No matches")}</p>
            : matches.map((entry, index) => (
              <button type="button" key={`${entry.label}-${index}`} onClick={() => choose(entry.value)}>{entry.label}</button>
            ))}
        </div>
      </div>
    </div>
  );
}

// ---------- API 1.22: openPluginSettings → the Plugins list ----------

/** How long the Plugins list ignores clicks after a plugin opened it. */
export const PLUGIN_NAVIGATION_INERT_MS = 500;
let pendingPluginSelection: { pluginId: string; at: number } | null = null;
let lastPluginNavigationAt = -Infinity;

/** Core calls this after navigating to Settings → Plugins for a plugin. */
export function requestPluginSelection(pluginId: string) {
  pendingPluginSelection = { pluginId, at: Date.now() };
  lastPluginNavigationAt = Date.now();
  window.dispatchEvent(new Event("notible:select-plugin"));
}

/** The Plugins list takes the pending selection once, on mount or on the event. */
export function takePluginSelection(): string | null {
  const pending = pendingPluginSelection;
  pendingPluginSelection = null;
  return pending ? pending.pluginId : null;
}

/** True right after a plugin-driven open: the user's next click was aimed at
 * whatever was under the cursor before, not at the switch that appeared there. */
export function pluginNavigationInert(): boolean {
  return Date.now() - lastPluginNavigationAt < PLUGIN_NAVIGATION_INERT_MS;
}
