import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import type { Transaction } from "./types";

/**
 * Header names we recognize, per field. Cal's export uses Hebrew headers;
 * the English ones let you hand-write a CSV. Matching is case- and
 * whitespace-insensitive, so "סכום\nחיוב" matches "סכום חיוב".
 */
const COLUMN_ALIASES = {
  date: ["date", "תאריך עסקה", "תאריך"],
  merchant: ["merchant", "description", "שם בית עסק", "שם בית העסק", "בית עסק"],
  amount: ["amount", "charged amount", "סכום חיוב"],
  originalAmount: ["original amount", "סכום עסקה"],
  currency: ["currency", "מטבע"],
  type: ["type", "סוג עסקה"],
  sector: ["sector", "ענף"],
  memo: ["memo", "notes", "הערות"],
};
type Field = keyof typeof COLUMN_ALIASES;
type ColumnMap = Partial<Record<Field, number>>;

const CURRENCY_SYMBOLS: Record<string, string> = { "₪": "ILS", "$": "USD", "€": "EUR", "£": "GBP" };

export interface ParsedStatement {
  transactions: Transaction[];
  /** From "עסקאות לחיוב ב-10/09/2026"; gives the statement month. */
  billingDate?: string;
  /** Each section's printed total vs. the sum of its rows: a sanity check on the parser. */
  checks: { section: string; currency: string; expected: number; actual: number }[];
  /** Non-empty rows that were neither headers, section titles nor transactions. */
  skipped: number;
}

// ---------- Readers: file → rows of text cells ----------

const pad = (n: number) => String(n).padStart(2, "0");

/** Dates come from the cell's numeric value, not its display text, so day/month order can't flip. */
function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";
  if (cell.t === "n" && cell.z && XLSX.SSF.is_date(cell.z)) {
    const d = XLSX.SSF.parse_date_code(cell.v as number);
    return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
  }
  // Display text keeps the currency symbol ("€ 39.30"), which the raw number loses.
  return cell.w ?? String(cell.v ?? "");
}

function readXlsxRows(path: string): string[][] {
  const wb = XLSX.read(readFileSync(path), { cellNF: true });
  const rows: string[][] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) row.push(cellText(ws[XLSX.utils.encode_cell({ r, c })]));
      rows.push(row);
    }
  }
  return rows;
}

function readCsvRows(text: string): string[][] {
  return parse(text, { bom: true, relax_column_count: true, skip_empty_lines: true });
}

// ---------- Cell parsers ----------

/** Accepts YYYY-MM-DD, DD/MM/YYYY, D/M/YY and DD.MM.YYYY. Returns YYYY-MM-DD or null. */
export function parseDate(raw: string | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
}

/** Parses "₪ 1,234.50", "-₪ 84.00", "$35.99", "USD 35.99" or "120-". */
export function parseAmount(raw: string | undefined): { value: number; currency?: string } | null {
  if (!raw?.trim()) return null;
  const digits = raw.replace(/[^\d.]/g, "");
  if (!digits) return null;
  const value = Number(digits);
  if (Number.isNaN(value)) return null;
  const symbol = Object.keys(CURRENCY_SYMBOLS).find((s) => raw.includes(s));
  const code = raw.toUpperCase().match(/\b(ILS|USD|EUR|GBP)\b/)?.[1];
  return {
    value: raw.includes("-") ? -value : value,
    currency: code ?? (symbol ? CURRENCY_SYMBOLS[symbol] : undefined),
  };
}

function parseInstallments(memo: string | undefined): Transaction["installments"] {
  const m = memo?.match(/תשלום (\d+) מתוך (\d+)/);
  return m ? { number: Number(m[1]), total: Number(m[2]) } : undefined;
}

// ---------- Statement structure ----------

function normalizeHeader(h: string): string {
  return h.replace(/\s+/g, " ").trim().toLowerCase();
}

function matchHeader(row: string[]): ColumnMap | null {
  const cells = row.map(normalizeHeader);
  const columns: ColumnMap = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [Field, string[]][]) {
    const col = cells.findIndex((c) => aliases.includes(c));
    if (col !== -1) columns[field] = col;
  }
  const hasAmount = columns.amount !== undefined || columns.originalAmount !== undefined;
  return columns.date !== undefined && columns.merchant !== undefined && hasAmount ? columns : null;
}

