import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryColors, OTHER_COLOR } from "./chart-colors";

test("a category keeps its pie color; others take the free slots in name order", () => {
  const pie = [{ category: "rent" }, { category: "food" }, { category: "Other", grouped: ["x", "y"] }];
  const colors = categoryColors(pie, ["kids", "food", "bills", "rent"]);
  assert.equal(colors.get("rent"), "var(--series-1)");
  assert.equal(colors.get("food"), "var(--series-2)");
  assert.equal(colors.get("bills"), "var(--series-3)", "bills before kids (name order)");
  assert.equal(colors.get("kids"), "var(--series-4)");
  assert.ok(!colors.has("Other"), "the Other slice isn't a category");
});

test("colors don't depend on the selection, and past 7 a category is gray, not a new hue", () => {
  const names = Array.from({ length: 9 }, (_, i) => `c${i}`);
  const colors = categoryColors([], names);
  assert.equal(new Set([...colors.values()].filter((c) => c !== OTHER_COLOR)).size, 7);
  assert.deepEqual([colors.get("c7"), colors.get("c8")], [OTHER_COLOR, OTHER_COLOR]);
  assert.equal(categoryColors([], names).get("c3"), colors.get("c3"), "same list, same colors");
});
