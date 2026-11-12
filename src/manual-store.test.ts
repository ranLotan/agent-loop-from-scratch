// M6 step 6.3 through store.ts: confirm mode and one-time entries, against a throwaway in-memory database.

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DB_PATH = ":memory:"; // before store.ts opens the database
const store = await import("./store");

store.addCategories(["דיור", "מתנות"]);

test("a new definition is auto unless it says otherwise (like every M5 definition after migration 006)", () => {
  const salary = store.createRecurring({ name: "Salary", kind: "income", amount: 18000, startMonth: "2026-01" });
  assert.equal(salary.confirmMode, "auto");
});

test("confirm mode is refused for card-paid and non-shekel items", () => {
  const base = { name: "X", kind: "expense" as const, amount: 10, startMonth: "2026-01", confirmMode: "confirm" as const };
  assert.throws(() => store.createRecurring({ ...base, merchant: "Super Gas" }), /card charge is the confirmation/);
  assert.throws(() => store.createRecurring({ ...base, currency: "USD" }), /ILS/);
  assert.throws(() => store.createRecurring({ ...base, confirmMode: "sometimes" as never }), store.ValidationError);
});

test("confirm a month, then the next month suggests it; unconfirm puts it back to waiting", () => {
  const gas = store.createRecurring({ name: "Gas", kind: "expense", amount: 200, startMonth: "2026-01", confirmMode: "confirm" });
  const gasIn = (month: string) => store.recurringMonth(month).occurrences.find((o) => o.definitionId === gas.id)!;
  assert.equal(gasIn("2026-09").status, "awaiting_confirmation");

  const exception = store.confirmRecurringMonth(gas.id, "2026-09", 243.5);
  assert.ok(exception.confirmedAt);
  assert.deepEqual([gasIn("2026-09").status, gasIn("2026-09").expectedAmount], ["expected", 243.5]);
  assert.deepEqual([gasIn("2026-10").status, gasIn("2026-10").suggestedAmount], ["awaiting_confirmation", 243.5]);

  store.setRecurringMonth(gas.id, "2026-09", { note: "winter" }); // a note doesn't undo the confirmation
  assert.equal(gasIn("2026-09").status, "expected");

  store.unconfirmRecurringMonth(gas.id, "2026-09");
  assert.deepEqual([gasIn("2026-09").status, gasIn("2026-09").suggestedAmount, gasIn("2026-09").note], ["awaiting_confirmation", 200, "winter"]);
});

test("only confirm-mode items can be confirmed, at a positive amount, in a month they run", () => {
  const rent = store.createRecurring({ name: "Rent", kind: "expense", amount: 6500, startMonth: "2026-01", endMonth: "2026-06" });
  assert.throws(() => store.confirmRecurringMonth(rent.id, "2026-03", 6500), /isn't in confirm mode/);
  const water = store.createRecurring({ name: "Water", kind: "expense", amount: 90, startMonth: "2026-01", endMonth: "2026-06", confirmMode: "confirm" });
  assert.throws(() => store.confirmRecurringMonth(water.id, "2026-03", 0), /positive/);
  assert.throws(() => store.confirmRecurringMonth(water.id, "2026-09", 80), /doesn't run in 2026-09/);
});

test("one-time entries: create, list by month, edit directly, delete", () => {
  const gift = store.createManualEntry({ date: "2026-09-14", name: "  Birthday   gift ", kind: "income", amount: 500 });
  const repair = store.createManualEntry({ date: "2026-09-02", name: "Boiler repair", kind: "expense", amount: 850, category: "דיור", note: "plumber" });
  store.createManualEntry({ date: "2026-10-01", name: "Other month", kind: "expense", amount: 1 });

  assert.deepEqual(store.listManualEntries("2026-09").map((e) => e.name), ["Boiler repair", "Birthday gift"]);
  assert.deepEqual([repair.category, repair.note, repair.currency], ["דיור", "plumber", "ILS"]);

  const edited = store.updateManualEntry(gift.id, { amount: 650, category: "מתנות" });
  assert.deepEqual([edited.amount, edited.category, edited.name], [650, "מתנות", "Birthday gift"]);
  store.deleteManualEntry(gift.id);
  assert.deepEqual(store.listManualEntries("2026-09").map((e) => e.name), ["Boiler repair"]);
  assert.throws(() => store.deleteManualEntry(gift.id), store.NotFoundError);
});

test("one-time entries: bad input is refused", () => {
  const base = { date: "2026-09-14", name: "X", kind: "expense" as const, amount: 10 };
  assert.throws(() => store.createManualEntry({ ...base, date: "2026-02-30" }), /date/);
  assert.throws(() => store.createManualEntry({ ...base, name: "  " }), /name is empty/);
  assert.throws(() => store.createManualEntry({ ...base, amount: -5 }), /positive/);
  assert.throws(() => store.createManualEntry({ ...base, kind: "refund" as never }), /kind/);
  assert.throws(() => store.createManualEntry({ ...base, category: "nope" }), /Unknown category/);
  assert.throws(() => store.createManualEntry({ ...base, currency: "USD" } as never), /ILS/);
});
