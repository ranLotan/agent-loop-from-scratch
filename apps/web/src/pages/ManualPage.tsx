import { useState } from "react";
import { api, type ManualEntry, type ManualEntryInput, type Occurrence, type RecurringDefinition } from "../api";
import { MonthEditor } from "../components/MonthEditor";
import { RecurringForm } from "../components/RecurringForm";
import { formatMoney, monthBefore } from "../format";
import { useApi } from "../hooks/useApi";
import { useSelectedMonth } from "../hooks/useSelectedMonth";

const STATUS_TEXT: Record<Occurrence["status"], string> = {
  expected: "Counted",
  awaiting_confirmation: "Waiting for you to confirm",
  paid: "Paid by card",
  not_seen: "Not on the statement",
  skipped: "Skipped this month",
};

/**
 * Money outside the card for the selected month: recurring items (confirm or edit each one) and one-time
 * entries. The month is "lifted" to the URL (Layout/MonthGate own it), so every page agrees on it, the way an
 * Angular app would keep it in a shared service instead of in each component.
 */
export function ManualPage() {
  const month = useSelectedMonth();
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const recurring = useApi(() => api.recurringMonth(month), [month, reloadKey]);
  const definitions = useApi(() => api.recurring(), [reloadKey]);
  const entries = useApi(() => api.manualEntries(month), [month, reloadKey]);
  const categories = useApi(() => api.categories(), []);
  const categoryNames = categories.data?.filter((c) => !c.system).map((c) => c.name) ?? [];

  return (
    <section>
      <h1>Manual transactions, {month}</h1>

      <h2>Recurring</h2>
      <p className="muted">
        Outside the card (salary, rent by bank transfer): counted automatically, or after you confirm each month's amount. Paid by card:
        matched to its charge, never counted twice.
      </p>
      {recurring.error && <p role="alert">Error: {recurring.error}</p>}
      {recurring.data && definitions.data && (
        <>
          <RecurringTable
            month={month}
            occurrences={recurring.data.occurrences}
            definitions={definitions.data}
            categories={categoryNames}
            onChanged={reload}
          />
          <OtherMonths
            month={month}
            // Items that don't run this month (stopped earlier, or start later): the only place left to edit or delete them.
            definitions={definitions.data.filter((d) => !recurring.data!.occurrences.some((o) => o.definitionId === d.id))}
            categories={categoryNames}
            onChanged={reload}
          />
        </>
      )}
      <AddRecurring month={month} categories={categoryNames} onAdded={reload} />

      <h2>One-time</h2>
      {entries.error && <p role="alert">Error: {entries.error}</p>}
      {entries.data && <OneTimeList month={month} entries={entries.data} categories={categoryNames} onChanged={reload} />}
    </section>
  );
}

/** Which inline editor is open, and for which row. One at a time, so the state is a single value, not a flag per row. */
type Editing = { id: number; kind: "choose" | "month" | "forward" | "all" | "remove" } | null;

const confirmDelete = (name: string) => window.confirm(`Delete "${name}" from every month, including past ones? This can't be undone.`);

