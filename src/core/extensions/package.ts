import { validatePluginManifest } from "./manifest.ts";
import type { LocalPluginArtifact } from "./manager.ts";
import type { NotiblePlugin, PluginManifest } from "./types";

export interface PluginPackageReader {
  readText(path: string): Promise<string>;
  /**
   * URL the host can import `path` from as an ES module, or null when the
   * host has no such channel (the dev-mock browser harness). See
   * `importModule` for why a URL is preferred over the source text.
   */
  scriptUrl?(path: string): string | null;
}

/**
 * A path inside a plugin package, checked component by component.
 *
 * The twin of `safe_package_path` in `src-tauri/src/plugins.rs` and it must
 * stay in step with it. Both used to reject only `..`, an empty component and
 * a leading `/` — a rule that is complete on POSIX and full of holes on
 * Windows, where a drive-prefixed component (`C:/x`, `C:x`) makes a join
 * *replace* its base rather than extend it, and `name:stream` names an NTFS
 * alternate data stream. Rejecting `:` closes both.
 */
export function isSafePluginPackagePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized.length > 0
    && !normalized.startsWith("/")
    && normalized.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.includes(":") && !part.includes("\0"));
}

/**
 * Import a plugin entry as an ES module.
 *
 * A `data:` URL is an opaque origin, so `script-src 'self'` refuses it and
 * this import rejects in every packaged build — which is why no third-party
 * plugin has ever loaded outside the dev server. When the host offers a
 * script URL (the `plugin:` scheme, served from Rust with the same
 * containment as any other plugin file read), import from that instead.
 *
 * The `data:` path stays only for the dev-mock browser harness, which has no
 * Tauri runtime and no CSP.
 */
async function importModule(
  reader: PluginPackageReader,
  path: string,
): Promise<unknown> {
  const url = reader.scriptUrl?.(path);
  if (url) return import(/* @vite-ignore */ url);
  const source = await reader.readText(path);
  const fallback = `data:text/javascript;charset=utf-8,${encodeURIComponent(`${source}\n//# sourceURL=${path}`)}`;
  return import(/* @vite-ignore */ fallback);
}

/** A package may declare at most this many stylesheets. */
export const MAX_PLUGIN_STYLESHEETS = 16;

/**
 * Read the stylesheets a package declares.
 *
 * Containment is the reader's job, not a check here: the directory loader
 * routes every path through `childPath`, and Rust re-checks against the
 * granted roots. This adds the two things the reader cannot know — that a
 * declared style must actually be CSS, and that there is a ceiling on how
 * many of them a manifest can name.
 */
async function loadStyles(reader: PluginPackageReader, manifest: PluginManifest) {
  const declared = manifest.styles ?? [];
  if (declared.length > MAX_PLUGIN_STYLESHEETS) {
    throw new Error(`plugin declares too many stylesheets (${declared.length} > ${MAX_PLUGIN_STYLESHEETS}): ${manifest.id}`);
  }
  const styles: Array<{ path: string; css: string }> = [];
  for (const path of declared) {
    if (!isSafePluginPackagePath(path)) {
      throw new Error(`plugin path must stay inside package: ${path}`);
    }
    if (!/\.css$/i.test(path)) {
      throw new Error(`plugin stylesheets must be .css files: ${path}`);
    }
    styles.push({ path, css: await reader.readText(path) });
  }
  return styles;
}

/** A package may ship at most this many languages. */
export const MAX_PLUGIN_LOCALES = 24;

/**
 * Read the translations a package ships.
 *
 * **A plugin may only translate itself.** The namespace is forced to the
 * plugin's own id here rather than taken from the file, so a package cannot
 * ship a `core`/`app` namespace and quietly retranslate the application's own
 * UI — including the sentences that warn a user before they destroy data.
 * Nothing about that rule is left to documentation.
 */
async function loadLocales(reader: PluginPackageReader, manifest: PluginManifest) {
  const declared = Object.entries(manifest.locales ?? {});
  if (declared.length > MAX_PLUGIN_LOCALES) {
    throw new Error(`plugin declares too many locales (${declared.length} > ${MAX_PLUGIN_LOCALES}): ${manifest.id}`);
  }
  const locales: Record<string, Record<string, string>> = {};
  for (const [language, path] of declared) {
    if (!/^[A-Za-z0-9-]{1,12}$/.test(language)) {
      throw new Error(`plugin declares an unusable language tag: ${language}`);
    }
    if (!isSafePluginPackagePath(path) || !/\.json$/i.test(path)) {
      throw new Error(`plugin locales must be .json files inside the package: ${path}`);
    }
    const parsed = JSON.parse(await reader.readText(path)) as unknown;
    const strings = (parsed as { strings?: unknown } | null)?.strings;
    if (!strings || typeof strings !== "object") {
      throw new Error(`plugin locale has no strings object: ${path}`);
    }
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(strings as Record<string, unknown>)) {
      if (typeof value === "string" && key && key.length <= 300 && value.length <= 300) entries[key] = value;
    }
    locales[language] = entries;
  }
  return locales;
}

export async function loadPluginPackage(
  reader: PluginPackageReader,
  trusted: boolean,
  artifactSource: LocalPluginArtifact["source"] = "package",
): Promise<LocalPluginArtifact> {
  const manifestPath = "plugin.json";
  const manifest = JSON.parse(await reader.readText(manifestPath)) as PluginManifest;
  validatePluginManifest(manifest);
  const styles = await loadStyles(reader, manifest);
  const locales = await loadLocales(reader, manifest);

  // A package with no `entry` contains no code. It is a theme: it installs
  // without a warning screen, because CSS alone cannot exfiltrate anything
  // under this app's CSP, and there is nothing to execute.
  if (!manifest.entry) {
    if (styles.length === 0) {
      throw new Error(`plugin declares neither entry nor styles: ${manifest.id}`);
    }
    return { manifest, styles, locales, source: artifactSource, verified: trusted };
  }

  if (!isSafePluginPackagePath(manifest.entry)) {
    throw new Error(`plugin path must stay inside package: safe relative path required for ${manifest.id}`);
  }
  const module = await importModule(reader, manifest.entry) as { default?: NotiblePlugin; plugin?: NotiblePlugin };
  const plugin = module.default ?? module.plugin;
  if (!plugin) throw new Error(`plugin entry exports neither default nor plugin: ${manifest.id}`);
  // Without this the next line reads `.id` off undefined, and the author is
  // told "Cannot read properties of undefined (reading 'id')" — which names
  // neither the plugin nor the missing field. Forgetting `manifest` on the
  // export is the single most likely mistake when writing a first plugin.
  if (!plugin.manifest) {
    throw new Error(`plugin entry must export a manifest alongside onload: ${manifest.id} (${manifest.entry})`);
  }
  validatePluginManifest(plugin.manifest);
  if (plugin.manifest.id !== manifest.id || plugin.manifest.version !== manifest.version || plugin.manifest.apiVersion !== manifest.apiVersion) {
    throw new Error(`plugin entry manifest does not match plugin.json: ${manifest.id}`);
  }
  return { manifest, plugin, styles, locales, source: artifactSource, verified: trusted };
}
