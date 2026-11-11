// Props: `summary` is this month, `previous` is last month's summary, or null when there's none.
// Each row in summary.byCategory looks like: { category: "מסעדות", totals: { ILS: 120.5, EUR: 10 }, count: 3 }

import type { Summary } from "../../../../src/report";
import { formatDelta, formatForeign, formatMoney, formatShare } from "../format";

interface CategoryTableProps {
  summary: Summary;
  previous: Summary | null;
}

/** Spending per category: ₪ amount, share of ₪, change from last month, foreign amounts, count. */
export function CategoryTable({ summary, previous }: CategoryTableProps) {
  // A category that didn't exist last month counts as 0 there.
  return <table className="data-table">
    <thead>
      <tr>
        <th>Category</th>
        <th>₪</th>
        <th>Share</th>
        <th>vs last month</th>
        <th>Other currencies</th>
        <th>Txns</th>
      </tr>
    </thead>
    <tbody>
      {summary.byCategory.map((row) => {
        const lastMonthRow = previous?.byCategory.find((r) => r.category === row.category);
        const lastMonthIls = lastMonthRow?.totals.ILS ?? 0;
        return (
          <tr key={row.category}>
            <td dir="auto">{row.category}</td>
            <td className="num">{formatMoney(row.totals.ILS ?? 0)}</td>
            <td className="num">{formatShare(row.totals.ILS ?? 0, summary.totals.ILS ?? 0)}</td>
            <td className="num">{previous ? formatDelta((row.totals.ILS ?? 0) - lastMonthIls) : "—"}</td>
            <td className="num">{formatForeign(row.totals)}</td>
            <td className="num">{row.count}</td>
          </tr>
        );
      })}
    </tbody>
  </table>;
}
