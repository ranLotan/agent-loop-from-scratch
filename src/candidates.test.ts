import assert from "node:assert/strict";
import { test } from "node:test";
import { findCandidates } from "./candidates";
import type { Transaction } from "./types";

let n = 0;
const tx = (merchant: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  date: "2026-10-01",
  merchant,
  amount,
  currency: "ILS",
  source: "csv",
  ...extra,
});

const reasonsOf = (cands: ReturnType<typeof findCandidates>) =>
  Object.fromEntries(cands.map((c) => [c.merchant, c.reasons]));

test("flags large, foreign, new merchant, new standing order and duplicates", () => {
  const history = [tx("שופרסל", 300), tx("Netflix", 50)];
  const month = [
    tx("שופרסל", 2000), //                                  large (known merchant)
    tx("Netflix", 400, { currency: "USD" }), //             foreign
    tx("חנות חדשה", 800), //                                new merchant
    tx("חנות קטנה", 40), //                                 new but small: not a candidate
    tx("ביטוח חדש", 120, { type: "הוראת קבע" }), //         new standing order
    tx("קפה", 18, { date: "2026-10-05" }),
    tx("קפה", 18, { date: "2026-10-05" }), //               duplicate pair: flagged at any amount
    tx("Netflix", 50), //                                   ordinary: not a candidate
  ];
  const r = reasonsOf(findCandidates(month, history));

  assert.deepEqual(r["שופרסל"], ["large"]);
  assert.deepEqual(r["Netflix"], ["foreign_currency"]);
  assert.deepEqual(r["חנות חדשה"], ["new_merchant"]);
  assert.deepEqual(r["ביטוח חדש"], ["new_standing_order"]);
  assert.deepEqual(r["קפה"], ["possible_duplicate"]);
  assert.equal(r["חנות קטנה"], undefined);
  assert.equal(findCandidates(month, history).filter((c) => c.merchant === "Netflix").length, 1);
});

test("no history → no 'new' flags; refunds are never 'large'", () => {
  const r = reasonsOf(findCandidates([tx("חנות", 800), tx("החזר", -3000)], []));
  assert.deepEqual(r, {});
});

test("threshold is configurable", () => {
  const cands = findCandidates([tx("חנות", 600)], [tx("חנות", 1)], { largeAmount: 500 });
  assert.deepEqual(cands[0].reasons, ["large"]);
});
