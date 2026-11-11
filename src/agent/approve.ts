// Lesson 5: human-in-the-loop, OUTSIDE the agent loop. Run with: npm run approve -- YYYY-MM
//
// The agent already finished and saved its proposals. A human goes through them whenever they have time:
// no model is waiting, no tokens are spent while you think. Each answer goes through applyAnswer()
// (apply.ts), the same code the dashboard's Review page uses, and is saved at once, so quitting loses nothing.

import { createInterface } from "node:readline/promises";
import { isMonth } from "../normalize";
import { listFlags, listProposals, loadRules, type ProposalRow } from "../store";
import { answerFlag, applyAnswer } from "./apply";
import type { Answer } from "./review";

const month = process.argv[2];
if (!isMonth(month ?? "")) throw new Error("Usage: npm run approve -- YYYY-MM");

const proposals = listProposals(month);
if (!proposals.length) throw new Error(`No proposals for ${month}. Run: npm run agent -- ${month}`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
// Without a keyboard (e.g. run through `!` in Claude Code) stdin ends at once: treat that as quit, not a hang.
let inputEnded = false;
const ended = new Promise<null>((resolve) => rl.once("close", () => ((inputEnded = true), resolve(null))));
const prompt = (question: string) => Promise.race([rl.question(question), ended]);
const stats = { categories: 0, rules: 0, notes: 0, months: 0, skipped: 0 };

async function ask(p: ProposalRow): Promise<Answer | "quit"> {
  for (;;) {
    const key = await prompt(
      "  Enter = approve (rule) · c = change · + = new category · o = this month only · h = always by hand\n" +
        "  n = note · s = skip · q = quit > ",
    );
    if (key === null) return "quit";
    const k = key.trim().toLowerCase();
    if (k === "") return { kind: "approve" };
    if (k === "s") return { kind: "skip" };
    if (k === "q") return "quit";
    if (k === "o") return { kind: "once", category: p.category };
    if (k === "h") return { kind: "by_hand" };
    if (k === "n") {
      const text = await prompt("  note: ");
      if (text === null) return "quit";
      return { kind: "note", text };
    }
    if (k === "+") {
      const idea = p.newCategoryIdea ?? "";
      const typed = await prompt(`  new category name${idea ? ` [Enter = ${idea}]` : ""}: `);
      if (typed === null) return "quit";
      const name = typed.trim() || idea;
      if (name) return { kind: "new_category", category: name };
      console.log("  No name given.");
    }
    if (k === "c") {
      const { categories } = loadRules();
      categories.forEach((c, i) => console.log(`    ${String(i + 1).padStart(2)}. ${c}`));
      const typed = await prompt("  category number: ");
      if (typed === null) return "quit";
      const chosen = categories[Number(typed) - 1];
      if (chosen) return { kind: "change", category: chosen };
      console.log("  Not a number from the list.");
    }
  }
}

// ── Category proposals ────────────────────────────────────────────────────
const pending = proposals.filter((p) => p.status === "pending");
const pendingFlags = listFlags(month).filter((f) => f.status === "pending");
console.log(`\n${month}: ${pending.length} proposal(s) to review, ${pendingFlags.length} flag(s).\n`);

let quit = false;
for (const [i, p] of pending.entries()) {
  console.log(`[${i + 1}/${pending.length}] ${p.merchant} → ${p.category} [${p.confidence}]`);
  console.log(`  ${p.reason}`);
  if (p.newCategoryIdea) console.log(`  💡 suggested new category: ${p.newCategoryIdea}  (press + to create it)`);
  const answer = await ask(p);
  if (answer === "quit") {
    quit = true;
    break;
  }
  try {
    const { actions, chargesUpdated } = applyAnswer(p.id, answer);
    for (const a of actions) {
      if (a.kind === "add_category") stats.categories++, console.log(`  ✓ category: ${a.name}`);
      else if (a.kind === "add_rule") stats.rules++, console.log(`  ✓ rule: ${a.rule.merchant} → ${a.rule.category}`);
      else if (a.kind === "add_memory") stats.notes++, console.log(`  ✓ memory: ${a.note}`);
      else stats.months++, console.log(`  ✓ ${chargesUpdated} charge(s) this month → ${a.category} (no rule)`);
    }
    if (answer.kind === "skip") stats.skipped++; // stays pending: it comes back next time
  } catch (err) {
    console.log(`  ✗ ${(err as Error).message}`);
  }
  console.log();
}

// ── Exception flags: read them, optionally leave a note ───────────────────
if (!quit && pendingFlags.length) console.log(`Flags (${pendingFlags.length}):\n`);
for (const f of quit ? [] : pendingFlags) {
  console.log(`${f.severity === "warning" ? "⚠" : "ℹ"} ${f.date} ${f.merchant} ${f.amount} ${f.currency}`);
  console.log(`  ${f.explanation}`);
  const key = await prompt("  Enter = ok · n = note (e.g. 'expected, new phone plan') · q = quit > ");
  if (key === null || key.trim().toLowerCase() === "q") break;
  if (key.trim().toLowerCase() === "n") {
    const text = await prompt("  note: ");
    if (text === null) break;
    answerFlag(f.id, { kind: "note", text });
    stats.notes++;
    console.log("  ✓ memory note saved");
  } else answerFlag(f.id, { kind: "ok" });
  console.log();
}

rl.close();
if (inputEnded && pending.length + pendingFlags.length > 0 && !stats.rules && !stats.notes && !stats.months) {
  console.log("No keyboard input (this needs a terminal you can type in). Nothing was changed.");
}
console.log(
  `Done: ${stats.categories} new categor${stats.categories === 1 ? "y" : "ies"}, ${stats.rules} rule(s), ` +
    `${stats.months} one-month answer(s), ${stats.notes} memory note(s), ${stats.skipped} skipped.`,
);
if (stats.rules) console.log(`Those merchants are now categorized by code: npm run report -- ${month}`);
