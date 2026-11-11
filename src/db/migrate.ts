// Copies the JSON files under data/ into SQLite (data/app.db). Run with: npm run migrate
// Safe to repeat: files already imported are skipped. The JSON files are not changed or deleted.

import type { Totals } from "../report";
import { DATA_DIR } from "../store";
import { openDb } from "./index";
import { migrateJson } from "./migrate-json";

const show = (t: Totals) =>
  Object.entries(t)
    .map(([currency, amount]) => `${amount} ${currency}`)
    .join(" · ");

const db = openDb();
const r = migrateJson(db, DATA_DIR);

for (const m of r.months) {
  const status = m.alreadyImported ? "already imported" : "imported";
  console.log(`${m.matches ? "✓" : "✗"} ${m.month}: ${m.rows} rows ${status} · ${show(m.db)}`);
  if (!m.matches) console.log(`    JSON file says: ${show(m.json)}`);
}
console.log(
  `Categories +${r.categoriesAdded} · rules +${r.rulesAdded} · agent runs +${r.runsAdded} · ` +
    `proposals +${r.proposalsAdded} · flags +${r.flagsAdded}` +
    (r.flagsSkipped ? ` (${r.flagsSkipped} skipped: transaction not found)` : ""),
);
if (r.months.some((m) => !m.matches)) {
  console.log("✗ Some months don't match their JSON file. See above.");
  process.exitCode = 1;
}
