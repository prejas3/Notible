import type { PluginContext, PluginObject } from "../../packages/plugin-api/src/index.ts";
import { createBuiltinSurface } from "./scaffold.ts";

export type PluginAutomationTrigger =
  | { type: "record_created" }
  | { type: "property_changed"; field: string; value?: string }
  | { type: "relation_changed"; relation?: string; change?: "added" | "removed"; targetId?: string }
  | { type: "date_reached"; field: string; weekendPolicy?: "include" | "skip" }
  | { type: "recurring"; frequency?: "daily" | "weekly" | "monthly"; interval?: number; startDate?: string; dayOfMonth?: number; weekendPolicy?: "include" | "skip"; target?: "records" | "project" }
  | { type: "manual" };

export type PluginAutomationAction =
  | { id: string; type: "set_property"; field: string; value: string }
  | { id: string; type: "create_record"; objectType: string; title: string; props?: Record<string, string> }
  | { id: string; type: "add_relation"; relation: string; targetId: string }
  | { id: string; type: "move_record"; targetId: string }
  | { id: string; type: "set_reminder"; value: string }
  | { id: string; type: "history_note"; value: string }
  | { id: string; type: "notify"; title: string; body?: string };

export interface PluginAutomationCondition { kind: "condition"; field: string; operator: string; value?: string; }
export interface PluginAutomationQuery { kind: "group"; combinator: "and" | "or"; children: Array<PluginAutomationCondition | PluginAutomationQuery>; }
export interface PluginAutomationRule {
  id: string;
  version: 2;
  name: string;
  enabled: boolean;
  trigger: PluginAutomationTrigger;
  conditions?: PluginAutomationQuery;
  actions: PluginAutomationAction[];
  stopOnError: boolean;
  /** Epoch ms of this rule's last recurring fire. Only `recurring` rules use
   * it — `executionKey` dedup already covers every other trigger, but a
   * schedule needs to know when its *next* occurrence is, not just whether
   * today's has already happened. */
  lastRunAt?: number;
}
/**
 * Legacy alias. The generic "Manage automations" command used to keep its own
 * loosely-typed rule shape (untyped `trigger`/`conditions`) that was separate
 * from the rule shape the real Automations UI (automations-ui.tsx) reads and
 * writes to the same `props._automations` key. That let the command silently
 * write rules the UI's `pluginAutomationMatches` would never fire (unknown
 * trigger.type never equals any real event), making automations look broken.
 * Both entry points now share exactly one rule shape.
 */
export type AutomationRule = PluginAutomationRule;

export interface PluginAutomationError { name: string; message: string; stack?: string; }
/** What one action of a run did. `save` is the final write of the record's own
 * properties, which can fail on its own (e.g. a concurrent edit). */
export interface PluginAutomationStep {
  n: number;
  type: PluginAutomationAction["type"] | "save";
  status: "ok" | "error" | "skipped";
  ms: number;
  /** Human-readable what/where, e.g. `status: pending → closed`. */
  detail?: string;
  error?: PluginAutomationError;
}
/** Where a run came from: a Core event, the 15-minute background check, the
 * panel's "Run now", or the panel's "Run due rules". */
export type PluginAutomationSource = "event" | "schedule" | "run-now" | "panel";
export interface AutomationRunMeta { source: PluginAutomationSource; /** Groups the entries of one pass. */ runId?: string; }

export interface PluginAutomationLog {
  id: string;
  ruleId: string;
  ruleName: string;
  objectId: string;
  objectTitle: string;
  event: PluginAutomationTrigger["type"];
  status: "planned" | "success" | "skipped" | "error";
  message: string;
  occurredAt: number;
  executionKey: string;
  // Everything below is optional: entries written before 0.83.10 do not have it.
  source?: PluginAutomationSource;
  runId?: string;
  objectType?: string;
  containerId?: string;
  startedAt?: number;
  durationMs?: number;
  steps?: PluginAutomationStep[];
  /** The first error of the run, for quick reading and "Copy details". */
  error?: PluginAutomationError;
  /** The rule as it was when it failed — the rule may have been edited since. */
  ruleSnapshot?: { trigger: PluginAutomationTrigger; conditions?: PluginAutomationQuery; actions: PluginAutomationAction[] };
}

