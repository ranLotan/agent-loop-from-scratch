# Architecture

This document has two clearly separate parts:
- **Part A: Current architecture** describes what the code does today (verified against the repository at commit `ce8c87d`).
- **Part B: Target architecture** is a proposal for the local dashboard. **None of Part B is implemented yet.**

The detailed module-by-module assessment is in [`milestones/milestone-0-assessment.md`](milestones/milestone-0-assessment.md).

---

## Part A: Current architecture

A TypeScript CLI run with `tsx`. All state is plain files under `data/`.

```
                 ┌──────────── src/cli.ts ────────────┐        ┌────────── src/agent/*.ts ──────────┐
 Cal website ──► │ fetch  → scraper.ts                 │        │ run.ts  (npm run agent)            │
 Cal xlsx/csv ─► │ import → statement-import.ts        │        │   merchants.ts + candidates.ts     │
                 │           └► normalize.assignIds    │        │   → loop.ts (Messages API, tools)  │
                 │ report / annual                     │        │   → handlers.ts → proposals JSON   │
                 │   → categorize.ts → report.ts       │        │ approve.ts (readline)              │
                 └──────────────┬──────────────────────┘        │   → review.decide() → rules/memory │
                                │                               └───────────────┬────────────────────┘
                                ▼                                               ▼
                         src/store.ts  ◄─────────────────────────────────────────┘
                                │   (the only module that touches the filesystem)
                                ▼
 data/transactions/YYYY-MM.json   data/rules.json (committed)   data/memory.md
 data/proposals/YYYY-MM.json      data/reports/*.md             data/raw/*.json   data/evals/*.json

 src/eval/run.ts  ── reuses prompt.ts, tools.ts, handlers.ts, loop.ts with empty rules/history/memory
```

**Layers today**
| Layer | Files | Character |
|---|---|---|
| Input | `scraper.ts`, `statement-import.ts`, `normalize.ts` | Network/file reading at the edge. Mapping and parsing are pure and tested. |
| Domain | `categorize.ts`, `candidates.ts`, `report.ts`, `agent/merchants.ts`, `agent/review.ts` | Pure functions |
| Agent | `agent/loop.ts`, `agent/tools.ts`, `agent/handlers.ts`, `agent/prompt.ts`, `agent/client.ts` | Loop is pure with an injected client. `client.ts` has import-time side effects. |
| Persistence | `store.ts` | Sync `fs`, JSON/MD files |
| Entry points | `cli.ts`, `agent/run.ts`, `agent/approve.ts`, `agent/propose.ts`, `agent/hello.ts`, `eval/run.ts` | Top-level scripts: `process.argv`, `console.log`, `process.exit` |

---

## Part B: Target architecture (proposed)

### Overview

```
 Browser ── http://localhost:5173 ──► Vite dev server (apps/web, React)
                                         │  proxy /api/*
                                         ▼
                                 Express 5 on 127.0.0.1:3000 (apps/api)
                                         │  thin routes: validate → call core → JSON
                                         ▼
          src/  (existing core: categorize, report, candidates, agent loop, review.decide, import, scraper)
                                         │
                                         ▼
          src/db/  repository functions  ──►  data/app.db (SQLite, gitignored)
          src/store.ts  (memory.md, raw scraper output, JSON export/seed)

 CLI (npm run fetch/import/report/agent/approve/eval) ──► the same src/ functions
```

### Proposed folder structure

The existing `src/` is **not moved**.

```
cal-expence-agent/
  CLAUDE.md
  README.md
  package.json            # root: existing scripts + npm workspaces (M1)
  tsconfig.json           # existing, include: ["src"]
  apps/
    web/                  # M1: Vite + React + React Router
      index.html
      vite.config.ts      # dev proxy /api → http://127.0.0.1:3000
      src/
        main.tsx  App.tsx
        api.ts            # the only file that calls fetch()
        hooks/            # useApi, ...
        pages/            # DashboardPage, TransactionsPage, ReviewPage, RulesPage, ImportsPage
        components/       # Table, CategoryBadge, MonthPicker, ...
    api/                  # M1: Express 5
      src/
        server.ts         # app.listen(3000, "127.0.0.1")
        routes/           # months, transactions, rules, proposals, imports, jobs
  src/                    # existing core, unchanged layout
    db/                   # M2: schema.sql, migrations, repository functions
    agent/  eval/  ...
  data/
    app.db                # M2, gitignored
    rules.json            # kept as seed/export
    memory.md             # stays a file
  docs/
    product-vision.md  architecture.md  roadmap.md
    milestones/milestone-0-assessment.md  milestone-1.md … milestone-5.md
```

