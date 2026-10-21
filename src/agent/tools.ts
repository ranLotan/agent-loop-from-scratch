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
