import { tCore } from "./core-i18n.ts";
import { Component, useEffect, useState, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import type { ViewRegistration } from "../../../packages/plugin-api/src/index";
import { extensionHost } from "../extensions/runtime";
import { useI18n } from "../../lib/i18n";
import { getObject, type NObject } from "../../lib/api";
import { PluginDomMount } from "./CorePluginSurfaces";

export interface PluginViewItem {
  key: string;
  pluginId: string;
  registration: ViewRegistration;
}

export interface PluginViewHostBridge {
  openObject(id: string): Promise<void>;
  notifyChanged(): void;
}

function registeredViews(): PluginViewItem[] {
  return extensionHost.getSnapshot().flatMap((snapshot) => snapshot.views.map((registration) => ({
    key: `${snapshot.pluginId}:${registration.id}`,
    pluginId: snapshot.pluginId,
    registration,
  })));
}

function registeredView(pluginId: string, viewId = "surface"): PluginViewItem | undefined {
  return registeredViews().find((item) => item.pluginId === pluginId && item.registration.id === viewId);
}

/** Core host for plugin-owned view surfaces. Legacy views remain available in
 * the normal workspace until their equivalence row is explicitly migrated. */
export function PluginViewsSurface({ onClose, onOpenObject }: { onClose?: () => void; onOpenObject?: (object: NObject) => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<PluginViewItem[]>(registeredViews);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setItems(registeredViews());
    refresh();
    return extensionHost.onChange(refresh).dispose;
  }, []);

  useEffect(() => {
    if (!items.some((item) => item.key === selectedKey)) setSelectedKey(items[0]?.key ?? null);
  }, [items, selectedKey]);

  const selected = items.find((item) => item.key === selectedKey);
  return (
    <section className="plugin-view-host" data-plugin-view-host>
      <header className="plugin-view-host-header">
        <div>
          <p className="settings-plugins-eyebrow">Core extension host</p>
          <h1 className="settings-h2">Plugin surfaces</h1>
          <p className="settings-intro">Rendered by Core from public plugin registrations. Legacy workspace views remain available for comparison.</p>
        </div>
        {onClose && <button type="button" className="btn-icon" onClick={onClose} aria-label={t("Close")}>×</button>}
      </header>
      <div className="plugin-view-host-body">
        <nav className="plugin-view-host-nav" aria-label={t("Plugins")}>
          {items.map((item) => (
            <button
              type="button"
              key={item.key}
              className={item.key === selectedKey ? "active" : ""}
              onClick={() => setSelectedKey(item.key)}
            >
              <span>{item.registration.title}</span>
              <small>{item.pluginId}</small>
            </button>
          ))}
          {items.length === 0 && <p className="settings-intro">No plugin views are active.</p>}
        </nav>
        <div className="plugin-view-host-content">
          <PluginViewRegistrationSurface
            item={selected}
            host={{
              openObject: async (id) => {
                const object = await getObject(id);
                if (object) onOpenObject?.(object);
              },
              notifyChanged: () => window.dispatchEvent(new Event("notible:workspace-changed")),
            }}
          />
        </div>
      </div>
    </section>
  );
}

type PluginViewComponentProps = { context: unknown; host?: PluginViewHostBridge; initialContainerId?: string };

