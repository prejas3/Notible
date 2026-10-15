import { useEffect, useState } from "react";
import { Select } from "../../src/core/ui/index.ts";
import type { PluginContext, PluginObject } from "../../packages/plugin-api/src/index.ts";
import { installFinance } from "./finance.ts";
import { installWorkModels } from "./work-models.ts";
import { searchWorkspace } from "./search.ts";
import { createWhiteboard } from "./whiteboard.ts";
import { prioritizeWorkspace } from "./ai.ts";
import { inspectCode, CODE_LANGUAGES } from "./editor-extensions.ts";
import { exportObjectTree, importPluginData, objectToMarkdown } from "./import-export.ts";
import { selectTheme, useThemePacks, fetchThemeSources, repoFromInput, type ThemeSource } from "./themes.ts";
import "./surface.css";
import "./domain-plugin-ui.css";
import { PluginI18nProvider, useT } from "./i18n.tsx";

/** A literal format hint, the same in every language. */
const REPO_PLACEHOLDER = "owner/repository";

interface Props { context: unknown; host?: { openObject(id: string): Promise<void>; notifyChanged(): void }; initialContainerId?: string; }

function errorMessage(value: unknown) { return value instanceof Error ? value.message : String(value); }
function usePluginState() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function clear() { setError(""); setNotice(""); }
  return { busy, setBusy, error, setError, notice, setNotice, clear };
}

/**
 * `compact` is set when the surface is mounted as a tab on the object it
 * belongs to (API 1.5): the tab strip already names the screen, so the header
 * goes away entirely.
 *
 * Even uncompacted there is no <h2>. Every host that mounts one of these names
 * it — the settings nav writes the panel title right above this — and a second
 * heading repeating that word is the duplicate-title defect Core fixed in
 * 0.53.0. The description stays, because that one says something new.
 */
function Frame({ id, description, children, error, notice, compact }: { id: string; description: string; children: React.ReactNode; error: string; notice: string; compact?: boolean }) {
  return <article className="domain-plugin-surface" data-plugin-surface={id}>{!compact && <header className="domain-plugin-header"><div><p>{description}</p></div></header>}{error && <div className="domain-plugin-message error" role="alert">{error}</div>}{notice && <div className="domain-plugin-message success" role="status">{notice}</div>}{children}</article>;
}

function WorkModelsPanel({ context }: { context: PluginContext }) {
  const t = useT();
  const state = usePluginState();
  // Creating and editing task/issue/project records happens in the workspace
  // (project dashboard, container views). The only thing to do here is (re)install
  // the type schemas — that also happens automatically on activation, so this
  // button is just a manual re-run.
  async function install() { state.clear(); state.setBusy(true); try { const result = await installWorkModels(context); state.setNotice(`${result.modelCount} work models ready.`); } catch (value) { state.setError(errorMessage(value)); } finally { state.setBusy(false); } }
  return <Frame id={context.manifest.id} description="Activates the task, issue, project, milestone, cycle and release types, editable from any project view. Records are created and managed in the workspace, not here." error={state.error} notice={state.notice}><div className="domain-plugin-actions"><button type="button" className="domain-primary" onClick={() => void install()} disabled={state.busy}>{t("Reinstall type schemas")}</button></div></Frame>;
}

function FinancePanel({ context }: { context: PluginContext }) {
  const t = useT();
  const state = usePluginState();
  // Adding/editing financial entries and reading totals happens in a project's
  // Finance tab. The only thing this panel does is (re)install the type schemas.
  async function install() { state.clear(); state.setBusy(true); try { const result = await installFinance(context); state.setNotice(`Finance models ready: ${result.types.join(", ")}.`); } catch (value) { state.setError(errorMessage(value)); } finally { state.setBusy(false); } }
  return <Frame id={context.manifest.id} description="Activates the financial entry, time entry and vendor types. Entries and totals live in each project's Finance tab, not here." error={state.error} notice={state.notice}><div className="domain-plugin-actions"><button type="button" className="domain-primary" onClick={() => void install()} disabled={state.busy}>{t("Reinstall type schemas")}</button></div></Frame>;
}

