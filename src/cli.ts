import { importStatementFile } from "./statement-import";
import { categorize, validateRules } from "./categorize";
import { renderAnnualMarkdown, renderMarkdown, summarize } from "./report";
import { listMonths, loadRules, loadTransactions, saveReport, saveTransactions } from "./store";

const USAGE = `Usage:
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

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "import") runImport(args[0], args[1]);
  else if (command === "report") runReport(args[0]);
  else if (command === "annual") runAnnual(args[0]);
  else console.log(USAGE);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
