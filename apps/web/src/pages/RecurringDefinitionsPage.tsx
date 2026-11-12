import { useState } from "react";
import { Link } from "react-router";
import { api, type RecurringDefinition } from "../api";
import { RecurringForm } from "../components/RecurringForm";
import { formatMoney } from "../format";
import { useApi } from "../hooks/useApi";
import { useSelectedMonth } from "../hooks/useSelectedMonth";

/** Manage recurring definitions (moved here from the M5 Recurring page): add, edit, split, stop, delete. */
export function RecurringDefinitionsPage() {
  const month = useSelectedMonth();
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const definitions = useApi(() => api.recurring(), [reloadKey]);
  const categories = useApi(() => api.categories(), []);
  const categoryNames = categories.data?.filter((c) => !c.system).map((c) => c.name) ?? [];
  const [adding, setAdding] = useState(false);

  return (
    <section>
      <p>
        <Link to={`/manual?month=${month}`}>← Manual transactions</Link>
      </p>
      <h1>Recurring definitions</h1>
      <p className="muted">
        Outside the card (salary, rent by bank transfer): counted automatically, or after you confirm each month's amount. Paid by
        card: matched to its charge, never counted twice.
      </p>
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
              <td dir="auto">
                {d.merchant ? `card: ${d.merchant}` : "outside the card"}
                {!d.merchant && <div className="sub">{d.confirmMode === "confirm" ? "after you confirm" : "automatically"}</div>}
              </td>
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
