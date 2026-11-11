import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { assignIds } from "../normalize";
import type { Transaction } from "../types";
import { openDb } from "./index";
import { migrateJson } from "./migrate-json";
import { loadTransactions } from "./transactions";

// A fake data/ folder with the real bug in it: two payments of one purchase that had the same old id.
const dataDir = mkdtempSync(join(tmpdir(), "cal-migrate-"));
after(() => rmSync(dataDir, { recursive: true, force: true }));

const payment = (number: number): Omit<Transaction, "id"> => ({
  date: "2026-06-29", merchant: "ישראייר", amount: 111, currency: "ILS", installments: { number, total: 3 }, source: "scraper",
});
const coffee: Omit<Transaction, "id"> = { date: "2026-09-03", merchant: "ארומה", amount: 18, currency: "ILS", sector: "מסעדות", source: "xlsx" };
const oldIds = (rows: Omit<Transaction, "id">[]) => rows.map((r, i) => ({ id: `old${i}`, ...r })); // ids made by the old scheme
const write = (path: string, data: unknown) => {
  mkdirSync(join(dataDir, path, ".."), { recursive: true });
  writeFileSync(join(dataDir, path), JSON.stringify(data));
};

write("rules.json", { categories: ["מסעדות", "תיירות"], rules: [{ merchant: "ארומה", category: "מסעדות" }] });
write("transactions/2026-08.json", oldIds([payment(2)]));
write("transactions/2026-09.json", oldIds([payment(3), coffee]));
write("proposals/2026-09.json", {
  month: "2026-09",
  createdAt: "2026-10-01T10:00:00.000Z",
  model: "claude-opus-5-5",
  proposals: [{ merchant: "ישראייר", category: "תיירות", confidence: "high", reason: "airline", new_category_idea: null }],
  flags: [{ transaction_id: "old1", severity: "info", explanation: "new", candidate: { reasons: ["new_merchant"] } }],
  reviewed: ["ישראייר"],
});

const count = (db: DatabaseSync, table: string) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;

test("migration keeps every row, with ids from the new scheme, and checks totals", () => {
  const db = openDb(":memory:");
  const r = migrateJson(db, dataDir);
  assert.equal(count(db, "transactions"), 3, "both installment payments survive");
  assert.deepEqual(r.months.map((m) => [m.month, m.rows, m.matches]), [["2026-08", 1, true], ["2026-09", 2, true]]);
  assert.equal(loadTransactions(db, "2026-09")![1].id, assignIds([payment(3), coffee], "2026-09")[1].id);
});

test("rules, proposals and flags come across; flags point to the new transaction ids", () => {
  const db = openDb(":memory:");
  const r = migrateJson(db, dataDir);
  assert.deepEqual([r.categoriesAdded, r.rulesAdded, r.runsAdded, r.proposalsAdded, r.flagsAdded, r.flagsSkipped], [2, 1, 1, 1, 1, 0]);
  assert.equal(db.prepare("SELECT status FROM agent_proposals").get()!.status, "answered");
  const flag = db.prepare("SELECT transaction_id, reasons_json FROM exception_flags").get()!;
  assert.equal(flag.transaction_id, assignIds([payment(3), coffee], "2026-09")[1].id);
  assert.equal(flag.reasons_json, '["new_merchant"]');
});

test("running it twice adds nothing the second time", () => {
  const db = openDb(":memory:");
  migrateJson(db, dataDir);
  const again = migrateJson(db, dataDir);
  assert.ok(again.months.every((m) => m.alreadyImported && m.matches));
  assert.deepEqual([again.categoriesAdded, again.rulesAdded, again.runsAdded, again.proposalsAdded, again.flagsAdded], [0, 0, 0, 0, 0]);
  assert.equal(count(db, "transactions"), 3);
  assert.equal(count(db, "import_batches"), 2);
});

test("without rules.json (a fresh clone), the example file seeds the categories", () => {
  const freshDir = mkdtempSync(join(tmpdir(), "cal-migrate-fresh-"));
  try {
    writeFileSync(join(freshDir, "rules.example.json"), JSON.stringify({ categories: ["פנאי בילוי"], rules: [{ merchant: "NETFLIX.COM", category: "פנאי בילוי" }] }));
    const db = openDb(":memory:");
    const r = migrateJson(db, freshDir);
    assert.deepEqual([r.categoriesAdded, r.rulesAdded], [1, 1]);
  } finally {
    rmSync(freshDir, { recursive: true, force: true });
  }
});

test("a bad rules.json stops the migration and leaves the database empty", () => {
  const badDir = mkdtempSync(join(tmpdir(), "cal-migrate-bad-"));
  try {
    mkdirSync(join(badDir, "transactions"));
    writeFileSync(join(badDir, "transactions", "2026-09.json"), JSON.stringify(oldIds([coffee])));
    writeFileSync(join(badDir, "rules.json"), JSON.stringify({ categories: [], rules: [{ merchant: "x", category: "missing" }] }));
    const db = openDb(":memory:");
    assert.throws(() => migrateJson(db, badDir), /unknown categories/);
    assert.equal(count(db, "transactions"), 0);
  } finally {
    rmSync(badDir, { recursive: true, force: true });
  }
});
