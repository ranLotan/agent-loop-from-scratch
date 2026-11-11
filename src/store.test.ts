// store.ts against a throwaway in-memory database: the same calls run.ts, approve.ts, the CLI and the API make.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProposalsFile } from "./agent/proposals";
import type { Transaction } from "./types";

process.env.DB_PATH = ":memory:"; // must be set before store.ts opens the database
const store = await import("./store");

const tx = (id: string, date: string, merchant: string, amount: number): Transaction => ({
  id, date, merchant, amount, currency: "ILS", source: "xlsx",
});

test("transactions: import, load, list by year, history", () => {
  store.importTransactions("2025-12", [tx("d", "2025-12-01", "Old", 5)], { source: "xlsx" });
  store.importTransactions("2026-08", [tx("a", "2026-08-01", "Aroma", 18)], { source: "xlsx" });
  store.importTransactions("2026-09", [tx("b", "2026-09-01", "Aroma", 20), tx("c", "2026-09-02", "Shop", 7)], { source: "xlsx" });

  assert.deepEqual(store.loadTransactions("2026-09")!.map((t) => t.id), ["b", "c"]);
  assert.equal(store.loadTransactions("2020-01"), null);
  assert.deepEqual(store.listMonths("2026"), ["2026-08", "2026-09"]);
  assert.deepEqual(store.listAllMonths(), ["2025-12", "2026-08", "2026-09"]);
  assert.deepEqual(store.loadHistory("2026-09").map((t) => t.id), ["d", "a"]);
});

test("rules: categories first, then rules; duplicates skipped; unknown category rejected", () => {
  store.addCategories(["מסעדות", "תיירות"]);
  store.addCategories(["מסעדות"]); // already there
  store.addRules([{ merchant: "Aroma", category: "מסעדות" }]);
  store.addRules([{ merchant: "  AROMA ", category: "תיירות" }]); // same merchant, ignoring case and spaces

  assert.deepEqual(store.loadRules(), {
    categories: ["מסעדות", "תיירות"],
    rules: [{ merchant: "Aroma", category: "מסעדות" }],
  });
  assert.throws(() => store.addRules([{ merchant: "X", category: "no such category" }]), /Unknown category/);
});

test("proposals: the agent saves a run, approve marks items reviewed one by one", () => {
  store.importTransactions("2026-10", [tx("big", "2026-10-05", "Electronics", 4000)], { source: "xlsx" });
  const file: ProposalsFile = {
    month: "2026-10",
    createdAt: "2026-11-01T10:00:00.000Z",
    model: "claude-opus-5-5",
    proposals: [
      { merchant: "Shop", category: "תיירות", confidence: "low", reason: "unclear", new_category_idea: null },
      { merchant: "Aroma", category: "מסעדות", confidence: "high", reason: "a café", new_category_idea: null },
    ],
    flags: [
      {
        transaction_id: "big",
        severity: "warning",
        explanation: "Large charge",
        candidate: { id: "big", date: "2026-10-05", merchant: "Electronics", amount: 4000, currency: "ILS", reasons: ["large"] },
      },
    ],
    reviewed: [],
  };

  store.saveProposals("2026-10", file); // npm run agent
  assert.deepEqual(store.loadProposals("2026-10"), file);

  // npm run approve: push a key, save after every answer, quit, come back later
  const later = store.loadProposals("2026-10")!;
  later.reviewed.push("Aroma");
  store.saveProposals("2026-10", later);
  later.reviewed.push("big");
  store.saveProposals("2026-10", later);

  const resumed = store.loadProposals("2026-10")!;
  assert.deepEqual(resumed.reviewed.sort(), ["Aroma", "big"]);
  assert.equal(resumed.proposals.length, 2, "reviewing doesn't add or drop proposals");
});

test("proposals: the newest run for a month wins; no run → null", () => {
  store.saveProposals("2026-10", {
    month: "2026-10",
    createdAt: "2026-11-02T10:00:00.000Z",
    model: "claude-haiku-5-5",
    proposals: [],
    flags: [],
    reviewed: [],
  });
  assert.equal(store.loadProposals("2026-10")!.model, "claude-haiku-5-5");
  assert.equal(store.loadProposals("2020-01"), null);
});
