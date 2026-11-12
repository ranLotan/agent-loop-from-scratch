# Milestone 6: Monthly balance (income vs expenses)

## Objective
Answer the app's main question in one screen: **"Did I spend more than I earned this month?"**

To get there:
- months follow the **purchase month** instead of the billing month
- card and manual (bank) money are merged into one ledger
- recurring items can be counted automatically or wait for confirmation
- one-off manual entries are supported
- the dashboard shows Net, a category pie chart, and a 6-month trend

## Product decisions (settled)
| Topic | Decision |
|---|---|
| What a month means | **Purchase month.** Installment payment N counts in **purchase month + (N − 1)** (see R2 findings: billing cycles don't line up with calendar months, so "the cycle it was charged in" isn't well defined). Pending card charges count, so November can be closed on December 1st. |
| Pending charges | Stored **apart from transactions** and **replaced as a whole on every scrape** (see R1 findings). They're provisional: categorized by rules/sector only, not editable, not sent to the agent. |
| Month per page | **Ledger (purchase) month:** Dashboard, Transactions, Manual transactions. **Billing month:** Imports and Review (import batches, agent runs and proposals stay per billing month). The month picker says which one it means. |
| Sources | Two tabs by source: **Card transactions** (automatic) and **Manual transactions** (recurring + one-off, entered by me). |
| Card-paid recurring items | A definition with a `merchant` (M5: internet, phone...) is **never a ledger entry**: the card charge already is. Its status (paid / not seen) only feeds the status strip. Matching uses the **ledger month's** card charges. |
| Recurring modes | `confirm_mode`: `auto` (counts at the expected amount, e.g. salary) or `confirm` (counts only after I confirm, e.g. the gas bill). Only for definitions paid outside the card (no `merchant`); validation rejects `confirm` with a merchant. |
| Suggested amount | `auto`: this month's exception amount, else the definition's amount. `confirm`: the **most recent confirmed amount before this month**, following the `previous_id` chain, else the definition's amount. |
| Confirming | Always for this month only. Changing the baseline is the existing "From now on" edit. |
| Editing an amount | "This month only" (exception) or "From now on" (a new definition linked with `previous_id`), the same choices as today. |
| Skipped | A skipped occurrence (M5) is neither counted nor pending. |
| One-offs | A separate **`manual_entries`** table (date, name, kind, amount, category), not a flag on `recurring_definitions`: a one-off has no schedule, merchant, tolerance, chain or exceptions, and its own table gets real `CHECK`s. Counts as confirmed when created. |
| Unconfirmed items | Never hidden. The summary shows Net plus "N items awaiting confirmation (~₪X expected)". |
| Income | Comes only from manual transactions; the card statement has none. |
| Refunds | A negative card amount (credit/refund) reduces expenses in its category. It is never income. |
| Currency | Net is ILS only. Card charges use their charged ILS amount. Manual definitions in confirm mode and one-offs must be ILS; any other non-ILS manual item is left out of Net with a visible note. |
| When card data is complete | Freshness, not a list of statements. A purchase month's charges sit on the **M and M+1 statements** (see "Billing lag" findings). Ledger month M is **complete** when billing months M and M+1 are imported and the latest scrape (which refreshes pending charges) ran after M ended + 3 grace days. Before that it's **partial** ("up to <date>", from `import_batches.created_at`); with no data, **missing**. Excel/CSV exports have no pending rows: M counts as **likely complete** once the M and M+1 statements are both imported. A charge arriving later just adds a row; Net is always recomputed. Depends on 6.1 confirming pending rows carry the purchase date. |
| Old dashboard section | The M5 "left over" section is **replaced** by Net, not shown next to it. |

## Steps
One step at a time, each one ending with `npm test` and `npm run typecheck` passing. Wait for my approval before starting the next step.

### Step 6.1: Investigate before changing (no code changes to the app)
Two risks must be checked on real data first, because they decide parts of steps 6.2–6.3.

What the code already shows: `mapScrapedAccounts()` in `src/scraper.ts` **drops** pending rows today (the CLI prints "Ignored: N pending"), and `assignIds()` in `src/normalize.ts` builds the id from the batch's billing month. So pending charges never reach the DB yet, and nothing is duplicated *today*. Counting pending charges is what creates the risk.

- **R1, pending transactions.** On real data: what does a pending row look like (is `processedDate` set? which billing month would it get?), and is anything stable between the pending row and the same charge once billed (a Cal identifier, or date + merchant + amount)? Also decide how a kept pending row interacts with "the latest import decides the month's rows" (`missing_since_batch_id`): when it's billed under another billing month, it must move (upsert), not be marked missing in one month and added again in another.
- **R2, installments.** On real data, confirm which date an installment payment carries (the purchase date?) and how to derive the cycle it was charged in (`billing_month − 1`?).

