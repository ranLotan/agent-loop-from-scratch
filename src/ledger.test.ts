import assert from "node:assert/strict";
import { test } from "node:test";
import type { ImportBatch } from "./db/imports";
import type { ManualEntry } from "./db/manual";
import { buildLedger, cardState, ledgerMonth, OTHER, pieSlices, summarizeLedger } from "./ledger";
import { occurrencesFor, type RecurringDefinition } from "./recurring";
import type { CategorizedTransaction } from "./types";

const card = (id: string, amount: number, category: string | null, currency = "ILS"): CategorizedTransaction => ({
  id, date: "2026-09-10", merchant: `Shop ${id}`, amount, currency, source: "scraper", category, categorySource: category ? "rule" : null,
});
const def = (over: Partial<RecurringDefinition> & Pick<RecurringDefinition, "id" | "name" | "kind" | "amount">): RecurringDefinition => ({
  currency: "ILS", category: null, dayOfMonth: null, startMonth: "2026-01", endMonth: null, merchant: null, tolerance: 0.1,
  previousId: null, confirmMode: "auto", ...over,
});
const salary = def({ id: 1, name: "Salary", kind: "income", amount: 18000 });
const gas = def({ id: 2, name: "Gas", kind: "expense", amount: 250, confirmMode: "confirm", category: "דיור" });
const internet = def({ id: 3, name: "Internet", kind: "expense", amount: 120, merchant: "Bezeq", category: "תקשורת" });
const repair: ManualEntry = { id: 9, date: "2026-09-05", name: "Boiler repair", kind: "expense", amount: 850, currency: "ILS", category: "דיור", note: null };

test("a regular charge counts in its purchase month, whatever month bills it", () => {
  assert.equal(ledgerMonth({ date: "2026-09-28" }), "2026-09");
});

test("installment payment N counts in purchase month + (N − 1)", () => {
  const payment = (number: number) => ({ date: "2026-06-29", installments: { number, total: 12 } });
  assert.equal(ledgerMonth(payment(1)), "2026-06", "the first payment is the purchase month");
  assert.equal(ledgerMonth(payment(3)), "2026-08");
  assert.equal(ledgerMonth(payment(12)), "2027-05", "rolls over the year");
});

test("December → January boundary", () => {
  assert.equal(ledgerMonth({ date: "2026-12-31", installments: { number: 2, total: 3 } }), "2027-01");
});

test("malformed installment data falls back to the purchase month", () => {
  for (const number of [0, -1, 1.5, Number.NaN]) {
    assert.equal(ledgerMonth({ date: "2026-05-10", installments: { number, total: 3 } }), "2026-05", `number ${number}`);
  }
});

// ---------- monthLedger's pure parts (step 6.4) ----------

test("the acceptance month: card, salary (auto), gas (confirm, not confirmed), a one-off", () => {
  const charges = [card("food", 1200, "מזון"), { ...card("net", 120, "תקשורת"), merchant: "Bezeq" }];
  const occurrences = occurrencesFor("2026-09", [salary, gas, internet], [], charges);
  const entries = buildLedger({ card: charges, pending: [], occurrences, oneOffs: [repair] });

  assert.deepEqual(entries.map((e) => [e.name, e.status]), [
    ["Shop food", "counted"], ["Bezeq", "counted"], ["Gas", "awaiting_confirmation"], ["Salary", "counted"], ["Boiler repair", "counted"],
  ], "internet is there once, as its card charge");
  const s = summarizeLedger(entries);
  assert.deepEqual([s.income, s.expenses, s.net], [18000, 2170, 15830], "gas isn't counted");
  assert.deepEqual(s.awaiting, { count: 1, expectedIncome: 0, expectedExpenses: 250 });
});

test("confirming the gas bill changes Net", () => {
  const confirmed = [{ definitionId: 2, month: "2026-09", amount: 243.5, skipped: false, note: null, confirmedAt: "2026-09-20" }];
  const s = summarizeLedger(buildLedger({ card: [], pending: [], occurrences: occurrencesFor("2026-09", [salary, gas], confirmed, []), oneOffs: [] }));
  assert.deepEqual([s.net, s.awaiting.count], [17756.5, 0]);
});

