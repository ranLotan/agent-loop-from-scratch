import { CompanyTypes, createScraper, type ScraperScrapingResult } from "israeli-bank-scrapers";
import { assignIds, currencyCode, round2 } from "./normalize";
import type { Transaction } from "./types";

type Account = NonNullable<ScraperScrapingResult["accounts"]>[number];
type ScrapedTxn = Account["txns"][number];

/** Cal's trnTypeCode → the same Hebrew label the xlsx export shows in "סוג עסקה". */
const CAL_TYPE_LABELS: Record<string, string> = { "5": "רגילה", "6": "זיכוי", "8": "תשלומים", "9": "הוראת קבע" };

/** Scraper dates are UTC ISO strings; a purchase at local midnight would otherwise land on the previous day. */
export function israelDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(iso));
}

/** The scraper shifts an installment's date forward by (n-1) months; undo it to match the statement. */
function subtractMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

function mapTxn(t: ScrapedTxn, card: string): Omit<Transaction, "id"> {
  // The scraper uses negative = expense; we use positive = money spent.
  const amount = round2(-t.chargedAmount);
  const currency = currencyCode(t.chargedCurrency) ?? currencyCode(t.originalCurrency) ?? "ILS";
  const date = israelDate(t.date);
  const tx: Omit<Transaction, "id"> = {
    date: t.installments ? subtractMonths(date, t.installments.number - 1) : date,
    merchant: t.description.replace(/\s+/g, " ").trim(),
    amount,
    currency,
    card,
    source: "scraper",
  };
  const originalAmount = round2(-t.originalAmount);
  const originalCurrency = currencyCode(t.originalCurrency) ?? currency;
  if (originalAmount !== amount || originalCurrency !== currency) {
    tx.originalAmount = originalAmount;
    tx.originalCurrency = originalCurrency;
  }
  const type = CAL_TYPE_LABELS[(t.rawTransaction as { trnTypeCode?: string } | undefined)?.trnTypeCode ?? ""];
  if (type) tx.type = type;
  if (t.installments) tx.installments = { number: t.installments.number, total: t.installments.total };
  if (t.category) tx.sector = t.category;
  if (t.memo?.trim()) tx.memo = t.memo.trim();
  return tx;
}

/**
 * Pure mapping, no network: keeps completed transactions billed in `month`.
 * A statement month is defined by the billing date (processedDate), same as the xlsx export.
 */
export function mapScrapedAccounts(accounts: Account[], month: string) {
  const kept: Omit<Transaction, "id">[] = [];
  let pending = 0;
  let otherMonths = 0;
  for (const account of accounts) {
    for (const t of account.txns) {
      if (t.status === "pending") pending++;
      else if (israelDate(t.processedDate).slice(0, 7) !== month) otherMonths++;
      else kept.push(mapTxn(t, account.accountNumber));
    }
  }
  return { transactions: assignIds(kept), pending, otherMonths };
}

/** Logs in to Cal with a headless browser and returns every card's transactions from `month` onward. */
export async function scrapeCal(month: string, opts: { showBrowser: boolean; failureScreenshotPath: string }) {
  const { CAL_USERNAME: username, CAL_PASSWORD: password } = process.env;
  if (!username || !password) throw new Error("Set CAL_USERNAME and CAL_PASSWORD in .env (see .env.example).");

  const [year, m] = month.split("-").map(Number);
  const scraper = createScraper({
    companyId: CompanyTypes.visaCal,
    startDate: new Date(year, m - 1, 1),
    showBrowser: opts.showBrowser,
    includeRawTransaction: true, // needed for trnTypeCode (standing order vs. regular)
    outputData: { enableTransactionsFilterByDate: false }, // we filter by billing month ourselves
    storeFailureScreenShotPath: opts.failureScreenshotPath,
  });
  const result = await scraper.scrape({ username, password });
  if (!result.success) {
    throw new Error(`Cal scrape failed (${result.errorType}): ${result.errorMessage ?? "no details"}`);
  }
  return result.accounts ?? [];
}
