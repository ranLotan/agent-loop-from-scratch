// The whole M4 flow with a FAKE model: run the agent → answer each proposal and flag → run again.
// Throwaway in-memory database and a temp memory file; no network, no cost.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { Transaction } from "../types";
import type { ModelClient } from "./loop";

const tempDir = mkdtempSync(join(tmpdir(), "cal-agent-flow-"));
process.env.DB_PATH = ":memory:";
process.env.MEMORY_PATH = join(tempDir, "memory.md");
after(() => rmSync(tempDir, { recursive: true, force: true }));

const store = await import("../store");
const { categorize, MANUAL_CATEGORY } = await import("../categorize");
const { runAgent } = await import("./service");
const { applyAnswer, answerFlag } = await import("./apply");

const tx = (id: string, date: string, merchant: string, amount: number, sector?: string): Transaction => ({
  id, date, merchant, amount, currency: "ILS", source: "scraper", ...(sector && { sector }),
});
store.addCategories(["מסעדות", "שונות", "תיירות", "בית"]);
store.setCalRule("ריהוט ובית", "בית");
store.importTransactions(
  "2026-09",
  [
    tx("m1", "2026-09-01", "Mystery Cafe", 40),
    tx("b1", "2026-09-02", "BIT", 100),
    tx("b2", "2026-09-05", "BIT", 250),
    tx("p1", "2026-09-03", "PAYBOX", 60),
    tx("big", "2026-09-04", "Electronics", 4000, "ריהוט ובית"), // its sector has a Cal rule: not reviewed, but "large"
  ],
  { source: "scraper" },
);

/** A scripted model: proposes for three merchants and flags the large charge, then finishes. */
function fakeModel() {
  const sentTools: Anthropic.Tool[][] = [];
  const reply = (stop_reason: Anthropic.StopReason, content: unknown[]) =>
    ({ id: "msg", type: "message", role: "assistant", model: "fake", content, stop_reason, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 200 } }) as Anthropic.Message;
  const use = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });
  const replies = [
    reply("tool_use", [
      use("t1", "propose_category", { merchant: "Mystery Cafe", category: "מסעדות", confidence: "high", reason: "A café.", new_category_idea: null }),
      use("t2", "propose_category", { merchant: "BIT", category: "שונות", confidence: "low", reason: "A transfer.", new_category_idea: null }),
      use("t3", "propose_category", { merchant: "PAYBOX", category: "שונות", confidence: "low", reason: "A transfer.", new_category_idea: null }),
      use("t4", "flag_exception", { transaction_id: "big", severity: "info", explanation: "Large purchase." }),
    ]),
    reply("end_turn", [{ type: "text", text: "Done.", citations: null }]),
  ];
  const client: ModelClient = {
    messages: {
      async create(params) {
        sentTools.push(params.tools as Anthropic.Tool[]);
        const next = replies.shift();
        if (!next) throw new Error("the fake model has no more replies");
        return next;
      },
    },
  };
  return { client, sentTools };
}

const categoryOf = (id: string) => {
  const t = categorize(store.loadTransactions("2026-09")!, store.loadRules()).find((x) => x.id === id)!;
  return [t.category, t.categorySource];
};
const proposalFor = (merchant: string) => store.listProposals("2026-09").find((p) => p.merchant === merchant)!;

test("a run saves its proposals and flags for review; the by-hand bucket is never offered to the model", async () => {
  const { client, sentTools } = fakeModel();
  const r = await runAgent({ month: "2026-09", client, model: "claude-haiku-5-5" });

  assert.deepEqual(r.merchants, ["Mystery Cafe", "BIT", "PAYBOX"]);
  assert.deepEqual([r.proposals.length, r.flags.length, r.stoppedBy, r.missed], [3, 1, "end_turn", []]);
  assert.ok(r.cost > 0 && r.cost < 0.01, "priced as Haiku");
  const enumOf = (tools: Anthropic.Tool[]) =>
    (tools.find((t) => t.name === "propose_category")!.input_schema.properties as Record<string, { enum?: string[] }>).category.enum!;
  assert.ok(!enumOf(sentTools[0]).includes(MANUAL_CATEGORY));

  assert.deepEqual(store.listProposals("2026-09").map((p) => p.status), ["pending", "pending", "pending"]);
  const bit = store.listProposalsWithCharges("2026-09").find((p) => p.merchant === "BIT")!;
  assert.deepEqual(bit.charges.map((c) => [c.id, c.date, c.amount]), [["b1", "2026-09-02", 100], ["b2", "2026-09-05", 250]], "every charge one answer covers, by date");
  assert.equal(store.listFlags("2026-09")[0].transactionId, "big");
  assert.equal(store.latestRun("2026-09")!.inputTokens, 2000);
  assert.equal(categoryOf("m1")[0], null, "nothing changes until the owner answers");
});

