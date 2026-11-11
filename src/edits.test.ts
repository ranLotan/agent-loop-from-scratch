// Editing from the dashboard (M3), through store.ts against a throwaway in-memory database.

import assert from "node:assert/strict";
import { test } from "node:test";
import { categorize } from "./categorize";
import type { Transaction } from "./types";

process.env.DB_PATH = ":memory:"; // before store.ts opens the database
const store = await import("./store");

const tx = (id: string, merchant: string, over: Partial<Transaction> = {}): Transaction => ({
  id, date: "2026-09-01", merchant, amount: 50, currency: "ILS", sector: "מזון ומשקאות", source: "xlsx", ...over,
});
const categorized = (month: string) => categorize(store.loadTransactions(month)!, store.loadRules());
const byId = (month: string, id: string) => categorized(month).find((t) => t.id === id)!;

store.addCategories(["מסעדות", "אירועים", "שונות"]);
store.importTransactions("2026-09", [tx("a1", "Aroma"), tx("a2", "Aroma"), tx("s1", "Shufersal")], { source: "xlsx" });
store.importTransactions("2026-08", [tx("old", "Aroma", { date: "2026-08-03" })], { source: "xlsx" });

test("editing a category: it wins, it's labeled manual, and a re-import keeps it", () => {
  store.editTransaction("a1", { category: "אירועים", description: "Team breakfast" });
  assert.deepEqual([byId("2026-09", "a1").category, byId("2026-09", "a1").categorySource], ["אירועים", "manual"]);
  assert.equal(byId("2026-09", "a1").descriptionOverride, "Team breakfast");

  store.importTransactions("2026-09", [tx("a1", "Aroma"), tx("a2", "Aroma"), tx("s1", "Shufersal")], { source: "scraper" });
  assert.equal(byId("2026-09", "a1").category, "אירועים", "a re-import never touches your edits");
});

test("clearing an edit (null) brings back Cal's sector", () => {
  store.editTransaction("s1", { category: "שונות" });
  store.editTransaction("s1", { category: null });
  assert.deepEqual([byId("2026-09", "s1").category, byId("2026-09", "s1").categorySource], ["מזון ומשקאות", "cal"]);
});

test("'make it a rule': every charge of the merchant follows, in every month", () => {
  store.editTransaction("a2", { category: "מסעדות", description: "Coffee" }, { createRule: true });
  const a2 = byId("2026-09", "a2");
  assert.deepEqual([a2.category, a2.categorySource, a2.descriptionOverride], ["מסעדות", "rule", "Coffee"]);
  assert.equal(byId("2026-08", "old").categorySource, "rule", "last month's Aroma follows the rule too");
  assert.equal(byId("2026-09", "a1").categorySource, "manual", "a charge you edited by hand keeps your edit");
});

test("bad edits are refused", () => {
  assert.throws(() => store.editTransaction("a1", { category: "no such category" }), /Unknown category/);
  assert.throws(() => store.editTransaction("nope", { category: "שונות" }), store.NotFoundError);
  assert.throws(() => store.editTransaction("a1", { category: null }, { createRule: true }), /Pick a category/);
});

test("search: across months, by merchant or your description, ignoring case; % has no special meaning", () => {
  assert.deepEqual(store.searchTransactions({ q: "aroma" }).map((t) => t.id), ["a1", "a2", "old"]);
  assert.deepEqual(store.searchTransactions({ q: "BREAKFAST" }).map((t) => t.id), ["a1"]);
  assert.deepEqual(store.searchTransactions({ from: "2026-09", q: "aroma" }).map((t) => t.billingMonth), ["2026-09", "2026-09"]);
  assert.deepEqual(store.searchTransactions({ q: "%" }), []);
});

test("rules: set creates or updates (ignoring case and spaces), update and delete by id", () => {
  const rule = store.setRule("  shufersal ", "שונות");
  assert.equal(store.setRule("SHUFERSAL", "מסעדות").id, rule.id, "same merchant → same rule, new category");
  assert.equal(store.updateRule(rule.id, "אירועים").category, "אירועים");
  store.deleteRule(rule.id);
  assert.throws(() => store.deleteRule(rule.id), store.NotFoundError);
  assert.throws(() => store.setRule("X", "no such category"), /Unknown category/);
});

test("categories: rename follows rules and edits; a category in use can't be deleted", () => {
  const events = store.listCategories().find((c) => c.name === "אירועים")!;
  assert.ok(events.edits >= 1);
  store.renameCategory(events.id, "אירועים ושמחות");
  assert.equal(byId("2026-09", "a1").category, "אירועים ושמחות", "the edit follows the rename");
  assert.throws(() => store.deleteCategory(events.id), store.ConflictError);

  const spare = store.addCategory("  זמני ");
  assert.equal(spare.name, "זמני");
  assert.throws(() => store.addCategory("זמני"), store.ConflictError);
  store.deleteCategory(spare.id);
  assert.ok(!store.listCategories().some((c) => c.name === "זמני"));
});