How: Claude can't read `data/`. Claude writes a small read-only inspection script that prints an **anonymized** shape of pending and installment rows (field names, dates, statuses, no merchant names or amounts), and I run it with `!`.

**Deliverable:** a short findings section in this file with the decided rules for R1 and R2, plus a proposed fix for the id if R1 is a problem.

#### Findings (2026-11-12)
Source: `src/investigate-raw.ts` over 5 saved scrapes (`data/raw/`, 2,205 rows: 2,183 completed, 22 pending). The script prints shapes only.

**R1, pending charges: there's no stable id, so don't build one.**
- Pending rows have **no `identifier`**, no `chargedCurrency`, no `installments` and no `memo`. Their `processedDate` is just the purchase month (not a real billing date), and their raw fields are a different set (`transactionID`, `approvalCode`... versus `trnIntId`, `merchantId`... on completed rows).
- The one charge seen both pending and later completed had the **same amount but a different date**. So even date + merchant + amount isn't a safe key.
- Within one scrape, a charge is either pending or completed, never both.
- **Decision:** pending charges live in their own table, and each scrape **deletes and re-inserts all of them**. When a charge is billed, it disappears from the pending list and shows up as a normal transaction with its usual id. No matching, no upsert, no duplicates. The cost: a pending row can't be edited or reviewed (it only exists until the next scrape), which is fine for a provisional row. `assignIds()` stays as it is.
- Side note: completed rows use `trnTypeCode` 25 (2 rows) and 67 (26 rows), which `CAL_TYPE_LABELS` doesn't know yet.

