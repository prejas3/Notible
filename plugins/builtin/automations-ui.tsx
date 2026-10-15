import { appLocale } from "./app-locale.ts";
import { useEffect, useMemo, useState } from "react";
import "./surface.css";
import "./views-ui.css";
import "./automations-ui.css";
import type { PluginContext, PluginObject, PluginType } from "../../packages/plugin-api/src/index.ts";
import {
  executeAutomationRule,
  parsePluginAutomationRules,
  pluginAutomationMatches,
  type PluginAutomationAction,
  type PluginAutomationCondition,
  type PluginAutomationLog,
  type PluginAutomationQuery,
  type PluginAutomationRule,
  type PluginAutomationTrigger,
} from "./automations.ts";
import { PluginI18nProvider, useT, tr } from "./i18n.tsx";
import { Select, DatePicker, Combobox } from "../../src/core/ui/index.ts";
import { describeRule, isUnusedValue, lastRunOf, operatorsFor, OPERATOR_LABELS, VALUELESS_OPERATORS, type FieldKind } from "./automations-describe.ts";
import { RunPanel } from "./automations-run-panel.tsx";
import { Chevron, LogPanel } from "./automations-log.tsx";

interface HostBridge { openObject(id: string): Promise<void>; notifyChanged(): void; }
interface Props { context: unknown; host?: HostBridge; initialContainerId?: string; }
interface Field { id: string; label: string; type: "text" | "number" | "date" | "boolean" | "tags"; }

// Every trigger here runs in the background for as long as Notible is open —
// wired in automationsOnActivate (automations.ts), not in this view.
// "record_created", "property_changed" and "relation_changed" react to a
// real Core event; "recurring" has no event to hook, so it's checked on a
// 15-minute interval instead; "date_reached" also still has its own "Run due
// rules" button here, and "manual" its "Run this rule" button.
const TRIGGERS: Array<{ value: PluginAutomationTrigger["type"]; label: string; hint: string }> = [
  { value: "property_changed", label: tr("A field changes"), hint: tr("When a field changes, e.g. Status becomes Done.") },
  { value: "relation_changed", label: tr("An item is linked"), hint: tr("When an item is linked to or unlinked from another.") },
  { value: "record_created", label: tr("An item is created"), hint: tr("When a new note or task is added directly to this project.") },
  { value: "date_reached", label: tr("A date arrives"), hint: tr("When an item's date (e.g. Due) arrives or is already past. Also catches items that are already past.") },
  { value: "recurring", label: tr("On a schedule"), hint: tr("Every day, week or month, for each matching item.") },
  { value: "manual", label: tr("Only when I press Run"), hint: tr("Nothing happens automatically — use Run now.") },
];

const ACTIONS: Array<{ value: PluginAutomationAction["type"]; label: string }> = [
  { value: "set_property", label: tr("Change a field") },
  { value: "create_record", label: tr("Create an item") },
  { value: "add_relation", label: tr("Link to another item") },
  { value: "move_record", label: tr("Move to…") },
  { value: "set_reminder", label: tr("Set reminder") },
  { value: "history_note", label: tr("Add note to history") },
  { value: "notify", label: tr("Send notification") },
];


