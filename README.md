# agent-loop-from-scratch

An LLM agent that categorizes my credit card spending. **The tool-use loop is written by hand** on the raw Claude Messages API, with no framework, so every part of the agent is visible and tested.

It's a real tool I use every month: it fetches my Visa Cal statement, sorts every transaction into a category, and asks the model only about the merchants that code can't place. A human approves every proposal before anything is saved.

## Design idea: code does the math, the model does the judgment

```
 fetch / import ──► categorize (rules) ──► agent (judgment only) ──► approve (human) ──► report
   deterministic       deterministic          LLM + tools               CLI             deterministic
```

- **Deterministic code** handles anything with one right answer: scraping, parsing the bank's xlsx, matching rules, and totals per currency.
  Each import is checked against the totals printed on the statement, so code finds parsing errors before they reach a report.
- **The agent** only gets what code can't decide: merchants with no rule, or with a vague bank category (e.g. `BIT`, `PAYBOX`, a municipality charge).
  It proposes a category with a confidence level and a reason. It never writes a final category itself.
- **Approved proposals become rules.** The next month, the same merchant is handled by code, so the pile of unknown merchants shrinks over time.

Out of ~100 transactions a month, about 10 reach the model, and a run costs about $0.05.

## The agent loop

[`src/agent/loop.ts`](src/agent/loop.ts) is the core: about 60 lines, with no SDK helpers or framework.

```
messages = [user: task]
repeat up to maxIterations:
    response = model(messages)                 # may return tool_use blocks
    messages += assistant: response.content    # unchanged, thinking block included
    stop if end_turn / max_tokens / refusal
    results = run each tool_use → tool_result  # matched by tool_use_id
    messages += user: results
```

The guards matter more than the happy path:

| Guard | Why |
|---|---|
| `maxIterations` | A model that keeps calling tools can't run up an unbounded bill. |
| Tool errors return `is_error: true` instead of throwing | The model reads the error and can correct itself, e.g. re-send a mistyped merchant name. |
| `max_tokens` / `refusal` stop the loop | Never execute tool input from a cut-off turn. |
| Handlers validate input | The model only *requests* tool calls. Code decides whether to run them. |

**Testing a non-deterministic system:** the loop takes the model client as a parameter (dependency injection).
[`loop.test.ts`](src/agent/loop.test.ts) swaps in a **fake model** with scripted replies, so the control flow is tested exactly with no network and no cost:
- tool dispatch
- parallel tool calls
- error recovery
- iteration limits
- truncated turns

Model *quality* is measured separately with evals against labeled data (see the roadmap).

## Tools

| Tool | Kind | Purpose |
|---|---|---|
| `propose_category` | records a proposal | `strict: true` JSON schema. `category` is an `enum` built from my category list, so the model can't invent a category. |
| `lookup_merchant` | read-only | past transactions and existing rules for a merchant *(planned)* |
| `flag_exception` | records a flag | unusual charges found by code (over a threshold, new subscription, possible duplicate), with the model's explanation *(planned)* |
| `save_rule` | side effect | runs only after human approval *(planned)* |

## Roadmap

Built in stages. Each stage is one concept, and I keep notes on each in [`notes/agents.md`](notes/agents.md).

- [x] Statement import (xlsx/CSV) with checks against the statement totals, rule-based categories, monthly and annual reports
- [x] Bank scraper ([`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers)), with ids that match the manual xlsx import
- [x] First API call: messages, system prompt, content blocks, `stop_reason`, token cost
- [x] Tool calling: a JSON-schema tool and one `tool_use` → `tool_result` round trip
- [ ] **The agent loop by hand, with fake-model tests** ← in progress
- [ ] Tool design: read-only vs. side-effect tools, and exception candidates computed by code
- [ ] Human-in-the-loop approval and memory (rules for exact matches, notes for fuzzy cases)
- [ ] Evals: accuracy against labeled data, prompt-injection cases (merchant names are untrusted input), model cost comparison
- [ ] Refactor to the Claude Agent SDK and compare it with the hand-written loop

## Run it

Requires Node 22+.

```bash
npm install
cp .env.example .env          # Cal login + ANTHROPIC_API_KEY

npm run fetch -- 2026-10      # scrape a month   → data/transactions/2026-10.json
npm run import -- file.xlsx   # or import the bank's export
npm run report -- 2026-10     # monthly report   → data/reports/2026-10.md
npm run agent -- 2026-10      # model proposes categories for unknown merchants
npm test                      # unit tests, including the fake-model loop tests
```

There's no real data in the repo. To try the pipeline without a bank account, use the fake statement:

```bash
npm run import -- samples/cal-sample.csv 1999-01 && npm run report -- 1999-01
```

## Stack

TypeScript run with tsx, the [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) (Claude Opus 5.5), SheetJS, and `node:test`.

## Privacy

Bank credentials live in `.env`. Transactions, reports and raw scraper output are all gitignored, so only code, rules and fake sample data are committed.
