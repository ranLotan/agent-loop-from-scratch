# Prompt for Claude Code: monthly category caps

Read CLAUDE.md and docs/. Then write docs/milestones/milestone-7.md (same format as M6, in steps) for the feature below, and wait for my approval before implementing. Implement one step at a time.

## Design reference
The approved mockups are in `docs/design/caps/` (static HTML, open them in a browser):
- `1-dashboard-expenses-by-category.html`: the Cap column, hover tooltip, cap chips
- `2-dashboard-trends.html`: the 6-month chart with its summary, and the new category chart with filters
- `3-trends-one-capped-category.html`: the category chart when one capped category is selected
- `4-rules-page.html`: the accordion and cap editing

Match their layout, colors and states. Their numbers are sample data, and their markup is a mockup: rebuild it as React components that fit the existing code (CategoryTable, the existing charts, Rules page), with no hard-coded values. The pie chart stays as it is.

## Data and core
- A category can have a monthly cap in ILS, or none (NULL). Cap > 0. New numbered migration (a cap column on `categories`).
- Cap usage is computed in the core (src/), from `monthLedger` counted expenses by ledger month. The UI never computes it. For each category: cap, spent, remaining (negative = over).
- Capped categories always get their own row and pie slice; they are never grouped into "Other".
- Update docs/product-vision.md: budgets were "excluded"; monthly caps per category are now in scope (no forecasting).

## Rules page (mockup 4)
- Sections become collapsible (accordion), using native <details>/<summary>, no library. "Categories & monthly caps" is a new section, open by default. Expand all / Collapse all buttons. Remember each section's open state in localStorage (wrapped in try/catch).
- Each category row: a cap input (empty = no cap), this month's spent and left/over, and Remove cap. Save validates in the API (cap ≤ 0 rejected, NULL allowed).

## Dashboard: "Expenses by category" (mockup 1)
- Add a "Cap" column before "Amount": the cap in green if spent ≤ cap, red if over, with a small progress bar under it. Empty (—) for categories without a cap.
- On hover AND keyboard focus on the cap cell: a tooltip with "Spent ₪X of ₪cap" and "₪Y left to spend" in green, or "Over by ₪Y" in red.
- Header chips: "N caps on track" and "N caps exceeded". Total row shows the sum of caps.

## Dashboard: trends (mockups 2 and 3)
- Period switch 3 / 6 / 9 / 12 months (default 6) in the section header, kept in the URL query (useSearchParams). It applies to both charts below. Rename the heading to match the period ("Last 6 months").
- **Income vs expenses chart: unchanged.** Add a summary card on its right: total income, total expenses, net (green/red) and the monthly averages for the period. Its table keeps months as rows and gets a Total row.
- **New chart below it: "Spending by category".**
  - Its own category filter: chips with remove (✕), "+ Add category", and "All categories". Kept in the URL query too.
  - One bar per selected category per month, in the category's pie color. A bar over that category's cap gets a red outline.
  - Summary card on the right: each selected category's total for the period, and the selected total.
  - Table: months as rows, one column per selected category plus Total, and a Total row. Over-cap amounts in red.
- **When exactly one selected category has a cap** (mockup 3): each month shows the expense bar (green under the cap, red over) with a cap bar next to it. The table becomes Month | Expenses | Cap | Left / over, with a Total row (cap total = cap × months). The summary card shows total expenses, total cap, under/over by, and how many months were over.
- Charts stay plain SVG, as in M6.

## Fix
- The ₪ symbol renders as a box. Load a font that has it (the mockups use Inter for Latin and Heebo for Hebrew and ₪) and fix the font-family fallback so ₪ displays everywhere.

## Tests
- Core: cap usage (under, exactly at, over, no cap, uncategorized), period totals, single-category cap totals.
- Pure chart helpers: capped categories never go into "Other"; the single-capped-category mode switches on correctly.
- API routes for caps with fake deps, including validation.
- npm test, npm run typecheck and the evals must keep passing.
