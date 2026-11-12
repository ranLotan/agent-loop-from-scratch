---
study: true
chapter: System design
---
# System design: interview cheat sheet

Built lesson by lesson while working on cal-expense-agent (turning the CLI expense agent into a local React + Express + SQLite dashboard).
Each lesson has key points, then interview questions with the answers we settled on.

---

## Lesson 0: Assessing a codebase before adding a UI and a database

**Key points**
- **Assess before you design:** read the code to see what it actually does, not what the names suggest. Find the pure functions, the side effects, and the one place that touches storage.
  - Docs drift: `CLAUDE.md` said "Agent SDK", but the code uses the raw Messages API. Only reading the code catches that.
- **One core, many front doors:** business logic lives once in `src/`. The CLI, the Express API and the evals are thin entry points that call it.
  - It prevents duplicate logic, like report math written again in React that slowly drifts from the CLI's numbers.
- **Service vs entry point:** a service takes inputs as parameters and returns data (no `process.argv`, no `console.log`, no `process.exit`). Each entry point translates: the CLI reads argv, the API reads `req.body`, a test passes values directly.
  - Top-level module code runs on `import`, once. `src/agent/run.ts` is a script, so importing it from Express would run the agent at startup. The plan is to extract `runAgent()` (and `applyAnswer()` from `approve.ts`) and keep the CLI files as thin wrappers.
  - Dependencies such as the model `client` are parameters too (dependency injection), which is why `runLoop` is tested with a fake model.
- **The persistence seam:** `src/store.ts` is the only module that touches `data/`. You swap JSON for SQLite behind the same function names, and the callers barely change (repository pattern / ports & adapters).
- **Identity decides deduplication:** a primary key needs an id that's stable and unique across all data, not just one file.
  - In this project, `assignIds` in `src/normalize.ts` hashes `date|merchant|amount|currency|occurrence`. Installment payments keep the purchase date and amount, so payment 2/3 and 3/3 collide across months. Per-month files hid it; a global `UNIQUE(id)` would turn it into data loss.
- **Choosing a storage home:** choose by how the data is used, not by size. Data that's queried, edited from a UI, relational, unique, or written by several processes goes in SQLite. Human-edited notes stay a file (`data/memory.md`). Derived output (reports) is generated on demand.
- **Local-only security:** bind to `127.0.0.1`, keep secrets only on the server (never in `VITE_*`), check the Host header, and treat merchant names as untrusted input in the prompt and the UI.
- **Long tasks become background jobs:** a scrape takes about 30 s, so the request returns a job id and the UI polls. An in-memory job map is enough for one user.

**Interview questions**
1. You're adding a web UI and a REST API to an existing CLI tool. How do you structure the code so business logic isn't duplicated, and what do you check in the existing code first?
   - *Answer:* Keep the logic in one core (`src/`). The CLI and API are thin wrappers that parse input, call it and format output.
     First I check the core is actually reusable: pure functions that return data, I/O in one store layer, and nothing that runs at import time or reads `process.argv`.
     Script-style files like `agent/run.ts` get split into a service (`runAgent()`, inputs and client as parameters) plus a CLI wrapper. The UI never recomputes totals or policy; it shows what the API returns.
   - ⚠️ "Runs at import time" = top-level code executes on `import`, once. A script imported by a server would run at startup.
2. In this project, why couldn't you just load the transaction JSON files into SQLite with `id` as the primary key?
   - *Answer:* Installment payments of the same purchase appear in several billing months with the same purchase date, merchant and amount, and the id is a hash of exactly those fields, so they get the same id.
     Per-month files hid it, but with a global primary key the upsert would overwrite one payment with another and lose data.
     The fix is to add the billing month and installment number to the id, keeping it identical across xlsx and scraper imports.
3. Moving a file-based app to SQLite: how do you decide what goes in the database and what stays a file?
   - *Answer:* I look at how the data is used, not its size. Data that's queried and filtered, edited from a UI, has relationships or uniqueness rules, or is written by several processes goes to SQLite: here transactions, rules, categories and proposals.
     Human-edited, append-only text stays a file: `memory.md` is notes I edit by hand and the agent reads into its prompt. Debug output and eval results stay files too.
     Reports are derived, so they're generated on demand from `summarize()`.
   - ⚠️ Size is rarely the reason: years of personal transactions fit in JSON. Integrity (constraints, atomic writes) and concurrent writers are.
