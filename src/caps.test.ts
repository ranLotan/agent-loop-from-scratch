import assert from "node:assert/strict";
import { test } from "node:test";
import { capUsage, summarizeCaps } from "./caps";
import { OTHER, pieSlices, summarizeLedger, type LedgerEntry } from "./ledger";

const spent = [
  { category: "food", amount: 426.72 },
  { category: "kids", amount: 1856 },
  { category: "bills", amount: 1200 },
  { category: "rent", amount: 8200 },
  { category: "Uncategorized", amount: 90 },
];
const caps = [
  { category: "food", cap: 1000 },
  { category: "kids", cap: 1500 },
  { category: "bills", cap: 1200 },
  { category: "gifts", cap: 300 },
];

test("cap usage: under, exactly at, over, and a capped category with no spending", () => {
  const usage = capUsage(spent, caps);
  const by = Object.fromEntries(usage.map((u) => [u.category, u]));
  assert.deepEqual(by.food, { category: "food", cap: 1000, spent: 426.72, remaining: 573.28, over: false, usedPercent: 43 });
  assert.deepEqual(by.kids, { category: "kids", cap: 1500, spent: 1856, remaining: -356, over: true, usedPercent: 124 });
  assert.equal(by.bills.over, false, "spent exactly at the cap is on track");
  assert.equal(by.bills.remaining, 0);
  assert.deepEqual([by.gifts.spent, by.gifts.remaining, by.gifts.over], [0, 300, false]);
});

test("cap usage: categories without a cap (and Uncategorized) aren't in it; order follows spending, then no-spend ones", () => {
  const usage = capUsage(spent, caps);
  assert.deepEqual(usage.map((u) => u.category), ["food", "kids", "bills", "gifts"], "byCategory order, gifts last");
  assert.ok(!usage.some((u) => u.category === "rent" || u.category === "Uncategorized"));
  assert.deepEqual(capUsage(spent, []), []);
});

test("caps summary: on track, exceeded and the sum of caps", () => {
  const s = summarizeCaps(capUsage(spent, caps));
  assert.deepEqual([s.onTrack, s.exceeded, s.total], [3, 1, 4000]);
});

const expense = (category: string | null, amount: number, origin: LedgerEntry["origin"] = "billed"): LedgerEntry => ({
  source: "card", origin, kind: "expense", date: "2026-11-05", name: "x", amount, currency: "ILS", category, status: "counted", ref: "r",
});

test("summarizeLedger: a refund lowers spent; awaiting items and other currencies don't count", () => {
  const entries: LedgerEntry[] = [
    expense("food", 600),
    expense("food", -100), // a refund
    { ...expense("food", 999), status: "awaiting_confirmation", source: "manual", origin: "recurring" },
    { ...expense("food", 50), currency: "EUR" },
  ];
  const { caps: s } = summarizeLedger(entries, [{ category: "food", cap: 1000 }]);
  assert.deepEqual(s.usage.map((u) => [u.spent, u.remaining]), [[500, 500]]);
  assert.equal(summarizeLedger(entries).caps.usage.length, 0, "no caps given: nothing to report");
});

test("pie: a small capped category keeps its own slice among more than 7 categories", () => {
  const many = ["a", "b", "c", "d", "e", "f", "g", "h", "tiny"].map((category, i) => ({ category, amount: 900 - i * 100 }));
  many[8].amount = 5;
  const without = pieSlices(many);
  assert.ok(without.at(-1)!.grouped!.includes("tiny"), "uncapped: tiny goes into Other");

  const slices = pieSlices(many, 6, ["tiny"]);
  assert.deepEqual(slices.map((s) => s.category), ["a", "b", "c", "d", "e", "tiny", OTHER], "tiny takes a slot; f, g, h go to Other");
  assert.deepEqual(slices.at(-1)!.grouped, ["f", "g", "h"]);
  assert.equal(Math.round(slices.reduce((sum, s) => sum + s.percent, 0) * 10), 1000);
});

test("pie: more capped categories than slots: all capped stay, no Other of one", () => {
  const nine = Array.from({ length: 9 }, (_, i) => ({ category: `c${i}`, amount: 100 - i }));
  const capped = nine.slice(0, 8).map((c) => c.category).reverse(); // order of the list doesn't matter
  const slices = pieSlices(nine, 6, capped);
  assert.equal(slices.length, 9, "8 capped + 1 left: an Other of one would just hide its name");
  assert.ok(!slices.some((s) => s.grouped));

  const ten = [...nine, { category: "c9", amount: 1 }];
  const withOther = pieSlices(ten, 6, capped);
  assert.deepEqual(withOther.at(-1)!.grouped, ["c8", "c9"]);
  assert.ok(capped.every((c) => withOther.some((s) => s.category === c)), "every capped category has its slice");
});

test("pie: capped categories with nothing spent (or refunds only) still aren't slices", () => {
  assert.deepEqual(pieSlices([{ category: "a", amount: 10 }, { category: "b", amount: -5 }], 6, ["b", "c"]).map((s) => s.category), ["a"]);
});
