// Where the plugin-market list comes from and how its bytes are fetched.
// Kept separate from usePluginCatalog.ts so it can be exercised without React:
// see scripts/plugin-market-check.mjs.

import { validatePluginCatalog, type PluginCatalog } from "../extensions/update.ts";

/**
 * The community catalog: `plugins/index.json` on the same bucket and domain the
 * Core updater uses (see docs/PLUGIN_UPDATES.md), generated from
 * `release/market/catalog.json` by `scripts/build-market-catalog.mjs`. Served
 * with CORS open, so a plain `fetch` reads it. Per-plugin `plugin.json` and the
 * package ZIP live on GitHub Releases instead (see `fetchViaRust`).
 */
export const CATALOG_URL = "https://updates.szymonjankiewicz.com/plugins/index.json";

/**
 * Refuse a document that is merely large before parsing it. The catalog and
 * manifests are small JSON files; without a ceiling a misdirected response is
 * read into memory in full before the validator ever sees a field. Counted in
 * bytes off the wire, not string length — a multi-byte body is bigger than its
 * decoded `.length` suggests.
 */
export const MAX_JSON_BYTES = 512 * 1024;
/** Plugin packages are capped at 50 MB by the extractor; match it. */
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
/** Manifests are fetched a few at a time, not all at once: a large catalog
 * otherwise opens one connection per entry in a single burst. */
export const MANIFEST_FETCH_CONCURRENCY = 4;

/** GitHub release assets (`github.com`, `*.githubusercontent.com`) send no
 * `Access-Control-Allow-Origin`, so the WebView `fetch` cannot read them —
 * those go through the Rust `market_fetch` command instead. */
function isGithubReleaseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "github.com" || u.hostname.endsWith(".githubusercontent.com"));
  } catch {
    return false;
  }
}

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function fetchViaRust(url: string, maxBytes: number): Promise<Uint8Array> {
  const { invoke } = await import("@tauri-apps/api/core");
  const base64 = await invoke<string>("market_fetch", { url, maxBytes });
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

/**
 * Read a response body, aborting as soon as it passes `maxBytes`. Content-Length
 * is only an early hint — a chunked or lying response still gets cut off at the
 * ceiling instead of being buffered whole. GitHub release URLs are fetched in
 * Rust (CORS); everything else over the WebView `fetch`.
 */
export async function fetchWithByteCeiling(url: string, maxBytes: number): Promise<Uint8Array> {
  if (inTauri() && isGithubReleaseUrl(url)) return fetchViaRust(url, maxBytes);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const hint = Number(response.headers.get("content-length"));
  if (Number.isFinite(hint) && hint > maxBytes) throw new Error("that response is larger than the limit allows");
  if (!response.body) {
    const whole = new Uint8Array(await response.arrayBuffer());
    if (whole.byteLength > maxBytes) throw new Error("that response is larger than the limit allows");
    return whole;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("that response is larger than the limit allows");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Chunked to stay well under the argument-count limit `String.fromCharCode`
 * hits when spread over an entire package's worth of bytes at once. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export async function fetchJson(url: string): Promise<unknown> {
  const bytes = await fetchWithByteCeiling(url, MAX_JSON_BYTES);
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** One catalog entry, resolved enough to fetch its GitHub release. */
export interface CatalogSource {
  id: string;
  name: string;
  author: string;
  description: string;
  /** https://github.com/{repo}/releases/latest/download */
  releaseBase: string;
}

/** The subset of a plugin's own plugin.json the market needs. */
export interface ReleaseManifest {
  id: string;
  version: string;
  apiVersion: string;
  minCoreVersion: string;
  maxCoreVersion: string | null;
  /** The release is a theme pack (its plugin.json carries a `theme`). */
  isTheme: boolean;
  /** What it asks to be allowed to do, as declared (strings only), to show before installing (M1). */
  permissions: string[];
  /** API 1.28: the hosts it says it talks to, shown before installing. */
  networkHosts?: string[];
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`plugin.json is missing ${key}`);
  return value;
}

/**
 * Read `{releaseBase}/plugin.json` (GitHub's stable latest-release redirect —
 * no API, no rate limit), validate the fields the market needs, and confirm
 * the release names the same plugin id as the catalog entry.
 */
export async function resolveGithubRelease(source: CatalogSource): Promise<{ manifest: ReleaseManifest; zipUrl: string }> {
  const raw = await fetchJson(`${source.releaseBase}/plugin.json`);
  if (typeof raw !== "object" || raw === null) throw new Error("plugin.json is not an object");
  const obj = raw as Record<string, unknown>;
  const id = requireString(obj, "id");
  if (id !== source.id) throw new Error("the GitHub release and the catalog entry name different plugin ids");
  const maxCore = obj.maxCoreVersion;
  const manifest: ReleaseManifest = {
    id,
    version: requireString(obj, "version"),
    apiVersion: requireString(obj, "apiVersion"),
    minCoreVersion: requireString(obj, "minCoreVersion"),
    maxCoreVersion: typeof maxCore === "string" && maxCore.trim() ? maxCore : null,
    isTheme: typeof obj.theme === "object" && obj.theme !== null,
    permissions: Array.isArray(obj.permissions) ? obj.permissions.filter((value): value is string => typeof value === "string").slice(0, 32) : [],
    networkHosts: (Array.isArray(obj.networkHosts) ? (obj.networkHosts as unknown[]).filter((value): value is string => typeof value === "string").slice(0, 20) : []),
  };
  // `compareVersions` would reject a bad version, but it only runs when
  // something is already installed — on a fresh machine an unparsable version
  // would otherwise pass straight through to an installable row.
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error(`plugin.json version is not a semantic version: ${manifest.version}`);
  }
  return { manifest, zipUrl: `${source.releaseBase}/${source.id}.zip` };
}

/** The v2 catalog (`index.json`), mapped to resolvable sources. */
export async function fetchStaticSources(): Promise<CatalogSource[]> {
  const catalog = await fetchJson(CATALOG_URL);
  validatePluginCatalog(catalog);
  return (catalog as PluginCatalog).plugins.map((entry) => ({
    id: entry.id,
    name: entry.name,
    author: entry.author,
    description: entry.description,
    releaseBase: `https://github.com/${entry.repo}/releases/latest/download`,
  }));
}

// --- Language packs ---------------------------------------------------------
// A language pack is one file, `language.json`, on a GitHub release. It has its
// own catalogue, separate from the plugin one: an older build validates the
// plugin catalogue strictly and would reject a field it does not know, so the
// two kinds never share a document (and a market list never mixes them).

export const LANGUAGE_CATALOG_URL = "https://updates.szymonjankiewicz.com/languages/index.json";
/** Matches the ceiling Rust applies to a language file. */
export const MAX_LANGUAGE_BYTES = 256 * 1024;

export interface LanguageSource {
  /** BCP-47-ish tag, e.g. "de" or "pt-BR". */
  locale: string;
  name: string;
  author: string;
  description: string;
  /** owner/name of the GitHub repository whose latest release carries language.json. */
  repo: string;
  /** Latest published version, when the catalogue knows it (lets the app offer an update). */
  version: string | null;
}

const LANGUAGE_TAG = /^[A-Za-z0-9-]{1,12}$/u;
const GITHUB_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export function isValidRepo(value: string): boolean {
  return GITHUB_REPO.test(value) && !value.split("/").some((part) => part === "." || part === "..");
}

/** Accepts "owner/name" or a github.com URL and returns "owner/name", or null. */
export function repoFromInput(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/u, "").replace(/\.git$/u, "");
  const fromUrl = /^https:\/\/github\.com\/([^/]+\/[^/]+)(?:\/.*)?$/u.exec(trimmed);
  const repo = fromUrl ? fromUrl[1] : trimmed;
  return isValidRepo(repo) ? repo : null;
}

