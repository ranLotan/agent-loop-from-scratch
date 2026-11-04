# Milestone 1: React dashboard foundation

## Objectives
- Learn the React basics on real data: function components, props, `useState`/`useEffect`, a custom hook, composition, React Router.
- Get a running local dashboard that **reads** existing data. No writes.

## Scope
- npm workspaces at the root: `apps/web`, `apps/api`. The existing root scripts are unchanged.
- `apps/api`: Express 5 bound to `127.0.0.1:3000`, read-only, calling the existing core:
  - `GET /api/months` → `listMonths` (current + previous year)
  - `GET /api/months/:month/summary` → `summarize(categorize(loadTransactions(month), loadRules()))`, plus the previous month's summary for comparison
  - `GET /api/months/:month/transactions` → `categorize(...)` rows
- `apps/web`: Vite + React + TypeScript + React Router, with the Vite proxy `/api` → `127.0.0.1:3000`.
  - Routes: `/` (Dashboard), `/transactions` (with `?month=`), plus a "not found" page.
  - Dashboard: month picker, totals per currency, category table (with share of ₪), this vs previous month, count of uncategorized.
  - Transactions: read-only table (date, merchant, amount, currency, category, **category source**). Client-side text filter.
  - `api.ts` (all `fetch` calls) + a `useApi` hook (loading / error / data).
- No SQLite, no edits, no agent, no scrape.

## Main deliverables
- `apps/web/*`, `apps/api/*`, a root `package.json` with workspaces and a `dev` script (`concurrently`).
- README section "Run the dashboard".

## Dependencies
- Milestone 0 docs approved.
- New npm dependencies (need approval at the start of M1): `react`, `react-dom`, `react-router`, `vite`, `@vitejs/plugin-react`, `express`, `@types/express`, `concurrently`.
- Check that TypeScript 7 works with the Vite/React setup (separate `tsconfig` per app). If not, document it and pick the nearest working version.

## Acceptance criteria
- `npm run dev` starts both. `http://localhost:5173` shows the dashboard for an existing month.
- The numbers on the dashboard equal the ones in `npm run report -- <month>` (same `summarize()`).
- The API isn't reachable on the LAN IP, only on `127.0.0.1`.
- No secret appears in the browser bundle or in any response.
- `npm test`, `npm run typecheck` and the existing CLI commands work unchanged.
- The sample flow works without bank data: `npm run import -- samples/cal-sample.csv 1999-01`, then open the dashboard on 1999-01.

## Tests required
- API: route tests (node:test + `fetch` against an app on a random port) using a temporary `data/` fixture: month list, summary shape, 404 for an unknown month, 400 for a bad month format.
- Web: none required yet (manual check). Optionally one component test is added in M3 when forms appear.
- All existing tests pass unchanged.
