# Milestone 2: Local backend and SQLite

**Status: done** (2026-11-11). Every acceptance criterion below is met; the agent and approve flows on SQLite are covered by `src/store.test.ts` and the real-data check is the owner's to run.

## Decisions made during M2
- **Driver:** built-in `node:sqlite`. No dependency or native build; prints an ExperimentalWarning on Node 22.
- **Transaction id:** `billingMonth` **and** the installment number were added to the hash. Tests check that xlsx and scraper still give the same id.
- **`data/rules.json`:** no longer committed, because the repo is public. It's now a gitignored backup written by `npm run export`, and `data/rules.example.json` (fake rules) seeds a fresh clone. The old file stays in git history.
- **Rows missing from a re-import** are marked (`missing_since_batch_id`, migration 002), never deleted, and left out of reports.
- **Uploads** are the raw `application/octet-stream` request body, so there's no multipart library. That also keeps uploads from being a CSRF-able "simple" request. Writes from other origins get a 403.
- **Proposal status `answered`:** the old JSON only recorded *that* an item was reviewed, so migrated and CLI-approved items get this status until M4 records the actual answer.

## Objectives
- Make SQLite the source of truth for transactions, categories, rules, import batches and agent proposals.
- Make transaction identity safe for a global primary key.
- Move imports (file upload, scrape) behind the API, while the CLI keeps working.

## Scope
1. **Transaction id fix** (first, with tests): add the billing month (and installment number) to the `assignIds` key so installment payments in different months don't collide. The scraper and xlsx must still produce the same id for the same row.
2. `src/db/`: driver (`node:sqlite` unless the M0 decision changes), `schema.sql` / numbered migrations, a `schema_version` table, WAL mode, repository functions mapping rows ↔ `src/types.ts`.
3. `store.ts` keeps its function names, backed by SQLite for transactions, rules, categories and proposals. `memory.md`, raw output, reports and eval results stay files.
4. Migration command (`npm run migrate`): JSON → SQLite. Idempotent; leaves the JSON files in place.
5. Import batches + dedup: file SHA-256, upsert by id, keep manual overrides, report rows missing from a re-import.
6. API: `POST /api/imports` (xlsx/csv upload, returns the statement total checks), `POST /api/scrape` → background job, `GET /api/jobs/:id`, `GET /api/imports`.
7. Extract the reusable parts of `cli.ts` (`runImport` checks, `runFetch` comparison) into functions that return data. The CLI prints them.
8. `npm run export`: write `rules.json` from the DB.

## Main deliverables
`src/db/*`, the updated `src/normalize.ts` (ids), `src/store.ts` (SQLite-backed), migration + export scripts, import/scrape/job routes, an Imports page (upload + batch history), `.gitignore` entry for `data/app.db*`, and `.env.example` entries for `API_PORT`/`DB_PATH`.

## Dependencies
- M1. Approval of the driver choice and of the id-scheme change (it re-keys existing data).

## Acceptance criteria
- After `npm run migrate`, every month's totals from the API equal the totals from the old JSON (checked by a script/test).
- Importing the same file twice creates no duplicate rows. Re-importing a month after a scrape keeps matching ids.
- Two installment payments of the same purchase in different months are two rows.
- `npm run report`, `agent`, `approve` and `eval` all work against SQLite.
- `npm test` and `npm run typecheck` pass.

## Tests required
- Unit: new id scheme (installments across months, same-day repeats, xlsx ≡ scraper).
- Repository: round-trip `Transaction`/`Rule` through a temp DB, upsert keeps overrides, unique constraints.
- Migration: run on fixture JSON twice → same row counts and totals.
- API: upload a sample CSV, duplicate upload, bad file type, job status lifecycle (with a fake scraper injected).
