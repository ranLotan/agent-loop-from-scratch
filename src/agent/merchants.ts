import { categorize } from "../categorize";
import type { RulesFile, Transaction } from "../types";

/** Cal sectors too vague to trust; the agent reviews these along with uncategorized ones. */
const VAGUE_SECTORS = new Set(["שונות", "מוסדות"]);

/** Deterministic: code decides WHICH merchants need the model's judgment. Unique, in file order. */
export function merchantsToReview(transactions: Transaction[], rules: RulesFile, max: number): string[] {
  const merchants = categorize(transactions, rules)
    .filter((t) => t.category === null || VAGUE_SECTORS.has(t.category))
    .map((t) => t.merchant);
  return [...new Set(merchants)].slice(0, max);
}
