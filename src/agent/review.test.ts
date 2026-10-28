import assert from "node:assert/strict";
import { test } from "node:test";
import type { RulesFile } from "../types";
import { decide, formatMemoryNote } from "./review";
import type { CategoryProposal } from "./tools";

const TODAY = "2026-10-28";
const rules: RulesFile = {
  categories: ["פנאי בילוי", "שונות", "רפואה ובריאות"],
  rules: [{ merchant: "Netflix", category: "פנאי בילוי" }],
};
const proposal = (merchant: string, confidence: CategoryProposal["confidence"], category = "פנאי בילוי"): CategoryProposal => ({
  merchant,
  category,
  confidence,
  reason: "Streaming subscription.",
});

test("formatMemoryNote: one line, '- date | merchant | text', trimmed", () => {
  assert.equal(formatMemoryNote(TODAY, "BIT", "  ambiguous\ntransfer app "), "- 2026-10-28 | BIT | ambiguous transfer app");
});

test("1. approve with high/medium confidence → a rule", () => {
  for (const c of ["high", "medium"] as const) {
    assert.deepEqual(decide(proposal("Disney Plus", c), { kind: "approve" }, rules, TODAY), [
      { kind: "add_rule", rule: { merchant: "Disney Plus", category: "פנאי בילוי" } },
    ]);
  }
});

test("2. approve with low confidence → no rule, a memory note that it's ambiguous", () => {
  const actions = decide(proposal("BIT", "low", "שונות"), { kind: "approve" }, rules, TODAY);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, "add_memory");
  if (actions[0].kind === "add_memory") {
    assert.match(actions[0].note, /^- 2026-10-28 \| BIT \| /);
    assert.match(actions[0].note, /ambiguous/i);
  }
});

test("3. change → a rule with the human's category, plus a note about the correction", () => {
  const actions = decide(proposal("רונן כהן יוגא", "medium"), { kind: "change", category: "רפואה ובריאות" }, rules, TODAY);
  assert.deepEqual(actions[0], { kind: "add_rule", rule: { merchant: "רונן כהן יוגא", category: "רפואה ובריאות" } });
  assert.equal(actions[1].kind, "add_memory");
  if (actions[1].kind === "add_memory") {
    assert.match(actions[1].note, /פנאי בילוי/); // what the model proposed
    assert.match(actions[1].note, /רפואה ובריאות/); // what the owner chose
  }
});

test("4. note → only a memory note with the human's text", () => {
  assert.deepEqual(decide(proposal("PAYBOX", "low"), { kind: "note", text: "Usually splitting dinners" }, rules, TODAY), [
    { kind: "add_memory", note: "- 2026-10-28 | PAYBOX | Usually splitting dinners" },
  ]);
});

test("5. skip → nothing", () => {
  assert.deepEqual(decide(proposal("X", "high"), { kind: "skip" }, rules, TODAY), []);
});

test("6. unknown category → throws", () => {
  assert.throws(() => decide(proposal("X", "high", "Streaming & Subscriptions"), { kind: "approve" }, rules, TODAY));
  assert.throws(() => decide(proposal("X", "high"), { kind: "change", category: "לא קיים" }, rules, TODAY));
});

test("7. merchant already has a rule → no duplicate rule (case/space-insensitive)", () => {
  assert.deepEqual(decide(proposal(" netflix ", "high"), { kind: "approve" }, rules, TODAY), []);
});
