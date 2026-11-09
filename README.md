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

Model *quality* is measured separately, with an eval against labeled data (see [Evals](#evals)).

## Tools

| Tool | Kind | Purpose |
|---|---|---|
| `propose_category` | records a proposal | `strict: true` JSON schema. `category` is an `enum` built from my category list, so the model can't invent a category. |
| `lookup_merchant` | read-only | past charges for a merchant from earlier months |
| `flag_exception` | records a flag | unusual charges found by code (over a threshold, new subscription, possible duplicate), with the model's explanation |
| *(no tool)* `npm run approve` | side effect, human only | the owner reviews the saved proposals; approved answers become rules, memory notes or new categories. The agent has no tool that writes rules or memory, so a prompt injection can't plant a permanent instruction. |

## Roadmap

Built in stages. Each stage is one concept, and I keep notes on each in [`notes/agents.md`](notes/agents.md).

- [x] Statement import (xlsx/CSV) with checks against the statement totals, rule-based categories, monthly and annual reports
- [x] Bank scraper ([`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers)), with ids that match the manual xlsx import
- [x] First API call: messages, system prompt, content blocks, `stop_reason`, token cost
- [x] Tool calling: a JSON-schema tool and one `tool_use` → `tool_result` round trip
- [x] The agent loop by hand, with fake-model tests
- [x] Tool design: read-only vs. side-effect tools, and exception candidates computed by code
- [x] Human-in-the-loop approval and memory (rules for exact matches, notes for fuzzy cases)
- [x] Evals: accuracy against labeled data, prompt-injection cases (merchant names are untrusted input), model cost comparison
- [ ] Refactor to the Claude Agent SDK and compare it with the hand-written loop

## Evals

`npm run eval -- --run` runs the real agent (same prompt, tools and loop) on 36 labeled cases and grades it in code:

- **gold:** my own approved rules
- **silver:** the bank's merchant sector (free, but noisy)
- **injection:** synthetic merchant names that try to give the model an instruction

The model never sees the answers: no history, rules or memory, because `lookup_merchant` would return the bank's sector, which is the silver label.

One run (2026-11-03):

| | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 |
|---|---|---|---|
| gold accuracy | 88% | 75% | 88% |
| silver accuracy | 68% | 72% | 64% |
| injection resisted | 100% | 100% | 100% |
| "high" / "low" confidence accuracy | 86% / 29% | 84% / 33% | 88% / 13% |
| cost | $0.31 | $0.16 | $0.0085 |

The accuracy differences are 1–2 cases, within the noise. Most silver "errors" are shared by all three models, so it's the label that's debatable (baby clothes: the bank says fashion, all three models said kids). Confidence is well calibrated, which is what the approval policy relies on. For this task, Haiku is good enough at about 1/36 of the cost.

## Run it

Requires Node 22+.

```bash
npm install
cp .env.example .env          # Cal login + ANTHROPIC_API_KEY

npm run fetch -- 2026-10      # scrape a month   → data/transactions/2026-10.json
npm run import -- file.xlsx   # or import the bank's export
npm run report -- 2026-10     # monthly report   → data/reports/2026-10.md
npm run agent -- 2026-10      # model proposes categories for unknown merchants
npm run approve -- 2026-10    # review the proposals → rules, memory notes, categories
npm run eval                  # list the eval cases (free); add -- --run to call the models
npm test                      # unit tests, including the fake-model loop tests
```

There's no real data in the repo. To try the pipeline without a bank account, use the fake statement:

```bash
npm run import -- samples/cal-sample.csv 1999-01 && npm run report -- 1999-01
```

## Run the dashboard

A local, read-only dashboard over the same data, using the same categorize and report code as the CLI.

```bash
npm run dev                   # API on 127.0.0.1:3000 + web on localhost:5173
```

Open http://localhost:5173. Import or fetch at least one month first. The API listens on loopback only and has no login, so it's for your own machine. The plan is in [`docs/roadmap.md`](docs/roadmap.md).

## Stack

TypeScript run with tsx, the [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) (Claude Opus 5.5), SheetJS, and `node:test`. The dashboard uses React, Vite, React Router and Express 5.

## Privacy

Bank credentials live in `.env`. Transactions, reports, raw scraper output, proposals, memory notes and eval results are all gitignored, so only code, rules and fake sample data are committed.
