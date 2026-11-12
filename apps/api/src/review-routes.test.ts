// The M4 routes with the real core against an in-memory database, and a FAKE model (no network, no cost).

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "../../../src/agent/loop";

const tempDir = mkdtempSync(join(tmpdir(), "cal-review-routes-"));
process.env.DB_PATH = ":memory:";
process.env.MEMORY_PATH = join(tempDir, "memory.md");
const store = await import("../../../src/store");
const { runAgent } = await import("../../../src/agent/service");
const { createApp } = await import("./app");
const { realDeps } = await import("./deps");

store.addCategories(["שונות", "מסעדות"]);
store.importTransactions(
  "2026-09",
  [{ id: "c1", date: "2026-09-01", merchant: "Corner Cafe", amount: 30, currency: "ILS", source: "xlsx" }],
  { source: "xlsx" },
);

/** One proposal, then done. Set `failNext` to simulate a model error (e.g. a missing API key). */
let failNext = false;
const fakeClient: ModelClient = {
  messages: {
    async create(params) {
      if (failNext) throw new Error("Could not resolve authentication method");
      const asked = params.messages.length > 1; // the second call carries the tool results
      return {
        id: "msg", type: "message", role: "assistant", model: "fake", stop_sequence: null,
        usage: { input_tokens: 500, output_tokens: 100 },
        stop_reason: asked ? "end_turn" : "tool_use",
        content: asked
          ? [{ type: "text", text: "Done.", citations: null }]
          : [{ type: "tool_use", id: "t1", name: "propose_category", input: { merchant: "Corner Cafe", category: "מסעדות", confidence: "high", reason: "A café.", new_category_idea: null } }],
      } as Anthropic.Message;
    },
  },
};

let server: Server;
let port: number;
before(async () => {
  server = createApp({ ...realDeps(), runAgent: (month) => runAgent({ month, client: fakeClient, model: "claude-haiku-5-5" }) }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  port = (server.address() as AddressInfo).port;
});
after(() => {
  server.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function call(method: string, path: string, data?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, path, method, headers: { "content-type": "application/json" } }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode!, body: text ? JSON.parse(text) : null }));
    })
      .on("error", reject)
      .end(data === undefined ? undefined : JSON.stringify(data));
  });
}
async function waitForJob(id: string) {
  for (let i = 0; i < 50; i++) {
    const job = (await call("GET", `/api/jobs/${id}`)).body;
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("job didn't finish");
}

test("an agent run is a background job; its proposals then wait for review", async () => {
  assert.equal((await call("POST", "/api/agent-runs", { month: "nope" })).status, 400);
  const started = await call("POST", "/api/agent-runs", { month: "2026-09" });
  assert.equal(started.status, 202);
  const job = await waitForJob(started.body.jobId);
  assert.deepEqual([job.status, job.result.proposals.length, job.result.model], ["done", 1, "claude-haiku-5-5"]);

  const review = (await call("GET", "/api/review?month=2026-09")).body;
  assert.deepEqual([review.run.model, review.proposals[0].merchant, review.proposals[0].status], ["claude-haiku-5-5", "Corner Cafe", "pending"]);
  // What was bought, to decide with: the merchant's charges on the reviewed statement.
  assert.deepEqual(
    review.proposals[0].charges.map((c: { id: string; date: string; amount: number }) => [c.id, c.date, c.amount]),
    [["c1", "2026-09-01", 30]],
  );
  assert.equal((await call("GET", "/api/review?month=bad")).status, 400);
});

test("answers are validated, applied through decide(), and can't be repeated", async () => {
  const [proposal] = (await call("GET", "/api/review?month=2026-09")).body.proposals;
  const path = `/api/proposals/${proposal.id}/answer`;
  assert.equal((await call("POST", path, { kind: "magic" })).status, 400);
  assert.equal((await call("POST", path, { kind: "once" })).status, 400, "once needs a category");
  assert.equal((await call("POST", path, { kind: "note", text: " " })).status, 400);
  assert.equal((await call("POST", path, { kind: "per_charge", categories: {} })).status, 400, "per_charge needs charges");
  assert.equal((await call("POST", path, { kind: "per_charge", categories: { c1: "" } })).status, 400);
  assert.equal((await call("POST", path, { kind: "per_charge", categories: ["c1"] })).status, 400);
  assert.equal((await call("POST", "/api/proposals/999/answer", { kind: "approve" })).status, 404);

  const answered = await call("POST", path, { kind: "approve" });
  assert.deepEqual([answered.status, answered.body.proposal.status, answered.body.actions[0].kind], [200, "approved", "add_rule"]);
  assert.equal((await call("POST", path, { kind: "approve" })).status, 409);
  assert.equal((await call("GET", "/api/transactions?q=corner")).body[0].categorySource, "rule");
});

test("a failing model run is reported as a failed job, and the API keeps working", async () => {
  // A month with a merchant that has no rule yet, so the model really gets called.
  store.importTransactions(
    "2026-10",
    [{ id: "n1", date: "2026-10-02", merchant: "New Shop", amount: 20, currency: "ILS", source: "xlsx" }],
    { source: "xlsx" },
  );
  failNext = true;
  try {
    const { body } = await call("POST", "/api/agent-runs", { month: "2026-10" });
    const job = await waitForJob(body.jobId);
    assert.equal(job.status, "failed");
    assert.match(job.error, /authentication/);
  } finally {
    failNext = false;
  }
  assert.equal((await call("GET", "/api/health")).status, 200);
});