test("a refund reduces its category; uncategorized charges get their own bucket; pending charges count", () => {
  const entries = buildLedger({
    card: [card("shoes", 400, "ביגוד"), card("refund", -150, "ביגוד"), card("mystery", 60, null)],
    pending: [card("cafe", 30, "מזון")],
    occurrences: [],
    oneOffs: [],
  });
  const s = summarizeLedger(entries);
  assert.equal(s.expenses, 340);
  assert.deepEqual(s.byCategory, [{ category: "ביגוד", amount: 250 }, { category: "Uncategorized", amount: 60 }, { category: "מזון", amount: 30 }]);
  assert.deepEqual(s.pendingCard, { count: 1, amount: 30 });
  assert.equal(entries.find((e) => e.ref === "cafe")!.origin, "pending");
});

test("skipped months and card-paid items aren't entries; other currencies stay out of Net", () => {
  const skipped = [{ definitionId: 1, month: "2026-09", amount: null, skipped: true, note: null }];
  const occurrences = occurrencesFor("2026-09", [salary, internet], skipped, []);
  const entries = buildLedger({ card: [card("eur", 39.3, "תיירות", "EUR")], pending: [], occurrences, oneOffs: [] });
  assert.deepEqual(entries.map((e) => e.ref), ["eur"], "no salary (skipped), no internet (card-paid, not seen yet)");
  const s = summarizeLedger(entries);
  assert.deepEqual([s.expenses, s.otherCurrencies], [0, { count: 1, totals: { EUR: -39.3 } }]);
});

test("pie: top 6 and Other above 7 categories; percentages add up to 100; slices add up to the expenses", () => {
  const eight = ["a", "b", "c", "d", "e", "f", "g", "h"].map((category, i) => ({ category, amount: 100 - i * 10 }));
  const slices = pieSlices(eight);
  assert.deepEqual(slices.map((s) => s.category), ["a", "b", "c", "d", "e", "f", OTHER]);
  assert.deepEqual(slices.at(-1)!.grouped, ["g", "h"]);
  assert.equal(Math.round(slices.reduce((sum, s) => sum + s.percent, 0) * 10), 1000);
  assert.equal(slices.reduce((sum, s) => sum + s.amount, 0), eight.reduce((sum, c) => sum + c.amount, 0));

  assert.equal(pieSlices(eight.slice(0, 7)).length, 7, "7 categories: no Other with a single category in it");
  const thirds = pieSlices([{ category: "x", amount: 1 }, { category: "y", amount: 1 }, { category: "z", amount: 1 }]);
  assert.deepEqual(thirds.map((s) => s.percent).sort(), [33.3, 33.3, 33.4], "33.3 × 3 would be 99.9");
});

test("pie: an empty month, and categories at or below zero, give no slices", () => {
  assert.deepEqual(pieSlices([]), []);
  assert.deepEqual(pieSlices([{ category: "refunds", amount: -20 }, { category: "zero", amount: 0 }]), []);
  assert.deepEqual(pieSlices([{ category: "a", amount: 50 }, { category: "b", amount: -5 }]).map((s) => [s.category, s.percent]), [["a", 100]]);
});

// ---------- When a month's card data is complete (monthStatus) ----------

const batch = (billingMonth: string, createdAt: string, source: ImportBatch["source"] = "scraper"): ImportBatch =>
  ({ id: 1, source, fileName: null, billingMonth, txCount: 1, checks: null, createdAt });

test("card data: missing, partial, complete", () => {
  assert.equal(cardState("2026-11", [], false).state, "missing");
  assert.equal(cardState("2026-11", [], true).state, "partial", "only pending charges so far");
  const nov = batch("2026-11", "2026-11-20T08:00:00.000Z");
  assert.deepEqual(cardState("2026-11", [nov], false), {
    state: "partial", asOf: nov.createdAt, statements: [{ month: "2026-11", imported: true }, { month: "2026-12", imported: false }],
  });
  assert.equal(cardState("2026-11", [nov, batch("2026-12", "2026-12-02T08:00:00.000Z")], false).state, "partial", "December fetched too early");
  const late = batch("2026-12", "2026-12-05T08:00:00.000Z");
  assert.deepEqual(cardState("2026-11", [nov, late], false).state, "complete");
  assert.equal(cardState("2026-11", [nov, late], false).asOf, late.createdAt);
});

test("card data: a December → January boundary, and a statement file counts like a scrape", () => {
  const dec = batch("2026-12", "2027-01-10T08:00:00.000Z", "xlsx");
  const jan = batch("2027-01", "2027-02-10T08:00:00.000Z", "xlsx");
  assert.equal(cardState("2026-12", [dec, jan], false).state, "complete");
  assert.equal(cardState("2026-12", [jan], false).state, "partial", "the December statement itself is missing");
});
