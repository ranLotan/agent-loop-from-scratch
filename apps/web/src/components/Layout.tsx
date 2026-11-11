import { NavLink, Outlet, useLocation } from "react-router";

/** The shell around every page: navigation, and an <Outlet /> for whichever page the URL matches. */
export function Layout() {
  const { search } = useLocation();

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
          <NavLink to={{ pathname: "/imports", search }}>Imports</NavLink>
        </nav>
      </header>

      <main>
        <Outlet />
      </main>
    </div>
  );
}
