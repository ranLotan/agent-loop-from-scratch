// Exception candidates: deterministic checks that find transactions worth a second look.
// Code FINDS them (exact, testable); the agent only JUDGES them: is this really unusual, and why?

import { normalizeMerchant } from "./categorize";
import type { Transaction } from "./types";

export type CandidateReason = "large" | "foreign_currency" | "new_merchant" | "new_standing_order" | "possible_duplicate";

export interface Candidate {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  currency: string;
  reasons: CandidateReason[];
}

export interface CandidateOptions {
  /** ILS charges at or above this are "large". */
  largeAmount?: number;
  /** A new merchant (or foreign charge) below this amount isn't worth a look: a new coffee shop is noise. */
  minAmount?: number;
}

/**
 * `history` holds transactions from earlier months. When it's empty there is nothing to
 * compare against, so "new merchant" checks are skipped instead of flagging everything.
 */
export function findCandidates(
  transactions: Transaction[],
  history: Transaction[],
  { largeAmount = 1500, minAmount = 300 }: CandidateOptions = {},
): Candidate[] {
  const seen = new Set(history.map((t) => normalizeMerchant(t.merchant)));
  const hasHistory = history.length > 0;

  const dupKey = (t: Transaction) => `${t.date}|${normalizeMerchant(t.merchant)}|${t.amount}|${t.currency}`;
  const dupCounts = new Map<string, number>();
  for (const t of transactions) dupCounts.set(dupKey(t), (dupCounts.get(dupKey(t)) ?? 0) + 1);

  const candidates: Candidate[] = [];
  for (const t of transactions) {
    const reasons: CandidateReason[] = [];
    const isNew = hasHistory && !seen.has(normalizeMerchant(t.merchant));
    const notable = Math.abs(t.amount) >= minAmount;

    if (t.currency === "ILS" && t.amount >= largeAmount) reasons.push("large");
    if (t.currency !== "ILS" && notable) reasons.push("foreign_currency");
    if (isNew && t.type === "הוראת קבע") reasons.push("new_standing_order"); // any amount: it repeats monthly
    else if (isNew && notable) reasons.push("new_merchant");
    if ((dupCounts.get(dupKey(t)) ?? 0) > 1) reasons.push("possible_duplicate");

    if (reasons.length) {
      candidates.push({ id: t.id, date: t.date, merchant: t.merchant, amount: t.amount, currency: t.currency, reasons });
    }
  }
  return candidates;
}
