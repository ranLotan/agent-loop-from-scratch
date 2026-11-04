# Dashboard roadmap

The dashboard track turns the CLI expense agent into a local React + Express + SQLite app. (The earlier agent-learning milestones are done; see the README.)

Each milestone has its own file with objectives, scope, deliverables, dependencies, acceptance criteria and tests. **One milestone at a time; each starts only after explicit approval.**

| # | Milestone | Status | One line |
|---|---|---|---|
| 0 | [Architecture assessment](milestones/milestone-0-assessment.md) | ✅ Done | Repository assessment, architecture, data model, docs |
| 1 | [React dashboard foundation](milestones/milestone-1.md) | ⏳ Next | Vite + React + Router, a tiny read-only API over the JSON files, dashboard + read-only transaction table |
| 2 | [Local backend and SQLite](milestones/milestone-2.md) | Planned | Fix transaction ids, SQLite schema + migration from JSON, `store.ts` backed by SQLite, imports via API |
| 3 | [Transaction management](milestones/milestone-3.md) | Planned | Search/filter, edit category and description, manual source, rules and categories CRUD |
| 4 | [Agent integration](milestones/milestone-4.md) | Planned | Run the agent from the UI, review proposals and flags, approve/reject through the same `decide()` |
| 5 | [Recurring transactions](milestones/milestone-5.md) | Planned | Recurring income/expenses, expected vs actual, edit one occurrence or the definition |

## Sequencing notes
- M1 deliberately adds a **tiny read-only API** that reads the existing JSON through `src/store.ts`. React learns real data fetching from day one, and M2 swaps the storage behind the same endpoints.
- M2's first task is the **transaction id fix** (installments collide across months), because SQLite's primary key depends on it.
- M4 depends on extracting `runAgent()` and `applyAnswer()` from the CLI scripts. That refactor is guarded by the existing tests.
- Still open on the agent track (independent of these milestones): scheduling a monthly run, and an optional Agent SDK refactor.
