// Lesson 3: the same job as propose.ts, but driven by YOUR loop. Run with: npm run agent -- YYYY-MM
//
// propose.ts hard-coded "call, run tools, call again". Here runLoop decides how many turns it
// takes; this file only supplies the tools, the handlers, and the starting message.

import type Anthropic from "@anthropic-ai/sdk";
import { loadRules, loadTransactions } from "../store";
import { client, MODEL } from "./client";
import { runLoop } from "./loop";
import { merchantsToReview } from "./merchants";
import { proposeCategoryTool, type CategoryProposal } from "./tools";

const MAX_MERCHANTS = 10;

const month = process.argv[2];
if (!/^\d{4}-\d{2}$/.test(month ?? "")) throw new Error("Usage: npm run agent -- YYYY-MM");

const transactions = loadTransactions(month);
if (!transactions) throw new Error(`No data for ${month}. Run fetch or import first.`);
const rules = loadRules();

const merchants = merchantsToReview(transactions, rules, MAX_MERCHANTS);
if (merchants.length === 0) {
  console.log("Nothing to review: every merchant has a specific category.");
  process.exit(0);
}

const proposals: CategoryProposal[] = [];

const result = await runLoop({
  client,
  model: MODEL,
  system:
    "You categorize Israeli credit card transactions by merchant name. " +
    "For EACH merchant the user lists, call propose_category exactly once. " +
    "Use low confidence when the name alone is ambiguous.",
  tools: [proposeCategoryTool(rules.categories)],
  handlers: {
    // The handler is where code is the gatekeeper: validate before accepting.
    propose_category: (input) => {
      const p = input as CategoryProposal;
      if (!merchants.includes(p.merchant)) throw new Error(`"${p.merchant}" is not in the list; use the exact name.`);
      proposals.push(p);
      return "Recorded. Awaiting human approval.";
    },
  },
  messages: [
    { role: "user", content: `Merchants to categorize:\n${merchants.map((m) => `- ${m}`).join("\n")}` },
  ] satisfies Anthropic.MessageParam[],
});

console.log(`stopped by: ${result.stoppedBy} after ${result.iterations} call(s)\n`);
for (const p of proposals) console.log(`  ${p.merchant} → ${p.category} [${p.confidence}] ${p.reason}`);
const missed = merchants.filter((m) => !proposals.some((p) => p.merchant === m));
if (missed.length) console.warn(`⚠ No proposal for: ${missed.join(", ")}`);
if (result.finalText) console.log(`\nmodel: ${result.finalText}`);

const cost = (result.usage.input * 4 + result.usage.output * 20) / 1_000_000;
console.log(`\ntokens: ${result.usage.input} in / ${result.usage.output} out → $${cost.toFixed(4)}`);
