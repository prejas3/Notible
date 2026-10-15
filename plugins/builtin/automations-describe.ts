import type { PluginAutomationAction, PluginAutomationCondition, PluginAutomationLog, PluginAutomationQuery, PluginAutomationRule, PluginAutomationTrigger } from "./automations.ts";
import type { Translate } from "./i18n.tsx";

/** I18N (Hive #28): marks a label translated later through `d.t(label)`. Local, not
 *  imported from i18n.tsx: this file also runs under plain Node in the checks. */
const tr = (key: string) => key;

export type FieldKind = "text" | "number" | "date" | "boolean" | "tags";

/** Operator ids offered per field type. The stored ids are unchanged, so old
 * rules keep working; `operatorsFor` re-adds a saved legacy id if needed. */
const OPERATORS_BY_KIND: Record<FieldKind, string[]> = {
  text: ["equals", "not_equals", "contains", "not_contains", "empty", "not_empty"],
  date: ["before", "after", "today", "overdue", "empty"],
  number: ["equals", "gt", "gte", "lt", "lte"],
  boolean: ["equals"],
  tags: ["has_tag", "not_has_tag", "empty", "not_empty"],
};
export const OPERATOR_LABELS: Record<string, string> = {
  equals: tr("is"), not_equals: tr("is not"), contains: tr("contains text"), not_contains: tr("doesn't contain text"), empty: tr("is empty"), not_empty: tr("is not empty"),
  before: tr("is before"), after: tr("is after"), today: tr("is today"), overdue: tr("is overdue"),
  gt: tr("is greater than"), gte: tr("is at least"), lt: tr("is less than"), lte: tr("is at most"), has_tag: tr("has tag"), not_has_tag: tr("doesn't have tag"),
};
export const VALUELESS_OPERATORS = new Set(["empty", "not_empty", "today", "overdue"]);

export function operatorsFor(kind: FieldKind, current?: string): string[] {
  const list = OPERATORS_BY_KIND[kind];
  return current && !list.includes(current) ? [current, ...list] : list;
}

export interface DescribeContext { t: Translate; fieldLabel: (id: string) => string; }

function describeCondition(c: PluginAutomationCondition, d: DescribeContext): string {
  const head = `${d.fieldLabel(c.field)} ${d.t(OPERATOR_LABELS[c.operator] ?? c.operator)}`;
  return VALUELESS_OPERATORS.has(c.operator) || !c.value ? head : `${head} ${c.value}`;
}
function describeQuery(q: PluginAutomationQuery, d: DescribeContext): string {
  const parts = q.children.map((child) => {
    if (child.kind === "condition") return describeCondition(child, d);
    const inner = describeQuery(child, d);
    return inner ? `(${inner})` : "";
  }).filter(Boolean);
  return parts.reduce((left, right) => q.combinator === "or" ? d.t("{a} or {b}", { a: left, b: right }) : d.t("{a} and {b}", { a: left, b: right }));
}

const EVERY: Record<"daily" | "weekly" | "monthly", [string, string]> = {
  daily: [tr("Every day"), tr("Every {n} days")], weekly: [tr("Every week"), tr("Every {n} weeks")], monthly: [tr("Every month"), tr("Every {n} months")],
};
function describeTrigger(tr: PluginAutomationTrigger, d: DescribeContext): string {
  switch (tr.type) {
    case "property_changed": return tr.value ? d.t("When {field} changes to {value}", { field: d.fieldLabel(tr.field), value: tr.value }) : d.t("When {field} changes", { field: d.fieldLabel(tr.field) });
    case "record_created": return d.t("When an item is added");
    case "relation_changed": return tr.change === "added" ? d.t("When an item is linked") : tr.change === "removed" ? d.t("When an item is unlinked") : d.t("When an item is linked or unlinked");
    case "date_reached": return d.t("When {field} arrives or has passed", { field: d.fieldLabel(tr.field) });
    case "recurring": { const n = tr.interval ?? 1; const [one, many] = EVERY[tr.frequency ?? "weekly"]; return n > 1 ? d.t(many, { n }) : d.t(one); }
    default: return d.t("When you press Run");
  }
}
function describeAction(a: PluginAutomationAction, d: DescribeContext): string {
  switch (a.type) {
    case "set_property": return d.t("set {field} to {value}", { field: d.fieldLabel(a.field), value: a.value });
    case "create_record": return d.t('create {type} "{title}"', { type: a.objectType, title: a.title });
    case "add_relation": return d.t("link to another item");
    case "move_record": return d.t("move the item");
    case "set_reminder": return d.t("set a reminder");
    case "history_note": return d.t("add a history note");
    case "notify": return d.t('send notification "{title}"', { title: a.title });
  }
}

/** "When Due arrives or has passed, only if Status is Pending: set Status to closed." */
export function describeRule(rule: PluginAutomationRule, d: DescribeContext): string {
  const filter = rule.conditions ? describeQuery(rule.conditions, d) : "";
  const then = rule.actions.map((action) => describeAction(action, d)).join(", ");
  const when = describeTrigger(rule.trigger, d);
  return filter ? d.t("{when}, only if {filter}: {then}.", { when, filter, then }) : d.t("{when}: {then}.", { when, then });
}

/** Warns about typos and made-up statuses: a small, closed set of values already
 * used by the project's records that does not contain the one being set. */
export function isUnusedValue(value: string, seen: string[]): boolean {
  const v = value.trim().toLocaleLowerCase();
  return v !== "" && !v.includes("{{") && seen.length > 0 && seen.length <= 12 && !seen.some((s) => s.toLocaleLowerCase() === v);
}

/** Most recent run of a rule, grouped as one batch (Run now / a background
 * pass writes its entries within moments of each other). */
export function lastRunOf(ruleId: string, logs: PluginAutomationLog[]): { at: number; ok: number; failed: number } | null {
  const mine = logs.filter((entry) => entry.ruleId === ruleId);
  if (mine.length === 0) return null;
  const at = Math.max(...mine.map((entry) => entry.occurredAt));
  const batch = mine.filter((entry) => at - entry.occurredAt < 60_000);
  return { at, ok: batch.filter((entry) => entry.status === "success").length, failed: batch.filter((entry) => entry.status === "error").length };
}
