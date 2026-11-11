import { useState } from "react";
import { api } from "../api";
import { TransactionsTable } from "../components/TransactionsTable";
import { useApi } from "../hooks/useApi";
import { useSelectedMonth } from "../hooks/useSelectedMonth";

export function TransactionsPage() {
  const month = useSelectedMonth();
  const { data, error, loading } = useApi(() => api.transactions(month), [month]);
  const [searchText, setSearchText] = useState("");

  if (error) return <p role="alert">Error: {error}</p>;
  if (loading || !data) return <p>Loading…</p>;

  // Derived on every render from data + searchText, so there's no second state to keep in sync.
  const visible = searchText === "" ? data : data.filter((t) =>
    t.merchant.toLowerCase().includes(searchText.toLowerCase()) ||
    (t.category && t.category.toLowerCase().includes(searchText.toLowerCase()))
  );

  return (
    <section>
      <h1>Transactions, {month}</h1>

      
      <input
        type="text"
        className="search"
        placeholder="Search merchant or category"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
      />
      <p className="muted">
        {visible.length} of {data.length} transactions
      </p>
      <TransactionsTable transactions={visible} />
    </section>
  );
}