### Component responsibilities
| Component | Owns | Must not |
|---|---|---|
| `apps/web` | Screens, routing, form state, calling `/api` | Do category math, totals, or approval policy. Never see secrets. |
| `apps/api` | HTTP, input validation, job tracking, wiring core + db | Contain business rules (it calls `src/`) |
| `src/` core | Parsing, ids, categorization, report math, candidates, agent loop, approval policy | Know about HTTP or React |
| `src/db/` | SQL and mapping rows ↔ core types (`Transaction`, `Rule`, …) | Contain business rules |
| CLI scripts | Arguments and terminal output | Contain logic the API also needs |

### 1. How React talks to Express
- JSON over REST, same origin in dev thanks to the Vite proxy (`/api` → `127.0.0.1:3000`), so there's no CORS setup.
- Types: the API returns the core types (`CategorizedTransaction`, `Summary`, `CategoryProposal`). `apps/web` imports **types only** from `src/` (`import type`), so there's one definition and no runtime coupling.
- Planned endpoints (first draft):
  - `GET /api/months` → available months
  - `GET /api/months/:month/summary` → `summarize()` output, plus the previous month for comparison
  - `GET /api/transactions?month=&q=&category=&source=` → categorized rows
  - `PATCH /api/transactions/:id` → category / description override (M3)
  - `GET|POST|PUT|DELETE /api/rules`, `/api/categories` (M3)
  - `POST /api/imports` (file upload), `POST /api/scrape` → job id (M2/M3)
  - `POST /api/agent-runs` → job id. `GET /api/proposals?status=pending`. `POST /api/proposals/:id/answer` (M4)
  - `GET /api/jobs/:id` → `{ status, progress, result, error }`

### 2. How the agent is invoked
- Extract the body of `src/agent/run.ts` into a function, for example `runAgent({ month, transactions, history, rules, memory, client, model })` that returns `{ proposals, flags, usage, stoppedBy }`. It uses the same `merchantsToReview`, `findCandidates`, tools, `SYSTEM_PROMPT`, `createHandlers` and `runLoop`.
- `npm run agent` becomes a thin wrapper (load data → `runAgent` → print → save), and the API route does the same but saves to SQLite.
- `agent/client.ts`: build the Anthropic client lazily (a `getClient()` function) so importing the module in the API or tests has no side effects. The key is read from `process.env` on the server only.
- A run takes several seconds, so it runs as a background job (see 3). The UI polls `GET /api/jobs/:id`.

### 3. How the scraper runs
- `scrapeCal()` (Puppeteer, about 30 s) runs inside the API process as an **in-memory job**: `POST /api/scrape {month}` returns a `jobId` right away, and the UI polls. Only one scrape runs at a time (a simple lock).
- Then `mapScrapedAccounts()` → upsert into SQLite as a new import batch. Raw output still goes to `data/raw/` for debugging.
- Credentials come from `.env` on the server. The UI never asks for them.
- There's no queue library. One process plus a `Map<jobId, Job>` is enough for one user. Jobs are lost on restart, which is acceptable.