**R2, installments: count payment N in purchase month + (N − 1).**
- The stored `date` is the purchase date (`src/scraper.ts` already undoes the scraper's shift), and `installment_number` is stored, so the rule needs no billing month at all. It's pure and works the same for Excel/CSV imports.
- Consecutive payments of the same purchase are **always billed exactly one month apart** (all 14 pairs seen), so the spread matches the statements.
- "billing_month − 1" is **wrong**: payment N's billing month sits 0 *or* 1 month after purchase + (N − 1) (26 vs 18 rows), depending on where the purchase fell in the billing cycle.

**Billing lag (for "when is a month complete"):** regular charges are billed in the purchase month (723) or the next one (1,409). Only 2 of 2,132 rows took longer (+3). So a purchase month needs the M and M+1 statements, and the decision table now says so.

**Also found:** `mapScrapedAccounts()` keeps only rows billed in the requested month. Ledger month M therefore needs both billing months M and M+1 fetched. That's already how batches work: it just has to be what `monthStatus` checks.

### Step 6.2: Ledger month in the core
- A pure function `ledgerMonth(tx)` in `src/` returns the purchase month for regular charges, and purchase month + (N − 1) for installment payment N (per R2).
- Pending charges (per R1): `mapScrapedAccounts()` returns them instead of only counting them. A migration adds a `pending_charges` table, and each scrape replaces its contents in one transaction. Ledger queries read billed transactions + pending charges.
- Card queries and summaries can group by ledger month. `billing_month` stays as is: import batches, statement-total checks and "the latest import decides the month's rows" still work per billing month.
- Recurring matching of card-paid items (`occurrencesFor()`) gets the ledger month's card charges instead of the billing month's statement.
- The Transactions page gets a month filter by ledger month, and shows the billing month as a column for matching against the Cal statement.

**Tests:** `ledgerMonth` cases (regular, installment 1, installment N, month/year boundary such as December → January, missing or malformed installment data); a scrape replacing pending charges (a billed charge leaves the pending list, so nothing is counted twice); the mapping of a pending scraper row.

**Done (2026-11-12), 140 tests.**
- Migration `005_ledger_month.sql` adds `transactions.ledger_month` and `pending_charges`. Old rows are backfilled in TypeScript when the store opens, so `ledgerMonth()` stays the only copy of the rule.
- `importScrape()` saves the batch and replaces pending charges in one DB transaction.
- API: `GET /api/transactions?by=ledger|billing` (default `billing`, so existing callers are unchanged) and `GET /api/pending?month=`.
- Transactions page: "By purchase month" (default) or "By Cal statement", stored in the URL as `?by=billing`; a Billed column; "payment N of M" under installments; a read-only "Not billed yet" section.
- Inside a ledger month, rows sort by purchase date, so an installment payment from an earlier purchase comes first.
- Not changed yet: the month picker still lists billing months, and the Dashboard still sums by billing month (6.4/6.6 change that).

### Step 6.3: Recurring modes and one-offs (migration 006)
- New migration `006_recurring_modes.sql` (005 is `pending_charges`, from 6.2):
  - `recurring_definitions.confirm_mode TEXT NOT NULL DEFAULT 'auto'` with a check that it's one of `('auto','confirm')`
  - `recurring_exceptions.confirmed_at TEXT` (NULL = not confirmed)
  - a new table `manual_entries (id, date, name, kind CHECK income/expense, amount CHECK > 0, currency DEFAULT 'ILS', category_id, note, created_at)`
- Existing definitions default to `auto`, so nothing changes for current data.
- `OccurrenceStatus` is **extended**, not replaced: add `awaiting_confirmation`. The existing `expected` (outside the card) now means "counted"; `paid`, `not_seen` and `skipped` keep their M5 meaning. Each occurrence also gets `suggestedAmount`.
  - `auto`: `expected`; amount = exception amount if one exists, otherwise the definition's amount
  - `confirm`: `expected` only when the exception row has `confirmed_at`; otherwise `awaiting_confirmation`, with `suggestedAmount` per the decision table
  - card-paid: unchanged from M5
- Core functions: `confirmOccurrence(definitionId, month, amount)` (this month only), `createManualEntry({date, name, kind, amount, category})`, plus edit and delete for manual entries.
- Validation: `confirm` mode is rejected for a definition with a merchant; confirm-mode and one-off amounts must be ILS.

**Tests:** all the occurrence cases above, with "last confirmed actual" across a gap of months and across a `previous_id` split, the validation errors, manual entry CRUD, and the migration running on a DB from M5.

**Done (2026-11-12).** `confirmMonth`/`unconfirmMonth` in `src/db/recurring.ts`; `src/db/manual.ts` for one-time entries. Changing a confirmed month's amount through "this month only" keeps the confirmation; clearing the amount or skipping drops it. API: `POST`/`DELETE /api/recurring/:id/occurrences/:month/confirm` (DELETE = take a confirmation back), `GET/POST/PATCH/DELETE /api/manual-entries`. `RecurringSummary` gained `awaiting`.

### Step 6.4: `monthLedger(month)`, the single source for the dashboard
- `src/ledger.ts`:
  - `monthLedger(month)` → entries `{ source: 'card' | 'manual', kind: 'income' | 'expense', date, name, amount, category, status }`. Card entries come from the categorized transactions by ledger month; manual entries come from outside-the-card occurrences (`occurrencesFor()`) and `manual_entries`. Card-paid occurrences are never entries.
  - `summarizeLedger(entries)` → `{ income, expenses, net, pending: { count, expectedAmount }, byCategory }`. Only counted entries go into the totals. Refunds are negative expenses.
  - `ledgerTrend(endMonth, n = 6)` → net, income and expenses per month.
- Amounts are in ILS. Foreign card charges use their charged ILS amount.
- API: `GET /api/months/:month/ledger`, `GET /api/ledger/trend?end=&n=`, `POST /api/recurring/:id/occurrences/:month/confirm {amount}`, `POST/PUT/DELETE /api/manual-entries`. Every body is validated, as in existing routes.
- The UI never sums anything; it displays what these return.

**Tests:** summarize with a mix of card, auto, confirmed, pending, skipped and one-off entries; a card-paid recurring item (internet) counted once; a refund reducing its category; uncategorized card charges counted under their own bucket rather than dropped; route tests with fake `deps`.

**Done (2026-11-12).** The pure parts (`buildLedger`, `summarizeLedger`, `pieSlices`, `cardState`) are in `src/ledger.ts`; the I/O wrappers (`monthLedger`, `ledgerTrend`, `monthStatus`) are in `src/ledger-service.ts`, like `src/imports.ts`. Entries also carry `origin` (billed / pending / recurring / one_off) and `ref`. The summary reports awaiting items as expected income and expenses separately, card charges not billed yet (counted, but provisional), and non-shekel entries (left out of Net). `src/ledger-service.test.ts` runs the acceptance scenario through the real store.

### Step 6.5: Manual transactions page
- Rename the Recurring page to **Manual transactions**, for the selected month:
  - **Recurring:** each occurrence with its status. Auto items appear as counted, with an Edit action. Confirm items appear as awaiting confirmation, with the suggested amount pre-filled and a Confirm button. Edit asks "This month only / From now on". Card-paid items show as paid / not seen, read-only here.
  - **One-time:** a list for the month plus an "Add one-time" form (date, name, income/expense, amount, category).
  - **Manage recurring definitions:** the current editor, moved to a secondary route.
- The navigation shows **Card transactions** and **Manual transactions**.

**React practice:** controlled forms, lifting state for the selected month, an inline confirm/edit row.

**Done (2026-11-12).** `/manual` (`ManualPage.tsx`) and `/manual/definitions` (`RecurringDefinitionsPage.tsx`); `/recurring` redirects to `/manual` and keeps `?month=`. `MonthEditor` became a shared component. The recurring form gained "Counts automatically / after I confirm the amount" (hidden when a merchant is set). In the definition's first month, "From now on" edits the definition itself, since there's nothing earlier to keep.

### Step 6.6: Month status and the dashboard
- `monthStatus(month)` in the core, exposed via the API:
  - card data: `missing | partial (as of date) | complete`, per the "When card data is complete" rule (`likely_complete` was dropped: a statement file for M+1 is always produced after M ended + 3 days, so files and scrapes follow one rule)
  - pending agent proposals and by-hand charges count
  - manual items awaiting confirmation count
- The Dashboard gets (replacing the M5 "left over" section):
  - **Status strip:** Card ✓ · Review (3 left) · Manual (1 awaiting) → each step links to its page, and a "Next step" button points to the first unfinished one.
  - **Hero:** Income − Expenses = **Net**, green or red, with "1 item awaiting confirmation (~₪250)" when there are pending items.
  - **Pie chart:** expenses by category for the month (card + manual). With more than 7 categories, the top 6 get their own slice and the rest are grouped into **Other**. A category whose net spend is ≤ 0 (refunds) is left out of the pie but stays in the legend table. Include a legend with amounts and percentages. A click on a card category slice opens Transactions filtered by that category; Other and manual-only categories (e.g. rent) aren't links.
  - **6-month trend:** income vs expenses bars, with the Net shown per month.
- **Charts are plain SVG**, with no chart library. A pie slice is an SVG arc path computed from the angles, which is good React practice (rendering lists, deriving values from props). Add a library only if the hand-written version becomes painful, and say why first.
- Accessibility: the legend doubles as a table, so values are readable without the chart.

**Tests:** a pure `pieSlices(byCategory, maxSlices)` function (grouping into Other only above the limit, percentages summing to 100, non-positive categories left out, an empty month); `monthStatus` cases.

**Done (2026-11-12), 170 tests.**
- The old dashboard (billing-month totals, "vs last month", the category table, "left over") is replaced; `CategoryTable` and `Stat` were deleted. The CLI `report` keeps the billing-month view.
- Percentages are rounded by the largest-remainder method, so they always add up to 100.0.
- `PieChart` and `TrendChart` are plain SVG. Hovering a slice highlights its legend row and the other way round (the shared state lives in the parent). Native `<title>` tooltips. The trend has one axis from zero, Net written above each month, and a "As a table" view.
- Colors: the dataviz reference palette, 7 slots + gray for Other, validated for light and dark (`validate_palette.js`). Three light slots are under 3:1 contrast, so the legend table always shows names and values.
- Checked by screenshot against a seeded throwaway DB (light, dark, Manual, Transactions with a pending charge).
- **Known limits:** colors follow a slice's rank, so a category can change color between months. The month picker still lists billing months, so a month with only pending charges can't be selected yet.

## Out of scope
- Importing bank statements automatically (bank items stay manual)
- Budgets and forecasting
- Scheduling a monthly run, or the Agent SDK refactor
- Multi-currency Net

## Acceptance criteria
- For a month with card charges, salary (auto), the gas bill (confirm, not yet confirmed) and one one-off: the Dashboard shows the correct income, expenses and Net, and the gas bill appears as awaiting confirmation and is not counted.
- Confirming the gas bill updates the Net. The next month suggests that confirmed amount.
- A card-paid recurring item (e.g. internet) is counted once, as its card charge.
- A refund reduces expenses in its category.
- An installment purchase spreads across the months its payments were charged, not all in the purchase month.
- Re-importing a month, or a pending charge getting billed, never duplicates transactions.
- The pie chart's slices sum to the month's expenses (excluding non-positive categories). Clicking a card category slice opens the filtered Transactions.
- The existing CLI commands, `npm test`, `npm run typecheck` and the evals (`npm run eval`) still work.
- `docs/architecture.md`, `docs/roadmap.md` and `docs/product-vision.md` are updated.
