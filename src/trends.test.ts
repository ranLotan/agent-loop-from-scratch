import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryTrend, defaultSelection, singleCapped, trendTotals } from "./trends";

test("period totals: sums, Net and monthly averages (an empty month still counts in the average)", () => {
  const t = trendTotals([
    { income: 0, expenses: 16466.71 },
    { income: 30170, expenses: 22901.33 },
    { income: 0, expenses: 0 },
  ]);
  assert.deepEqual(t, { months: 3, income: 30170, expenses: 39368.04, net: -9198.04, avgIncome: 10056.67, avgExpenses: 13122.68 });
  assert.deepEqual(trendTotals([]), { months: 0, income: 0, expenses: 0, net: 0, avgIncome: 0, avgExpenses: 0 });
});

const months = [
  { month: "2026-06", byCategory: [{ category: "food", amount: 980 }, { category: "kids", amount: 1200 }, { category: "rent", amount: 8200 }] },
  { month: "2026-07", byCategory: [{ category: "food", amount: 1120 }, { category: "kids", amount: 2100 }] },
  { month: "2026-08", byCategory: [{ category: "rent", amount: 8200 }, { category: "refunds", amount: -50 }] },
];
const caps = [{ category: "food", cap: 1000 }, { category: "kids", cap: 1500 }, { category: "gifts", cap: 200 }];

test("category trend: amounts per month (0 when nothing), over flags, period totals", () => {
  const t = categoryTrend(months, ["food", "kids", "rent"], caps);
  assert.deepEqual(t.rows.map((r) => [r.month, r.amounts, r.total, r.over]), [
    ["2026-06", { food: 980, kids: 1200, rent: 8200 }, 10380, []],
    ["2026-07", { food: 1120, kids: 2100, rent: 0 }, 3220, ["food", "kids"]],
    ["2026-08", { food: 0, kids: 0, rent: 8200 }, 8200, []],
  ]);
  assert.deepEqual(t.categories, [
    { category: "food", cap: 1000, total: 2100 },
    { category: "kids", cap: 1500, total: 3300 },
    { category: "rent", cap: null, total: 16400 },
  ]);
  assert.equal(t.total, 21800);
  assert.equal(t.single, null, "three selected: not the single-cap view");
});

test("category trend: available = spending in the period or a cap, biggest first; refunds-only left out", () => {
  const t = categoryTrend(months, [], caps);
  assert.deepEqual(t.available.map((a) => [a.category, a.total, a.cap]), [
    ["rent", 16400, null], ["kids", 3300, 1500], ["food", 2100, 1000], ["gifts", 0, 200],
  ]);
  assert.deepEqual(t.categories, [], "an explicit empty selection stays empty");
});

test("default selection: the capped categories, or the 3 biggest when nothing is capped", () => {
  assert.deepEqual(categoryTrend(months, null, caps).categories.map((c) => c.category), ["food", "kids", "gifts"]);
  const none = categoryTrend(months, null, []);
  assert.deepEqual(none.categories.map((c) => c.category), ["rent", "kids", "food"]);
  assert.deepEqual(defaultSelection([], []), []);
});

test("single-cap mode: on only with exactly one selected category that has a cap", () => {
  assert.deepEqual(singleCapped(["food"], caps), { category: "food", cap: 1000 });
  assert.equal(singleCapped(["rent"], caps), null, "no cap");
  assert.equal(singleCapped(["food", "kids"], caps), null, "two selected");
  assert.equal(singleCapped([], caps), null);
});

test("single-cap view: per month vs cap, cap total = cap × months, months over", () => {
  const { single } = categoryTrend(months, ["food"], caps);
  assert.deepEqual(single!.months.map((m) => [m.month, m.expenses, m.remaining, m.over]), [
    ["2026-06", 980, 20, false],
    ["2026-07", 1120, -120, true],
    ["2026-08", 0, 1000, false],
  ]);
  assert.deepEqual([single!.expenses, single!.capTotal, single!.remaining, single!.monthsOver], [2100, 3000, 900, ["2026-07"]]);
  assert.equal(categoryTrend(months, ["food", "food"], caps).categories.length, 1, "a repeated name counts once");
});
