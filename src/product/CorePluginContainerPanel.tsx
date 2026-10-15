import { useEffect, useMemo, useRef, useState } from "react";
import { PluginViewRegistrationSurface, type PluginViewHostBridge, type PluginViewItem } from "../core/app/PluginViewSurface";
import { coreHost } from "../core/app/CoreOnlyApp";
import { SlidersHorizontal } from "lucide-react";
import { useCoreI18n } from "../core/app/core-i18n";
import { coreDataApi } from "../core/data/core-data-api";
import type { ObjectTabRegistration } from "../core/extensions/types";
import { availableModules, filterTabsByModules, normaliseModules } from "./container-modules";
import { ContainerModulePicker } from "./ContainerModulePicker";

const CONTAINER_KINDS = ["project", "folder", "space"];

/** Read a container's persisted `props._modules`; an absent or malformed value
 * means "show every tab" (back-compat) and comes back as `undefined`. */
function parseEnabledModules(props: string | null | undefined): string[] | undefined {
  try {
    const mods = (JSON.parse(props || "{}") as { _modules?: unknown })._modules;
    return Array.isArray(mods) && mods.every((m) => typeof m === "string") ? (mods as string[]) : undefined;
  } catch {
    return undefined;
  }
}

/** A builtin tab names one of its plugin's registered views; a third-party tab
 * has only the public `mount`. Both arrive through the same registration. */
type RegisteredTab = ObjectTabRegistration & { viewId?: string; viewProps?: Record<string, unknown>; description?: string; defaultFor?: string[] };
type TabItem = { pluginId: string; tab: RegisteredTab };

/**
 * Which plugin renders a folder/project/whiteboard/space is now a question the
 * plugins answer, not Core.
 *
 * Until 0.55.0 this file held a `surfaceFor()` map from object type to plugin
 * id ("project" -> notible.planning, ...), so adding a screen to a project
 * meant editing Core rather than the plugin contributing the screen. That map
 * is gone; `scripts/core-collection-check.mjs` fails if a plugin id literal
 * reappears in this file.
 */
function objectTabsFor(objectType: string, enabled?: string[]): TabItem[] {
  const all = coreHost.getSnapshot()
    .flatMap((snapshot) => ((snapshot.objectTabs ?? []) as RegisteredTab[]).map((tab) => ({ pluginId: snapshot.pluginId, tab })))
    .filter(({ tab }) => tab.objectTypes.includes(objectType as never))
    // `order` decides, `id` breaks ties — deliberately not `label`, which is
    // translatable and would make tab order depend on the interface language.
    .sort((left, right) => (left.tab.order ?? 50) - (right.tab.order ?? 50) || left.tab.id.localeCompare(right.tab.id));
  return filterTabsByModules(all, enabled);
}

function registeredView(pluginId: string, viewId: string): PluginViewItem | undefined {
  const registration = coreHost.getSnapshot(pluginId)[0]?.views.find((view) => view.id === viewId);
  return registration ? { key: `${pluginId}:${registration.id}`, pluginId, registration } : undefined;
}

/** A third-party tab renders through the public `mount(element, context)`.
 * Its own try/catch is not optional: PluginViewErrorBoundary catches a React
 * render, not a throw out of an imperative mount. */
function ObjectTabMount({ item, objectId, objectType }: { item: TabItem; objectId: string; objectType: string }) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState("");
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    setFailed("");
    element.replaceChildren();
    let disposable: { dispose?: () => void } | void;
    try {
      disposable = item.tab.mount(element, { objectId, objectType }) as { dispose?: () => void } | void;
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
      return;
    }
    return () => {
      try { disposable?.dispose?.(); } catch { /* a plugin that throws on the way out must not take the screen with it */ }
      element.replaceChildren();
    };
  }, [item, objectId, objectType]);
  if (failed) return <div className="core-container-slot-empty"><p>{item.pluginId} could not render this tab: {failed}</p></div>;
  return <div className="core-container-slot" ref={holder} />;
}