function localISODate(d = new Date()): string {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function readProps(value: string): Record<string, unknown> {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

/** Rule shapes written via the generic command must be readable by the real
 * Automations UI, so this delegates to the exact same validator/shape it uses. */
export function validateAutomationRules(value: unknown): AutomationRule[] {
  return parsePluginAutomationRules(value);
}

function pluginProps(object: PluginObject): Record<string, unknown> {
  return readProps(object.props);
}

function pluginValue(object: PluginObject, field: string): unknown {
  if (field === "title") return object.title;
  if (field === "type") return object.type;
  if (field === "created_at") return new Date(object.created_at).toISOString().slice(0, 10);
  if (field === "updated_at") return new Date(object.updated_at).toISOString().slice(0, 10);
  return pluginProps(object)[field];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
/** -1/0/1 comparing two values as ISO dates (whole-day) or as numbers; null
 * when they are not comparable — so a missing value never satisfies < or >. */
function compareValues(actual: string, expected: string): number | null {
  if (ISO_DATE.test(actual) && ISO_DATE.test(expected)) { const a = actual.slice(0, 10), b = expected.slice(0, 10); return a < b ? -1 : a > b ? 1 : 0; }
  const a = Number(actual), b = Number(expected);
  return actual.trim() !== "" && expected.trim() !== "" && Number.isFinite(a) && Number.isFinite(b) ? Math.sign(a - b) : null;
}
function tagsOf(value: unknown): string[] {
  return (Array.isArray(value) ? value.map(String) : String(value ?? "").split(",")).map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean);
}

function queryConditionMatches(object: PluginObject, condition: PluginAutomationCondition): boolean {
  const actual = Array.isArray(pluginValue(object, condition.field))
    ? (pluginValue(object, condition.field) as unknown[]).map(String).join(", ")
    : String(pluginValue(object, condition.field) ?? "");
  const left = actual.toLocaleLowerCase();
  const right = String(condition.value ?? "").toLocaleLowerCase();
  switch (condition.operator) {
    case "equals": return left === right;
    case "not_equals": return left !== right;
    case "contains": return left.includes(right);
    case "not_contains": return !left.includes(right);
    case "empty": return left.length === 0;
    case "not_empty": return left.length > 0;
    case "overdue": return left.length > 0 && left.slice(0, 10) < localISODate();
    case "today": return left.slice(0, 10) === localISODate();
    case "gt": case "after": { const c = compareValues(actual, String(condition.value ?? "")); return c !== null && c > 0; }
    case "gte": { const c = compareValues(actual, String(condition.value ?? "")); return c !== null && c >= 0; }
    case "lt": case "before": { const c = compareValues(actual, String(condition.value ?? "")); return c !== null && c < 0; }
    case "lte": { const c = compareValues(actual, String(condition.value ?? "")); return c !== null && c <= 0; }
    case "has_tag": return tagsOf(pluginValue(object, condition.field)).includes(right.trim());
    case "not_has_tag": return !tagsOf(pluginValue(object, condition.field)).includes(right.trim());
    default: return true;
  }
}

function pluginQueryMatches(object: PluginObject, query?: PluginAutomationQuery): boolean {
  if (!query || query.children.length === 0) return true;
  const results = query.children.map((child) => child.kind === "condition" ? queryConditionMatches(object, child) : pluginQueryMatches(object, child));
  return query.combinator === "or" ? results.some(Boolean) : results.every(Boolean);
}

function pluginDate(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

/** `iso` parsed as a *local* midnight, matching localISODate's own
 * convention — parsing with a trailing "Z" instead would read the date back
 * one day early or late for anyone not on UTC. */
function parseLocalDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}
function isWeekend(iso: string): boolean {
  const day = parseLocalDate(iso).getDay();
  return day === 0 || day === 6;
}
/** The next weekday on or after `iso`, for a `weekendPolicy: "skip"` trigger. */
function shiftPastWeekend(iso: string): string {
  const date = parseLocalDate(iso);
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
  return localISODate(date);
}

/** The next date on or after `lastRunISODate` this recurring trigger is due,
 * per its frequency/interval/dayOfMonth/weekendPolicy. Landing on the 1st
 * before advancing months (rather than advancing straight from, say, the
 * 31st) is what keeps a January 31st rule from skipping March entirely —
 * `setMonth` on the 31st would otherwise roll a short February over into it. */
function nextRecurringDueDate(trigger: Extract<PluginAutomationTrigger, { type: "recurring" }>, lastRunISODate: string): string {
  const interval = Math.max(1, trigger.interval ?? 1);
  const date = parseLocalDate(lastRunISODate);
  if (trigger.frequency === "monthly") {
    const day = trigger.dayOfMonth ?? date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + interval);
    const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, lastDayOfMonth));
  } else if (trigger.frequency === "weekly") {
    date.setDate(date.getDate() + 7 * interval);
  } else {
    date.setDate(date.getDate() + interval);
  }
  const next = localISODate(date);
  return trigger.weekendPolicy === "skip" && isWeekend(next) ? shiftPastWeekend(next) : next;
}

/** Is a `recurring` rule due to fire? `lastRunAt` undefined means it has
 * never fired: due immediately once `startDate` (if any) has arrived, rather
 * than waiting a full period from "now" — the rule was just configured, not
 * running since the epoch. Already having fired today is checked here too,
 * ahead of (and independent from) the executionKey dedup the caller also
 * applies — this is what stops a mis-set `interval` of 0 from being treated
 * as "fire every check". */
export function isRecurringDue(trigger: Extract<PluginAutomationTrigger, { type: "recurring" }>, lastRunAt: number | undefined, now = new Date()): boolean {
  const today = localISODate(now);
  if (trigger.startDate && trigger.startDate > today) return false;
  if (!lastRunAt) return true;
  const lastRunISODate = localISODate(new Date(lastRunAt));
  if (lastRunISODate === today) return false;
  return nextRecurringDueDate(trigger, lastRunISODate) <= today;
}

