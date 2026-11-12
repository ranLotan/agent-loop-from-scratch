import { categorize } from "../categorize";
import type { RulesFile, Transaction } from "../types";

/**
 * Deterministic: code decides WHICH merchants need the model's judgment. Unique, in file order.
 * Only uncategorized ones: a Cal rule (even שונות → לסיווג ידני) is the owner's decision, like a merchant rule.
 * A sector with no Cal rule leaves the charge uncategorized, so it's reviewed.
 */
export function merchantsToReview(transactions: Transaction[], rules: RulesFile, max: number): string[] {
  const merchants = categorize(transactions, rules)
    .filter((t) => t.category === null)
    .map((t) => t.merchant);
  return [...new Set(merchants)].slice(0, max);
}
