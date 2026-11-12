// Display formatting only. Totals themselves always come from summarize() on the server.

import type { Totals } from "../../../src/report";

/** 1234.5 → "₪1,234.50" */
export function formatMoney(amount: number, currency = "ILS"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

/** A change between two amounts: 120 → "+₪120.00", -20 → "-₪20.00", 0 → "₪0.00" */
export function formatDelta(amount: number, currency = "ILS"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, signDisplay: "exceptZero" }).format(amount);
}

/** part 25 of whole 200 → "13%". Empty when there's nothing to divide by. */
export function formatShare(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "";
}

/** The non-shekel amounts of a Totals object: "€39.30 · $12.00". Empty when there are none. */
export function formatForeign(totals: Totals): string {
  return Object.entries(totals)
    .filter(([currency]) => currency !== "ILS")
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(" · ");
}

/** The month before `month` (YYYY-MM): 2026-01 → 2025-12. (src/normalize.ts has shiftMonth, but it imports node:crypto.) */
export function monthBefore(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
