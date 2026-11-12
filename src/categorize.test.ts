import assert from "node:assert/strict";
import { test } from "node:test";
import { categorize, validateRules } from "./categorize";
import { summarize } from "./report";
import type { RulesFile, Transaction } from "./types";

const rules: RulesFile = {
  categories: ["מסעדות", "אירועים", "אוכל"],
  rules: [{ merchant: "Aroma", category: "מסעדות" }],
  calRules: [{ sector: "מזון ומשקאות", category: "אוכל" }],
};
const aroma = (over: Partial<Transaction> = {}): Transaction => ({
  id: "a", date: "2026-09-01", merchant: "Aroma", amount: 80, currency: "ILS", sector: "מזון ומשקאות", source: "xlsx", ...over,
});
const sourceOf = (t: Transaction) => {
  const [c] = categorize([t], rules);
  return [c.category, c.categorySource];
};

test("an edit on one transaction beats the merchant's rule and Cal's sector", () => {
  assert.deepEqual(sourceOf(aroma({ categoryOverride: "אירועים" })), ["אירועים", "manual"]);
});

test("an override set by an approved agent proposal is labeled agent", () => {
  assert.deepEqual(sourceOf(aroma({ categoryOverride: "אירועים", overrideSource: "agent" })), ["אירועים", "agent"]);
});

test("without an edit: rule, then the Cal rule for the sector, then nothing", () => {
  assert.deepEqual(sourceOf(aroma()), ["מסעדות", "rule"], "a merchant rule beats the Cal rule");
  assert.deepEqual(sourceOf(aroma({ merchant: "Unknown shop" })), ["אוכל", "cal"]);
  assert.deepEqual(sourceOf(aroma({ merchant: "Unknown shop", sector: undefined })), [null, null]);
});

test("a sector with no Cal rule is uncategorized: Cal's raw name never becomes a category", () => {
  assert.deepEqual(sourceOf(aroma({ merchant: "Unknown shop", sector: "תיירות" })), [null, null]);
});

test("validateRules rejects a Cal rule to an unknown category", () => {
  const bad: RulesFile = { categories: ["אוכל"], rules: [], calRules: [{ sector: "תיירות", category: "nope" }] };
  assert.throws(() => validateRules(bad), /Cal sector "תיירות" → "nope"/);
});

test("a new description doesn't change which rule matches: rules use the bank's merchant name", () => {
  assert.deepEqual(sourceOf(aroma({ descriptionOverride: "Team breakfast" })), ["מסעדות", "rule"]);
});

test("the report counts edited transactions separately", () => {
  const s = summarize(categorize([aroma({ categoryOverride: "אירועים" }), aroma({ id: "b" })], rules));
  assert.deepEqual(s.bySource, { manual: 1, agent: 0, rule: 1, cal: 0, none: 0 });
});
