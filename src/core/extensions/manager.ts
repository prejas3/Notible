import { compareVersions } from "./update.ts";
import { validatePluginManifest } from "./manifest.ts";
import type { ExtensionHost } from "./host.ts";
import type { NotiblePlugin, PluginManifest } from "./types";

export interface PluginStyleSheet {
  path: string;
  css: string;
}

/**
 * Where Core hangs plugin stylesheets. The manager owns the lifecycle but not
 * the DOM, so the app supplies this — the same shape of indirection the
 * overlay API uses.
 */
export interface PluginStyleSink {
  apply(pluginId: string, styles: PluginStyleSheet[]): void;
  remove(pluginId: string): void;
}

export interface LocalPluginArtifact {
  manifest: PluginManifest;
  /**
   * Absent for a package with no `entry` — a theme. Everything that touches
   * this must tolerate its absence, because a CSS-only package is a
   * first-class artifact, not a degenerate one.
   */
  plugin?: NotiblePlugin;
  styles?: PluginStyleSheet[];
  /**
   * Translations the package shipped, keyed by language tag. Already reduced
   * to this plugin's own namespace by the loader — a package cannot carry a
   * translation for anything but itself.
   */
  locales?: Record<string, Record<string, string>>;
  source: "builtin" | "local-file" | "package";
  /** The package verifier must set this only after hash/signature checks. */
  verified: boolean;
}

export type LocalPluginStatus = "active" | "disabled" | "failed";

export interface LocalPluginRecord {
  id: string;
  activeVersion: string | null;
  installedVersions: string[];
  status: LocalPluginStatus;
  source: LocalPluginArtifact["source"];
}

export class LocalPluginManager {
  private readonly artifacts = new Map<string, Map<string, LocalPluginArtifact>>();
  private readonly records = new Map<string, LocalPluginRecord>();
  private readonly host: ExtensionHost;
  private styleSink: PluginStyleSink | null = null;
  private themeListener: (() => void) | null = null;

  constructor(host: ExtensionHost, styleSink?: PluginStyleSink) {
    this.host = host;
    this.styleSink = styleSink ?? null;
  }

  /** Told whenever the set of installed packages changes, so the Themes list stays current. */
  onThemePacksChanged(listener: () => void) {
    this.themeListener = listener;
  }

  /** Installed, active theme packs with their stylesheets. Nothing here is applied; the user picks one. */
  themePacks(): Array<{ id: string; version: string; name: string; mode: "light" | "dark"; description: string; author: string; styles: PluginStyleSheet[] }> {
    const packs = [];
    for (const record of this.records.values()) {
      if (!record.activeVersion || record.status !== "active") continue;
      const artifact = this.artifacts.get(record.id)?.get(record.activeVersion);
      const theme = artifact?.manifest.theme;
      if (!artifact || !theme) continue;
      packs.push({ id: record.id, version: record.activeVersion, name: theme.name, mode: theme.mode, description: theme.description ?? "", author: artifact.manifest.author ?? "", styles: artifact.styles ?? [] });
    }
    return packs.sort((left, right) => left.name.localeCompare(right.name));
  }

  /** Core installs this once its document exists. */
  setStyleSink(sink: PluginStyleSink) {
    this.styleSink = sink;
  }

  private applyStyles(artifact: LocalPluginArtifact) {
    // A theme pack is applied only when the user picks it (see themePacks below).
    if (artifact.manifest.theme) return;
    if (artifact.styles?.length) this.styleSink?.apply(artifact.manifest.id, artifact.styles);
  }

