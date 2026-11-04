# Milestone 5: Recurring transactions

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
