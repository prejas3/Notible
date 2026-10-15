import type { PluginContext, PluginObject, PluginType } from "../../packages/plugin-api/src/index.ts";
import { createBuiltinSurface } from "./scaffold.ts";

const FINANCE_TYPES = [
  { name: "financial_entry", icon: "¤", color: "#6f8f78", fields: { kind: { type: "select", options: ["cost", "income"] }, amount: { type: "number" }, currency: { type: "text" }, date: { type: "date" }, category: { type: "text" }, vendor: { type: "text" }, attachment: { type: "text" }, recurrence: { type: "select", options: ["none", "weekly", "monthly", "quarterly", "yearly"] }, status: { type: "select", options: ["planned", "approved", "paid", "cancelled"] }, milestoneId: { type: "text" } } },
  { name: "time_entry", icon: "◷", color: "#6d8299", fields: { date: { type: "date" }, person: { type: "text" }, hours: { type: "number" }, billable: { type: "bool" }, billableRate: { type: "number" }, costRate: { type: "number" }, currency: { type: "text" }, description: { type: "text" } } },
  { name: "vendor", icon: "▣", color: "#8a7d70", fields: { email: { type: "text" }, url: { type: "text" }, taxId: { type: "text" }, category: { type: "text" } } },
] as const;

function mergeSchema(existing: PluginType | undefined, incoming: typeof FINANCE_TYPES[number]): string {
  let schema: { fields?: Record<string, unknown> } = {};
  try { schema = existing ? JSON.parse(existing.schema) as { fields?: Record<string, unknown> } : {}; } catch { schema = {}; }
  return JSON.stringify({ ...schema, fields: { ...(schema.fields ?? {}), ...incoming.fields } });
}

export async function installFinance(context: PluginContext) {
  const existing = await context.data.types.list();
  for (const definition of FINANCE_TYPES) {
    const current = existing.find((candidate) => candidate.name === definition.name);
    await context.data.types.upsert(definition.name, mergeSchema(current, definition), current?.icon ?? definition.icon, current?.color ?? definition.color);
  }
  return { pluginId: context.manifest.id, typeCount: FINANCE_TYPES.length, types: FINANCE_TYPES.map((definition) => definition.name) };
}

export async function financeSummary(context: PluginContext, input?: unknown) {
  const value = input && typeof input === "object" ? input as { parentId?: unknown } : {};
  const parentId = typeof value.parentId === "string" ? value.parentId : undefined;
  const entries = await context.data.objects.query({ type: "financial_entry", parentId, limit: 5000 });
  const time = await context.data.objects.query({ type: "time_entry", parentId, limit: 5000 });
  // The dashboard's budget / opening cash / alert threshold / base currency
  // live on the container's props — without them budgetUsedPercent, runway
  // and currency handling are always zero / disabled. A genuine data-access
  // failure here propagates (the command rejects, the UI shows an error);
  // only a malformed props string is tolerated.
  let projectProps: Record<string, unknown> = {};
  if (parentId) {
    const container = await context.data.objects.get(parentId);
    if (container) {
      try {
        const parsed = JSON.parse(container.props) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) projectProps = parsed as Record<string, unknown>;
      } catch { /* malformed container props JSON — treat as empty */ }
    }
  }
  const summary = computeFinanceSummary(entries, time, projectProps, new Date());
  return { pluginId: context.manifest.id, entryCount: entries.length, timeEntryCount: time.length, ...summary };
}

// ---------------------------------------------------------------------------
// Pure finance helpers (project Finance tab). Ported from the deleted legacy
// `src/lib/finance.ts` + `financeExportRows`. Unit-tested headless in
// scripts/finance-parity-check.mjs. No React, no Tauri.

/** A translation key + params, so the UI localises the message with a stable
 *  key instead of rendering a server-built English sentence. */
export interface FinanceAlert {
  key:
    | "finance.alert.budgetThreshold"
    | "finance.alert.forecastExceedsBudget"
    | "finance.alert.runwayLow"
    | "finance.alert.marginNegative"
    | "finance.alert.currencyExcluded"
    | "finance.alert.currencyMixedNoBase";
  params?: Record<string, string>;
}

export interface FinanceSummary {
  actualCost: number;
  actualIncome: number;
  timeCost: number;
  billableRevenue: number;
  totalCost: number;
  totalRevenue: number;
  margin: number;
  burnRate: number;
  runwayMonths: number | null;
  forecastCost: number;
  forecastAtCompletion: number;
  variance: number;
  budgetUsedPercent: number;
  /** The currency every monetary field above is expressed in. `""` when it
   *  could not be resolved (no base currency set and >1 currency in the data)
   *  — in that case `monetaryTotalsAvailable` is false and the numbers are 0. */
  reportingCurrency: string;
  /** False when a single honest total is impossible without an exchange rate. */
  monetaryTotalsAvailable: boolean;
  /** Per-currency actual cost / income — always safe to show, never converted. */
  currencyBreakdown: Array<{ currency: string; actualCost: number; actualIncome: number }>;
  alerts: FinanceAlert[];
}

