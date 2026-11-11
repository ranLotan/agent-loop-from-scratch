import { createHash } from "node:crypto";
import type { Transaction } from "./types";

/** Shared by every input source, so the same purchase gets the same id from xlsx or scraper. */

export const CURRENCY_SYMBOLS: Record<string, string> = { "₪": "ILS", "$": "USD", "€": "EUR", "£": "GBP" };

/** "₪" / "ILS" / "NIS" → "ILS", "$" → "USD", ... */
export function currencyCode(raw: string | undefined): string | undefined {
  const s = raw?.trim();
  if (!s) return undefined;
  if (CURRENCY_SYMBOLS[s]) return CURRENCY_SYMBOLS[s];
  const code = s.toUpperCase();
  return code === "NIS" ? "ILS" : code;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** A statement month like "2026-09". */
export const isMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** Same date+merchant+amount twice is legit (two coffees), so repeats are numbered. */
export function assignIds(transactions: Omit<Transaction, "id">[], billingMonth: string): Transaction[] {
  const seen = new Map<string, number>();
  return transactions.map((tx) => {
    // Unique across ALL months (SQLite's primary key): installment payments share a purchase date and amount,
    // so the billing month and payment number tell them apart. No installments → "".
    const key = `${tx.date}|${tx.merchant}|${tx.amount}|${tx.currency}|${billingMonth}|${tx.installments?.number ?? ""}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const id = createHash("sha1").update(`${key}|${occurrence}`).digest("hex").slice(0, 12);
    return { id, ...tx };
  });
}