export function validateLanguageCatalog(value: unknown): LanguageSource[] {
  if (typeof value !== "object" || value === null) throw new Error("the language catalogue is not an object");
  const doc = value as Record<string, unknown>;
  if (doc.schemaVersion !== 1) throw new Error("unsupported language catalogue schema");
  if (!Array.isArray(doc.languages)) throw new Error("the language catalogue has no languages list");
  const seen = new Set<string>();
  const out: LanguageSource[] = [];
  for (const raw of doc.languages) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const locale = entry.locale, name = entry.name, author = entry.author, repo = entry.repo;
    // One malformed row must not hide the rest of the list: skip it.
    if (typeof locale !== "string" || !LANGUAGE_TAG.test(locale) || locale.toLowerCase() === "en" || seen.has(locale)) continue;
    if (typeof name !== "string" || !name.trim() || name.length > 60) continue;
    if (typeof author !== "string" || !author.trim()) continue;
    if (typeof repo !== "string" || !isValidRepo(repo)) continue;
    const version = typeof entry.version === "string" && /^\d+\.\d+\.\d+/u.test(entry.version) ? entry.version : null;
    seen.add(locale);
    out.push({ locale, name, author, description: typeof entry.description === "string" ? entry.description.slice(0, 300) : "", repo, version });
  }
  return out;
}

/** The published language list. A missing catalogue (404) is "nothing published yet", not an error. */
export async function fetchLanguageSources(): Promise<LanguageSource[]> {
  try {
    return validateLanguageCatalog(await fetchJson(LANGUAGE_CATALOG_URL));
  } catch (value) {
    if (value instanceof Error && /\b404\b/u.test(value.message)) return [];
    throw value;
  }
}

