// The M3 routes with the REAL core (store.ts → SQLite) against a throwaway in-memory database:
// validation, status codes, and that an edit actually changes what the dashboard shows.

import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { Transaction } from "../../../src/types";

process.env.DB_PATH = ":memory:"; // before the store opens the database
const store = await import("../../../src/store");
const { createApp } = await import("./app");
const { realDeps } = await import("./deps");

const tx = (id: string, merchant: string, sector?: string): Transaction => ({
  id, date: "2026-09-01", merchant, amount: 40, currency: "ILS", source: "xlsx", ...(sector && { sector }),
});
store.addCategories(["מסעדות", "אירועים", "שונות"]);
store.importTransactions("2026-09", [tx("a1", "Aroma", "מזון ומשקאות"), tx("a2", "Aroma"), tx("x1", "Mystery")], { source: "xlsx" });
store.importTransactions("2026-08", [tx("old", "Aroma")], { source: "xlsx" });

let server: Server;
let port: number;
before(async () => {
  server = createApp(realDeps()).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  port = (server.address() as AddressInfo).port;
});
after(() => server.close());

function call(method: string, path: string, data?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const body = data === undefined ? undefined : JSON.stringify(data);
  return new Promise((resolve, reject) => {
    request(
      { host: "127.0.0.1", port, path, method, headers: { "content-type": "application/json", ...headers } },
      (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode!, body: text ? JSON.parse(text) : null }));
      },
    )
      .on("error", reject)
      .end(body);
  });
}
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

test("search: all months by default; month range, text and source filters", async () => {
  assert.deepEqual(ids((await call("GET", "/api/transactions")).body), ["a1", "a2", "x1", "old"]);
  assert.deepEqual(ids((await call("GET", "/api/transactions?from=2026-09&to=2026-09&q=aroma")).body), ["a1", "a2"]);
  assert.deepEqual(ids((await call("GET", "/api/transactions?source=none")).body), ["a2", "x1", "old"]);
  assert.equal((await call("GET", "/api/transactions?source=magic")).status, 400);
  assert.equal((await call("GET", "/api/transactions?from=2026-13")).status, 400);
});

test("PATCH edits one transaction; it's labeled manual and the summary counts it", async () => {
  const { status, body } = await call("PATCH", "/api/transactions/x1", { category: "אירועים", description: "  Wedding gift " });
  assert.equal(status, 200);
  assert.deepEqual([body.category, body.categorySource, body.descriptionOverride, body.billingMonth], ["אירועים", "manual", "Wedding gift", "2026-09"]);
  assert.equal((await call("GET", "/api/months/2026-09/summary")).body.summary.bySource.manual, 1);
  assert.deepEqual(ids((await call("GET", `/api/transactions?category=${encodeURIComponent("אירועים")}`)).body), ["x1"]);
});

test("PATCH with createRule: the merchant's other charges follow, in every month", async () => {
  const { body } = await call("PATCH", "/api/transactions/a2", { category: "מסעדות", createRule: true });
  assert.deepEqual([body.category, body.categorySource], ["מסעדות", "rule"]);
  const aroma = (await call("GET", "/api/transactions?q=aroma")).body;
  assert.deepEqual(aroma.map((t: { categorySource: string }) => t.categorySource), ["rule", "rule", "rule"]);
});

test("PATCH validation: wrong types → 400, unknown category → 400, unknown id → 404", async () => {
  assert.equal((await call("PATCH", "/api/transactions/x1", { category: 7 })).status, 400);
  assert.equal((await call("PATCH", "/api/transactions/x1", { createRule: "yes" })).status, 400);
  const unknown = await call("PATCH", "/api/transactions/x1", { category: "no such category" });
  assert.deepEqual([unknown.status, unknown.body.error], [400, 'Unknown category "no such category"']);
  assert.equal((await call("PATCH", "/api/transactions/nope", { category: "שונות" })).status, 404);
  assert.equal((await call("PATCH", "/api/transactions/x1", { createRule: true })).status, 400, "a rule needs a category");
});

test("rules: create (or update the merchant's rule), change, delete", async () => {
  const created = await call("POST", "/api/rules", { merchant: "Mystery", category: "שונות" });
  assert.equal(created.status, 201);
  assert.equal((await call("POST", "/api/rules", { merchant: "MYSTERY", category: "אירועים" })).body.id, created.body.id);
  assert.equal((await call("PATCH", `/api/rules/${created.body.id}`, { category: "מסעדות" })).body.category, "מסעדות");
  assert.equal((await call("POST", "/api/rules", { merchant: "", category: "שונות" })).status, 400);
  assert.equal((await call("POST", "/api/rules", { merchant: "X", category: "no such category" })).status, 400);
  assert.equal((await call("DELETE", `/api/rules/${created.body.id}`)).status, 204);
  assert.equal((await call("DELETE", `/api/rules/${created.body.id}`)).status, 404);
  assert.equal((await call("DELETE", "/api/rules/abc")).status, 400);
});

test("categories: add, duplicate → 409, rename follows edits, in use → 409, unused → 204", async () => {
  const added = await call("POST", "/api/categories", { name: "זמני" });
  assert.equal(added.status, 201);
  assert.equal((await call("POST", "/api/categories", { name: "זמני" })).status, 409);
  assert.equal((await call("DELETE", `/api/categories/${added.body.id}`)).status, 204);

  const events = (await call("GET", "/api/categories")).body.find((c: { name: string }) => c.name === "אירועים");
  assert.equal((await call("PATCH", `/api/categories/${events.id}`, { name: "אירועים ושמחות" })).status, 200);
  assert.equal((await call("GET", "/api/transactions?q=wedding")).body[0].category, "אירועים ושמחות");
  const inUse = await call("DELETE", `/api/categories/${events.id}`);
  assert.equal(inUse.status, 409);
  assert.match(inUse.body.error, /used by/);
});

test("edits from another website are refused", async () => {
  const { status } = await call("PATCH", "/api/transactions/x1", { category: "שונות" }, { origin: "https://evil.example" });
  assert.equal(status, 403);
});
