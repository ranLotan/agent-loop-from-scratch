import assert from "node:assert/strict";
import { test } from "node:test";
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

test("reviews uncategorized and vague-Cal-sector merchants, once each", () => {
  const rules: RulesFile = { categories: ["שונות", "מסעדות"], rules: [] };
  const txs = [tx("A"), tx("B", "שונות"), tx("C", "מסעדות"), tx("A")];
  assert.deepEqual(merchantsToReview(txs, rules, 10), ["A", "B"]);
});

test("a rule to a vague category is the owner's decision → not reviewed again", () => {
  const rules: RulesFile = { categories: ["שונות", "מוסדות"], rules: [{ merchant: "Bank fee", category: "שונות" }] };
  assert.deepEqual(merchantsToReview([tx("Bank fee", "שונות"), tx("City", "מוסדות")], rules, 10), ["City"]);
});