const KNOWN_TRIGGER_TYPES = new Set<PluginAutomationTrigger["type"]>([
  "record_created", "property_changed", "relation_changed", "date_reached", "recurring", "manual",
]);

function isKnownTrigger(value: unknown): value is PluginAutomationTrigger {
  return !!value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string"
    && KNOWN_TRIGGER_TYPES.has((value as { type: PluginAutomationTrigger["type"] }).type);
}

export function parsePluginAutomationRules(value: unknown): PluginAutomationRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): PluginAutomationRule[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const rule = candidate as Partial<PluginAutomationRule>;
    // A rule whose trigger doesn't match a known type would silently never
    // fire (pluginAutomationMatches compares trigger.type against real
    // events), which looks identical to "the automation does nothing" from
    // the user's perspective. Reject it at parse time instead.
    if (rule.version !== 2 || typeof rule.id !== "string" || !rule.id.trim() || typeof rule.name !== "string" || !isKnownTrigger(rule.trigger) || !Array.isArray(rule.actions)) return [];
    return [{
      id: rule.id,
      version: 2,
      name: rule.name || "Automation",
      enabled: rule.enabled !== false,
      trigger: rule.trigger as PluginAutomationTrigger,
      conditions: rule.conditions as PluginAutomationQuery | undefined,
      actions: rule.actions.filter((action): action is PluginAutomationAction => !!action && typeof action === "object" && typeof (action as PluginAutomationAction).id === "string"),
      stopOnError: rule.stopOnError !== false,
      ...(typeof rule.lastRunAt === "number" ? { lastRunAt: rule.lastRunAt } : {}),
    }];
  });
}

/** Detail carried by a `relation.created`/`relation.deleted` event, needed to
 * both match a `relation_changed` rule's own filters (which the rule editor
 * has always exposed, but nothing evaluated until relation events existed to
 * evaluate them against) and to keep its execution key from colliding with a
 * different relation change on the same object at the same `updated_at`. */
export interface AutomationRelationEvent { relation: string; change: "added" | "removed"; targetId: string; }

export function pluginAutomationMatches(rule: PluginAutomationRule, object: PluginObject, event: PluginAutomationTrigger["type"], changedValues?: Record<string, string>, now = new Date(), relationEvent?: AutomationRelationEvent): boolean {
  if (!rule.enabled || rule.trigger.type !== event) return false;
  if (rule.trigger.type === "property_changed" && (!(rule.trigger.field in (changedValues ?? {})) || (rule.trigger.value && changedValues?.[rule.trigger.field] !== rule.trigger.value))) return false;
  if (rule.trigger.type === "date_reached") {
    const raw = pluginDate(pluginValue(object, rule.trigger.field));
    if (raw === "") return false;
    // "skip" doesn't move the field's own date — it holds the automation
    // back until the next weekday, the same way a recurring rule's own
    // occurrence shifts off a weekend.
    const effective = rule.trigger.weekendPolicy === "skip" && isWeekend(raw) ? shiftPastWeekend(raw) : raw;
    if (effective > localISODate(now)) return false;
  }
  if (rule.trigger.type === "recurring" && rule.trigger.startDate && rule.trigger.startDate > localISODate(now)) return false;
  if (rule.trigger.type === "relation_changed" && relationEvent) {
    if (rule.trigger.change && rule.trigger.change !== relationEvent.change) return false;
    if (rule.trigger.relation && rule.trigger.relation !== relationEvent.relation) return false;
    if (rule.trigger.targetId && rule.trigger.targetId !== relationEvent.targetId) return false;
  }
  return pluginQueryMatches(object, rule.conditions);
}

/** Which of `records` a rule would act on right now, without writing anything.
 * The trigger *event* is ignored (there is none for a manual preview), but the
 * parts of a trigger that describe a state still apply: a date_reached rule
 * needs its date to have arrived, a property_changed rule with a value needs
 * the field to currently hold that value. */
export function previewRuleMatches(rule: PluginAutomationRule, records: PluginObject[], now = new Date()): PluginObject[] {
  return records.filter((record) => {
    if (rule.trigger.type === "date_reached") return pluginAutomationMatches({ ...rule, enabled: true }, record, "date_reached", undefined, now);
    if (rule.trigger.type === "property_changed" && rule.trigger.value && String(pluginValue(record, rule.trigger.field) ?? "").toLocaleLowerCase() !== rule.trigger.value.toLocaleLowerCase()) return false;
    return pluginQueryMatches(record, rule.conditions);
  });
}

export function pluginAutomationExecutionKey(rule: PluginAutomationRule, object: PluginObject, event: PluginAutomationTrigger["type"], now = new Date(), relationEvent?: AutomationRelationEvent): string {
  // recurring fires on the same container every period, so its key is dated.
  // date_reached is "when this record's date arrives, once" — the date stays
  // <= today forever after, so a dated key would re-fire it every day. Key it
  // per rule+record so it runs a single time.
  if (event === "recurring") return `${rule.id}:${object.id}:${event}:${localISODate(now)}`;
  if (event === "date_reached") return `${rule.id}:${object.id}:${event}`;
  // A relation add/remove never touches the object's own row, so two
  // different relation changes between property updates would otherwise
  // share one `updated_at` and the second would be wrongly deduped as a
  // repeat of the first.
  if (event === "relation_changed" && relationEvent) return `${rule.id}:${object.id}:${event}:${relationEvent.change}:${relationEvent.relation}:${relationEvent.targetId}`;
  return `${rule.id}:${object.id}:${event}:${object.updated_at}`;
}