function financeNumber(value: unknown): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function financeParse(object: { props: string }): Record<string, unknown> {
  try { const parsed = JSON.parse(object.props) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function occurrences(recurrence: unknown): number {
  switch (recurrence) {
    case "weekly": return 52;
    case "monthly": return 12;
    case "quarterly": return 4;
    case "yearly": return 1;
    default: return 1;
  }
}

export function computeFinanceSummary(
  entries: PluginObject[],
  timeEntries: PluginObject[],
  projectProps: Record<string, unknown>,
  now: Date = new Date(),
): FinanceSummary {
  // Currency policy. Totals are expressed in ONE reporting currency:
  //  - the project's base currency if set;
  //  - else the sole currency in the data (blank counts as "the one currency");
  //  - else unresolved — we refuse to add different currencies together, so
  //    the monetary fields are zeroed and `monetaryTotalsAvailable` is false.
  // Entries in a currency other than the reporting one are always excluded
  // from the sums (we never invent an exchange rate) and reported as an alert.
  const baseCurrency = String(projectProps.baseCurrency ?? "").trim().toUpperCase();
  const currencyOf = (props: Record<string, unknown>) => String(props.currency ?? "").trim().toUpperCase();
  const allEntries = entries.map(financeParse).filter((props) => props.status !== "cancelled");
  const allTime = timeEntries.map(financeParse);
  const presentCurrencies = [...new Set([...allEntries, ...allTime].map(currencyOf).filter(Boolean))];
  const reportingCurrency = baseCurrency || (presentCurrencies.length <= 1 ? presentCurrencies[0] ?? "" : "");
  const monetaryTotalsAvailable = !!baseCurrency || presentCurrencies.length <= 1;
  const inReportingCurrency = (props: Record<string, unknown>) => {
    const cur = currencyOf(props);
    return !cur || !reportingCurrency || cur === reportingCurrency;
  };
  const otherCurrencies = [...new Set([...allEntries, ...allTime].filter((props) => !inReportingCurrency(props)).map(currencyOf))];

  const isActual = (props: Record<string, unknown>) => {
    const timestamp = Date.parse(String(props.date ?? ""));
    return props.status === "paid" || props.status === "approved" || (!Number.isNaN(timestamp) && timestamp <= now.getTime());
  };
  // Per-currency breakdown of realised cost / income — no conversion, so it is
  // always honest to display even when a single total is not.
  const breakdownMap = new Map<string, { currency: string; actualCost: number; actualIncome: number }>();
  for (const props of allEntries.filter(isActual)) {
    const cur = currencyOf(props) || reportingCurrency || "—";
    const row = breakdownMap.get(cur) ?? { currency: cur, actualCost: 0, actualIncome: 0 };
    if (props.kind === "income") row.actualIncome += financeNumber(props.amount);
    else row.actualCost += financeNumber(props.amount);
    breakdownMap.set(cur, row);
  }
  const currencyBreakdown = [...breakdownMap.values()].sort((a, b) => a.currency.localeCompare(b.currency));

  const activeEntries = allEntries.filter(inReportingCurrency);
  const actual = activeEntries.filter(isActual);
  const actualCost = actual.filter((props) => props.kind !== "income").reduce((sum, props) => sum + financeNumber(props.amount), 0);
  const actualIncome = actual.filter((props) => props.kind === "income").reduce((sum, props) => sum + financeNumber(props.amount), 0);
  const time = allTime.filter(inReportingCurrency);
  const timeCost = time.reduce((sum, props) => sum + financeNumber(props.hours) * financeNumber(props.costRate), 0);
  const billableRevenue = time.filter((props) => props.billable === true || props.billable === "true").reduce((sum, props) => sum + financeNumber(props.hours) * financeNumber(props.billableRate), 0);
  const totalCost = actualCost + timeCost;
  const totalRevenue = actualIncome + billableRevenue;
  const margin = totalRevenue - totalCost;
  const dates = [...actual, ...time].map((props) => Date.parse(String(props.date ?? ""))).filter(Number.isFinite);
  const firstDate = dates.length > 0 ? Math.min(...dates) : now.getTime();
  const elapsedMonths = Math.max(1, (now.getTime() - firstDate) / (30.4375 * 86_400_000));
  const burnRate = totalCost / elapsedMonths;
  const openingCash = financeNumber(projectProps.openingCash);
  const runwayMonths = burnRate > 0 && openingCash > 0 ? openingCash / burnRate : null;
  const recurringForecast = activeEntries.filter((props) => props.kind !== "income" && props.recurrence && props.recurrence !== "none").reduce((sum, props) => sum + financeNumber(props.amount) * occurrences(props.recurrence), 0);
  const oneOffForecast = activeEntries.filter((props) => props.kind !== "income" && (!props.recurrence || props.recurrence === "none") && !actual.includes(props)).reduce((sum, props) => sum + financeNumber(props.amount), 0);
  const forecastCost = recurringForecast + oneOffForecast;
  const forecastAtCompletion = totalCost + forecastCost;
  const approvedBudget = financeNumber(projectProps.approvedBudget || projectProps.plannedBudget);
  const variance = approvedBudget - forecastAtCompletion;
  const budgetUsedPercent = approvedBudget > 0 ? (totalCost / approvedBudget) * 100 : 0;
  const threshold = Math.max(1, financeNumber(projectProps.budgetAlertThreshold) || 80);
  const alerts: FinanceAlert[] = [];
  if (monetaryTotalsAvailable) {
    if (approvedBudget > 0 && budgetUsedPercent >= threshold) alerts.push({ key: "finance.alert.budgetThreshold" });
    if (approvedBudget > 0 && forecastAtCompletion > approvedBudget) alerts.push({ key: "finance.alert.forecastExceedsBudget" });
    if (runwayMonths !== null && runwayMonths < 3) alerts.push({ key: "finance.alert.runwayLow" });
    if (margin < 0 && totalRevenue > 0) alerts.push({ key: "finance.alert.marginNegative" });
  }
  if (otherCurrencies.length > 0) {
    alerts.push({ key: "finance.alert.currencyExcluded", params: { currencies: otherCurrencies.join(", "), base: reportingCurrency } });
  }
  if (!monetaryTotalsAvailable) {
    alerts.push({ key: "finance.alert.currencyMixedNoBase", params: { currencies: presentCurrencies.join(", ") } });
  }

  const zero = !monetaryTotalsAvailable;
  return {
    actualCost: zero ? 0 : actualCost,
    actualIncome: zero ? 0 : actualIncome,
    timeCost: zero ? 0 : timeCost,
    billableRevenue: zero ? 0 : billableRevenue,
    totalCost: zero ? 0 : totalCost,
    totalRevenue: zero ? 0 : totalRevenue,
    margin: zero ? 0 : margin,
    burnRate: zero ? 0 : burnRate,
    runwayMonths: zero ? null : runwayMonths,
    forecastCost: zero ? 0 : forecastCost,
    forecastAtCompletion: zero ? 0 : forecastAtCompletion,
    variance: zero ? 0 : variance,
    budgetUsedPercent: zero ? 0 : budgetUsedPercent,
    reportingCurrency,
    monetaryTotalsAvailable,
    currencyBreakdown,
    alerts,
  };
}

export const FINANCE_HEADERS = ["record_type", "title", "kind", "amount", "currency", "date", "category", "vendor", "recurrence", "status", "person", "hours", "billable_rate", "cost_rate", "description", "billable"];

export function financeRows(entries: PluginObject[], timeEntries: PluginObject[]): string[][] {
  const rowFor = (object: PluginObject, kind: "financial_entry" | "time_entry") => {
    const props = financeParse(object);
    if (kind === "financial_entry") {
      return ["financial_entry", object.title ?? "", String(props.kind ?? "cost"), String(props.amount ?? ""), String(props.currency ?? ""), String(props.date ?? ""), String(props.category ?? ""), String(props.vendor ?? ""), String(props.recurrence ?? "none"), String(props.status ?? "planned"), "", "", "", "", "", ""];
    }
    return ["time_entry", object.title ?? "", "", "", String(props.currency ?? ""), String(props.date ?? ""), "", "", "", "", String(props.person ?? ""), String(props.hours ?? ""), String(props.billableRate ?? ""), String(props.costRate ?? ""), String(props.description ?? ""), props.billable === true || props.billable === "true" ? "true" : "false"];
  };
  return [...entries.map((object) => rowFor(object, "financial_entry")), ...timeEntries.map((object) => rowFor(object, "time_entry"))];
}

// A leading =, +, -, @, tab or CR makes a spreadsheet treat a cell as a
// formula on open. We reversibly encode it: a cell that begins with one of
// those — OR with an apostrophe itself — gets one leading apostrophe, unless
// it is a plain number (so amounts / rates round-trip untouched).
// `financeCsvUnguard` removes exactly that one apostrophe, so `=1+1`, `'=1`
// and ordinary text all survive an export→import round-trip byte-for-byte.
const CSV_GUARD_LEAD = /^['=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

function csvGuard(value: string): string {
  return CSV_GUARD_LEAD.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
}

/** Inverse of `csvGuard` for text cells read back from a finance CSV. */
export function financeCsvUnguard(cell: string): string {
  return cell.startsWith("'") ? cell.slice(1) : cell;
}

function csvEscape(value: string): string {
  const guarded = csvGuard(value);
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function financeCsv(entries: PluginObject[], timeEntries: PluginObject[]): string {
  return [FINANCE_HEADERS, ...financeRows(entries, timeEntries)].map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

const HEADER_TO_PROP: Record<string, string> = { billable_rate: "billableRate", cost_rate: "costRate" };
const NUMERIC_PROPS = new Set(["amount", "hours", "billableRate", "costRate"]);

/**
 * Map one parsed CSV row to a creatable finance record, reversing the formula
 * guard on every text cell (title included). Numeric fields become numbers,
 * `billable` becomes a boolean. Returns `null` for a row with no usable title.
 * This is the single import mapping — the UI and the regression test both call it.
 */
export function financeImportRow(
  headers: string[],
  row: string[],
): { type: "financial_entry" | "time_entry"; title: string; props: Record<string, string | number | boolean> } | null {
  const at = (name: string) => { const i = headers.indexOf(name); return i >= 0 ? (row[i] ?? "") : ""; };
  const type = at("record_type").trim() === "time_entry" ? "time_entry" : "financial_entry";
  const rawTitle = headers.indexOf("title") >= 0 ? at("title") : (row.find((cell) => cell.trim()) ?? "");
  const title = financeCsvUnguard(rawTitle.trim()).trim();
  if (!title) return null;
  const props: Record<string, string | number | boolean> = {};
  headers.forEach((header, index) => {
    if (header === "record_type" || header === "title") return;
    const raw = (row[index] ?? "").trim();
    if (!raw) return;
    const key = HEADER_TO_PROP[header] ?? header;
    if (key === "billable") { props.billable = raw.toLowerCase() === "true"; return; }
    if (NUMERIC_PROPS.has(key)) { props[key] = Number(raw); return; }
    props[key] = financeCsvUnguard(raw);
  });
  return { type, title, props };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(value: number): number[] { return [value & 0xff, (value >>> 8) & 0xff]; }
function u32(value: number): number[] { return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]; }

/** Store-only (method 0) ZIP — enough for an .xlsx OPC package. DOS date/time
 * are fixed constants; every part is stored uncompressed with its CRC-32. */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: number[] = [];
  const central: number[] = [];
  let offset = 0;
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;
    const local = [
      0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(0), ...u16(0x21), ...u16(0x21),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(nameBytes.length), ...u16(0),
      ...nameBytes,
    ];
    localChunks.push(...local, ...file.data);
    central.push(
      0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0x21), ...u16(0x21),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes,
    );
    offset += local.length + file.data.length;
  }
  const centralStart = offset;
  const eocd = [
    0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(central.length), ...u32(centralStart), ...u16(0),
  ];
  return Uint8Array.from([...localChunks, ...central, ...eocd]);
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Minimal single-sheet .xlsx: every cell an inline string, no shared-strings
 * table, no number typing (a spreadsheet re-parses numeric-looking strings on
 * open). Matches the CSV's stringly output. */
export function xlsxBytes(sheetName: string, headers: string[], rows: string[][]): Uint8Array {
  const encoder = new TextEncoder();
  const cell = (text: string) => `<c t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
  const rowXml = (cells: string[]) => `<row>${cells.map(cell).join("")}</row>`;
  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    rowXml(headers) + rows.map(rowXml).join("") +
    `</sheetData></worksheet>`;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `</Types>`;
  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${xmlEscape(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `</Relationships>`;
  return zipStore([
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rootRels) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRels) },
    { name: "xl/worksheets/sheet1.xml", data: encoder.encode(sheetXml) },
  ]);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export const financePlugin = createBuiltinSurface({
  manifest: { id: "notible.finance", name: "Finance", version: "0.1.0", apiVersion: "0.1", entry: "index.ts", description: "Financial entries, budgets, vendors and time tracking.", permissions: ["data.read", "data.write", "workspace.ui"], sync: "data", dependencies: { "notible.properties": "0.1.0" } },
  capability: "finance",
  commandName: "Install finance models",
  viewTitle: "Finance",
  settingsTitle: "Finance settings",
  onCommand: async (context, input) => input && typeof input === "object" && "parentId" in input ? financeSummary(context, input) : installFinance(context),
  viewRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
  settingsRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
  // The project Finance tab belongs to Finance itself (D8), not to Planning: turning Finance on is
  // what gives a project its budget. Same dashboard view, its finance tab.
  extraViews: [
    { id: "project-finance", title: "Project finance", render: (context) => ({ kind: "react-loader", loader: () => import("./project-dashboard-ui"), context }) },
  ],
  objectTabs: [
    { id: "finance", label: "Finance", description: "Budget, costs, income, time entries and a weekly capacity schedule.", objectTypes: ["project"], order: 4, viewId: "project-finance", viewProps: { tab: "finance" } },
  ],
});
