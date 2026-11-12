import { useState } from "react";
import { api, type Occurrence, type RecurringDefinition } from "../api";
import { RecurringForm } from "../components/RecurringForm";
import { formatMoney } from "../format";
import { useApi } from "../hooks/useApi";
import { useSelectedMonth } from "../hooks/useSelectedMonth";

const STATUS_TEXT: Record<Occurrence["status"], string> = {
  paid: "Paid by card",
  not_seen: "Not on the statement",
  expected: "Counted as expected",
  skipped: "Skipped this month",
};

export function RecurringPage() {
  const month = useSelectedMonth();
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const monthData = useApi(() => api.recurringMonth(month), [month, reloadKey]);
  const definitions = useApi(() => api.recurring(), [reloadKey]);
  const categories = useApi(() => api.categories(), []);
  const categoryNames = categories.data?.filter((c) => !c.system).map((c) => c.name) ?? [];
  const [adding, setAdding] = useState(false);

  const s = monthData.data?.summary;
  return (
    <section>
      <h1>Recurring, {month}</h1>
      <p className="muted">
        Items outside the card (salary, rent by bank transfer) are counted at their expected amount. Items paid by card are matched
        to their charge on the statement, and aren't counted twice.
      </p>

      {monthData.error && <p role="alert">Error: {monthData.error}</p>}
      {s && (
        <p>
          Income {formatMoney(s.income.ILS ?? 0)} · Outside the card {formatMoney(s.outsideExpenses.ILS ?? 0)} · Paid by card:{" "}
          {s.paidByCard}
          {s.notSeen > 0 && <strong> · Not on the statement: {s.notSeen}</strong>}
        </p>
      )}
      {monthData.data && <MonthTable month={month} occurrences={monthData.data.occurrences} onChanged={reload} />}

      <h2>Recurring items</h2>
      {definitions.error && <p role="alert">Error: {definitions.error}</p>}
      {adding ? (
        <RecurringForm
          categories={categoryNames}
          submitLabel="Add"
          askStartMonth={month}
          onSubmit={(input) => api.createRecurring(input).then(() => (setAdding(false), reload()))}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button onClick={() => setAdding(true)}>Add a recurring item</button>
      )}
      {definitions.data && <DefinitionsTable month={month} definitions={definitions.data} categories={categoryNames} onChanged={reload} />}
    </section>
  );
}

/** This month's items. "Change this month" stores an exception for this month only. */
function MonthTable({ month, occurrences, onChanged }: { month: string; occurrences: Occurrence[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  if (!occurrences.length) return <p className="muted">No recurring items in {month}.</p>;

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Item</th>
          <th className="num">Expected</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {occurrences.map((o) => (
          <tr key={o.definitionId}>
            <td dir="auto">
              {o.kind === "income" ? "↑ " : "↓ "}
              {o.name}
              {o.expectedDate && <div className="sub">{o.expectedDate}</div>}
            </td>
            <td className="num">
              {formatMoney(o.expectedAmount, o.currency)}
              {o.changed && <div className="sub">changed for this month</div>}
            </td>
            <td>
              {STATUS_TEXT[o.status]}
              {o.transaction && (
                <div className="sub">
                  {o.transaction.date} · {formatMoney(o.transaction.amount, o.currency)}
                </div>
              )}
              {o.note && (
                <div className="sub" dir="auto">
                  {o.note}
                </div>
              )}
            </td>
            <td>
              {editing === o.definitionId ? (
                <MonthEditor month={month} occurrence={o} onDone={() => (setEditing(null), onChanged())} onCancel={() => setEditing(null)} />
              ) : (
                <button type="button" className="link-button" onClick={() => setEditing(o.definitionId)}>
                  Change this month
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MonthEditor(props: { month: string; occurrence: Occurrence; onDone: () => void; onCancel: () => void }) {
  const { month, occurrence: o } = props;
  const [amount, setAmount] = useState(o.changed && o.status !== "skipped" ? String(o.expectedAmount) : "");
  const [skipped, setSkipped] = useState(o.status === "skipped");
  const [note, setNote] = useState(o.note ?? "");
  const [error, setError] = useState<string | null>(null);

  function save(change: { amount: number | null; skipped: boolean; note: string | null }) {
    api.setRecurringMonth(o.definitionId, month, change).then(props.onDone).catch((err) => setError((err as Error).message));
  }

  return (
    <form
      className="edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        save({ amount: amount ? Number(amount) : null, skipped, note: note.trim() || null });
      }}
    >
      <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount this month" disabled={skipped} />
      <label>
        <input type="checkbox" checked={skipped} onChange={(e) => setSkipped(e.target.checked)} /> Skip
      </label>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" dir="auto" />
      <button type="submit">Save for {month}</button>
      <button type="button" onClick={() => save({ amount: null, skipped: false, note: null })}>
        Back to normal
      </button>
      <button type="button" onClick={props.onCancel}>
        Cancel
      </button>
      {error && <p role="alert">Error: {error}</p>}
    </form>
  );
}

type Mode = { id: number; kind: "all" | "from" };

/** Every item. "Edit every month" changes the item itself; "Change from this month on" splits it, keeping history. */
function DefinitionsTable(props: { month: string; definitions: RecurringDefinition[]; categories: string[]; onChanged: () => void }) {
  const { month, definitions, categories, onChanged } = props;
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (work: Promise<unknown>) =>
    work.then(() => (setMode(null), setError(null), onChanged())).catch((err) => setError((err as Error).message));
  const previousMonth = (() => {
    const [y, m] = month.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();

  if (!definitions.length) return <p className="muted">No recurring items yet.</p>;
  return (
    <>
      {error && <p role="alert">Error: {error}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Amount</th>
            <th>Months</th>
            <th>Paid</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {definitions.map((d) => (
            <tr key={d.id}>
              <td dir="auto">
                {d.kind === "income" ? "↑ " : "↓ "}
                {d.name}
                {d.category && <div className="sub">{d.category}</div>}
              </td>
              <td className="num">{formatMoney(d.amount, d.currency)}</td>
              <td className="num">
                {d.startMonth} → {d.endMonth ?? "ongoing"}
              </td>
              <td dir="auto">{d.merchant ? `card: ${d.merchant}` : "outside the card"}</td>
              <td>
                {mode?.id === d.id ? (
                  <RecurringForm
                    initial={d}
                    categories={categories}
                    submitLabel={mode.kind === "all" ? "Save for every month" : `Save from ${month} on`}
                    onSubmit={(input) =>
                      mode.kind === "all" ? run(api.updateRecurring(d.id, input)) : run(api.changeRecurringFrom(d.id, month, input))
                    }
                    onCancel={() => setMode(null)}
                  />
                ) : (
                  <div className="actions">
                    <button type="button" className="link-button" onClick={() => setMode({ id: d.id, kind: "all" })}>
                      Edit every month
                    </button>
                    {month > d.startMonth && (d.endMonth === null || month <= d.endMonth) && (
                      <button type="button" className="link-button" onClick={() => setMode({ id: d.id, kind: "from" })}>
                        Change from {month} on
                      </button>
                    )}
                    {d.endMonth === null && month > d.startMonth && (
                      <button type="button" className="link-button" onClick={() => run(api.updateRecurring(d.id, { endMonth: previousMonth }))}>
                        Stop from {month}
                      </button>
                    )}
                    <button type="button" className="link-button" onClick={() => run(api.deleteRecurring(d.id))}>
                      Delete
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