export function createPluginAutomationLog(rule: PluginAutomationRule, object: PluginObject, event: PluginAutomationTrigger["type"], status: PluginAutomationLog["status"], message: string, now = new Date(), relationEvent?: AutomationRelationEvent): PluginAutomationLog {
  return { id: queryId("automation-log"), ruleId: rule.id, ruleName: rule.name, objectId: object.id, objectTitle: object.title, event, status, message, occurredAt: now.getTime(), executionKey: pluginAutomationExecutionKey(rule, object, event, now, relationEvent) };
}

/** Runs one matched rule's actions against `object` and reports what
 * happened, without touching any React state — the one execution path both
 * the Automations panel (manual/date-reached runs) and the background
 * listener (record_created/property_changed/relation_changed) go through, so
 * "what an automation does" cannot drift between the two. */
const ALREADY_EXECUTED = "Already executed for this record and event.";
const STACK_LIMIT = 400;
const NOT_RUN = "not run — an earlier step failed";
function describeError(value: unknown): PluginAutomationError {
  return value instanceof Error
    ? { name: value.name, message: value.message, ...(value.stack ? { stack: value.stack.slice(0, STACK_LIMIT) } : {}) }
    : { name: typeof value, message: String(value) };
}

export async function executeAutomationRule(context: PluginContext, rule: PluginAutomationRule, object: PluginObject, event: PluginAutomationTrigger["type"], containerId: string | null, knownExecutionKeys: Set<string>, relationEvent?: AutomationRelationEvent, meta?: AutomationRunMeta): Promise<PluginAutomationLog> {
  const startedAt = Date.now();
  const preview = createPluginAutomationLog(rule, object, event, "success", `${rule.actions.length} actions completed.`, new Date(), relationEvent);
  const common = { source: meta?.source, runId: meta?.runId, containerId: containerId ?? undefined, startedAt };
  if (knownExecutionKeys.has(preview.executionKey)) {
    return { ...preview, ...common, objectType: object.type, durationMs: 0, steps: [], status: "skipped", message: ALREADY_EXECUTED };
  }
  let current = await context.data.objects.get(object.id) ?? object;
  let props = readProps(current.props);
  const steps: PluginAutomationStep[] = [];
  const failures: string[] = [];
  const actions = rule.actions.slice(0, 20);
  const today = localISODate();
  const shown = (field: string) => { const v = props[field]; return v === undefined || v === "" ? "(empty)" : Array.isArray(v) ? v.join(", ") : String(v); };
  // Each action runs in its own try/catch — previously the whole loop shared
  // one try, so one failing action silently discarded every `set_property`
  // change already accumulated in `props` (never written, since the single
  // write happened only after the loop) while leaving already-executed
  // `create_record`/`add_relation`/`move_record` side effects in place
  // uncorrected. Now: whatever ran, ran, and is persisted below regardless of
  // where a later action fails. `stopOnError` decides only whether the *rest*
  // of the actions still get a chance to run.
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    const t0 = Date.now();
    const step: PluginAutomationStep = { n: index + 1, type: action.type, status: "ok", ms: 0 };
    try {
      if (action.type === "set_property") { const next = action.value.replaceAll("{{today}}", today); step.detail = `${action.field}: ${shown(action.field)} → ${next}`; props[action.field] = next; }
      else if (action.type === "set_reminder") { const next = action.value.replaceAll("{{today}}", today); step.detail = `reminder: ${shown("reminder")} → ${next}`; props.reminder = next; }
      else if (action.type === "history_note") { step.detail = `note: ${action.value.slice(0, 80)}`; props._automationNotes = [...(Array.isArray(props._automationNotes) ? props._automationNotes : []), { at: Date.now(), rule: rule.name, text: action.value }].slice(-50); }
      // The one action that reaches the user outside the app window — a
      // reminder due while Notible is minimized or unfocused was previously
      // invisible until someone opened it back up. Fire-and-forget, same as
      // context.notifications.show itself: nothing here awaits the user
      // having seen it.
      else if (action.type === "notify") {
        const title = action.title.replaceAll("{{today}}", today);
        const body = action.body?.replaceAll("{{today}}", today);
        step.detail = `notification: ${title}`;
        await context.notifications.show({ title, body });
        // The OS toast is fire-and-forget and gone the moment it is
        // dismissed or missed. A plain object record is the in-app trail
        // notible.notifications reads — it costs nothing if that plugin is
        // not installed, and does not require it to be for this action to
        // fire the toast.
        await context.data.objects.create({ type: "notification", title, props: JSON.stringify({ body: body ?? "", read: false, at: Date.now() }) }).catch(() => {});
      }
      else if (action.type === "create_record") { const created = await context.data.objects.create({ type: action.objectType, title: action.title, props: JSON.stringify(action.props ?? {}), parentId: containerId ?? undefined }); step.detail = `created ${action.objectType} "${action.title}" (${created.id})`; }
      else if (action.type === "add_relation") {
        if (!action.targetId) { step.status = "skipped"; step.detail = "no target record chosen"; }
        else { await context.data.relations.create(current.id, action.targetId, action.relation); step.detail = `${action.relation} → ${action.targetId}`; }
      }
      else if (action.type === "move_record") {
        if (!action.targetId) { step.status = "skipped"; step.detail = "no target container chosen"; }
        else { current = await context.data.objects.move(current.id, action.targetId); step.detail = `moved to ${action.targetId}`; }
      }
    } catch (value) {
      step.status = "error";
      step.error = describeError(value);
      failures.push(`${action.type}: ${step.error.message}`);
    }
    step.ms = Date.now() - t0;
    steps.push(step);
    if (step.status === "error" && rule.stopOnError) {
      for (let rest = index + 1; rest < actions.length; rest += 1) steps.push({ n: rest + 1, type: actions[rest].type, status: "skipped", ms: 0, detail: NOT_RUN });
      break;
    }
  }
  const ran = steps.filter((step) => step.status === "ok").length;
  const stoppedEarly = steps.some((step) => step.detail === NOT_RUN);
  const saveStart = Date.now();
  try {
    if (JSON.stringify(props) !== current.props) current = await context.data.objects.update(current.id, { props: JSON.stringify(props) }, current.updated_at);
  } catch (value) {
    const error = describeError(value);
    failures.push(`saving changes: ${error.message}`);
    steps.push({ n: steps.length + 1, type: "save", status: "error", ms: Date.now() - saveStart, detail: "writing the record's properties", error });
  }
  const extra = { ...common, objectType: current.type, durationMs: Date.now() - startedAt, steps };
  if (failures.length === 0) {
    return { ...createPluginAutomationLog(rule, current, event, "success", `${ran} actions completed.`, new Date(), relationEvent), executionKey: preview.executionKey, ...extra };
  }
  const message = `${ran} of ${rule.actions.length} actions completed${stoppedEarly ? " (stopped on first error)" : ""}: ${failures.join("; ")}`;
  return {
    ...createPluginAutomationLog(rule, current, event, "error", message, new Date(), relationEvent), executionKey: preview.executionKey, ...extra,
    error: steps.find((step) => step.error)?.error,
    ruleSnapshot: { trigger: rule.trigger, conditions: rule.conditions, actions: rule.actions },
  };
}

