// Transactions in SQLite: maps rows to the Transaction type from src/types.ts, so callers don't see SQL.

import type { DatabaseSync } from "node:sqlite";
import { normalizeMerchant } from "../categorize";
import type { Transaction } from "../types";
import { inTransaction, NotFoundError, ValidationError } from "./index";

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
  billing_month: string;
  category_override: string | null;
  description_override: string | null;
  override_source: "manual" | "agent" | null;
}

/** A transaction plus the statement month it was billed in, for views that span months. */
export type StoredTransaction = Transaction & { billingMonth: string };

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
  if (row.category_override !== null) {
    tx.categoryOverride = row.category_override;
    tx.overrideSource = row.override_source ?? "manual";
  }
  if (row.description_override !== null) tx.descriptionOverride = row.description_override;
  return tx;
}

/** Saves a month's rows in statement order. `batchId` is the import they came from, if any. */
export function upsertTransactions(
  db: DatabaseSync,
  billingMonth: string,
  transactions: Transaction[],
  batchId: number | null,
): void {
  // Upsert: a new id is inserted; a known id gets the bank's columns refreshed (`excluded` = the new row).
  // category_override, description_override and override_source are the owner's edits, so they're never listed.
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
    ON CONFLICT (id) DO UPDATE SET
      billing_month       = excluded.billing_month,
      position            = excluded.position,
      date                = excluded.date,
      merchant            = excluded.merchant,
      normalized_merchant = excluded.normalized_merchant,
      amount              = excluded.amount,
      currency            = excluded.currency,
      original_amount     = excluded.original_amount,
      original_currency   = excluded.original_currency,
      type                = excluded.type,
      installment_number  = excluded.installment_number,
      installment_total   = excluded.installment_total,
      sector              = excluded.sector,
      memo                = excluded.memo,
      card                = excluded.card,
      source              = excluded.source,
      import_batch_id     = excluded.import_batch_id,
      updated_at          = excluded.updated_at,
      missing_since_batch_id = NULL -- the statement has this row (again)
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

/** A month's rows in statement order, or null if the month was never imported. Missing rows are left out. */
export function loadTransactions(db: DatabaseSync, billingMonth: string): Transaction[] | null {
  const rows = db
    .prepare("SELECT * FROM transactions WHERE billing_month = ? AND missing_since_batch_id IS NULL ORDER BY position")
    .all(billingMonth) as unknown as TransactionRow[];
  return rows.length ? rows.map(toTransaction) : null;
}

/** Every imported month, oldest first. */
export function listMonths(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT DISTINCT billing_month FROM transactions WHERE missing_since_batch_id IS NULL ORDER BY billing_month")
    .all()
    .map((row) => row.billing_month as string);
}

export interface TransactionSearch {
  /** Billing months, inclusive, like "2026-05". */
  from?: string;
  to?: string;
  /** Text in the bank's merchant name or in your description. */
  q?: string;
  currency?: string;
}

/**
 * Rows across months, newest month first, statement order inside a month. Missing rows are left out.
 * Category filters aren't here: a category is computed by categorize(), so the caller filters on its result.
 */
export function searchTransactions(db: DatabaseSync, search: TransactionSearch = {}): StoredTransaction[] {
  const where = ["missing_since_batch_id IS NULL"];
  const params: string[] = [];
  if (search.from) where.push("billing_month >= ?"), params.push(search.from);
  if (search.to) where.push("billing_month <= ?"), params.push(search.to);
  if (search.currency) where.push("currency = ?"), params.push(search.currency);
  if (search.q?.trim()) {
    // instr() on lower(): a plain "contains", so % and _ in the search text have no special meaning (unlike LIKE).
    where.push("(instr(lower(merchant), lower(?)) > 0 OR instr(lower(coalesce(description_override, '')), lower(?)) > 0)");
    params.push(search.q.trim(), search.q.trim());
  }
  const rows = db
    .prepare(`SELECT * FROM transactions WHERE ${where.join(" AND ")} ORDER BY billing_month DESC, position`)
    .all(...params) as unknown as TransactionRow[];
  return rows.map((row) => ({ ...toTransaction(row), billingMonth: row.billing_month }));
}

export function getTransaction(db: DatabaseSync, id: string): StoredTransaction | null {
  const row = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as unknown as TransactionRow | undefined;
  return row ? { ...toTransaction(row), billingMonth: row.billing_month } : null;
}

export interface OverrideChange {
  /** A category name from your list; null clears your edit, so the rule or Cal applies again. Omitted = unchanged. */
  category?: string | null;
  /** Your own text for the transaction; null goes back to the bank's merchant name. Omitted = unchanged. */
  description?: string | null;
}

/** Saves the owner's edits on one transaction. Re-imports never touch these columns. */
export function setOverride(
  db: DatabaseSync,
  id: string,
  change: OverrideChange,
  source: "manual" | "agent" = "manual",
): StoredTransaction {
  return inTransaction(db, () => {
    if (!getTransaction(db, id)) throw new NotFoundError(`No transaction ${id}`);
    if (change.category !== undefined) {
      if (change.category !== null && !db.prepare("SELECT 1 FROM categories WHERE name = ?").get(change.category)) {
        throw new ValidationError(`Unknown category "${change.category}"`);
      }
      db.prepare("UPDATE transactions SET category_override = ?, override_source = ? WHERE id = ?").run(
        change.category,
        change.category === null ? null : source,
        id,
      );
    }
    if (change.description !== undefined) {
      db.prepare("UPDATE transactions SET description_override = ? WHERE id = ?").run(change.description, id);
    }
    return getTransaction(db, id)!;
  });
}

/**
 * "This month only" from an approved proposal: gives the month's charges from `merchant` the category as an
 * agent-labeled edit. A charge you already edited by hand keeps your edit. Returns how many charges changed.
 */
export function setMonthCategory(db: DatabaseSync, billingMonth: string, merchant: string, category: string): number {
  if (!db.prepare("SELECT 1 FROM categories WHERE name = ?").get(category)) throw new ValidationError(`Unknown category "${category}"`);
  return Number(
    db
      .prepare(`
        UPDATE transactions SET category_override = ?, override_source = 'agent'
        WHERE billing_month = ? AND normalized_merchant = ? AND missing_since_batch_id IS NULL
          AND (override_source IS NULL OR override_source = 'agent')
      `)
      .run(category, billingMonth, normalizeMerchant(merchant)).changes,
  );
}
