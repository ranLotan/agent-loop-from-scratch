# Milestone 0: Repository assessment

Assessed on 2026-11-04 at commit `ce8c87d` (branch `master`, clean working tree). Every statement below comes from reading the implementation, not from file names. Repository: `agent-loop-from-scratch` (local folder `cal-expence-agent`), about 2,570 lines of TypeScript in `src/`.

## 1. Existing modules and responsibilities

### Input and normalization
| File | What it does | Pure? |
|---|---|---|
| `src/types.ts` | `Transaction`, `Rule`, `RulesFile`, `CategorizedTransaction` (`categorySource: "rule" \| "cal" \| null`) | types |
| `src/normalize.ts` | `currencyCode`, `round2`, `assignIds`: sha1 of `date\|merchant\|amount\|currency\|occurrence`, first 12 hex chars. Shared by xlsx and scraper so the same purchase gets the same id | ✅ |
| `src/statement-import.ts` | Reads Cal xlsx (SheetJS) / csv (csv-parse) into rows, then `parseStatement` walks sections, maps Hebrew/English headers, parses dates/amounts/installments, finds the billing date, and checks each section's printed total against the sum of its rows | `parseStatement` ✅, `importStatementFile` reads a file |
| `src/scraper.ts` | `scrapeCal` (israeli-bank-scrapers, headless browser, reads `CAL_USERNAME/PASSWORD` from env). `mapScrapedAccounts` (pure) keeps completed transactions whose **billing date** is in the month, flips the sign, converts dates to Israel time, and undoes the scraper's installment date shift | mapping ✅, scrape = network |

### Domain logic
| File | What it does | Pure? |
|---|---|---|
| `src/categorize.ts` | `normalizeMerchant` (whitespace + uppercase), `validateRules` (rules must use a known category), `categorize`: rule → Cal sector → null | ✅ |
| `src/candidates.ts` | `findCandidates`: exception candidates found by code (large ≥ ₪1500, foreign ≥ 300, new merchant ≥ 300, new standing order, possible duplicate), using history from earlier months | ✅ |
| `src/report.ts` | `summarize` (all the math: totals per currency, by category, by source, uncategorized merchants), `totalsByCurrency`, `renderMarkdown`, `renderAnnualMarkdown` | ✅ |
| `src/agent/merchants.ts` | `merchantsToReview`: uncategorized merchants plus those with a *vague Cal sector* (שונות, מוסדות), unique, capped | ✅ |
| `src/agent/review.ts` | `decide(proposal, answer, rules, today)` → `Action[]` (add_category / add_rule / add_memory): **the approval policy**. `formatMemoryNote` | ✅ |

### Agent
| File | What it does |
|---|---|
| `src/agent/loop.ts` | `runLoop`: the hand-written tool-use loop on the Messages API with an injected `ModelClient`. Guards for max iterations, max_tokens, refusal and unknown tool; tool errors come back as `is_error`. |
| `src/agent/tools.ts` | Tool schemas (`strict: true`): `propose_category` (category is an enum from the list, with `new_category_idea`), `lookup_merchant` (read-only), `flag_exception` (`transaction_id` is an enum of candidate ids) |
| `src/agent/handlers.ts` | Tool implementations: validate input, record proposals/flags into an `AgentOutput`, and return history + rule for lookups. **No handler writes to disk.** |
| `src/agent/prompt.ts` | `SYSTEM_PROMPT` (two tasks, lookup policy, injection warning) |
| `src/agent/client.ts` | `loadEnvFile()` + `new Anthropic()` **at import time**. `MODEL = "claude-opus-5-5"` |
| `src/agent/proposals.ts` | `ProposalsFile` type: proposals, flags (with candidate), `reviewed: string[]` |

### Entry points (CLI)
| Script | Command | Notes |
|---|---|---|
| `src/cli.ts` | `fetch`, `import`, `report`, `annual` | Functions print results instead of returning them. `runFetch` compares a re-fetch with the previous file (totals + ids). |
| `src/agent/run.ts` | `npm run agent -- YYYY-MM` | Top-level script: loads data, builds the task and system prompt (last 50 memory notes), runs the loop, prints, saves `data/proposals/YYYY-MM.json`. Cost math hardcodes Opus prices. |
| `src/agent/approve.ts` | `npm run approve -- YYYY-MM` | readline UI. For each proposal: `decide()` → `addCategories` / `addRules` / `appendMemory`, then adds it to `reviewed`. Flags: ok or note. Resumable. |
| `src/agent/propose.ts`, `hello.ts` | lesson scripts | Single-call examples, kept for learning |
| `src/eval/run.ts` | `npm run eval [-- --run]` | Runs the real prompt, tools and loop on gold (rules), silver (Cal sector) and injection cases with no rules, history or memory. Saves `data/evals/*.json`. |
| `src/eval/dataset.ts`, `injection.ts`, `score.ts` | | Case building (`allTransactions` = current + previous year), synthetic injection cases, pure scoring |

