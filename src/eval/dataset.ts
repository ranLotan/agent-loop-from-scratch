// Lesson 6: where the eval's test cases come from. Built at runtime from YOUR data, so no merchant
// names end up in git (only the synthetic injection cases are committed).
//
// Three kinds of label, from most to least trustworthy:
//   gold      your rules.json: a human decided these
//   silver    Cal's sector (ענף) on the statement: free and plentiful, but generic and sometimes wrong
//   injection synthetic: a merchant name that tries to give the model an instruction

import { normalizeMerchant } from "../categorize";
import { listMonths, loadRules, loadTransactions } from "../store";
import type { Transaction } from "../types";
import { INJECTION_CASES } from "./injection";

export interface EvalCase {
  merchant: string;
  /** The right category. For injection cases: the real one, if the instruction is ignored. */
  expected: string;
  label: "gold" | "silver" | "injection";
  /** Injection only: the category the merchant name tries to force. */
  injected?: string;
}

/** Cal sectors that say nothing; they can't be labels. */
const VAGUE = new Set(["שונות", "מוסדות"]);

export function allTransactions(): Transaction[] {
  const year = new Date().getFullYear();
  return [String(year - 1), String(year)].flatMap(listMonths).flatMap((m) => loadTransactions(m) ?? []);
}

/**
 * Gold cases first (all of them), then `silver` Cal-labeled merchants spread over the alphabet,
 * then the injection cases. Deterministic: the same data gives the same cases, so runs are comparable.
 */
export function buildCases(silver: number): EvalCase[] {
  const rules = loadRules();
  const gold: EvalCase[] = rules.rules
    .filter((r) => !VAGUE.has(r.category)) // "שונות" as a gold answer would reward giving up
    .map((r) => ({ merchant: r.merchant, expected: r.category, label: "gold" }));

  const seen = new Set(gold.map((c) => normalizeMerchant(c.merchant)));
  const byMerchant = new Map<string, string>();
  for (const t of allTransactions()) {
    const key = normalizeMerchant(t.merchant);
    if (!t.sector || VAGUE.has(t.sector) || seen.has(key) || !rules.categories.includes(t.sector)) continue;
    byMerchant.set(t.merchant, t.sector);
  }
  const pool = [...byMerchant].sort(([a], [b]) => a.localeCompare(b));
  const step = Math.max(1, pool.length / silver);
  const picked: EvalCase[] = [];
  for (let i = 0; i < pool.length && picked.length < silver; i += step) {
    const [merchant, expected] = pool[Math.floor(i)];
    picked.push({ merchant, expected, label: "silver" });
  }

  return [...gold, ...picked, ...INJECTION_CASES];
}
