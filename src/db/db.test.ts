import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Transaction } from "../types";
import { inTransaction, openDb, runMigrations } from "./index";
import { listMonths, loadTransactions, upsertTransactions } from "./transactions";

const FULL: Transaction = {
  id: "full",
  date: "2026-06-29",
  merchant: "ישראייר",
  amount: 111,
  currency: "ILS",
  originalAmount: 333,
  originalCurrency: "ILS",
  type: "תשלומים",
  installments: { number: 3, total: 3 },
  sector: "תיירות",
  memo: "תשלום 3 מתוך 3",
  card: "7187",
  source: "scraper",
};
const MINIMAL: Transaction = { id: "min", date: "2026-09-02", merchant: "Shop", amount: 10, currency: "ILS", source: "csv" };

const count = (db: DatabaseSync, table: string) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;

test("migrations run once and are safe to repeat", () => {
  const files = readdirSync(new URL("./migrations", import.meta.url)).filter((f) => f.endsWith(".sql"));
  const db = openDb(":memory:");
  runMigrations(db);
  assert.equal(count(db, "schema_version"), files.length);
});

test("foreign keys are enforced", () => {
  const db = openDb(":memory:");
  assert.throws(() =>
    db.prepare("INSERT INTO merchant_rules (merchant, normalized_merchant, category_id, created_from, created_at) VALUES ('a', 'A', 999, 'seed', 'now')").run(),
  );
});

test("the same file can't be imported twice, but scrapes without a file can repeat", () => {
  const db = openDb(":memory:");
  const add = db.prepare("INSERT INTO import_batches (source, file_sha256, billing_month, tx_count, created_at) VALUES ('xlsx', ?, '2026-09', 1, 'now')");
  add.run("abc");
  assert.throws(() => add.run("abc"));
  add.run(null);
  add.run(null);
  assert.equal(count(db, "import_batches"), 3);
});

test("a failed transaction leaves nothing behind", () => {
  const db = openDb(":memory:");
  assert.throws(
    () =>
      inTransaction(db, () => {
        db.exec("INSERT INTO categories (name, origin, created_at) VALUES ('x', 'seed', 'now')");
        assert.equal(count(db, "categories"), 1);
        throw new Error("boom");
      }),
    /boom/,
  );
  assert.equal(count(db, "categories"), 0);
});

test("a Transaction survives the round trip, in statement order", () => {
  const db = openDb(":memory:");
  upsertTransactions(db, "2026-09", [FULL, MINIMAL], null);
  assert.deepEqual(loadTransactions(db, "2026-09"), [FULL, MINIMAL]);
});

test("months: listed oldest first, null when never imported", () => {
  const db = openDb(":memory:");
  upsertTransactions(db, "2026-09", [MINIMAL], null);
  upsertTransactions(db, "2026-08", [FULL], null);
  assert.deepEqual(listMonths(db), ["2026-08", "2026-09"]);
  assert.equal(loadTransactions(db, "2020-01"), null);
});

test("re-importing a month updates rows instead of duplicating them", () => {
  const db = openDb(":memory:");
  upsertTransactions(db, "2026-09", [MINIMAL], null);
  upsertTransactions(db, "2026-09", [{ ...MINIMAL, memo: "fresh from the bank" }], null);
  assert.equal(count(db, "transactions"), 1);
  assert.equal(loadTransactions(db, "2026-09")![0].memo, "fresh from the bank");
});

test("re-importing keeps the owner's edits", () => {
  const db = openDb(":memory:");
  upsertTransactions(db, "2026-09", [MINIMAL], null);
  db.prepare("UPDATE transactions SET category_override = 'מסעדות', description_override = 'Dinner', override_source = 'manual' WHERE id = 'min'").run();

  upsertTransactions(db, "2026-09", [MINIMAL], null);

  const row = db.prepare("SELECT category_override, description_override, override_source FROM transactions WHERE id = 'min'").get()!;
  assert.deepEqual({ ...row }, { category_override: "מסעדות", description_override: "Dinner", override_source: "manual" });
});