/** The text of a repository's latest `language.json`. Rust validates it before anything is stored. */
export async function fetchLanguagePack(repo: string): Promise<string> {
  if (!isValidRepo(repo)) throw new Error("that is not a GitHub repository (owner/name)");
  const bytes = await fetchWithByteCeiling(`https://github.com/${repo}/releases/latest/download/language.json`, MAX_LANGUAGE_BYTES);
  return new TextDecoder().decode(bytes);
}

// --- Theme packs ---------------------------------------------------------------
// A theme pack is a code-free plugin package (a zip on a GitHub release, like any
// plugin). Its catalogue is again a separate document, so the plugin market never
// lists themes and the Themes screen never lists plugins.

export const THEME_CATALOG_URL = "https://updates.szymonjankiewicz.com/themes/index.json";

export interface ThemeSource {
  /** The package id (same rules as a plugin id). */
  id: string;
  name: string;
  author: string;
  description: string;
  repo: string;
}

const PACKAGE_ID = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/u;

export function validateThemeCatalog(value: unknown): ThemeSource[] {
  if (typeof value !== "object" || value === null) throw new Error("the theme catalogue is not an object");
  const doc = value as Record<string, unknown>;
  if (doc.schemaVersion !== 1) throw new Error("unsupported theme catalogue schema");
  if (!Array.isArray(doc.themes)) throw new Error("the theme catalogue has no themes list");
  const seen = new Set<string>();
  const out: ThemeSource[] = [];
  for (const raw of doc.themes) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const { id, name, author, repo } = entry;
    if (typeof id !== "string" || !PACKAGE_ID.test(id) || id.length > 64 || seen.has(id)) continue;
    if (typeof name !== "string" || !name.trim() || name.length > 60) continue;
    if (typeof author !== "string" || !author.trim()) continue;
    if (typeof repo !== "string" || !isValidRepo(repo)) continue;
    seen.add(id);
    out.push({ id, name, author, description: typeof entry.description === "string" ? entry.description.slice(0, 300) : "", repo });
  }
  return out;
}

/** The published theme list. A missing catalogue (404) is "nothing published yet". */
export async function fetchThemeSources(): Promise<ThemeSource[]> {
  try {
    return validateThemeCatalog(await fetchJson(THEME_CATALOG_URL));
  } catch (value) {
    if (value instanceof Error && /\b404\b/u.test(value.message)) return [];
    throw value;
  }
}

/** A theme source in the shape the plugin release resolver already understands. */
export function themeAsCatalogSource(theme: ThemeSource): CatalogSource {
  return { id: theme.id, name: theme.name, author: theme.author, description: theme.description, releaseBase: `https://github.com/${theme.repo}/releases/latest/download` };
}

/**
 * The latest release of a repository the user named directly, for a theme pack:
 * its plugin.json (which carries the id) and where its zip is. The zip is named
 * after the id, like every plugin package.
 */
export async function resolveRepoRelease(repo: string): Promise<{ manifest: ReleaseManifest; zipUrl: string }> {
  if (!isValidRepo(repo)) throw new Error("that is not a GitHub repository (owner/name)");
  const releaseBase = `https://github.com/${repo}/releases/latest/download`;
  const raw = await fetchJson(`${releaseBase}/plugin.json`);
  if (typeof raw !== "object" || raw === null) throw new Error("plugin.json is not an object");
  const id = requireString(raw as Record<string, unknown>, "id");
  if (!PACKAGE_ID.test(id) || id.length > 64) throw new Error("plugin.json has an invalid id");
  const resolved = await resolveGithubRelease({ id, name: id, author: "", description: "", releaseBase });
  return resolved;
}

/**
 * GitHub accounts whose releases count as OFFICIAL: published by the Notible developer.
 * Plugins carry no cryptographic signature (Model A), so "official" is provenance, not a
 * signature: it is decided from the release URL the package was resolved from, never from
 * anything the plugin says about itself.
 */
const OFFICIAL_GITHUB_OWNERS = ["prejas3"];
export function isOfficialReleaseUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") return false;
    // Same rules as Rust's `official_release` (Hive #21/#23): a release asset,
    // pinned or `latest`, never raw/blob/commit paths under the owner.
    const parts = parsed.pathname.split("/").slice(1);
    const asset = parts.length === 6 && parts[2] === "releases"
      && ((parts[3] === "download" && parts[4]) || (parts[3] === "latest" && parts[4] === "download"));
    return !!asset && parts.every(Boolean) && OFFICIAL_GITHUB_OWNERS.includes(parts[0].toLowerCase());
  } catch { return false; }
}

/** Plugin ids Notible keeps for its own plugins (installed only from an official release). */
export function isReservedPluginId(id: string): boolean {
  return id.toLowerCase().startsWith("notible.");
}
