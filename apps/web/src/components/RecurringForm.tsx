import { useState } from "react";
import type { RecurringDefinition, RecurringInput } from "../api";

interface RecurringFormProps {
  /** Start from an existing item (edit, change-from), or empty (add). */
  initial?: RecurringDefinition;
  categories: string[];
  /** Shown on the submit button, e.g. "Add", "Save for every month", "Save from 2026-10 on". */
  submitLabel: string;
  /** When adding: ask for the first month. */
  askStartMonth?: string;
  onSubmit: (input: RecurringInput) => Promise<unknown>;
  onCancel?: () => void;
}

/** One form for adding, editing every month, and changing from a month on: same fields, different submit. */
export function RecurringForm({ initial, categories, submitLabel, askStartMonth, onSubmit, onCancel }: RecurringFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<RecurringDefinition["kind"]>(initial?.kind ?? "expense");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [merchant, setMerchant] = useState(initial?.merchant ?? "");
  const [day, setDay] = useState(initial?.dayOfMonth ? String(initial.dayOfMonth) : "");
  const [startMonth, setStartMonth] = useState(askStartMonth ?? "");
  const [confirmMode, setConfirmMode] = useState<RecurringDefinition["confirmMode"]>(initial?.confirmMode ?? "auto");
  // Derived, not stored: a card-paid item is confirmed by its charge, so the choice only exists without a merchant.
  const paidByCard = merchant.trim() !== "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const input: RecurringInput = {
      name,
      kind,
      amount: Number(amount),
      category: category || null,
      merchant: merchant.trim() || null,
      dayOfMonth: day ? Number(day) : null,
      confirmMode: paidByCard ? "auto" : confirmMode,
      ...(askStartMonth !== undefined && { startMonth }),
    };
    onSubmit(input)
      .catch((err) => setError((err as Error).message))
      .finally(() => setBusy(false));
  }

  return (
    <form className="edit-form" onSubmit={submit}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Rent)" dir="auto" required />
      <select value={kind} onChange={(e) => setKind(e.target.value as RecurringDefinition["kind"])}>
        <option value="expense">Expense</option>
        <option value="income">Income</option>
      </select>
      <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount ₪" required />
      <select value={category} onChange={(e) => setCategory(e.target.value)} dir="auto">
        <option value="">No category</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      {!paidByCard && (
        <select value={confirmMode} onChange={(e) => setConfirmMode(e.target.value === "confirm" ? "confirm" : "auto")} aria-label="Counts">
          <option value="auto">Counts automatically</option>
          <option value="confirm">Counts after I confirm the amount</option>
        </select>
      )}
      <input
        value={merchant}
        onChange={(e) => setMerchant(e.target.value)}
        placeholder="Paid by card? Merchant as on the statement"
        title="Leave empty for items outside the card (salary, rent by bank transfer)"
        dir="auto"
      />
      <input type="number" min="1" max="31" value={day} onChange={(e) => setDay(e.target.value)} placeholder="Day" style={{ width: "5em" }} />
      {askStartMonth !== undefined && (
        <label>
          From <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} required />
        </label>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      )}
      {error && <p role="alert">Error: {error}</p>}
    </form>
  );
}
