import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { categorize, validateRules } from "./categorize";
import type { ImportResult } from "./db/imports";
import { fetchMonth, importStatement } from "./imports";
import { isMonth } from "./normalize";
import { renderAnnualMarkdown, renderMarkdown, summarize } from "./report";
import { databaseLabel, listMonths, loadRules, loadTransactions, saveReport } from "./store";
import type { Transaction } from "./types";

const USAGE = `Usage:
  npm run fetch -- [YYYY-MM] [--show]                Scrape Cal for a billing month (default: current; --show opens the browser)
  npm run import -- <file.xlsx|file.csv> [YYYY-MM]   Import a Cal export (month defaults to the statement's billing month)
  npm run report -- <YYYY-MM>                        Categorize and write the monthly report
  npm run annual -- <YYYY>                           Summarize all imported months of a year`;

function requireMonth(month: string | undefined): string {
  if (!month || !isMonth(month)) {
    throw new Error(`Expected a month like 2026-09, got "${month ?? ""}".\n\n${USAGE}`);
  }
  return month;
}

const showRows = (label: string, list: Transaction[]) =>
  list.slice(0, 10).forEach((t) => console.log(`  ${label} ${t.date} ${t.merchant} ${t.amount} ${t.currency}`));

/** What an import did to the month, shared by import and fetch. */
function printImportResult(r: ImportResult, month: string) {
  if (r.duplicate) {
    console.log(`This exact file was imported before (batch ${r.batchId}); nothing changed.`);
    return;
  }
  console.log(`${month} → ${databaseLabel()}: ${r.added} new, ${r.updated} updated, ${r.missing.length} no longer on the statement`);
  if (r.missing.length) console.log("Rows the new import doesn't have are kept, but left out of reports:");
  showRows("missing:", r.missing);
}

function runImport(file: string | undefined, monthArg: string | undefined) {
  if (!file) throw new Error(USAGE);
  if (monthArg !== undefined) requireMonth(monthArg);
  const r = importStatement(readFileSync(file), basename(file), monthArg);

  console.log(`Read ${r.count} transactions for ${r.month} from ${r.fileName}`);
  if (r.billingDate) console.log(`Billing date on statement: ${r.billingDate}`);
  for (const c of r.checks) {
    const ok = Math.abs(c.expected - c.actual) < 0.01;
    console.log(`${ok ? "✓" : "✗"} ${c.currency} section total ${c.expected} vs rows ${c.actual}  (${c.section})`);
  }
  if (r.skipped) console.log(`Skipped ${r.skipped} non-transaction rows (titles, footers, totals).`);
  printImportResult(r, r.month);
  if (!r.checksOk) {
    console.log("Warning: a section total doesn't match its rows; the parser may be misreading the file.");
    process.exitCode = 1;
  }
}

function runReport(monthArg: string | undefined) {
  const month = requireMonth(monthArg);
  const transactions = loadTransactions(month);
  if (!transactions) throw new Error(`No transactions for ${month}. Run: npm run import -- <file.xlsx>`);

  const rules = loadRules();
  validateRules(rules);
  const markdown = renderMarkdown(month, summarize(categorize(transactions, rules)));
  const path = saveReport(month, markdown);
  console.log(markdown);
  console.log(`Saved → ${path}`);
}

function runAnnual(year: string | undefined) {
  if (!year || !/^\d{4}$/.test(year)) throw new Error(`Expected a year like 2026, got "${year ?? ""}".\n\n${USAGE}`);
  const months = listMonths(year);
  if (!months.length) throw new Error(`No imported months for ${year}. Run: npm run import -- <file.xlsx>`);

  const rules = loadRules();
  validateRules(rules);
  const perMonth = months.map((month) => ({ month, transactions: categorize(loadTransactions(month)!, rules) }));
  const markdown = renderAnnualMarkdown(
    year,
    perMonth.map((m) => ({ month: m.month, summary: summarize(m.transactions) })),
    summarize(perMonth.flatMap((m) => m.transactions)),
  );
  const path = saveReport(year, markdown);
  console.log(markdown);
  console.log(`Saved → ${path}`);
}

async function runFetch(args: string[]) {
  const now = new Date();
  const month = requireMonth(
    args.find((a) => !a.startsWith("--")) ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );
  try {
    process.loadEnvFile(); // .env → process.env (built into Node, no dotenv needed)
  } catch {
    // No .env: scrapeCal reports which variables are missing.
  }

  console.log(`Logging in to Cal and fetching ${month}... (takes ~30s)`);
  const r = await fetchMonth(month, { showBrowser: args.includes("--show") });

  console.log(`Fetched ${r.count} transactions billed in ${month} (cards: ${r.cards.join(", ") || "none"})`);
  console.log(`Raw scraper output → ${r.rawFile}`);
  console.log(`Ignored: ${r.pending} pending, ${r.otherMonths} billed in other months.`);

  // If this month was imported before (e.g. from the xlsx), show whether both sources agree.
  for (const c of r.comparison ?? []) {
    const ok = Math.abs(c.before - c.after) < 0.01;
    console.log(`${ok ? "✓" : "✗"} ${c.currency}: previous ${c.before} vs fetched ${c.after}`);
  }
  printImportResult(r, month);
  showRows("only fetched:", r.onlyFetched);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "import") runImport(args[0], args[1]);
  else if (command === "fetch") await runFetch(args);
  else if (command === "report") runReport(args[0]);
  else if (command === "annual") runAnnual(args[0]);
  else console.log(USAGE);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