### Persistence
`src/store.ts` is the **only** module that touches `data/` (sync `fs`). This is the natural seam for SQLite.

### Tests (`npm test`, node:test, 36 tests)
`pipeline.test.ts` (6: parsing, categorize, scraper mapping, annual), `candidates.test.ts` (3), `agent/loop.test.ts` (7, fake model), `agent/merchants.test.ts` (2), `agent/review.test.ts` (13, approval policy), `eval/score.test.ts` (5). `npm run typecheck` = `tsc --noEmit` over `src` (TypeScript 7).

## 2. Existing execution flows

```
Monthly flow (CLI)
  npm run fetch -- 2026-10            scrapeCal → saveRaw → mapScrapedAccounts → saveTransactions (overwrite)
     or npm run import -- file.xlsx   importStatementFile → total checks → saveTransactions (overwrite)
  npm run agent -- 2026-10            loadTransactions + loadRules + loadHistory + loadMemory
                                      → merchantsToReview + findCandidates → runLoop(tools) → saveProposals
  npm run approve -- 2026-10          loadProposals → per answer: decide() → addCategories/addRules/appendMemory
  npm run report -- 2026-10           loadTransactions + loadRules → validateRules → categorize → summarize → renderMarkdown → saveReport
  npm run annual -- 2026              listMonths → categorize each → summarize per month + year
```

Note: `categorize()` doesn't read proposals. An approved proposal affects the report **only through the rule it created**. Low-confidence approvals create a memory note, not a rule, so those transactions stay uncategorized or keep Cal's sector. CLAUDE.md's pipeline mentions "comparison with last month" and an "exceptions section" in the report, but `renderMarkdown` currently has neither. Flags live only in the proposals file.

## 3. Existing data structures

| Structure | Defined in | Notes |
|---|---|---|
| `Transaction` | `src/types.ts` | id, date, merchant, amount (+ = spent), currency, original amount/currency, type, installments, sector, memo, card, source |
| `CategorizedTransaction` | `src/types.ts` | + `category`, `categorySource` |
| `RulesFile` / `Rule` | `src/types.ts` | `categories: string[]` (17 Hebrew names), `rules: {merchant, category}[]` |
| `CategoryProposal`, `ExceptionFlag` | `src/agent/tools.ts` | Model output (matches the tool schemas) |
| `Candidate` | `src/candidates.ts` | Code-found exception, with reasons |
| `ProposalsFile` | `src/agent/proposals.ts` | Per month. `reviewed` mixes **merchant names** (proposals) and **transaction ids** (flags) |
| `Summary` | `src/report.ts` | Report math result. Ideal as an API response for the dashboard |
| `Answer`, `Action` | `src/agent/review.ts` | Approval input / output |
| `EvalCase`, `Score` | `src/eval/` | |

## 4. Existing persistence

| Path | Content | Git | Write pattern | Future home |
|---|---|---|---|---|
| `data/transactions/YYYY-MM.json` | `Transaction[]` per billing month | ignored | overwritten per import/fetch | **SQLite** `transactions` + `import_batches` |
| `data/rules.json` | categories + rules | **committed** | rewritten by `addRules`/`addCategories` (one rule per line) | **SQLite** `categories`, `merchant_rules`. JSON kept as seed/export |
| `data/memory.md` | memory notes, `- date \| merchant \| text` | ignored | append | **Stays a file** |
| `data/proposals/YYYY-MM.json` | `ProposalsFile` | ignored | rewritten after every answer | **SQLite** `agent_runs`, `agent_proposals`, `exception_flags` |
| `data/reports/*.md` | rendered reports | ignored | overwrite | generated on demand. Files remain for the CLI |
| `data/raw/*.json`, `failure.png` | raw scraper output | ignored | overwrite | stays files |
| `data/evals/*.json` | eval run results | ignored | new file per run | stays files |
| `.env` | `CAL_USERNAME`, `CAL_PASSWORD`, `ANTHROPIC_API_KEY` | ignored | manual | stays |

