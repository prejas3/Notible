import { appLocale } from "./app-locale.ts";
import { useState, type ReactNode } from "react";
import { Select } from "../../src/core/ui/index.ts";
import type { PluginAutomationLog, PluginAutomationSource, PluginAutomationStep } from "./automations.ts";
import { tr, useT } from "./i18n.tsx";

const SOURCE_LABELS: Record<PluginAutomationSource, string> = { event: tr("Live change"), schedule: tr("Background check"), "run-now": tr("Run now"), panel: tr("Run due rules") };
const STEP_LABELS: Record<PluginAutomationStep["type"], string> = {
  set_property: tr("Change a field"), create_record: tr("Create an item"), add_relation: tr("Link to another item"), move_record: tr("Move to…"),
  set_reminder: tr("Set reminder"), history_note: tr("Add note to history"), notify: tr("Send notification"), save: tr("Save changes"),
};
const EVENT_LABELS: Record<string, string> = {
  record_created: tr("An item is created"), property_changed: tr("A field changes"), relation_changed: tr("An item is linked"),
  date_reached: tr("A date arrives"), recurring: tr("On a schedule"), manual: tr("Only when I press Run"),
};
const STATUS_LABELS: Record<string, string> = { success: tr("Success"), error: tr("Error"), skipped: tr("Skipped"), planned: tr("Planned") };

/** A JS stack already starts with "Name: message"; repeating it above would print the error twice. */
function errorText(error: NonNullable<PluginAutomationLog["error"]>): string {
  const head = `${error.name}: ${error.message}`;
  return !error.stack ? head : error.stack.startsWith(head) ? error.stack : `${head}\n${error.stack}`;
}

export function Chevron() {
  return <svg className="automation-chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function LogEntry({ entry, nested = false }: { entry: PluginAutomationLog; nested?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard can be blocked by the host; the details stay readable on screen */ }
  }
  const ms = (value: number) => t("{ms} ms", { ms: value });
  return <article className={`automation-log-entry ${entry.status}${open ? " is-open" : ""}${nested ? " is-nested" : ""}`}>
    <button type="button" className="automation-log-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Chevron />
      <span className={`automation-dot ${entry.status}`} aria-hidden="true" />
      <span className="automation-log-rule">{entry.ruleName}</span>
      <span className="automation-log-item">{entry.objectTitle || t("Untitled")}</span>
      <span className="automation-log-status">{t(STATUS_LABELS[entry.status] ?? entry.status)}</span>
      <span className="automation-log-time">{new Date(entry.occurredAt).toLocaleString(appLocale())}</span>
    </button>
    {open && <div className="automation-log-body core-view-in">
      <p className="automation-log-message">{entry.message}</p>
      <dl>
        {entry.source && <Row label={t("Source")}>{t(SOURCE_LABELS[entry.source] ?? entry.source)}</Row>}
        <Row label={t("Trigger")}>{t(EVENT_LABELS[entry.event] ?? entry.event)}</Row>
        <Row label={t("Item")}>{[entry.objectTitle || t("Untitled"), entry.objectType, entry.objectId].filter(Boolean).join(" · ")}</Row>
        {entry.startedAt !== undefined && <Row label={t("Started")}>{new Date(entry.startedAt).toLocaleString(appLocale())}</Row>}
        {entry.durationMs !== undefined && <Row label={t("Duration")}>{ms(entry.durationMs)}</Row>}
        {entry.runId && <Row label={t("Run")}>{entry.runId}</Row>}
        <Row label={t("Rule")}>{entry.ruleId}</Row>
      </dl>
      {entry.steps && entry.steps.length > 0 && <ol className="automation-log-steps">
        {entry.steps.map((step) => <li key={step.n} className={step.status}>
          <span className={`automation-dot ${step.status === "ok" ? "success" : step.status}`} aria-hidden="true" />
          <strong>{t(STEP_LABELS[step.type] ?? step.type)}</strong>
          <span>{step.error ? `${step.error.name}: ${step.error.message}` : step.detail ?? ""}</span>
          <small>{ms(step.ms)}</small>
        </li>)}
      </ol>}
      {entry.error && <pre className="automation-log-error">{errorText(entry.error)}</pre>}
      {entry.ruleSnapshot && <details className="automation-log-snapshot"><summary>{t("Rule as it was run")}</summary><pre>{JSON.stringify(entry.ruleSnapshot, null, 2)}</pre></details>}
      <button type="button" className="automation-log-copy" onClick={() => void copy()}>{copied ? t("Copied") : t("Copy details")}</button>
    </div>}
  </article>;
}

