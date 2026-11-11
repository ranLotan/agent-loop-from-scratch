import { useState } from "react";
import { api, type TransactionRow } from "../api";

interface EditTransactionFormProps {
  transaction: TransactionRow;
  /** Your category names: the only choices, so an edit can't create a category by accident. */
  categories: string[];
  /** The built-in by-hand bucket: as a rule it means "never ask the agent; I categorize each charge". */
  byHandCategory?: string;
  onSaved: () => void;
  onCancel: () => void;
}

const SOURCE_TEXT = { manual: "your edit", agent: "an approved agent proposal", rule: "your rule", cal: "Cal's sector" } as const;

/** Edits one transaction: its category (or a rule for the merchant) and its description. */
export function EditTransactionForm({ transaction: t, categories, byHandCategory, onSaved, onCancel }: EditTransactionFormProps) {
  // Controlled inputs, starting from what's saved. "" in the select = no edit of your own.
  const [category, setCategory] = useState(t.categoryOverride ?? "");
  const [description, setDescription] = useState(t.descriptionOverride ?? "");
  const [createRule, setCreateRule] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    api
      // createRule only with a category: the box can stay ticked after the category is set back to "No edit".
      .editTransaction(t.id, { category: category || null, description: description.trim() || null, createRule: createRule && !!category })
      .then(onSaved)
      .catch((err) => setError((err as Error).message))
      .finally(() => setSaving(false));
  }

  return (
    <form className="edit-form" onSubmit={save}>
      <p className="muted">
        Bank's name: <span dir="auto">{t.merchant}</span>
        {t.sector && (
          <>
            {" "}· Cal's sector: <span dir="auto">{t.sector}</span>
          </>
        )}
        {" "}· Now: <span dir="auto">{t.category ?? "Uncategorized"}</span>
        {t.categorySource && ` (from ${SOURCE_TEXT[t.categorySource]})`}
      </p>

      <label>
        Category{" "}
        <select value={category} onChange={(e) => setCategory(e.target.value)} dir="auto">
          <option value="">No edit: use the rule or Cal's sector</option>
          {categories.map((name) => (
            <option key={name} value={name}>
              {name}
              {name === byHandCategory ? " (by hand)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label>
        <input type="checkbox" checked={createRule} disabled={!category} onChange={(e) => setCreateRule(e.target.checked)} />{" "}
        {category && category === byHandCategory ? (
          <>
            Always by hand: every charge from <span dir="auto">{t.merchant}</span> waits for your own edit, and the agent never sees it
          </>
        ) : (
          <>
            Make it a rule: every charge from <span dir="auto">{t.merchant}</span>, in every month
          </>
        )}
      </label>

      <label>
        Description{" "}
        <input
          type="text"
          value={description}
          placeholder={t.merchant}
          onChange={(e) => setDescription(e.target.value)}
          dir="auto"
        />
      </label>

      <button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onCancel} disabled={saving}>
        Cancel
      </button>
      {error && <p role="alert">Error: {error}</p>}
    </form>
  );
}
