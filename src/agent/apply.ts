// Applying the owner's answers (M4): the one place answers turn into writes, for the CLI (approve.ts)
// and the dashboard (the API). The policy itself stays in decide() (review.ts), which is pure.

import {
  addCategories,
  addRules,
  appendMemory,
  asOneChange,
  getFlag,
  getProposal,
  loadRules,
  recordFlagAnswer,
  recordProposalAnswer,
  getTransaction,
  setChargeCategory,
  setMonthCategory,
  ConflictError,
  ValidationError,
  type FlagRow,
  type ProposalRow,
  type ProposalStatus,
} from "../store";
import { normalizeMerchant } from "../categorize";
import { decide, formatMemoryNote, type Action, type Answer } from "./review";

/** How an answer is recorded. "skip" isn't recorded at all: the proposal stays pending and comes back. */
const STATUS: Record<Exclude<Answer["kind"], "skip">, Exclude<ProposalStatus, "pending">> = {
  approve: "approved",
  change: "changed",
  new_category: "new_category",
  note: "noted",
  once: "answered",
  by_hand: "answered",
  per_charge: "answered",
};

export interface AppliedAnswer {
  proposal: ProposalRow;
  actions: Action[];
  /** Charges that got a category from this answer ("once" or "per_charge"). */
  chargesUpdated: number;
}

/**
 * Applies one answer to one proposal: decide() says what to write, this writes it, all or nothing.
 * Categories first, because a new rule may use a category created by the same answer.
 */
export function applyAnswer(proposalId: number, answer: Answer, today = new Date().toISOString().slice(0, 10)): AppliedAnswer {
  return asOneChange(() => {
    const proposal = getProposal(proposalId);
    if (proposal.status !== "pending") throw new ConflictError(`"${proposal.merchant}" was already answered`);

    const actions = decide(
      { merchant: proposal.merchant, category: proposal.category, confidence: proposal.confidence, reason: proposal.reason, new_category_idea: proposal.newCategoryIdea },
      answer,
      loadRules(),
      today,
    );
    addCategories(actions.flatMap((a) => (a.kind === "add_category" ? [a.name] : [])));
    addRules(actions.flatMap((a) => (a.kind === "add_rule" ? [a.rule] : [])));
    let chargesUpdated = 0;
    for (const a of actions) {
      if (a.kind === "set_month_category") chargesUpdated += setMonthCategory(proposal.month, a.merchant, a.category);
      if (a.kind === "set_charge_category") {
        // The ids come from the request: only this merchant's charges on this statement may be touched.
        const t = getTransaction(a.transactionId);
        if (!t || t.billingMonth !== proposal.month || normalizeMerchant(t.merchant) !== normalizeMerchant(proposal.merchant)) {
          throw new ValidationError(`${a.transactionId} is not a "${proposal.merchant}" charge on the ${proposal.month} statement`);
        }
        setChargeCategory(a.transactionId, a.category);
        chargesUpdated++;
      }
    }
    appendMemory(actions.flatMap((a) => (a.kind === "add_memory" ? [a.note] : [])));

    if (answer.kind !== "skip") recordProposalAnswer(proposalId, STATUS[answer.kind], answer);
    return { proposal: getProposal(proposalId), actions, chargesUpdated };
  });
}

export type FlagAnswer = { kind: "ok" } | { kind: "note"; text: string };

/** Answers an exception flag: "ok" (seen), or a note the agent reads next time (e.g. "expected, new phone plan"). */
export function answerFlag(flagId: number, answer: FlagAnswer, today = new Date().toISOString().slice(0, 10)): FlagRow {
  return asOneChange(() => {
    const flag = getFlag(flagId);
    if (flag.status !== "pending") throw new ConflictError(`This flag on "${flag.merchant}" was already answered`);
    if (answer.kind === "note") appendMemory([formatMemoryNote(today, flag.merchant, answer.text)]);
    recordFlagAnswer(flagId, answer.kind === "note" ? "noted" : "ok");
    return getFlag(flagId);
  });
}