function SearchPanel({ context, host }: Props & { context: PluginContext }) {
  const t = useT();
  const state = usePluginState(); const [query, setQuery] = useState(""); const [results, setResults] = useState<PluginObject[]>([]);
  async function run() { state.clear(); state.setBusy(true); try { const result = await searchWorkspace(context, { query }); setResults(result.results); } catch (value) { state.setError(errorMessage(value)); } finally { state.setBusy(false); } }
  // Backlink discovery lives in the note detail (Core's own Backlinks panel)
  // and in global Search — this panel is just a plain workspace text search.
  return <Frame id={context.manifest.id} description="A plain text search across every record's title, body and properties, through the public object API." error={state.error} notice={state.notice}><div className="domain-search-row"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void run(); }} /><button type="button" className="domain-primary" onClick={() => void run()} disabled={state.busy}>{t("Search")}</button></div><section className="domain-card"><h3>Results · {results.length}</h3>{results.length === 0 ? <p className="domain-muted">{t("Run a search to inspect workspace records.")}</p> : <div className="domain-record-list">{results.map((object) => <button type="button" key={object.id} onClick={() => void host?.openObject(object.id)}><strong>{object.title || "Untitled"}</strong><small>{object.type}</small></button>)}</div>}</section></Frame>;
}

function WhiteboardPanel({ context }: { context: PluginContext }) {
  const t = useT();
  const state = usePluginState(); const [boards, setBoards] = useState<PluginObject[]>([]); const [title, setTitle] = useState("Team whiteboard");
  async function refresh() { state.setBusy(true); try { setBoards(await context.data.objects.query({ type: "whiteboard", limit: 100 })); } catch (value) { state.setError(errorMessage(value)); } finally { state.setBusy(false); } }
  useEffect(() => { void refresh(); }, [context]);
  async function create() { state.clear(); state.setBusy(true); try { await createWhiteboard(context, { title }); setNotice(); await refresh(); } catch (value) { state.setError(errorMessage(value)); } finally { state.setBusy(false); } }
  function setNotice() { state.setNotice("Whiteboard created."); }
  return <Frame id={context.manifest.id} description="Versioned visual documents are persisted as ordinary plugin objects. The canvas renderer can evolve independently from Core." error={state.error} notice={state.notice}><section className="domain-card"><h3>{t("Create a board")}</h3><div className="domain-search-row"><input value={title} onChange={(event) => setTitle(event.target.value)} /><button type="button" className="domain-primary" onClick={() => void create()} disabled={state.busy}>{t("Create whiteboard")}</button></div></section><section className="domain-card"><h3>Saved boards · {boards.length}</h3>{boards.length === 0 ? <p className="domain-muted">{t("No whiteboards yet.")}</p> : <div className="domain-record-list">{boards.map((board) => <div key={board.id}><strong>{board.title}</strong><small>version {JSON.parse(board.content || "{}").version ?? 1} · {board.id}</small></div>)}</div>}</section></Frame>;
}

/** Mounted as a project tab (API 1.5) the panel configures the project it is
 * mounted on, so the project picker disappears — you are already inside the
 * project. It still renders standalone, where the picker is the only way to
 * say which project you mean. */
function CalendarPanel({ context, initialContainerId }: { context: PluginContext; initialContainerId?: string }) {
  const t = useT();
  const state = usePluginState();
  // Connecting Google / Outlook and picking calendars now lives in each
  // project's own Calendar tab (planning → CalendarMonthView → Connections).
  // Nothing left to configure here — the panel stays only as a pointer.
  return <Frame id={context.manifest.id} description="Connect Google or Outlook, pick calendars and see events in each project's Calendar tab. There is nothing to set workspace-wide." error={state.error} notice={state.notice} compact={Boolean(initialContainerId)}><p className="domain-muted">Open a project, go to its <strong>{t("Calendar")}</strong> tab, then <strong>{t("Connections")}</strong> to add an external calendar. Turn on “Let plugins read your calendars” in Settings → Files &amp; links first.</p></Frame>;
}