class PluginViewErrorBoundary extends Component<{ title: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Notible] plugin view failed: ${this.props.title}`, error, info.componentStack);
  }

  render() {
    if (this.state.error) return <div className="settings-section" role="alert"><h2 className="settings-h2">{this.props.title}</h2><p className="settings-intro">{tCore("This plugin view failed without stopping Core.")}</p><pre className="core-plugin-error">{this.state.error.message}</pre></div>;
    return this.props.children;
  }
}

function resolveViewComponent(module: Record<string, unknown>): ComponentType<PluginViewComponentProps> | null {
  const candidates = [module.default, module.BuiltinDomainView, module.PlanningPluginPanel, module.AutomationsPluginPanel, module.ViewsPluginPanel];
  return candidates.find((candidate): candidate is ComponentType<PluginViewComponentProps> => typeof candidate === "function") ?? null;
}

export function PluginViewRegistrationSurface({ item, host, viewProps }: { item?: PluginViewItem; host?: PluginViewHostBridge; viewProps?: Omit<PluginViewComponentProps, "context" | "host"> }) {
  const [Component, setComponent] = useState<ComponentType<PluginViewComponentProps> | null>(null);
  const [failed, setFailed] = useState(false);
  const render = item?.registration.render;

  useEffect(() => {
    let active = true;
    setComponent(null);
    setFailed(false);
    if (render && typeof render === "object" && "component" in render && typeof render.component === "function") {
      const component = render.component as ComponentType<PluginViewComponentProps>;
      setComponent(() => component);
    } else if (render && typeof render === "object" && "loader" in render && typeof render.loader === "function") {
      void (render.loader as () => Promise<Record<string, unknown>>)()
        .then((module) => {
          if (!active) return;
          const component = resolveViewComponent(module);
          if (component) setComponent(() => component);
          else setFailed(true);
        })
        .catch(() => { if (active) setFailed(true); });
    }
    return () => { active = false; };
  }, [item?.key, render]);

  if (!item) return <div className="settings-section"><p className="settings-intro">Select an active plugin view.</p></div>;

  // A view registered through the *public* contract renders itself into a
  // plain element. Until this branch existed, `mount` worked for slots and
  // modals but a full view had nowhere to go — which is the first thing that
  // surfaced when a real product surface was moved onto the public API.
  if (item.registration.mount) {
    return (
      <PluginDomMount
        mount={item.registration.mount}
        pluginId={item.pluginId}
        containerId={viewProps?.initialContainerId}
      />
    );
  }

  if (Component) {
    const context = render && typeof render === "object" && "context" in render ? render.context : undefined;
    return <PluginViewErrorBoundary title={item.registration.title}><Component context={context} host={host} {...viewProps} /></PluginViewErrorBoundary>;
  }
  if (failed) return <div className="settings-section" role="alert"><h2 className="settings-h2">{item.registration.title}</h2><p className="settings-intro">{tCore("The plugin view could not be loaded.")}</p></div>;
  return <div className="settings-section"><h2 className="settings-h2">{item.registration.title}</h2><p className="settings-intro">{tCore("Loading plugin surface…")}</p></div>;
}

/** Core-owned adapter for mounting one plugin view in the real object flow.
 * The URL-gated migration path uses this component while the legacy
 * ContainerView remains available as an explicit fallback. */
export function PluginContainerView({
  containerId,
  onOpenObject,
  onUseLegacy,
}: {
  containerId: string;
  onOpenObject: (id: string) => void;
  onUseLegacy: () => void;
}) {
  return <PluginContainerSurface pluginId="notible.views" containerId={containerId} onOpenObject={onOpenObject} onUseLegacy={onUseLegacy} />;
}

/** Core-owned generic container host for a plugin domain surface. The plugin
 * receives only its public context plus navigation/refresh and can be tested
 * in the real record flow without importing legacy UI. */
export function PluginContainerSurface({
  pluginId,
  containerId,
  onOpenObject,
  onUseLegacy,
}: {
  pluginId: string;
  containerId: string;
  onOpenObject?: (id: string) => void;
  onUseLegacy: () => void;
}) {
  const [item, setItem] = useState<PluginViewItem | undefined>(() => registeredView(pluginId));
  useEffect(() => {
    const refresh = () => setItem(registeredView(pluginId));
    refresh();
    return extensionHost.onChange(refresh).dispose;
  }, [pluginId]);
  const host: PluginViewHostBridge = {
    openObject: async (id) => {
      const object = await getObject(id);
      if (object) onOpenObject?.(object.id);
    },
    notifyChanged: () => window.dispatchEvent(new Event("notible:workspace-changed")),
  };
  return <section className="plugin-container-view" data-plugin-container-view={pluginId}>
    <div className="plugin-container-view-toolbar"><span>Plugin-owned container view</span><button type="button" className="btn-icon" onClick={onUseLegacy}>Use legacy view</button></div>
    {item ? <PluginViewRegistrationSurface item={item} host={host} viewProps={{ initialContainerId: containerId }} /> : <div className="settings-section" role="alert"><p className="settings-intro">The {pluginId} plugin is not active.</p><button type="button" className="btn-primary" onClick={onUseLegacy}>Use legacy view</button></div>}
  </section>;
}