/** A background pass that throws used to vanish — `background()` swallows it —
 * which looked exactly like "the automation just never ran". Writing it to the
 * container's log puts the cause where someone debugging would look. */
async function logBackgroundError(context: PluginContext, containerId: string, source: PluginAutomationSource, event: PluginAutomationTrigger["type"], value: unknown): Promise<void> {
  const error = describeError(value);
  const at = Date.now();
  await appendAutomationLogs(context, containerId, [{
    id: queryId("automation-log"), ruleId: "_error", ruleName: "Background check", objectId: containerId, objectTitle: "", event,
    status: "error", message: `Background check failed: ${error.message}`, occurredAt: at, executionKey: `_error:${containerId}:${at}`,
    source, containerId, error,
  }]).catch(() => {});
}

/** Appends log entries to the container's own `_automationLog`, re-reading it
 * first: the background listener and the open Automations panel can both be
 * writing to the same container, and this must not stomp whichever wrote
 * last. */
async function appendAutomationLogs(context: PluginContext, containerId: string, entries: PluginAutomationLog[]): Promise<void> {
  if (!entries.length) return;
  const current = await context.data.objects.get(containerId);
  if (!current) return;
  const props = readProps(current.props);
  const logs = Array.isArray(props._automationLog) ? props._automationLog as PluginAutomationLog[] : [];
  await context.data.objects.update(current.id, { props: JSON.stringify({ ...props, _automationLog: [...entries, ...logs].slice(0, 200) }) }, current.updated_at);
}

/** "Run now": applies `rule` to each of `records` regardless of trigger. Runs
 * with an empty dedup set (the user asked for it explicitly) but under the
 * rule's own trigger event, so the entries it logs carry the same
 * executionKey the background check looks up — a date_reached rule applied
 * here is not fired a second time by the 15-minute check. */
export async function runRuleNow(context: PluginContext, containerId: string, rule: PluginAutomationRule, records: PluginObject[]): Promise<PluginAutomationLog[]> {
  const entries: PluginAutomationLog[] = [];
  const meta: AutomationRunMeta = { source: "run-now", runId: queryId("run") };
  for (const record of records) entries.push(await executeAutomationRule(context, rule, record, rule.trigger.type, containerId, new Set(), undefined, meta));
  await appendAutomationLogs(context, containerId, entries);
  return entries;
}

/** Evaluates and runs every enabled rule on `containerId` that matches
 * `event` for `object`. Shared by all three background triggers. */
