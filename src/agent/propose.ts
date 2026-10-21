// Lesson 2: one tool round trip by hand. Run with: npm run propose -- YYYY-MM
//
//   call 1: user lists merchants      → model replies with tool_use blocks (stop_reason "tool_use")
//   code:   execute each tool_use     → build tool_result blocks (matched by tool_use_id)
//   call 2: send results back         → model wraps up (stop_reason "end_turn")
//
// Lesson 3 turns this into a loop that repeats until the model stops asking for tools.

import type Anthropic from "@anthropic-ai/sdk";
import { categorize } from "../categorize";
import { loadRules, loadTransactions } from "../store";
import { client, MODEL } from "./client";
import { proposeCategoryTool, type CategoryProposal } from "./tools";

/** Cal sectors too vague to trust; the agent reviews these along with uncategorized ones. */
const VAGUE_SECTORS = new Set(["שונות", "מוסדות"]);
const MAX_MERCHANTS = 5;

const month = process.argv[2];
if (!/^\d{4}-\d{2}$/.test(month ?? "")) throw new Error("Usage: npm run propose -- YYYY-MM [--trace]");
/** --trace prints the raw messages sent and the content blocks received on every call. */
const TRACE = process.argv.includes("--trace");

const transactions = loadTransactions(month);
if (!transactions) throw new Error(`No data for ${month}. Run fetch or import first.`);
const rules = loadRules();

// Deterministic part: code decides WHICH merchants need judgment.
const merchants = [
  ...new Set(
    categorize(transactions, rules)
      .filter((t) => t.category === null || VAGUE_SECTORS.has(t.category))
      .map((t) => t.merchant),
  ),
].slice(0, MAX_MERCHANTS);

if (merchants.length === 0) {
  console.log("Nothing to review: every merchant has a specific category.");
  process.exit(0);
}

const tools = [proposeCategoryTool(rules.categories)];
const system =
  "You categorize Israeli credit card transactions by merchant name. " +
  "For EACH merchant the user lists, call propose_category exactly once. " +
  "Use low confidence when the name alone is ambiguous.";

const messages: Anthropic.MessageParam[] = [
  { role: "user", content: `Merchants to categorize:\n${merchants.map((m) => `- ${m}`).join("\n")}` },
];

let inputTokens = 0;
let outputTokens = 0;

async function call(): Promise<Anthropic.Message> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system,
    tools,
    tool_choice: { type: "auto" }, // Opus 5.5 rejects forced "any"/"tool", so code checks the call happened
    // Opus 5.5 always thinks; by default the text is omitted (empty). --trace asks for a readable summary.
    ...(TRACE && { thinking: { type: "adaptive", display: "summarized" } }),
    messages,
  });
  inputTokens += response.usage.input_tokens;
  outputTokens += response.usage.output_tokens;
  if (TRACE) {
    console.log(`\n>>> SENT messages (${messages.length}):\n${JSON.stringify(messages, null, 2)}`);
    console.log(`\n<<< RECEIVED content (stop_reason ${response.stop_reason}):\n${JSON.stringify(response.content, null, 2)}`);
  }
  return response;
}

// ── Call 1 ────────────────────────────────────────────────────────────────
const first = await call();
console.log(`call 1 stop_reason: ${first.stop_reason}`);

if (first.stop_reason === "max_tokens" || first.stop_reason === "refusal") {
  throw new Error(`Stopped early (${first.stop_reason}); not running any tools from a cut-off turn.`);
}

const toolUses = first.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
if (toolUses.length === 0) {
  console.warn("⚠ The model answered without calling the tool. tool_choice auto doesn't guarantee a call.");
  process.exit(1);
}

// ── Execute: OUR code runs the "tool". Here it just records the proposal. ──
const proposals: CategoryProposal[] = [];
const results: Anthropic.ToolResultBlockParam[] = toolUses.map((use) => {
  if (use.name !== "propose_category") {
    return { type: "tool_result", tool_use_id: use.id, is_error: true, content: `Unknown tool: ${use.name}` };
  }
  const proposal = use.input as CategoryProposal;
  proposals.push(proposal);
  return { type: "tool_result", tool_use_id: use.id, content: "Recorded. Awaiting human approval." };
});

console.log(`\n${proposals.length} proposal(s) for ${merchants.length} merchant(s):`);
for (const p of proposals) {
  console.log(`  ${p.merchant} → ${p.category} [${p.confidence}] ${p.reason}`);
}
const missed = merchants.filter((m) => !proposals.some((p) => p.merchant === m));
if (missed.length) console.warn(`⚠ No proposal for: ${missed.join(", ")}`);

// ── Call 2: assistant turn (with its tool_use blocks) + our tool_results ──
messages.push({ role: "assistant", content: first.content });
messages.push({ role: "user", content: results });

const second = await call();
console.log(`\ncall 2 stop_reason: ${second.stop_reason}`);
for (const block of second.content) {
  if (block.type === "text") console.log(`model: ${block.text}`);
}

const cost = (inputTokens * 4 + outputTokens * 20) / 1_000_000;
console.log(`\ntokens: ${inputTokens} in / ${outputTokens} out → $${cost.toFixed(4)}`);
