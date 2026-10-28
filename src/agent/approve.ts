// Lesson 5: human-in-the-loop, OUTSIDE the agent loop. Run with: npm run approve -- YYYY-MM
//
// The agent already finished (npm run agent) and saved its proposals. Now a human goes through them
// whenever they have time: no model is waiting, no tokens are spent while you think.
// Your decide() turns each answer into rules (code applies them next month) or memory notes
// (the agent reads them next run).

import { createInterface } from "node:readline/promises";
import { addRules, appendMemory, loadProposals, loadRules, saveProposals } from "../store";
import type { ProposalsFile } from "./proposals";
import { decide, formatMemoryNote, type Answer } from "./review";

const month = process.argv[2];
if (!/^\d{4}-\d{2}$/.test(month ?? "")) throw new Error("Usage: npm run approve -- YYYY-MM");

const file = loadProposals<ProposalsFile>(month);
if (!file) throw new Error(`No proposals for ${month}. Run: npm run agent -- ${month}`);

const today = new Date().toISOString().slice(0, 10);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const stats = { rules: 0, notes: 0, skipped: 0 };

function markReviewed(key: string) {
  file!.reviewed.push(key);
  saveProposals(month, file); // save after every answer, so quitting halfway loses nothing
}

async function ask(): Promise<Answer | "quit"> {
  for (;;) {
    const key = (await rl.question("  Enter = approve · c = change · n = note · s = skip · q = quit > ")).trim().toLowerCase();
    if (key === "") return { kind: "approve" };
    if (key === "s") return { kind: "skip" };
    if (key === "q") return "quit";
    if (key === "n") return { kind: "note", text: await rl.question("  note: ") };
    if (key === "c") {
      const { categories } = loadRules();
      categories.forEach((c, i) => console.log(`    ${String(i + 1).padStart(2)}. ${c}`));
      const n = Number(await rl.question("  category number: "));
      if (categories[n - 1]) return { kind: "change", category: categories[n - 1] };
      console.log("  Not a number from the list.");
    }
  }
}

// ── Category proposals ────────────────────────────────────────────────────
const pending = file.proposals.filter((p) => !file.reviewed.includes(p.merchant));
console.log(`\n${month}: ${pending.length} proposal(s) to review, ${file.flags.length} flag(s).\n`);

for (const [i, p] of pending.entries()) {
  console.log(`[${i + 1}/${pending.length}] ${p.merchant} → ${p.category} [${p.confidence}]`);
  console.log(`  ${p.reason}`);
  const answer = await ask();
  if (answer === "quit") break;

  try {
    const actions = decide(p, answer, loadRules(), today);
    addRules(actions.flatMap((a) => (a.kind === "add_rule" ? [a.rule] : [])));
    appendMemory(actions.flatMap((a) => (a.kind === "add_memory" ? [a.note] : [])));
    for (const a of actions) {
      if (a.kind === "add_rule") stats.rules++, console.log(`  ✓ rule: ${a.rule.merchant} → ${a.rule.category}`);
      else stats.notes++, console.log(`  ✓ memory: ${a.note}`);
    }
    if (answer.kind === "skip") stats.skipped++;
    else markReviewed(p.merchant); // skipped ones come back next time
  } catch (err) {
    console.log(`  ✗ ${(err as Error).message}`);
  }
  console.log();
}

// ── Exception flags: read them, optionally leave a note ───────────────────
const pendingFlags = file.flags.filter((f) => !file.reviewed.includes(f.transaction_id));
if (pendingFlags.length) console.log(`Flags (${pendingFlags.length}):\n`);
for (const f of pendingFlags) {
  const c = f.candidate;
  console.log(`${f.severity === "warning" ? "⚠" : "ℹ"} ${c.date} ${c.merchant} ${c.amount} ${c.currency}`);
  console.log(`  ${f.explanation}`);
  const key = (await rl.question("  Enter = ok · n = note (e.g. 'expected, new phone plan') · q = quit > ")).trim().toLowerCase();
  if (key === "q") break;
  if (key === "n") {
    const note = formatMemoryNote(today, c.merchant, await rl.question("  note: "));
    appendMemory([note]);
    stats.notes++;
    console.log(`  ✓ memory: ${note}`);
  }
  markReviewed(f.transaction_id);
  console.log();
}

rl.close();
console.log(`Done: ${stats.rules} rule(s) added, ${stats.notes} memory note(s), ${stats.skipped} skipped.`);
if (stats.rules) console.log(`Next run, those merchants are categorized by code: npm run report -- ${month}`);
