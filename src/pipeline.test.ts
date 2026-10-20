import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseDate, parseStatement } from "./statement-import";
import { categorize } from "./categorize";
import { mapScrapedAccounts } from "./scraper";
import { renderAnnualMarkdown, summarize } from "./report";

test("parseDate handles Cal formats", () => {
  assert.equal(parseDate("05/09/2026"), "2026-09-05");
  assert.equal(parseDate("5.9.26"), "2026-09-05");
  assert.equal(parseDate("2026-09-05"), "2026-09-05");
  assert.equal(parseDate("סה״כ"), null);
});

test("parseAmount handles symbols, thousands and refunds", () => {
  assert.deepEqual(parseAmount("₪ 1,249.00"), { value: 1249, currency: "ILS" });
  assert.deepEqual(parseAmount("€ 39.30"), { value: 39.3, currency: "EUR" });
  assert.deepEqual(parseAmount("-₪ 84.00"), { value: -84, currency: "ILS" });
  assert.deepEqual(parseAmount("120.00-"), { value: -120, currency: undefined });
  assert.equal(parseAmount(""), null);
});

// Mirrors the real Cal xlsx layout: title rows, an ILS section, then a foreign immediate-debit section.
const STATEMENT = [
  ["פירוט עסקאות לכרטיס ויזה", "", "", "", "", "", ""],
  ["עסקאות לחיוב ב-10/09/2026: 211.00 ₪", "", "", "", "", "", ""],
  ["תאריך\nעסקה", "שם בית עסק", "סכום\nעסקה", "סכום\nחיוב", "סוג\nעסקה", "ענף", "הערות"],
  ["2026-09-08", "שוק הכיכר", "₪ 100.00", "₪ 100.00", "רגילה", "מזון ומשקאות", ""],
  ["2026-08-12", "דמי כרטיס", "₪ 24.00", "", "דמי חבר", "שונות", ""],
  ["2026-06-29", "ישראייר", "₪ 333.00", "₪ 111.00", "תשלומים", "תיירות", "תשלום 3 מתוך 3"],
  ["", "", "", "", "", "", ""],
  ["עסקאות שחויבו באירו", "", "", "", "", "", ""],
  ["עסקאות בחיוב מיידי 39.30 €", "", "", "", "", "", ""],
  ["תאריך\nעסקה", "שם בית עסק", "סכום\nעסקה", "סכום\nחיוב", "סוג\nעסקה", "ענף", "הערות"],
  ["2026-09-28", "ALMYRIKI", "€ 39.30", "€ 39.30", "רגילה", "", "עסקה בחיוב מיידי"],
  ["footer text", "", "", "", "", "", ""],
];

test("statement import reads every section and verifies section totals", () => {
  const { transactions, billingDate, checks, skipped } = parseStatement(STATEMENT, "xlsx");
  assert.equal(billingDate, "2026-09-10");
  assert.equal(transactions.length, 4);
  assert.equal(skipped, 3); // two plain titles + footer
  assert.deepEqual(
    checks.map((c) => [c.currency, c.expected, c.actual]),
    [
      ["ILS", 211, 211],
      ["EUR", 39.3, 39.3],
    ],
  );

  const [, fee, flight, euro] = transactions;
  assert.equal(fee.amount, 0, "blank charged cell = not charged");
  assert.equal(fee.originalAmount, 24);
  assert.deepEqual(flight.installments, { number: 3, total: 3 });
  assert.equal(flight.originalAmount, 333);
  assert.equal(euro.currency, "EUR");
  assert.equal(euro.originalAmount, undefined);
});

