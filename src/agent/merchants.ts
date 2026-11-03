import { categorize } from "../categorize";
import type { RulesFile, Transaction } from "../types";

/** Cal sectors too vague to trust; the agent reviews these along with uncategorized ones. */
const VAGUE_SECTORS = new Set(["שונות", "מוסדות"]);

/**
 * Deterministic: code decides WHICH merchants need the model's judgment. Unique, in file order.
 * A vague category counts only when it's CAL's sector: if the owner's rule says שונות, that's a decision.
 */
export function merchantsToReview(transactions: Transaction[], rules: RulesFile, max: number): string[] {
  const merchants = categorize(transactions, rules)
    .filter((t) => t.category === null || (t.categorySource === "cal" && VAGUE_SECTORS.has(t.category)))
    .map((t) => t.merchant);
  return [...new Set(merchants)].slice(0, max);
}
