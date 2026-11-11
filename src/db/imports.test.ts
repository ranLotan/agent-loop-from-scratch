import assert from "node:assert/strict";
import { test } from "node:test";
import type { Transaction } from "../types";
import { importBatch, listImportBatches } from "./imports";
import { openDb } from "./index";
import { listMonths, loadTransactions } from "./transactions";

const tx = (id: string, amount = 10): Transaction => ({ id, date: "2026-09-01", merchant: `Shop ${id}`, amount, currency: "ILS", source: "scraper" });
const ids = (rows: Transaction[] | null) => (rows ?? []).map((t) => t.id);

test("the latest import decides the month's rows: added, updated, missing", () => {
  const db = openDb(":memory:");
  const first = importBatch(db, "2026-09", [tx("a"), tx("b")], { source: "scraper" });
  assert.deepEqual([first.added, first.updated, first.missing.length], [2, 0, 0]);

  const second = importBatch(db, "2026-09", [tx("a", 12), tx("c")], { source: "scraper" }); // b is gone, c is new
  assert.deepEqual([second.added, second.updated, ids(second.missing)], [1, 1, ["b"]]);
  assert.deepEqual(ids(loadTransactions(db, "2026-09")), ["a", "c"], "missing rows are left out of reports");
  assert.equal(loadTransactions(db, "2026-09")![0].amount, 12);
});

test("a missing row keeps its edits and comes back if a later import has it again", () => {
  const db = openDb(":memory:");
  importBatch(db, "2026-09", [tx("a"), tx("b")], { source: "scraper" });
  db.prepare("UPDATE transactions SET category_override = 'מסעדות' WHERE id = 'b'").run();
  importBatch(db, "2026-09", [tx("a")], { source: "scraper" });

  const back = importBatch(db, "2026-09", [tx("a"), tx("b")], { source: "scraper" });
  assert.deepEqual([back.added, back.updated], [0, 2], "b was known, so it isn't new");
  assert.deepEqual(ids(loadTransactions(db, "2026-09")), ["a", "b"]);
  assert.equal(db.prepare("SELECT category_override FROM transactions WHERE id = 'b'").get()!.category_override, "מסעדות");
});

test("the same file twice is a duplicate and changes nothing", () => {
  const db = openDb(":memory:");
  const info = { source: "csv" as const, fileName: "sep.csv", fileSha256: "abc" };
  const first = importBatch(db, "2026-09", [tx("a")], info);
  const again = importBatch(db, "2026-09", [tx("x")], info);
  assert.deepEqual([again.duplicate, again.batchId], [true, first.batchId]);
  assert.deepEqual(ids(loadTransactions(db, "2026-09")), ["a"]);
  assert.equal(listImportBatches(db).length, 1);
});

test("a month whose every row went missing disappears from the month list", () => {
  const db = openDb(":memory:");
  importBatch(db, "2026-08", [tx("old")], { source: "scraper" });
  importBatch(db, "2026-09", [tx("a")], { source: "scraper" });
  importBatch(db, "2026-08", [], { source: "scraper" });
  assert.deepEqual(listMonths(db), ["2026-09"]);
});

test("batches are listed newest first, with their checks", () => {
  const db = openDb(":memory:");
  const checks = [{ section: "ILS", currency: "ILS", expected: 10, actual: 10 }];
  importBatch(db, "2026-08", [tx("a")], { source: "xlsx", fileName: "aug.xlsx", fileSha256: "1", checks });
  importBatch(db, "2026-09", [tx("b")], { source: "scraper" });
  const [newest, oldest] = listImportBatches(db);
  assert.deepEqual([newest.source, newest.fileName, newest.checks], ["scraper", null, null]);
  assert.deepEqual([oldest.billingMonth, oldest.txCount, oldest.checks], ["2026-08", 1, checks]);
});