  list(): LocalPluginRecord[] {
    return [...this.records.values()]
      .map((record) => ({ ...record, installedVersions: [...record.installedVersions] }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async install(artifact: LocalPluginArtifact): Promise<LocalPluginRecord> {
    validatePluginManifest(artifact.manifest);
    if (artifact.plugin && (artifact.plugin.manifest.id !== artifact.manifest.id || artifact.plugin.manifest.version !== artifact.manifest.version)) {
      throw new Error("plugin artifact and executable manifest do not match");
    }
    if (!artifact.plugin && !artifact.styles?.length) {
      throw new Error(`plugin artifact has neither code nor styles: ${artifact.manifest.id}`);
    }
    if (!artifact.verified) throw new Error(`plugin artifact is not verified: ${artifact.manifest.id}@${artifact.manifest.version}`);

    const id = artifact.manifest.id;
    const version = artifact.manifest.version;
    const versions = this.artifacts.get(id) ?? new Map<string, LocalPluginArtifact>();
    const current = this.records.get(id);
    if (current?.activeVersion && compareVersions(version, current.activeVersion) < 0) {
      throw new Error(`refusing to replace ${id}@${current.activeVersion} with older ${version}`);
    }
    const previousArtifact = versions.get(version);
    versions.set(version, artifact);
    this.artifacts.set(id, versions);

    this.host.setPluginLocales(id, artifact.locales);
    if (!current?.activeVersion) {
      try {
        // A theme has nothing to enable in the host; its whole effect is the
        // stylesheet.
        if (artifact.plugin) await this.host.enable(artifact.plugin);
        this.applyStyles(artifact);
      } catch (error) {
        versions.delete(version);
        if (versions.size === 0) this.artifacts.delete(id);
        throw error;
      }
      return this.saveRecord({ id, activeVersion: version, installedVersions: [...versions.keys()], status: "active", source: artifact.source });
    }

    const result = artifact.plugin
      ? await this.host.replace(artifact.plugin)
      : { replaced: true, rolledBack: false };
    if (result.rolledBack) {
      if (previousArtifact) versions.set(version, previousArtifact);
      else versions.delete(version);
      return this.saveRecord({ ...current, installedVersions: [...versions.keys()], status: "failed" });
    }
    this.styleSink?.remove(id);
    this.applyStyles(artifact);
    return this.saveRecord({
      id,
      activeVersion: version,
      installedVersions: [...versions.keys()],
      status: "active",
      source: artifact.source,
    });
  }

  async disable(id: string): Promise<LocalPluginRecord | null> {
    const current = this.records.get(id);
    if (!current) return null;
    await this.host.disable(id);
    // Styles come down on disable, not only on uninstall: a disabled theme
    // that keeps restyling the app is indistinguishable from a broken one.
    this.styleSink?.remove(id);
    return this.saveRecord({ ...current, status: "disabled" });
  }

  async enable(id: string): Promise<LocalPluginRecord> {
    const current = this.records.get(id);
    if (!current?.activeVersion) throw new Error(`no active version for plugin: ${id}`);
    if (current.status === "active" || current.status === "failed") {
      return this.saveRecord({ ...current, status: "active" });
    }
    const artifact = this.artifacts.get(id)?.get(current.activeVersion);
    if (!artifact) throw new Error(`active plugin artifact is missing: ${id}@${current.activeVersion}`);
    this.host.setPluginLocales(id, artifact.locales);
    if (artifact.plugin) await this.host.enable(artifact.plugin);
    this.applyStyles(artifact);
    return this.saveRecord({ ...current, status: "active" });
  }

  async uninstall(id: string, version?: string): Promise<LocalPluginRecord | null> {
    const current = this.records.get(id);
    const versions = this.artifacts.get(id);
    if (!current || !versions) return null;
    const target = version ?? current.activeVersion;
    if (!target || !versions.has(target)) return current;
    if (target !== current.activeVersion) {
      versions.delete(target);
      return this.saveRecord({ ...current, installedVersions: [...versions.keys()] });
    }

    // Keep a reference to the artifact we are about to drop so it can be
    // restored if the fallback activation below fails — mirrors the rollback
    // handling install() already does for a failed replace(). See C5 in the
    // 2026-08-08 bug audit: without this, a failed fallback left the
    // registry pointing at a version whose artifact no longer existed.
    const removedArtifact = versions.get(target)!;
    versions.delete(target);
    const fallback = [...versions.keys()].sort((left, right) => compareVersions(right, left))[0];
    if (fallback) {
      const fallbackArtifact = versions.get(fallback)!;
      this.host.setPluginLocales(id, fallbackArtifact.locales);
      const result = fallbackArtifact.plugin
        ? await this.host.replace(fallbackArtifact.plugin)
        : { replaced: true, rolledBack: false };
      if (result.rolledBack) {
        versions.set(target, removedArtifact);
        throw new Error(`could not activate fallback plugin: ${id}@${fallback}`);
      }
      this.styleSink?.remove(id);
      this.applyStyles(fallbackArtifact);
      return this.saveRecord({ ...current, activeVersion: fallback, installedVersions: [...versions.keys()], status: "active" });
    }
    await this.host.disable(id);
    this.styleSink?.remove(id);
    // This is a full uninstall (no other version to fall back to) — forget
    // the plugin's Core-owned storage too, so a later install of a
    // different plugin/version under the same id does not inherit orphaned
    // data. See C7 in the 2026-08-08 bug audit.
    this.host.forgetStorage(id);
    this.artifacts.delete(id);
    this.records.delete(id);
    this.themeListener?.();
    return null;
  }

  private saveRecord(record: LocalPluginRecord): LocalPluginRecord {
    const normalized = { ...record, installedVersions: [...record.installedVersions].sort((left, right) => compareVersions(right, left)) };
    this.records.set(record.id, normalized);
    this.themeListener?.();
    return { ...normalized, installedVersions: [...normalized.installedVersions] };
  }
}
