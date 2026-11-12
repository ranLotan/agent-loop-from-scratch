import assert from "node:assert/strict";
import { test } from "node:test";
import { occurrencesFor, shiftMonth, splitDefinition, summarizeRecurring, type RecurringDefinition } from "./recurring";
import type { Transaction } from "./types";

const def = (over: Partial<RecurringDefinition> & Pick<RecurringDefinition, "id" | "name">): RecurringDefinition => ({
  kind: "expense", amount: 100, currency: "ILS", category: null, dayOfMonth: null, startMonth: "2026-01", endMonth: null,
  merchant: null, tolerance: 0.1, previousId: null, confirmMode: "auto", ...over,
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
  assert.deepEqual(summarizeRecurring(occurrences), { income: { ILS: 18000 }, outsideExpenses: { ILS: 6500 }, paidByCard: 1, notSeen: 0, awaiting: 0 });
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

// ---------- M6: confirm mode ----------

const gas = def({ id: 7, name: "Gas", amount: 200, confirmMode: "confirm" });
const confirmed = (month: string, amount: number, definitionId = 7) =>
  ({ definitionId, month, amount, skipped: false, note: null, confirmedAt: `${month}-20T10:00:00.000Z` });

test("auto: counted at the expected amount, and the suggestion is that same amount", () => {
  const [o] = occurrencesFor("2026-09", [salary], [], []);
  assert.deepEqual([o.status, o.expectedAmount, o.suggestedAmount, o.confirmMode], ["expected", 18000, 18000, "auto"]);
});

test("confirm, not confirmed: awaiting and NOT counted; suggests the definition's amount the first time", () => {
  const occurrences = occurrencesFor("2026-09", [gas], [], []);
  assert.deepEqual([occurrences[0].status, occurrences[0].suggestedAmount, occurrences[0].expectedAmount], ["awaiting_confirmation", 200, 200]);
  assert.deepEqual(summarizeRecurring(occurrences), { income: {}, outsideExpenses: {}, paidByCard: 0, notSeen: 0, awaiting: 1 });
});

test("confirm, confirmed: counted at the confirmed amount", () => {
  const occurrences = occurrencesFor("2026-09", [gas], [confirmed("2026-09", 243.5)], []);
  assert.deepEqual([occurrences[0].status, occurrences[0].expectedAmount], ["expected", 243.5]);
  assert.deepEqual(summarizeRecurring(occurrences).outsideExpenses, { ILS: 243.5 });
});

test("the suggestion is the most recent confirmed amount before the month, across a gap of months", () => {
  const exceptions = [confirmed("2026-05", 180), confirmed("2026-07", 230), confirmed("2026-10", 999)];
  assert.equal(occurrencesFor("2026-09", [gas], exceptions, [])[0].suggestedAmount, 230, "July, skipping unconfirmed August; October is later");
  const unconfirmedAmount = { definitionId: 7, month: "2026-08", amount: 500, skipped: false, note: null };
  assert.equal(occurrencesFor("2026-09", [gas], [...exceptions, unconfirmedAmount], [])[0].suggestedAmount, 230, "an unconfirmed amount doesn't count");
  assert.equal(occurrencesFor("2026-08", [gas], [unconfirmedAmount], [])[0].suggestedAmount, 500, "this month's own amount wins");
});

test("the suggestion follows a 'from this month on' split back to the earlier definition", () => {
  const { ended, next } = splitDefinition(gas, "2026-09", { amount: 250 });
  const both = [ended, { ...next, id: 8 }];
  assert.equal(occurrencesFor("2026-09", both, [confirmed("2026-08", 215)], [])[0].suggestedAmount, 215);
  assert.equal(occurrencesFor("2026-09", both, [], [])[0].suggestedAmount, 250, "never confirmed: the new definition's amount");
});

test("skipped beats awaiting; a card-paid item ignores confirm mode", () => {
  const skipped = { definitionId: 7, month: "2026-09", amount: null, skipped: true, note: null };
  assert.equal(occurrencesFor("2026-09", [gas], [skipped], [])[0].status, "skipped");
  const cardGas = def({ id: 9, name: "Card gas", amount: 100, merchant: "Super Gas", confirmMode: "confirm" });
  assert.equal(occurrencesFor("2026-09", [cardGas], [], [charge("g", "Super Gas", 100)])[0].status, "paid");
});
