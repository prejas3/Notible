import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { PluginObject } from "../../../packages/plugin-api/src/index.ts";
import { renderCoreMarkdown } from "./CoreMarkdownEditor.tsx";
import { clearHistory, deleteHistoryEntry, getHistoryEntry, listHistory, restoreVersion, type HistoryMeta } from "../data/core-data-api.ts";

type Translate = (key: string, values?: Record<string, string | number>) => string;

const PREVIEW_LIMIT = 200_000;

/**
 * Version history of one object, as a side panel. Lists metadata only and
 * fetches one snapshot when a row is picked (fifty full snapshots at once can
 * be a gigabyte). The preview is rendered (N12: raw Markdown read as a bug)
 * by the same renderer as untrusted plugin guides: HTML is escaped, links are
 * inert, and the CSP has no remote image source, so a synced snapshot still
 * cannot load or run anything.
 */
export function VersionHistoryPanel({ object, isNote, toText, beforeRestore, t, onRestored, onError, onNotice, onClose }: {
  /** The live object (the caller passes the editor's current copy when it is open). */
  object: PluginObject;
  isNote: boolean;
  /** Stored note content → the text the editor shows (the editor's own conversion). */
  toText: (content: string) => string;
  /** Runs before a restore — the editor saves what was typed but not yet autosaved. */
  beforeRestore: () => Promise<void>;
  t: Translate;
  onRestored: (restored: PluginObject) => void;
  onError: (value: unknown) => void;
  onNotice: (value: string) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<HistoryMeta[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [armedClear, setArmedClear] = useState(false);

  async function refresh() {
    try { setEntries(await listHistory(object.id)); } catch (value) { onError(value); }
  }
  useEffect(() => { setSelectedId(null); setPreview(null); void refresh(); }, [object.id]);
  // Any write (a sync pull, the user typing) can add a version while the panel is open.
  useEffect(() => {
    const onChange = () => { void refresh(); };
    window.addEventListener("notible:workspace-changed", onChange);
    return () => window.removeEventListener("notible:workspace-changed", onChange);
  }, [object.id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function pick(id: number) {
    setSelectedId(id);
    setPreview(null);
    try {
      const entry = await getHistoryEntry(object.id, id);
      if (!entry) return;
      const snap = JSON.parse(entry.patch) as { title?: string; content?: string };
      setPreview({ title: snap.title ?? "", content: snap.content ?? "" });
    } catch (value) { onError(value); }
  }

  const label = (source: HistoryMeta["source"]) => ({
    local: t("This device"), sync: t("Another device"), restore: t("Restored"), baseline: t("Earlier version"),
  })[source] ?? source;
  const when = (ts: number) => new Date(ts).toLocaleString();
  const selected = entries?.find((entry) => entry.id === selectedId) ?? null;
  const isCurrent = (entry: HistoryMeta) => entries?.[0]?.id === entry.id && preview !== null && preview.title === object.title && preview.content === object.content;

  async function restore(entry: HistoryMeta) {
    try {
      await beforeRestore();
      const restored = await restoreVersion(object.id, entry.id);
      onRestored(restored);
      onNotice(t("Restored the version from {when}.", { when: when(entry.ts) }));
      setSelectedId(null);
      setPreview(null);
      await refresh();
    } catch (value) { onError(value); }
  }
  async function remove(entry: HistoryMeta) {
    try { await deleteHistoryEntry(object.id, entry.id); setSelectedId(null); setPreview(null); await refresh(); } catch (value) { onError(value); }
  }
  async function clearAll() {
    if (!armedClear) { setArmedClear(true); window.setTimeout(() => setArmedClear(false), 2500); return; }
    try { await clearHistory(object.id); setArmedClear(false); setSelectedId(null); setPreview(null); await refresh(); } catch (value) { onError(value); }
  }

  const previewBody = preview ? toText(preview.content) : "";
  const previewText = previewBody.length > PREVIEW_LIMIT
    ? `${previewBody.slice(0, PREVIEW_LIMIT)}\n\n${t("…preview cut off")}`
    : previewBody;

  return (
    <aside className="core-history-panel" aria-label={t("Version history")}>
      <header className="core-history-head">
        <div><h2>{t("Version history")}</h2><p className="core-history-of">{object.title || t("Untitled note")}</p></div>
        <button type="button" className="core-icon-action" onClick={onClose} title={t("Close")} aria-label={t("Close")}><X size={15} /></button>
      </header>
      {entries === null && <p className="core-history-empty">{t("Loading…")}</p>}
      {entries?.length === 0 && <p className="core-history-empty">{t("No earlier versions yet.")}</p>}
      {entries && entries.length > 0 && (
        <ul className="core-history-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button type="button" className={entry.id === selectedId ? "is-selected" : undefined} onClick={() => void pick(entry.id)}>
                <span>{when(entry.ts)}</span>
                <span className="core-history-source">{label(entry.source)}{isCurrent(entry) ? ` · ${t("Current")}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <section className="core-history-preview">
          {preview === null
            ? <p className="core-history-empty">{t("Loading…")}</p>
            : isNote
              ? <div className="core-history-rendered core-plugin-guide" dangerouslySetInnerHTML={{ __html: renderCoreMarkdown(previewText).replace(/<div class="core-code-toolbar"[\s\S]*?<\/div>/gu, "") }} />
              : <p className="core-history-empty">{preview.title} — {t("Preview is available for notes only.")}</p>}
          <div className="core-history-actions">
            {!isCurrent(selected) && <button type="button" onClick={() => void restore(selected)}>{t("Restore this version")}</button>}
            <button type="button" className="core-menu-item-danger" onClick={() => void remove(selected)}>{t("Delete this version")}</button>
          </div>
        </section>
      )}
      {entries && entries.length > 0 && (
        <footer className="core-history-foot">
          <button type="button" className="core-menu-item-danger" onClick={() => void clearAll()}>{armedClear ? t("Click again to clear all versions") : t("Clear history")}</button>
        </footer>
      )}
    </aside>
  );
}
