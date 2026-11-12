// The M5 routes with the real core against an in-memory database.

import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

process.env.DB_PATH = ":memory:";
const store = await import("../../../src/store");
const { createApp } = await import("./app");
const { realDeps } = await import("./deps");

store.importTransactions(
  "2026-09",
  [{ id: "net", date: "2026-09-14", merchant: "Bezeq Online", amount: 120, currency: "ILS", source: "scraper" }],
  { source: "scraper" },
);

let server: Server;
let port: number;
before(async () => {
  server = createApp(realDeps()).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  port = (server.address() as AddressInfo).port;
});
after(() => server.close());

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

test("create, list and see a month: income, outside expenses, and a card-paid item matched", async () => {
  const salary = await call("POST", "/api/recurring", { name: "Salary", kind: "income", amount: 18000, startMonth: "2026-01" });
  assert.equal(salary.status, 201);
  await call("POST", "/api/recurring", { name: "Rent", kind: "expense", amount: 6500, startMonth: "2026-01" });
  await call("POST", "/api/recurring", { name: "Internet", kind: "expense", amount: 120, startMonth: "2026-01", merchant: "Bezeq Online" });
  assert.equal((await call("GET", "/api/recurring")).body.length, 3);

  const { body } = await call("GET", "/api/months/2026-09/recurring");
  assert.deepEqual(body.summary, { income: { ILS: 18000 }, outsideExpenses: { ILS: 6500 }, paidByCard: 1, notSeen: 0 });
  assert.equal(body.occurrences.find((o: { name: string }) => o.name === "Internet").transaction.id, "net");
});

test("validation and ids: bad input → 400, unknown id → 404, id/previousId can't be set", async () => {
  assert.equal((await call("POST", "/api/recurring", { name: "X", kind: "gift", amount: 5, startMonth: "2026-01" })).status, 400);
  assert.equal((await call("POST", "/api/recurring", { name: "X", kind: "expense", amount: -5, startMonth: "2026-01" })).status, 400);
  assert.equal((await call("PATCH", "/api/recurring/999", { amount: 5 })).status, 404);
  const sneaky = await call("POST", "/api/recurring", { name: "Gym", kind: "expense", amount: 200, startMonth: "2026-01", id: 1, previousId: 1 });
  assert.equal(sneaky.status, 201);
  assert.notEqual(sneaky.body.id, 1);
  assert.equal(sneaky.body.previousId, null);
});

test("one month vs from this month on", async () => {
  const rent = (await call("GET", "/api/recurring")).body.find((d: { name: string }) => d.name === "Rent");
  assert.equal((await call("PUT", `/api/recurring/${rent.id}/months/2026-08`, { skipped: true })).status, 200);
  assert.equal((await call("PUT", `/api/recurring/${rent.id}/months/2026-08`, { skipped: "yes" })).status, 400);
  // Rent is skipped in August; only the gym (created above) is left outside the card.
  assert.equal((await call("GET", "/api/months/2026-08/recurring")).body.summary.outsideExpenses.ILS, 200);

  const split = await call("POST", `/api/recurring/${rent.id}/change-from`, { month: "2026-10", amount: 7000 });
  assert.deepEqual([split.body.ended.endMonth, split.body.created.amount], ["2026-09", 7000]);
  assert.equal((await call("GET", "/api/months/2026-09/recurring")).body.summary.outsideExpenses.ILS, 6500 + 200, "September: old rent + gym (internet is paid by card)");
  assert.equal((await call("GET", "/api/months/2026-10/recurring")).body.summary.outsideExpenses.ILS, 7000 + 200);
  assert.equal((await call("POST", `/api/recurring/${rent.id}/change-from`, { month: "nope" })).status, 400);
  assert.equal((await call("DELETE", `/api/recurring/${rent.id}`)).status, 204);
});