function AiPanel({ context, host }: Props & { context: PluginContext }) {
  const t = useT();
  const state = usePluginState(); const [suggestions, setSuggestions] = useState<Array<{ object: PluginObject; score: number; reasons: string[] }>>([]);
  async function run() { state.clear(); state.setBusy(true); try { setSuggestions((await prioritizeWorkspace(context)).suggestions); state.setNotice("Priority suggestions refreshed."); } catch (value) { state.setError(errorMessage(value)); } finally { state.setBusy(false); } }
  useEffect(() => { void run(); }, [context]);
  return <Frame id={context.manifest.id} description="Deterministic prioritization is plugin-owned; provider execution and write approval remain outside this surface." error={state.error} notice={state.notice}><button type="button" className="domain-primary" onClick={() => void run()} disabled={state.busy}>{t("Refresh priorities")}</button><div className="domain-card"><h3>Suggested focus · {suggestions.length}</h3>{suggestions.length === 0 ? <p className="domain-muted">{t("No open work was found.")}</p> : <div className="domain-record-list">{suggestions.map((suggestion) => <button type="button" key={suggestion.object.id} onClick={() => void host?.openObject(suggestion.object.id)}><strong>{suggestion.object.title || "Untitled"}<span className="domain-score">{suggestion.score}</span></strong><small>{suggestion.object.type} · {suggestion.reasons.join(" · ")}</small></button>)}</div>}</div></Frame>;
}

function EditorPanel({ context }: { context: PluginContext }) {
  const t = useT();
  const state = usePluginState(); const [language, setLanguage] = useState("typescript"); const [source, setSource] = useState("const note = 'Notible';"); const [result, setResult] = useState<{ language: string; lines: number; characters: number } | null>(null);
  function inspect() { state.clear(); setResult(inspectCode({ language, source })); setNotice(); }
  function setNotice() { state.setNotice("Code block inspected by the editor extension plugin."); }
  return <Frame id={context.manifest.id} description="Language inspection and future editor capabilities are exposed through a plugin boundary." error={state.error} notice={state.notice}><div className="domain-form-row"><label>{t("Language")}<Select value={language} ariaLabel={t("Language")} onChange={(next) => setLanguage(next)} options={CODE_LANGUAGES.map((candidate) => ({ value: candidate, label: candidate }))} /></label><div className="domain-result">{result ? `${result.lines} lines · ${result.characters} characters` : "No inspection yet"}</div></div><label>{t("Code block")}<textarea value={source} onChange={(event) => setSource(event.target.value)} /></label><button type="button" className="domain-primary" onClick={inspect}>{t("Inspect code")}</button></Frame>;
}