function RecurringTable(props: {
  month: string;
  occurrences: Occurrence[];
  definitions: RecurringDefinition[];
  categories: string[];
  onChanged: () => void;
}) {
  const { month, occurrences, definitions, categories, onChanged } = props;
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const done = () => (setEditing(null), setError(null), onChanged());
  const run = (work: Promise<unknown>) => work.then(done).catch((err) => setError((err as Error).message));

  if (!occurrences.length) return <p className="muted">No recurring items in {month}.</p>;
  return (
    <>
      {error && <p role="alert">Error: {error}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Amount</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {occurrences.map((o) => {
            const def = definitions.find((d) => d.id === o.definitionId);
            const isEditing = editing?.id === o.definitionId;
            return (
              <tr key={o.definitionId}>
                <td dir="auto">
                  {o.kind === "income" ? "↑ " : "↓ "}
                  {o.name}
                  {o.expectedDate && <div className="sub">{o.expectedDate}</div>}
                </td>
                <td className="num">
                  {o.status === "awaiting_confirmation" ? `~${formatMoney(o.suggestedAmount, o.currency)}` : formatMoney(o.expectedAmount, o.currency)}
                  {o.changed && o.status !== "awaiting_confirmation" && <div className="sub">changed for this month</div>}
                </td>
                <td>
                  {STATUS_TEXT[o.status]}
                  {o.confirmMode === "confirm" && o.status === "expected" && <div className="sub">confirmed</div>}
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
                  {o.status === "awaiting_confirmation" && !isEditing && (
                    <ConfirmForm key={`${o.definitionId}-${o.suggestedAmount}`} suggested={o.suggestedAmount} onConfirm={(amount) => run(api.confirmMonth(o.definitionId, month, amount))} />
                  )}
                  {isEditing && editing.kind === "choose" && (
                    <div className="actions">
                      <button type="button" onClick={() => setEditing({ id: o.definitionId, kind: "month" })}>
                        This month only
                      </button>
                      <button type="button" onClick={() => setEditing({ id: o.definitionId, kind: "forward" })} disabled={!def}>
                        From now on
                      </button>
                      <button type="button" onClick={() => setEditing({ id: o.definitionId, kind: "all" })} disabled={!def} title="The item itself, past months included">
                        Every month
                      </button>
                      <button type="button" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  )}
                  {isEditing && editing.kind === "remove" && (
                    // Three ways to "remove", from the lightest to the only one that loses history.
                    <div className="actions">
                      {o.status !== "skipped" && (
                        <button type="button" onClick={() => run(api.setRecurringMonth(o.definitionId, month, { skipped: true }))} title="Not counted this month; other months unchanged">
                          Skip {month} only
                        </button>
                      )}
                      {def && month > def.startMonth && (
                        <button type="button" onClick={() => run(api.updateRecurring(def.id, { endMonth: monthBefore(month) }))} title="Earlier months keep it; it's gone from this month on">
                          Stop from {month} on
                        </button>
                      )}
                      {def && def.endMonth !== month && (
                        <button type="button" onClick={() => run(api.updateRecurring(def.id, { endMonth: month }))} title="This month and earlier keep it; gone from next month">
                          Stop after {month}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (confirmDelete(o.name)) run(api.deleteRecurring(o.definitionId));
                        }}
                        title="As if it never existed, past months included"
                      >
                        Delete everywhere
                      </button>
                      <button type="button" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  )}
                  {isEditing && editing.kind === "month" && <MonthEditor month={month} occurrence={o} onDone={done} onCancel={() => setEditing(null)} />}
                  {isEditing && editing.kind === "forward" && def && (
                    <RecurringForm
                      initial={def}
                      categories={categories}
                      submitLabel={`Save from ${month} on`}
                      // Splitting needs a month after the start; in the first month, "from now on" is every month.
                      onSubmit={(input) => run(month > def.startMonth ? api.changeRecurringFrom(def.id, month, input) : api.updateRecurring(def.id, input))}
                      onCancel={() => setEditing(null)}
                    />
                  )}
                  {isEditing && editing.kind === "all" && def && (
                    <RecurringForm
                      initial={def}
                      categories={categories}
                      submitLabel="Save for every month"
                      onSubmit={(input) => run(api.updateRecurring(def.id, input))}
                      onCancel={() => setEditing(null)}
                    />
                  )}
                  {!isEditing && (
                    <div className="actions">
                      <button type="button" className="link-button" onClick={() => setEditing({ id: o.definitionId, kind: "choose" })}>
                        Edit
                      </button>
                      <button type="button" className="link-button" onClick={() => setEditing({ id: o.definitionId, kind: "remove" })}>
                        Remove
                      </button>
                      {o.confirmMode === "confirm" && o.status === "expected" && (
                        <button type="button" className="link-button" onClick={() => run(api.unconfirmMonth(o.definitionId, month))}>
                          Undo confirm
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/** "Add a recurring item", starting in the selected month (moved here from the old definitions page). */
function AddRecurring({ month, categories, onAdded }: { month: string; categories: string[]; onAdded: () => void }) {
  const [adding, setAdding] = useState(false);
  return adding ? (
    <RecurringForm
      categories={categories}
      submitLabel="Add"
      askStartMonth={month}
      onSubmit={(input) => api.createRecurring(input).then(() => (setAdding(false), onAdded()))}
      onCancel={() => setAdding(false)}
    />
  ) : (
    <button onClick={() => setAdding(true)}>Add a recurring item</button>
  );
}

/** Items that don't run in the selected month, collapsed: edit them (every month), run them again, or delete them. */
function OtherMonths(props: { month: string; definitions: RecurringDefinition[]; categories: string[]; onChanged: () => void }) {
  const { month, definitions, categories, onChanged } = props;
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (work: Promise<unknown>) =>
    work.then(() => (setEditingId(null), setError(null), onChanged())).catch((err) => setError((err as Error).message));

  if (!definitions.length) return null;
  return (
    <details>
      <summary>
        Not in {month} ({definitions.length})
      </summary>
      {error && <p role="alert">Error: {error}</p>}
      <table className="data-table">
        <tbody>
          {definitions.map((d) => (
            <tr key={d.id}>
              <td dir="auto">
                {d.kind === "income" ? "↑ " : "↓ "}
                {d.name}
                <div className="sub">
                  {d.startMonth} → {d.endMonth ?? "ongoing"}
                </div>
              </td>
              <td className="num">{formatMoney(d.amount, d.currency)}</td>
              <td>
                {editingId === d.id ? (
                  <RecurringForm
                    initial={d}
                    categories={categories}
                    submitLabel="Save for every month"
                    onSubmit={(input) => run(api.updateRecurring(d.id, input))}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div className="actions">
                    <button type="button" className="link-button" onClick={() => setEditingId(d.id)}>
                      Edit every month
                    </button>
                    {d.endMonth !== null && d.endMonth < month && (
                      <button type="button" className="link-button" onClick={() => run(api.updateRecurring(d.id, { endMonth: null }))} title="Remove the end month">
                        Run again (no end)
                      </button>
                    )}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        if (confirmDelete(d.name)) run(api.deleteRecurring(d.id));
                      }}
                    >
                      Delete everywhere
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** The amount comes pre-filled with the suggestion; `key` on the parent resets it if the suggestion changes. */
function ConfirmForm({ suggested, onConfirm }: { suggested: number; onConfirm: (amount: number) => void }) {
  const [amount, setAmount] = useState(String(suggested));
  return (
    <form
      className="edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm(Number(amount));
      }}
    >
      <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Actual amount" required style={{ width: "8em" }} />
      <button type="submit">Confirm</button>
    </form>
  );
}

function OneTimeList(props: { month: string; entries: ManualEntry[]; categories: string[]; onChanged: () => void }) {
  const { month, entries, categories, onChanged } = props;
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = () => (setEditingId(null), setAdding(false), setError(null), onChanged());

  return (
    <>
      {error && <p role="alert">Error: {error}</p>}
      {entries.length === 0 && <p className="muted">No one-time entries in {month}.</p>}
      {entries.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Name</th>
              <th className="num">Amount</th>
              <th>Category</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) =>
              editingId === e.id ? (
                <tr key={e.id} className="editor-row">
                  <td colSpan={5}>
                    <OneTimeForm
                      month={month}
                      initial={e}
                      categories={categories}
                      submitLabel="Save"
                      onSubmit={(input) => api.updateManualEntry(e.id, input).then(done)}
                      onCancel={() => setEditingId(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={e.id}>
                  <td className="num">{e.date}</td>
                  <td dir="auto">
                    {e.kind === "income" ? "↑ " : "↓ "}
                    {e.name}
                    {e.note && (
                      <div className="sub" dir="auto">
                        {e.note}
                      </div>
                    )}
                  </td>
                  <td className="num">{formatMoney(e.amount)}</td>
                  <td dir="auto">{e.category ?? "—"}</td>
                  <td>
                    <div className="actions">
                      <button type="button" className="link-button" onClick={() => setEditingId(e.id)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => api.deleteManualEntry(e.id).then(done).catch((err) => setError((err as Error).message))}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      {adding ? (
        <OneTimeForm month={month} categories={categories} submitLabel="Add" onSubmit={(input) => api.createManualEntry(input).then(done)} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)}>Add one-time</button>
      )}
    </>
  );
}

/** A controlled form: one useState per field, and the submit builds the request body from them. */
function OneTimeForm(props: {
  month: string;
  initial?: ManualEntry;
  categories: string[];
  submitLabel: string;
  onSubmit: (input: ManualEntryInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { initial } = props;
  const [date, setDate] = useState(initial?.date ?? `${props.month}-01`);
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<ManualEntry["kind"]>(initial?.kind ?? "expense");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        props
          .onSubmit({ date, name, kind, amount: Number(amount), category: category || null })
          .catch((err) => setError((err as Error).message))
          .finally(() => setBusy(false));
      }}
    >
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Boiler repair)" dir="auto" required />
      <select value={kind} onChange={(e) => setKind(e.target.value === "income" ? "income" : "expense")}>
        <option value="expense">Expense</option>
        <option value="income">Income</option>
      </select>
      <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount ₪" required />
      <select value={category} onChange={(e) => setCategory(e.target.value)} dir="auto">
        <option value="">No category</option>
        {props.categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : props.submitLabel}
      </button>
      <button type="button" onClick={props.onCancel} disabled={busy}>
        Cancel
      </button>
      {error && <p role="alert">Error: {error}</p>}
    </form>
  );
}
