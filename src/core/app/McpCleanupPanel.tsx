// MCP-CLEANUP (Hive #13): Settings → MCP server (section id `ai-cleanup`,
// kept so older links and notices still land here). The user allows scopes,
// reviews what an AI assistant asked to move to the Trash, approves or
// rejects each note, and can undo a cleanup for 24 hours. The rules live in
// src-tauri/src/mcp_cleanup.rs; this screen only shows them and asks.
//
// MCP-SETTINGS (Hive #29, #38): also how to connect a client and what an AI may do.
// Access switches and cleanup scopes are editable here. Rust requires a native
// confirmation for every widening because plugins share this webview's realm.
//
// Everything the AI wrote (its reason, the note titles and text) is shown as
// plain React text, never as markup or as an instruction to this screen.

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, Copy } from "lucide-react";
import type { PluginObject } from "../../../packages/plugin-api/src/index.ts";
import { getMcpInfo, type McpInfo } from "../../lib/api.ts";
import { CoreSwitch } from "./CoreSwitch.tsx";
import { textFromDocument } from "./coreDocument.ts";
import { useCoreI18n } from "./core-i18n.ts";
import "./mcp-cleanup.css";

interface ReviewItem { id: string; title_at_request: string; version: string; object: PluginObject | null; problem: string | null }
interface ReviewRequest { id: string; client: string; reason: string; scope_id: string; created_at: number; expires_at: number; items: ReviewItem[] }
interface AuditEntry { id: number; at: number; event: string; request_id: string; operation_id: string | null; client: string; reason: string; items: unknown; outcome: string; undo_until: number | null }
interface ApplyOutcome { operation_id: string; trashed: number; undo_until: number }
interface UndoOutcome { restored: string[]; skipped: string[] }
interface McpSettings { allowEdits: boolean; includeFinance: boolean; heartbeatAt: number | null }
type McpSettingKey = "allow_edits" | "include_finance";
type ClientKind = "claude" | "codex" | "other";

const HEARTBEAT_MS = 10_000;
/** The panel fires this after any change, so the Settings count updates at once. */
const CHANGED_EVENT = "notible:mcp-cleanup-changed";
/** Same as CLEANUP_HEARTBEAT_STALE_MS in mcp-server/lib.js. */
const HEARTBEAT_STALE_MS = 25_000;

/** What to paste into each client. Codex TOML uses literal '...' strings, so Windows paths need no escaping. */
function clientSnippet(kind: ClientKind, info: McpInfo): string {
  if (kind === "claude") return `claude mcp add notible --scope user -e NOTIBLE_DB_PATH="${info.databasePath}" -- "${info.command}" "${info.serverScript}"`;
  if (kind === "codex") return `[mcp_servers.notible]\ncommand = '${info.command}'\nargs = ['${info.serverScript}']\nenv = { NOTIBLE_DB_PATH = '${info.databasePath}' }`;
  return info.clientConfig;
}

export const listCleanupRequests = () => invoke<ReviewRequest[]>("mcp_cleanup_list");
export const listHeldIds = () => invoke<string[]>("mcp_cleanup_held");
export const undoCleanup = (operationId: string) => invoke<UndoOutcome>("mcp_cleanup_undo", { operationId });

/**
 * Tell MCP the app is running (its requests need a live session) and which
 * note opens on start (protected). Reports how many requests wait, and calls
 * `onNew` once for each request it has not seen before.
 */
export function useMcpCleanupHeartbeat(favouriteId: string | null, onNew: () => void): number {
  const [pending, setPending] = useState(0);
  const seen = useRef(new Set<string>());
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        await invoke("mcp_cleanup_heartbeat", { favouriteId });
        const requests = await listCleanupRequests();
        if (stopped) return;
        setPending(requests.length);
        for (const request of requests) {
          if (seen.current.has(request.id)) continue;
          seen.current.add(request.id);
          onNewRef.current();
        }
      } catch {
        // Outside Tauri (browser preview) or a DB hiccup: MCP sees a stale heartbeat and submits nothing.
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), HEARTBEAT_MS);
    const onChanged = () => void tick();
    window.addEventListener(CHANGED_EVENT, onChanged);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener(CHANGED_EVENT, onChanged); };
  }, [favouriteId]);
  return pending;
}

interface Props {
  projects: PluginObject[];
  /** Save the open editor first, so its unsaved text counts as a change. */
  flush: () => Promise<void>;
  onTrashed: () => Promise<void> | void;
  onError: (value: unknown) => void;
  onNotice: (text: string, action?: { label: string; run: () => void }) => void;
}

