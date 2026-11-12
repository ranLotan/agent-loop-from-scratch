// M6 step 6.2: ledger month in the database, and pending charges replaced on every scrape.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Transaction } from "../types";
import { importBatch, importScrape } from "./imports";
import { openDb } from "./index";
import { listPending } from "./pending";
import { backfillLedgerMonths, searchTransactions } from "./transactions";

const tx = (id: string, date: string, over: Partial<Transaction> = {}): Transaction => ({
  id, date, merchant: `Shop ${id}`, amount: 10, currency: "ILS", source: "scraper", ...over,
});
const charge = (merchant: string, date: string): Omit<Transaction, "id"> => ({ date, merchant, amount: 50, currency: "ILS", source: "scraper" });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

test("imports store the ledger month; search can filter by it instead of the billing month", () => {
  const db = openDb(":memory:");
  // Billed in October: one September purchase, one October purchase, and payment 3 of a July purchase.
  importBatch(db, "2026-10", [tx("sep", "2026-09-25"), tx("oct", "2026-10-02"), tx("inst", "2026-07-15", { installments: { number: 3, total: 6 } })], { source: "scraper" });
  importBatch(db, "2026-09", [tx("early", "2026-09-03")], { source: "scraper" });

  assert.deepEqual(ids(searchTransactions(db, { from: "2026-10", to: "2026-10" })), ["sep", "oct", "inst"], "by billing month (default)");
  assert.deepEqual(ids(searchTransactions(db, { from: "2026-09", to: "2026-09", by: "ledger" })), ["inst", "early", "sep"], "from two statements, by purchase date (the installment's purchase was in July)");
  const sep = searchTransactions(db, { by: "ledger" }).find((t) => t.id === "sep")!;
  assert.deepEqual([sep.billingMonth, sep.ledgerMonth], ["2026-10", "2026-09"]);
});

test("backfill fills rows imported before migration 005, and is a no-op afterwards", () => {
  const db = openDb(":memory:");
  importBatch(db, "2026-10", [tx("a", "2026-09-25"), tx("b", "2026-08-01", { installments: { number: 2, total: 2 } })], { source: "scraper" });
  db.exec("UPDATE transactions SET ledger_month = NULL"); // what an M5 database looks like after the migration
  assert.equal(backfillLedgerMonths(db), 2);
  assert.deepEqual(searchTransactions(db, { by: "ledger" }).map((t) => [t.id, t.ledgerMonth]), [["b", "2026-09"], ["a", "2026-09"]]);
  assert.equal(backfillLedgerMonths(db), 0);
});

test("a scrape replaces the whole pending list: a charge that got billed is never counted twice", () => {
  const db = openDb(":memory:");
  importScrape(db, "2026-11", [], [charge("Cafe", "2026-11-10"), charge("Books", "2026-11-11")]);
  assert.deepEqual(listPending(db, "2026-11").map((p) => p.merchant), ["Cafe", "Books"]);

  // Next scrape: Cafe was billed (now a normal row, its date even moved a day), Books is still pending.
  importScrape(db, "2026-11", [tx("cafe", "2026-11-09", { merchant: "Cafe", amount: 50 })], [charge("Books", "2026-11-11")]);
  assert.deepEqual(listPending(db).map((p) => p.merchant), ["Books"]);
  const cafeRows = searchTransactions(db, { from: "2026-11", to: "2026-11", by: "ledger" }).filter((t) => t.merchant === "Cafe");
  assert.equal(cafeRows.length + listPending(db).filter((p) => p.merchant === "Cafe").length, 1);
});

test("pending charges: ledger month filter, scrape time, and a file import leaves them alone", () => {
  const db = openDb(":memory:");
  importScrape(db, "2026-11", [], [charge("Late October", "2026-10-31"), charge("Cafe", "2026-11-10")]);
  const [cafe] = listPending(db, "2026-11");
  assert.deepEqual([cafe.merchant, cafe.ledgerMonth, cafe.pending, cafe.id.startsWith("pending-")], ["Cafe", "2026-11", true, true]);
  assert.ok(cafe.scrapedAt);

  importBatch(db, "2026-10", [tx("x", "2026-10-01")], { source: "xlsx", fileSha256: "f" });
  assert.equal(listPending(db).length, 2, "an Excel/CSV statement has no pending rows, so it doesn't clear them");
});

test("a failed scrape import keeps the previous pending list", () => {
  const db = openDb(":memory:");
  importScrape(db, "2026-11", [], [charge("Cafe", "2026-11-10")]);
  const broken = { ...charge("Bad", "2026-11-12"), merchant: null as unknown as string }; // NOT NULL fails mid-insert
  assert.throws(() => importScrape(db, "2026-11", [], [charge("New", "2026-11-11"), broken]));
  assert.deepEqual(listPending(db).map((p) => p.merchant), ["Cafe"], "all or nothing");
});
