import { Link, NavLink, Outlet, useLocation, useSearchParams } from "react-router";
import { api } from "../api";
import { useApi } from "../hooks/useApi";
import type { LayoutContext } from "../hooks/useSelectedMonth";
import { MonthPicker } from "./MonthPicker";

/** The shell around every page: navigation, month picker, and an <Outlet /> for the page itself. */
export function Layout() {
  const { data: months, error, loading } = useApi(() => api.months(), []);
  const [searchParams, setSearchParams] = useSearchParams();
  const { search } = useLocation();

  // Derived on every render: the URL wins, otherwise the latest month. No separate state to sync.
  // `||`, not `??`: an empty "?month=" counts as no choice.
  const month = searchParams.get("month") || months?.at(-1) || null;
  const latest = months?.at(-1);
  const isImported = month !== null && months?.includes(month);

  return (
    <div className="layout">
      <header className="topbar">
        <strong>Cal dashboard</strong>
        <nav>
          {/* `search` keeps ?month=... when moving between pages. `end`: "/" must not match every path. */}
          <NavLink to={{ pathname: "/", search }} end>
            Dashboard
          </NavLink>
          <NavLink to={{ pathname: "/transactions", search }}>Transactions</NavLink>
        </nav>
        {months && month && (
          <MonthPicker months={months} value={month} onChange={(next) => setSearchParams({ month: next })} />
        )}
      </header>

      <main>
        {loading && <p>Loading…</p>}
        {error && <p role="alert">Error: {error}</p>}
        {months?.length === 0 && (
          <p>
            No statements imported yet. Run <code>npm run import -- samples/cal-sample.csv 1999-01</code>.
          </p>
        )}
        {latest && !isImported && (
          <section>
            <h1>No statement for {month}</h1>
            <p>
              That month hasn't been imported. <Link to={{ search: `?month=${latest}` }}>Go to {latest}</Link>
            </p>
          </section>
        )}
        {month && isImported && <Outlet context={{ month } satisfies LayoutContext} />}
      </main>
    </div>
  );
}
