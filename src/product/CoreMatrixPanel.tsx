import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Briefcase, Cable, Download, LayoutGrid, Package, Palette, PenTool, Puzzle, RefreshCw, RotateCw, ShieldAlert, ShieldCheck, SlidersHorizontal, Table2, Zap } from "lucide-react";
import { BUILTIN_PLUGINS } from "./builtin";
import { coreHost } from "../core/app/CoreOnlyApp";
import { applyPluginSelection, MATRIX_SELECTION_KEY } from "./matrix-controller";
import { CoreSwitch } from "../core/app/CoreSwitch";
import { tr, useCoreI18n } from "../core/app/core-i18n.ts";
import { PluginDomMount, pluginNavigationInert, takePluginSelection } from "../core/app/CorePluginSurfaces.tsx";
import { PluginSettingsForm } from "../core/app/CorePluginSettingsForm.tsx";
import { PluginSettingsSurface } from "../core/app/PluginSettingsSurface.tsx";
import { renderCoreMarkdown } from "../core/app/CoreMarkdownEditor.tsx";
import { usePluginCatalog, type MarketEntry } from "../core/app/usePluginCatalog.ts";
import { isOfficialReleaseUrl, isReservedPluginId } from "../core/app/marketSource.ts";
import { buildPluginRows, type LocalEntry, type PluginRow } from "./plugin-rows.ts";
import {
  PLUGIN_CATEGORIES,
  PLUGIN_EXAMPLES,
  PLUGIN_LONG_DESCRIPTIONS,
  PLUGIN_NEEDS,
  PLUGIN_WHERE,
  PERMISSION_WORDS,
  categoryOf,
} from "./plugin-enrichment.ts";


/**
 * `[text](https://…)` links in a plugin guide. Done here on the rendered
 * (already escaped) HTML rather than in the editor's inlineHtml, because the
 * editor's caret arithmetic has no idea what a link is yet. Code blocks are
 * skipped so an example stays literal; only http(s) targets become anchors.
 */
export function guideLinks(html: string): string {
  return html.split(/(<pre[\s\S]*?<\/pre>)/u).map((part) => part.startsWith("<pre")
    ? part
    : part.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gu, '<a class="core-plugin-guide-link" href="$2">$1</a>')).join("");
}

/** Category order for the list, with an always-present "Other" bucket so a
 * plugin nobody has filed still shows up. */
/** Group headings are data; they are translated where drawn. */
const CATEGORY_LABELS = [tr("Work & planning"), tr("Data & views"), tr("Editor & canvas"), tr("Integrations & data flow"), tr("Appearance"), tr("Other")];
void CATEGORY_LABELS;
const CATEGORY_ORDER = [...PLUGIN_CATEGORIES.map((category) => category.name), "Other"];

/** One quiet icon per category — the list is a flat index, not a grid of
 * cards, so the icon is the only ornament a row carries. */
const CATEGORY_ICON: Record<string, typeof Puzzle> = {
  "Work & planning": Briefcase,
  "Data & views": Table2,
  "Editor & canvas": PenTool,
  "Integrations & data flow": Cable,
  "Appearance": Palette,
  "Other": Puzzle,
};

function readStoredSelection(): string[] | null {
  try {
    const raw = localStorage.getItem(MATRIX_SELECTION_KEY);
    if (raw === null) return null;
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
  } catch {
    return null;
  }
}

