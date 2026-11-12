import type { CategorizedTransaction, RulesFile, Transaction } from "./types";

/**
 * The built-in "to categorize by hand" bucket (migration 003). A rule to it means: this merchant (e.g. a BIT
 * transfer) is never sent to the agent, and each charge waits for the owner's own edit. Protected from rename/delete.
 */
export const MANUAL_CATEGORY = "לסיווג ידני";

/** The categories the agent may propose: everything except the by-hand bucket, which only a human chooses. */
export function agentCategories(rules: RulesFile): string[] {
  return rules.categories.filter((c) => c !== MANUAL_CATEGORY);
}

/** Cosmetic differences (case, extra spaces) shouldn't break an exact match. */
export function normalizeMerchant(name: string): string {
  return name.replace(/\s+/g, " ").trim().toUpperCase();
}

/** Catch typos like "מסעדה" vs "מסעדות" before they silently split a category. */
export function validateRules(rules: RulesFile): void {
  const known = new Set(rules.categories);
  const bad = [
    ...rules.rules.filter((r) => !known.has(r.category)).map((r) => `  "${r.merchant}" → "${r.category}"`),
    ...(rules.calRules ?? []).filter((r) => !known.has(r.category)).map((r) => `  Cal sector "${r.sector}" → "${r.category}"`),
  ];
  if (bad.length) {
    const list = bad.join("\n");
    throw new Error(`Some rules use unknown categories (add the categories first):\n${list}`);
  }
}

/**
 * Pure code, no agent. Priority: your edit on this transaction → your rule → your Cal rule for its sector (ענף) → null.
 * An edit is about one charge, a rule about every charge of a merchant, a Cal rule about a whole sector:
 * the most specific decision wins. A sector with no Cal rule stays uncategorized, so it reaches the agent.
 */
export function categorize(transactions: Transaction[], rules: RulesFile): CategorizedTransaction[] {
  const byMerchant = new Map(rules.rules.map((r) => [normalizeMerchant(r.merchant), r.category]));
  const bySector = new Map((rules.calRules ?? []).map((r) => [r.sector, r.category]));
  return transactions.map((t) => {
    if (t.categoryOverride) return { ...t, category: t.categoryOverride, categorySource: t.overrideSource ?? "manual" };
    const ruled = byMerchant.get(normalizeMerchant(t.merchant));
    if (ruled) return { ...t, category: ruled, categorySource: "rule" };
    const mapped = t.sector ? bySector.get(t.sector) : undefined;
    if (mapped) return { ...t, category: mapped, categorySource: "cal" };
    return { ...t, category: null, categorySource: null };
  });
}
