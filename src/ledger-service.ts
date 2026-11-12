// The month's ledger and status as services (M6): they read through store.ts and return plain data.
// The API sends them as JSON; the dashboard only displays them, it never adds anything up.

import { categorize, MANUAL_CATEGORY, validateRules } from "./categorize";
import { buildLedger, cardState, summarizeLedger, type CardStatus, type LedgerEntry, type LedgerSummary } from "./ledger";
import { shiftMonth } from "./normalize";
import * as store from "./store";
import type { CategorizedTransaction } from "./types";

export interface MonthLedger {
  month: string;
  entries: LedgerEntry[];
  summary: LedgerSummary;
}

function categorizedCard(month: string): { card: CategorizedTransaction[]; pending: CategorizedTransaction[] } {
  const rules = store.loadRules();
  validateRules(rules);
  return {
    card: categorize(store.searchTransactions({ from: month, to: month, by: "ledger" }), rules),
    pending: categorize(store.listPending(month), rules),
  };
}

/** Everything that counts in `month` (a ledger month): card charges by purchase month, recurring items, one-offs. */
export function monthLedger(month: string): MonthLedger {
  const entries = buildLedger({
    ...categorizedCard(month),
    occurrences: store.recurringMonth(month).occurrences,
    oneOffs: store.listManualEntries(month),
  });
  return { month, entries, summary: summarizeLedger(entries) };
}

export interface TrendPoint {
  month: string;
  income: number;
  expenses: number;
  net: number;
  /** Items still waiting for confirmation that month: its Net may change. */
  awaiting: number;
}

/** Income, expenses and Net for the n months ending with `endMonth`, oldest first. */
export function ledgerTrend(endMonth: string, n = 6): TrendPoint[] {
  return Array.from({ length: n }, (_, i) => shiftMonth(endMonth, i - n + 1)).map((month) => {
    const { income, expenses, net, awaiting } = monthLedger(month).summary;
    return { month, income, expenses, net, awaiting: awaiting.count };
  });
}

export interface MonthStatus {
  month: string;
  card: CardStatus;
  /**
   * `statement`: the first statement (billing month: this one or the next) with pending proposals or flags, so the
   * dashboard can open the Review page on it. Review works per statement, not per purchase month. null = none pending.
   */
  review: { proposals: number; flags: number; byHand: number; statement: string | null };
  manual: { awaiting: number };
  /** The first step that isn't finished, in pipeline order; null = the month is done. */
  next: "card" | "review" | "manual" | null;
}

/** What's left to do for a month: card data, review, manual confirmations. */
export function monthStatus(month: string): MonthStatus {
  const { card } = categorizedCard(month);
  // The agent runs per statement (billing month), so a purchase month's review spans both statements.
  const pending = [month, shiftMonth(month, 1)].map((m) => ({
    statement: m,
    proposals: store.listProposals(m).filter((p) => p.status === "pending").length,
    flags: store.listFlags(m).filter((f) => f.status === "pending").length,
  }));
  const review = {
    proposals: pending.reduce((n, s) => n + s.proposals, 0),
    flags: pending.reduce((n, s) => n + s.flags, 0),
    byHand: card.filter((t) => t.category === MANUAL_CATEGORY).length,
    statement: pending.find((s) => s.proposals + s.flags > 0)?.statement ?? null,
  };
  const manual = { awaiting: store.recurringMonth(month).summary.awaiting };
  const cardStatus = cardState(month, store.listImports(), store.listPending(month).length > 0);
  const next =
    cardStatus.state !== "complete" ? "card"
    : review.proposals + review.flags + review.byHand > 0 ? "review"
    : manual.awaiting > 0 ? "manual"
    : null;
  return { month, card: cardStatus, review, manual, next };
}
