// M6 step 6.1: read-only look at the saved scraper output (data/raw/<month>.json), to decide
// R1 (pending charges) and R2 (installments). Prints SHAPES only: field names, statuses, month
// offsets and hashed keys. No merchant names, amounts, card numbers or exact dates.
// Run: npx tsx src/investigate-raw.ts

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { israelDate } from "./scraper";

interface RawTxn {
  identifier?: string | number;
  date: string;
  processedDate?: string;
  description: string;
  originalAmount: number;
  chargedAmount: number;
  status: string;
  installments?: { number: number; total: number };
  rawTransaction?: Record<string, unknown>;
  [key: string]: unknown;
}

const RAW_DIR = join(fileURLToPath(new URL("../data", import.meta.url)), "raw");
const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 6);
const month = (iso: string | undefined) => (iso ? israelDate(iso).slice(0, 7) : "none");
const monthDiff = (a: string, b: string) => {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
};
const tally = (counts: Map<string, number>, key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
const show = (title: string, counts: Map<string, number>) => {
  console.log(`  ${title}`);
  for (const [k, n] of [...counts].sort()) console.log(`    ${k}: ${n}`);
};

const files = readdirSync(RAW_DIR).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort();
if (files.length === 0) throw new Error(`No <month>.json files in ${RAW_DIR}`);

const all: { file: string; t: RawTxn }[] = [];
for (const file of files) {
  const accounts = JSON.parse(readFileSync(join(RAW_DIR, file), "utf8")) as { txns: RawTxn[] }[];
  for (const a of accounts) for (const t of a.txns) all.push({ file, t });
}
console.log(`Files: ${files.join(", ")}  (${all.length} transactions)\n`);

// 1. Overall shape.
console.log("== 1. Status and type ==");
const byStatus = new Map<string, number>();
const byType = new Map<string, number>();
for (const { t } of all) {
  tally(byStatus, t.status);
  tally(byType, `${t.status} / trnTypeCode ${String(t.rawTransaction?.trnTypeCode ?? "?")}`);
}
show("status:", byStatus);
show("status / type:", byType);

// 2. R1: what a pending row looks like, versus a completed one.
console.log("\n== 2. R1: pending rows ==");
const fieldsOf = (status: string) => {
  const top = new Map<string, number>();
  const raw = new Map<string, number>();
  for (const { t } of all.filter((x) => x.t.status === status)) {
    for (const [k, v] of Object.entries(t)) if (v !== undefined && v !== null && v !== "") tally(top, k);
    for (const [k, v] of Object.entries(t.rawTransaction ?? {})) if (v !== undefined && v !== null && v !== "") tally(raw, k);
  }
  return { top, raw };
};
const pend = fieldsOf("pending");
const done = fieldsOf("completed");
const keys = (m: Map<string, number>) => [...m.keys()].sort();
console.log(`  pending top-level fields:    ${keys(pend.top).join(", ") || "(no pending rows)"}`);
console.log(`  completed top-level fields:  ${keys(done.top).join(", ")}`);
console.log(`  only in completed rawTransaction: ${keys(done.raw).filter((k) => !pend.raw.has(k)).join(", ") || "-"}`);
console.log(`  only in pending rawTransaction:   ${keys(pend.raw).filter((k) => !done.raw.has(k)).join(", ") || "-"}`);
const pendingDates = new Map<string, number>();
for (const { file, t } of all.filter((x) => x.t.status === "pending")) {
  const fileMonth = file.slice(0, 7);
  tally(pendingDates, `file ${fileMonth}: purchase month offset ${monthDiff(fileMonth, month(t.date))}, processedDate month offset ${t.processedDate ? monthDiff(fileMonth, month(t.processedDate)) : "none"}, identifier ${t.identifier === undefined ? "missing" : "present"}`);
}
show("pending rows (offsets relative to the scrape's month):", pendingDates);

// 3. R1: the same charge pending in one file and completed in a later one.
console.log("\n== 3. R1: pending → completed across files ==");
let pairs = 0;
const pairShapes = new Map<string, number>();
for (const p of all.filter((x) => x.t.status === "pending")) {
  const later = all.find(
    (c) =>
      c.file > p.file &&
      c.t.status === "completed" &&
      c.t.description === p.t.description &&
      c.t.originalAmount === p.t.originalAmount,
  );
  if (!later) continue;
  pairs++;
  const sameDate = israelDate(p.t.date) === israelDate(later.t.date);
  const sameId = p.t.identifier !== undefined && p.t.identifier === later.t.identifier;
  const sameCharged = p.t.chargedAmount === later.t.chargedAmount;
  tally(pairShapes, `date same: ${sameDate}, identifier same: ${sameId}, chargedAmount same: ${sameCharged}, billed in file month +${monthDiff(p.file.slice(0, 7), month(later.t.processedDate))}`);
  if (pairs <= 5) console.log(`  example ${hash(p.t.description)}: pending in ${p.file}, completed in ${later.file}`);
}
console.log(`  matched pairs: ${pairs}`);
show("pair shapes:", pairShapes);

// 4. R2: installments. The scraper shifts `date` by (n-1) months; src/scraper.ts undoes it.
console.log("\n== 4. R2: installments ==");
const inst = new Map<string, number>();
for (const { t } of all.filter((x) => x.t.installments && x.t.status === "completed")) {
  const n = t.installments!.number;
  const purchase = month(t.date); // as the scraper gives it (shifted)
  tally(inst, `payment ${n === 1 ? "1" : "N≥2"}: billed − scraper date = ${monthDiff(purchase, month(t.processedDate))} month(s)`);
}
show("billing month relative to the scraper's (shifted) date:", inst);
const groups = new Map<string, RawTxn[]>();
for (const { t } of all.filter((x) => x.t.installments && x.t.status === "completed")) {
  const key = `${t.description}|${t.originalAmount}|${t.installments!.total}`;
  const list = groups.get(key) ?? [];
  if (!list.some((x) => x.installments!.number === t.installments!.number)) list.push(t);
  groups.set(key, list);
}
const steps = new Map<string, number>();
for (const list of groups.values()) {
  list.sort((a, b) => a.installments!.number - b.installments!.number);
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    tally(steps, `payment ${a.installments!.number}→${b.installments!.number}: billing months apart ${monthDiff(month(a.processedDate), month(b.processedDate))}, scraper dates apart ${monthDiff(month(a.date), month(b.date))}`);
  }
}
show("consecutive payments of the same purchase:", steps);

// 5. Completeness: how far after the purchase month a regular charge is billed.
console.log("\n== 5. Regular charges: billed how many months after purchase ==");
const lag = new Map<string, number>();
for (const { t } of all.filter((x) => !x.t.installments && x.t.status === "completed")) {
  tally(lag, `+${monthDiff(month(t.date), month(t.processedDate))} month(s), purchase day ${Number(israelDate(t.date).slice(8)) <= 15 ? "1–15" : "16–31"}`);
}
show("lag:", lag);
