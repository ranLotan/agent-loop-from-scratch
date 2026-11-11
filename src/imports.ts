// Importing a month, as services: they take inputs as parameters and RETURN results.
// The CLI prints them (src/cli.ts); the API sends them as JSON (apps/api).

import { createHash } from "node:crypto";
import type { ImportResult } from "./db/imports";
import { isMonth } from "./normalize";
import { totalsByCurrency } from "./report";
import { mapScrapedAccounts, scrapeCal } from "./scraper";
import { parseStatementBytes, type ParsedStatement } from "./statement-import";
import { importTransactions, loadTransactions, rawPath, saveRaw } from "./store";
import type { Transaction } from "./types";

export interface StatementImport extends ImportResult {
  month: string;
  fileName: string;
  count: number;
  billingDate?: string;
  checks: ParsedStatement["checks"];
  /** Every section total printed on the statement equals the sum of its rows. */
  checksOk: boolean;
  skipped: number;
}

export interface FetchImport extends ImportResult {
  month: string;
  count: number;
  cards: string[];
  pending: number;
  otherMonths: number;
  rawFile: string;
  /** Totals per currency before and after, when the month had been imported before. */
  comparison: { currency: string; before: number; after: number }[] | null;
  /** Fetched rows the month didn't have before. */
  onlyFetched: Transaction[];
}

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.01;

function requireMonth(month: string): string {
  if (!isMonth(month)) throw new Error(`Expected a month like 2026-09, got "${month}".`);
  return month;
}

/** Imports a Cal statement file. `month` overrides the billing month printed in the file. */
export function importStatement(bytes: Buffer, fileName: string, month?: string): StatementImport {
  if (month !== undefined) requireMonth(month);
  const parsed = parseStatementBytes(bytes, fileName, month);
  const billingMonth = month ?? parsed.billingDate!.slice(0, 7); // parse throws if both are missing
  const result = importTransactions(billingMonth, parsed.transactions, {
    source: parsed.transactions[0].source,
    fileName,
    fileSha256: createHash("sha256").update(bytes).digest("hex"),
    checks: parsed.checks,
  });
  return {
    ...result,
    month: billingMonth,
    fileName,
    count: parsed.transactions.length,
    billingDate: parsed.billingDate,
    checks: parsed.checks,
    checksOk: parsed.checks.every((c) => sameAmount(c.expected, c.actual)),
    skipped: parsed.skipped,
  };
}

/** Scrapes Cal for a billing month (about 30 s) and imports it. Needs CAL_USERNAME/CAL_PASSWORD in the env. */
export async function fetchMonth(month: string, opts: { showBrowser?: boolean } = {}): Promise<FetchImport> {
  requireMonth(month);
  const accounts = await scrapeCal(month, {
    showBrowser: opts.showBrowser ?? false,
    failureScreenshotPath: rawPath("failure.png"),
  });
  const rawFile = saveRaw(`${month}.json`, accounts);
  const { transactions, pending, otherMonths } = mapScrapedAccounts(accounts, month);

  const previous = loadTransactions(month);
  const result = importTransactions(month, transactions, { source: "scraper" });

  let comparison: FetchImport["comparison"] = null;
  if (previous) {
    const [before, after] = [totalsByCurrency(previous), totalsByCurrency(transactions)];
    comparison = [...new Set([...Object.keys(before), ...Object.keys(after)])].map((currency) => ({
      currency,
      before: before[currency] ?? 0,
      after: after[currency] ?? 0,
    }));
  }
  const previousIds = new Set((previous ?? []).map((t) => t.id));

  return {
    ...result,
    month,
    count: transactions.length,
    cards: [...new Set(transactions.flatMap((t) => (t.card ? [t.card] : [])))],
    pending,
    otherMonths,
    rawFile,
    comparison,
    onlyFetched: previous ? transactions.filter((t) => !previousIds.has(t.id)) : [],
  };
}