async function runContainerAutomations(context: PluginContext, containerId: string, event: PluginAutomationTrigger["type"], object: PluginObject, changedValues?: Record<string, string>, relationEvent?: AutomationRelationEvent): Promise<void> {
  const container = await context.data.objects.get(containerId);
  if (!container) return;
  const props = readProps(container.props);
  const rules = parsePluginAutomationRules(props._automations);
  const known = new Set((Array.isArray(props._automationLog) ? props._automationLog as PluginAutomationLog[] : []).map((entry) => entry.executionKey));
  const entries: PluginAutomationLog[] = [];
  const meta: AutomationRunMeta = { source: "event", runId: queryId("run") };
  try {
    for (const rule of rules) {
      if (!pluginAutomationMatches(rule, object, event, changedValues, new Date(), relationEvent)) continue;
      const result = await executeAutomationRule(context, rule, object, event, containerId, known, relationEvent, meta);
      entries.push(result);
      known.add(result.executionKey);
    }
    await appendAutomationLogs(context, containerId, entries);
  } catch (value) {
    await logBackgroundError(context, containerId, "event", event, value);
  }
}

/** Per-object rate limit on background-triggered automation runs. A rule
 * that sets the very property it watches for (or two rules that set each
 * other's trigger field) would otherwise re-fire on its own resulting
 * `object.updated` event forever — dedup by executionKey doesn't stop this
 * for `property_changed`, since every automation-caused write gets a fresh
 * `updated_at`. This is a circuit breaker, not a design that expects to be
 * hit: legitimate use never approaches it. */
const RATE_LIMIT_WINDOW_MS = 5000;
const RATE_LIMIT_MAX_RUNS = 8;
/** `tripLogged` makes a trip visible exactly once per object per episode — a
 * silent breaker previously looked identical, from the outside, to "the
 * automation just stopped working": no log entry, no error, nothing to
 * search for. It clears the moment the window is no longer exceeded, so a
 * later, separate loop episode on the same object logs again. */
async function withinRateLimit(context: PluginContext, recentRuns: Map<string, number[]>, tripLogged: Set<string>, objectId: string, containerId: string): Promise<boolean> {
  const now = Date.now();
  const stamps = (recentRuns.get(objectId) ?? []).filter((at) => now - at < RATE_LIMIT_WINDOW_MS);
  if (stamps.length >= RATE_LIMIT_MAX_RUNS) {
    recentRuns.set(objectId, stamps);
    if (!tripLogged.has(objectId)) {
      tripLogged.add(objectId);
      await appendAutomationLogs(context, containerId, [{
        id: queryId("automation-log"), ruleId: "_rate_limit", ruleName: "Rate limit",
        objectId, objectTitle: "", event: "manual", status: "error",
        message: `Automations on this record were paused after firing ${RATE_LIMIT_MAX_RUNS} times in ${RATE_LIMIT_WINDOW_MS / 1000}s — check for two rules re-triggering each other (a trigger loop).`,
        occurredAt: now, executionKey: `_rate_limit:${objectId}:${now}`,
      }]).catch(() => {});
    }
    return false;
  }
  stamps.push(now);
  recentRuns.set(objectId, stamps);
  tripLogged.delete(objectId);
  return true;
}

/** Re-reads the container fresh, so a `set_property` action the same rule's
 * own run just performed (via executeAutomationRule, a separate write) isn't
 * clobbered by a stale copy of `_automations`. */
async function persistRuleLastRun(context: PluginContext, containerId: string, ruleId: string, when: number): Promise<void> {
  const current = await context.data.objects.get(containerId);
  if (!current) return;
  const props = readProps(current.props);
  const rules = parsePluginAutomationRules(props._automations).map((rule) => rule.id === ruleId ? { ...rule, lastRunAt: when } : rule);
  await context.data.objects.update(current.id, { props: JSON.stringify({ ...props, _automations: rules }) }, current.updated_at);
}

/** `recurring` has no event to react to — this is what stands in for one.
 * Runs on an interval (see automationsOnActivate) rather than at a precise
 * moment: a rule due at 9:00 AM fires at the next check after 9:00, not
 * necessarily at 9:00 itself. Scans every project/folder rather than
 * indexing recurring rules separately, matching listAutomationRules' own
 * "there's no automations-specific query, so read what's there" approach —
 * automations are rare enough per workspace that this stays cheap. */
export async function runDueRecurringRules(context: PluginContext, recentRuns: Map<string, number[]>, tripLogged: Set<string>): Promise<void> {
  const now = new Date();
  const containers = await context.data.objects.query({ limit: 5000 });
  for (const container of containers) {
    try {
    const props = readProps(container.props);
    const rules = parsePluginAutomationRules(props._automations);
    const dueRules = rules.filter((rule) => rule.enabled && rule.trigger.type === "recurring" && isRecurringDue(rule.trigger, rule.lastRunAt, now));
    if (dueRules.length === 0 || !(await withinRateLimit(context, recentRuns, tripLogged, container.id, container.id))) continue;
    const known = new Set((Array.isArray(props._automationLog) ? props._automationLog as PluginAutomationLog[] : []).map((entry) => entry.executionKey));
    const entries: PluginAutomationLog[] = [];
    const meta: AutomationRunMeta = { source: "schedule", runId: queryId("run") };
    // "records" runs the rule on each matching child record; a rule without a
    // target is a legacy one and keeps acting on the project itself.
    const records = dueRules.some((rule) => rule.trigger.type === "recurring" && rule.trigger.target === "records")
      ? await context.data.objects.query({ parentId: container.id, limit: 5000 }) : [];
    for (const rule of dueRules) {
      const targets = rule.trigger.type === "recurring" && rule.trigger.target === "records" ? previewRuleMatches(rule, records, now) : [container];
      for (const target of targets) {
        const result = await executeAutomationRule(context, rule, target, "recurring", container.id, known, undefined, meta);
        entries.push(result);
        known.add(result.executionKey);
      }
      // Persisted even on failure/skip: a rule that errors every check must
      // not spin the check interval retrying it forever.
      await persistRuleLastRun(context, container.id, rule.id, now.getTime());
    }
    await appendAutomationLogs(context, container.id, entries);
    } catch (value) {
      await logBackgroundError(context, container.id, "schedule", "recurring", value);
    }
  }
}