export function McpCleanupPanel({ projects, flush, onTrashed, onError, onNotice }: Props) {
  const { t } = useCoreI18n();
  const [scopes, setScopes] = useState<string[]>([]);
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<McpSettings | null>(null);
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [client, setClient] = useState<ClientKind>("claude");

  const problemText: Record<string, string> = {
    "no longer exists": t("No longer exists."),
    "not a note": t("Only notes can be cleaned up."),
    "already trashed or archived": t("Already in the Trash or archived."),
    "protected": t("Protected from AI."),
    "contains other items": t("Contains other items."),
    "outside the scopes you allowed": t("Outside the places you allowed."),
    "changed since the AI looked at it": t("Changed since the AI looked at it."),
  };
  const eventText: Record<string, string> = {
    applied: t("Moved to Trash"), rejected: t("Rejected"), expired: t("Expired"), conflict: t("Stopped: notes changed"), undone: t("Undone"),
  };

  async function refresh() {
    try {
      const [nextScopes, nextRequests, nextAudit, nextSettings] = await Promise.all([
        invoke<string[]>("mcp_cleanup_scopes"), listCleanupRequests(), invoke<AuditEntry[]>("mcp_cleanup_audit", { limit: 50 }), invoke<McpSettings>("mcp_settings_get"),
      ]);
      setScopes(nextScopes);
      setSettings(nextSettings);
      window.dispatchEvent(new Event(CHANGED_EVENT));
      setRequests(nextRequests);
      setAudit(nextAudit);
    } catch (value) {
      onError(value);
    }
  }

  useEffect(() => {
    void refresh();
    getMcpInfo().then(setInfo, () => setInfo(null));
    const timer = window.setInterval(() => void refresh(), HEARTBEAT_MS);
    // Return to the app after another action: refresh the latest access state.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, []);

  async function changeSetting(key: McpSettingKey, enabled: boolean) {
    try { await invoke("mcp_settings_set", { key, enabled }); }
    catch (value) { if (!String(value).includes("Cancelled.")) onError(value); }
    await refresh();
  }

  async function changeScope(scopeId: string, enabled: boolean) {
    try { await invoke("mcp_cleanup_set_scope", { scopeId, enabled }); }
    catch (value) { if (!String(value).includes("Cancelled.")) onError(value); }
    await refresh();
  }

  async function copySnippet() {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(clientSnippet(client, info));
      onNotice(t("Copied."));
    } catch (value) { onError(value); }
  }

  function toggle(requestId: string, itemId: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current[requestId] ?? []);
      if (on) next.add(itemId); else next.delete(itemId);
      return { ...current, [requestId]: next };
    });
  }

  async function undo(operationId: string) {
    setBusy(true);
    try {
      const outcome = await undoCleanup(operationId);
      await onTrashed();
      onNotice(outcome.skipped.length
        ? t("{restored} notes restored. {skipped} were changed or already restored, so they were left as they are.", { restored: outcome.restored.length, skipped: outcome.skipped.length })
        : t("{restored} notes restored.", { restored: outcome.restored.length }));
    } catch (value) { onError(value); }
    finally { setBusy(false); await refresh(); }
  }

  async function approve(request: ReviewRequest) {
    const approvedIds = [...(selected[request.id] ?? [])];
    if (approvedIds.length === 0) return;
    setBusy(true);
    try {
      await flush();
      const outcome = await invoke<ApplyOutcome>("mcp_cleanup_apply", { requestId: request.id, approvedIds });
      await onTrashed();
      onNotice(t("{count} notes moved to the Trash.", { count: outcome.trashed }), { label: t("Undo"), run: () => void undo(outcome.operation_id) });
    } catch (value) {
      if (String(value) !== "Cancelled.") onError(value);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function reject(request: ReviewRequest) {
    setBusy(true);
    try { await invoke("mcp_cleanup_reject", { requestId: request.id }); }
    catch (value) { onError(value); }
    finally { setBusy(false); await refresh(); }
  }

  const appLive = settings?.heartbeatAt != null && Date.now() - settings.heartbeatAt <= HEARTBEAT_STALE_MS;
  const scopeName = (scopeId: string) => scopeId === "workspace" ? t("Whole workspace") : projects.find((project) => project.id === scopeId)?.title || t("Untitled project");

  return <article className="core-settings-section core-view-in">
    <div className="core-settings-section-heading"><div><p className="core-eyebrow">{t("MCP server")}</p><h2>{t("AI assistants")}</h2><p>{t("Connect an AI assistant such as Claude Code or Codex through MCP, choose what it may do, and review what it asks to remove.")}</p></div><span className="core-settings-mark"><Bot size={21} /></span></div>

    <div className="core-settings-group-heading"><h3>{t("Connection")}</h3><p>{t("The AI assistant starts the server itself. Add this to its settings, then restart it.")}</p></div>
    <div className="core-setting-row"><div><label>{t("Notible is open for AI")}</label><small>{t("Cleanup requests need the app open. Reading and editing work while it is closed.")}</small></div><span className="core-setting-value core-mcp-status">{appLive ? <><span className="core-mcp-dot is-live" aria-hidden="true" />{t("Running")}</> : <><span className="core-mcp-dot" aria-hidden="true" />{t("Not seen yet")}</>}</span></div>
    <div className="core-setting-row"><div><label>{t("Server")}</label><small className="core-mcp-path">{info?.serverScript ?? "…"}</small>{info && !info.bundled && <small>{t("This build has no bundled server.")}</small>}</div></div>
    <div className="core-mcp-config">
      <div className="core-mcp-tabs" role="tablist" aria-label={t("Client")}>
        {([["claude", "Claude Code"], ["codex", "Codex"], ["other", t("Other clients")]] as const).map(([kind, name]) => <button key={kind} type="button" role="tab" aria-selected={client === kind} className={client === kind ? "is-active" : ""} onClick={() => setClient(kind)}>{name}</button>)}
        <button type="button" className="core-secondary-action core-mcp-copy" onClick={() => void copySnippet()} disabled={!info}><Copy size={14} /> {t("Copy")}</button>
      </div>
      <pre className="core-mcp-snippet" role="tabpanel">{info ? clientSnippet(client, info) : "…"}</pre>
      <small className="core-mcp-where">{client === "claude" ? t("Run this in a terminal.") : client === "codex" ? t("Add this to ~/.codex/config.toml.") : t("Add this to the client's MCP configuration.")}</small>
    </div>

    <div className="core-settings-group-heading"><h3>{t("What an AI may do")}</h3><p>{t("For every connected AI assistant. These settings are stored on this computer only and are not synced.")}</p></div>
    <div className="core-collection core-mcp-abilities">
      <div className="core-collection-row"><div><strong>{t("Read")}</strong><span className="core-collection-meta">{t("Search, list and open notes, tasks and other items, and read recent changes. Trashed and archived items are left out.")}</span></div><span className="core-setting-value">{t("Always")}</span></div>
      <div className="core-collection-row"><div><strong>{t("Suggest edits")}</strong><span className="core-collection-meta">{t("Prepare a change and show it before and after. Writes nothing.")}</span></div><span className="core-setting-value">{t("Always")}</span></div>
      <div className="core-collection-row"><div><strong>{t("Edit and create")}</strong><span className="core-collection-meta">{t("Apply a suggested edit to a task, issue, note, to-do, ticket, article or bookmark, create tasks, issues and notes, and undo its own edits. Each edit is kept in the item's history.")}</span></div><span className="core-setting-value">{settings?.allowEdits ? t("On") : t("Off")}</span></div>
      <div className="core-collection-row"><div><strong>{t("Finance data")}</strong><span className="core-collection-meta">{t("Expenses, time entries and vendors. Read only, never edited through MCP.")}</span></div><span className="core-setting-value">{settings?.includeFinance ? t("Readable") : t("Hidden")}</span></div>
      <div className="core-collection-row"><div><strong>{t("Ask to move notes to the Trash")}</strong><span className="core-collection-meta">{t("Up to 20 notes per request and 5 requests an hour, one waiting at a time, only where you allow it. You approve each note.")}</span></div><span className="core-setting-value">{scopes.length ? t("Where allowed") : t("Off")}</span></div>
      <div className="core-collection-row"><div><strong>{t("Never")}</strong><span className="core-collection-meta">{t("Delete anything for good, empty the Trash, edit projects or automations, or change these settings.")}</span></div></div>
    </div>
    <div className="core-setting-row"><div><label>{t("Allow edits")}</label><small>{t("Turning this off works at once. Turning it on takes effect when the AI assistant restarts. Notible's own AI only suggests edits either way.")}</small></div><CoreSwitch checked={settings?.allowEdits ?? false} disabled={!settings || busy} label={t("Allow edits")} onChange={(value) => void changeSetting("allow_edits", value)} /></div>
    <div className="core-setting-row"><div><label>{t("Include finance data")}</label><small>{t("Lets a connected AI read expenses, time entries and vendors.")}</small></div><CoreSwitch checked={settings?.includeFinance ?? false} disabled={!settings || busy} label={t("Include finance data")} onChange={(value) => void changeSetting("include_finance", value)} /></div>
    <div className="core-settings-group-heading"><h3>{t("Where the AI may ask")}</h3><p>{t("Off everywhere until you turn it on. Notes you protect, the note that opens on start, and notes with items inside are never included.")}</p></div>
    <div className="core-setting-row"><div><label>{t("Whole workspace")}</label><small>{t("Every note in this workspace.")}</small></div><CoreSwitch checked={scopes.includes("workspace")} disabled={busy} label={t("Whole workspace")} onChange={(value) => void changeScope("workspace", value)} /></div>
    {projects.map((project) => <div className="core-setting-row" key={project.id}><div><label>{project.title || t("Untitled project")}</label><small>{t("Notes inside this project.")}</small></div><CoreSwitch checked={scopes.includes(project.id)} disabled={busy} label={project.title || t("Untitled project")} onChange={(value) => void changeScope(project.id, value)} /></div>)}

    <div className="core-settings-group-heading"><h3>{t("Waiting for you")}</h3><p>{t("Moving to the Trash and restoring both sync to your other devices. A backup is made before anything moves.")}</p></div>
    {requests.length === 0 && <p className="core-settings-hint">{t("No requests. An AI can ask only while Notible is open, and a request expires after 15 minutes.")}</p>}
    {requests.map((request) => {
      const chosen = selected[request.id] ?? new Set<string>();
      return <section className="core-cleanup-request" key={request.id} aria-label={t("Cleanup request")}>
        <header>
          <strong>{t("{client} asks to move {count} notes to the Trash", { client: request.client || t("An AI assistant"), count: request.items.length })}</strong>
          <span className="core-collection-meta">{scopeName(request.scope_id)} · {t("expires {when}", { when: new Date(request.expires_at).toLocaleTimeString() })}</span>
        </header>
        <div className="core-cleanup-reason"><small>{t("Reason given by the AI (not verified):")}</small><p>{request.reason}</p></div>
        <ul>
          {request.items.map((item) => {
            const title = item.object?.title || item.title_at_request || t("Untitled note");
            const excerpt = item.object ? textFromDocument(item.object.content).slice(0, 280) : "";
            return <li key={item.id} className={item.problem ? "is-blocked" : ""}>
              <div>
                <strong>{title}</strong>
                {excerpt && <p className="core-cleanup-excerpt">{excerpt}</p>}
                {item.problem && <small className="core-cleanup-problem">{t("Can't be moved:")} {problemText[item.problem] ?? item.problem}</small>}
              </div>
              <CoreSwitch checked={chosen.has(item.id)} disabled={busy || Boolean(item.problem)} label={t("Move {name} to the Trash", { name: title })} onChange={(value) => toggle(request.id, item.id, value)} />
            </li>;
          })}
        </ul>
        <footer>
          <button type="button" className="core-button" onClick={() => void reject(request)} disabled={busy}>{t("Reject request")}</button>
          <button type="button" className="core-button core-button-danger" onClick={() => void approve(request)} disabled={busy || chosen.size === 0}>{t("Move {count} selected to Trash", { count: chosen.size })}</button>
        </footer>
      </section>;
    })}

    <div className="core-settings-group-heading"><h3>{t("Log")}</h3><p>{t("Every request you decided, kept in this workspace. Undo works for 24 hours.")}</p></div>
    {audit.length === 0 && <p className="core-settings-hint">{t("Nothing yet.")}</p>}
    {audit.length > 0 && <div className="core-collection">
      {audit.map((entry) => <div className="core-collection-row" key={entry.id}>
        <div><strong>{eventText[entry.event] ?? entry.event}</strong><span className="core-collection-meta">{new Date(entry.at).toLocaleString()} · {entry.client || t("An AI assistant")} · {entry.outcome}</span></div>
        {entry.undo_until && entry.operation_id && <button type="button" className="core-secondary-action" disabled={busy} onClick={() => void undo(entry.operation_id!)}>{t("Undo")}</button>}
      </div>)}
    </div>}

  </article>;
}
