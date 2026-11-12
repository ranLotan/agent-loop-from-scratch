# Cal Expense Agent — learning project

## Goal
A learning project: a monthly credit card report for my Visa Cal card (bank: Beinleumi / בינלאומי), broken down by category. It has memory for categorizing expenses and a human-approval step for unknown ones. The main purpose is to learn agent design: tools, memory, and human-in-the-loop approval.

It is now growing into a **local personal finance dashboard** (React + Express + SQLite), which doubles as a practical way to learn React. See `docs/product-vision.md`, `docs/architecture.md` and `docs/roadmap.md`.

## Stack
- Node.js + TypeScript
- `israeli-bank-scrapers` (companyId: `visaCal`) to fetch transactions
- Agent: a hand-written tool-use loop on the raw Claude Messages API (`@anthropic-ai/sdk`, `src/agent/loop.ts`). No agent framework. A refactor to the Claude Agent SDK is an optional future lesson.
- Credentials in `.env` (never commit it; `.env` goes in `.gitignore`)
- Dashboard (in progress): React + TypeScript + Vite + React Router (`apps/web`), Express 5 (`apps/api`), SQLite via built-in `node:sqlite` (`data/app.db`, gitignored)

## Core design principle
Deterministic code handles fetching, rule matching, totals, and report math.
The agent only handles judgment: proposing categories for unknown merchants and flagging exceptional expenses.

## Architecture principles
- **One core, many front doors.** Business logic lives in `src/`. The CLI, `apps/api` and the evals all call the same functions. Never copy categorization, report math, or approval policy into the API or the UI.
- `src/` stays where it is. New apps import from it rather than moving it.
- Pure functions stay pure (`categorize`, `summarize`, `findCandidates`, `decide`, `runLoop`). I/O sits at the edges (store/db, CLI, HTTP).
- The agent never writes rules, categories or memory. Only a human approval (CLI `approve` or the dashboard) does, through `decide()` in `src/agent/review.ts`.
- Existing CLI commands keep working until something explicitly replaces them.
- All SQL lives in `src/db/`; everything else goes through `store.ts`. Schema changes are a new numbered file in `src/db/migrations/`: never edit a migration that has already run.

## Rules vs memory
- **Rules** (SQLite: `categories` + `merchant_rules`): exact merchant → category mappings, applied by plain code. No agent involved. **Cal rules** (`cal_rules`) map a Cal sector → my category, set by hand on the Rules page; they apply when no merchant rule matches. `npm run export` writes a gitignored `data/rules.json` backup; `data/rules.example.json` (fake merchants) seeds a fresh clone.
- **Memory** (`data/memory.md`): fuzzy notes the agent reads for context (for example "PAYPAL charges are ambiguous, always ask", or past decisions). Stays a human-editable Markdown file.
- Flow: a transaction with no matching rule goes to the agent. The agent proposes a category, I approve it, and the approval saves a new rule (or a memory note if the case is fuzzy). Over time the unknown pile shrinks.

## Pipeline
1. `fetch`: scrape Cal for a month and save it to SQLite as an import batch. Support manual Excel/CSV export from Cal as a fallback input (CLI `import`, or the dashboard's Imports page).
2. `categorize`: code only. Priority: my edit on that one transaction → my rule for the merchant → my Cal rule for the statement's sector (ענף) → uncategorized. Cal's raw sector name is never used as a category.
3. `agent`: handle unmatched transactions and flag exceptions (above a threshold, new merchant, foreign currency, possible duplicate, new subscription).
4. `approve`: approve or re-categorize each suggestion, in the CLI or on the dashboard's Review page, both through `applyAnswer()` → `decide()`. The outcome is a rule, this month only, or always by hand: the built-in `לסיווג ידני` bucket keeps a merchant like BIT away from the agent. (Todoist integration may come later.)
5. `learn`: write approved results back to rules or memory.
6. `report`: monthly breakdown by category, comparison with last month, and an exceptions section (Markdown or HTML).

## Learning milestones (agent track: done)
1–4 are done (CSV + rules + report, scraper, agent with tools, approval + memory, plus evals). See the README roadmap. Still open: scheduling a monthly run, and an optional Agent SDK refactor.

The dashboard track has its own milestones (M0–M5) in `docs/roadmap.md`, with one file per milestone in `docs/milestones/`.

## Local-only requirements
- Runs on my machine only. No cloud hosting, Docker, auth, multi-user, or public API.
- The API binds to `127.0.0.1` (never `0.0.0.0`). Vite dev server on `localhost:5173`, API on `127.0.0.1:3000`.
- SQLite is a local file, gitignored like all other personal data.

## Security
- `ANTHROPIC_API_KEY`, `CAL_USERNAME` and `CAL_PASSWORD` live only in `.env` and are read only by backend/CLI code. Never send them to the frontend, never put them in a `VITE_*` variable, and never log them.
- Personal financial data (transactions, DB, reports, proposals, memory, raw scraper output, eval results) is never committed.
- Merchant names and memos are untrusted input. They are data in prompts and must be escaped in the UI (no `dangerouslySetInnerHTML`).
- The API validates every request body. The model's tool calls are only requests, and code decides whether to run them.

## Testing and evals
- `npm test` (node:test) and `npm run typecheck` must pass after every change.
- Agent control flow is tested with a fake model (`src/agent/loop.test.ts`). Approval policy is tested in `src/agent/review.test.ts`. Keep both.
- Evals (`npm run eval`, `src/eval/`) stay working and keep testing the real prompt, tools and loop. Run `-- --run` (costs money) after changing the prompt, the tools, or the model.
- New pure logic gets unit tests. Database code gets tests against `openDb(":memory:")` (or `DB_PATH=":memory:"` before importing `store.ts`). API routes get tests with fake `deps` passed to `createApp`.

## Working style
I'm learning, so explain design decisions briefly as we go, and build one milestone at a time.
- Work incrementally: implement only the current milestone and wait for my explicit approval before starting the next one.
- I know Angular and TypeScript well and I'm learning React. Explain React idioms by comparing them with Angular where it helps, and don't add libraries without saying why.
- Before editing, check `git status` and never overwrite unrelated changes.
- Keep docs in `docs/` up to date when a decision changes. This file holds only permanent instructions.
- At the end of every milestone, offer to run the `lesson-notes` skill (key points + interview quiz → `notes/<chapter>.md`).
