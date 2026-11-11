import { Fragment, type ReactNode } from "react";
import type { TransactionRow } from "../api";
import { formatMoney } from "../format";
import { SourceBadge } from "./SourceBadge";

interface TransactionsTableProps {
  transactions: TransactionRow[];
  /** Show a Month column (when the list spans months). */
  showMonth?: boolean;
  /** The row being edited, if any, and what to show under it: the table doesn't know what an editor is. */
  editingId?: string | null;
  editor?: ReactNode;
  onEdit?: (id: string) => void;
}

export function TransactionsTable({ transactions, showMonth, editingId, editor, onEdit }: TransactionsTableProps) {
  const columns = 5 + (showMonth ? 1 : 0) + (onEdit ? 1 : 0);
  return (
    <table className="data-table">
      <thead>
        <tr>
          {showMonth && <th>Month</th>}
          <th>Date</th>
          <th>Merchant</th>
          <th className="num">Amount</th>
          <th>Category</th>
          <th>Source</th>
          {onEdit && <th />}
        </tr>
      </thead>
      <tbody>
        {transactions.map((t) => (
          // A Fragment with a key: one row, plus the editor row right under it when it's being edited.
          <Fragment key={t.id}>
            <tr>
              {showMonth && <td className="num">{t.billingMonth}</td>}
              <td className="num">{t.date}</td>
              <td dir="auto">
                {t.descriptionOverride ?? t.merchant}
                {t.descriptionOverride && (
                  <div className="sub" dir="auto">
                    {t.merchant}
                  </div>
                )}
              </td>
              <td className="num">{formatMoney(t.amount, t.currency)}</td>
              <td dir="auto">{t.category ?? "Uncategorized"}</td>
              <td>
                <SourceBadge source={t.categorySource} />
              </td>
              {onEdit && (
                <td>
                  <button type="button" className="link-button" onClick={() => onEdit(t.id)} disabled={editingId === t.id}>
                    Edit
                  </button>
                </td>
              )}
            </tr>
            {editingId === t.id && editor && (
              <tr className="editor-row">
                <td colSpan={columns}>{editor}</td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
