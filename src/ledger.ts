// The ledger (M6): money by the month it was spent in, not the month the card billed it.
// Pure code. Why these rules: see "Findings" in docs/milestones/milestone-6.md (step 6.1).

import type { ImportBatch } from "./db/imports";
import type { ManualEntry } from "./db/manual";
import { round2, shiftMonth } from "./normalize";
import type { Occurrence } from "./recurring";
import { UNCATEGORIZED } from "./report";
import type { CategorizedTransaction, Transaction } from "./types";

/**
 * The month a card charge counts in: the purchase month, and for installment payment N the purchase
 * month + (N − 1), so a purchase in 10 payments spreads over 10 months. `date` is the purchase date
 * for every source (the scraper's shifted installment dates are undone in src/scraper.ts).
 * Billing cycles don't follow calendar months, so the billing month is deliberately not used.
 */
export function ledgerMonth(tx: Pick<Transaction, "date" | "installments">): string {
  const purchaseMonth = tx.date.slice(0, 7);
  const n = tx.installments?.number;
  // Bad installment data (0, negative, a fraction) falls back to the purchase month rather than guessing.
  if (n === undefined || !Number.isInteger(n) || n < 1) return purchaseMonth;
  return shiftMonth(purchaseMonth, n - 1);
}

/** One line of a month's money: a card charge, a recurring item or a one-time entry. */
export interface LedgerEntry {
  source: "card" | "manual";
  /** Where exactly: a billed charge, a charge not billed yet, a recurring item, a one-time entry. */
  origin: "billed" | "pending" | "recurring" | "one_off";
  kind: "income" | "expense";
  /** YYYY-MM-DD; null for a recurring item without a day. */
  date: string | null;
  name: string;
  /** Positive = money in for income, money out for an expense. A card refund is a negative expense. */
  amount: number;
  currency: string;
  category: string | null;
  /** Only "counted" entries are in the totals; an awaiting one is shown with its suggested amount. */
  status: "counted" | "awaiting_confirmation";
  /** The transaction id, recurring definition id or one-time entry id it came from. */
  ref: string;
}

export interface LedgerInputs {
  /** Billed card charges that count in the month (by ledger month), categorized. */
  card: CategorizedTransaction[];
  /** Charges not billed yet, in the same month, categorized. They count: November closes on December 1st. */
  pending: CategorizedTransaction[];
  occurrences: Occurrence[];
  oneOffs: ManualEntry[];
}

/**
 * Merges the card and the manual side into one list. Card-paid recurring items are left out (their card
 * charge is already an entry), and so are skipped months.
 */
export function buildLedger({ card, pending, occurrences, oneOffs }: LedgerInputs): LedgerEntry[] {
  const fromCard = (origin: "billed" | "pending") => (t: CategorizedTransaction): LedgerEntry => ({
    source: "card", origin, kind: "expense", date: t.date, name: t.descriptionOverride ?? t.merchant,
    amount: t.amount, currency: t.currency, category: t.category, status: "counted", ref: t.id,
  });
  const recurring = occurrences
    .filter((o) => o.paidBy === "outside" && (o.status === "expected" || o.status === "awaiting_confirmation"))
    .map((o): LedgerEntry => ({
      source: "manual", origin: "recurring", kind: o.kind, date: o.expectedDate, name: o.name, amount: o.expectedAmount,
      currency: o.currency, category: o.category, status: o.status === "expected" ? "counted" : "awaiting_confirmation",
      ref: String(o.definitionId),
    }));
  const oneOff = oneOffs.map((e): LedgerEntry => ({
    source: "manual", origin: "one_off", kind: e.kind, date: e.date, name: e.name, amount: e.amount,
    currency: e.currency, category: e.category, status: "counted", ref: String(e.id),
  }));
  return [...card.map(fromCard("billed")), ...pending.map(fromCard("pending")), ...recurring, ...oneOff];
}

export interface PieSlice {
  category: string;
  amount: number;
  /** Rounded to 0.1, and the slices always add up to exactly 100. */
  percent: number;
  /** For the "Other" slice: the categories grouped into it. */
  grouped?: string[];
}

export const OTHER = "Other";

/**
 * Expenses by category as pie slices. Only positive amounts (a category that refunds made ≤ 0 can't be a
 * slice). With more than maxSlices + 1 categories, the biggest maxSlices keep their slice and the rest
 * become one "Other" (an Other holding a single category would just be that category under another name).
 */
