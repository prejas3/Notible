import { useEffect, useState } from "react";
import { PluginViewRegistrationSurface, type PluginViewHostBridge, type PluginViewItem } from "../core/app/PluginViewSurface";
import { coreHost } from "../core/app/CoreOnlyApp";

function registeredView(pluginId: string, viewId: string): PluginViewItem | undefined {
  const registration = coreHost.getSnapshot(pluginId)[0]?.views.find((view) => view.id === viewId);
  return registration ? { key: `${pluginId}:${registration.id}`, pluginId, registration } : undefined;
}

/** Right-side properties panel for the currently open record, bound to
 * coreHost (Test Host's own ExtensionHost), same pattern as
 * CorePluginContainerPanel. Renders nothing when notible.properties isn't
 * active — CoreOnlyApp only renders this slot at all when it's set, so
 * Core-only-without-plugins is unaffected either way. */
export function CorePluginPropertiesPanel({ objectId }: { objectId: string; objectType: string }) {
  const pluginId = "notible.properties";
  const [item, setItem] = useState<PluginViewItem | undefined>(() => registeredView(pluginId, "panel"));
  useEffect(() => {
    const refresh = () => setItem(registeredView(pluginId, "panel"));
    refresh();
    return coreHost.onChange(refresh).dispose;
  }, []);

  if (!item) return null;

  const host: PluginViewHostBridge = {
    openObject: async () => {},
    notifyChanged: () => window.dispatchEvent(new Event("notible:workspace-changed")),
  };
  return <PluginViewRegistrationSurface item={item} host={host} viewProps={{ initialContainerId: objectId }} />;
}
