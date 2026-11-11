# Milestone 4: Agent integration

**Status: done** (2026-11-11). 111 tests with a fake model and an in-memory database, plus a check on a copy of the real database.

## What was built, and decisions
- **Services:** `runAgent()` (`src/agent/service.ts`) and `applyAnswer()` / `answerFlag()` (`src/agent/apply.ts`). `npm run agent`, `npm run approve` and the API all use them.
- **Model: Haiku** by default. `getClient()` is lazy and loads the root `.env` by path.
- **New answers, from the owner:** *this month only* (an agent-labeled edit on that month's charges, no rule, a memory note) and *always by hand* (a rule to the built-in `לסיווג ידני` category).
  - A by-hand merchant never reaches the agent again. You can also set it directly, without a proposal, from the Edit form or the Rules page.
  - On the real data: 3 BIT-like merchants, 12 agent questions before, 0 after, and 18 charges waiting for you.
- **The built-in category** is protected (409 on rename or delete) and never offered to the model.
- **Answers are recorded as what they were** (`answer_json`). Older ones show as "answered". Answering twice → 409.
- **Review page:** run the agent (a background job, with the shared `useJob` hook), answer proposals and flags, and see the cost. **Dashboard:** "proposals to review" and "waiting for you (by hand)" counts.
- **CLI:** new keys `o` (this month only) and `h` (always by hand). Without a keyboard it now quits cleanly instead of crashing.
- **Eval rerun (2026-11-11, Haiku, $0.0086):** gold 64% (7 of 11: the same 7 as before, plus 4 misses on newer, taste-dependent labels such as Disney Plus → ילדים), silver 52% (a resampled set), injection 100%, "high" right 81% / "low" right 0%.
  - **Decision: keep Haiku.** Low confidence still means "don't trust", which the approval policy relies on, and every proposal is reviewed anyway.
  - The model is set in code (`MODEL`), not per run.

## Objectives
- Run the agent and review its work from the dashboard, with the same human-approval guarantee as the CLI.

## Scope
- Refactor (behavior-preserving): extract `runAgent(...)` from `src/agent/run.ts` and `applyAnswer(...)` from `src/agent/approve.ts`. Make `agent/client.ts` lazy (`getClient()`). The CLI scripts become thin wrappers.
- API: `POST /api/agent-runs {month}` → background job; `GET /api/agent-runs`, `GET /api/proposals?status=pending`, `POST /api/proposals/:id/answer` (approve / change / new_category / note / skip), `GET /api/flags`, `POST /api/flags/:id/answer` (ok / note).
- Review page: pending proposals with confidence, reason and new-category idea. The same five answers as the CLI. Flags with explanation. Run cost and token usage shown per run.
- Approved proposals store `override_source = agent` where relevant, and rules/notes are written via `decide()`.
- Dashboard shows the "awaiting review" count.

## Main deliverables
`runAgent`, `applyAnswer`, agent/proposal/flag routes, the Review page.

## Dependencies
- M2 (proposals in SQLite), M3 (categories/rules UI).

## Acceptance criteria
- The agent still has no tool that writes rules, categories or memory. Only `applyAnswer` (human) does.
- The same answer gives the same actions in the CLI and the UI (both call `decide()`).
- `npm run agent` / `npm run approve` still work and see the same pending proposals as the UI.
- `ANTHROPIC_API_KEY` is used only server-side. A missing key gives a clear error in the UI and doesn't crash the API.
- Evals (`npm run eval -- --run`) give results in line with the 2026-11-03 run, which shows the prompt and tools are unchanged.

## Tests required
- `loop.test.ts`, `review.test.ts` and `merchants.test.ts` pass **unchanged**.
- New: `runAgent` with the fake `ModelClient` (proposals + flags returned, nothing persisted by the agent itself).
- New: `applyAnswer` writes the actions from `decide()` (temp DB).
- API: answer a proposal (each kind), answering twice is rejected, a run job with a fake client.
- Injection eval cases still at 100% resisted.
