import { useState } from "react";
import { useSearchParams } from "react-router";
import { api, type MonthBy } from "../api";
import { EditTransactionForm } from "../components/EditTransactionForm";
import { TransactionsTable } from "../components/TransactionsTable";
import { useApi } from "../hooks/useApi";
import { useSelectedMonth } from "../hooks/useSelectedMonth";

const SOURCE_OPTIONS = [
  ["", "Any source"],
  ["manual", "Your edits"],
  ["rule", "Your rules"],
  ["cal", "Your Cal rules"],
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
  // M6: the month means the purchase month unless the URL says ?by=billing (for checking a Cal statement).
  // Derived from the URL on every render, like a getter over ActivatedRoute in Angular: no state to keep in sync.
  const by: MonthBy = searchParams.get("by") === "billing" ? "billing" : "ledger";
  const filtered = Boolean(q || category || source);
  /** Back to this month, unfiltered (keeps ?month= and ?all=). */
  function clearFilters() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of ["q", "category", "source"]) next.delete(key);
      return next;
    });
  }
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
    () => api.searchTransactions({ ...range, by, q, category, source }),
    [month, allMonths, by, q, category, source, reloadKey],
  );
  // Charges not billed yet belong to a purchase month only, so they're shown for one ledger month, unfiltered.
  const showPending = by === "ledger" && !allMonths && !filtered;
  const pending = useApi(() => (showPending ? api.pending(month) : Promise.resolve([])), [month, showPending]);
  const categories = useApi(() => api.categories(), [reloadKey]);
  const categoryNames = categories.data?.map((c) => c.name) ?? [];
  const editing = data?.find((t) => t.id === editingId);

  return (
    <section>
      <h1>
        Transactions{allMonths ? ", all months" : by === "ledger" ? `, bought in ${month}` : `, ${month} statement`}
      </h1>

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
        {/* The default (ledger) is left out of the URL, like the other filters' empty values. */}
        <select value={by} onChange={(e) => setFilter("by", e.target.value === "billing" ? "billing" : "")} aria-label="Month by">
          <option value="ledger">By purchase month</option>
          <option value="billing">By Cal statement</option>
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
          {data.length === 0 && filtered && (
            <p>
              Nothing matches these filters.{" "}
              <button type="button" className="link-button" onClick={clearFilters}>
                Clear filters
              </button>
            </p>
          )}
          <TransactionsTable
            transactions={data}
            monthColumn={allMonths ? (by === "ledger" ? "ledgerMonth" : "billingMonth") : undefined}
            showBilled={by === "ledger"}
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

      {showPending && pending.data && pending.data.length > 0 && (
        <>
          <h2>Not billed yet</h2>
          <p className="muted">
            {pending.data.length} pending charge{pending.data.length === 1 ? "" : "s"}, as of the scrape on{" "}
            {pending.data[0].scrapedAt.slice(0, 10)}. They're replaced by the next scrape, so they can't be edited.
          </p>
          <TransactionsTable transactions={pending.data} showBilled />
        </>
      )}
    </section>
  );
}
