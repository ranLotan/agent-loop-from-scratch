# Milestone 7: Monthly category caps

## Objective
Answer a second question next to "did I spend more than I earned?": **"Am I staying inside my limit for each category?"**

To get there:
- a category can have a **monthly cap in ILS** (or none)
- cap usage (cap, spent, left / over) is computed **in the core**, from the same ledger the pie uses
- the Rules page becomes an accordion, with a "Categories & monthly caps" section to set caps
- the dashboard's category table gets a Cap column, a tooltip and on-track / exceeded chips
- the trend gets a 3 / 6 / 9 / 12-month period switch, a summary card, and a new **Spending by category** chart with its own filter
- the ₪ symbol renders correctly everywhere

Design reference: the approved mockups in `docs/design/caps/` (1: category table, 2: trends, 3: one capped category, 4: Rules page). Their numbers are sample data and their markup is a mockup: they're rebuilt as React components that fit the existing code, with no hard-coded values. The pie chart stays as it is.

## Product decisions (settled)
| Topic | Decision |
|---|---|
| Storage | Migration `008_category_caps.sql`: `categories.monthly_cap REAL`, with `CHECK (monthly_cap IS NULL OR monthly_cap > 0)`. NULL = no cap. One cap for every month: changing it changes past months too (no history). |
| What counts as spent | The category's amount in `summary.byCategory` of `monthLedger(month)`: counted ILS expenses by **ledger month** (billed and pending card charges, auto and confirmed recurring items, one-offs). Refunds reduce it; items awaiting confirmation don't count. It's the same number the pie shows. |
| Cap usage | A pure `capUsage(byCategory, caps)` → `{ category, cap, spent, remaining, over, usedPercent }[]`. `remaining = cap − spent` (negative = over). Spent **exactly at** the cap is on track, not over. A capped category with no spending that month still appears, with spent 0. `LedgerSummary.caps` is `{ usage, onTrack, exceeded, total }` (one object instead of four flat fields, as built). The UI never computes any of this. |
| Which categories can have a cap | Any of my categories. Not "Uncategorized" (it isn't a category row) and not the built-in by-hand bucket (`לסיווג ידני`, a temporary holding place). |
| Pie and "Other" | `pieSlices(byCategory, maxSlices, capped)`: capped categories **always** keep their own slice and row, never "Other". Uncapped ones fill the remaining slots by size; the rest are grouped into Other as in M6. **Changed while building:** the palette stays at 7 colors + gray. The dataviz rules never allow a generated hue, and the reference palette's only 8th slot is red, which would read as "over cap". A slice past the 7th (only possible with 7+ capped categories) is gray, and the legend table names it. |
| Colors in the category chart | "The category's pie color" means its slot in the **selected month's** pie. Other categories take the free slots in name order, **from the period's category list, not the selection**, so removing a chip never repaints the bars that stay. Past 7, gray. A pure web helper, `categoryColors(pie, names)` in `apps/web/src/chart-colors.ts`, tested (web tests now run in `npm test`). This doesn't fix the M6 limit where a pie color follows the slice's rank between months. |
| Period | 3 / 6 / 9 / 12 months, default 6, in the URL as `?period=` (`useSearchParams`). It applies to both charts. The heading follows it ("Last 6 months"). |
| Category filter | In the URL as `?cats=` (one param per category). Empty means the default: **all capped categories**, or the top 3 by spending in the period if none are capped. "All categories" selects every category that has spending in the period. |
| Period totals | Computed in the core: `trendTotals(points)` → income, expenses, net, average income and average expenses per month. `GET /api/ledger/trend` returns `{ points, totals }`. That's a shape change, but the Dashboard is its only caller. |
| Category trend | `categoryTrend(endMonth, n, categories)` in the core → per month: the amount for each selected category, their total, and an `over` flag per capped category. Per period: each category's total and the selected total. |
| Single capped category | When exactly one category is selected **and** it has a cap (mockup 3), the result also has `single: { cap, capTotal, diff, monthsOver }`, with `capTotal = cap × months`. A pure helper decides the mode; the UI switches chart, table and summary card together. |
| Saving caps | `PUT /api/categories/caps` with `{ caps: [{ id, cap: number \| null }] }`, saved in one DB transaction. Rejected: cap ≤ 0, a cap that isn't a number (400), an unknown id (404), the by-hand bucket (409). "Remove cap" clears the row's input; "Save caps" saves every changed row. |
| "This month" on the Rules page | The selected month (`useSelectedMonth`, like the Dashboard), read from `summary.caps` of `GET /api/months/:month/ledger`. No second calculation. |
| Backup | `npm run export` writes the caps into `data/rules.json` (`"caps": { "<category>": 1000 }`), and `migrate-json` restores them. `rules.example.json` stays as it is. |
| Font | Inter (Latin) and Heebo (Hebrew and ₪), **self-hosted** through the npm packages `@fontsource/inter` and `@fontsource/heebo`, imported in `main.tsx`. Not the Google Fonts CDN: the app is local-only and should work offline. `font-family: Inter, Heebo, system-ui, "Segoe UI", Arial, sans-serif`, which SVG text inherits too. |
| Scope change | `docs/product-vision.md` listed budgets as excluded. Monthly caps per category are now in scope; forecasting stays out. |

## Steps
One step at a time, each one ending with `npm test` and `npm run typecheck` passing. Wait for my approval before starting the next step.

### Step 7.1: Font fix (₪ renders as a box)
- Add `@fontsource/inter` and `@fontsource/heebo` to `apps/web` (why a library: they ship the font files, so nothing is fetched from the internet at runtime). Import only the weights used (400, 500, 600, 700).
- Fix the `font-family` chain in `apps/web/src/index.css` so Latin text uses Inter and Hebrew text and ₪ fall back to Heebo. Make sure the SVG charts use the same chain.

**Check:** a screenshot of the hero, the tables and the chart labels in light and dark mode, with ₪ visible everywhere.

**Done (2026-11-15).** Weights 400/500/600/700 for Inter, 400/500/700 for Heebo, imported in `main.tsx`. Both fonts include ₪ (U+20AA: Inter's latin-ext file, Heebo's hebrew file). Form controls didn't inherit the page font, so `button, input, select, textarea { font-family: inherit }` was added too. Checked in a headless browser: Inter and Heebo load, ₪ renders in text, tables and SVG labels.

### Step 7.2: Caps in the core
- Migration `008_category_caps.sql` (decision table).
- `src/db/rules.ts`: `listCategories` returns `cap`. A new `setCaps(db, caps)` saves them in one transaction and throws `ValidationError` / `NotFoundError` / `ConflictError` per the decision table. `store.ts` wraps it.
- A pure `capUsage(byCategory, caps)`. `summarizeLedger(entries, caps)` adds `caps`, `capsOnTrack`, `capsExceeded` and `capTotal`, and passes the capped names to `pieSlices`. `monthLedger` loads the caps through the store.
- `pieSlices(byCategory, maxSlices, capped)` never groups a capped category into Other.
- Export and `migrate-json` carry the caps.

**Tests:** cap usage (under, exactly at, over, no cap, capped with no spending, uncategorized ignored, a refund lowering spent); `pieSlices` keeps a small capped category as its own slice among more than 7 categories; `setCaps` validation against `openDb(":memory:")`; migration 008 running on an M6 database; caps round-tripping through export and `migrate-json`.

**Done (2026-11-15).** `src/caps.ts` (pure) and `src/caps.test.ts`; `listCaps`/`setCaps` in `src/db/rules.ts` (a cap is rounded to agorot; a rename keeps it, since it's a column on the category). `loadRules()` is unchanged (no caps), so the agent, categorize and every existing caller see exactly what they saw before; only `npm run export` adds `"caps"` to `rules.json`. A backup's caps don't overwrite a cap already set in the database, like Cal rules.

### Step 7.3: Trend core and API
- Pure functions in `src/ledger.ts`: `trendTotals(points)`, plus the category-trend building and the single-capped-category totals. The I/O wrapper `categoryTrend(endMonth, n, categories)` goes in `src/ledger-service.ts`, next to `ledgerTrend`.
- Routes:
  - `PUT /api/categories/caps`
  - `GET /api/ledger/trend?end=&n=` → `{ points, totals }` (n stays checked as a whole number from 1 to 24; the UI sends 3, 6, 9 or 12)
  - `GET /api/ledger/category-trend?end=&n=&cat=...`
- `apps/api/src/deps.ts` wiring.

**Tests:** period totals and averages; category-trend totals and over flags; single-cap totals (cap × months, the months over); single mode on only with exactly one selected category that has a cap; route tests with fake `deps` (valid body, cap 0, negative, a string, unknown id, the by-hand bucket, bad `n`, missing `end`).

**Done (2026-11-15).** The pure functions went into a new `src/trends.ts` (not `src/ledger.ts`, which was already long), tested in `src/trends.test.ts`. `categoryTrend` also returns `available` (every category with spending in the period, or a cap), which feeds "+ Add category" and "All categories". A category repeated in the query counts once. `apps/api/src/caps-routes.test.ts` covers the routes; `src/ledger-service.test.ts` checks caps and the category trend through the real store.

### Step 7.4: Rules page: accordion and caps (mockup 4)
- `RulesPage.tsx`: each section becomes a native `<details>`/`<summary>` (a small `Section` component, no library). Order: **Categories & monthly caps** (open by default), Merchant rules, Cal rules. Expand all / Collapse all buttons. Each section's open state is remembered in localStorage (every read and write in try/catch).
- The existing `CategoriesTable` (rename, delete, add stay) gains per row: a ₪ cap input (empty = no cap, placeholder "No cap"), **This month** (spent · left / over, green or red, from `summary.caps`) and **Remove cap**. One **Save caps** button saves the changed rows. The section header shows "N of M capped".

**React practice:** a `<details>` whose `open` comes from state, updated in `onToggle` (Angular comparison: a two-way binding written out by hand); a map of edited rows in state (instead of a reactive `FormArray`).

**Done (2026-11-15).** A `useOpenSections()` hook holds the open state (key `rules.openSections`). The Rules page is outside `MonthGate`, so it reads `?month=` itself and falls back to the latest imported month. The cap input accepts "1,000" and "₪1000"; anything else marks the input and disables Save. Enter in a cap input saves too; "Discard changes" drops unsaved edits. The three count columns became one "Used by" column, and capped categories are listed first. The cap table isn't wrapped in a form, because the rename row already is one and forms can't nest.

### Step 7.5: Dashboard: Cap column (mockup 1)
In `CategoryBreakdown` (`DashboardPage.tsx`):
- A **Cap** column before Amount: the cap in green when spent ≤ cap, red when over, with a small progress bar under it; "—" for categories without a cap. The row's amount turns red when over.
- A `CapCell` button whose tooltip ("Spent ₪X of ₪cap" and "₪Y left to spend" in green, or "Over by ₪Y" in red) shows on hover **and** keyboard focus (CSS `:hover` / `:focus-visible`), with the same text in its `aria-label`.
- Header chips: "N caps on track" and "N caps exceeded". The Total row shows "₪X capped".
- Every number comes from `summary.caps`.

**Done (2026-11-15).** A capped category with nothing spent yet gets its own row ("nothing spent yet", ₪0.00) so its cap is visible. The Cap column only appears when at least one category has a cap. The over-cap row gets a light red wash.

### Step 7.6: Trends: period switch and summary card (mockup 2, top)
- A 3 / 6 / 9 / 12-month segmented control in the section header (`aria-pressed`), kept in `?period=`. The heading becomes "Last N months".
- **The income vs expenses chart is unchanged.** A summary card on its right, from `totals`: income, expenses, Net (green or red) and the monthly averages.
- The table keeps months as rows and gets a Total row.

**Done (2026-11-15).** Both trend charts are in `apps/web/src/components/Trends.tsx`, with a `useTrendParams()` hook for `?period=` and `?cats=` (the default period stays out of the URL; filter clicks replace the history entry instead of adding one). One change to `TrendChart`: with more than 6 months, the Net labels are compact ("-₪16.2K"), because full amounts overlapped at 12 months. The table keeps the exact figures.

### Step 7.7: Spending by category chart (mockups 2 bottom and 3)
- A filter bar: one chip per selected category (swatch, name, ✕ to remove it), **+ Add category** (a select of the remaining categories) and **All categories**, an on/off toggle: pressed when every category is shown, and clicking it then clears the selection. Kept in `?cats=`.
- A new `CategoryTrendChart` in plain SVG, like M6:
  - **Several categories:** one bar per selected category per month, in its color; a bar over that category's cap gets a red outline.
  - **One capped category:** per month, the expense bar (green under the cap, red over) with a cap bar next to it.
- A summary card on the right:
  - several: each selected category's total for the period, and the selected total
  - one capped: total expenses, total cap (cap × months), and under / over by (the "over in N of M months" line was dropped after review; the table and the red bars already show which months)
- An "As a table" view:
  - several: months as rows, one column per selected category plus Total, a Total row, over-cap amounts in red
  - one capped: Month | Expenses | Cap | Left / over, with a Total row

**Done (2026-11-15), 200 tests.** `CategoryTrendChart.tsx`, one shared axis from zero, native `<title>` tooltips per bar and month dimming on hover like the M6 trend. In the cap view each expense bar has its amount above it, and the cap bar is a neutral fill with an outline. "+ Add category" is a `<select>` (keyboard and screen reader support for free), and its options say which categories are capped. Removing every chip leaves an explicit empty selection (`?cats=`) with "Pick a category…".

**Checked** in a headless browser against a seeded throwaway DB (scratch API on another port, never `data/app.db`), light and dark: the dashboard with the cap tooltip on keyboard focus, 6 and 12 months, the cap view, and the Rules page. Also driven by script: an invalid cap blocks Save, saving two changed rows (one removal), Expand/Collapse all remembered across a reload, removing and adding chips, and the period and filter surviving a reload.

### Step 7.8: Docs
`docs/product-vision.md` (caps in scope), `docs/architecture.md` (the new column, endpoints and core functions), `docs/roadmap.md` (M7 ✅), and Done notes in this file.

**Done (2026-11-15).**

## Out of scope
- Forecasting, or alerts when a cap is close
- Caps in other currencies
- A cap that changes by month (one cap for every month, no history)
- Caps in the CLI `report`
- Changing the pie's rank-based colors

## Acceptance criteria
- A ₪1,000 cap on a category with ₪426.72 spent shows "₪573.28 left to spend" in the Dashboard tooltip and on the Rules page. ₪1,856 spent against a ₪1,500 cap shows "Over by ₪356.00" in red.
- A small capped category gets its own pie slice and row, even with many bigger categories.
- The API rejects a cap of 0, a negative cap and a text cap. Clearing the cap removes it.
- The period switch changes both charts, and it survives a reload (URL). The category filter does too.
- Selecting exactly one capped category shows the cap view (mockup 3), with cap total = cap × months.
- ₪ renders correctly in text and in SVG.
- The existing CLI commands, `npm test`, `npm run typecheck` and the evals (`npm run eval`) still work.
- `docs/architecture.md`, `docs/roadmap.md` and `docs/product-vision.md` are updated.
