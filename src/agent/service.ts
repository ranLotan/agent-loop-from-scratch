// The agent run as a service (M4): inputs as parameters, a result returned. `npm run agent` prints it;
// the API runs it as a background job. Same prompt, tools, handlers and loop as before.

import { findCandidates, type Candidate } from "../candidates";
import { agentCategories } from "../categorize";
import { loadHistory, loadMemory, loadRules, loadTransactions, NotFoundError, saveProposals } from "../store";
import { costOf, MODEL } from "./client";
import { createHandlers, type AgentOutput } from "./handlers";
import { runLoop, type LoopResult, type ModelClient } from "./loop";
import { merchantsToReview } from "./merchants";
import { SYSTEM_PROMPT } from "./prompt";
import type { ExceptionFlag } from "./tools";
import { flagExceptionTool, lookupMerchantTool, proposeCategoryTool } from "./tools";

export interface AgentRunOptions {
  month: string;
  /** The real SDK client (getClient()), or a fake one in tests. */
  client: ModelClient;
  model?: string;
  maxMerchants?: number;
  /** Only the newest notes go into the prompt: memory must stay bounded, it's paid on every call. */
  maxMemoryNotes?: number;
}

export interface AgentRunResult {
  month: string;
  model: string;
  /** Every merchant was categorized and nothing looked unusual: the model wasn't called and nothing was saved. */
  nothingToDo: boolean;
  merchants: string[];
  candidates: Candidate[];
  proposals: AgentOutput["proposals"];
  flags: (ExceptionFlag & { candidate: Candidate })[];
  /** Merchants the model didn't propose anything for. */
  missed: string[];
  stoppedBy: LoopResult["stoppedBy"] | null;
  iterations: number;
  toolCalls: Record<string, number>;
  usage: { input: number; output: number };
  cost: number;
  memoryNotes: number;
  finalText: string;
}

export async function runAgent({ month, client, model = MODEL, maxMerchants = 10, maxMemoryNotes = 50 }: AgentRunOptions): Promise<AgentRunResult> {
  const transactions = loadTransactions(month);
  if (!transactions) throw new NotFoundError(`No transactions for ${month}. Fetch or import it first.`);
  const rules = loadRules();
  const history = loadHistory(month);

  // Deterministic: code decides WHAT needs judgment. Merchants with a rule (including the by-hand bucket) never get here.
  const merchants = merchantsToReview(transactions, rules, maxMerchants);
  const candidates = findCandidates(transactions, history);
  const empty = { month, model, merchants, candidates, proposals: [], flags: [], missed: [], toolCalls: {}, usage: { input: 0, output: 0 } };
  if (merchants.length === 0 && candidates.length === 0) {
    return { ...empty, nothingToDo: true, stoppedBy: null, iterations: 0, cost: 0, memoryNotes: 0, finalText: "" };
  }

  const tools = [
    proposeCategoryTool(agentCategories(rules)), // the by-hand bucket is a human-only choice
    lookupMerchantTool(),
    flagExceptionTool(candidates.map((c) => c.id)),
  ];
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

  // Long-term memory: notes the owner approved in earlier reviews.
  const memory = loadMemory().slice(-maxMemoryNotes);
  const system = memory.length
    ? `${SYSTEM_PROMPT}\n\n## Notes from past reviews (written by the owner; trust these)\n${memory.join("\n")}`
    : SYSTEM_PROMPT;

  const output: AgentOutput = { proposals: [], flags: [] };
  const result = await runLoop({
    client,
    model,
    system,
    tools,
    handlers: createHandlers({ merchants, candidates, history, rules }, output),
    messages: [{ role: "user", content: task }],
    maxIterations: 15,
  });

  const toolCalls: Record<string, number> = {};
  for (const m of result.messages) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    for (const b of m.content) if (b.type === "tool_use") toolCalls[b.name] = (toolCalls[b.name] ?? 0) + 1;
  }
  const flags = output.flags.map((f) => ({ ...f, candidate: candidates.find((c) => c.id === f.transaction_id)! }));

  // Saved for review. Nothing becomes a rule, a note or an edit until the owner answers.
  saveProposals(
    month,
    { month, createdAt: new Date().toISOString(), model, proposals: output.proposals, flags, reviewed: [] },
    { stoppedBy: result.stoppedBy, iterations: result.iterations, inputTokens: result.usage.input, outputTokens: result.usage.output },
  );

  return {
    ...empty,
    nothingToDo: false,
    proposals: output.proposals,
    flags,
    missed: merchants.filter((m) => !output.proposals.some((p) => p.merchant === m)),
    stoppedBy: result.stoppedBy,
    iterations: result.iterations,
    toolCalls,
    usage: result.usage,
    cost: costOf(model, result.usage),
    memoryNotes: memory.length,
    finalText: result.finalText,
  };
}
