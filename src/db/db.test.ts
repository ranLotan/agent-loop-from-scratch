import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Transaction } from "../types";
import { inTransaction, openDb, runMigrations } from "./index";
import {
  addCategories, deleteCategory, formatRulesFile, listCalRules, listCaps, listCategories, loadRules, renameCategory, setCalRule, setCaps,
} from "./rules";
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
  const before = Number(count(db, "categories")); // the built-in by-hand category is already there
  assert.throws(
    () =>
      inTransaction(db, () => {
        db.exec("INSERT INTO categories (name, origin, created_at) VALUES ('x', 'seed', 'now')");
        assert.equal(count(db, "categories"), before + 1);
        throw new Error("boom");
      }),
    /boom/,
  );
  assert.equal(count(db, "categories"), before, "the insert was rolled back");
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

test("Cal rules: every seen sector listed with its count; set, change and remove; category guards", () => {
  const db = openDb(":memory:");
  upsertTransactions(db, "2026-09", [FULL, { ...FULL, id: "full2" }, { ...MINIMAL, sector: "מסעדות" }, { ...MINIMAL, id: "none" }], null);
  addCategories(db, ["חופשות", "טיולים"], "owner");

  assert.deepEqual(listCalRules(db), [
    { sector: "מסעדות", category: null, count: 1 },
    { sector: "תיירות", category: null, count: 2 },
  ]);

  setCalRule(db, "תיירות", "חופשות");
  setCalRule(db, "תיירות", "טיולים"); // changing it is an upsert, not a second rule
  setCalRule(db, "ענף שנעלם", "חופשות"); // a rule whose sector no charge has still shows, with 0
  assert.deepEqual(loadRules(db).calRules, [
    { sector: "תיירות", category: "טיולים" },
    { sector: "ענף שנעלם", category: "חופשות" },
  ]);
  assert.deepEqual(listCalRules(db).map((r) => [r.sector, r.category, r.count]), [
    ["מסעדות", null, 1],
    ["ענף שנעלם", "חופשות", 0],
    ["תיירות", "טיולים", 2],
  ]);

  assert.throws(() => setCalRule(db, "תיירות", "nope"), /Unknown category/);
  assert.throws(() => setCalRule(db, "  ", "חופשות"), /sector is empty/);

  const trips = listCategories(db).find((c) => c.name === "טיולים")!;
  assert.equal(trips.calRules, 1);
  assert.throws(() => deleteCategory(db, trips.id), /1 Cal rule/);
  renameCategory(db, trips.id, "טיסות"); // the Cal rule points by id: it follows
  assert.equal(loadRules(db).calRules!.find((r) => r.sector === "תיירות")!.category, "טיסות");

  setCalRule(db, "תיירות", null);
  assert.equal(listCalRules(db).find((r) => r.sector === "תיירות")!.category, null);
  deleteCategory(db, trips.id); // no longer in use
});

test("monthly caps (M7): set, change, remove; validation is all or nothing", () => {
  const db = openDb(":memory:");
  addCategories(db, ["מזון", "ילדים"], "owner");
  const id = (name: string) => listCategories(db).find((c) => c.name === name)!.id;
  assert.ok(listCategories(db).every((c) => c.cap === null), "existing categories start with no cap");

  setCaps(db, [{ id: id("מזון"), cap: 1000 }, { id: id("ילדים"), cap: 1500.456 }]);
  assert.deepEqual(listCaps(db), [{ category: "מזון", cap: 1000 }, { category: "ילדים", cap: 1500.46 }]);

  setCaps(db, [{ id: id("מזון"), cap: null }]);
  assert.deepEqual(listCaps(db), [{ category: "ילדים", cap: 1500.46 }], "null removes the cap");

  for (const bad of [0, -5, Number.NaN, Infinity, "100" as unknown as number]) {
    assert.throws(() => setCaps(db, [{ id: id("מזון"), cap: 50 }, { id: id("ילדים"), cap: bad }]), /above 0/);
  }
  assert.throws(() => setCaps(db, [{ id: 9999, cap: 10 }]), /No category 9999/);
  const byHand = listCategories(db).find((c) => c.system)!;
  assert.throws(() => setCaps(db, [{ id: byHand.id, cap: 10 }]), /built in/);
  assert.deepEqual(listCaps(db), [{ category: "ילדים", cap: 1500.46 }], "the failed calls changed nothing (מזון stayed uncapped)");

  renameCategory(db, id("ילדים"), "ילדים – פנאי");
  assert.equal(listCategories(db).find((c) => c.name === "ילדים – פנאי")!.cap, 1500.46, "a rename keeps the cap");
  assert.throws(() => db.prepare("UPDATE categories SET monthly_cap = 0 WHERE name = 'מזון'").run(), /CHECK/, "the schema refuses it too");
});

test("rules.json backup carries the caps", () => {
  const text = formatRulesFile({ categories: ["a", "b"], rules: [], calRules: [], caps: { a: 1000 } });
  assert.deepEqual(JSON.parse(text).caps, { a: 1000 });
  assert.deepEqual(JSON.parse(formatRulesFile({ categories: [], rules: [] })).caps, {});
});
