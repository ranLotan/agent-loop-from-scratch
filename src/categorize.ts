import type { CategorizedTransaction, RulesFile, Transaction } from "./types";

/** Cosmetic differences (case, extra spaces) shouldn't break an exact match. */
export function normalizeMerchant(name: string): string {
  return name.replace(/\s+/g, " ").trim().toUpperCase();
}

/** Catch typos like "מסעדה" vs "מסעדות" before they silently split a category. */
export function validateRules(rules: RulesFile): void {
  const known = new Set(rules.categories);
  const bad = rules.rules.filter((r) => !known.has(r.category));
  if (bad.length) {
    const list = bad.map((r) => `  "${r.merchant}" → "${r.category}"`).join("\n");
    throw new Error(`rules.json has rules with unknown categories (add them to "categories"):\n${list}`);
  }
}

/**
 * Pure code, no agent. Priority: your rule → Cal's sector (ענף) → null.
 * Rules win because they are your explicit decisions; Cal's sector is a generic default.
 */
export function categorize(transactions: Transaction[], rules: RulesFile): CategorizedTransaction[] {
  const byMerchant = new Map(rules.rules.map((r) => [normalizeMerchant(r.merchant), r.category]));
  return transactions.map((t) => {
    const ruled = byMerchant.get(normalizeMerchant(t.merchant));
    if (ruled) return { ...t, category: ruled, categorySource: "rule" };
    if (t.sector) return { ...t, category: t.sector, categorySource: "cal" };
    return { ...t, category: null, categorySource: null };
  });
}
