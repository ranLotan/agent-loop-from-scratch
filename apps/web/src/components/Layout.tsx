import { NavLink, Outlet, useSearchParams } from "react-router";

/** The shell around every page: navigation, and an <Outlet /> for whichever page the URL matches. */
export function Layout() {
  // Only the month travels between pages. A page's own filters (?q=, ?category=...) stay on that page:
  // carrying them along made the Transactions tab open pre-filtered, and often empty.
  const [searchParams] = useSearchParams();
  const month = searchParams.get("month");
  const search = month ? `?month=${month}` : "";

  return (
    <div className="layout">
      <header className="topbar">
        <strong>Cal dashboard</strong>
        <nav>
          {/* `end`: "/" must not match every path. */}
          <NavLink to={{ pathname: "/", search }} end>
            Dashboard
          </NavLink>
          <NavLink to={{ pathname: "/transactions", search }}>Transactions</NavLink>
          <NavLink to={{ pathname: "/review", search }}>Review</NavLink>
          <NavLink to={{ pathname: "/recurring", search }}>Recurring</NavLink>
          <NavLink to={{ pathname: "/rules", search }}>Rules</NavLink>
          <NavLink to={{ pathname: "/imports", search }}>Imports</NavLink>
        </nav>
      </header>

      <main>
        <Outlet />
      </main>
    </div>
  );
}
