// The M7 routes with fake deps: caps validation, the core's errors mapped to HTTP, and the category trend's query.

import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { ConflictError, NotFoundError } from "../../../src/db/index";
import type { CategoryRow } from "../../../src/db/rules";
import type { CategoryTrend } from "../../../src/trends";
import { createApp, type Deps } from "./app";

const calls: unknown[] = [];
const deps: Partial<Deps> = {
  setCaps: (caps) => {
    calls.push(caps);
    if (caps.some((c) => c.id === 404)) throw new NotFoundError("No category 404");
    if (caps.some((c) => c.id === 9)) throw new ConflictError('"לסיווג ידני" is built in and can\'t have a cap');
    return [{ id: 1, name: "food", cap: caps[0]?.cap ?? null }] as CategoryRow[];
  },
  categoryTrend: (end, n, categories) => (calls.push([end, n, categories]), { total: 42 } as CategoryTrend),
};

let server: Server;
let port: number;
before(async () => {
  server = createApp(deps as Deps).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  port = (server.address() as AddressInfo).port;
});
after(() => server.close());

function call(method: string, path: string, data?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, path: encodeURI(path), method, headers: { "content-type": "application/json" } }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode!, body: text ? JSON.parse(text) : null }));
    })
      .on("error", reject)
      .end(data === undefined ? undefined : JSON.stringify(data));
  });
}

test("PUT caps: a cap, or null to remove it, reaches the core as given", async () => {
  const set = await call("PUT", "/api/categories/caps", { caps: [{ id: 1, cap: 1000 }, { id: 2, cap: null }] });
  assert.equal(set.status, 200);
  assert.equal(set.body[0].cap, 1000);
  assert.equal((await call("PUT", "/api/categories/caps", { caps: [] })).status, 200, "nothing to save is fine");
  assert.deepEqual(calls.splice(0), [[{ id: 1, cap: 1000 }, { id: 2, cap: null }], []]);
});

test("PUT caps: a cap of 0, negative, text, missing, or a bad id is a 400 that never reaches the core", async () => {
  const bad = [
    undefined,
    {},
    { caps: "1000" },
    { caps: [{ id: 1, cap: 0 }] },
    { caps: [{ id: 1, cap: -50 }] },
    { caps: [{ id: 1, cap: "1000" }] },
    { caps: [{ id: 1 }] },
    { caps: [{ id: "1", cap: 10 }] },
    { caps: [{ id: 0, cap: 10 }] },
    { caps: [{ id: 1.5, cap: 10 }] },
    { caps: [null] },
  ];
  for (const body of bad) assert.equal((await call("PUT", "/api/categories/caps", body)).status, 400, JSON.stringify(body));
  assert.deepEqual(calls.splice(0), []);
});

test("PUT caps: an unknown id → 404, the by-hand bucket → 409 (the core decides)", async () => {
  assert.equal((await call("PUT", "/api/categories/caps", { caps: [{ id: 404, cap: 10 }] })).status, 404);
  const byHand = await call("PUT", "/api/categories/caps", { caps: [{ id: 9, cap: 10 }] });
  assert.equal(byHand.status, 409);
  assert.match(byHand.body.error, /built in/);
  calls.splice(0);
});

test("category trend: no cat = default (null), repeated cat = the list, cat= = nothing; end and n are checked", async () => {
  assert.equal((await call("GET", "/api/ledger/category-trend?end=2026-11")).body.total, 42);
  await call("GET", "/api/ledger/category-trend?end=2026-11&n=3&cat=מזון&cat=חשבונות");
  await call("GET", "/api/ledger/category-trend?end=2026-11&n=12&cat=");
  assert.deepEqual(calls.splice(0), [["2026-11", 6, null], ["2026-11", 3, ["מזון", "חשבונות"]], ["2026-11", 12, []]]);

  for (const bad of ["?n=6", "?end=2026-13", "?end=2026-11&n=0", "?end=2026-11&n=25", "?end=2026-11&n=x", `?end=2026-11&cat=${"x".repeat(101)}`]) {
    assert.equal((await call("GET", `/api/ledger/category-trend${bad}`)).status, 400, bad);
  }
  assert.deepEqual(calls.splice(0), []);
});
