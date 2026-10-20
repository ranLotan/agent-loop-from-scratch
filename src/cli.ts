import { importStatementFile } from "./statement-import";
import { categorize, validateRules } from "./categorize";
import { renderAnnualMarkdown, renderMarkdown, summarize, totalsByCurrency } from "./report";
import { mapScrapedAccounts, scrapeCal } from "./scraper";
import {
  listMonths,
  loadRules,
  loadTransactions,
  rawPath,
  saveRaw,
  saveReport,
  saveTransactions,
} from "./store";
import type { Transaction } from "./types";

const USAGE = `Usage:
  npm run fetch -- [YYYY-MM] [--show]                Scrape Cal for a billing month (default: current; --show opens the browser)
  npm run import -- <file.xlsx|file.csv> [YYYY-MM]   Import a Cal export (month defaults to the statement's billing month)
  npm run report -- <YYYY-MM>                        Categorize and write the monthly report
  npm run annual -- <YYYY>                           Summarize all imported months of a year`;

function requireMonth(month: string | undefined): string {
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`Expected a month like 2026-09, got "${month ?? ""}".\n\n${USAGE}`);
  }
  return month;
}

function runImport(file: string | undefined, monthArg: string | undefined) {
  if (!file) throw new Error(USAGE);
  const { transactions, billingDate, checks, skipped } = importStatementFile(file);
  if (!monthArg && !billingDate) {
    throw new Error(`No billing date found in the file, so pass the statement month.\n\n${USAGE}`);
  }
  const month = requireMonth(monthArg ?? billingDate!.slice(0, 7));

  // Re-importing the same statement overwrites it, so the import is safe to repeat.
  const path = saveTransactions(month, transactions);
  console.log(`Imported ${transactions.length} transactions for ${month} → ${path}`);
  if (billingDate) console.log(`Billing date on statement: ${billingDate}`);
  for (const c of checks) {
    const ok = Math.abs(c.expected - c.actual) < 0.01;
    console.log(`${ok ? "✓" : "✗"} ${c.currency} section total ${c.expected} vs rows ${c.actual}  (${c.section})`);
  }
  if (skipped) console.log(`Skipped ${skipped} non-transaction rows (titles, footers, totals).`);
  if (checks.some((c) => Math.abs(c.expected - c.actual) >= 0.01)) {
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
  const accounts = await scrapeCal(month, {
    showBrowser: args.includes("--show"),
    failureScreenshotPath: rawPath("failure.png"),
  });
  const rawFile = saveRaw(`${month}.json`, accounts);
  const { transactions, pending, otherMonths } = mapScrapedAccounts(accounts, month);
  const previous = loadTransactions(month);
  const path = saveTransactions(month, transactions);

  const cards = [...new Set(transactions.map((t) => t.card))].join(", ");
  console.log(`Fetched ${transactions.length} transactions billed in ${month} (cards: ${cards || "none"}) → ${path}`);
  console.log(`Raw scraper output → ${rawFile}`);
  console.log(`Ignored: ${pending} pending, ${otherMonths} billed in other months.`);

  // If this month was imported before (e.g. from the xlsx), show whether both sources agree.
  if (previous) {
    const [before, after] = [totalsByCurrency(previous), totalsByCurrency(transactions)];
    for (const c of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const ok = Math.abs((before[c] ?? 0) - (after[c] ?? 0)) < 0.01;
      console.log(`${ok ? "✓" : "✗"} ${c}: previous ${before[c] ?? 0} vs fetched ${after[c] ?? 0}`);
    }
    const newIds = new Set(transactions.map((t) => t.id));
    const oldIds = new Set(previous.map((t) => t.id));
    const onlyOld = previous.filter((t) => !newIds.has(t.id));
    const onlyNew = transactions.filter((t) => !oldIds.has(t.id));
    console.log(`Same id in both: ${transactions.length - onlyNew.length} of ${transactions.length}`);
    const show = (label: string, list: Transaction[]) =>
      list.slice(0, 10).forEach((t) => console.log(`  ${label} ${t.date} ${t.merchant} ${t.amount} ${t.currency}`));
    show("only previous:", onlyOld);
    show("only fetched: ", onlyNew);
  }
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
