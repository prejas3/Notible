import type { PluginContext } from "../../packages/plugin-api/src/index.ts";
import { createBuiltinSurface } from "./scaffold.ts";
import { getThemePackState, selectThemePack, useThemePacks, type ThemePackInfo } from "../../src/core/app/themePacks.ts";
import { fetchThemeSources, repoFromInput, type ThemeSource } from "../../src/core/app/marketSource.ts";

// The Themes screen reaches Core only through this file.
export { useThemePacks, fetchThemeSources, repoFromInput };
export type { ThemeSource };

/**
 * Themes is only for community themes: styles-only packages anyone can publish.
 * The two system themes, Daylight and Midnight, are part of the app and are
 * chosen in Settings > Appearance; nothing here touches them.
 *
 * A pack is picked by its package id, or `null` for none. Core sanitises and
 * applies it (see src/core/app/themeCss.ts).
 */
export function selectTheme(context: PluginContext, input?: unknown) {
  const requested = input && typeof input === "object" ? (input as { themeId?: unknown }).themeId : input;
  const id = typeof requested === "string" && requested ? requested : null;
  if (id && !getThemePackState().packs.some((pack) => pack.id === id)) throw new Error(`No installed theme pack: ${id}`);
  selectThemePack(id);
  return { pluginId: context.manifest.id, theme: id };
}

/** The theme pack in use, or null when only the system theme is showing. */
export function activeTheme(): ThemePackInfo | null {
  const { packs, activeId } = getThemePackState();
  return packs.find((pack) => pack.id === activeId) ?? null;
}

export const themesPlugin = createBuiltinSurface({
  manifest: { id: "notible.themes", name: "Themes", version: "0.2.0", apiVersion: "0.1", entry: "index.ts", description: "Install and switch community themes: styles-only packs that can change colours, backgrounds, glass effects and more.", permissions: ["workspace.ui"], sync: "settings" },
  capability: "themes",
  commandName: "Select theme",
  viewTitle: "Themes",
  settingsTitle: "Themes settings",
  onCommand: selectTheme,
  viewRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
  settingsRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
});
