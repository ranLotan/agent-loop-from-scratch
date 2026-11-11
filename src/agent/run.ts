// The agent from the command line. Run with: npm run agent -- YYYY-MM
//
// The work is runAgent() in service.ts (the same one the dashboard runs); this file only prints.
// Lesson 3: runLoop decides how many turns it takes. Lesson 4: three tools, and the model CHOOSES which to call.

import { isMonth } from "../normalize";
import { getClient, MODEL } from "./client";
import { runAgent } from "./service";

const month = process.argv[2];
if (!isMonth(month ?? "")) throw new Error("Usage: npm run agent -- YYYY-MM");

const r = await runAgent({ month, client: getClient(), model: MODEL });
if (r.nothingToDo) {
  console.log("Nothing for the agent: every merchant is categorized and nothing looks unusual.");
  process.exit(0);
}

console.log(`model: ${r.model} | stopped by: ${r.stoppedBy} after ${r.iterations} call(s) | tool calls: ${JSON.stringify(r.toolCalls)}\n`);

console.log(`Proposals (${r.proposals.length}/${r.merchants.length}):`);
for (const p of r.proposals) {
  console.log(`  ${p.merchant} → ${p.category} [${p.confidence}] ${p.reason}`);
  if (p.new_category_idea) console.log(`    💡 new category idea: ${p.new_category_idea}`);
}
if (r.missed.length) console.warn(`  ⚠ No proposal for: ${r.missed.join(", ")}`);

console.log(`\nFlags (${r.flags.length} of ${r.candidates.length} candidates):`);
for (const f of r.flags) {
  const c = f.candidate;
  console.log(`  ${f.severity === "warning" ? "⚠" : "ℹ"} ${c.date} ${c.merchant} ${c.amount} ${c.currency}: ${f.explanation}`);
}

if (r.finalText) console.log(`\nmodel: ${r.finalText}`);
console.log(`\ntokens: ${r.usage.input} in / ${r.usage.output} out → $${r.cost.toFixed(4)}`);
console.log(`\nSaved for review (${r.memoryNotes} memory note(s) were in the prompt).`);
console.log(`Next: npm run approve -- ${month}   (or the Review page in the dashboard)`);
