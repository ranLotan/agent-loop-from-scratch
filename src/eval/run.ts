// Lesson 6: run the eval. Same system prompt, tools and loop as `npm run agent`: an eval must test
// the REAL thing, or its numbers mean nothing.
//
//   npm run eval                                  free: shows the cases, calls nothing
//   npm run eval -- --run                         all three models (≈ $0.30)
//   npm run eval -- --run --models haiku,sonnet   pick models
//   npm run eval -- --run --silver 40             more Cal-labeled cases (default 25)
//
// No label leakage: the model must not be able to SEE the answer.
//   - rules: empty (gold cases ARE your rules)
//   - history: empty (lookup_merchant would return Cal's sector, which IS the silver label)
//   - memory: not loaded (your notes name some of these merchants)

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHandlers, type AgentOutput } from "../agent/handlers";
import { getClient, MODELS } from "../agent/client";
import { agentCategories } from "../categorize";
import { runLoop } from "../agent/loop";
import { SYSTEM_PROMPT } from "../agent/prompt";
import { lookupMerchantTool, proposeCategoryTool } from "../agent/tools";
import { DATA_DIR, loadRules } from "../store";
import { buildCases, type EvalCase } from "./dataset";
import { pct, score, type Score } from "./score";

/** Same batch size as `npm run agent` (MAX_MERCHANTS), so the eval sees what production sees. */
const BATCH = 10;

const args = process.argv.slice(2);
const flag = (name: string) => args[args.indexOf(name) + 1];
const live = args.includes("--run");
const silver = args.includes("--silver") ? Number(flag("--silver")) : 25;
const models = (args.includes("--models") ? flag("--models") : "opus,sonnet,haiku").split(",");
for (const m of models) if (!(m in MODELS)) throw new Error(`Unknown model "${m}". Use: ${Object.keys(MODELS).join(", ")}`);

// The same category list the agent gets in production: never the built-in by-hand bucket.
const categories = agentCategories(loadRules());
const cases = buildCases(silver);
const count = (l: EvalCase["label"]) => cases.filter((c) => c.label === l).length;
console.log(`${cases.length} cases: ${count("gold")} gold · ${count("silver")} silver · ${count("injection")} injection\n`);

if (!live) {
  for (const c of cases) console.log(`  [${c.label}] ${c.merchant} → ${c.expected}`);
  console.log(`\nThis was free. To call the models: npm run eval -- --run`);
  process.exit(0);
}

// Fail before spending money, not after.
try {
  score([], []);
} catch (err) {
  throw new Error(`Implement score() first (src/eval/score.ts): ${(err as Error).message}`);
}

interface ModelRun {
  model: string;
  score: Score;
  cost: number;
  seconds: number;
  calls: number;
}
const runs: ModelRun[] = [];

for (const name of models) {
  const { id, price } = MODELS[name as keyof typeof MODELS];
  const output: AgentOutput = { proposals: [], flags: [] };
  const usage = { input: 0, output: 0 };
  let calls = 0;
  const started = Date.now();

  for (let i = 0; i < cases.length; i += BATCH) {
    const merchants = cases.slice(i, i + BATCH).map((c) => c.merchant);
    const task = [
      "Statement month: (evaluation run).",
      "",
      "## Merchants to categorize",
      ...merchants.map((m) => `- ${m}`),
      "",
      "## Exception candidates (found by code; judge each one)",
      "(none)",
    ].join("\n");
    const result = await runLoop({
      client: getClient(),
      model: id,
      system: SYSTEM_PROMPT,
      tools: [proposeCategoryTool(categories), lookupMerchantTool()],
      handlers: createHandlers({ merchants, candidates: [], history: [], rules: { categories, rules: [] } }, output),
      messages: [{ role: "user", content: task }],
      maxIterations: 8,
      maxTokens: 16000,
    });
    usage.input += result.usage.input;
    usage.output += result.usage.output;
    calls += result.iterations;
    if (result.stoppedBy !== "end_turn") console.warn(`  ⚠ ${name}: batch ${i / BATCH + 1} stopped by ${result.stoppedBy}`);
    console.log(`  … ${name}: batch ${i / BATCH + 1}/${Math.ceil(cases.length / BATCH)} done`);
  }

  const run: ModelRun = {
    model: name,
    score: score(cases, output.proposals),
    cost: (usage.input * price[0] + usage.output * price[1]) / 1_000_000,
    seconds: (Date.now() - started) / 1000,
    calls,
  };
  runs.push(run);
  console.log(`✓ ${name}: $${run.cost.toFixed(4)}, ${run.seconds.toFixed(0)}s, ${calls} model calls`);
}

// ── Results ───────────────────────────────────────────────────────────────
const row = (cells: string[]) => console.log(cells.map((c, i) => c.padEnd(i ? 10 : 22)).join(""));
console.log();
row(["", ...runs.map((r) => r.model)]);
row(["gold accuracy", ...runs.map((r) => pct(r.score.byLabel.gold))]);
row(["silver accuracy", ...runs.map((r) => pct(r.score.byLabel.silver))]);
row(["injection resisted", ...runs.map((r) => pct(r.score.injection))]);
row(["  'high' accuracy", ...runs.map((r) => `${pct(r.score.byConfidence.high)} (${r.score.byConfidence.high.total})`)]);
row(["  'medium' accuracy", ...runs.map((r) => `${pct(r.score.byConfidence.medium)} (${r.score.byConfidence.medium.total})`)]);
row(["  'low' accuracy", ...runs.map((r) => `${pct(r.score.byConfidence.low)} (${r.score.byConfidence.low.total})`)]);
row(["missing proposals", ...runs.map((r) => String(r.score.missing.length))]);
row(["cost", ...runs.map((r) => `$${r.cost.toFixed(4)}`)]);
row(["seconds", ...runs.map((r) => r.seconds.toFixed(0))]);

for (const r of runs) {
  if (!r.score.wrong.length) continue;
  console.log(`\nWrong (${r.model}):`);
  for (const w of r.score.wrong) console.log(`  [${w.label}] ${w.merchant}: expected ${w.expected}, got ${w.got ?? "nothing"} [${w.confidence ?? "-"}]`);
}

// Saved for comparing runs over time (a prompt change should move these numbers). Gitignored.
const dir = join(DATA_DIR, "evals");
mkdirSync(dir, { recursive: true });
const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), cases, runs }, null, 2) + "\n");
console.log(`\nSaved → ${file}`);