test("approve → a rule; 'this month only' → an agent edit, no rule; 'always by hand' → the bucket", () => {
  applyAnswer(proposalFor("Mystery Cafe").id, { kind: "approve" });
  assert.deepEqual(categoryOf("m1"), ["מסעדות", "rule"]);

  const once = applyAnswer(proposalFor("PAYBOX").id, { kind: "once", category: "שונות" });
  assert.equal(once.chargesUpdated, 1);
  assert.deepEqual(categoryOf("p1"), ["שונות", "agent"]);
  assert.ok(!store.loadRules().rules.some((r) => r.merchant === "PAYBOX"), "no rule for PAYBOX");

  applyAnswer(proposalFor("BIT").id, { kind: "by_hand" });
  assert.deepEqual(categoryOf("b1"), [MANUAL_CATEGORY, "rule"]);
  assert.deepEqual(categoryOf("b2"), [MANUAL_CATEGORY, "rule"]);

  assert.deepEqual(
    store.listProposals("2026-09").map((p) => [p.merchant, p.status, p.answer?.kind]),
    [["Mystery Cafe", "approved", "approve"], ["BIT", "answered", "by_hand"], ["PAYBOX", "answered", "once"]],
  );
  assert.match(readFileSync(process.env.MEMORY_PATH!, "utf8"), /PAYBOX \| categorized as שונות for one month only/);
});

test("an answered proposal can't be answered again", () => {
  assert.throws(() => applyAnswer(proposalFor("BIT").id, { kind: "approve" }), store.ConflictError);
});

test("your own edit on a by-hand charge takes it out of the bucket", () => {
  store.editTransaction("b1", { category: "מסעדות", description: "Dinner split" });
  assert.deepEqual(categoryOf("b1"), ["מסעדות", "manual"]);
  assert.deepEqual(categoryOf("b2"), [MANUAL_CATEGORY, "rule"], "the other BIT charge still waits for you");
});

test("a flag note goes to memory; the flag is marked noted", () => {
  const [flag] = store.listFlags("2026-09");
  assert.equal(answerFlag(flag.id, { kind: "note", text: "planned, new TV" }).status, "noted");
  assert.match(readFileSync(process.env.MEMORY_PATH!, "utf8"), /Electronics \| planned, new TV/);
  assert.throws(() => answerFlag(flag.id, { kind: "ok" }), store.ConflictError);
});

test("the next run has nothing to ask: BIT never reaches the agent again", async () => {
  const { client, sentTools } = fakeModel();
  const r = await runAgent({ month: "2026-09", client });
  assert.deepEqual(r.merchants, [], "BIT and the others now have a rule, an edit, or the by-hand bucket");
  // The large charge is still a candidate (code finds it every run), so the model is called for that alone.
  assert.equal(sentTools.length > 0, r.candidates.length > 0);
});

test("charge by charge: each charge its own category (your edit), no rule; byHand keeps it from the agent", () => {
  store.importTransactions(
    "2026-10",
    [tx("q1", "2026-10-01", "PAYBOX", 80), tx("q2", "2026-10-03", "PAYBOX", 35), tx("o1", "2026-10-02", "Other Shop", 10)],
    { source: "scraper" },
  );
  store.saveProposals("2026-10", {
    month: "2026-10", createdAt: "2026-10-31T00:00:00Z", model: "fake", reviewed: [], flags: [],
    proposals: [{ merchant: "PAYBOX", category: "שונות", confidence: "low", reason: "A transfer." }],
  });
  const id = store.listProposals("2026-10")[0].id;
  const of = (txId: string) => {
    const t = categorize(store.loadTransactions("2026-10")!, store.loadRules()).find((x) => x.id === txId)!;
    return [t.category, t.categorySource];
  };

  // Ids from the request are checked: another merchant's or another statement's charge → nothing written at all.
  for (const stranger of ["o1", "p1", "nope"]) {
    assert.throws(() => applyAnswer(id, { kind: "per_charge", categories: { q1: "מסעדות", [stranger]: "שונות" } }), store.ValidationError);
  }
  assert.deepEqual(of("q1"), [null, null], "all or nothing");

  const r = applyAnswer(id, { kind: "per_charge", categories: { q1: "מסעדות", q2: "שונות" }, byHand: true });
  assert.equal(r.chargesUpdated, 2);
  assert.deepEqual([of("q1"), of("q2")], [["מסעדות", "manual"], ["שונות", "manual"]]);
  assert.ok(store.loadRules().rules.some((x) => x.merchant === "PAYBOX" && x.category === MANUAL_CATEGORY), "next month's PAYBOX waits for you");
  assert.equal(store.getProposal(id).answer?.kind, "per_charge");
  assert.match(readFileSync(process.env.MEMORY_PATH!, "utf8"), /PAYBOX \| categorized charge by charge \(no rule\): מסעדות, שונות/);
});