/** Consecutive entries of one pass (same runId) read as one line, expandable. */
function LogGroup({ entries }: { entries: PluginAutomationLog[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const failed = entries.filter((entry) => entry.status === "error").length;
  const first = entries[0];
  return <section className={`automation-log-group${open ? " is-open" : ""}`}>
    <button type="button" className="automation-log-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Chevron />
      <span className={`automation-dot ${failed ? "error" : "success"}`} aria-hidden="true" />
      <span className="automation-log-rule">{first.ruleName}</span>
      <span className="automation-log-item">{t("{source} — {n} items · {ok} ok · {failed} failed", { source: t(SOURCE_LABELS[first.source ?? "run-now"]), n: entries.length, ok: entries.filter((entry) => entry.status === "success").length, failed })}</span>
      <span className="automation-log-time">{new Date(first.occurredAt).toLocaleString(appLocale())}</span>
    </button>
    {open && <div className="automation-log-children core-view-in">{entries.map((entry) => <LogEntry key={entry.id} entry={entry} nested />)}</div>}
  </section>;
}

function groupByRun(entries: PluginAutomationLog[]): PluginAutomationLog[][] {
  const groups: PluginAutomationLog[][] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (entry.runId && last && last[0].runId === entry.runId) last.push(entry);
    else groups.push([entry]);
  }
  return groups;
}

export function LogPanel({ logs, onClear }: { logs: PluginAutomationLog[]; onClear: () => void }) {
  const t = useT();
  const [status, setStatus] = useState("all");
  const [ruleId, setRuleId] = useState("all");
  const [confirming, setConfirming] = useState(false);
  const rules = new Map<string, string>();
  for (const entry of logs) if (!rules.has(entry.ruleId)) rules.set(entry.ruleId, entry.ruleName);
  const shown = logs.filter((entry) => (status === "all" || entry.status === status) && (ruleId === "all" || entry.ruleId === ruleId));
  const errors = logs.filter((entry) => entry.status === "error").length;
  if (logs.length === 0) return <div className="automation-log"><div className="automation-empty"><strong>{t("No executions yet")}</strong><span>{t("The log explains successful, skipped and failed runs.")}</span></div></div>;
  return <div className="automation-log">
    <div className="automation-log-toolbar">
      <Select value={status} ariaLabel={t("Filter by status")} onChange={setStatus} options={[{ value: "all", label: t("All statuses") }, { value: "success", label: t("Success") }, { value: "error", label: t("Error") }, { value: "skipped", label: t("Skipped") }]} />
      <Select value={ruleId} ariaLabel={t("Filter by rule")} onChange={setRuleId} options={[{ value: "all", label: t("All rules") }, ...[...rules].map(([value, label]) => ({ value, label }))]} />
      <span className="automation-log-count">{t("{shown} of {total} entries", { shown: shown.length, total: logs.length })}{errors > 0 && <em>{t("{n} with errors", { n: errors })}</em>}</span>
      {!confirming
        ? <button type="button" onClick={() => setConfirming(true)}>{t("Clear log")}</button>
        : <span className="automation-confirm"><button type="button" className="btn-primary" onClick={() => { setConfirming(false); onClear(); }}>{t("Clear {n} entries", { n: logs.length })}</button><button type="button" onClick={() => setConfirming(false)}>{t("Cancel")}</button></span>}
    </div>
    {shown.length === 0 && <p className="automation-scope-hint automation-log-none">{t("No entries match these filters.")}</p>}
    {groupByRun(shown).map((group) => group.length > 1 ? <LogGroup key={group[0].id} entries={group} /> : <LogEntry key={group[0].id} entry={group[0]} />)}
  </div>;
}