function shortError(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

function manifestFor(id: string) {
  return BUILTIN_PLUGINS.find((plugin) => plugin.manifest.id === id)?.manifest;
}

/** The stored manifest for a local plugin row, parsed, or null. */
function localManifest(row: PluginRow, entries: LocalEntry[]): Record<string, unknown> | null {
  const raw = (entries.find((entry) => entry.plugin_id === row.id) as { manifest?: string } | undefined)?.manifest;
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}

/** `manifest.author`, whichever manifest source the row has. */
function authorFor(row: PluginRow, entries: LocalEntry[]): string | null {
  const value = row.source === "core"
    ? (manifestFor(row.id) as { author?: unknown } | undefined)?.author
    : localManifest(row, entries)?.author;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** `guide` markdown for a row: builtin manifest for core plugins, the stored
 * manifest JSON string for local ones. */
function guideFor(row: PluginRow, entries: LocalEntry[]): string | null {
  if (row.source === "core") {
    const value = (manifestFor(row.id) as { guide?: unknown } | undefined)?.guide;
    return typeof value === "string" && value.trim() ? value : null;
  }
  const raw = (entries.find((entry) => entry.plugin_id === row.id) as { manifest?: string } | undefined)?.manifest;
  if (!raw) return null;
  try {
    const value = (JSON.parse(raw) as { guide?: unknown }).guide;
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export interface CoreMatrixPanelProps {
  /** Which plugins tab is showing. "all" = installed + builtin; "market" =
   * the published catalog. */
  tab?: "all" | "market";
  /** Locally installed (folder / .zip) plugin registry entries. */
  entries?: LocalEntry[];
  /** DOM node of the detail pane beside the list. */
  detailContainer?: HTMLElement | null;
  /** Rendered into the pane when no plugin is selected. */
  emptyState?: ReactNode;
  onToggleLocal?: (row: PluginRow) => void;
  onReloadLocal?: (row: PluginRow) => void;
  onRemoveLocal?: (row: PluginRow) => void;
  onError?: (value: unknown) => void;
  /** Finishes a verified market install from an extracted directory. */
  onInstall?: (installPath: string, sourceUrl?: string) => Promise<void>;
}

/**
 * The Plugins screen list: a minimalist flat list (one icon per row) rendered
 * in place, and the selected plugin's detail portalled into `detailContainer`
 * — the pane beside the middle Settings column. Same shape for both tabs.
 */
export function CoreMatrixPanel({ tab = "all", entries = [], detailContainer, emptyState, onToggleLocal, onReloadLocal, onRemoveLocal, onError, onInstall }: CoreMatrixPanelProps = {}) {
  const { t } = useCoreI18n();
  const [selected, setSelected] = useState<string[]>(() => readStoredSelection() ?? coreHost.getSnapshot().map((item) => item.pluginId));
  const [active, setActive] = useState(() => coreHost.getSnapshot().map((item) => item.pluginId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<MarketEntry | null>(null);
  /** Right-click on an installed plugin: Reload, Remove (row actions live there, not as icons). */
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; row: PluginRow } | null>(null);
  useEffect(() => {
    if (!rowMenu) return;
    const close = () => setRowMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", close); };
  }, [rowMenu]);
  const [updatingAll, setUpdatingAll] = useState(false);

  const catalog = usePluginCatalog({
    onError: (value) => onError?.(value),
    onInstall: async (installPath, sourceUrl) => { await onInstall?.(installPath, sourceUrl); },
  });
  // Official = installed from a package whose release is on the developer's GitHub account.
  // Judged from where it was downloaded, never from what the plugin claims about itself.
  // A `notible.` package can only have come from an official release (Core
  // refuses it otherwise), so it is official before the catalogue has even
  // loaded — the label used to flip Community → Official (audit V-PLUGINS-03).
  const isOfficial = (row: PluginRow) => row.source === "local"
    && entries.find((entry) => entry.plugin_id === row.id)?.source === "package"
    && (isReservedPluginId(row.id) || isOfficialReleaseUrl(catalog.entryFor(row.id)?.zipUrl));

  useEffect(() => {
    const stored = readStoredSelection();
    if (stored === null) return;
    setBusy(true);
    void applyPluginSelection(coreHost, BUILTIN_PLUGINS, stored)
      .then((ids) => { setSelected(ids); setActive(ids); })
      .catch((value) => setError(shortError(value)))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    const subscription = coreHost.onChange(() => {
      const ids = coreHost.getSnapshot().map((item) => item.pluginId);
      setActive(ids);
      setSelected(ids);
    });
    return () => subscription.dispose();
  }, []);

  // A selection made on one tab means nothing on the other.
  useEffect(() => { setSelectedId(null); }, [tab]);

  // Escape closes the trust modal.
  useEffect(() => {
    if (!pendingInstall) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPendingInstall(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingInstall]);

  const activeSnapshots = useMemo(() => coreHost.getSnapshot(), [active]);

  const rows = useMemo(
    // The public name (the market's, else the plugin's own), never one made
    // up from the id — "Sync.Simple", "Reportit" (audit V-PLUGINS-09).
    () => buildPluginRows({ builtins: BUILTIN_PLUGINS, activeIds: active, localEntries: entries }).map((row) => {
      if (row.source !== "local") return row;
      const own = localManifest(row, entries)?.name;
      return { ...row, name: catalog.entryFor(row.id)?.name ?? (typeof own === "string" && own.trim() ? own.trim() : row.name) };
    }),
    [active, entries],
  );

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const description = manifestFor(row.id)?.description ?? "";
      return row.name.toLocaleLowerCase().includes(needle)
        || row.id.toLocaleLowerCase().includes(needle)
        || description.toLocaleLowerCase().includes(needle);
    });
  }, [rows, query]);

  const groups = useMemo(() => {
    const byCategory = new Map<string, PluginRow[]>();
    for (const row of visibleRows) {
      const category = row.source === "local" ? "Other" : categoryOf(row.id);
      const bucket = byCategory.get(category) ?? [];
      bucket.push(row);
      byCategory.set(category, bucket);
    }
    return CATEGORY_ORDER
      .filter((name) => byCategory.has(name))
      .map((name) => ({ name, rows: byCategory.get(name)! }));
  }, [visibleRows]);

  const visibleMarket = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!catalog.entries) return null;
    if (!needle) return catalog.entries;
    return catalog.entries.filter((entry) => entry.name.toLocaleLowerCase().includes(needle) || entry.id.toLocaleLowerCase().includes(needle));
  }, [catalog.entries, query]);

  // "Update all" only ever batches OFFICIAL updates — those are the ones that
  // already skip the native trust dialog (see grantPluginTrust), so batching
  // them costs no extra consent beyond what a single Update already would.
  // A community update always needs its own per-plugin look, so it stays a
  // one-at-a-time click even when several are available; the button below
  // simply excludes them rather than silently approving unreviewed code.
  const updatableOfficialRows = useMemo(() => rows.filter((row) => {
    if (row.source !== "local" || !isOfficial(row)) return false;
    const entry = catalog.entryFor(row.id);
    return !!entry?.isNewer && entry.installable;
  }), [rows, catalog]);

  async function updateAllOfficial() {
    setUpdatingAll(true);
    try {
      for (const row of updatableOfficialRows) {
        const entry = catalog.entryFor(row.id);
        if (entry) await catalog.installUpdate(entry);
      }
    } finally {
      setUpdatingAll(false);
    }
  }

  function toggleCore(id: string) {
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    void applySelection(next);
  }

  async function applySelection(nextSelection = selected) {
    setBusy(true);
    setError("");
    try {
      const ids = await applyPluginSelection(coreHost, BUILTIN_PLUGINS, nextSelection);
      localStorage.setItem(MATRIX_SELECTION_KEY, JSON.stringify(ids));
      setSelected([...ids]);
    } catch (value) {
      setError(shortError(value));
    } finally {
      setBusy(false);
      setActive(coreHost.getSnapshot().map((item) => item.pluginId));
    }
  }

  function toggleRow(row: PluginRow) {
    // A plugin just opened this screen (ui.openPluginSettings): the click was
    // aimed at what was under the cursor before, not at this switch.
    if (pluginNavigationInert()) return;
    if (row.source === "core") toggleCore(row.id);
    else onToggleLocal?.(row);
  }

  // API 1.22: ui.openPluginSettings lands here with a plugin to show.
  useEffect(() => {
    const take = () => { const pluginId = takePluginSelection(); if (pluginId) select(pluginId); };
    take();
    window.addEventListener("notible:select-plugin", take);
    return () => window.removeEventListener("notible:select-plugin", take);
  });

  const selectedRow = selectedId ? rows.find((row) => row.id === selectedId) ?? null : null;
  const selectedMarket = selectedId ? catalog.entries?.find((entry) => entry.id === selectedId) ?? null : null;
  // Below 1280 px the shell shows the list or the details, not both stacked
  // (audit V-SCREENS-02, V-PLUGINS-01); CSS reads this flag.
  useEffect(() => {
    const shell = detailContainer?.closest<HTMLElement>(".core-settings-shell");
    if (!shell) return;
    shell.dataset.pluginOpen = (tab === "all" ? selectedRow : selectedMarket) ? "true" : "false";
    return () => { delete shell.dataset.pluginOpen; };
  }, [detailContainer, selectedRow, selectedMarket, tab]);

  const list = tab === "market"
    ? (
      <div className="core-plugin-index">
        <div className="core-plugin-index-toolbar">
          <p className="core-plugin-index-count">{catalog.status === "loading"
            ? <><RefreshCw size={13} className="is-spinning" aria-hidden="true" /> {t("Loading the market…")}</>
            : t("{count} published", { count: catalog.entries?.length ?? 0 })}</p>
          <button type="button" className="core-icon-action" onClick={() => void catalog.reload()} disabled={catalog.status === "loading"} title={t("Refresh the market")} aria-label={t("Refresh the market")}>
            <RefreshCw size={15} aria-hidden="true" />
          </button>
        </div>
        {catalog.status === "error" && <p className="core-alert" role="alert">{t("Could not read the market: {message}", { message: catalog.message ?? "" })}</p>}
        {visibleMarket?.length === 0 && <p className="core-muted">{query ? t("Nothing published matches “{query}”.", { query }) : t("Nothing published yet.")}</p>}
        {/* Official and community apart: one warning over a list of official
            plugins read as a contradiction (CE61, CP72). */}
        {([
          { key: "official", heading: t("Official"), note: t("Made by the Notible developer."), entries: (visibleMarket ?? []).filter((entry) => isOfficialReleaseUrl(entry.zipUrl)) },
          { key: "community", heading: t("Community"), note: t("Community plugins are published by other people and are not reviewed by Notible. You install them at your own risk."), entries: (visibleMarket ?? []).filter((entry) => !isOfficialReleaseUrl(entry.zipUrl)) },
        ]).filter((group) => group.entries.length > 0).map((group) => (
          <section className="core-plugin-index-group" key={group.key}>
            <h4 className="core-matrix-category-heading">{group.heading}</h4>
            <p className="core-plugin-index-note">{group.note}</p>
            {group.entries.map((entry) => (
              <div key={entry.id} className={`core-plugin-index-row ${entry.id === selectedId ? "is-selected" : ""}`}>
                <button type="button" className="core-plugin-index-open" onClick={() => select(entry.id)} aria-pressed={entry.id === selectedId}>
                  <Package size={16} className="core-plugin-index-icon" aria-hidden="true" />
                  <span className="core-plugin-index-name">{entry.name}{entry.description && <small className="core-plugin-index-desc">{entry.description}</small>}</span>
                  <span className="core-plugin-index-meta">{catalog.busyId === entry.id ? t("Installing…") : entry.isNewer ? t("Update") : entry.installedVersion ? t("Installed") : t("New")}{entry.release ? ` · v${entry.release.version}` : ""}</span>
                </button>
              </div>
            ))}
          </section>
        ))}
      </div>
    )
    : (
      <div className="core-plugin-index">
        <div className="core-plugin-index-toolbar">
          <p className="core-plugin-index-count">{t("{on} of {count} turned on", { on: active.length, count: rows.length })}</p>
          <div className="core-plugin-index-toolbar-actions">
            {updatableOfficialRows.length > 1 && (
              <button
                type="button"
                className="core-button core-plugin-index-update-all"
                onClick={() => void updateAllOfficial()}
                disabled={updatingAll || busy}
              >
                {updatingAll ? t("Updating…") : t("Update all ({count})", { count: updatableOfficialRows.length })}
              </button>
            )}
            <input
              type="search"
              className="core-matrix-search"
              placeholder={t("Search plugins…")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t("Search plugins")}
            />
          </div>
        </div>

        {visibleRows.length === 0 && <p className="core-muted">{t("No plugin matches “{query}”.", { query })}</p>}
        {groups.map(({ name, rows: groupRows }) => {
          const Icon = CATEGORY_ICON[name] ?? Puzzle;
          return (
            <section className="core-plugin-index-group" key={name}>
              <h4 className="core-matrix-category-heading">{t(name)}</h4>
              {groupRows.map((row) => {
                const update = row.source === "local" ? catalog.entryFor(row.id) : undefined;
                const hasUpdate = !!update?.isNewer && update.installable;
                const rowBusy = catalog.busyId === row.id;
                return (
                  <div key={row.id} className={`core-plugin-index-row ${row.id === selectedId ? "is-selected" : ""}`} onContextMenu={row.source === "local" ? (event) => { event.preventDefault(); setRowMenu({ x: event.clientX, y: event.clientY, row }); } : undefined}>
                    <button type="button" className="core-plugin-index-open" onClick={() => select(row.id)} aria-pressed={row.id === selectedId}>
                      <Icon size={16} className="core-plugin-index-icon" aria-hidden="true" />
                      <span className="core-plugin-index-name">{row.source === "core" ? t(row.name) : row.name}</span>
                      <span className="core-plugin-index-meta">{row.source === "core" ? t("Built in") : `${isOfficial(row) ? t("Official") : t("Community")} · v${row.version}`}</span>
                    </button>
                    {hasUpdate && update && <button type="button" className="core-plugin-index-update" onClick={() => setPendingInstall(update)} disabled={busy || rowBusy}>{t("Update")}</button>}
                    <CoreSwitch
                      checked={row.state === "active"}
                      label={t("Enable {name}", { name: row.source === "core" ? t(row.name) : row.name })}
                      onChange={() => toggleRow(row)}
                      disabled={busy}
                    />
                  </div>
                );
              })}
            </section>
          );
        })}
        {error && <p className="core-alert" role="alert">{error}</p>}
      </div>
    );

  // Below 1400px the details stack under the list, off screen for most rows,
  // so a click looked like it did nothing. Bring them into view.
  const select = (id: string) => {
    setSelectedId(id);
    requestAnimationFrame(() => {
      const top = detailContainer?.getBoundingClientRect().top ?? 0;
      // Above the window too: on a short window the details could sit above a
      // plugin picked near the bottom of the list.
      if (top > window.innerHeight * 0.6 || top < 0) detailContainer?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };

  let detail: ReactNode = emptyState ?? null;
  if (tab === "market" && selectedMarket) {
    detail = <MarketDetail key={selectedMarket.id} entry={selectedMarket} busy={catalog.busyId === selectedMarket.id} onInstall={() => setPendingInstall(selectedMarket)} onBack={() => setSelectedId(null)} />;
  } else if (tab === "all" && selectedRow) {
    detail = <PluginDetail
      key={selectedRow.id}
      row={selectedRow}
      activeIds={active}
      snapshot={activeSnapshots.find((item) => item.pluginId === selectedRow.id)}
      guide={guideFor(selectedRow, entries)}
      ownManifest={selectedRow.source === "local" ? localManifest(selectedRow, entries) : null}
      marketDescription={catalog.entryFor(selectedRow.id)?.description}
      onBack={() => setSelectedId(null)}
      author={authorFor(selectedRow, entries)}
      busy={busy}
      official={isOfficial(selectedRow)}
      onToggle={() => toggleRow(selectedRow)}
      onReload={selectedRow.source === "local" && onReloadLocal ? () => { if (!pluginNavigationInert()) onReloadLocal(selectedRow); } : undefined}
      onRemove={selectedRow.source === "local" && onRemoveLocal ? () => { if (!pluginNavigationInert()) onRemoveLocal(selectedRow); } : undefined}
    />;
  }

  return (
    <>
      {list}
      {rowMenu && createPortal(
        <div className="core-create-menu core-row-context-menu" role="menu" style={{ position: "fixed", left: rowMenu.x, top: rowMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          {onReloadLocal && <button type="button" onClick={() => { const target = rowMenu.row; setRowMenu(null); if (!pluginNavigationInert()) onReloadLocal(target); }}><RotateCw size={15} /> {t("Reload")}</button>}
          {onRemoveLocal && <button type="button" className="core-menu-item-danger" onClick={() => { const target = rowMenu.row; setRowMenu(null); if (!pluginNavigationInert()) onRemoveLocal(target); }}>{t("Remove")}</button>}
        </div>,
        document.body,
      )}
      {detailContainer ? createPortal(detail, detailContainer) : null}
      {/* Portalled: inside the settings card an animated ancestor became the
          containing block, so the dialog floated over the list (CE63). */}
      {pendingInstall && createPortal(
        <div className="core-modal-backdrop" role="presentation" onClick={() => setPendingInstall(null)}>
          <div className="core-modal" role="dialog" aria-modal="true" aria-labelledby="core-trust-title" onClick={(event) => event.stopPropagation()}>
            <h3 id="core-trust-title">{t("Install {name} {version}?", { name: pendingInstall.name, version: pendingInstall.release?.version ?? "" })}</h3>
            <p>{isOfficialReleaseUrl(pendingInstall.zipUrl) ? t("Official plugin by the Notible developer. Once installed it runs with full access to your notes and the internet, like any plugin.") : t("Published by {author}. It is not reviewed or verified by Notible for this version. Once installed it runs with full access to your notes and the internet, like any plugin.", { author: pendingInstall.author })}</p>
            <div className="core-modal-actions">
              <button type="button" className="core-button core-button-secondary" autoFocus onClick={() => setPendingInstall(null)}>{t("Cancel")}</button>
              <button type="button" className="core-button core-button-primary" onClick={() => { const target = pendingInstall; setPendingInstall(null); if (target) void catalog.installUpdate(target); }}>{t("Install")}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

type PluginSnapshot = ReturnType<typeof coreHost.getSnapshot>[number];

function PluginDetail({ row, activeIds, snapshot, guide, author, busy, official, onToggle, onReload, onRemove, ownManifest, marketDescription, onBack }: {
  row: PluginRow;
  ownManifest?: Record<string, unknown> | null;
  marketDescription?: string;
  onBack?: () => void;
  activeIds: string[];
  snapshot?: PluginSnapshot;
  guide: string | null;
  author: string | null;
  busy: boolean;
  official: boolean;
  onToggle: () => void;
  onReload?: () => void;
  onRemove?: () => void;
}) {
  const { t } = useCoreI18n();
  const manifest = manifestFor(row.id);
  // Installed market plugins read their own manifest (or the market's text):
  // they all used to fall back to one generic sentence (audit V-PLUGINS-02).
  const ownDescription = typeof ownManifest?.description === "string" ? ownManifest.description : undefined;
  const longDescription = PLUGIN_LONG_DESCRIPTIONS[row.id];
  const description = longDescription ? t(longDescription) : manifest?.description ?? ownDescription ?? marketDescription ?? "";
  const example = PLUGIN_EXAMPLES[row.id];
  const whereLines = PLUGIN_WHERE[row.id] ? [t(PLUGIN_WHERE[row.id])] : foundAt(row.id, t);
  const needs = (PLUGIN_NEEDS[row.id] ?? []).filter((needed) => !activeIds.includes(needed));
  const permissions = manifest?.permissions ?? (Array.isArray(ownManifest?.permissions) ? ownManifest.permissions.filter((value): value is string => typeof value === "string") : []);
  const networkHosts = (Array.isArray(manifest?.networkHosts ?? ownManifest?.networkHosts) ? (manifest?.networkHosts ?? ownManifest?.networkHosts as unknown[]).filter((value): value is string => typeof value === "string").slice(0, 20) : []);
  const allSettings = snapshot?.settings ?? [];
  const mountEntries = allSettings.filter((entry) => entry.mount && !entry.schema);
  const schemaEntries = allSettings.filter((entry) => entry.schema);
  // A plugin (e.g. notible.themes) that registers a settings panel through the
  // React `render` path — not a declared schema, not a raw DOM mount. The old
  // "Plugin settings" screen rendered these; the master/detail rebuild only
  // kept schema + mount, so those panels silently vanished. PluginSettingsSurface
  // already resolves the react-loader descriptor.
  const renderEntries = allSettings.filter((entry) => !entry.schema && !entry.mount && (entry as { render?: unknown }).render);

  return (
    <div className="core-plugin-detail">
      {onBack && <button type="button" className="core-plugin-detail-back" onClick={onBack}>← {t("All plugins")}</button>}
      <div className="core-plugin-detail-head">
        <h3>{row.source === "core" ? t(row.name) : row.name}</h3>
        <small>{row.source === "core" ? t("Built in") : `v${row.version}`} · {row.state === "active" ? t("On") : t("Off")}</small>
        <div className="core-plugin-detail-actions">
          <CoreSwitch checked={row.state === "active"} label={t("Enable {name}", { name: row.source === "core" ? t(row.name) : row.name })} onChange={onToggle} disabled={busy} />
          {onReload && <button type="button" className="core-button core-reload-button" onClick={onReload} disabled={busy}><RotateCw size={14} aria-hidden="true" />{t("Reload")}</button>}
          {onRemove && <button type="button" className="core-button" onClick={onRemove} disabled={busy}>{t("Remove")}</button>}
        </div>
      </div>

      {description && <p>{description}</p>}

      <div className="core-matrix-detail-part">
        <strong>{t("Author and signature")}</strong>
        {row.source === "core"
          ? <p>{author ? `${t("By {author}.", { author })} ` : ""}{t("Bundled with Notible and updated with the app.")}</p>
          : <p className="core-plugin-signature">
              <span className={official ? "core-plugin-state active" : "core-plugin-state"}>
                {official ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />} {official ? t("official") : t("community")}
              </span>
              {author
                ? ` ${t("Built by {author}, an independent plugin for Notible.", { author })} `
                : ` ${t("An independent plugin for Notible.")} `}
              {official
                ? t("Published by the Notible developer and installed from the official market. Plugins carry no cryptographic signature; this is judged by where the package was downloaded from.")
                : t("Not from the official Notible market (a community plugin or a local folder). Only its author vouches for it.")}
            </p>}
      </div>

      {guide && <details className="core-matrix-detail-part core-plugin-guide-fold">
        <summary><strong>{t("Instructions")}</strong></summary>
        {/* renderCoreMarkdown emits a `.core-code-copy` button in every fenced
            block; the editor wires it, this static render has to wire its own. */}
        <div className="core-plugin-guide" onClick={(event) => {
          const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.core-plugin-guide-link");
          if (anchor) {
            // Never navigate the app's own webview — hand the URL to the OS browser.
            event.preventDefault();
            const url = anchor.getAttribute("href") ?? "";
            void openUrl(url).catch(() => window.open(url, "_blank", "noopener"));
            return;
          }
          const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".core-code-copy");
          if (!button) return;
          const code = button.closest("pre")?.querySelector("code")?.textContent ?? "";
          void navigator.clipboard.writeText(code);
          const original = button.textContent;
          button.textContent = t("Copied");
          window.setTimeout(() => { button.textContent = original; }, 1200);
        }} dangerouslySetInnerHTML={{ __html: guideLinks(renderCoreMarkdown(guide)) }} />
      </details>}

      {whereLines.length > 0 && <div className="core-matrix-detail-part">
        <strong>{t("Where to find it")}</strong>
        {whereLines.map((line) => <p key={line}>{line}</p>)}
      </div>}

      {example && <div className="core-matrix-detail-part">
        <strong>{t("For example")}</strong>
        <p>{row.source === "core" ? t(example) : example}</p>
      </div>}

      {needs.length > 0 && <div className="core-matrix-detail-part">
        <strong>{t("Turn on first")}</strong>
        {/* I18N (Hive #58 round 2): needed builtins are named through t(); the sentence has its own literal per count. */}
        {(() => {
          const list = needs.map((needed) => { const name = manifestFor(needed)?.name; return name ? t(name) : needed; }).join(", ");
          return <p>{needs.length > 1 ? t("{list} — without those, this one has nothing to work on.", { list }) : t("{list} — without that, this one has nothing to work on.", { list })}</p>;
        })()}
      </div>}

      {snapshot && (() => {
        // Named rows use only data the plugin itself registered — a view's
        // `title`, a settings panel's `title`, a command's `name` + optional
        // `description` — never invented copy. Commands without a description
        // and slots (which carry no human-readable name at all, see
        // `SlotRegistration`) fold into a trailing count instead of a blank row.
        type Row = { key: string; icon: ReactNode; title: string; detail?: string };
        // Built-ins' internal "status" command is plumbing, not something the plugin adds.
        const commands = snapshot.commands.filter((command) => command.id !== "status");
        const named: Row[] = [
          ...snapshot.views.map((view) => ({ key: `view:${view.id}`, icon: <LayoutGrid size={14} />, title: row.source === "core" ? t(view.title) : view.title })),
          // I18N (Hive #58): builtin titles and command text go through t() like the view titles above.
          ...snapshot.settings.map((entry) => ({ key: `settings:${entry.id}`, icon: <SlidersHorizontal size={14} />, title: row.source === "core" ? t(entry.title) : entry.title })),
          ...commands.filter((command) => command.description).map((command) => ({ key: `cmd:${command.id}`, icon: <Zap size={14} />, title: row.source === "core" ? t(command.name) : command.name, detail: row.source === "core" ? t(command.description!) : command.description })),
        ];
        const undescribedCommands = commands.length - commands.filter((command) => command.description).length;
        const slotCount = Object.values(snapshot.slots).flat().length;
        const rowLimit = 6;
        const shown = named.slice(0, rowLimit);
        const hiddenNamed = named.length - shown.length;
        const extras: string[] = [];
        // Count lines are Core's own words, so they are translated for every row.
        if (hiddenNamed > 0) extras.push(t("{count} more", { count: hiddenNamed }));
        if (undescribedCommands > 0) extras.push(t("{count} more commands", { count: undescribedCommands }));
        if (slotCount > 0) extras.push(t("{count} places in the interface", { count: slotCount }));
        return (
          <div className="core-matrix-detail-part">
            <strong>{t("Adds right now")}</strong>
            {shown.length > 0
              ? <ul className="core-plugin-adds-list">
                  {shown.map((row) => <li key={row.key}>{row.icon}<span><strong>{row.title}</strong>{row.detail && <small>{row.detail}</small>}</span></li>)}
                </ul>
              : <p>{t("nothing yet")}</p>}
            {extras.length > 0 && <p className="core-plugin-adds-more">+ {extras.join(" · ")}</p>}
          </div>
        );
      })()}

      {permissions.length > 0 && <div className="core-matrix-detail-part">
        <strong>{t("Allowed to")}</strong>
        <ul className="core-plugin-permissions">{permissions.map((permission) => <li key={permission}>{PERMISSION_WORDS[permission] ? t(PERMISSION_WORDS[permission]) : permission}</li>)}</ul>
      </div>}
      {networkHosts.length > 0 && <div className="core-matrix-detail-part">
        <strong>{t("Talks to")}</strong>
        <p>{networkHosts.join(", ")}</p>
      </div>}

      {mountEntries.map((entry) => (
        <div className="core-matrix-detail-part" key={entry.id}>
          <strong>{row.source === "core" ? t(entry.title) : entry.title}</strong>
          <PluginDomMount mount={entry.mount!} pluginId={row.id} />
        </div>
      ))}

      {schemaEntries.map((entry) => (
        <div className="core-matrix-detail-part" key={entry.id}>
          <strong>{row.source === "core" ? t(entry.title) : entry.title}</strong>
          <PluginSettingsForm pluginId={row.id} schema={entry.schema!} />
        </div>
      ))}

      {renderEntries.map((entry) => (
        <div className="core-matrix-detail-part" key={entry.id}>
          <strong>{row.source === "core" ? t(entry.title) : entry.title}</strong>
          <PluginSettingsSurface item={{ key: `${row.id}:${entry.id}`, pluginId: row.id, registration: entry }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Where a running plugin's features show up, read from what it registered (M4): what it adds to
 * the + menu, project tabs, sidebar views and note blocks. Empty when it is not running.
 */
function foundAt(pluginId: string, t: (key: string, values?: Record<string, string | number>) => string): string[] {
  const snapshot = coreHost.getSnapshot(pluginId)[0];
  if (!snapshot) return [];
  const lines: string[] = [];
  const creates = snapshot.commands.flatMap((command) => command.creates ? [command.creates.label] : []);
  if (creates.length) lines.push(t("The + menu: {list}", { list: creates.join(", ") }));
  const tabs = snapshot.objectTabs.map((tab) => tab.label);
  if (tabs.length) lines.push(t("A project's Modules: {list}", { list: tabs.join(", ") }));
  const nav = snapshot.views.filter((view) => (view as { nav?: boolean }).nav).map((view) => view.title);
  if (nav.length) lines.push(t("The sidebar: {list}", { list: nav.join(", ") }));
  if (snapshot.codeBlocks.length) lines.push(t("In a note: type / for its blocks"));
  if (snapshot.slots["workspace.corner"]?.length) lines.push(t("The bottom-left corner of your notes"));
  return lines;
}

function MarketDetail({ entry, busy, onInstall, onBack }: { entry: MarketEntry; busy: boolean; onInstall: () => void; onBack?: () => void }) {
  const { t } = useCoreI18n();
  const release = entry.release;
  return (
    <div className="core-plugin-detail">
      {onBack && <button type="button" className="core-plugin-detail-back" onClick={onBack}>← {t("All plugins")}</button>}
      <div className="core-plugin-detail-head">
        <h3>{entry.name}</h3>
        <small title={`${entry.id}${release ? ` · API ${release.apiVersion} · needs Notible ${release.minCoreVersion}` : ""}`}>
          {release && `v${release.version}`}
          {entry.installedVersion && ` · ${t("installed")} ${entry.installedVersion}`}
        </small>
        <div className="core-plugin-detail-actions">
          {entry.installedVersion !== null && (
            <span className={`core-plugin-state${entry.isNewer ? " active" : ""}`}>{entry.isNewer ? t("update available") : t("up to date")}</span>
          )}
        </div>
      </div>

      {entry.description && <p>{entry.description}</p>}
      {entry.installedVersion && (() => {
        const lines = foundAt(entry.id, t);
        return lines.length > 0 && <div className="core-matrix-detail-part">
          <strong>{t("Where to find it")}</strong>
          {lines.map((line) => <p key={line}>{line}</p>)}
        </div>;
      })()}
      {release && !entry.installedVersion && <div className="core-matrix-detail-part">
        <strong>{t("Will be allowed to")}</strong>
        {release.permissions.length === 0
          ? <p>{t("Nothing beyond showing its own screens.")}</p>
          : <ul className="core-plugin-permissions">{release.permissions.map((permission) => <li key={permission}>{PERMISSION_WORDS[permission] ? t(PERMISSION_WORDS[permission]) : permission}</li>)}</ul>}
        {(release.networkHosts?.length ?? 0) > 0 && <p>{t("Talks to")}: {release.networkHosts!.join(", ")}</p>}
      </div>}
      {entry.problem
        ? <p className="core-plugin-index-note">This plugin can't be installed: {entry.problem}.</p>
        : <p className="core-plugin-index-note">{isOfficialReleaseUrl(entry.zipUrl) ? t("Official: published by the Notible developer.") : t("Published by {author}. Not reviewed or verified by Notible.", { author: entry.author })}</p>}

      <div className="core-matrix-detail-part">
        <button
          type="button"
          className="core-button core-button-primary"
          onClick={onInstall}
          disabled={!entry.installable || busy}
          title={entry.problem ?? (entry.upToDate ? t("Already installed at this version") : entry.compatible ? t("Download and install this plugin") : t("This build does not offer the API this plugin needs"))}
        >
          {entry.installable && !entry.upToDate && <Download size={14} />} {busy ? t("Installing…") : entry.actionLabel}
        </button>
      </div>
    </div>
  );
}
