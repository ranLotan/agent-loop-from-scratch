// Lesson 5: what happens to a proposal after a human answers. YOUR PART: decide() and formatMemoryNote().
//
// This is the "learn" step: approved answers become RULES (exact, applied by code, no agent next time)
// or MEMORY notes (fuzzy context the agent reads). Pure functions: no files, no prompts. That makes
// them easy to test; approve.ts does the I/O.
//
// Tests: npm test (src/agent/review.test.ts). Make them green.

import { MANUAL_CATEGORY, normalizeMerchant } from "../categorize";
import type { RulesFile, Rule } from "../types";
import type { CategoryProposal } from "./tools";

/** What the human answered in the approve CLI. */
export type Answer =
  | { kind: "approve" } //                            accept the model's category
  | { kind: "change"; category: string } //           the model was wrong; use this category
  | { kind: "note"; text: string } //                 no rule, just remember something about this merchant
  | { kind: "skip" } //                               decide later
  | { kind: "new_category"; category: string } //    none of the categories fit; create this one
  | { kind: "once"; category: string } //             right for THIS month's charges only: no rule (M4)
  | { kind: "by_hand" }; //                           never ask the agent about this merchant: I categorize each charge (M4)

/** What to write. One answer can lead to several actions (e.g. a rule AND a note). */
export type Action =
  | { kind: "add_category"; name: string }
  | { kind: "add_rule"; rule: Rule }
  | { kind: "add_memory"; note: string }
  /** Give this statement month's charges from the merchant the category, as an approved-proposal edit (no rule). */
  | { kind: "set_month_category"; merchant: string; category: string };

/**
 * The policy (the tests check each line):
 *   1. approve, confidence high/medium → add_rule with the proposed category.
 *   2. approve, confidence low → NO rule (the merchant is ambiguous, e.g. BIT: next month's charge may be
 *      something else). Instead add_memory: a note that this merchant is ambiguous and why (use p.reason).
 *   3. change → add_rule with the human's category, plus add_memory recording the correction
 *      ("model proposed X, owner chose Y"), so the agent learns from its mistake on SIMILAR merchants.
 *   4. note → add_memory with the human's text.
 *   5. skip → nothing.
 *   6. A category not in rules.categories → throw (a rule must use a known category).
 *   7. A merchant that already has a rule → no add_rule (notes are still fine).
 *   8. new_category → add_category (name trimmed) FIRST, then add_rule with it. No memory note: the rule
 *      covers this merchant and the enum shows the new category next run, so a note would only repeat them.
 *      An empty name → throw. A name that already exists → no add_category, just the rule.
 *      Careful: ruleFor checks rules.categories, which doesn't contain the new name yet.
 *   9. once → set_month_category (this statement month's charges, no rule) + a memory note. Unknown category → throw.
 *  10. by_hand → add_rule to MANUAL_CATEGORY (the merchant never reaches the agent again). Existing rule → nothing.
 *
 * `today` is passed in (not new Date()) so tests get the same result every run.
 */
export function decide(p: CategoryProposal, answer: Answer, rules: RulesFile, today: string): Action[] {
  const merchant = p.merchant.trim();
  const note = (text: string): Action => ({ kind: "add_memory", note: formatMemoryNote(today, merchant, text) });

  // 6 + 7: every rule goes through here, so the checks live in one place.
  // `allowed` lets new_category add its name without touching `rules` (decide must stay pure).
  const ruleFor = (category: string, allowed = rules.categories): Action[] => {
    if (!allowed.includes(category)) throw new Error(`Unknown category: ${category}`);
    const exists = rules.rules.some((r) => normalizeMerchant(r.merchant) === normalizeMerchant(merchant));
    return exists ? [] : [{ kind: "add_rule", rule: { merchant, category } }];
  };

  switch (answer.kind) {
    case "approve":
      if (p.confidence === "low") {
        if (!rules.categories.includes(p.category)) throw new Error(`Unknown category: ${p.category}`);
        return [note(`ambiguous merchant, approved as ${p.category} once (no rule): ${p.reason}`)];
      }
      return ruleFor(p.category);
    case "change": // TypeScript knows answer.category exists here
      // Same category as proposed = an approve; a "proposed X, chose X" note would teach nothing.
      if (answer.category === p.category) return ruleFor(p.category);
      return [...ruleFor(answer.category), note(`model proposed ${p.category}, owner chose ${answer.category}`)];
    case "note":
      return [note(answer.text)];
    case "skip":
      return [];
    case "new_category": {
      const newCategory = answer.category.trim(); // a local copy: the caller's answer stays as it was
      if (!newCategory) throw new Error("new category name is missing");
      const exists = rules.categories.includes(newCategory);
      return [
        ...(exists ? [] : [{ kind: "add_category", name: newCategory } as const]),
        ...ruleFor(newCategory, [...rules.categories, newCategory]), // a new array; rules is untouched
      ];
    }
    case "once":
      // This month's charges get the category; no rule, so next month's charge is judged again.
      // The note tells the agent what was decided, like a low-confidence approve.
      if (!rules.categories.includes(answer.category)) throw new Error(`Unknown category: ${answer.category}`);
      return [
        { kind: "set_month_category", merchant, category: answer.category },
        note(`categorized as ${answer.category} for one month only (no rule)`),
      ];
    case "by_hand":
      // A rule to the by-hand bucket: code then keeps the merchant away from the agent for good.
      return ruleFor(MANUAL_CATEGORY, [...rules.categories, MANUAL_CATEGORY]);
    default: {
      const unreachable: never = answer; // compile error if a new Answer kind is added and not handled
      throw new Error(`Unknown answer: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * One memory line. The agent reads these on every run, inside its system prompt.
 * Required format (the tests check it):   - YYYY-MM-DD | <merchant> | <text>
 * Rules: one line only (replace any newlines in text with a space), text trimmed.
 */
export function formatMemoryNote(today: string, merchant: string, text: string): string {
  // A newline would break the "one note per line" format that loadMemory relies on.
  return `- ${today} | ${merchant.trim()} | ${text.replace(/\s+/g, " ").trim()}`;
}
