import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import type { StatementImport } from "../../../src/imports";
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
let finishScrape: (result: unknown) => void = () => {};
const imported: { name: string; month?: string; size: number }[] = [];
// Only the routes this file tests; the M3 edit routes run against the real core in edit-routes.test.ts.
const deps: Partial<Deps> = {
  listMonths: () => Object.keys(MONTHS).sort(),
  loadTransactions: (m) => MONTHS[m] ?? null,
  loadRules: () => rules,
  importStatement: (bytes, name, month) => {
    if (bytes.toString() === "broken") throw new Error("No transactions found.");
    imported.push({ name, month, size: bytes.length });
    return { duplicate: bytes.toString() === "again", month: month ?? "2026-09", fileName: name, count: 1 } as StatementImport;
  },
  listImports: () => [{ id: 1, source: "csv", fileName: "sep.csv", billingMonth: "2026-09", txCount: 1, checks: null, createdAt: "now" }],
  fetchMonth: () => new Promise((resolve) => (finishScrape = resolve as (r: unknown) => void)),
};

let server: Server;
let port: number;
before(async () => {
  server = createApp(deps as Deps).listen(0, "127.0.0.1"); // 0 = any free port
  await new Promise((resolve) => server.once("listening", resolve));
  port = (server.address() as AddressInfo).port;
});
after(() => server.close());

/** http.request, not fetch: fetch silently drops a custom Host header (it's a forbidden header). */
function send(
  method: string,
  path: string,
  { body, headers = {} }: { body?: string | Buffer; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
    })
      .on("error", reject)
      .end(body);
  });
}
const get = (path: string, host?: string) => send("GET", path, host ? { headers: { host } } : {});
const upload = (path: string, body: string | Buffer, headers: Record<string, string> = {}) =>
  send("POST", path, { body, headers: { "content-type": "application/octet-stream", ...headers } });
const postJson = (path: string, data: unknown, headers: Record<string, string> = {}) =>
  send("POST", path, { body: JSON.stringify(data), headers: { "content-type": "application/json", ...headers } });

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
  assert.deepEqual(body.summary.bySource, { manual: 0, agent: 0, rule: 1, cal: 1, none: 1 });
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

test("upload: the file body and its name reach the import service; new → 201, duplicate → 200", async () => {
  const created = await upload("/api/imports?name=sep.csv&month=2026-09", "a,b,c");
  assert.equal(created.status, 201);
  assert.deepEqual(imported.at(-1), { name: "sep.csv", month: "2026-09", size: 5 });

  const again = await upload("/api/imports?name=sep.csv", "again");
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(imported.at(-1)!.month, undefined, "no month → the statement's own billing month");
});

test("upload: rejects a wrong body, file type, month or unreadable file", async () => {
  assert.equal((await send("POST", "/api/imports?name=sep.csv", { body: "a,b", headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await upload("/api/imports?name=statement.pdf", "x")).status, 400);
  assert.equal((await upload("/api/imports", "x")).status, 400);
  assert.equal((await upload("/api/imports?name=sep.csv&month=2026-13", "x")).status, 400);
  const broken = await upload("/api/imports?name=sep.csv", "broken");
  assert.equal(broken.status, 422);
  assert.match(broken.body.error, /No transactions found/);
});

test("upload: a file over the size limit → 413, not 500", async () => {
  const { status } = await upload("/api/imports?name=big.csv", Buffer.alloc(6 * 1024 * 1024));
  assert.equal(status, 413);
});

test("writes from another website are refused (CSRF); the dashboard's origin is allowed", async () => {
  assert.equal((await upload("/api/imports?name=sep.csv", "x", { origin: "https://evil.example" })).status, 403);
  assert.equal((await upload("/api/imports?name=sep.csv", "x", { origin: "http://localhost:5173" })).status, 201);
});

test("GET /api/imports lists the history", async () => {
  const { status, body } = await get("/api/imports");
  assert.equal(status, 200);
  assert.equal(body[0].fileName, "sep.csv");
});

test("scrape runs as a background job: 202 at once, 409 while running, then done with a result", async () => {
  assert.equal((await postJson("/api/scrape", { month: "nope" })).status, 400);

  const started = await postJson("/api/scrape", { month: "2026-10" });
  assert.equal(started.status, 202);
  const { jobId } = started.body;
  assert.equal((await get(`/api/jobs/${jobId}`)).body.status, "running");

  const second = await postJson("/api/scrape", { month: "2026-10" });
  assert.deepEqual([second.status, second.body.jobId], [409, jobId]);

  finishScrape({ month: "2026-10", count: 3 });
  await new Promise((resolve) => setImmediate(resolve)); // let the job's .then() run
  const done = (await get(`/api/jobs/${jobId}`)).body;
  assert.deepEqual([done.status, done.result.count], ["done", 3]);
  assert.equal((await get("/api/jobs/999")).status, 404);
});
