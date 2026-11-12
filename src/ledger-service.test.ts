// M6 acceptance scenario through the real store (in-memory DB): monthLedger, ledgerTrend, monthStatus.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Transaction } from "./types";

process.env.DB_PATH = ":memory:"; // before store.ts opens the database
const store = await import("./store");
const { ledgerTrend, monthLedger, monthStatus } = await import("./ledger-service");

const tx = (id: string, date: string, merchant: string, amount: number, over: Partial<Transaction> = {}): Transaction => ({
  id, date, merchant, amount, currency: "ILS", source: "scraper", ...over,
});

store.addCategories(["מזון", "דיור", "תקשורת", "רהיטים"]);
store.setRule("Supermarket", "מזון");
// The October statement holds September's late purchases; the September statement holds early ones.
store.importTransactions("2026-09", [tx("food1", "2026-09-02", "Supermarket", 400)], { source: "scraper" });
store.importTransactions(
  "2026-10",
  [
    tx("food2", "2026-09-27", "Supermarket", 300),
    tx("net", "2026-09-14", "Bezeq Online", 120),
    tx("sofa3", "2026-07-20", "Sofa Shop", 1000, { installments: { number: 3, total: 3 } }), // 3rd of 3: counts in September
    tx("oct", "2026-10-03", "Supermarket", 55),
  ],
  { source: "scraper" },
);
store.createRecurring({ name: "Salary", kind: "income", amount: 18000, startMonth: "2026-01" });
const gas = store.createRecurring({ name: "Gas", kind: "expense", amount: 250, startMonth: "2026-01", confirmMode: "confirm", category: "דיור" });
store.createRecurring({ name: "Internet", kind: "expense", amount: 120, startMonth: "2026-01", merchant: "Bezeq Online", category: "תקשורת" });
store.createManualEntry({ date: "2026-09-05", name: "Boiler repair", kind: "expense", amount: 850, category: "דיור" });

test("acceptance: September's income, expenses and Net, with the gas bill waiting and not counted", () => {
  const { summary, entries } = monthLedger("2026-09");
  assert.deepEqual([summary.income, summary.expenses, summary.net], [18000, 2670, 15330]);
  assert.deepEqual(summary.awaiting, { count: 1, expectedIncome: 0, expectedExpenses: 250 });
  assert.equal(entries.filter((e) => e.name.includes("Bezeq") || e.name === "Internet").length, 1, "internet counted once");
  assert.ok(entries.some((e) => e.ref === "sofa3"), "an installment payment counts in purchase month + (N − 1)");
  assert.ok(!entries.some((e) => e.ref === "oct"), "an October purchase on the same statement isn't September's");
  // Bezeq and the sofa have no rule and no Cal sector: their own "Uncategorized" bucket, not dropped.
  assert.deepEqual(summary.byCategory, [
    { category: "Uncategorized", amount: 1120 },
    { category: "דיור", amount: 850 },
    { category: "מזון", amount: 700 },
  ]);
  assert.equal(summary.pie.reduce((sum, s) => sum + s.amount, 0), summary.expenses, "the pie adds up to the month's expenses");
});

test("acceptance: confirming the gas bill updates Net, and next month suggests that amount", () => {
  store.confirmRecurringMonth(gas.id, "2026-09", 243.5);
  assert.deepEqual([monthLedger("2026-09").summary.net, monthLedger("2026-09").summary.awaiting.count], [15086.5, 0]);
  const october = monthLedger("2026-10").entries.find((e) => e.name === "Gas")!;
  assert.deepEqual([october.status, october.amount], ["awaiting_confirmation", 243.5]);
});

test("pending charges count in their purchase month", () => {
  store.importScrape("2026-11", [], [{ date: "2026-11-08", merchant: "Supermarket", amount: 90, currency: "ILS", source: "scraper" }]);
  const { summary } = monthLedger("2026-11");
  assert.deepEqual(summary.pendingCard, { count: 1, amount: 90 });
  assert.equal(summary.byCategory.find((c) => c.category === "מזון")?.amount, 90, "categorized by the rule like billed rows");
});

test("trend: n months ending with the given one, oldest first", () => {
  const trend = ledgerTrend("2026-10", 3);
  assert.deepEqual(trend.map((p) => p.month), ["2026-08", "2026-09", "2026-10"]);
  assert.equal(trend[1].net, 15086.5);
  assert.equal(trend[2].awaiting, 1, "October's gas bill is still waiting");
});

test("month status: card data, review and manual steps, and the next step to do", () => {
  const sep = monthStatus("2026-09");
  assert.deepEqual(sep.card.statements, [{ month: "2026-09", imported: true }, { month: "2026-10", imported: true }]);
  assert.equal(sep.manual.awaiting, 0, "gas confirmed");
  // The October statement was imported "now" (2026, long after Oct 4), so September is complete.
  assert.equal(sep.card.state, "complete");
  assert.equal(sep.review.byHand, 0);
  assert.equal(sep.next, null);

  // The November scrape above ran after Nov 4, so October's card data is complete; its gas bill isn't.
  const oct = monthStatus("2026-10");
  assert.deepEqual([oct.card.state, oct.manual.awaiting, oct.next], ["complete", 1, "manual"]);

  const dec = monthStatus("2026-12");
  assert.deepEqual([dec.card.state, dec.next], ["missing", "card"]);
  assert.equal(sep.review.statement, null, "nothing pending");
});

test("review status names the statement that has the pending items (Review works per statement)", () => {
  // A pending proposal on the October statement: mostly September purchases.
  store.saveProposals("2026-10", {
    month: "2026-10", createdAt: "2026-10-31T00:00:00Z", model: "fake", reviewed: [], flags: [],
    proposals: [{ merchant: "Some Shop", category: "מזון", confidence: "low", reason: "Unclear." }],
  });
  const sep = monthStatus("2026-09");
  assert.deepEqual([sep.review.proposals, sep.review.statement, sep.next], [1, "2026-10", "review"]);
  assert.equal(monthStatus("2026-10").review.statement, "2026-10", "October's own statement");
  assert.equal(monthStatus("2026-08").review.statement, null, "the August and September statements have nothing pending");
});
