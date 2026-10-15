import { isApiVersionCompatible } from "./manifest.ts";

export interface PluginCatalogEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  /** `owner/name` on github.com. */
  repo: string;
  minCoreVersion: string;
  apiVersion: string;
}

export interface PluginCatalog {
  schemaVersion: 2;
  generatedAt: string;
  plugins: PluginCatalogEntry[];
}

/**
 * Ids withheld from catalog submissions. Intentionally empty under Model A: the
 * catalog is 100% owner-merged by PR, so id impersonation is caught in review,
 * and the owner must be free to (re)list the first-party `notible.*` plugins
 * (see RELEASE_CHECKLIST_0.80.0.md). Kept as a hook for a future
 * automated-submission model; the `has()` check below is inert until then.
 */
const RESERVED_CATALOG_IDS = new Set<string>([]);
const CATALOG_ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const CATALOG_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CATALOG_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const CATALOG_APIVER_PATTERN = /^\d+\.\d+$/;

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
}

function assertVersion(value: unknown, label: string) {
  assertString(value, label);
  if (!VERSION_PATTERN.test(value as string)) throw new Error(`${label} must be semantic version x.y.z`);
}

export function compareVersions(left: string, right: string): number {
  assertVersion(left, "left version");
  assertVersion(right, "right version");
  const parse = (value: string) => {
    const [core, prerelease = ""] = value.split("-", 2);
    return { core: core.split(".").map(Number), prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

/**
 * The market index, checked at the trust boundary.
 *
 * The TypeScript type above is a compile-time comment: this file is fed a
 * JSON document downloaded over the network, so the type proves nothing
 * about it. A union in a type declaration once let `data.sync` through into
 * a release that was broken on arrival — the runtime list is the one that
 * counts, so this mirrors `docs/schemas/plugin-catalog-v2.schema.json` field
 * for field, including its `additionalProperties: false`.
 *
 * A catalog entry is only a pointer to a GitHub repo. Nothing here is
 * installed on trust: the release assets fetched from `repo` remain the
 * source of truth for version and compatibility.
 */
export function validatePluginCatalog(value: unknown): asserts value is PluginCatalog {
  if (!isRecord(value) || value.schemaVersion !== 2) throw new Error("unsupported plugin catalog schema");
  assertNoExtraKeys(value, ["schemaVersion", "generatedAt", "plugins"], "catalog");
  assertString(value.generatedAt, "generatedAt");
  if (Number.isNaN(Date.parse(value.generatedAt as string))) throw new Error("generatedAt must be an ISO date");
  if (!Array.isArray(value.plugins)) throw new Error("catalog.plugins must be an array");
  const seen = new Set<string>();
  for (const raw of value.plugins) {
    if (!isRecord(raw)) throw new Error("catalog.plugins entries must be objects");
    assertNoExtraKeys(raw, ["id", "name", "author", "description", "repo", "minCoreVersion", "apiVersion"], "catalog entry");
    assertString(raw.id, "entry.id");
    if (!CATALOG_ID_PATTERN.test(raw.id as string)) throw new Error(`invalid entry.id: ${raw.id}`);
    if (RESERVED_CATALOG_IDS.has(raw.id as string)) throw new Error(`reserved plugin id: ${raw.id}`);
    if (seen.has(raw.id as string)) throw new Error(`duplicate catalog entry: ${raw.id}`);
    seen.add(raw.id as string);
    assertString(raw.name, "entry.name");
    if (!(raw.name as string).trim()) throw new Error("entry.name must not be empty");
    assertString(raw.author, "entry.author");
    if (!(raw.author as string).trim()) throw new Error("entry.author must not be empty");
    // Schema (plugin-catalog-v2) allows an empty description: type-only check.
    if (typeof raw.description !== "string") throw new Error("entry.description must be a string");
    assertString(raw.repo, "entry.repo");
    if (!CATALOG_REPO_PATTERN.test(raw.repo as string)) throw new Error(`entry.repo must be "owner/name": ${raw.repo}`);
    if ((raw.repo as string).split("/").some((part) => part === "." || part === "..")) {
      throw new Error(`entry.repo must not contain "." or ".." path segments: ${raw.repo}`);
    }
    assertString(raw.minCoreVersion, "entry.minCoreVersion");
    if (!CATALOG_SEMVER_PATTERN.test(raw.minCoreVersion as string)) throw new Error(`entry.minCoreVersion must be x.y.z: ${raw.minCoreVersion}`);
    assertString(raw.apiVersion, "entry.apiVersion");
    if (!CATALOG_APIVER_PATTERN.test(raw.apiVersion as string)) throw new Error(`entry.apiVersion must be major.minor: ${raw.apiVersion}`);
  }
}

function assertNoExtraKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) throw new Error(`${label} has unexpected fields: ${extra.join(", ")}`);
}

export function isPluginUpdateCompatible(
  release: { plugin: { apiVersion: string; minCoreVersion: string; maxCoreVersion?: string | null } },
  coreVersion: string,
  apiVersion: string,
): boolean {
  // API side uses the same major/minor rule the manifest loader applies
  // (`isApiVersionCompatible`), not string equality — a host on 1.17 must still
  // accept a plugin built against 1.11. Core side stays an explicit range.
  return isApiVersionCompatible(release.plugin.apiVersion, apiVersion)
    && compareVersions(coreVersion, release.plugin.minCoreVersion) >= 0
    && (!release.plugin.maxCoreVersion || compareVersions(coreVersion, release.plugin.maxCoreVersion) <= 0);
}