export function pieSlices(byCategory: { category: string; amount: number }[], maxSlices = 6): PieSlice[] {
  const positive = byCategory.filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  const total = positive.reduce((sum, c) => sum + c.amount, 0);
  if (total === 0) return [];
  const kept = positive.length > maxSlices + 1 ? positive.slice(0, maxSlices) : positive;
  const rest = positive.slice(kept.length);
  const slices: Omit<PieSlice, "percent">[] = kept.map((c) => ({ category: c.category, amount: round2(c.amount) }));
  if (rest.length) {
    slices.push({ category: OTHER, amount: round2(rest.reduce((s, c) => s + c.amount, 0)), grouped: rest.map((c) => c.category) });
  }
  // Largest remainder, in tenths of a percent: plain rounding can add up to 99.9 or 100.1.
  const tenths = slices.map((s) => (s.amount / total) * 1000);
  const floors = tenths.map(Math.floor);
  let left = 1000 - floors.reduce((a, b) => a + b, 0);
  const order = tenths.map((t, i) => [t - floors[i], i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) if (left-- > 0) floors[i]++;
  return slices.map((s, i) => ({ ...s, percent: floors[i] / 10 }));
}

export interface LedgerSummary {
  income: number;
  expenses: number;
  /** income − expenses. Negative = you spent more than you earned. */
  net: number;
  /** Items waiting for confirmation: NOT in the totals above. */
  awaiting: { count: number; expectedIncome: number; expectedExpenses: number };
  /** Card charges not billed yet: already in the totals, but they may still change. */
  pendingCard: { count: number; amount: number };
  /** Counted expenses per category, biggest first. Uncategorized charges have their own bucket. */
  byCategory: { category: string; amount: number }[];
  pie: PieSlice[];
  /** Counted entries in another currency: left out of the shekel totals (Net is ILS only). */
  otherCurrencies: { count: number; totals: Record<string, number> };
}

/** The month's totals. Only counted shekel entries are added up; everything else is reported beside them. */
export function summarizeLedger(entries: LedgerEntry[]): LedgerSummary {
  let income = 0;
  let expenses = 0;
  const awaiting = { count: 0, expectedIncome: 0, expectedExpenses: 0 };
  const pendingCard = { count: 0, amount: 0 };
  const otherCurrencies = { count: 0, totals: {} as Record<string, number> };
  const categories = new Map<string, number>();

  for (const e of entries) {
    if (e.currency !== "ILS") {
      if (e.status === "counted") {
        otherCurrencies.count++;
        otherCurrencies.totals[e.currency] = round2((otherCurrencies.totals[e.currency] ?? 0) + (e.kind === "income" ? e.amount : -e.amount));
      }
      continue;
    }
    if (e.status === "awaiting_confirmation") {
      awaiting.count++;
      if (e.kind === "income") awaiting.expectedIncome += e.amount;
      else awaiting.expectedExpenses += e.amount;
      continue;
    }
    if (e.origin === "pending") {
      pendingCard.count++;
      pendingCard.amount += e.amount;
    }
    if (e.kind === "income") {
      income += e.amount;
    } else {
      expenses += e.amount;
      const key = e.category ?? UNCATEGORIZED;
      categories.set(key, (categories.get(key) ?? 0) + e.amount);
    }
  }

  const byCategory = [...categories]
    .map(([category, amount]) => ({ category, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  return {
    income: round2(income),
    expenses: round2(expenses),
    net: round2(income - expenses),
    awaiting: { count: awaiting.count, expectedIncome: round2(awaiting.expectedIncome), expectedExpenses: round2(awaiting.expectedExpenses) },
    pendingCard: { count: pendingCard.count, amount: round2(pendingCard.amount) },
    byCategory,
    pie: pieSlices(byCategory),
    otherCurrencies,
  };
}

/** Days after a month ends before its card data counts as complete: some merchants post a charge late. */
export const GRACE_DAYS = 3;

export interface CardStatus {
  state: "missing" | "partial" | "complete";
  /** The newest import that holds this month's charges, if any. */
  asOf: string | null;
  /** The billing months that hold this month's charges (M and M+1), and whether each was imported. */
  statements: { month: string; imported: boolean }[];
}

/**
 * When a purchase month's card data is complete (milestone-6.md, "Billing lag"): its charges are billed on
 * the M and M+1 statements, so both must be imported, and the M+1 import must be from after M ended +
 * GRACE_DAYS. A statement file for M+1 is always from after that, so files and scrapes follow one rule.
 */
export function cardState(month: string, batches: ImportBatch[], hasPending: boolean): CardStatus {
  const next = shiftMonth(month, 1);
  const newest = (m: string) => batches.filter((b) => b.billingMonth === m).map((b) => b.createdAt).sort().at(-1) ?? null;
  const [current, following] = [newest(month), newest(next)];
  const cutoff = new Date(Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1, 1 + GRACE_DAYS)).toISOString();
  const statements = [
    { month, imported: current !== null },
    { month: next, imported: following !== null },
  ];
  const asOf = [current, following].filter((d): d is string => d !== null).sort().at(-1) ?? null;
  if (current !== null && following !== null && following >= cutoff) return { state: "complete", asOf, statements };
  if (asOf !== null || hasPending) return { state: "partial", asOf, statements };
  return { state: "missing", asOf, statements };
}
