// Pending card charges (M6): approved by Cal but not billed yet. Provisional rows with no stable id
// (milestone-6.md, R1), so they're never matched to billed transactions: each scrape replaces them all.

import type { DatabaseSync } from "node:sqlite";
import { normalizeMerchant } from "../categorize";
import { ledgerMonth } from "../ledger";
import type { Transaction } from "../types";
import { inTransaction } from "./index";

/** A pending charge shaped like a transaction, so categorize() works on it. Its id lasts only until the next scrape. */
export type PendingCharge = Transaction & { ledgerMonth: string; pending: true; scrapedAt: string };

/** Deletes every pending charge and saves the scrape's list. Billed charges simply stop appearing here. */
export function replacePending(db: DatabaseSync, batchId: number, charges: Omit<Transaction, "id">[]): void {
  const insert = db.prepare(`
    INSERT INTO pending_charges (import_batch_id, ledger_month, date, merchant, normalized_merchant, amount, currency,
                                 original_amount, original_currency, sector, card)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  inTransaction(db, () => {
    db.exec("DELETE FROM pending_charges");
    for (const c of charges) {
      insert.run(batchId, ledgerMonth(c), c.date, c.merchant, normalizeMerchant(c.merchant), c.amount, c.currency,
        c.originalAmount ?? null, c.originalCurrency ?? null, c.sector ?? null, c.card ?? null);
    }
  });
}

/** Pending charges, oldest first; only one ledger month's when `month` is given. */
export function listPending(db: DatabaseSync, month?: string): PendingCharge[] {
  const rows = db
    .prepare(`
      SELECT p.*, b.created_at AS scraped_at FROM pending_charges p JOIN import_batches b ON b.id = p.import_batch_id
      ${month ? "WHERE p.ledger_month = ?" : ""} ORDER BY p.date, p.id
    `)
    .all(...(month ? [month] : [])) as Record<string, string | number | null>[];
  return rows.map((r) => {
    const charge: PendingCharge = {
      id: `pending-${r.id}`,
      date: r.date as string,
      merchant: r.merchant as string,
      amount: r.amount as number,
      currency: r.currency as string,
      source: "scraper",
      ledgerMonth: r.ledger_month as string,
      pending: true,
      scrapedAt: r.scraped_at as string,
    };
    if (r.original_amount !== null) charge.originalAmount = r.original_amount as number;
    if (r.original_currency !== null) charge.originalCurrency = r.original_currency as string;
    if (r.sector !== null) charge.sector = r.sector as string;
    if (r.card !== null) charge.card = r.card as string;
    return charge;
  });
}
