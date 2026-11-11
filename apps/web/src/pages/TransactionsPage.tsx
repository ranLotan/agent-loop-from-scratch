import { useState } from "react";
import { useSearchParams } from "react-router";
import { api } from "../api";
import { EditTransactionForm } from "../components/EditTransactionForm";
import { TransactionsTable } from "../components/TransactionsTable";
import { useApi } from "../hooks/useApi";
import { useSelectedMonth } from "../hooks/useSelectedMonth";

const SOURCE_OPTIONS = [
  ["", "Any source"],
  ["manual", "Your edits"],
  ["rule", "Your rules"],
  ["cal", "Cal's sector"],
  ["none", "Uncategorized"],
] as const;

export function TransactionsPage() {
  const month = useSelectedMonth();

  // The filters live in the URL, next to ?month=: refresh, back/forward and bookmarks keep them.
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const category = searchParams.get("category") ?? "";
  const source = searchParams.get("source") ?? "";
  const allMonths = searchParams.get("all") === "1";
  function setFilter(key: string, value: string) {
    // Copy, change one key, keep the rest (month included). `replace`: typing doesn't fill the back button.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }

  // Bumping reloadKey after a save makes useApi fetch again (it's in the deps).
  const [reloadKey, setReloadKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const range = allMonths ? {} : { from: month, to: month };
  const { data, error, loading } = useApi(
    () => api.searchTransactions({ ...range, q, category, source }),
    [month, allMonths, q, category, source, reloadKey],
  );
  const categories = useApi(() => api.categories(), [reloadKey]);
  const categoryNames = categories.data?.map((c) => c.name) ?? [];
  const editing = data?.find((t) => t.id === editingId);

  return (
    <section>
      <h1>Transactions{allMonths ? ", all months" : `, ${month}`}</h1>

      {/* Always rendered, even while loading: if these unmounted, the text box would lose focus on every key. */}
      <div className="filters">
        <input
          type="search"
          className="search"
          placeholder="Search merchant or your description"
          value={q}
          onChange={(e) => setFilter("q", e.target.value)}
        />
        <select value={category} onChange={(e) => setFilter("category", e.target.value)} dir="auto">
          <option value="">Any category</option>
          {categoryNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select value={source} onChange={(e) => setFilter("source", e.target.value)}>
          {SOURCE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={allMonths} onChange={(e) => setFilter("all", e.target.checked ? "1" : "")} /> All
          months
        </label>
      </div>

      {error && <p role="alert">Error: {error}</p>}
      {/* Keep showing the previous results while new ones load, instead of flashing an empty page. */}
      {!data && loading && <p>Loading…</p>}
      {data && (
        <>
          <p className="muted">
            {data.length} transaction{data.length === 1 ? "" : "s"}
            {loading && " · updating…"}
          </p>
          <TransactionsTable
            transactions={data}
            showMonth={allMonths}
            editingId={editingId}
            onEdit={setEditingId}
            editor={
              editing && (
                <EditTransactionForm
                  // A new key per row: switching to another row starts the form fresh from that row's values.
                  key={editing.id}
                  transaction={editing}
                  categories={categoryNames}
                  byHandCategory={categories.data?.find((c) => c.system)?.name}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => {
                    setEditingId(null);
                    setReloadKey((k) => k + 1);
                  }}
                />
              )
            }
          />
        </>
      )}
    </section>
  );
}
