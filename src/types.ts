/**
 * A single card transaction, normalized from any input source.
 * Statement import (xlsx/csv) produces these today; the scraper (milestone 2) will too,
 * so everything downstream (categorize, report, agent) stays source-agnostic.
 */
export interface Transaction {
  id: string;
  /** Purchase date, YYYY-MM-DD. */
  date: string;
  /** Merchant name as printed on the statement. */
  merchant: string;
  /** Amount charged on this statement. Positive = money spent, negative = refund. */
  amount: number;
  /** Currency of `amount`: usually "ILS"; Cal's immediate-debit sections charge in USD/EUR. */
  currency: string;
  /** Set only when it differs from what was charged: foreign purchase, installment plan or discount. */
  originalAmount?: number;
  originalCurrency?: string;
  /** Cal's transaction type (סוג עסקה): רגילה, הוראת קבע, תשלומים, זיכוי... */
  type?: string;
  /** Parsed from a memo like "תשלום 3 מתוך 3". */
  installments?: { number: number; total: number };
  /** Cal's own business sector (ענף). Used as the default category when no rule matches. */
  sector?: string;
  memo?: string;
  /** Last 4 digits of the card; set by the scraper, which can return several cards. */
  card?: string;
  source: "xlsx" | "csv" | "scraper";
}

/** Exact merchant → category mapping, applied by plain code. */
export interface Rule {
  merchant: string;
  category: string;
}

export interface RulesFile {
  /** Categories a rule may assign. Cal's sectors are accepted as-is. */
  categories: string[];
  rules: Rule[];
}

export interface CategorizedTransaction extends Transaction {
  /** null = neither a rule nor Cal had a category; this is the pile the agent will handle. */
  category: string | null;
  categorySource: "rule" | "cal" | null;
}