/** `date_reached` has an event to react to only while the Automations panel
 * is open (its "Run due rules" button). Nothing fired it in the background,
 * so "notify me when this task's due date arrives" silently did nothing
 * unless you opened the tab. This is the background stand-in, run on the same
 * interval as the recurring check: for every container that has an enabled
 * `date_reached` rule, walk its records and run the ones whose date has
 * arrived. `pluginAutomationMatches` is the due-check (it rejects a future
 * date); the per-rule+record executionKey stops it re-firing after that. */
export async function runDueDateReachedRules(context: PluginContext, recentRuns: Map<string, number[]>, tripLogged: Set<string>): Promise<void> {
  const now = new Date();
  const containers = await context.data.objects.query({ limit: 5000 });
  for (const container of containers) {
    try {
    const props = readProps(container.props);
    const rules = parsePluginAutomationRules(props._automations).filter((rule) => rule.enabled && rule.trigger.type === "date_reached");
    if (rules.length === 0) continue;
    const records = await context.data.objects.query({ parentId: container.id, limit: 5000 });
    const known = new Set((Array.isArray(props._automationLog) ? props._automationLog as PluginAutomationLog[] : []).map((entry) => entry.executionKey));
    const entries: PluginAutomationLog[] = [];
    const meta: AutomationRunMeta = { source: "schedule", runId: queryId("run") };
    for (const record of records) {
      for (const rule of rules) {
        if (!pluginAutomationMatches(rule, record, "date_reached", undefined, now)) continue;
        if (!(await withinRateLimit(context, recentRuns, tripLogged, record.id, container.id))) continue;
        const result = await executeAutomationRule(context, rule, record, "date_reached", container.id, known, undefined, meta);
        // A due date stays "reached" forever, so every 15-minute check met the
        // same records again. Logging those repeats rewrote the project each
        // time -- a fresh write per device per check, which sync then saw as
        // "edited on both devices" and turned into a conflict copy per cycle.
        if (result.status === "skipped" && result.message === ALREADY_EXECUTED) continue;
        entries.push(result);
        known.add(result.executionKey);
      }
    }
    await appendAutomationLogs(context, container.id, entries);
    } catch (value) {
      await logBackgroundError(context, container.id, "schedule", "date_reached", value);
    }
  }
}

/** How often the interval checks for a due `recurring` rule. Coarser than
 * the finest configurable schedule (daily) by design — a schedule is due
 * "on this day", not at a particular minute, so 15 minutes of slack after
 * midnight (or after Notible starts, for a rule that was due while it was
 * closed) costs nothing a user would notice. */
const RECURRING_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/** Wires the three triggers that a real Core event exists for
 * (record_created, property_changed, relation_changed) so they run for as
 * long as Notible is open — not only while the Automations panel itself is
 * the active screen — plus a periodic check for `recurring` rules, the one
 * trigger with no event to react to. */
/** Runs a fire-and-forget background task and swallows whatever it rejects
 * with. Every caller below is invoked from an event handler or a timer, with
 * nothing downstream awaiting the result — an uncaught rejection there is an
 * unhandled rejection at the process level, not a contained failure, and one
 * misbehaving container (or, as isolation testing found, a host with no
 * DataApi configured at all) would otherwise take the whole app down. */
function background(task: () => Promise<void>): void {
  task().catch(() => {});
}

