import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import type { RulesFile, Transaction } from "../../../src/types";
import { createApp, previousMonth, type Deps } from "./app";

// Fake data instead of data/: the test runs anywhere, with no bank data.
const tx = (id: string, date: string, merchant: string, amount: number, sector?: string): Transaction => ({
  id, date, merchant, amount, currency: "ILS", source: "csv", ...(sector && { sector }),
});
const MONTHS: Record<string, Transaction[]> = {
  "2026-09": [tx("a", "2026-09-01", "שופרסל", 100, "מזון ומשקאות")],
  "2026-10": [
    tx("b", "2026-10-01", "שופרסל", 150, "מזון ומשקאות"),
    tx("c", "2026-10-02", "Disney Plus", 40, "שונות"), // rule beats Cal's sector
    tx("d", "2026-10-03", "UNKNOWN", 10), // no rule, no sector
  ],
};
const RULES: RulesFile = { categories: ["מזון ומשקאות", "פנאי בילוי"], rules: [{ merchant: "Disney Plus", category: "פנאי בילוי" }] };

let rules = RULES;
const deps: Deps = {
  listMonths: () => Object.keys(MONTHS).sort(),
  loadTransactions: (m) => MONTHS[m] ?? null,
  loadRules: () => rules,
};

let server: Server;
let port: number;
before(async () => {
  server = createApp(deps).listen(0, "127.0.0.1"); // 0 = any free port
  await new Promise((resolve) => server.once("listening", resolve));
  port = (server.address() as AddressInfo).port;
});
after(() => server.close());

/** http.request, not fetch: fetch silently drops a custom Host header (it's a forbidden header). */
function get(path: string, host = `127.0.0.1:${port}`): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
    })
      .on("error", reject)
      .end();
  });
}

test("previousMonth rolls back across a year", () => {
  assert.equal(previousMonth("2026-10"), "2026-09");
  assert.equal(previousMonth("2026-01"), "2025-12");
});

test("GET /api/months lists imported months", async () => {
  const { status, body } = await get("/api/months");
  assert.equal(status, 200);
  assert.deepEqual(body, ["2026-09", "2026-10"]);
});

test("GET summary uses the core: rule beats sector, previous month included", async () => {
  const { status, body } = await get("/api/months/2026-10/summary");
  assert.equal(status, 200);
  assert.equal(body.month, "2026-10");
  assert.deepEqual(body.summary.totals, { ILS: 200 });
  assert.deepEqual(body.summary.bySource, { rule: 1, cal: 1, none: 1 });
  assert.equal(body.previous.month, "2026-09");
  assert.deepEqual(body.previous.summary.totals, { ILS: 100 });
});

test("GET summary of the first month has no comparison", async () => {
  const { body } = await get("/api/months/2026-09/summary");
  assert.equal(body.previous, null);
});

test("GET transactions returns categorized rows", async () => {
  const { status, body } = await get("/api/months/2026-10/transactions");
  assert.equal(status, 200);
  assert.deepEqual(
    body.map((t: { id: string; categorySource: string | null }) => [t.id, t.categorySource]),
    [["b", "cal"], ["c", "rule"], ["d", null]],
  );
});

test("bad month → 400, missing month → 404, unknown path → JSON 404", async () => {
  assert.equal((await get("/api/months/2026-13/summary")).status, 400);
  assert.equal((await get("/api/months/2020-01/transactions")).status, 404);
  const unknown = await get("/api/nope");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "Not found");
});

test("Host check: foreign host → 403, localhost (Vite proxy) → 200", async () => {
  assert.equal((await get("/api/health", "evil.com:3000")).status, 403);
  assert.equal((await get("/api/health", "localhost:5173")).status, 200);
});

test("a thrown error becomes a JSON 500 (Express 5 error handler)", async () => {
  rules = { ...RULES, rules: [{ merchant: "X", category: "no such category" }] }; // validateRules throws
  try {
    const { status, body } = await get("/api/months/2026-10/summary");
    assert.equal(status, 500);
    assert.match(body.error, /unknown categories/);
  } finally {
    rules = RULES;
  }
});
