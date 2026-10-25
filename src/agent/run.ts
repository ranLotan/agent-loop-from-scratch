// The agent, driven by YOUR loop. Run with: npm run agent -- YYYY-MM
//
// Lesson 3: runLoop decides how many turns it takes; this file only supplies the job.
// Lesson 4: three tools (lookup, propose, flag) and two tasks, so the model now CHOOSES
// which tool to call and when. That choice is what the descriptions and system prompt steer.

import { findCandidates } from "../candidates";
import { loadHistory, loadRules, loadTransactions } from "../store";
import { client, MODEL } from "./client";
import { createHandlers, type AgentOutput } from "./handlers";
import { runLoop } from "./loop";
import { merchantsToReview } from "./merchants";
import { SYSTEM_PROMPT } from "./prompt";
import { flagExceptionTool, lookupMerchantTool, proposeCategoryTool } from "./tools";

const MAX_MERCHANTS = 10;

const month = process.argv[2];
if (!/^\d{4}-\d{2}$/.test(month ?? "")) throw new Error("Usage: npm run agent -- YYYY-MM");

const transactions = loadTransactions(month);
if (!transactions) throw new Error(`No data for ${month}. Run fetch or import first.`);
const rules = loadRules();
const history = loadHistory(month);

// Deterministic: code decides WHAT needs judgment.
const merchants = merchantsToReview(transactions, rules, MAX_MERCHANTS);
const candidates = findCandidates(transactions, history);
if (merchants.length === 0 && candidates.length === 0) {
  console.log("Nothing for the agent: every merchant is categorized and nothing looks unusual.");
  process.exit(0);
}

const tools = [proposeCategoryTool(rules.categories), lookupMerchantTool(), flagExceptionTool(candidates.map((c) => c.id))];
const missingDocs = tools.filter((t) => !t.description).map((t) => t.name);
if (!SYSTEM_PROMPT.trim() || missingDocs.length) {
  throw new Error(`Finish the lesson 4 TODOs first: ${[...missingDocs, ...(SYSTEM_PROMPT.trim() ? [] : ["SYSTEM_PROMPT"])].join(", ")}`);
}

const task = [
  `Statement month: ${month}.`,
  "",
  "## Merchants to categorize",
  ...(merchants.length ? merchants.map((m) => `- ${m}`) : ["(none)"]),
  "",
  "## Exception candidates (found by code; judge each one)",
  ...(candidates.length
    ? candidates.map((c) => `- id=${c.id} | ${c.date} | ${c.merchant} | ${c.amount} ${c.currency} | ${c.reasons.join(", ")}`)
    : ["(none)"]),
].join("\n");

const output: AgentOutput = { proposals: [], flags: [] };

const result = await runLoop({
  client,
  model: MODEL,
  system: SYSTEM_PROMPT,
  tools,
  handlers: createHandlers({ merchants, candidates, history, rules }, output),
  messages: [{ role: "user", content: task }],
  maxIterations: 15,
});

// Which tools did the model call, and how often? (the interesting part of lesson 4)
const calls: Record<string, number> = {};
for (const m of result.messages) {
  if (m.role !== "assistant" || typeof m.content === "string") continue;
  for (const b of m.content) if (b.type === "tool_use") calls[b.name] = (calls[b.name] ?? 0) + 1;
}

console.log(`stopped by: ${result.stoppedBy} after ${result.iterations} call(s) | tool calls: ${JSON.stringify(calls)}\n`);

console.log(`Proposals (${output.proposals.length}/${merchants.length}):`);
for (const p of output.proposals) console.log(`  ${p.merchant} → ${p.category} [${p.confidence}] ${p.reason}`);
const missed = merchants.filter((m) => !output.proposals.some((p) => p.merchant === m));
if (missed.length) console.warn(`  ⚠ No proposal for: ${missed.join(", ")}`);

console.log(`\nFlags (${output.flags.length} of ${candidates.length} candidates):`);
for (const f of output.flags) {
  const c = candidates.find((x) => x.id === f.transaction_id)!;
  console.log(`  ${f.severity === "warning" ? "⚠" : "ℹ"} ${c.date} ${c.merchant} ${c.amount} ${c.currency}: ${f.explanation}`);
}

if (result.finalText) console.log(`\nmodel: ${result.finalText}`);
const cost = (result.usage.input * 4 + result.usage.output * 20) / 1_000_000;
console.log(`\ntokens: ${result.usage.input} in / ${result.usage.output} out → $${cost.toFixed(4)}`);