test("rule beats Cal's sector, Cal's sector beats nothing; totals stay per currency", () => {
  const { transactions } = parseStatement(STATEMENT, "xlsx");
  const rules = { categories: ["אוכל"], rules: [{ merchant: "שוק  הכיכר", category: "אוכל" }] };
  const categorized = categorize(transactions, rules);
  assert.deepEqual(
    categorized.map((t) => [t.category, t.categorySource]),
    [
      ["אוכל", "rule"],
      ["שונות", "cal"],
      ["תיירות", "cal"],
      [null, null],
    ],
  );

  const s = summarize(categorized);
  assert.deepEqual(s.currencies, ["ILS", "EUR"]);
  assert.deepEqual(s.totals, { ILS: 211, EUR: 39.3 });
  assert.deepEqual(s.bySource, { rule: 1, cal: 2, none: 1 });
  assert.deepEqual(s.uncategorized, [{ merchant: "ALMYRIKI", totals: { EUR: 39.3 }, count: 1 }]);
});

test("annual report: per-month and year totals come from the same summarize()", () => {
  const rules = { categories: [], rules: [] };
  const sep = categorize(parseStatement(STATEMENT, "xlsx").transactions, rules);
  const oct = sep.map((t) => ({ ...t, id: `${t.id}-oct` }));
  const md = renderAnnualMarkdown(
    "2026",
    [
      { month: "2026-09", summary: summarize(sep) },
      { month: "2026-10", summary: summarize(oct) },
    ],
    summarize([...sep, ...oct]),
  );
  assert.match(md, /\*\*Total:\*\* ₪422\.00 · €78\.60 · 8 transactions · 2 months \(09, 10\)/);
  assert.match(md, /\| מזון ומשקאות \| ₪200\.00 \|  \| 47% \| ₪100\.00 \| 2 \|/);
  assert.match(md, /\| מזון ומשקאות \| ₪100\.00 \| ₪100\.00 \| ₪200\.00 \|/);
});

test("scraper mapping: sign, Israel dates, billing month, installments, same ids as xlsx", () => {
  const txn = (over: Record<string, unknown>) => ({
    type: "normal",
    status: "completed",
    date: "2026-09-07T21:00:00.000Z", // = 2026-09-08 in Israel
    processedDate: "2026-09-09T21:00:00.000Z", // billed 2026-09-10
    originalAmount: -100,
    originalCurrency: "ILS",
    chargedAmount: -100,
    chargedCurrency: "₪",
    description: "שוק הכיכר",
    category: "מזון ומשקאות",
    rawTransaction: { trnTypeCode: "5" },
    ...over,
  });
  const accounts = [
    {
      accountNumber: "7187",
      txns: [
        txn({}),
        // Immediate debit at local midnight on Sep 1: UTC says Aug 31, must still count as September.
        txn({ date: "2026-08-31T21:00:00.000Z", processedDate: "2026-08-31T21:00:00.000Z", chargedAmount: -39.3, originalAmount: -39.3, chargedCurrency: "€", originalCurrency: "EUR", description: "ALMYRIKI", category: undefined }),
        // Installment 3/3: the scraper moved the date 2 months forward; we move it back.
        txn({ type: "installments", date: "2026-08-28T21:00:00.000Z", chargedAmount: -111, originalAmount: -333, installments: { number: 3, total: 3 }, description: "ישראייר", rawTransaction: { trnTypeCode: "8" } }),
        txn({ status: "pending" }),
        txn({ processedDate: "2026-10-09T21:00:00.000Z" }),
      ],
    },
  ];
  const { transactions, pending, otherMonths } = mapScrapedAccounts(accounts as never, "2026-09");
  assert.equal(pending, 1);
  assert.equal(otherMonths, 1);
  const [shuk, euro, flight] = transactions;
  assert.deepEqual([shuk.date, shuk.amount, shuk.currency, shuk.type, shuk.card], ["2026-09-08", 100, "ILS", "רגילה", "7187"]);
  assert.deepEqual([euro.date, euro.currency, euro.sector], ["2026-09-01", "EUR", undefined]);
  assert.deepEqual([flight.date, flight.amount, flight.originalAmount, flight.type], ["2026-06-29", 111, 333, "תשלומים"]);

  // Same purchase from the xlsx parser → same id, so the two sources can be compared row by row.
  const xlsxShuk = parseStatement(STATEMENT, "xlsx").transactions[0];
  assert.equal(shuk.id, xlsxShuk.id);
});
