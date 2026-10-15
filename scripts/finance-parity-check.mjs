// scripts/finance-parity-check.mjs
// ponytail: pure finance math + CSV + a hand-rolled XLSX (store-only zip).
// Run: node --experimental-strip-types scripts/finance-parity-check.mjs
import assert from "node:assert/strict";
import {
  computeFinanceSummary, financeSummary, FINANCE_HEADERS, financeCsv, financeRows,
  financeImportRow, financeCsvUnguard, crc32, xlsxBytes, bytesToBase64,
} from "../plugins/builtin/finance.ts";
import { parseDelimited } from "../plugins/builtin/views.ts";

const entry = (props) => ({ id: Math.random().toString(36).slice(2), type: "financial_entry", title: "e", props: JSON.stringify(props) });
const time = (props) => ({ id: Math.random().toString(36).slice(2), type: "time_entry", title: "t", props: JSON.stringify(props) });
const alertKeys = (s) => s.alerts.map((a) => a.key);

// computeFinanceSummary
{
  const now = new Date("2026-06-01T00:00:00Z");
  const entries = [
    entry({ kind: "cost", amount: 1000, status: "paid", date: "2026-01-10" }),
    entry({ kind: "cost", amount: 500, status: "planned", date: "2026-12-01" }),
    entry({ kind: "cost", amount: 100, status: "approved", recurrence: "monthly", date: "2026-02-01" }),
    entry({ kind: "income", amount: 3000, status: "approved", date: "2026-03-01" }),
    entry({ kind: "cost", amount: 999, status: "cancelled", date: "2026-01-01" }),
  ];
  const times = [
    time({ hours: 10, costRate: 50, billableRate: 120, billable: true, date: "2026-02-01" }),
    time({ hours: 5, costRate: 40, billableRate: 100, billable: false, date: "2026-02-15" }),
  ];
  const s = computeFinanceSummary(entries, times, { approvedBudget: 2000, openingCash: 1000, budgetAlertThreshold: 50 }, now);
  assert.equal(s.actualCost, 1100, "paid + approved costs; cancelled + future excluded");
  assert.equal(s.actualIncome, 3000);
  assert.equal(s.timeCost, 10 * 50 + 5 * 40); // 700
  assert.equal(s.billableRevenue, 10 * 120); // 1200
  assert.equal(s.totalCost, 1100 + 700);
  assert.ok(s.budgetUsedPercent > 50, "budget threshold crossed");
  assert.ok(alertKeys(s).includes("finance.alert.budgetThreshold"), `alerts: ${alertKeys(s).join(" | ")}`);
  assert.equal(s.monetaryTotalsAvailable, true);
  assert.equal(s.reportingCurrency, "");
  assert.ok(typeof s.runwayMonths === "number" || s.runwayMonths === null);
}

// currency policy
{
  const now = new Date("2026-06-01T00:00:00Z");
  const mixed = [
    entry({ kind: "cost", amount: 100, status: "paid", date: "2026-01-01", currency: "PLN" }),
    entry({ kind: "cost", amount: 100, status: "paid", date: "2026-01-01", currency: "USD" }),
    entry({ kind: "cost", amount: 50, status: "paid", date: "2026-01-01" }), // blank -> assumed reporting currency
  ];

  // base currency set: off-currency rows drop out, blank assumed base
  const withBase = computeFinanceSummary(mixed, [], { baseCurrency: "pln" }, now);
  assert.equal(withBase.actualCost, 150, "USD row excluded, blank-currency row kept");
  assert.equal(withBase.reportingCurrency, "PLN");
  assert.equal(withBase.monetaryTotalsAvailable, true);
  const excluded = withBase.alerts.find((a) => a.key === "finance.alert.currencyExcluded");
  assert.ok(excluded && excluded.params.currencies.includes("USD"), "USD exclusion alert carries the currency");

  // no base, >1 currency: NO summed monetary total, breakdown instead
  const noBase = computeFinanceSummary(mixed, [], {}, now);
  assert.equal(noBase.monetaryTotalsAvailable, false, "a mixed total must not be presented");
  assert.equal(noBase.actualCost, 0, "monetary fields zeroed when unresolved");
  assert.equal(noBase.reportingCurrency, "");
  assert.ok(alertKeys(noBase).includes("finance.alert.currencyMixedNoBase"));
  const plnRow = noBase.currencyBreakdown.find((b) => b.currency === "PLN");
  assert.ok(plnRow && plnRow.actualCost === 100, "breakdown reports PLN cost without conversion");
  assert.ok(noBase.currencyBreakdown.some((b) => b.currency === "USD" && b.actualCost === 100));

  // no base, single currency: resolvable, totals available
  const single = computeFinanceSummary(
    [entry({ kind: "cost", amount: 40, status: "paid", date: "2026-01-01", currency: "EUR" }),
     entry({ kind: "cost", amount: 60, status: "paid", date: "2026-01-01", currency: "EUR" })],
    [], {}, now,
  );
  assert.equal(single.monetaryTotalsAvailable, true);
  assert.equal(single.reportingCurrency, "EUR");
  assert.equal(single.actualCost, 100);
}

