import { Link, Outlet, useSearchParams } from "react-router";
import { api } from "../api";
import { useApi } from "../hooks/useApi";
import type { LayoutContext } from "../hooks/useSelectedMonth";
import { MonthPicker } from "./MonthPicker";

/**
 * Wraps the pages that show one month (Dashboard, Transactions): loads the months, picks one from the URL,
 * and only renders the page once that month exists. Mounted fresh on each visit, so a new import shows up.
 */
export function MonthGate() {
  const { data: months, error, loading } = useApi(() => api.months(), []);
  const [searchParams, setSearchParams] = useSearchParams();

  // Derived on every render: the URL wins, otherwise the latest month. No separate state to sync.
  // `||`, not `??`: an empty "?month=" counts as no choice.
  const month = searchParams.get("month") || months?.at(-1) || null;
  const latest = months?.at(-1);
  const isImported = month !== null && months?.includes(month);

  if (loading) return <p>Loading…</p>;
  if (error) return <p role="alert">Error: {error}</p>;
  if (!months?.length) {
    return (
      <p>
        No statements imported yet. <Link to="/imports">Import one</Link>.
      </p>
    );
  }

  return (
    <>
      <div className="month-bar">
        {month && <MonthPicker months={months} value={month} onChange={(next) => setSearchParams({ month: next })} />}
      </div>
      {latest && !isImported && (
        <section>
          <h1>No statement for {month}</h1>
          <p>
            That month hasn't been imported. <Link to={{ search: `?month=${latest}` }}>Go to {latest}</Link>
          </p>
        </section>
      )}
      {month && isImported && <Outlet context={{ month } satisfies LayoutContext} />}
    </>
  );
}
