import type {
  CodeBlockRenderer,
  CodeBlockRendererOptions,
  ObjectTabType,
  CommandRegistration,
  NotiblePlugin,
  PluginManifest,
  PluginContext,
  SettingsSchema,
  ViewMount,
} from "../../packages/plugin-api/src/index.ts";

export interface BuiltinSurfaceDefinition {
  manifest: PluginManifest;
  capability: string;
  commandName: string;
  viewTitle: string;
  /** Optional since 0.55.0. A surface whose configuration belongs on the
   * object it configures (automations, calendar) registers an object tab
   * instead of a panel in Settings, and simply omits this. */
  settingsTitle?: string | ((translate: PluginContext["i18n"]["t"]) => string);
  commands?: Array<Pick<CommandRegistration, "id" | "name" | "description" | "creates"> & { execute: (context: PluginContext, input?: unknown) => unknown | Promise<unknown> }>;
  onCommand?: (context: PluginContext, input?: unknown) => unknown | Promise<unknown>;
  viewRender?: (context: PluginContext) => unknown;
  settingsRender?: (context: PluginContext) => unknown;
  /** Extra named views beyond the default "surface" one, e.g. a
   * container-scoped dashboard mounted by CorePluginContainerPanel for a
   * specific object type. */
  /**
   * `render` is the privileged React path; `mount` is the public contract a
   * third-party plugin would use. A builtin may choose either — and the
   * workspace dashboard deliberately chooses `mount`, so at least one shipped
   * surface proves the public API can carry real product UI.
   */
  extraViews?: Array<{ id: string; title: string; render?: (context: PluginContext) => unknown; mount?: ViewMount }>;
  /** Code-block renderers, keyed by fence language. Requires
   * `editor.extension` in the manifest, like any third-party plugin. */
  codeBlocks?: Array<{ language: string; render: CodeBlockRenderer; toSvg?: CodeBlockRendererOptions["toSvg"] }> | ((context: PluginContext) => Array<{ language: string; render: CodeBlockRenderer; toSvg?: CodeBlockRendererOptions["toSvg"] }>);
  settingsSchema?: (translate: PluginContext["i18n"]["t"]) => SettingsSchema;
  /**
   * Tabs on a container object's screen (API 1.5). `viewId` names one of this
   * plugin's registered views — a builtin renders through the host's React
   * path, so the public `mount` stays a no-op marker here rather than becoming
   * a second rendering path nobody exercises.
   *
   * Builtins take order < 10 so they always sort before third-party tabs.
   */
  objectTabs?: Array<{ id: string; label: string; description?: string; objectTypes: Array<ObjectTabType | (string & {})>; defaultFor?: Array<"project" | "folder" | "space">; order?: number; viewId: string; viewProps?: Record<string, unknown> }>;
  /** Runs once at plugin load — app startup, not view mount — and keeps
   * whatever it sets up (an events.on subscription, a setInterval) alive for
   * the plugin's whole lifetime. This is the one place a builtin can react to
   * things happening while its own screen isn't open. An events.on
   * subscription is disposed automatically on unload; anything else this
   * sets up (a timer, chiefly) is not, so return a cleanup function for it. */
  onActivate?: (context: PluginContext) => (() => void) | void;
}

/** Product-only lazy surface. The package entrypoints stay dependency-free. */
export function builtinSettingsRender(context: PluginContext) {
  return { kind: "react-loader", loader: () => import("./builtin-domain-ui"), context };
}

/** Product-only lazy view surface. The host owns React mounting; the plugin
 * owns the actual domain component and its public DataApi calls. */
export function builtinViewRender(context: PluginContext) {
  return { kind: "react-loader", loader: () => import("./builtin-domain-view-ui"), context };
}

/**
 * Small, dependency-free builtin surface used while domain migrations are in
 * progress. Each real plugin owns its manifest and entrypoint; this helper
 * only proves that the entrypoint can be loaded, registered and unloaded
 * through the public plugin contract without importing Core UI or SQLite.
 */
export function createBuiltinSurface(definition: BuiltinSurfaceDefinition): NotiblePlugin {
  let deactivate: (() => void) | void;
  return {
    manifest: definition.manifest,
    onload(context) {
      context.storage.set("lifecycle", "ready");
      context.commands.register({
        id: "status",
        name: definition.commandName,
        description: `Show ${definition.capability} status`,
        execute: (input) => definition.onCommand
          ? definition.onCommand(context, input)
          : ({
              pluginId: context.manifest.id,
              capability: definition.capability,
              input: input ?? null,
              ready: context.storage.get<string>("lifecycle") === "ready",
            }),
      });
      for (const command of definition.commands ?? []) {
        context.commands.register({
          id: command.id,
          name: command.name,
          description: command.description,
          creates: command.creates,
          execute: (input) => command.execute(context, input),
        });
      }
      context.views.register({
        id: "surface",
        title: definition.viewTitle,
        render: definition.viewRender?.(context) ?? builtinViewRender(context),
      });
      for (const view of definition.extraViews ?? []) {
        context.views.register({
          id: view.id,
          title: view.title,
          ...(view.mount ? { mount: view.mount } : { render: view.render?.(context) }),
        });
      }
      for (const tab of definition.objectTabs ?? []) {
        context.views.registerObjectTab({
          id: tab.id,
          label: tab.label,
          description: tab.description,
          objectTypes: tab.objectTypes,
          defaultFor: tab.defaultFor,
          order: tab.order ?? 5,
          mount: () => {},
          viewId: tab.viewId,
          viewProps: tab.viewProps,
        } as never);
      }
      if (definition.settingsTitle) {
        context.settings.register({
          id: "settings",
          title: typeof definition.settingsTitle === "function" ? definition.settingsTitle(context.i18n.t) : context.i18n.t(definition.settingsTitle),
          ...(definition.settingsSchema
            ? { schema: definition.settingsSchema(context.i18n.t) }
            : { render: definition.settingsRender?.(context) ?? { kind: "builtin-settings", capability: definition.capability } }),
        });
      }
      const codeBlocks = typeof definition.codeBlocks === "function" ? definition.codeBlocks(context) : definition.codeBlocks ?? [];
      for (const block of codeBlocks) {
        context.editor.registerCodeBlockRenderer(block.language, block.render, { toSvg: block.toSvg });
      }
      context.ui.registerSlot("workspace.sidebar", {
        id: "sidebar-entry",
        render: { kind: "builtin-sidebar-entry", capability: definition.capability },
      });
      deactivate = definition.onActivate?.(context);
    },
    onunload() {
      // Registrations and storage lifecycle are cleaned by ExtensionHost;
      // onActivate's own cleanup (a timer, typically) is not.
      deactivate?.();
      deactivate = undefined;
    },
  };
}