function id(prefix: string): string { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function propsOf(object: PluginObject): Record<string, unknown> { try { const parsed = JSON.parse(object.props) as unknown; return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function label(value: string): string { return value ? value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ") : "Untitled"; }
function fieldType(value: unknown, key: string): Field["type"] { if (key === "due" || key.includes("date")) return "date"; if (key === "tags") return "tags"; if (typeof value === "number") return "number"; if (typeof value === "boolean") return "boolean"; return "text"; }
function fieldsFor(objects: PluginObject[]): Field[] {
  const fields = new Map<string, Field>([
    ["title", { id: "title", label: "Title", type: "text" }],
    ["type", { id: "type", label: "Type", type: "text" }],
    ["status", { id: "status", label: "Status", type: "text" }],
    ["priority", { id: "priority", label: "Priority", type: "text" }],
    ["due", { id: "due", label: "Due", type: "date" }],
    ["tags", { id: "tags", label: "Tags", type: "tags" }],
  ]);
  objects.forEach((object) => Object.entries(propsOf(object)).forEach(([key, value]) => { if (!fields.has(key) && !key.startsWith("_")) fields.set(key, { id: key, label: label(key), type: fieldType(value, key) }); }));
  return [...fields.values()];
}

/** Distinct values already seen for a field across the project's records —
 * turns the hand-typed "status" / "priority" box into a picker of the values
 * actually in use, matching the themed controls around it. `onFreeText` still
 * lets a rule target a brand-new value. */
function valuesFor(objects: PluginObject[], fieldId: string): string[] {
  const seen = new Set<string>();
  for (const object of objects) {
    const raw = fieldId === "title" ? object.title : fieldId === "type" ? object.type : propsOf(object)[fieldId];
    if (Array.isArray(raw)) raw.forEach((item) => { if (typeof item === "string" && item.trim()) seen.add(item); });
    else if (typeof raw === "string" && raw.trim()) seen.add(raw);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function ValueField({ fieldId, objects, value, onChange, ariaLabel }: { fieldId: string; objects: PluginObject[]; value: string; onChange: (next: string) => void; ariaLabel: string }) {
  const t = useT();
  const options = useMemo(() => valuesFor(objects, fieldId).map((candidate) => ({ value: candidate, label: candidate })), [objects, fieldId]);
  return <Combobox value={value} ariaLabel={ariaLabel} placeholder={t("Any value")} options={options} onChange={onChange} onFreeText={onChange} />;
}
function triggerFor(type: PluginAutomationTrigger["type"]): PluginAutomationTrigger {
  if (type === "property_changed") return { type, field: "status", value: "done" };
  if (type === "date_reached") return { type, field: "due" };
  if (type === "relation_changed") return { type, change: "added" };
  if (type === "recurring") return { type, frequency: "weekly", interval: 1, weekendPolicy: "skip", target: "records" };
  return { type };
}
function actionFor(type: PluginAutomationAction["type"], actionId: string): PluginAutomationAction {
  if (type === "set_property") return { id: actionId, type, field: "status", value: "done" };
  if (type === "create_record") return { id: actionId, type, objectType: "task", title: "Follow-up" };
  if (type === "add_relation") return { id: actionId, type, relation: "related", targetId: "" };
  if (type === "move_record") return { id: actionId, type, targetId: "" };
  if (type === "set_reminder") return { id: actionId, type, value: "{{today}}" };
  if (type === "notify") return { id: actionId, type, title: "Reminder", body: "" };
  return { id: actionId, type, value: "Automation completed" };
}
function newRule(): PluginAutomationRule { const ruleId = id("rule"); return { id: ruleId, version: 2, name: "New automation", enabled: true, trigger: { type: "property_changed", field: "status", value: "done" }, actions: [actionFor("set_property", id(`${ruleId}-action`))], stopOnError: true }; }
function newCondition(fields: Field[]): PluginAutomationCondition { return { kind: "condition", field: fields[0]?.id ?? "title", operator: "equals", value: "" }; }
function replaceQuery(root: PluginAutomationQuery, target: PluginAutomationQuery | PluginAutomationCondition, next: PluginAutomationQuery | PluginAutomationCondition): PluginAutomationQuery {
  if (root === target) return next as PluginAutomationQuery;
  return { ...root, children: root.children.map((child) => child === target ? next : child.kind === "group" ? replaceQuery(child, target, next) : child) };
}

function ConditionEditor({ condition, fields, objects, onChange, onRemove }: { condition: PluginAutomationCondition; fields: Field[]; objects: PluginObject[]; onChange: (next: PluginAutomationCondition) => void; onRemove: () => void }) {
  const t = useT();
  const field = fields.find((candidate) => candidate.id === condition.field) ?? fields[0];
  const operators = operatorsFor((field?.type ?? "text") as FieldKind, condition.operator);
  const operator = operators.includes(condition.operator) ? condition.operator : operators[0];
  // Switching to a field of another type keeps the operator only if it still
  // makes sense there, and drops a value that was typed for the old type.
  const changeField = (next: string) => {
    const nextKind = (fields.find((candidate) => candidate.id === next)?.type ?? "text") as FieldKind;
    const ops = operatorsFor(nextKind);
    onChange({ ...condition, field: next, operator: ops.includes(condition.operator) ? condition.operator : ops[0], value: nextKind === field?.type ? condition.value : undefined });
  };
  return <div className="automation-trigger-detail automation-condition-row">
    <Select value={field?.id ?? ""} ariaLabel={t("Condition field")} onChange={changeField} options={fields.map((candidate) => ({ value: candidate.id, label: candidate.label }))} />
    <Select value={operator} ariaLabel={t("Condition operator")} onChange={(next) => onChange({ ...condition, operator: next, value: VALUELESS_OPERATORS.has(next) ? undefined : condition.value })} options={operators.map((candidate) => ({ value: candidate, label: t(OPERATOR_LABELS[candidate] ?? label(candidate)) }))} />
    {!VALUELESS_OPERATORS.has(operator) && (operator === "has_tag" || operator === "not_has_tag"
      ? <ValueField fieldId={condition.field} objects={objects} value={condition.value ?? ""} ariaLabel={t("Condition value")} onChange={(next) => onChange({ ...condition, value: next })} />
      : field?.type === "date"
        ? <DatePicker value={condition.value ?? ""} ariaLabel={t("Condition value")} onChange={(next) => onChange({ ...condition, value: next })} />
        : <input value={condition.value ?? ""} aria-label={t("Condition value")} type={field?.type === "number" ? "number" : "text"} onChange={(event) => onChange({ ...condition, value: event.target.value })} />)}
    <button type="button" onClick={onRemove} aria-label={t("Delete condition")}>×</button>
  </div>;
}

function QueryEditor({ query, fields, objects, onChange }: { query: PluginAutomationQuery; fields: Field[]; objects: PluginObject[]; onChange: (next: PluginAutomationQuery) => void }) {
  const t = useT();
  return <section className="automation-query-editor">
    <div className="automation-section-head"><strong>{t("Only if")}</strong><Select value={query.combinator} ariaLabel={t("Condition combinator")} onChange={(next) => onChange({ ...query, combinator: next as "and" | "or" })} options={[{ value: "and", label: t("All of these") }, { value: "or", label: t("Any of these") }]} /></div>
    {query.children.length === 0 && <p className="automation-scope-hint">{t("No filter — applies to every item.")}</p>}
    {query.children.map((child, index) => child.kind === "condition"
      ? <ConditionEditor key={`${child.field}-${index}`} condition={child} fields={fields} objects={objects} onChange={(next) => onChange({ ...query, children: query.children.map((candidate, candidateIndex) => candidateIndex === index ? next : candidate) })} onRemove={() => onChange({ ...query, children: query.children.filter((_, candidateIndex) => candidateIndex !== index) })} />
      : <QueryEditor key={`group-${index}`} query={child} fields={fields} objects={objects} onChange={(next) => onChange(replaceQuery(query, child, next))} />)}
    <div className="automation-section-head"><button type="button" onClick={() => onChange({ ...query, children: [...query.children, newCondition(fields)] })}>+ Condition</button><button type="button" onClick={() => onChange({ ...query, children: [...query.children, { kind: "group", combinator: "and", children: [] }] })}>+ Group</button></div>
  </section>;
}

function ActionEditor({ action, fields, types, objects, onChange, onRemove }: { action: PluginAutomationAction; fields: Field[]; types: PluginType[]; objects: PluginObject[]; onChange: (next: PluginAutomationAction) => void; onRemove: () => void }) {
  const t = useT();
  const patch = (value: Partial<PluginAutomationAction>) => onChange({ ...action, ...value } as PluginAutomationAction);
  return <><div className="automation-action-row"><Select value={action.type} ariaLabel={t("Action type")} onChange={(next) => onChange(actionFor(next as PluginAutomationAction["type"], action.id))} options={ACTIONS.map((candidate) => ({ value: candidate.value, label: t(candidate.label) }))} />{action.type === "set_property" && <><Select value={action.field} ariaLabel={t("Action property")} onChange={(next) => patch({ field: next })} options={fields.map((f) => ({ value: f.id, label: f.label }))} /><ValueField fieldId={action.field} objects={objects} value={action.value} ariaLabel={t("Action value")} onChange={(next) => patch({ value: next })} /></>}{action.type === "create_record" && <><Select value={action.objectType} ariaLabel={t("Created record type")} onChange={(next) => patch({ objectType: next })} options={types.filter((type) => !["space", "dashboard"].includes(type.name)).map((type) => ({ value: type.name, label: label(type.name) }))} /><input value={action.title} aria-label={t("Created record title")} onChange={(event) => patch({ title: event.target.value })} /></>}{action.type === "add_relation" && <><input value={action.relation} aria-label={t("Relation kind")} onChange={(event) => patch({ relation: event.target.value })} /><Select value={action.targetId} ariaLabel={t("Relation target")} placeholder={t("Choose record")} onChange={(next) => patch({ targetId: next })} options={objects.map((object) => ({ value: object.id, label: object.title || t("Untitled") }))} /></>}{action.type === "move_record" && <Select value={action.targetId} ariaLabel={t("Move target")} placeholder={t("Choose container")} onChange={(next) => patch({ targetId: next })} options={objects.filter((object) => ["folder", "project"].includes(object.type)).map((object) => ({ value: object.id, label: object.title || t("Untitled") }))} />}{(action.type === "set_reminder" || action.type === "history_note") && <input value={action.value} aria-label={t("Action text")} onChange={(event) => patch({ value: event.target.value })} />}{action.type === "notify" && <><input value={action.title} placeholder={t("Notification title")} aria-label={t("Notification title")} onChange={(event) => patch({ title: event.target.value })} /><input value={action.body ?? ""} placeholder={t("Notification body (optional)")} aria-label={t("Notification body")} onChange={(event) => patch({ body: event.target.value })} /></>}<button type="button" onClick={onRemove} aria-label={t("Delete action")}>×</button></div>{action.type === "set_property" && isUnusedValue(action.value, valuesFor(objects, action.field)) && <small className="automation-warning">{t("No item here uses {field} “{value}” — pick an existing value or continue.", { field: fields.find((f) => f.id === action.field)?.label ?? action.field, value: action.value })}</small>}</>;
}

function AutomationsPluginViewInner({ context: rawContext, host, initialContainerId }: Props) {
  const t = useT();
  const context = rawContext as PluginContext;
  const [containerId, setContainerId] = useState(initialContainerId ?? "");
  const [container, setContainer] = useState<PluginObject | null>(null);
  const [objects, setObjects] = useState<PluginObject[]>([]);
  const [types, setTypes] = useState<PluginType[]>([]);
  const [rules, setRules] = useState<PluginAutomationRule[]>([]);
  const [logs, setLogs] = useState<PluginAutomationLog[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<"rules" | "log">("rules");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<string[]>([]);
  const [runningDue, setRunningDue] = useState(false);
  const [pickableContainers, setPickableContainers] = useState<PluginObject[]>([]);
  const fields = useMemo(() => fieldsFor(objects), [objects]);
  // No `?? rules[0]` fallback: with one, the first rule could never be
  // collapsed — toggling activeId to null just fell back to it again.
  const active = rules.find((rule) => rule.id === activeId) ?? null;
  const allCollapsed = active === null;

  // Automations are per-project rules, not a global setting. Opened from
  // Settings (no initialContainerId), there's nothing to configure until a
  // project is picked — so offer the real project list instead of a raw id box.
  useEffect(() => {
    if (initialContainerId) return;
    void Promise.all([context.data.objects.query({ type: "project", limit: 200 }), context.data.objects.query({ type: "folder", limit: 200 })])
      .then(([projects, folders]) => setPickableContainers([...projects, ...folders]))
      .catch(() => setPickableContainers([]));
  }, [context, initialContainerId]);

  async function load(requestedId = containerId) {
    const idValue = requestedId.trim();
    if (!idValue) { setError("Container id is required"); return; }
    setBusy(true); setError("");
    try {
      const [current, nextTypes, children] = await Promise.all([context.data.objects.get(idValue), context.data.types.list(), context.data.objects.query({ parentId: idValue, limit: 5000 })]);
      if (!current) throw new Error("Container not found");
      const props = propsOf(current);
      const nextRules = parsePluginAutomationRules(props._automations);
      setContainer(current); setContainerId(idValue); setTypes(nextTypes); setObjects(children); setRules(nextRules); setLogs(Array.isArray(props._automationLog) ? props._automationLog as PluginAutomationLog[] : []); setActiveId((open) => nextRules.some((rule) => rule.id === open) ? open : null);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); setContainer(null); setObjects([]); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (initialContainerId) { setContainerId(initialContainerId); void load(initialContainerId); } }, [initialContainerId]);

  async function save(nextRules: PluginAutomationRule[], nextLogs = logs) {
    if (!container) return;
    const current = await context.data.objects.get(container.id) ?? container;
    const updated = await context.data.objects.update(current.id, { props: JSON.stringify({ ...propsOf(current), _automations: nextRules, _automationLog: nextLogs }) }, current.updated_at);
    setContainer(updated); setRules(nextRules); setLogs(nextLogs); host?.notifyChanged();
  }
  /** "Run due rules": every date_reached rule against every item, as one pass. */
  async function runDue() {
    setRunningDue(true);
    try {
      const known = new Set(logs.map((entry) => entry.executionKey));
      const meta = { source: "panel" as const, runId: id("run") };
      const entries: PluginAutomationLog[] = [];
      for (const object of objects) {
        for (const rule of rules) {
          if (!pluginAutomationMatches(rule, object, "date_reached")) continue;
          const result = await executeAutomationRule(context, rule, object, "date_reached", container?.id ?? null, known, undefined, meta);
          entries.push(result);
          known.add(result.executionKey);
        }
      }
      if (entries.length) await save(rules, [...entries, ...logs].slice(0, 200));
      await load(container?.id);
    } finally { setRunningDue(false); }
  }

  return <article className="plugin-domain-view automation-plugin-surface" data-plugin-view="notible.automations">{!initialContainerId && <><h2 className="settings-h2">{t("Automations")}</h2><p className="settings-intro">{t("Rules, conditions, actions and execution log use only the public DataApi. The legacy panel remains available through the host fallback.")}</p></>}{!initialContainerId && <div className="plugin-view-load-row"><Select value={containerId} ariaLabel={t("Project")} placeholder={t("Choose a project or folder…")} onChange={(next) => setContainerId(next)} options={pickableContainers.map((candidate) => ({ value: candidate.id, label: candidate.title || t("Untitled") }))} /><button type="button" className="btn-primary" onClick={() => void load()} disabled={busy || !containerId}>{t("Open automations")}</button></div>}{error && <div role="alert" className="plugin-view-error">{error}</div>}{container && <><div className="plugin-view-tabs"><button type="button" className={tab === "rules" ? "active" : ""} onClick={() => setTab("rules")}>Rules · {rules.length}</button><button type="button" className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}>Execution log · {logs.length}</button></div>{tab === "rules" ? <><div className="automation-run-row"><button type="button" onClick={() => void runDue()} disabled={runningDue} aria-busy={runningDue}>{runningDue && <span className="automation-spinner" aria-hidden="true" />}{runningDue ? t("Running…") : t("Run due rules")}</button>{!allCollapsed && <button type="button" className="automation-collapse-all" onClick={() => setActiveId(null)}>{t("Collapse all")}</button>}<small>{t("Changes are persisted in the container record.")}</small></div><div className="automation-rules">{rules.length === 0 && <div className="automation-empty"><strong>{t("No automation rules")}</strong><span>{t("Add a rule to remove repetitive manual steps.")}</span></div>}{rules.map((rule) => <section key={rule.id} className={`automation-rule${active?.id === rule.id ? " expanded" : ""}${rule.enabled ? " is-active" : " is-inactive"}`}><div className="automation-rule-head"><button type="button" className={`automation-expand${active?.id === rule.id ? " is-open" : ""}`} onClick={() => setActiveId(active?.id === rule.id ? null : rule.id)} aria-label={t("Expand rule")} aria-expanded={active?.id === rule.id}><Chevron /></button><input value={rule.name} onChange={(event) => void save(rules.map((candidate) => candidate.id === rule.id ? { ...candidate, name: event.target.value } : candidate))} /><span className="automation-running" aria-live="polite">{running.includes(rule.id) && <span className="automation-spinner" role="status" aria-label={t("Running…")} />}</span><label className="automation-status"><input type="checkbox" checked={rule.enabled} onChange={(event) => void save(rules.map((candidate) => candidate.id === rule.id ? { ...candidate, enabled: event.target.checked } : candidate))} />{rule.enabled ? t("Active") : t("Inactive")}</label><button type="button" onClick={() => { const next = rules.filter((candidate) => candidate.id !== rule.id); setActiveId(next[0]?.id ?? null); void save(next); }} aria-label={t("Delete rule")}>×</button></div><p className="automation-summary">{describeRule(rule, { t, fieldLabel: (fid) => fields.find((f) => f.id === fid)?.label ?? label(fid) })}</p><p className="automation-state">{(() => { const last = lastRunOf(rule.id, logs); return last ? t("Last run: {when} — changed {n} items", { when: new Date(last.at).toLocaleString(appLocale()), n: last.ok }) : rule.trigger.type === "manual" ? t("Not run yet") : t("Not run yet — checked every 15 minutes while Notible is open."); })()}</p>{active?.id === rule.id && <div className="automation-rule-body core-view-in"><label className="automation-field"><span>{t("When")}</span><Select value={rule.trigger.type} ariaLabel={t("Trigger")} onChange={(next) => void save(rules.map((candidate) => candidate.id === rule.id ? { ...candidate, trigger: triggerFor(next as PluginAutomationTrigger["type"]) } : candidate))} options={TRIGGERS.map((candidate) => ({ value: candidate.value, label: t(candidate.label) }))} /></label><p className="automation-scope-hint">{t(TRIGGERS.find((candidate) => candidate.value === rule.trigger.type)?.hint ?? "")}</p>{(rule.trigger.type === "record_created" || rule.trigger.type === "property_changed" || rule.trigger.type === "relation_changed") && <p className="automation-scope-hint">{t("Only for notes and tasks directly inside this project or folder — not ones nested in a subfolder.")}</p>}{(rule.trigger.type === "property_changed" || rule.trigger.type === "date_reached") && <div className="automation-trigger-detail"><Select value={rule.trigger.field} ariaLabel={t("Trigger field")} onChange={(next) => void save(rules.map((candidate) => candidate.id === rule.id ? { ...candidate, trigger: { ...rule.trigger, field: next } as PluginAutomationTrigger } : candidate))} options={fields.map((f) => ({ value: f.id, label: f.label }))} />{rule.trigger.type === "property_changed" && <ValueField fieldId={rule.trigger.field} objects={objects} value={rule.trigger.value ?? ""} ariaLabel={t("Trigger value")} onChange={(next) => void save(rules.map((candidate) => candidate.id === rule.id ? { ...candidate, trigger: { ...rule.trigger, value: next } as PluginAutomationTrigger } : candidate))} />}</div>}{rule.trigger.type === "recurring" && <div className="automation-trigger-detail"><Select value={rule.trigger.frequency ?? "weekly"} ariaLabel={t("Recurring frequency")} onChange={(next) => void save(rules.map((candidate) => candidate.id === rule.id ? { ...candidate, trigger: { ...rule.trigger, frequency: next as "daily" | "weekly" | "monthly" } } : candidate))} options={[{ value: "daily", label: t("Daily") }, { value: "weekly", label: t("Weekly") }, { value: "monthly", label: t("Monthly") }]} /><input type="number" min="1" value={rule.trigger.interval ?? 1} aria-label={t("Recurring interval")} onChange={(event) => void save(rules.map((candidate) => candidate.id === rule.id ? { ...candidate, trigger: { ...rule.trigger, interval: Math.max(1, Number(event.target.value) || 1) } } : candidate))} /><Select value={rule.trigger.target ?? "project"} ariaLabel={t("Recurring target")} onChange={(next) => void save(rules.map((candidate) => candidate.id === rule.id ? { ...candidate, trigger: { ...rule.trigger, target: next as "records" | "project" } } : candidate))} options={[{ value: "records", label: t("Each matching item") }, { value: "project", label: t("The project itself") }]} /></div>}<QueryEditor query={rule.conditions ?? { kind: "group", combinator: "and", children: [] }} fields={fields} objects={objects} onChange={(conditions) => void save(rules.map((candidate) => candidate.id === rule.id ? { ...candidate, conditions } : candidate))} /><div className="automation-section-head"><strong>{t("Then")}</strong><label className="automation-toggle" title={t("If one action fails, stop before running the rest. Turn off to let a rule keep going past a failing action.")}><input type="checkbox" checked={rule.stopOnError} onChange={(event) => void save(rules.map((candidate) => candidate.id === rule.id ? { ...candidate, stopOnError: event.target.checked } : candidate))} />{t("Stop on first error")}</label><button type="button" onClick={() => void save(rules.map((candidate) => candidate.id === rule.id ? { ...candidate, actions: [...candidate.actions, actionFor("set_property", id(`${rule.id}-action`))] } : candidate))}>+ Action</button></div><div className="automation-actions">{rule.actions.map((action) => <ActionEditor key={action.id} action={action} fields={fields} types={types} objects={objects} onChange={(next) => void save(rules.map((candidate) => candidate.id === rule.id ? { ...candidate, actions: candidate.actions.map((item) => item.id === action.id ? next : item) } : candidate))} onRemove={() => void save(rules.map((candidate) => candidate.id === rule.id ? { ...candidate, actions: candidate.actions.filter((item) => item.id !== action.id) } : candidate))} />)}</div><RunPanel context={context} containerId={container.id} rule={rule} objects={objects} onDone={() => void load(container.id)} onRunning={(on) => setRunning((list) => on ? [...list, rule.id] : list.filter((ruleId) => ruleId !== rule.id))} /></div>}</section>)}</div><button type="button" className="automation-add" onClick={() => { const next = [...rules, newRule()]; setActiveId(next[next.length - 1].id); void save(next); }}>{t("+ Add rule")}</button></> : <LogPanel logs={logs} onClear={() => void save(rules, [])} />}</>}</article>;
}

/** Translation for every component below, from the plugin's own context. The
 * provider has to sit outside the component that consumes it, so the surface
 * proper is `AutomationsPluginViewInner`. */
export default function AutomationsPluginView(props: Props) {
  return <PluginI18nProvider context={props.context as PluginContext}><AutomationsPluginViewInner {...props} /></PluginI18nProvider>;
}
