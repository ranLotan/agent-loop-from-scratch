# Milestone 3: Transaction management

**Status: done** (2026-11-11). The acceptance criteria below are met (100 tests, plus a check on a copy of the real database).

## What was built, and decisions
- **Priority** in `categorize()`: your edit on one transaction → your rule → Cal's sector → uncategorized. Sources `manual` / `agent` (M4) / `rule` / `cal`. The report and dashboard count edits separately.
- **The edit dropdown offers only your categories.** Cal-only sectors (4 in the data, 18 rows) still show as the category, labeled Cal, until you change them.
- **"Make it a rule"** sets the merchant's rule and clears this transaction's own category edit, so the rule applies everywhere (67 charges followed it in the real-data check). Your other hand edits on that merchant stay; an edit beats a rule.
- **Search** (`GET /api/transactions`) runs across months in SQL (month range, text in the merchant or your description, currency). Category and source are filtered after `categorize()`, because they're computed. The UI offers this month or all months; filters live in the URL.
- **Typed errors** (`ValidationError`, `NotFoundError`, `ConflictError` in `src/db/index.ts`) map to 400/404/409. Anything else stays a 500.
- **Renaming a category** updates rules (by id) and edits (stored as text) in one transaction. **A category in use can't be deleted** (409).
- **Not done, not needed yet:** sorting and pagination (538 rows load at once), a card filter, an arbitrary month range in the UI (the API supports `from`/`to`), and UI component tests (decided against).

## Objectives
- Edit data from the UI: transaction category/description, rules, categories.
- Learn React forms (controlled inputs), lifting state, URL state for filters, and optimistic vs. refetch updates.

## Scope
- Transactions page: server-side search and filters (month range, text, category, category source, currency, card), sorting, pagination if needed. Filters live in the URL (`useSearchParams`).
- Edit a transaction: category (from the category list) and description override. Source becomes `manual`. Show the original merchant/sector next to the override.
- "Also create a rule for this merchant" checkbox when changing a category. It creates or updates the merchant rule and re-categorizes every matching transaction.
- Rules page: list, create, edit, delete merchant rules. Category management (add, rename, with an in-use check before delete).
- Category priority extended in core: manual override → rule → Cal sector → null (`categorize()` + tests).
- `PATCH /api/transactions/:id`, `/api/rules` CRUD, `/api/categories` CRUD, with input validation.

## Main deliverables
Transaction edit form, Rules and Categories pages, extended `categorize()`, CRUD routes.

## Dependencies
- M2 (SQLite as the source of truth).

## Acceptance criteria
- Every transaction shows its category source (Rule / Cal / Agent / Manual).
- A manual edit survives a re-import of the same month.
- Creating a rule from a transaction re-categorizes the other transactions of that merchant, and the dashboard totals update.
- A rule can't reference an unknown category (same check as `validateRules`). Deleting a category that's in use is blocked or asks for a replacement.
- The CLI `report` shows the same numbers as the UI.

## Tests required
- Core: `categorize()` priority with overrides.
- API: PATCH validation (unknown category, empty description), rule CRUD + uniqueness on the normalized merchant, category delete-in-use.
- Web (optional, introduce here if wanted): one form component test (Vitest + Testing Library). This is a separate dependency decision.