### 4. CLI and app side by side
- Both are thin entry points over the same `src/` functions. Logic that lives only in a CLI script (`runImport`'s total checks, `runFetch`'s comparison, `approve.ts`'s apply-actions block) moves into reusable functions that **return** data, and the CLI keeps printing it.
- **Shared storage:** after M2 the CLI reads and writes SQLite through `src/db`, so CLI and dashboard always agree. Until then (M1) both read the JSON files.
- SQLite in WAL mode lets the CLI and a running API use the DB at the same time.

### 5. SQLite and the existing data models
- `src/types.ts` stays the domain model. `src/db/` maps rows ↔ `Transaction` / `Rule` / `RulesFile`, so `categorize(transactions, rules)` keeps taking the same arguments.
- `store.ts` is the seam: the same function names (`loadTransactions`, `loadRules`, `addRules`, `saveProposals`, …) get a SQLite implementation. Callers barely change.
- **Driver (needs approval):** built-in `node:sqlite` (`DatabaseSync`). It has no native build step and no dependency, in the same spirit as `process.loadEnvFile`. On Node 22.22 (installed) it works without a flag but prints an *ExperimentalWarning*. On Node 24+ it's release-candidate quality. The fallback is `better-sqlite3`, which has an almost identical sync API.
- Migrations: numbered `.sql` files plus a `schema_version` table, applied at startup. No ORM.

### 6. Avoiding duplicate business logic
- Categorization stays computed: rule → Cal sector → null, plus (new) a manual override and the approved agent proposal stored on the transaction. Totals always come from `summarize()`.
- The approval policy has a single source: `decide()` in `src/agent/review.ts`. The dashboard's Approve button and the CLI `approve` both call one `applyAnswer()` that runs `decide()` and writes the resulting actions.
- The UI never re-implements totals or category priority. It displays what the API returns.

### 7. Imports and deduplication
- Each import (xlsx, csv, scrape) creates an **import batch** row: source, file name, file SHA-256, billing month, statement-total checks, counts.
- The same file hash → "already imported" (no-op, or re-import if forced).
- Transactions are **upserted by id**: re-importing a month never duplicates rows, and manual edits (override category/description) are kept.
- **Transaction identity must change before SQLite** (see risk R1 in the assessment). `assignIds` hashes `date|merchant|amount|currency|occurrence`. Installment payments keep the purchase date, so payment 2/3 and 3/3 in different billing months get the same id. Proposed id input: `billingMonth|date|merchant|amount|currency|occurrence` (installment number optional), the same for xlsx and scraper so cross-source matching still works. The migration recomputes ids from the JSON files.
- When a month is re-imported and a previously stored row is missing from the new batch, don't delete it. Mark it and report it, as `runFetch` does today with "only previous".

### 8. Preserving the evals
- `src/eval/` stays unchanged and keeps using `prompt.ts`, `tools.ts`, `handlers.ts` and `loop.ts`. Once `runAgent()` exists, the eval may call it with empty rules/history/memory, which is the same no-leakage rule.
- `dataset.ts` builds cases from `listMonths`/`loadTransactions` and `loadRules`. Those keep their signatures (backed by SQLite after M2), so the eval keeps working.
- Fake-model loop tests and `review.test.ts` are untouched. A refactor counts as done only when `npm test` passes unchanged.

### 9. Configuration and secrets
- One `.env` at the repo root, loaded with `process.loadEnvFile()` by the API and the CLI. New optional keys: `API_PORT` (default 3000) and `DB_PATH` (default `data/app.db`).
- No `VITE_*` secrets. Vite only exposes `VITE_`-prefixed variables to the browser, and none are needed.
- `.gitignore` adds `data/app.db*` in M2.
- Express binds to `127.0.0.1`. Optional extra guard: reject requests whose `Host` header isn't `127.0.0.1`/`localhost` (protects against DNS-rebinding from a malicious web page).

### 10. One dev command (future)
- npm workspaces (`apps/web`, `apps/api`) + `concurrently` in the root: `npm run dev` → `vite` + `tsx watch apps/api/src/server.ts`.
- The existing root scripts stay as they are.

### Database strategy (initial model, not implemented)

| Entity | Purpose | Important fields | Relations / constraints | Where |
|---|---|---|---|---|
| `import_batches` | One row per import or scrape | `id`, `source` (xlsx/csv/scraper/json-migration), `file_name`, `file_sha256`, `billing_month`, `checks_json`, `tx_count`, `created_at` | `UNIQUE(file_sha256)` where not null | SQLite |
| `transactions` | Every card transaction | `id` (stable hash, see §7), `billing_month`, `date`, `merchant`, `normalized_merchant`, `amount`, `currency`, `original_amount`, `original_currency`, `type`, `installment_number`, `installment_total`, `sector`, `memo`, `card`, `source`, `import_batch_id` → batches, `category_override`, `description_override`, `override_source` (manual/agent), `updated_at` | PK `id`; index (`billing_month`), (`normalized_merchant`) | SQLite |
| `categories` | Allowed categories | `id`, `name`, `created_at`, `origin` (seed/owner) | `UNIQUE(name)` | SQLite (seeded from `rules.json`) |
| `merchant_rules` | Exact merchant → category | `id`, `merchant`, `normalized_merchant`, `category_id` → categories, `created_from` (seed/approve/manual), `created_at` | `UNIQUE(normalized_merchant)` | SQLite. `rules.json` kept as export/seed |
| `agent_runs` | One agent execution | `id`, `billing_month`, `model`, `stopped_by`, `iterations`, `input_tokens`, `output_tokens`, `created_at` | | SQLite |
| `agent_proposals` | A proposed category | `id`, `run_id` → runs, `merchant`, `category`, `confidence`, `reason`, `new_category_idea`, `status` (pending/approved/changed/new_category/noted/skipped), `answer_json`, `answered_at` | `UNIQUE(run_id, normalized_merchant)` | SQLite (replaces `data/proposals/*.json` and its `reviewed[]`) |
| `exception_flags` | A flag the agent raised | `id`, `run_id`, `transaction_id` → transactions, `severity`, `explanation`, `reasons_json`, `status` (pending/ok/noted) | `UNIQUE(run_id, transaction_id)` | SQLite |
| `recurring_definitions` *(M5)* | Salary, rent, … | `id`, `name`, `kind` (income/expense), `amount`, `currency`, `category_id`, `schedule` (monthly day N), `start_month`, `end_month`, `match_merchant` | | SQLite |
| `recurring_occurrences` *(M5)* | One expected instance | `id`, `definition_id`, `month`, `expected_amount`, `override_amount`, `matched_transaction_id`, `status` | `UNIQUE(definition_id, month)` | SQLite |
| Memory notes | Fuzzy context for the prompt | one line per note | | **Stays `data/memory.md`** |
| Raw scraper output, failure screenshot | Debugging | | | **Stays files** (`data/raw/`) |
| Reports | Markdown output | | | **Generated on demand** from `summarize()`. Files only for the CLI. |
| Eval results | History of eval runs | | | **Stays files** (`data/evals/`) |

**Effective category** of a transaction (computed in code, not stored twice): `category_override` → matching rule → Cal `sector` → null. Its **source** is `manual`/`agent` → `rule` → `cal` → none. This extends `categorize()`, which already returns `categorySource`.

### React learning plan

The user knows Angular and TypeScript. Keep the stack small and add libraries only when their pain is felt.

| Concept | Where it's introduced | Angular analogy |
|---|---|---|
| Function components + JSX + props | M1: layout, table, badges | Components with `@Input()`; templates become JSX expressions |
| `useState`, `useEffect` | M1: month picker, fetching | Component fields + `ngOnInit` / lifecycle |
| Custom hooks (`useApi`) | M1 | A small injectable service + observable |
| Composition (`children`, render props) | M1: `Card`, `Table` | Content projection (`ng-content`) |
| React Router (`<Routes>`, `useParams`, `useSearchParams`) | M1 | Angular Router; query params for filters |
| Controlled forms | M3: edit transaction, rule form | Reactive forms, minus the framework |
| Lifting state, Context (once) | M3/M4: selected month, toast | A shared service with DI |
| Server-state caching | Optional in M3/M4 (TanStack Query) | RxJS + `shareReplay` caching |

**Dependencies (M1):** `react`, `react-dom` (the library), `react-router` (routing), `vite` + `@vitejs/plugin-react` (dev server/build, JSX). API side: `express` (5). Later and optional: `@tanstack/react-query` (only if hand-written fetching gets painful), `concurrently` (one dev command). No state-management library (Redux/Zustand), no form library and no UI kit at the start. Plain CSS (or CSS modules) is enough.

### Local execution model
- Dev: `vite` on `localhost:5173` and `tsx` running Express on `127.0.0.1:3000`, with the proxy between them.
- Personal use doesn't need a production build. Optionally Express can later serve `apps/web/dist` so only one process runs.
- Long tasks (scrape, agent run) are in-process background jobs.

### Security considerations
- Loopback bind; optional Host-header check; no CORS needed (proxy); no auth (single local user, explicitly excluded).
- Secrets only in `.env`, read by the server; never returned by any endpoint; error messages sanitized (the scraper error must not echo credentials).
- Untrusted text (merchant names and memos) is escaped by React by default. Never use `dangerouslySetInnerHTML`. It's still treated as data in prompts (existing injection evals).
- Upload limits: accept only `.xlsx/.xls/.csv`, with a size cap. Parse in memory, and never write to a user-supplied path.
- The DB file and every personal data file are gitignored.

### Migration considerations
- **Migration order:** fix the id scheme (with tests) → create the schema → import `data/transactions/*.json` as `json-migration` batches, `rules.json` → categories + rules, `data/proposals/*.json` → runs/proposals (`reviewed[]` → status) → switch `store.ts` callers to SQLite → keep `npm run export` to write `rules.json` back for backup and diffs.
- The migration is idempotent and re-runnable, and leaves the JSON files in place (no deletion).
- `rules.json` is committed today. After migration the DB is the source of truth. Whether to keep committing an exported `rules.json` (it contains real merchant names) is an open decision.
