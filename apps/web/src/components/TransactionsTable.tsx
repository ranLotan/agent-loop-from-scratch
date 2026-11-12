import { Fragment, type ReactNode } from "react";
import type { PendingRow, TransactionRow } from "../api";
import { formatMoney } from "../format";
import { SourceBadge } from "./SourceBadge";

interface TransactionsTableProps {
  /** Billed rows, or pending ones (M6), which have no billing month yet and can't be edited. */
  transactions: (TransactionRow | PendingRow)[];
  /** Show a Month column, and which month it shows (when the list spans months). */
  monthColumn?: "ledgerMonth" | "billingMonth";
  /** Show the Cal statement each row was billed on, for checking against the statement (M6). */
  showBilled?: boolean;
  /** The row being edited, if any, and what to show under it: the table doesn't know what an editor is. */
  editingId?: string | null;
  editor?: ReactNode;
  onEdit?: (id: string) => void;
}

/** Narrows the union, like a TypeScript type guard in an Angular service: only billed rows have a billing month. */
const isPending = (t: TransactionRow | PendingRow): t is PendingRow => "pending" in t && t.pending;

export function TransactionsTable({ transactions, monthColumn, showBilled, editingId, editor, onEdit }: TransactionsTableProps) {
  const columns = 5 + (monthColumn ? 1 : 0) + (showBilled ? 1 : 0) + (onEdit ? 1 : 0);
  return (
    <table className="data-table">
      <thead>
        <tr>
          {monthColumn && <th>Month</th>}
          <th>Date</th>
          <th>Merchant</th>
          <th className="num">Amount</th>
          <th>Category</th>
          <th>Source</th>
          {showBilled && <th>Billed</th>}
          {onEdit && <th />}
        </tr>
      </thead>
      <tbody>
        {transactions.map((t) => (
          // A Fragment with a key: one row, plus the editor row right under it when it's being edited.
          <Fragment key={t.id}>
            <tr>
              {monthColumn && <td className="num">{monthColumn === "ledgerMonth" ? t.ledgerMonth : isPending(t) ? "–" : t.billingMonth}</td>}
              <td className="num">{t.date}</td>
              <td dir="auto">
                {t.descriptionOverride ?? t.merchant}
                {t.descriptionOverride && (
                  <div className="sub" dir="auto">
                    {t.merchant}
                  </div>
                )}
                {/* Why a July purchase shows up in September: payment 3 counts in purchase month + 2. */}
                {t.installments && (
                  <div className="sub">
                    payment {t.installments.number} of {t.installments.total}
                  </div>
                )}
              </td>
              <td className="num">{formatMoney(t.amount, t.currency)}</td>
              <td dir="auto">{t.category ?? "Uncategorized"}</td>
              <td>
                <SourceBadge source={t.categorySource} />
              </td>
              {showBilled && <td className="num">{isPending(t) ? "not yet" : t.billingMonth}</td>}
              {onEdit && (
                <td>
                  {!isPending(t) && (
                    <button type="button" className="link-button" onClick={() => onEdit(t.id)} disabled={editingId === t.id}>
                      Edit
                    </button>
                  )}
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