export function CorePluginContainerPanel({
  objectType,
  containerId,
  onOpenObject,
}: {
  objectType: string;
  containerId: string;
  onOpenObject: (id: string) => Promise<void>;
}) {
  const { t } = useCoreI18n();
  const [enabledModules, setEnabledModules] = useState<string[] | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const showModulesButton = CONTAINER_KINDS.includes(objectType);

  // The container's own `props._modules` decides which tabs the strip shows.
  // Reload it when the container changes and whenever the workspace signals a
  // change (the picker below dispatches that event after it writes).
  useEffect(() => {
    let cancelled = false;
    // Drop the previous container's set immediately: until the async read
    // resolves the strip falls back to "all tabs" rather than filtering B by A.
    setEnabledModules(undefined);
    const readModules = () =>
      coreDataApi.objects.get(containerId).then((object) => {
        if (cancelled || !object) return;
        setEnabledModules(parseEnabledModules(object.props));
      });
    void readModules();
    const refresh = () => { void readModules(); };
    window.addEventListener("notible:workspace-changed", refresh);
    return () => { cancelled = true; window.removeEventListener("notible:workspace-changed", refresh); };
  }, [containerId]);

  const [tabs, setTabs] = useState<TabItem[]>(() => objectTabsFor(objectType, enabledModules));
  useEffect(() => {
    const refresh = () => setTabs(objectTabsFor(objectType, enabledModules));
    refresh();
    return coreHost.onChange(refresh).dispose;
  }, [objectType, enabledModules]);

  // Per object and persistent, like the container view choice in
  // ContainerView.tsx — reopening a project should land where you left it.
  const storageKey = `notible.objectTab.${containerId}`;
  const [activeId, setActiveId] = useState<string>(() => localStorage.getItem(storageKey) ?? "");
  useEffect(() => { setActiveId(localStorage.getItem(storageKey) ?? ""); }, [storageKey]);

  // A stored tab whose plugin has since been switched off must fall back, not
  // leave an empty screen.
  const active = useMemo(() => tabs.find(({ tab }) => tab.id === activeId) ?? tabs[0], [tabs, activeId]);

  function selectTab(id: string) {
    setActiveId(id);
    localStorage.setItem(storageKey, id);
  }

  // The tab strip (with the "Modules" editor button) and the picker are shared
  // between the normal render and the `!active` fallback below — a container
  // whose module set has been emptied has no active tab, but must still let the
  // user reopen the editor and turn tabs back on. So they are built once here.
  const modulesBar = (tabs.length > 1 || showModulesButton) ? (
    <div className="core-object-tabbar">
    {/* The tabs scroll on their own (wheel too) with a fade, never a bare
        scrollbar; Modules sits outside them, so it is never cut off (V-SURFACES-04). */}
    <div className="core-object-tabs" role="tablist" onWheel={(event) => { if (event.deltaY && !event.deltaX) event.currentTarget.scrollLeft += event.deltaY; }}>
      {tabs.map(({ tab }) => <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={tab.id === active?.tab.id}
        className={tab.id === active?.tab.id ? "is-active" : ""}
        onClick={() => selectTab(tab.id)}
      >{tab.label}</button>)}
    </div>
      {showModulesButton && <>
        <button
          type="button"
          className="core-object-tabs-modules"
          onClick={() => setPickerOpen(true)}
          title={t("Modules")}
          aria-label={t("Modules: choose what this shows")}
        ><SlidersHorizontal size={13} aria-hidden="true" /> {t("Modules")}</button>
      </>}
    </div>
  ) : null;

  const picker = (pickerOpen && showModulesButton) ? (
    <ContainerModulePicker
      objectKind={objectType as "project" | "folder" | "space"}
      // Absent `_modules` means "every tab is on" (see parseEnabledModules) —
      // preselect all of them here too, not just the newborn-container defaults,
      // or the checkboxes would show fewer tabs enabled than are actually shown.
      initialSelection={enabledModules ? normaliseModules(enabledModules) : availableModules(coreHost.getSnapshot(), objectType).map((row) => row.id)}
      onCancel={() => setPickerOpen(false)}
      onConfirm={async (moduleIds) => {
        try {
          const current = await coreDataApi.objects.get(containerId);
          if (!current) return;
          const props = JSON.parse(current.props || "{}") as Record<string, unknown>;
          // An empty selection degrades to the back-compat "all tabs" — omit
          // the key rather than persisting `_modules: []`.
          if (moduleIds.length === 0) delete props._modules;
          else props._modules = moduleIds;
          await coreDataApi.objects.update(containerId, { props: JSON.stringify(props) }, current.updated_at);
          setEnabledModules(moduleIds.length ? moduleIds : undefined);
          setPickerOpen(false);
          window.dispatchEvent(new Event("notible:workspace-changed"));
        } catch (error) {
          // Leave the picker open so the choice is not lost silently.
          console.error("Could not save modules", error);
        }
      }}
    />
  ) : null;

  if (!active) {
    return <>
      {modulesBar}
      {picker}
      <div className="core-container-slot-empty"><p>{t("No active plugin contributes a view for this object type. It still saves as a plain note in the meantime.")}</p></div>
    </>;
  }

  const host: PluginViewHostBridge = {
    openObject: async (id) => { await onOpenObject(id); },
    notifyChanged: () => window.dispatchEvent(new Event("notible:workspace-changed")),
  };

  const view = active.tab.viewId ? registeredView(active.pluginId, active.tab.viewId) : undefined;

  return <>
    {modulesBar}
    {picker}
    {view
      ? <div className="core-container-slot" key={active.tab.id}><PluginViewRegistrationSurface item={view} host={host} viewProps={{ initialContainerId: containerId, ...(active.tab.viewProps ?? {}) }} /></div>
      : <ObjectTabMount key={active.tab.id} item={active} objectId={containerId} objectType={objectType} />}
  </>;
}
