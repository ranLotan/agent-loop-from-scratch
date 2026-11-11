// Import batches: every import (file, scrape or JSON migration) is recorded, and the latest one decides
// which rows a month has. Rows it no longer has are marked missing, never deleted.

import type { DatabaseSync } from "node:sqlite";
import type { ParsedStatement } from "../statement-import";
import type { Transaction } from "../types";
import { inTransaction } from "./index";
import { loadTransactions, upsertTransactions } from "./transactions";

export interface BatchInfo {
  source: Transaction["source"] | "json-migration";
  fileName?: string;
  /** Set for files: the same file twice is a duplicate. Scrapes have none. */
  fileSha256?: string;
  checks?: ParsedStatement["checks"];
}

export interface ImportResult {
  batchId: number;
  /** The same file was imported before; nothing changed. */
  duplicate: boolean;
  /** Rows this month didn't have before. */
  added: number;
  /** Rows it already had, refreshed from the new data (edits kept). */
  updated: number;
  /** Rows this month had that the new import doesn't: kept, but left out of reports from now on. */
  missing: Transaction[];
}

export interface ImportBatch {
  id: number;
  source: BatchInfo["source"];
  fileName: string | null;
  billingMonth: string;
  txCount: number;
  checks: ParsedStatement["checks"] | null;
  createdAt: string;
}

/** Records one import of `billingMonth` and makes it the month's current set of rows. All or nothing. */
export function importBatch(db: DatabaseSync, billingMonth: string, transactions: Transaction[], info: BatchInfo): ImportResult {
  return inTransaction(db, () => {
    if (info.fileSha256) {
      const earlier = db.prepare("SELECT id FROM import_batches WHERE file_sha256 = ?").get(info.fileSha256);
      if (earlier) return { batchId: Number(earlier.id), duplicate: true, added: 0, updated: 0, missing: [] };
    }

    const knownIds = new Set(
      db.prepare("SELECT id FROM transactions WHERE billing_month = ?").all(billingMonth).map((row) => row.id as string),
    );
    const before = loadTransactions(db, billingMonth) ?? [];

    const batchId = Number(
      db
        .prepare(`
          INSERT INTO import_batches (source, file_name, file_sha256, billing_month, checks_json, tx_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          info.source,
          info.fileName ?? null,
          info.fileSha256 ?? null,
          billingMonth,
          info.checks ? JSON.stringify(info.checks) : null,
          transactions.length,
          new Date().toISOString(),
        ).lastInsertRowid,
    );
    upsertTransactions(db, billingMonth, transactions, batchId);

    const incoming = new Set(transactions.map((t) => t.id));
    const missing = before.filter((t) => !incoming.has(t.id));
    const markMissing = db.prepare("UPDATE transactions SET missing_since_batch_id = ? WHERE id = ?");
    for (const t of missing) markMissing.run(batchId, t.id);

    const added = transactions.filter((t) => !knownIds.has(t.id)).length;
    return { batchId, duplicate: false, added, updated: transactions.length - added, missing };
  });
}

/** Every import, newest first. */
export function listImportBatches(db: DatabaseSync): ImportBatch[] {
  return db
    .prepare("SELECT * FROM import_batches ORDER BY id DESC")
    .all()
    .map((row) => ({
      id: Number(row.id),
      source: row.source as ImportBatch["source"],
      fileName: row.file_name as string | null,
      billingMonth: row.billing_month as string,
      txCount: Number(row.tx_count),
      checks: row.checks_json ? JSON.parse(row.checks_json as string) : null,
      createdAt: row.created_at as string,
    }));
}
