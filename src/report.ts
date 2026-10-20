import { round2 } from "./normalize";
import type { CategorizedTransaction, Transaction } from "./types";

export const UNCATEGORIZED = "Uncategorized";

/** currency → amount. Kept per currency: Cal's immediate-debit sections aren't charged in ILS. */
export type Totals = Record<string, number>;

interface Group {
  totals: Totals;
  count: number;
}

export interface Summary {
  count: number;
  totals: Totals;
  /** Currencies present, ILS first. */
  currencies: string[];
  bySource: { rule: number; cal: number; none: number };
  byCategory: ({ category: string } & Group)[];
  uncategorized: ({ merchant: string } & Group)[];
}

const CURRENCY_ORDER = ["ILS", "EUR", "USD"];

function groupBy<T extends Transaction>(transactions: T[], key: (t: T) => string) {
  const groups = new Map<string, Group>();
  for (const t of transactions) {
    const g = groups.get(key(t)) ?? { totals: {}, count: 0 };
    g.totals[t.currency] = (g.totals[t.currency] ?? 0) + t.amount;
    g.count++;
    groups.set(key(t), g);
  }
  for (const g of groups.values()) for (const c in g.totals) g.totals[c] = round2(g.totals[c]);
  return groups;
}

export function totalsByCurrency(transactions: Transaction[]): Totals {
  return groupBy(transactions, () => "all").get("all")?.totals ?? {};
}

/** All the report math, separated from formatting so it's easy to test and reuse. */
export function summarize(transactions: CategorizedTransaction[]): Summary {
  const rank = (c: string) => (CURRENCY_ORDER.includes(c) ? CURRENCY_ORDER.indexOf(c) : CURRENCY_ORDER.length);
  const currencies = [...new Set(transactions.map((t) => t.currency))].sort((a, b) => rank(a) - rank(b));
  // Biggest first, comparing ILS, then the next currency, and so on.
  const byTotals = (a: Group, b: Group) => {
    for (const c of currencies) {
      const diff = (b.totals[c] ?? 0) - (a.totals[c] ?? 0);
      if (diff) return diff;
    }
    return 0;
  };
  const toList = <K extends string>(groups: Map<string, Group>, name: K) =>
    [...groups].map(([key, g]) => ({ [name]: key, ...g }) as { [P in K]: string } & Group).sort(byTotals);

  return {
    count: transactions.length,
    totals: groupBy(transactions, () => "all").get("all")?.totals ?? {},
    currencies,
    bySource: {
      rule: transactions.filter((t) => t.categorySource === "rule").length,
      cal: transactions.filter((t) => t.categorySource === "cal").length,
      none: transactions.filter((t) => t.categorySource === null).length,
    },
    byCategory: toList(groupBy(transactions, (t) => t.category ?? UNCATEGORIZED), "category"),
    uncategorized: toList(
      groupBy(
        transactions.filter((t) => t.category === null),
        (t) => t.merchant,
      ),
      "merchant",
    ),
  };
}

const SYMBOLS: Record<string, string> = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };
const symbol = (currency: string) => SYMBOLS[currency] ?? `${currency} `;

