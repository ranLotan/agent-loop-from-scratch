import assert from "node:assert/strict";
import { test } from "node:test";
import { assignIds } from "./normalize";
import type { Transaction } from "./types";

const purchase = (over: Partial<Transaction> = {}): Omit<Transaction, "id"> => ({
  date: "2026-06-29",
  merchant: "ישראייר",
  amount: 111,
  currency: "ILS",
  source: "xlsx",
  ...over,
});
const payment = (number: number) => purchase({ installments: { number, total: 3 } });
const idOf = (tx: Omit<Transaction, "id">, month: string) => assignIds([tx], month)[0].id;

test("installment payments billed in different months get different ids", () => {
  assert.notEqual(idOf(payment(2), "2026-08"), idOf(payment(3), "2026-09"));
});

test("the same row billed in another month gets a different id", () => {
  assert.notEqual(idOf(purchase(), "2026-08"), idOf(purchase(), "2026-09"));
});

test("a payment's id doesn't depend on which other payments are in the import", () => {
  const alone = idOf(payment(2), "2026-08");
  const withAnother = assignIds([payment(1), payment(2)], "2026-08")[1].id;
  assert.equal(alone, withAnother);
});

test("two identical purchases in one import still get different ids (two coffees)", () => {
  const [first, second] = assignIds([purchase(), purchase()], "2026-08");
  assert.notEqual(first.id, second.id);
});

test("the id ignores the source, so xlsx and scraper rows match", () => {
  assert.equal(idOf(purchase({ source: "xlsx" }), "2026-08"), idOf(purchase({ source: "scraper", card: "7187" }), "2026-08"));
});
