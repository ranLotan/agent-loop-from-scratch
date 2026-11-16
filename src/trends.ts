// Trends over several months (M7): period totals for income vs expenses, and spending per category with caps.
// Pure code over per-month ledger summaries; src/ledger-service.ts does the I/O. The dashboard adds nothing up.

import type { CategoryCap } from "./caps";
import { round2 } from "./normalize";

export interface TrendTotals {
  months: number;
  income: number;
  expenses: number;
  net: number;
  avgIncome: number;
  avgExpenses: number;
}

/** Sums and monthly averages for the period. Months with nothing in them still count in the average. */
export function trendTotals(points: { income: number; expenses: number }[]): TrendTotals {
  const income = points.reduce((sum, p) => sum + p.income, 0);
  const expenses = points.reduce((sum, p) => sum + p.expenses, 0);
  const n = points.length;
  return {
    months: n,
    income: round2(income),
    expenses: round2(expenses),
    net: round2(income - expenses),
    avgIncome: n ? round2(income / n) : 0,
    avgExpenses: n ? round2(expenses / n) : 0,
  };
}

export interface CategoryTrendRow {
  month: string;
  /** Spent per selected category (0 when nothing), by name. */
  amounts: Record<string, number>;
  /** The selected categories' total this month. */
  total: number;
  /** Selected categories over their cap this month. */
  over: string[];
}

export interface SingleCapView {
  category: string;
  cap: number;
  months: { month: string; expenses: number; cap: number; remaining: number; over: boolean }[];
  expenses: number;
  /** cap × months. */
  capTotal: number;
  /** capTotal − expenses. Negative = over for the period. */
  remaining: number;
  monthsOver: string[];
}

export interface CategoryTrend {
  /** The categories shown, in the order given, with their cap (null = none) and period total. */
  categories: { category: string; cap: number | null; total: number }[];
  rows: CategoryTrendRow[];
  /** All selected categories over the whole period. */
  total: number;
  /** Every category that can be picked: spending in the period, or a cap. Biggest period total first. */
  available: { category: string; total: number; cap: number | null }[];
  /** Set when exactly one category is selected and it has a cap: the cap view (mockup 3). */
  single: SingleCapView | null;
}

/** The single-cap view is on when exactly one category is selected and it has a cap. */
export function singleCapped(selected: string[], caps: CategoryCap[]): CategoryCap | null {
  if (selected.length !== 1) return null;
  return caps.find((c) => c.category === selected[0]) ?? null;
}

/** No selection in the URL: every capped category, or, with no caps at all, the 3 biggest of the period. */
export function defaultSelection(available: { category: string; total: number }[], caps: CategoryCap[]): string[] {
  if (caps.length) return caps.map((c) => c.category);
  return available.filter((a) => a.total > 0).slice(0, 3).map((a) => a.category);
}

/**
 * Spending per category for each month of the period. `months` are oldest first, each with its ledger
 * `byCategory`. `selected` null = the default selection. Caps are today's caps, for every month (no history).
 */
export function categoryTrend(
  months: { month: string; byCategory: { category: string; amount: number }[] }[],
  selected: string[] | null,
  caps: CategoryCap[],
): CategoryTrend {
  const capOf = new Map(caps.map((c) => [c.category, c.cap]));
  const totals = new Map<string, number>();
  for (const m of months) for (const c of m.byCategory) totals.set(c.category, (totals.get(c.category) ?? 0) + c.amount);
  for (const c of caps) if (!totals.has(c.category)) totals.set(c.category, 0);
  const available = [...totals]
    .filter(([category, total]) => total > 0 || capOf.has(category))
    .map(([category, total]) => ({ category, total: round2(total), cap: capOf.get(category) ?? null }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));

  const chosen = [...new Set(selected ?? defaultSelection(available, caps))];
  const rows = months.map(({ month, byCategory }) => {
    const spent = new Map(byCategory.map((c) => [c.category, c.amount]));
    const amounts = Object.fromEntries(chosen.map((c) => [c, round2(spent.get(c) ?? 0)]));
    return {
      month,
      amounts,
      total: round2(chosen.reduce((sum, c) => sum + amounts[c], 0)),
      over: chosen.filter((c) => capOf.has(c) && amounts[c] > capOf.get(c)!),
    };
  });
  const categories = chosen.map((category) => ({
    category,
    cap: capOf.get(category) ?? null,
    total: round2(rows.reduce((sum, r) => sum + r.amounts[category], 0)),
  }));

  const capped = singleCapped(chosen, caps);
  let single: SingleCapView | null = null;
  if (capped) {
    const { category, cap } = capped;
    const perMonth = rows.map((r) => {
      const expenses = r.amounts[category];
      return { month: r.month, expenses, cap, remaining: round2(cap - expenses), over: expenses > cap };
    });
    const expenses = round2(perMonth.reduce((sum, m) => sum + m.expenses, 0));
    const capTotal = round2(cap * rows.length);
    single = {
      category, cap, months: perMonth, expenses, capTotal,
      remaining: round2(capTotal - expenses),
      monthsOver: perMonth.filter((m) => m.over).map((m) => m.month),
    };
  }

  return { categories, rows, total: round2(categories.reduce((sum, c) => sum + c.total, 0)), available, single };
}