function money(n: number | undefined, currency: string): string {
  if (!n) return "";
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}${symbol(currency)}${abs}`;
}

const pct = (part = 0, whole = 0) => (part && whole ? `${Math.round((part / whole) * 100)}%` : "");

export function renderMarkdown(month: string, s: Summary): string {
  const cur = s.currencies;
  const hasIls = cur.includes("ILS");
  const amounts = (t: Totals) => cur.map((c) => money(t[c], c));
  const allAmounts = (t: Totals) => amounts(t).filter(Boolean).join(" · ");

  const lines = [
    `# Card report — ${month}`,
    "",
    `**Total:** ${allAmounts(s.totals)} · ${s.count} transactions`,
    "",
    `**Categories:** ${s.bySource.rule} from your rules · ${s.bySource.cal} from Cal's sector · ${s.bySource.none} uncategorized`,
  ];
  if (cur.length > 1) {
    lines.push(
      "",
      "> Foreign-currency sections are charged directly in that currency (חיוב מיידי), so they get their own column instead of being converted.",
    );
  }

  lines.push(
    "",
    "## By category",
    "",
    `| Category | ${cur.map(symbol).join(" | ")} |${hasIls ? " Share of ₪ |" : ""} Txns |`,
    `|---|${cur.map(() => "---:").join("|")}|${hasIls ? "---:|" : ""}---:|`,
    ...s.byCategory.map(
      (c) =>
        `| ${c.category} | ${amounts(c.totals).join(" | ")} |` +
        `${hasIls ? ` ${pct(c.totals.ILS, s.totals.ILS)} |` : ""} ${c.count} |`,
    ),
    `| **Total** | ${amounts(s.totals)
      .map((a) => `**${a}**`)
      .join(" | ")} |${hasIls ? " |" : ""} **${s.count}** |`,
  );

  if (s.uncategorized.length) {
    lines.push(
      "",
      "## Uncategorized merchants",
      "",
      "No rule matched and Cal gave no sector. Add them to `data/rules.json` (later, the agent will propose categories).",
      "",
      "| Merchant | Amount | Txns |",
      "|---|---:|---:|",
      ...s.uncategorized.map((u) => `| ${u.merchant} | ${allAmounts(u.totals)} | ${u.count} |`),
    );
  }

  return lines.join("\n") + "\n";
}

/** Year view: one Summary per month plus one for the whole year, all from the same summarize(). */
export function renderAnnualMarkdown(year: string, months: { month: string; summary: Summary }[], y: Summary): string {
  const cur = y.currencies;
  const hasIls = cur.includes("ILS");
  const amounts = (t: Totals) => cur.map((c) => money(t[c], c));
  const allAmounts = (t: Totals) => amounts(t).filter(Boolean).join(" · ");
  const label = (month: string) => month.slice(5);

  const lines = [
    `# Annual report — ${year}`,
    "",
    `**Total:** ${allAmounts(y.totals)} · ${y.count} transactions · ${months.length} months (${months.map((m) => label(m.month)).join(", ")})`,
    "",
    `**Categories:** ${y.bySource.rule} from your rules · ${y.bySource.cal} from Cal's sector · ${y.bySource.none} uncategorized`,
    "",
    "## By month",
    "",
    `| Month | ${cur.map(symbol).join(" | ")} | Txns |`,
    `|---|${cur.map(() => "---:").join("|")}|---:|`,
    ...months.map((m) => `| ${m.month} | ${amounts(m.summary.totals).join(" | ")} | ${m.summary.count} |`),
    "",
    "## By category",
    "",
    `| Category | ${cur.map(symbol).join(" | ")} |${hasIls ? " Share of ₪ | Avg ₪/month |" : ""} Txns |`,
    `|---|${cur.map(() => "---:").join("|")}|${hasIls ? "---:|---:|" : ""}---:|`,
    ...y.byCategory.map(
      (c) =>
        `| ${c.category} | ${amounts(c.totals).join(" | ")} |` +
        (hasIls ? ` ${pct(c.totals.ILS, y.totals.ILS)} | ${money(round2((c.totals.ILS ?? 0) / months.length), "ILS")} |` : "") +
        ` ${c.count} |`,
    ),
  ];

  if (hasIls) {
    const cell = (m: { summary: Summary }, category: string) =>
      money(m.summary.byCategory.find((c) => c.category === category)?.totals.ILS, "ILS");
    lines.push(
      "",
      "## ₪ by category and month",
      "",
      `| Category | ${months.map((m) => label(m.month)).join(" | ")} | Year |`,
      `|---|${months.map(() => "---:").join("|")}|---:|`,
      ...y.byCategory.map(
        (c) => `| ${c.category} | ${months.map((m) => cell(m, c.category)).join(" | ")} | ${money(c.totals.ILS, "ILS")} |`,
      ),
    );
  }

  return lines.join("\n") + "\n";
}
