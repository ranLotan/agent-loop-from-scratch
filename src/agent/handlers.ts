// Tool implementations (plumbing). Each handler validates its input, does the work in plain code,
// and returns a string for the model. Throwing becomes an is_error result in the loop (lesson 3).

import { normalizeMerchant } from "../categorize";
import type { Candidate } from "../candidates";
import type { RulesFile, Transaction } from "../types";
import type { ToolHandlers } from "./loop";
import type { CategoryProposal, ExceptionFlag } from "./tools";

export interface AgentContext {
  merchants: string[]; // to categorize
  candidates: Candidate[]; // to judge
  history: Transaction[]; // earlier months
  rules: RulesFile;
}

export interface AgentOutput {
  proposals: CategoryProposal[];
  flags: ExceptionFlag[];
}

export function createHandlers(ctx: AgentContext, out: AgentOutput): ToolHandlers {
  return {
    propose_category: (input) => {
      const p = input as CategoryProposal;
      if (!ctx.merchants.includes(p.merchant)) throw new Error(`"${p.merchant}" is not in the list; use the exact name.`);
      if (out.proposals.some((x) => x.merchant === p.merchant)) throw new Error(`Already proposed "${p.merchant}".`);
      out.proposals.push(p);
      return "Recorded. Awaiting human approval.";
    },

    lookup_merchant: (input) => {
      const { merchant } = input as { merchant: string };
      const key = normalizeMerchant(merchant);
      const rule = ctx.rules.rules.find((r) => normalizeMerchant(r.merchant) === key);
      const past = ctx.history.filter((t) => normalizeMerchant(t.merchant) === key);
      return JSON.stringify({
        merchant,
        rule: rule?.category ?? null,
        timesSeenBefore: past.length,
        recent: past.slice(-6).map((t) => ({ date: t.date, amount: t.amount, currency: t.currency, type: t.type, calSector: t.sector })),
      });
    },

    flag_exception: (input) => {
      const f = input as ExceptionFlag;
      if (!ctx.candidates.some((c) => c.id === f.transaction_id)) throw new Error(`Unknown transaction_id ${f.transaction_id}.`);
      out.flags.push(f);
      return "Flagged for the report.";
    },
  };
}
