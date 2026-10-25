// Lesson 2: tool definitions. YOUR PART: fill in proposeCategoryTool.
//
// A tool is a contract: the model fills in input_schema, and our code receives typed data
// instead of free text. The model never runs anything; it only *asks* (a tool_use block).

import type Anthropic from "@anthropic-ai/sdk";

/** What our code receives when the model calls propose_category. Must match your schema. */
export interface CategoryProposal {
  merchant: string;
  category: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export function proposeCategoryTool(categories: string[]): Anthropic.Tool {
  return {
    name: "propose_category",

    // TODO 1: description. This is a prompt the model reads to decide WHEN and HOW to call the tool.
    //   Say what it does, that it's called once per merchant, and what a good `reason` looks like.
    description: "Propose a spending category for one credit card merchant. Call once per merchant. The proposal is reviewed by a human before it's saved. reason: one sentence on why, citing what in the name gave it away. Use low confidence when the name alone is ambiguous (e.g. BIT, PAYBOX transfers).",

    // TODO 2: set strict: true, which makes the API guarantee the input matches the schema.
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        // TODO 3: four properties matching CategoryProposal above, each with a short description:
        //   merchant   → 
        merchant: { type: "string", description: "the name of merchant exactly as given" },
        category: { type: "string", enum: categories, description: "category from categories list in args, chosen for the merchant" },
        confidence: { type: "string", enum: ["high", "medium", "low"], description: "how much model is confidence with anwswer" },
        reason: { type: "string", description: "one short sentence explains what in the merchant name indicates a category, not found for no relation"}
      },
      // TODO 4: required: [all four], additionalProperties: false
      required: ["merchant", "category", "confidence", "reason"],
      additionalProperties: false
    },
  };
}

// ── Lesson 4: tool design ──────────────────────────────────────────────────
// The schemas are done. YOUR PART is the two descriptions: they decide WHEN the model
// reaches for a tool and how it uses it. Good descriptions say:
//   - what the tool does and what it returns
//   - when to use it (and when NOT to)
//   - whether it has side effects (read-only vs. records something)
//   - how to fill the tricky fields

export interface ExceptionFlag {
  transaction_id: string;
  severity: "info" | "warning";
  explanation: string;
}

/** Read-only: what we already know about a merchant (rule + past transactions). */
export function lookupMerchantTool(): Anthropic.Tool {
  return {
    name: "lookup_merchant",
    // TODO (lesson 4): description. Hint: it's read-only and cheap, it returns past months'
    //   charges and any existing rule. When would looking a merchant up change your answer?
    description:
      "Read-only lookup of a merchant's past charges from earlier months; it has no side effects. " +
      "Returns timesSeenBefore (0 = a new merchant), recent (its last 6 charges: date, amount, type, Cal sector) " +
      "and rule (an existing category rule, if any). Use it when history would change your judgment: an ambiguous " +
      "merchant name, or an exception candidate whose amount you want to compare with its usual charge. " +
      "Don't use it for well-known merchants whose category is obvious from the name.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "Merchant name exactly as it appears in the task." },
      },
      required: ["merchant"],
      additionalProperties: false,
    },
  };
}

/** Records a flag for the human to review. Only candidate ids found by code are allowed. */
export function flagExceptionTool(candidateIds: string[]): Anthropic.Tool {
  return {
    name: "flag_exception",
    // TODO (lesson 4): description. Hint: code already found the candidates; the model JUDGES them.
    //   Say when to flag vs. when to leave a candidate alone, what "warning" vs. "info" means,
    //   and what a useful explanation looks like for the person reading the report.
    description:
      "Flag an exception candidate as worth the human's attention in the monthly report. Code already found the " +
      "candidates by simple rules (large, new merchant, new standing order, foreign currency, possible duplicate); " +
      "your job is to judge whether each one is actually unusual. Call it only for candidates that matter, and leave " +
      "routine ones alone (e.g. a known bill that was simply large this month). " +
      "severity: 'warning' = the person should check it (possible duplicate, unexpected new subscription, a charge " +
      "far above this merchant's usual amount); 'info' = worth knowing but probably fine (a planned big purchase, trip expenses). " +
      "explanation: 1-2 sentences saying what's unusual and what to check, e.g. 'Second identical ₪120 charge on the same " +
      "day; check for a double charge.' At most one flag per candidate.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        transaction_id: { type: "string", enum: candidateIds, description: "The candidate's id." },
        severity: { type: "string", enum: ["info", "warning"] },
        explanation: { type: "string", description: "One or two sentences for the person reviewing the report." },
      },
      required: ["transaction_id", "severity", "explanation"],
      additionalProperties: false,
    },
  };
}
