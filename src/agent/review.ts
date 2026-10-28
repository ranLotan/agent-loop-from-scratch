// Lesson 5: what happens to a proposal after a human answers. YOUR PART: decide() and formatMemoryNote().
//
// This is the "learn" step: approved answers become RULES (exact, applied by code, no agent next time)
// or MEMORY notes (fuzzy context the agent reads). Pure functions: no files, no prompts. That makes
// them easy to test; approve.ts does the I/O.
//
// Tests: npm test (src/agent/review.test.ts). Make them green.

import { normalizeMerchant } from "../categorize";
import type { RulesFile, Rule } from "../types";
import type { CategoryProposal } from "./tools";

/** What the human answered in the approve CLI. */
export type Answer =
  | { kind: "approve" } //                            accept the model's category
  | { kind: "change"; category: string } //           the model was wrong; use this category
  | { kind: "note"; text: string } //                 no rule, just remember something about this merchant
  | { kind: "skip" }; //                              decide later

/** What to write. One answer can lead to several actions (e.g. a rule AND a note). */
export type Action = { kind: "add_rule"; rule: Rule } | { kind: "add_memory"; note: string };

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
 *
 * `today` is passed in (not new Date()) so tests get the same result every run.
 */
export function decide(p: CategoryProposal, answer: Answer, rules: RulesFile, today: string): Action[] {
  const merchant = p.merchant.trim();
  const note = (text: string): Action => ({ kind: "add_memory", note: formatMemoryNote(today, merchant, text) });

  // 6 + 7: every rule goes through here, so the checks live in one place.
  const ruleFor = (category: string): Action[] => {
    if (!rules.categories.includes(category)) throw new Error(`Unknown category: ${category}`);
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
      return [...ruleFor(answer.category), note(`model proposed ${p.category}, owner chose ${answer.category}`)];
    case "note":
      return [note(answer.text)];
    case "skip":
      return [];
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