// financeSummary wrapper: container props feed the summary; read failures are not swallowed
{
  const container = { id: "proj1", props: JSON.stringify({ approvedBudget: 100, baseCurrency: "PLN" }) };
  const stub = (getImpl) => ({
    manifest: { id: "notible.finance" },
    data: { objects: {
      get: getImpl,
      query: async ({ type }) => (type === "financial_entry"
        ? [entry({ kind: "cost", amount: 100, status: "paid", date: "2020-01-01", currency: "PLN" })]
        : []),
    } },
  });
  const ok = await financeSummary(stub(async (id) => (id === "proj1" ? container : null)), { parentId: "proj1" });
  assert.equal(ok.budgetUsedPercent, 100, "wrapper passes container budget into computeFinanceSummary");
  assert.equal(ok.reportingCurrency, "PLN");

  await assert.rejects(
    () => financeSummary(stub(async () => { throw new Error("db unavailable"); }), { parentId: "proj1" }),
    /db unavailable/,
    "a container read failure propagates instead of degrading to a budget-less summary",
  );
}

// financeCsv round-trip (comma / quote cells)
{
  const entries = [entry({ kind: "cost", amount: 12.5, currency: "PLN", date: "2026-01-02", category: "a, b", vendor: 'X "Y"', recurrence: "none", status: "planned" })];
  const times = [time({ date: "2026-01-03", person: "Ada", hours: 8, billableRate: 100, costRate: 60, description: "work" })];
  const back = parseDelimited(financeCsv(entries, times));
  assert.deepEqual(back.headers, FINANCE_HEADERS);
  const r0 = financeImportRow(back.headers, back.rows[0]);
  assert.equal(r0.type, "financial_entry");
  assert.equal(r0.props.category, "a, b", "comma cell round-trips");
  assert.equal(r0.props.vendor, 'X "Y"', "quote cell round-trips");
  assert.equal(r0.props.amount, 12.5, "numeric field stays numeric");
  const r1 = financeImportRow(back.headers, back.rows[1]);
  assert.equal(r1.type, "time_entry");
  assert.equal(r1.props.person, "Ada");
}

// billable + formula guard + literal apostrophe survive export -> import, through the real mapping
{
  const entries = [
    entry({ kind: "cost", amount: -12.5, currency: "USD", date: "2026-01-02",
      // title and text fields with spreadsheet-formula and apostrophe leads
      category: "@SUM(A1)", vendor: "'=1" }),
  ];
  entries[0].title = "=cmd|' /c calc'!A1";
  const times = [
    time({ date: "2026-01-03", person: "Ada", hours: 8, billable: true, description: "line1\r\nline2" }),
    time({ date: "2026-01-04", person: "Ben", hours: 4, billable: false }),
  ];
  const csv = financeCsv(entries, times);
  assert.ok(csv.includes("'=cmd"), "formula-leading title is guarded on export");
  assert.ok(csv.includes("''=1"), "a literal leading apostrophe is doubled, not lost");
  assert.ok(csv.includes(",-12.5,"), "a negative number stays a bare number");

  const back = parseDelimited(csv);
  const rec0 = financeImportRow(back.headers, back.rows[0]);
  assert.equal(rec0.title, "=cmd|' /c calc'!A1", "title round-trips exactly, guard reversed");
  assert.equal(rec0.props.category, "@SUM(A1)", "text prop guard reversed");
  assert.equal(rec0.props.vendor, "'=1", "literal apostrophe text round-trips exactly");
  assert.equal(rec0.props.amount, -12.5, "ordinary numeric field preserved");

  const rec1 = financeImportRow(back.headers, back.rows[1]);
  assert.equal(rec1.props.billable, true, "billable becomes a boolean true");
  assert.equal(rec1.props.description, "line1\r\nline2", "carriage return round-trips (quoted)");
  const rec2 = financeImportRow(back.headers, back.rows[2]);
  assert.equal(rec2.props.billable, false, "billable becomes a boolean false");
}

// financeCsvUnguard only removes ONE leading apostrophe
assert.equal(financeCsvUnguard("'=1"), "=1");
assert.equal(financeCsvUnguard("''=1"), "'=1");
assert.equal(financeCsvUnguard("plain"), "plain");

// crc32 known value (standard check string)
assert.equal(crc32(new TextEncoder().encode("123456789")) >>> 0, 0xCBF43926, "crc32 check-string mismatch");

// xlsxBytes = a store-only zip with the 5 OPC parts
{
  const bytes = xlsxBytes("Finance", FINANCE_HEADERS, financeRows([entry({ kind: "cost", amount: 1 })], []));
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b); assert.equal(bytes[2], 0x03); assert.equal(bytes[3], 0x04); // PK\x03\x04
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, "EOCD present");
  const totalEntries = bytes[eocd + 10] | (bytes[eocd + 11] << 8);
  assert.equal(totalEntries, 5, "xlsx must have the 5 OPC parts");
}

// bytesToBase64 round-trips through atob
{
  const src = new Uint8Array([0, 1, 2, 254, 255, 65, 66]);
  const back = Uint8Array.from(atob(bytesToBase64(src)), (c) => c.charCodeAt(0));
  assert.deepEqual([...back], [...src]);
}

console.log("finance-parity-check: OK");
