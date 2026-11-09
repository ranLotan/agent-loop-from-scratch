// M1, YOUR PART: the category table.
//
// Props: `summary` is this month, `previous` is last month's summary, or null when there's none.
// Each row in summary.byCategory looks like: { category: "מסעדות", totals: { ILS: 120.5, EUR: 10 }, count: 3 }

import type { Summary } from "../../../../src/report";
import { formatDelta, formatForeign, formatMoney, formatShare } from "../format";

interface CategoryTableProps {
  summary: Summary;
  previous: Summary | null;
}

export function CategoryTable({ summary, previous }: CategoryTableProps) {
  // TODO 1: return a <table className="data-table"> with a <thead> and these 6 columns:
  //   Category | ₪ | Share | vs last month | Other currencies | Txns
  
  // TODO 2: in the <tbody>, turn summary.byCategory into rows with .map.
  //   Give each <tr> a key. Which field is unique and stable here?
  //   Show:
  //     Category          row.category. Use <td dir="auto">, so Hebrew reads right-to-left.
  //     ₪                 formatMoney(row.totals.ILS ?? 0)
  //     Share             formatShare(row.totals.ILS ?? 0, summary.totals.ILS ?? 0)
  //     Other currencies  formatForeign(row.totals)
  //     Txns              row.count
  //   Number cells: <td className="num">.

  // TODO 3: the "vs last month" cell.
  //   If there's no `previous`, show "—".
  //   Otherwise find this category in previous.byCategory (hint: .find), take its ILS total,
  //   and show formatDelta(thisMonth - lastMonth).
  //   A category that didn't exist last month counts as 0 (hint: ?. and ??).
  //   Tip: a .map callback can have a { body } with a `const` and a return, when one expression isn't enough.

  // TODO 4: remove this placeholder and return your table.
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
