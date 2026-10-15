const layouts = ["canvas", "list", "table", "kanban", "calendar", "form"];
const readProps = (value) => { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } };
async function ensureDefault(context, input) {
  const containerId = input && typeof input === "object" ? input.containerId : undefined;
  if (typeof containerId !== "string" || !containerId) throw new Error("containerId is required");
  const current = await context.data.objects.get(containerId);
  if (!current) throw new Error(`Container not found: ${containerId}`);
  const props = readProps(current.props);
  if (Array.isArray(props._views) && props._views.length > 0) return { pluginId: context.manifest.id, containerId, created: false, views: props._views };
  const requested = input && typeof input === "object" ? input.layout : undefined;
  const layout = layouts.includes(requested) ? requested : "canvas";
  const views = [{ id: "default", name: "Main", layout }];
  await context.data.objects.update(current.id, { props: JSON.stringify({ ...props, _views: views }) }, current.updated_at);
  return { pluginId: context.manifest.id, containerId, created: true, views };
}
export default {
  manifest: { id: "notible.views", name: "Views and Dashboards", version: "0.1.0", apiVersion: "0.1", permissions: ["data.read", "data.write", "workspace.ui"] },
  onload(context) {
    context.commands.register({ id: "status", name: "Ensure default view", execute: (input) => ensureDefault(context, input) });
    context.views.register({ id: "surface", title: "Views", render: { kind: "builtin-surface", capability: "views", layouts } });
    context.settings.register({ id: "settings", title: "Views settings", render: { kind: "builtin-settings", capability: "views", layouts } });
    context.ui.registerSlot("workspace.sidebar", { id: "sidebar-entry", render: { kind: "builtin-sidebar-entry", capability: "views" } });
  },
};
