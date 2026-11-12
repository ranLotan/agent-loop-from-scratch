// Recurring items through store.ts against a throwaway in-memory database (M5).

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DB_PATH = ":memory:"; // before store.ts opens the database
const store = await import("./store");

store.addCategories(["דיור", "תקשורת ומחשבים"]);
store.importTransactions(
  "2026-09",
  [
    { id: "net", date: "2026-09-14", merchant: "Bezeq Online", amount: 119.9, currency: "ILS", source: "scraper" },
    { id: "food", date: "2026-09-02", merchant: "Supermarket", amount: 400, currency: "ILS", source: "scraper" },
  ],
  { source: "scraper" },
);

const salary = store.createRecurring({ name: "Salary", kind: "income", amount: 18000, startMonth: "2026-01", dayOfMonth: 10 });
const rent = store.createRecurring({ name: "Rent", kind: "expense", amount: 6500, startMonth: "2026-01", category: "דיור" });
const internet = store.createRecurring({
  name: "Internet", kind: "expense", amount: 120, startMonth: "2026-01", category: "תקשורת ומחשבים", merchant: "  bezeq   online ",
});

test("card-paid items match by ledger month: a charge on the 28th, billed next month, pays its own month (M6)", () => {
  store.importTransactions(
    "2027-02",
    [{ id: "net-jan", date: "2027-01-28", merchant: "Bezeq Online", amount: 119.9, currency: "ILS", source: "scraper" }],
    { source: "scraper" },
  );
  const internetIn = (month: string) => store.recurringMonth(month).occurrences.find((o) => o.name === "Internet")!;
  assert.deepEqual([internetIn("2027-01").status, internetIn("2027-01").transaction?.id], ["paid", "net-jan"]);
  assert.notEqual(internetIn("2027-02").status, "paid", "February's statement doesn't pay February's internet");
});

test("a month: card-paid items match their charge; outside items count at their expected amount", () => {
  const { occurrences, summary } = store.recurringMonth("2026-09");
  const byName = Object.fromEntries(occurrences.map((o) => [o.name, o]));
  assert.deepEqual([byName.Internet.status, byName.Internet.transaction?.id], ["paid", "net"]);
  assert.deepEqual([byName.Salary.status, byName.Salary.expectedDate], ["expected", "2026-09-10"]);
  assert.deepEqual(summary, { income: { ILS: 18000 }, outsideExpenses: { ILS: 6500 }, paidByCard: 1, notSeen: 0, awaiting: 0 });
  assert.equal(store.getRecurring(internet.id).merchant, "bezeq online", "spaces cleaned, matching ignores case");
});

test("bad definitions are refused", () => {
  const base = { name: "X", kind: "expense" as const, amount: 10, startMonth: "2026-01" };
  assert.throws(() => store.createRecurring({ ...base, amount: 0 }), store.ValidationError);
  assert.throws(() => store.createRecurring({ ...base, name: " " }), /name is empty/);
  assert.throws(() => store.createRecurring({ ...base, endMonth: "2025-12" }), /end month/);
  assert.throws(() => store.createRecurring({ ...base, category: "no such category" }), /Unknown category/);
  assert.throws(() => store.createRecurring({ ...base, tolerance: 2 }), /tolerance/);
});

test("one month only: change the amount, skip, or go back to normal", () => {
  store.setRecurringMonth(rent.id, "2026-05", { amount: 6800, note: "raised early" });
  store.setRecurringMonth(rent.id, "2026-08", { skipped: true });
  const month = (m: string) => store.recurringMonth(m).occurrences.find((o) => o.name === "Rent")!;
  assert.deepEqual([month("2026-05").expectedAmount, month("2026-05").note], [6800, "raised early"]);
  assert.equal(month("2026-06").expectedAmount, 6500, "other months unchanged");
  assert.equal(month("2026-08").status, "skipped");
  assert.equal(store.recurringMonth("2026-08").summary.outsideExpenses.ILS, undefined, "a skipped month isn't counted");

  assert.equal(store.setRecurringMonth(rent.id, "2026-08", { skipped: false }), null, "back to normal → the exception is removed");
  assert.equal(month("2026-08").status, "expected");
  assert.throws(() => store.setRecurringMonth(rent.id, "2025-06", { amount: 1 }), /doesn't run in 2025-06/);
});

test("'from this month on': earlier months keep the old amount, later exceptions follow the new definition", () => {
  store.setRecurringMonth(rent.id, "2026-11", { note: "pay early" });
  const { ended, created } = store.changeRecurringFrom(rent.id, "2026-10", { amount: 7000 });
  assert.deepEqual([ended.endMonth, created.startMonth, created.amount, created.previousId], ["2026-09", "2026-10", 7000, rent.id]);

  const rentIn = (m: string) => store.recurringMonth(m).occurrences.filter((o) => o.name === "Rent");
  assert.deepEqual(rentIn("2026-05").map((o) => o.expectedAmount), [6800], "May keeps its own change");
  assert.deepEqual(rentIn("2026-09").map((o) => o.expectedAmount), [6500]);
  assert.deepEqual(rentIn("2026-10").map((o) => o.expectedAmount), [7000]);
  assert.deepEqual(rentIn("2026-11").map((o) => [o.expectedAmount, o.note]), [[7000, "pay early"]], "the note moved over");
  assert.throws(() => store.changeRecurringFrom(created.id, "2026-10", { amount: 1 }), store.ValidationError);
});

test("editing applies to every month; setting an end month stops it", () => {
  store.updateRecurring(salary.id, { amount: 19000 });
  assert.equal(store.recurringMonth("2026-02").occurrences.find((o) => o.name === "Salary")!.expectedAmount, 19000);
  store.updateRecurring(salary.id, { endMonth: "2026-06" });
  assert.ok(!store.recurringMonth("2026-07").occurrences.some((o) => o.name === "Salary"));
});

test("deleting removes the definition and its exceptions; a continuation keeps working", () => {
  const continuation = store.listRecurring().find((d) => d.previousId === rent.id)!;
  store.deleteRecurring(rent.id);
  assert.throws(() => store.getRecurring(rent.id), store.NotFoundError);
  assert.equal(store.getRecurring(continuation.id).previousId, null);
  assert.deepEqual(store.recurringMonth("2026-05").occurrences.map((o) => o.name).sort(), ["Internet", "Salary"]);
});
