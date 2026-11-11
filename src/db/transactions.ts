// Transactions in SQLite: maps rows to the Transaction type from src/types.ts, so callers don't see SQL.

import type { DatabaseSync } from "node:sqlite";
import { normalizeMerchant } from "../categorize";
import type { Transaction } from "../types";
import { inTransaction } from "./index";

interface TransactionRow {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  currency: string;
  original_amount: number | null;
  original_currency: string | null;
  type: string | null;
  installment_number: number | null;
  installment_total: number | null;
  sector: string | null;
  memo: string | null;
  card: string | null;
  source: Transaction["source"];
}

/** SQL's NULL becomes an absent field, matching how the JSON files looked. */
function toTransaction(row: TransactionRow): Transaction {
  const tx: Transaction = {
    id: row.id,
    date: row.date,
    merchant: row.merchant,
    amount: row.amount,
    currency: row.currency,
    source: row.source,
  };
  if (row.original_amount !== null) tx.originalAmount = row.original_amount;
  if (row.original_currency !== null) tx.originalCurrency = row.original_currency;
  if (row.type !== null) tx.type = row.type;
  if (row.installment_number !== null && row.installment_total !== null) {
    tx.installments = { number: row.installment_number, total: row.installment_total };
  }
  if (row.sector !== null) tx.sector = row.sector;
  if (row.memo !== null) tx.memo = row.memo;
  if (row.card !== null) tx.card = row.card;
  return tx;
}

/** Saves a month's rows in statement order. `batchId` is the import they came from, if any. */
export function upsertTransactions(
  db: DatabaseSync,
  billingMonth: string,
  transactions: Transaction[],
  batchId: number | null,
): void {
  // M2, YOUR PART: saving a row that already exists.
  //
  // As written, this INSERT crashes when an id is already in the table, so importing a month twice fails.
  // TODO: add an ON CONFLICT clause, after the closing ) of VALUES:
  //
  //   ON CONFLICT (id) DO UPDATE SET
  //     some_column = excluded.some_column,
  //     ...
  //
  // `excluded` means "the new row that couldn't be inserted".
  //
  // Which columns to list:
  //   - Everything that comes FROM the statement: refresh it. Skip `id` (it's what matched).
  //   - category_override, description_override, override_source: do NOT list them.
  //     Those are your own edits, and a re-import has to leave them alone.
  //
  // Tests: npm test (src/db/db.test.ts). Two of them are red until this is done.
  const insert = db.prepare(`
    INSERT INTO transactions (
      id, billing_month, position, date, merchant, normalized_merchant, amount, currency,
      original_amount, original_currency, type, installment_number, installment_total,
      sector, memo, card, source, import_batch_id, updated_at
    ) VALUES (
      :id, :billing_month, :position, :date, :merchant, :normalized_merchant, :amount, :currency,
      :original_amount, :original_currency, :type, :installment_number, :installment_total,
      :sector, :memo, :card, :source, :import_batch_id, :updated_at
    )
  `);

  const now = new Date().toISOString();
  inTransaction(db, () => {
    transactions.forEach((t, position) => {
      insert.run({
        id: t.id,
        billing_month: billingMonth,
        position,
        date: t.date,
        merchant: t.merchant,
        normalized_merchant: normalizeMerchant(t.merchant),
        amount: t.amount,
        currency: t.currency,
        original_amount: t.originalAmount ?? null,
        original_currency: t.originalCurrency ?? null,
        type: t.type ?? null,
        installment_number: t.installments?.number ?? null,
        installment_total: t.installments?.total ?? null,
        sector: t.sector ?? null,
        memo: t.memo ?? null,
        card: t.card ?? null,
        source: t.source,
        import_batch_id: batchId,
        updated_at: now,
      });
    });
  });
}

/** A month's rows in statement order, or null if the month was never imported. */
export function loadTransactions(db: DatabaseSync, billingMonth: string): Transaction[] | null {
  const rows = db
    .prepare("SELECT * FROM transactions WHERE billing_month = ? ORDER BY position")
    .all(billingMonth) as unknown as TransactionRow[];
  return rows.length ? rows.map(toTransaction) : null;
}

/** Every imported month, oldest first. */
export function listMonths(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT DISTINCT billing_month FROM transactions ORDER BY billing_month")
    .all()
    .map((row) => row.billing_month as string);
}
