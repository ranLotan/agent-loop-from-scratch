// The import service with the fake statement in samples/ and a throwaway database.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

process.env.DB_PATH = ":memory:"; // before anything opens the database
const { importStatement } = await import("./imports");
const { loadTransactions, listImports } = await import("./store");

const sample = readFileSync(new URL("../samples/cal-sample.csv", import.meta.url));

test("importing a statement returns what happened, and the month is readable", () => {
  const r = importStatement(sample, "cal-sample.csv", "1999-01");
  assert.deepEqual([r.month, r.count, r.added, r.duplicate, r.checksOk], ["1999-01", 14, 14, false, true]);
  assert.equal(loadTransactions("1999-01")!.length, 14);
  assert.deepEqual(listImports().map((b) => [b.source, b.fileName]), [["csv", "cal-sample.csv"]]);
});

test("the same file again is reported as a duplicate", () => {
  const r = importStatement(sample, "cal-sample.csv", "1999-01");
  assert.deepEqual([r.duplicate, r.added], [true, 0]);
});

test("bad input is rejected before anything is saved", () => {
  assert.throws(() => importStatement(sample, "cal-sample.csv", "1999-13"), /Expected a month/);
  assert.throws(() => importStatement(sample, "statement.pdf"), /Unsupported file type/);
});
