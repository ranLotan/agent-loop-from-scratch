import type { CategorizedTransaction } from "../../../../src/types";
import { formatMoney } from "../format";
import { SourceBadge } from "./SourceBadge";

export function TransactionsTable({ transactions }: { transactions: CategorizedTransaction[] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Merchant</th>
          <th className="num">Amount</th>
          <th>Category</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {transactions.map((t) => (
          <tr key={t.id}>
            <td className="num">{t.date}</td>
            <td dir="auto">{t.merchant}</td>
            <td className="num">{formatMoney(t.amount, t.currency)}</td>
            <td dir="auto">{t.category ?? "Uncategorized"}</td>
            <td>
              <SourceBadge source={t.categorySource} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
