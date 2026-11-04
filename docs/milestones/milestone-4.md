# Milestone 4: Agent integration

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