function TransferPanel({ context }: { context: PluginContext }) {
  const t = useT();
  const state = usePluginState();
  const [exported, setExported] = useState("");
  const [input, setInput] = useState("");
  const [objects, setObjects] = useState<PluginObject[]>([]);
  const [objectId, setObjectId] = useState("");
  const [reparentId, setReparentId] = useState("");
  useEffect(() => { void context.data.objects.query({ limit: 500 }).then(setObjects).catch(() => setObjects([])); }, [context]);
  async function exportData() {
    if (!objectId) { state.setError("Choose a note or project to export."); return; }
    state.clear(); state.setBusy(true);
    try { setExported((await exportObjectTree(context, { objectId })).content); state.setNotice("Export generated for the selected item and its children."); }
    catch (value) { state.setError(errorMessage(value)); } finally { state.setBusy(false); }
  }
  function downloadMarkdown() {
    const object = objects.find((candidate) => candidate.id === objectId);
    if (!object) { state.setError("Choose a note or project to export."); return; }
    const blob = new Blob([objectToMarkdown(object)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(object.title || "untitled").replace(/[\\/:*?"<>|]/g, "_")}.md`;
    link.click();
    URL.revokeObjectURL(url);
    state.setNotice(`Downloaded "${link.download}".`);
  }
  async function importData() {
    state.clear();
    try {
      const parsed = JSON.parse(input) as { objects?: unknown[] };
      const result = await importPluginData(context, { objects: Array.isArray(parsed.objects) ? parsed.objects : [], parentId: reparentId || undefined });
      state.setNotice(`Imported ${result.imported} records.`);
    } catch (value) { state.setError(errorMessage(value)); }
  }
  return <Frame id={context.manifest.id} description="Export or import one note/project and its children. Whole-workspace backups live in Settings → Recovery, not here." error={state.error} notice={state.notice}>
    <section className="domain-card">
      <h3>{t("Export")}</h3>
      <label>{t("Item")}<Select value={objectId} ariaLabel={t("Item")} placeholder={"Choose a note or project…"} onChange={(next) => setObjectId(next)} options={objects.map((object) => ({ value: object.id, label: `${object.type}: ${object.title || "Untitled"}` }))} /></label>
      <div className="domain-form-row">
        <button type="button" className="domain-primary" onClick={() => void exportData()} disabled={state.busy || !objectId}>{t("Generate JSON export")}</button>
        <button type="button" className="domain-secondary" onClick={downloadMarkdown} disabled={!objectId}>{t("Download as Markdown (.md)")}</button>
      </div>
      {exported && <label>{t("Export payload")}<textarea value={exported} readOnly /></label>}
    </section>
    <section className="domain-card">
      <h3>{t("Import")}</h3>
      <label>{t("Re-parent under")}<Select value={reparentId} ariaLabel={t("Re-parent under")} placeholder={"Keep original location"} onChange={(next) => setReparentId(next)} options={objects.map((object) => ({ value: object.id, label: `${object.type}: ${object.title || "Untitled"}` }))} /></label>
      <label>{t("Import payload")}<textarea value={input} onChange={(event) => setInput(event.target.value)} /></label>
      <button type="button" className="domain-secondary" onClick={() => void importData()} disabled={!input.trim()}>{t("Import JSON")}</button>
    </section>
  </Frame>;
}

/**
 * Community themes. A theme is a styles-only package anyone can publish; this screen
 * installs, switches and removes them. It is marked `core-critical`, so no theme can
 * hide or disable it: switching a theme off must always work.
 */
function ThemesPanel({ context }: { context: PluginContext }) {
  const state = usePluginState();
  const t = useT();
  const themes = useThemePacks();
  const [available, setAvailable] = useState<ThemeSource[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [repoInput, setRepoInput] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchThemeSources().then((list) => { if (!cancelled) setAvailable(list); }).catch((value) => { if (!cancelled) { setAvailable([]); state.setError(errorMessage(value)); } });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const installedIds = new Set(themes.packs.map((pack) => pack.id));
  async function run(key: string, work: () => Promise<void>, done: string) {
    setBusy(key);
    state.clear();
    try { await work(); state.setNotice(done); }
    catch (value) {
      const text = errorMessage(value);
      // Same version again is not a failure, just nothing to do.
      if (/already installed/i.test(text)) state.setNotice(t("Already up to date."));
      else state.setError(text);
    }
    finally { setBusy(null); }
  }
  const host = themes.host;

  return <Frame id={context.manifest.id} description={t("Community themes: styles-only packs that can change colours, backgrounds, glass effects and more. Daylight and Midnight stay in Settings, Appearance.")} error={state.error} notice={state.notice}>
    <div className="core-critical domain-themes">
      <section className="domain-card">
        <h3>{t("Installed")}</h3>
        <ul className="domain-theme-list">
          <li className="domain-theme-row">
            <div><strong>{t("None (system theme)")}</strong><small>{t("Only Daylight or Midnight from Settings, Appearance.")}</small></div>
            {themes.activeId === null ? <span className="domain-theme-badge">{t("In use")}</span> : <button type="button" className="domain-secondary" onClick={() => selectTheme(context, { themeId: null })}>{t("Use")}</button>}
          </li>
          {themes.packs.map((pack) => (
            <li className="domain-theme-row" key={pack.id}>
              <div><strong>{pack.name}</strong><small>{[pack.mode === "dark" ? t("dark") : t("light"), `v${pack.version}`, pack.author].filter(Boolean).join(" · ")}</small>{pack.description && <small>{pack.description}</small>}</div>
              <div className="domain-theme-actions">
                {themes.activeId === pack.id ? <span className="domain-theme-badge">{t("In use")}</span> : <button type="button" className="domain-secondary" onClick={() => selectTheme(context, { themeId: pack.id })}>{t("Use")}</button>}
                {(available ?? []).some((entry) => entry.id === pack.id) && <button type="button" className="domain-secondary" disabled={busy !== null || !host} onClick={() => { const entry = (available ?? []).find((item) => item.id === pack.id); if (entry && host) void run(pack.id, () => host.install(entry), t("Updated {name}. Look it over before you keep using it.", { name: pack.name })); }}>{t("Update")}</button>}
                <button type="button" className="domain-secondary" disabled={busy !== null || !host} onClick={() => { if (host) void run(pack.id, () => host.remove(pack.id), t("Removed {name}.", { name: pack.name })); }}>{t("Remove")}</button>
              </div>
            </li>
          ))}
        </ul>
        {themes.packs.length === 0 && <p className="domain-muted">{t("No community themes installed yet.")}</p>}
      </section>

      <section className="domain-card">
        <h3>{t("Available")}</h3>
        {available === null ? <p className="domain-muted">{t("Loading…")}</p> : available.filter((entry) => !installedIds.has(entry.id)).length === 0
          ? <p className="domain-muted">{t("No community themes are published yet. You can install one directly from GitHub below.")}</p>
          : <ul className="domain-theme-list">
            {available.filter((entry) => !installedIds.has(entry.id)).map((entry) => (
              <li className="domain-theme-row" key={entry.id}>
                <div><strong>{entry.name}</strong><small>{entry.author}</small>{entry.description && <small>{entry.description}</small>}</div>
                <button type="button" className="domain-primary" disabled={busy !== null || !host} onClick={() => { if (host) void run(entry.id, () => host.install(entry), t("Installed {name}.", { name: entry.name })); }}>{t("Install")}</button>
              </li>
            ))}
          </ul>}
      </section>

      <section className="domain-card">
        <h3>{t("Install from GitHub")}</h3>
        <div className="domain-form-row">
          <input aria-label={t("GitHub repository")} placeholder={REPO_PLACEHOLDER} value={repoInput} onChange={(event) => setRepoInput(event.target.value)} />
          <button type="button" className="domain-primary" disabled={busy !== null || !host || !repoFromInput(repoInput)} onClick={() => { const repo = repoFromInput(repoInput); if (repo && host) void run(repo, () => host.installFromRepo(repo), t("Theme installed.")).then(() => setRepoInput("")); }}>{t("Install")}</button>
        </div>
        <p className="domain-muted">{t("The repository's latest release must be a theme pack. A theme only changes how Notible looks and cannot run code.")}</p>
        <p className="domain-muted">{t("If a theme makes Notible hard to use, press Ctrl+Alt+Shift+T to turn it off.")}</p>
      </section>
    </div>
  </Frame>;
}

function DomainPluginSurfaceInner({ context: rawContext, host, initialContainerId }: Props) {
  const t = useT();
  const context = rawContext as PluginContext;
  switch (context.manifest.id) {
    case "notible.work-models": return <WorkModelsPanel context={context} />;
    case "notible.finance": return <FinancePanel context={context} />;
    case "notible.search": return <SearchPanel context={context} host={host} />;
    case "notible.whiteboard": return <WhiteboardPanel context={context} />;
    case "notible.calendar": return <CalendarPanel context={context} initialContainerId={initialContainerId} />;
    case "notible.ai": return <AiPanel context={context} host={host} />;
    case "notible.editor-extensions": return <EditorPanel context={context} />;
    case "notible.import-export": return <TransferPanel context={context} />;
    case "notible.themes": return <ThemesPanel context={context} />;
    default: return <Frame id={context.manifest.id} description="Plugin-owned surface." error="" notice=""><p className="domain-muted">{t("This plugin has no dedicated surface yet.")}</p></Frame>;
  }
}

/** Translation for every component below, from the plugin's own context. The
 * provider has to sit outside the component that consumes it, so the surface
 * proper is `DomainPluginSurfaceInner`. */
export default function DomainPluginSurface(props: Props) {
  return <PluginI18nProvider context={props.context as PluginContext}><DomainPluginSurfaceInner {...props} /></PluginI18nProvider>;
}