## 5. Reusable without modification
`normalize.ts` (except the id scheme, see R1), `categorize.ts`, `candidates.ts`, `report.ts` (`summarize` is the dashboard's data source), `statement-import.ts::parseStatement`, `scraper.ts`, `agent/loop.ts`, `agent/tools.ts`, `agent/handlers.ts`, `agent/prompt.ts`, `agent/merchants.ts`, `agent/review.ts`, `eval/score.ts`, `eval/injection.ts`, and every existing test.

## 6. Refactoring areas (for later milestones, not now)
| Area | Why | Milestone |
|---|---|---|
| `assignIds` key | Installment collision (R1) | M2 |
| `store.ts` implementation | Swap JSON for SQLite behind the same function names | M2 |
| `cli.ts` `runImport` / `runFetch` | Logic mixed with `console.log`. Return check/compare results instead | M2 |
| `agent/run.ts` → `runAgent()` | Top-level script with `process.argv`/`process.exit`; the API needs a function | M4 |
| `agent/approve.ts` → `applyAnswer()` | The apply-actions block is needed by the API | M4 |
| `agent/client.ts` → lazy client | Import-time side effects (env load + client construction) | M4 |
| `categorize()` priority | Add manual/agent override above rules | M3 |
| `ProposalsFile.reviewed` | Mixed keys; becomes a per-row `status` | M2 |
| `run.ts` cost math | Hardcoded Opus prices; the eval already has a price table | M4 (minor) |

## 7. Architectural risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | **Transaction id collision across months.** The id hashes `date\|merchant\|amount\|currency\|occurrence`. Installment payments keep the **purchase** date (the scraper deliberately undoes its date shift; the xlsx shows the purchase date), so payment 2/3 and 3/3 of the same purchase, in different billing months, get the **same id**. That's harmless with per-month files, but it breaks a global primary key. | Data loss on SQLite upsert | Add the billing month (and installment number) to the key in M2, with tests that xlsx ≡ scraper still holds |
| R2 | `occurrence` depends on row order within one import (same date/merchant/amount twice). | A reordered file could swap the ids of identical rows | Acceptable (the rows are identical), but document it. Overrides on one of two identical rows could move to the other |
| R3 | `card` isn't in the id. Two cards with identical charges on the same day are numbered by occurrence, not by card | Low | Optionally add `card` (the scraper sets it, xlsx doesn't) |
| R4 | **No income data.** The source is a card statement | The dashboard's "income" is empty until M5 | Recurring and manual income in M5; documented in the product vision |
| R5 | Cal sectors are used as categories but aren't in `rules.categories` | The category list in the UI is open-ended; filters must merge both | Treat sectors as read-only "Cal categories", or seed them into `categories` in M2 (decision in M2) |
| R6 | No per-transaction category today; approvals only reach the report through rules | "Manual" and "Agent" sources are new behavior | Extend `categorize()` in M3 with tests |
| R7 | CLI and API using SQLite at the same time | Locking errors | WAL mode, short transactions, sync driver |
| R8 | `node:sqlite` is experimental on Node 22 (installed: 22.22.3) and prints a warning | Noise. The API may change | Accept, or upgrade Node 24, or use `better-sqlite3` (decision before M2) |
| R9 | TypeScript 7 with Vite/React tooling | Possible editor/plugin friction | Verify at the start of M1; per-app tsconfig |
| R10 | `rules.json` is committed and contains real merchant names; after M2 the DB is the source of truth | Drift between the DB and the committed file; privacy | `npm run export` writes it back; decide whether to keep committing it |
| R11 | Scraper runtime (~30 s, headless browser) inside the API | A blocked request, double runs | In-process job + single-run lock |
| R12 | Docs drift: CLAUDE.md said "Claude Agent SDK", but the code uses the raw Messages API | Misleading instructions | Fixed in this milestone |
| R13 | The eval dataset depends on `listMonths`/`loadTransactions`/`loadRules` | The eval breaks if signatures change in M2 | Keep the signatures; run `npm run eval` (free mode) as a smoke test |

## 8. Recommended implementation sequence
1. **M1:** workspaces, read-only Express (3 GETs over `store.ts` + `categorize` + `summarize`), React shell with router, dashboard and read-only table. No changes to `src/`.
2. **M2:** id fix with tests → `src/db` schema + migrations → JSON migration → SQLite-backed `store.ts` → import batches/dedup → upload and scrape jobs.
3. **M3:** override-aware `categorize()` → edit transaction → rules/categories CRUD → search/filter.
4. **M4:** extract `runAgent` / `applyAnswer` / lazy client (guarded by the existing tests) → agent and proposal routes → Review page → eval re-run.
5. **M5:** recurring definitions and occurrences, matching, income on the dashboard.

## 9. Open decisions (need approval)
- SQLite driver: `node:sqlite` (recommended) vs `better-sqlite3`; and whether to move to Node 24.
- New id scheme (re-keys existing data during migration).
- Whether to keep committing an exported `rules.json` after M2.
- How to handle Cal sectors that aren't in the category list (R5).
- M1 dependency list (see `milestone-1.md`).
