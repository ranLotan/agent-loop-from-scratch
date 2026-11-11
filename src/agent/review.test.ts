import assert from "node:assert/strict";
import { test } from "node:test";
import type { RulesFile } from "../types";
import { MANUAL_CATEGORY } from "../categorize";
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

test("8a. new_category → add_category first, then a rule using it (no note: it would repeat the rule)", () => {
  const actions = decide(proposal("Pet Zoo", "low", "שונות"), { kind: "new_category", category: " חיות מחמד " }, rules, TODAY);
  assert.deepEqual(actions, [
    { kind: "add_category", name: "חיות מחמד" },
    { kind: "add_rule", rule: { merchant: "Pet Zoo", category: "חיות מחמד" } },
  ]);
});

test("8d. decide doesn't mutate its inputs (it's a pure function)", () => {
  const r: RulesFile = structuredClone(rules);
  const answer = { kind: "new_category" as const, category: " חיות מחמד " };
  decide(proposal("Pet Zoo", "low", "שונות"), answer, r, TODAY);
  assert.deepEqual(r, rules);
  assert.equal(answer.category, " חיות מחמד "); // untouched; the trimmed name is in the OUTPUT (8a)
});

test("3b. change to the same category as proposed → like approve, no useless note", () => {
  assert.deepEqual(decide(proposal("Disney Plus", "medium"), { kind: "change", category: "פנאי בילוי" }, rules, TODAY), [
    { kind: "add_rule", rule: { merchant: "Disney Plus", category: "פנאי בילוי" } },
  ]);
});

test("8b. new_category with an existing name → no add_category (like change)", () => {
  const actions = decide(proposal("Pet Zoo", "low", "שונות"), { kind: "new_category", category: "רפואה ובריאות" }, rules, TODAY);
  assert.ok(!actions.some((a) => a.kind === "add_category"));
  assert.deepEqual(actions[0], { kind: "add_rule", rule: { merchant: "Pet Zoo", category: "רפואה ובריאות" } });
});

test("8c. new_category with an empty name → throws", () => {
  assert.throws(() => decide(proposal("Pet Zoo", "low"), { kind: "new_category", category: "  " }, rules, TODAY));
});

test("9. once → this month's charges get the category, no rule, and a note for the agent", () => {
  assert.deepEqual(decide(proposal("BIT", "low", "שונות"), { kind: "once", category: "רפואה ובריאות" }, rules, TODAY), [
    { kind: "set_month_category", merchant: "BIT", category: "רפואה ובריאות" },
    { kind: "add_memory", note: "- 2026-10-28 | BIT | categorized as רפואה ובריאות for one month only (no rule)" },
  ]);
  assert.throws(() => decide(proposal("BIT", "low"), { kind: "once", category: "nope" }, rules, TODAY), /Unknown category/);
});

test("10. by_hand → a rule to the by-hand bucket, so the merchant never reaches the agent again", () => {
  assert.deepEqual(decide(proposal("PAYBOX", "low", "שונות"), { kind: "by_hand" }, rules, TODAY), [
    { kind: "add_rule", rule: { merchant: "PAYBOX", category: MANUAL_CATEGORY } },
  ]);
  assert.deepEqual(decide(proposal("Netflix", "low"), { kind: "by_hand" }, rules, TODAY), [], "already has a rule");
});
