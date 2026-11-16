// Monthly category caps (M7): spent vs cap per category. Pure code; the numbers come from the ledger summary,
// so "spent" is exactly what the pie shows (counted shekel expenses by ledger month, refunds included).

import { round2 } from "./normalize";

export interface CategoryCap {
  category: string;
  /** Monthly cap in ILS, above 0. */
  cap: number;
}

export interface CapUsage {
  category: string;
  cap: number;
  spent: number;
  /** cap − spent. Negative = over the cap by that much. */
  remaining: number;
  /** Spent above the cap. Spent exactly at the cap is on track. */
  over: boolean;
  /** spent / cap in whole percent, not clamped (130 = 30% over). For the progress bar. */
  usedPercent: number;
}

/**
 * One row per capped category, in the order of `byCategory` (biggest spending first), then capped categories
 * with no spending this month (spent 0). Categories without a cap aren't in the result.
 */
export function capUsage(byCategory: { category: string; amount: number }[], caps: CategoryCap[]): CapUsage[] {
  const spentOf = new Map(byCategory.map((c) => [c.category, c.amount]));
  const order = new Map(byCategory.map((c, i) => [c.category, i]));
  return caps
    .map(({ category, cap }) => {
      const spent = round2(spentOf.get(category) ?? 0);
      return { category, cap, spent, remaining: round2(cap - spent), over: spent > cap, usedPercent: Math.round((spent / cap) * 100) };
    })
    .sort((a, b) => (order.get(a.category) ?? Infinity) - (order.get(b.category) ?? Infinity) || a.category.localeCompare(b.category));
}

export interface CapsSummary {
  usage: CapUsage[];
  onTrack: number;
  exceeded: number;
  /** The sum of all caps ("₪3,700 capped"). */
  total: number;
}

export function summarizeCaps(usage: CapUsage[]): CapsSummary {
  return {
    usage,
    onTrack: usage.filter((u) => !u.over).length,
    exceeded: usage.filter((u) => u.over).length,
    total: round2(usage.reduce((sum, u) => sum + u.cap, 0)),
  };
}
