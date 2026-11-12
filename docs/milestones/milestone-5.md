# Milestone 5: Recurring transactions

**Status: done** (2026-11-11). 128 tests, plus a check on a copy of the real database.

## What was built, and decisions
- **Months are computed, not stored** (calendar-style recurrence). A definition describes every month; `recurring_exceptions` holds only months that differ (a different amount, skipped, a note). `occurrencesFor()` in `src/recurring.ts` is pure and unit-tested.
- **Outside the card** (salary, rent by bank transfer): **always counted at the expected amount** (the owner's choice). Change or skip one month when it differs.
- **Paid by card** (a merchant is set): matched to a charge from that merchant, in that currency, within the tolerance (default 10%). The closest amount wins, and a charge pays only one item. Statuses: paid / not on the statement / expected (no statement yet) / skipped. Card-paid items are **never added to totals**, because the charge is already in card spending.
- **Edit one month vs from this month on:** a one-month change is an exception. "From this month on" ends the definition the month before and starts a continuation (`previous_id`), moving later exceptions to it, so earlier months keep their history. "Edit every month" corrects the definition itself.
- **Dashboard:** income (recurring), card spending, outside the card, and **left over**, in shekels only.
- **Not done:** the agent's "new standing order" flag doesn't offer "make recurring" (decided: later). Frequencies other than monthly aren't supported. Matching doesn't follow a merchant whose name changes.

## Objectives
- Model expected recurring income and expenses (salary, rent, mortgage, electricity, internet, building maintenance), and compare expected with actual.
- Give the dashboard an income side (the card statement has none).

## Scope
- `recurring_definitions` (name, income/expense, amount, currency, category, monthly schedule, start/end month, optional merchant match) and `recurring_occurrences` (one per definition per month: expected amount, override amount, matched transaction, status).
- Generate occurrences for a month range (deterministic code).
- Match occurrences to actual card transactions by merchant + amount tolerance (code, not agent). Unmatched items are shown as "expected, not seen yet".
- Edit **one occurrence** (amount/skip) vs edit **the definition from a month onward** (splits the definition: end the old one, start a new one, so history is kept).
- Dashboard: income (from recurring income) vs expenses, expected vs actual per month.
- Optional: the agent's `new_standing_order` candidates can suggest "create a recurring definition?", always approved by a human.

## Main deliverables
Schema migration, occurrence generation + matching in `src/`, Recurring page, dashboard income section.

## Dependencies
- M2–M3. M4 only for the optional agent suggestion.

## Acceptance criteria
- Editing one occurrence doesn't change other months. Editing "from this month on" leaves earlier months unchanged.
- A recurring card charge (e.g. internet standing order) matches its actual transaction and isn't counted twice in totals.
- Income shown on the dashboard comes only from definitions or manual entries.

## Tests required
- Occurrence generation (month ranges, start/end, day-of-month on short months).
- Matching (exact, tolerance, no match, two candidates).
- Split-definition semantics (single occurrence vs from-month-onward).
- API validation for definitions and occurrence edits.
