import assert from "node:assert/strict";
import { test } from "node:test";
import { MANUAL_CATEGORY } from "../categorize";
import type { RulesFile, Transaction } from "../types";
import { merchantsToReview } from "./merchants";

const tx = (merchant: string, sector?: string): Transaction => ({
  id: merchant,
  date: "2026-10-01",
  merchant,
  amount: 10,
  currency: "ILS",
  sector,
  source: "csv",
});

test("reviews uncategorized merchants, including unmapped sectors, once each", () => {
  const rules: RulesFile = { categories: ["מסעדות"], rules: [], calRules: [{ sector: "מסעדות", category: "מסעדות" }] };
  const txs = [tx("A"), tx("B", "שונות"), tx("C", "מסעדות"), tx("A")];
  assert.deepEqual(merchantsToReview(txs, rules, 10), ["A", "B"]);
});

test("a rule or a Cal rule is the owner's decision → not reviewed, even to a vague category", () => {
  const rules: RulesFile = {
    categories: [MANUAL_CATEGORY, "שונות"],
    rules: [{ merchant: "Bank fee", category: "שונות" }],
    calRules: [{ sector: "שונות", category: MANUAL_CATEGORY }], // vague sector → wait for my edit
  };
  const txs = [tx("Bank fee", "מוסדות"), tx("Misc shop", "שונות"), tx("City", "מוסדות")];
  assert.deepEqual(merchantsToReview(txs, rules, 10), ["City"]);
});
