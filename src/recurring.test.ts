import assert from "node:assert/strict";
import { test } from "node:test";
import { occurrencesFor, shiftMonth, splitDefinition, summarizeRecurring, type RecurringDefinition } from "./recurring";
import type { Transaction } from "./types";

const def = (over: Partial<RecurringDefinition> & Pick<RecurringDefinition, "id" | "name">): RecurringDefinition => ({
  kind: "expense", amount: 100, currency: "ILS", category: null, dayOfMonth: null, startMonth: "2026-01", endMonth: null,
  merchant: null, tolerance: 0.1, previousId: null, ...over,
});
const charge = (id: string, merchant: string, amount: number, currency = "ILS"): Transaction => ({
  id, date: "2026-09-10", merchant, amount, currency, source: "scraper",
});

const salary = def({ id: 1, name: "Salary", kind: "income", amount: 18000 });
const rent = def({ id: 2, name: "Rent", amount: 6500, startMonth: "2026-03", endMonth: "2026-10", dayOfMonth: 31 });
const internet = def({ id: 3, name: "Internet", amount: 120, merchant: "Bezeq Online" });

test("shiftMonth rolls over years", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2025-12", 1), "2026-01");
  assert.equal(shiftMonth("2026-05", 14), "2027-07");
});

test("only definitions active in the month appear; the day is clamped to the month", () => {
  assert.deepEqual(occurrencesFor("2026-02", [salary, rent, internet], [], []).map((o) => o.name), ["Internet", "Salary"]);
  assert.deepEqual(occurrencesFor("2026-11", [rent], [], []), [], "rent ended in October");
  assert.equal(occurrencesFor("2026-04", [rent], [], [])[0].expectedDate, "2026-04-30", "day 31 in a 30-day month");
});

test("outside the card: always counted at the expected amount", () => {
  const [o] = occurrencesFor("2026-09", [salary], [], [charge("x", "Somewhere", 5)]);
  assert.deepEqual([o.paidBy, o.status, o.expectedAmount], ["outside", "expected", 18000]);
});

test("paid by card: matched within the tolerance, closest amount wins, each charge used once", () => {
  const backup = def({ id: 4, name: "Internet (2nd line)", amount: 100, merchant: "bezeq online" });
  const charges = [charge("far", "Bezeq Online", 131), charge("close", "BEZEQ  ONLINE", 118), charge("second", "Bezeq Online", 101)];
  const [first, second] = occurrencesFor("2026-09", [internet, backup], [], charges);
  assert.deepEqual([first.name, first.status, first.transaction?.id], ["Internet", "paid", "close"]);
  assert.deepEqual([second.name, second.status, second.transaction?.id], ["Internet (2nd line)", "paid", "second"]);
});

test("paid by card but no matching charge: not seen (statement imported) or expected (not yet)", () => {
  assert.equal(occurrencesFor("2026-09", [internet], [], [charge("a", "Bezeq Online", 200)])[0].status, "not_seen", "outside the 10% tolerance");
  assert.equal(occurrencesFor("2026-09", [internet], [], [charge("a", "Bezeq Online", 120, "USD")])[0].status, "not_seen", "wrong currency");
  assert.equal(occurrencesFor("2026-12", [internet], [], [])[0].status, "expected", "no statement for the month yet");
});

test("an exception changes or skips one month only", () => {
  const exceptions = [
    { definitionId: 2, month: "2026-05", amount: 6800, skipped: false, note: "raised early" },
    { definitionId: 2, month: "2026-08", amount: null, skipped: true, note: null },
  ];
  const month = (m: string) => occurrencesFor(m, [rent], exceptions, [])[0];
  assert.deepEqual([month("2026-05").expectedAmount, month("2026-05").changed, month("2026-05").note], [6800, true, "raised early"]);
  assert.deepEqual([month("2026-06").expectedAmount, month("2026-06").changed], [6500, false]);
  assert.equal(month("2026-08").status, "skipped");
  const amountChangeMatches = occurrencesFor("2026-09", [internet], [{ definitionId: 3, month: "2026-09", amount: 150, skipped: false, note: null }], [charge("c", "Bezeq Online", 149)]);
  assert.equal(amountChangeMatches[0].status, "paid", "matching uses this month's amount");
});

test("summary: income and outside expenses; card-paid items aren't added (they're in card spending already)", () => {
  const occurrences = occurrencesFor("2026-09", [salary, rent, internet], [], [charge("i", "Bezeq Online", 120)]);
  assert.deepEqual(summarizeRecurring(occurrences), { income: { ILS: 18000 }, outsideExpenses: { ILS: 6500 }, paidByCard: 1, notSeen: 0 });
});

test("'from this month on' ends the old definition and starts a new one; earlier months are unchanged", () => {
  const { ended, next } = splitDefinition(rent, "2026-07", { amount: 7000 });
  assert.deepEqual([ended.startMonth, ended.endMonth, ended.amount], ["2026-03", "2026-06", 6500]);
  assert.deepEqual([next.startMonth, next.endMonth, next.amount, next.previousId], ["2026-07", "2026-10", 7000, 2]);
  const both = [ended, { ...next, id: 9 }];
  assert.equal(occurrencesFor("2026-06", both, [], [])[0].expectedAmount, 6500);
  assert.equal(occurrencesFor("2026-07", both, [], [])[0].expectedAmount, 7000);
  assert.equal(occurrencesFor("2026-07", both, [], []).length, 1, "never both in the same month");
  assert.throws(() => splitDefinition(rent, "2026-03", { amount: 1 }), /edit the definition instead/);
  assert.throws(() => splitDefinition(rent, "2026-11", { amount: 1 }), /already ended/);
});