function parseRow(row: string[], columns: ColumnMap, source: Transaction["source"]): Omit<Transaction, "id"> | null {
  const cell = (field: Field) => {
    const col = columns[field];
    return col === undefined ? undefined : row[col]?.trim() || undefined;
  };
  const date = parseDate(cell("date"));
  const merchant = cell("merchant")?.replace(/\s+/g, " ");
  if (!date || !merchant) return null;

  const original = parseAmount(cell("originalAmount"));
  // A blank charged cell means nothing was charged this statement (e.g. a waived card fee).
  // Only when the file has no charged column at all do we fall back to the original amount.
  const charged =
    columns.amount !== undefined ? (parseAmount(cell("amount")) ?? { value: 0, currency: original?.currency }) : original;
  if (!charged) return null;

  const currency = charged.currency ?? cell("currency")?.toUpperCase() ?? original?.currency ?? "ILS";
  const tx: Omit<Transaction, "id"> = { date, merchant, amount: charged.value, currency, source };
  if (original && (original.value !== charged.value || (original.currency ?? currency) !== currency)) {
    tx.originalAmount = original.value;
    tx.originalCurrency = original.currency ?? currency;
  }
  const type = cell("type");
  if (type) tx.type = type;
  const sector = cell("sector");
  if (sector) tx.sector = sector;
  const memo = cell("memo");
  if (memo) tx.memo = memo;
  const installments = parseInstallments(memo);
  if (installments) tx.installments = installments;
  return tx;
}

/** A section title like "עסקאות לחיוב ב-10/09/2026: 12,387.66 ₪" or "עסקאות בחיוב מיידי 1,267.58 €". */
function parseSectionTotal(text: string) {
  const m = text.match(/-?[\d,]+\.\d{2}\s*[₪$€£]|[₪$€£]\s*-?[\d,]+\.\d{2}/);
  return m ? parseAmount(m[0]) : null;
}

/**
 * Walks the rows top to bottom. Cal's export has several sections (ILS billing,
 * then USD/EUR immediate debits), each with a title line (holding a total) and its own header row.
 */
export function parseStatement(rows: string[][], source: Transaction["source"]): ParsedStatement {
  const transactions: Transaction[] = [];
  const checks: ParsedStatement["checks"] = [];
  const seen = new Map<string, number>();
  let billingDate: string | undefined;
  let skipped = 0;

  let title = "";
  type Amount = { value: number; currency?: string };
  let pendingTotal: Amount | null = null;
  let section: { columns: ColumnMap; title: string; expected: Amount | null; sums: Map<string, number> } | null = null;

  const closeSection = () => {
    if (section?.expected?.currency) {
      const { currency, value } = section.expected;
      const actual = Math.round((section.sums.get(currency) ?? 0) * 100) / 100;
      checks.push({ section: section.title, currency, expected: value, actual });
    }
  };

  for (const row of rows) {
    const text = row.filter(Boolean).join(" ").trim();
    if (!text) continue;

    const columns = matchHeader(row);
    if (columns) {
      closeSection();
      section = { columns, title, expected: pendingTotal, sums: new Map() };
      pendingTotal = null;
      continue;
    }

    const tx = section && parseRow(row, section.columns, source);
    if (section && tx) {
      // Same date+merchant+amount twice is legit (two coffees), so number the repeats.
      const key = `${tx.date}|${tx.merchant}|${tx.amount}|${tx.currency}`;
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);
      const id = createHash("sha1").update(`${key}|${occurrence}`).digest("hex").slice(0, 12);
      transactions.push({ id, ...tx });
      section.sums.set(tx.currency, (section.sums.get(tx.currency) ?? 0) + tx.amount);
      continue;
    }

    // Not a header or a transaction: a section title, a footer, or a summary row.
    const billing = text.match(/לחיוב ב-?\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (billing) billingDate = parseDate(billing[1]) ?? billingDate;
    const amountCol = section?.columns.amount;
    const footerTotal = amountCol !== undefined ? parseAmount(row[amountCol]) : null;
    const titleTotal = parseSectionTotal(text);
    if (section && footerTotal) {
      // A total in the amount column after the rows (a "סה״כ" line): checks the current section.
      section.expected ??= footerTotal;
    } else if (titleTotal) {
      // A title line like "עסקאות בחיוב מיידי 1,267.58 €": applies to the next section.
      title = text;
      pendingTotal = titleTotal;
    } else {
      skipped++;
    }
  }
  closeSection();

  if (!transactions.length) {
    throw new Error(
      "No transactions found. Is there a header row with date, merchant and amount columns?\n" +
        `Recognized headers: ${JSON.stringify(COLUMN_ALIASES, null, 2)}`,
    );
  }
  return { transactions, billingDate, checks, skipped };
}

/** Reads a Cal export: .xlsx as downloaded from the Cal site, or .csv as a fallback. */
export function importStatementFile(path: string): ParsedStatement {
  const ext = extname(path).toLowerCase();
  if (ext === ".xlsx" || ext === ".xls") return parseStatement(readXlsxRows(path), "xlsx");
  if (ext === ".csv") return parseStatement(readCsvRows(readFileSync(path, "utf8")), "csv");
  throw new Error(`Unsupported file type "${ext}". Use the .xlsx from Cal, or a .csv.`);
}
