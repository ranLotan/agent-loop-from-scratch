import { useState } from "react";
import { api, type Occurrence } from "../api";

/** "This month only" for a recurring item: a different amount, a skip, or a note. Stored as one exception. */
export function MonthEditor(props: { month: string; occurrence: Occurrence; onDone: () => void; onCancel: () => void }) {
  const { month, occurrence: o } = props;
  // Controlled inputs: React state is the source of truth and the inputs mirror it, like [(ngModel)].
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
