import { useCallback, useEffect, useState } from "react";
import {
  EXTENSION_API_VERSION,
  isPluginUpdateCompatible,
  compareVersions,
} from "../extensions";
import { listPluginRegistry } from "../../lib/api";
import { installPluginZip } from "../data/core-data-api.ts";
import packageJson from "../../../package.json";
import {
  MANIFEST_FETCH_CONCURRENCY,
  MAX_PACKAGE_BYTES,
  arrayBufferToBase64,
  fetchStaticSources,
  fetchWithByteCeiling,
  mapWithConcurrency,
  resolveGithubRelease,
  type CatalogSource,
  type ReleaseManifest,
} from "./marketSource.ts";

/** One market row: the catalog pointer plus what we resolved from GitHub. */
export interface MarketEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  /** Parsed plugin.json from the plugin's latest GitHub release. */
  release: ReleaseManifest | null;
  /** URL of the plugin's release zip, so an install does not have to re-resolve. */
  zipUrl: string | null;
  /** Non-null when this row cannot be installed and why. */
  problem: string | null;
  /** Highest version already in the local registry for this id, if any. */
  installedVersion: string | null;
  /** This build's Core + API satisfy the release's minCore/maxCore/apiVersion. */
  compatible: boolean;
  /** The release is newer than what is installed. */
  isNewer: boolean;
  /** Installed, and nothing newer is published. */
  upToDate: boolean;
  /** compatible && not already current. */
  installable: boolean;
  actionLabel: "Install" | "Update" | "Installed";
}

export interface PluginCatalogState {
  entries: MarketEntry[] | null;
  status: "idle" | "loading" | "error";
  message: string;
  busyId: string | null;
  reload: () => Promise<void>;
  /** Download `entry.zipUrl` (the plugin's latest GitHub-release zip) and install
   * it via `install_plugin_zip` — Model A, no signature check — then let the host
   * finish the registry/trust/activate path. Safe to call for an update or a
   * fresh install; the checks are identical. */
  installUpdate: (entry: MarketEntry) => Promise<void>;
  /** The catalog row for a plugin id, if published. */
  entryFor: (pluginId: string) => MarketEntry | undefined;
}

/** Resolve one catalog row: fetch the plugin's `plugin.json` from its latest
 * GitHub release (no signature — Model A) and classify it against what is
 * installed. */
async function resolveEntry(source: CatalogSource, installedVersions: Map<string, string>): Promise<MarketEntry> {
  const installedVersion = installedVersions.get(source.id) ?? null;
  const base: Pick<MarketEntry, "id" | "name" | "author" | "description"> = {
    id: source.id, name: source.name, author: source.author, description: source.description,
  };
  try {
    const { manifest, zipUrl } = await resolveGithubRelease(source);
    const compatible = isPluginUpdateCompatible(
      { plugin: { apiVersion: manifest.apiVersion, minCoreVersion: manifest.minCoreVersion, maxCoreVersion: manifest.maxCoreVersion } },
      packageJson.version,
      EXTENSION_API_VERSION,
    );
    const isNewer = installedVersion ? compareVersions(manifest.version, installedVersion) > 0 : false;
    const upToDate = installedVersion !== null && !isNewer;
    return {
      ...base,
      release: manifest,
      zipUrl,
      problem: null,
      installedVersion,
      compatible,
      isNewer,
      upToDate,
      installable: compatible && !upToDate,
      actionLabel: installedVersion === null ? "Install" : isNewer ? "Update" : "Installed",
    };
  } catch (value) {
    return {
      ...base,
      release: null,
      zipUrl: null,
      problem: value instanceof Error ? value.message : String(value),
      installedVersion,
      compatible: false,
      isNewer: false,
      upToDate: installedVersion !== null,
      installable: false,
      actionLabel: installedVersion === null ? "Install" : "Installed",
    };
  }
}

/**
 * Shared plugin-market state: read the community catalog (`index.json` on R2),
 * resolve each row against its latest GitHub release, and expose a one-click
 * install/update (Model A — the package is not signed). Used by both the Market
 * list and the All list's per-plugin update button.
 */
export function usePluginCatalog({ onError, onInstall }: {
  onError: (value: unknown) => void;
  /** Finishes the install from an already-extracted directory: registry row,
   * native trust prompt, load, activate. The same path "Install .zip" uses.
   * `sourceUrl` (the GitHub release the zip came from) lets that trust
   * prompt skip itself for an official release — see grantPluginTrust. */
  onInstall: (installPath: string, sourceUrl?: string) => Promise<void>;
}): PluginCatalogState {
  const [entries, setEntries] = useState<MarketEntry[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setStatus("loading");
    setMessage("");
    try {
      // A failed registry read is not "nothing is installed": rendering a list
      // that offers a fresh Install for plugins already on disk invites a
      // duplicate-version install error at best. Surface it as an error state.
      const registry = await listPluginRegistry();
      const installedVersions = new Map<string, string>();
      for (const record of registry) {
        const current = installedVersions.get(record.plugin_id);
        if (!current || compareVersions(record.version, current) > 0) installedVersions.set(record.plugin_id, record.version);
      }
      const sources = await fetchStaticSources();
      const resolved = await mapWithConcurrency(sources, MANIFEST_FETCH_CONCURRENCY, (item) => resolveEntry(item, installedVersions));
      setEntries(resolved);
      setStatus("idle");
    } catch (value) {
      setStatus("error");
      setMessage(value instanceof Error ? value.message : String(value));
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const installUpdate = useCallback(async (entry: MarketEntry) => {
    if (!entry.release || !entry.zipUrl) return;
    setBusyId(entry.id);
    try {
      const bytes = (await fetchWithByteCeiling(entry.zipUrl, MAX_PACKAGE_BYTES)).buffer;
      const extracted = await installPluginZip(arrayBufferToBase64(bytes), entry.id, entry.release.version);
      await onInstall(extracted.install_path, entry.zipUrl ?? undefined);
      await reload();
    } catch (value) {
      onError(value);
    } finally {
      setBusyId(null);
    }
  }, [onError, onInstall, reload]);

  const entryFor = useCallback((pluginId: string) => entries?.find((entry) => entry.id === pluginId), [entries]);

  return { entries, status, message, busyId, reload, installUpdate, entryFor };
}