function automationsOnActivate(context: PluginContext): void {
  // property_changed needs a "before" to diff against, and the event payload
  // only ever carries {id, type}. Kept in memory only — a change that
  // happened on another device before the next sync pull is not something a
  // live diff can see either way.
  const propsCache = new Map<string, string>();
  const recentRuns = new Map<string, number[]>();
  const tripLogged = new Set<string>();

  // Seed the "before" snapshot for every existing object once, at activate.
  // Without this, the FIRST edit to any pre-existing record since the app
  // started has no cache entry, so object.updated below bails with no diff —
  // a property_changed rule then only ever fires from the *second* edit on,
  // which reads from the outside exactly like "the automation is broken".
  // `!has` guard: an event that already ran for an object mid-seed has the
  // fresher value; don't clobber it with the query snapshot.
  background(async () => {
    for (const object of await context.data.objects.query({ limit: 5000 })) {
      if (!propsCache.has(object.id)) propsCache.set(object.id, object.props);
    }
  });

  context.events.on<{ id: string; type: string }>("object.created", ({ id }) => background(async () => {
    const object = await context.data.objects.get(id);
    if (!object) return;
    propsCache.set(object.id, object.props);
    if (!object.parent_id) return;
    if (!(await withinRateLimit(context, recentRuns, tripLogged, object.id, object.parent_id))) return;
    await runContainerAutomations(context, object.parent_id, "record_created", object);
  }));

  context.events.on<{ id: string; type: string }>("object.updated", ({ id }) => background(async () => {
    const object = await context.data.objects.get(id);
    if (!object) return;
    const previousRaw = propsCache.get(id);
    propsCache.set(id, object.props);
    if (!previousRaw || !object.parent_id) return;
    const previous = readProps(previousRaw);
    const next = readProps(object.props);
    const changed: Record<string, string> = {};
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      if (key.startsWith("_")) continue;
      if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) changed[key] = String(next[key] ?? "");
    }
    if (Object.keys(changed).length === 0) return;
    if (!(await withinRateLimit(context, recentRuns, tripLogged, object.id, object.parent_id))) return;
    await runContainerAutomations(context, object.parent_id, "property_changed", object, changed);
  }));

  const onRelationEvent = (change: "added" | "removed") => ({ fromId, toId, kind }: { fromId: string; toId: string; kind: string }) => background(async () => {
    const object = await context.data.objects.get(fromId);
    if (!object || !object.parent_id) return;
    if (!(await withinRateLimit(context, recentRuns, tripLogged, object.id, object.parent_id))) return;
    await runContainerAutomations(context, object.parent_id, "relation_changed", object, undefined, { relation: kind, change, targetId: toId });
  });
  context.events.on<{ fromId: string; toId: string; kind: string }>("relation.created", onRelationEvent("added"));
  context.events.on<{ fromId: string; toId: string; kind: string }>("relation.deleted", onRelationEvent("removed"));

  // Once immediately — a rule due while Notible was closed shouldn't wait up
  // to RECURRING_CHECK_INTERVAL_MS after the app opens to catch up — then on
  // the public scheduler for as long as the plugin stays enabled. That
  // interval's own errors are already caught and reported by
  // context.scheduler itself, so no background() wrapper is needed there.
  const runScheduled = async () => { await runDueRecurringRules(context, recentRuns, tripLogged); await runDueDateReachedRules(context, recentRuns, tripLogged); };
  background(runScheduled);
  context.scheduler.every(RECURRING_CHECK_INTERVAL_MS, runScheduled);
}

function queryId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function listAutomationRules(context: PluginContext) {
  const objects = await context.data.objects.query({ limit: 5000 });
  return objects.flatMap((object) => validateAutomationRules(readProps(object.props)._automations).map((rule) => ({ objectId: object.id, objectTitle: object.title, rule })));
}

export async function upsertAutomationRules(context: PluginContext, input?: unknown) {
  const value = input && typeof input === "object" ? input as { objectId?: unknown; rules?: unknown } : {};
  if (typeof value.objectId !== "string" || !value.objectId) return { pluginId: context.manifest.id, automations: await listAutomationRules(context) };
  const current = await context.data.objects.get(value.objectId);
  if (!current) throw new Error(`Object not found: ${value.objectId}`);
  const props = readProps(current.props);
  if (value.rules === undefined) {
    // No `rules` payload: report what's already configured for this object
    // instead of silently replacing it with an empty list. Previously this
    // wiped out any rules the real Automations UI had saved for the record
    // whenever the command ran with just an objectId (e.g. from a hand-typed
    // command palette input), which is exactly what "doesn't work" looks
    // like from the outside.
    const rules = validateAutomationRules(props._automations);
    return { pluginId: context.manifest.id, objectId: current.id, ruleCount: rules.length, rules };
  }
  const rules = validateAutomationRules(value.rules);
  const updated = await context.data.objects.update(current.id, { props: JSON.stringify({ ...props, _automations: rules }) }, current.updated_at);
  return { pluginId: context.manifest.id, objectId: updated.id, ruleCount: rules.length, rules };
}

export const automationsPlugin = createBuiltinSurface({
  manifest: { id: "notible.automations", name: "Automations", version: "0.1.0", apiVersion: "0.1", entry: "index.ts", description: "Rules, triggers, conditions and safe automation execution.", permissions: ["data.read", "data.write", "workspace.ui", "notifications"], sync: "data" },
  capability: "automations",
  commandName: "Manage automations",
  viewTitle: "Automations",
  onCommand: upsertAutomationRules,
  onActivate: automationsOnActivate,
  viewRender: (context) => ({ kind: "react-loader", loader: () => import("./automations-ui"), context }),
  settingsRender: (context) => ({ kind: "react-loader", loader: () => import("./automations-ui"), context }),
  // Automations belong to the project they automate, not to a screen in
  // Settings that first asks you which project you meant.
  objectTabs: [{ id: "automations", label: "Automations", description: "Rules that react to record changes — set a field, notify, roll up status.", objectTypes: ["project", "folder", "space"], defaultFor: ["project"], order: 6, viewId: "surface" }],
});
