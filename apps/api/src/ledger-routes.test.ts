// The M6 ledger routes with fake deps: validation, and that the route passes the core's answer through untouched.

import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { MonthLedger, MonthStatus, TrendPoint } from "../../../src/ledger-service";
import { createApp, type Deps } from "./app";

const calls: string[] = [];
const ledger = { month: "2026-09", entries: [], summary: { net: 123 } } as unknown as MonthLedger;
const deps: Partial<Deps> = {
  monthLedger: (month) => (calls.push(`ledger ${month}`), ledger),
  ledgerTrend: (end, n) => (calls.push(`trend ${end} ${n}`), [{ month: end, income: 1, expenses: 2, net: -1, awaiting: 0 }] as TrendPoint[]),
  monthStatus: (month) => (calls.push(`status ${month}`), { month, next: "review" } as MonthStatus),
};

let server: Server;
let port: number;
before(async () => {
  server = createApp(deps as Deps).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  port = (server.address() as AddressInfo).port;
});
after(() => server.close());

function get(path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
    })
      .on("error", reject)
      .end();
  });
}

test("ledger: the core's result as JSON; a bad month is a 400 and never reaches the core", async () => {
  assert.deepEqual((await get("/api/months/2026-09/ledger")).body, ledger);
  assert.equal((await get("/api/months/2026-13/ledger")).status, 400);
  assert.deepEqual(calls.splice(0), ["ledger 2026-09"]);
});

test("trend: n defaults to 6 and must be 1–24; end is required", async () => {
  assert.equal((await get("/api/ledger/trend?end=2026-10")).status, 200);
  assert.equal((await get("/api/ledger/trend?end=2026-10&n=12")).body[0].net, -1);
  for (const bad of ["/api/ledger/trend", "/api/ledger/trend?end=2026-10&n=0", "/api/ledger/trend?end=2026-10&n=25", "/api/ledger/trend?end=2026-10&n=2.5"]) {
    assert.equal((await get(bad)).status, 400, bad);
  }
  assert.deepEqual(calls.splice(0), ["trend 2026-10 6", "trend 2026-10 12"]);
});

test("status: passed through", async () => {
  assert.equal((await get("/api/months/2026-09/status")).body.next, "review");
  assert.equal((await get("/api/months/sept/status")).status, 400);
  assert.deepEqual(calls.splice(0), ["status 2026-09"]);
});
