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

/** Same date+merchant+amount twice is legit (two coffees), so repeats are numbered. */
export function assignIds(transactions: Omit<Transaction, "id">[]): Transaction[] {
  const seen = new Map<string, number>();
  return transactions.map((tx) => {
    const key = `${tx.date}|${tx.merchant}|${tx.amount}|${tx.currency}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const id = createHash("sha1").update(`${key}|${occurrence}`).digest("hex").slice(0, 12);
    return { id, ...tx };
  });
}
