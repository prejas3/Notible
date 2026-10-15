import { Component, useEffect, useState, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import type { SettingsRegistration } from "../../../packages/plugin-api/src/index";
import { tCore as t } from "./core-i18n.ts";

export interface PluginSettingsItem {
  key: string;
  pluginId: string;
  registration: SettingsRegistration;
}

class PluginSettingsErrorBoundary extends Component<{ title: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Notible] plugin settings failed: ${this.props.title}`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <div className="settings-section" role="alert"><h2 className="settings-h2">{this.props.title}</h2><p className="settings-intro">{t("This plugin settings panel failed without stopping Core.")}</p><pre className="core-plugin-error">{this.state.error.message}</pre></div>;
    }
    return this.props.children;
  }
}

function resolveSettingsComponent(module: Record<string, unknown>): ComponentType<{ context: unknown }> | null {
  const candidates = [
    module.default,
    module.PlanningPluginPanel,
    module.AutomationsPluginPanel,
    module.ViewsPluginPanel,
    module.DomainPluginSurface,
    module.BuiltinDomainSettings,
  ];
  return candidates.find((candidate): candidate is ComponentType<{ context: unknown }> => typeof candidate === "function") ?? null;
}

/** Core renderer for opaque public plugin settings descriptors. */
export function PluginSettingsSurface({ item }: { item?: PluginSettingsItem }) {
  const [Component, setComponent] = useState<ComponentType<{ context: unknown }> | null>(null);
  const render = item?.registration.render;

  useEffect(() => {
    let active = true;
    setComponent(null);
    if (render && typeof render === "object" && "component" in render && typeof render.component === "function") {
      const component = render.component as ComponentType<{ context: unknown }>;
      setComponent(() => component);
    } else if (render && typeof render === "object" && "loader" in render && typeof render.loader === "function") {
      void (render.loader as () => Promise<Record<string, unknown>>)()
        .then((module) => {
          if (active) setComponent(() => resolveSettingsComponent(module));
        })
        .catch(() => { if (active) setComponent(null); });
    }
    return () => { active = false; };
  }, [item?.key, render]);

  if (!item) return null;
  if (Component) {
    const context = render && typeof render === "object" && "context" in render ? render.context : undefined;
    return <PluginSettingsErrorBoundary title={item.registration.title}><Component context={context} /></PluginSettingsErrorBoundary>;
  }
  return <div className="settings-section" role="status"><h2 className="settings-h2">{item.registration.title}</h2><p className="settings-intro">{t("The plugin is active, but it has not supplied a renderable settings panel yet.")}</p><small>{item.pluginId}</small></div>;
}