4. The dashboard runs only on your machine with no login. What still needs securing, and how?
   - *Answer:* The API binds to 127.0.0.1, so it's not reachable from the network. Secrets stay in `.env` on the server, never in `VITE_` variables or responses.
     Since any website in my browser can call localhost, I also check the Host header against DNS rebinding.
     Merchant names are untrusted: they're data in the prompt (covered by the injection evals) and escaped in the UI. Uploads are limited to xlsx/csv, and personal data and the DB are gitignored.
   - ⚠️ "Binds to loopback" is not "filters by IP": the port simply isn't reachable from the LAN.

---

## Lesson 1: A thin local API over an existing core

**Key points**
- **npm workspaces:** one repo with several packages (`"workspaces": ["apps/*"]`), one install, one lockfile, hoisted `node_modules`. `-w apps/web` runs a command inside one package.
  - Each app declares only its own dependencies: the API never pulls in React, and the web app never pulls in Express.
- **Build vs start:** `createApp(deps)` in `apps/api/src/app.ts` builds the app, and `server.ts` calls `listen()`. Tests start it on port `0` (any free port) with fake `deps`, the same dependency injection as `runLoop`'s `ModelClient`.
- **Thin routes:** validate → call the core → map to HTTP (400 bad input, 404 missing, JSON). No math in routes, so the dashboard can't disagree with `npm run report`; both call `summarize()`.
- **Middleware order:** handlers run in registration order. Host check first, then body parsing, routes, a JSON 404, and the error handler last. Express 5 sends thrown or rejected route errors to the 4-argument error handler automatically.
- **Host-header defense:** the API rejects requests whose Host isn't `localhost`/`127.0.0.1`. Browser JS can't fake the header, and neither can Node's `fetch`: `Host` is a forbidden header, dropped silently. Tests use `http.request`.
- **Smoke test vs real test:** a throwaway "does it turn on" check while building, vs committed assertions in `npm test` that guard the contract forever.
- **In this project:** the API recomputes reports on every request, while the saved `data/reports/2026-10.md` turned out to be stale (it held 2026-09's numbers). That's why derived data shouldn't be stored as a source of truth.

**Interview questions**
1. Why split `createApp(deps)` from `listen()` instead of one `server.ts` that does both? What does that give you?
   - *Answer:* Building the app and starting it are separate jobs. `createApp(deps)` returns a configured app without opening a port, so a test can start it on port 0 with fake data and close it afterward, with no collision with a running dev server and no dependency on real files.
     The dependencies are injected, so the same routes run against the real store in `server.ts` and in-memory fixtures in tests. It's the same idea as passing a fake `ModelClient` to `runLoop`.
   - ⚠️ "Why not mock the store module?" Module mocking ties tests to file paths and import order. A parameter is explicit and type-checked.
2. In an Express app, why does the order of `app.use(...)` calls matter? Give an example where the wrong order is a bug.
   - *Answer:* Express runs middleware and routes in the order they're registered, and a handler that responds without calling `next()` ends the chain. So order is behavior.
     If the Host check came after the routes, those routes would answer first and the guard would never run, with no error to show it. The same goes for the catch-all 404, which has to come after the routes, and the error handler, which has to be last.
   - ⚠️ A test protects this: `Host check: foreign host → 403` fails if the guard moves below the routes.
3. A teammate wants to calculate category totals directly in the Express route or in React because "it's just a reduce." What's wrong with that, and what do you do instead?
   - *Answer:* Each layer has one job: React displays, the route validates the request and maps the result to HTTP, and a core function does the calculation. If totals are also computed in a route or in React, two implementations drift apart and the dashboard can disagree with the CLI report.
     It's rarely "just a reduce": ours keeps totals per currency and rounds them, so a plain sum would add shekels to euros. So I call `summarize()` from one place, test it as a pure function, and every front door returns the same numbers.
   - ⚠️ Display formatting can live in React. Business math can't.
4. You test your Host check using `fetch` with a fake `Host: evil.com` header, and it returns 200 instead of 403. What happened, and what does it tell you about the defense?
   - *Answer:* `Host` is a forbidden header, so `fetch` silently dropped mine and sent the real `127.0.0.1` host, which the guard correctly allowed. The test was wrong, not the guard.
     A missing or misplaced guard would also give 200, so I confirmed with a raw `http.request`, which can set any Host and got 403. It also shows why the defense works: JavaScript in a browser can't forge that header either.
   - ⚠️ A test result only means something if the request really is what you think you sent.

---

## Lesson 2: Moving to a database: migrations, idempotency, identity

**Key points**
- **Schema migrations:** versioned, ordered scripts that change the schema, tracked in a table so each runs exactly once per database.
  - Forward-only: never edit one that has already run; add the next number. Each runs in a transaction. They live in git like code.
  - Why: every copy of the database (dev, test, a colleague's) reaches the same schema the same way.
- **Idempotency:** doing an operation twice has the same effect as doing it once. Essential for imports, retries, and anything a user can click twice.
  - Tools: a stable key per row, a unique constraint plus an upsert (`INSERT … ON CONFLICT DO UPDATE`), a content hash to skip an identical file, and a transaction so a failed run can be retried.
- **Upsert, and who owns each column:** on conflict, refresh only the columns the *source* owns, never the ones the *user* owns (their edits), or a re-import wipes manual work.
- **Identity (primary keys):** a surrogate key (auto-increment, UUID) has no meaning; a deterministic key is derived from the data (a hash of identifying fields). Imports need the deterministic kind so the same real-world row always maps to the same id.
  - The risk: fields that don't really identify a row make two rows collide, and the upsert silently overwrites one. Check row count against distinct keys on real data.
- **Transactions (atomicity):** a multi-step write completes fully or not at all; a crash midway leaves nothing half-done.
- **Soft delete vs hard delete:** a soft delete keeps the row and sets a marker (usually `deleted_at`); a hard delete removes it. Soft keeps history, edits and undo, at the cost of filtering every query.
- **The persistence seam (repository):** callers use `loadX()`/`saveX()`, never SQL, so swapping storage changes one module and existing tests guard the switch.
- **Long-running work over HTTP:** return 202 Accepted with a job id, then the client polls or gets pushed updates (SSE/WebSockets). Job state in memory for one process; a queue or table once there are restarts or several workers.
- **In this project:** `src/db/migrations/` + `schema_version`, `upsertTransactions` in `src/db/transactions.ts`, the id hash in `assignIds` (`src/normalize.ts`), import batches and `missing_since_batch_id` (a soft delete) in `src/db/imports.ts`, `store.ts` as the seam, and `POST /api/scrape` → 202 + `GET /api/jobs/:id`. On real data the old id collided (376 rows, 372 ids); the new one gives 376.

**Interview questions**
1. What is a database migration, and why is the rule "never edit a migration that has already run"?
   - *Answer:* A migration is a versioned, ordered script that changes the database schema, kept in git and tracked in a table so each one runs exactly once per database.
     Because the runner skips migrations it has already recorded, editing one means existing databases never get the change while new ones do.
     You end up with databases at the same version but different schemas, and nothing warns you. So any change goes in a new migration that every database applies from its current state.
   - ⚠️ Rollbacks: many teams write forward-only fix migrations instead of "down" scripts, because rolling back can lose data written in between.
2. What does "idempotent" mean, and how would you make a data import idempotent?
   - *Answer:* Idempotent means doing it twice has the same effect as doing it once, so re-importing the same data doesn't create duplicates.
     I give each row a stable key derived from its data, put a unique constraint on it, and write with an upsert, so a repeated row updates instead of duplicating.
     I also store a hash of each imported file to skip exact repeats, and run each import in a transaction so a failed run can simply be retried.
   - ⚠️ The same idea covers retries: a client that times out and resends a payment request uses an idempotency key.
3. When importing data from an external source, how do you choose a primary key, and what can go wrong?
   - *Answer:* I use a deterministic key: a hash of the fields that identify the row and stay the same on every import and from every source. Then a re-import maps to the same row, unlike an auto-increment id that would just create a duplicate.
     The risk is collisions when the fields aren't actually unique: two different rows get the same key and an upsert silently overwrites one.
     I verify on real data by comparing rows to distinct keys, and add a field or an occurrence counter where needed.
   - ⚠️ "What about hash collisions?" At this scale they're negligible; the real risk is hashing too few fields.
4. A user clicks a button that starts a task taking about 30 seconds on the server. How do you design that request?
   - *Answer:* I don't keep the request open, because it can time out and blocks the user. The server starts a background job and immediately returns 202 Accepted with a job id.
     The client polls `GET /jobs/:id` until it's done or failed, or I push updates with Server-Sent Events or WebSockets (SignalR in .NET).
     Job state can live in memory for one process; with restarts or several servers it moves to a queue or a database. I also stop duplicate starts, for example 409 with the running job's id.
   - ⚠️ Polling is simplest for one user or rare checks; push wins with frequent updates or many clients.
5. Soft delete versus hard delete: what's the difference, and when would you choose each?
   - *Answer:* A hard delete removes the row; a soft delete keeps it and sets a marker, usually a `deleted_at` timestamp, and normal queries filter those rows out.
     I choose soft delete when I need undo, audit history, or to keep data other rows or user edits depend on. I choose hard delete when the data must truly be gone, for privacy or compliance, or isn't worth keeping.
     The cost of soft delete is that every query must filter the marked rows, and missing that filter once is a common bug.
   - ⚠️ Put the filter in one place (a view or a repository function like `loadTransactions()`) so callers can't forget it.

---

## Lesson 3: Modeling recurring data: computed occurrences, exceptions, effective-dated changes

**Key points**
- **Computed vs materialized occurrences:** store a row for every month (materialized), or store one rule and work out the months when you need them (computed, the way calendar recurrence works).
  - Computed: no backfill job, no "generate the next 12 months" step, and changing the rule updates every month. Materialized: simple queries and easy per-row edits, but rows go stale when the rule changes.
  - Most calendar systems mix the two: a recurrence rule plus a list of exception dates.
- **Exceptions table:** store only the months that differ (`recurring_exceptions`: amount, skipped, note), keyed by `(definition_id, month)`. One month gets at most one exception, and editing that month is an upsert.
- **Effective-dated changes (splitting a definition):** "from this month on" closes the old definition (`end_month` = the month before) and starts a new one linked by `previous_id`. Later exceptions move to the new definition. Past months keep their history.
  - There are three edits, each with different meaning: *this month only* (an exception), *from this month on* (a split), *every month* (fix the definition itself, for a mistake).
- **Matching expected to actual:** deterministic code, not the agent. The same merchant and currency, within a tolerance (10% by default). The closest amount wins, and each charge pays at most one item.
- **Not counting twice:** a card-paid recurring item is already part of card spending, so it's never added to totals. Items outside the card (salary, rent by bank transfer) count at their expected amount.
- **Pure core, I/O at the edges:** `occurrencesFor()`, `splitDefinition()` and `summarizeRecurring()` are pure and unit-tested, while the SQL lives in `src/db/recurring.ts`.
- **In this project:** `src/db/migrations/004_recurring.sql`, with `CHECK` constraints for kind, tolerance and `end_month >= start_month`. Also `src/recurring.ts`, `changeFrom()`/`setMonth()` in `src/db/recurring.ts`, the Recurring page, and the dashboard's "left over" figure (income − card spending − outside the card). The milestone has 128 tests.

**Interview questions**
1. You need to model monthly recurring payments, like rent or salary. Would you store a row per month, or store the rule and compute the months? What are the trade-offs?
   - *Answer:* I'd store the rule and compute the months, the way calendar recurrence works, and keep an exceptions table for months that differ.
     You never have to backfill or generate rows ahead of time, and changing the rule automatically updates every month.
     The downside is that you can't just run SQL over the months: you expand the rule in code for a bounded month range.
     I'd store a row per month instead if each occurrence carried a lot of its own state or needed heavy SQL reporting.
   - ⚠️ An open-ended rule has no last month, so always query a bounded range.

---
