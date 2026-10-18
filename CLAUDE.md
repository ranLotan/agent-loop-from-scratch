# Cal Expense Agent — learning project

## Goal
A learning project: a monthly credit card report for my Visa Cal card (bank: Beinleumi / בינלאומי), broken down by category. It has memory for categorizing expenses and a human-approval step for unknown ones. The main purpose is to learn agent design: tools, memory, and human-in-the-loop approval.

## Stack
- Node.js + TypeScript
- `israeli-bank-scrapers` (companyId: `visaCal`) to fetch transactions
- Claude Agent SDK (TypeScript) for the agent
- Credentials in `.env` (never commit it; `.env` goes in `.gitignore`)

## Core design principle
Deterministic code handles fetching, rule matching, totals, and report math.
The agent only handles judgment: proposing categories for unknown merchants and flagging exceptional expenses.

## Rules vs memory
- **Rules** (`data/rules.json`): exact merchant → category mappings, applied by plain code. No agent involved.
- **Memory** (`data/memory.md` or similar): fuzzy notes the agent reads for context (for example "PAYPAL charges are ambiguous, always ask", or past decisions).
- Flow: a transaction with no matching rule goes to the agent. The agent proposes a category, I approve it, and the agent saves a new rule (or a memory note if the case is fuzzy). Over time the unknown pile shrinks.

## Pipeline
1. `fetch`: scrape Cal for a month and save `data/transactions/YYYY-MM.json`. Support manual Excel/CSV export from Cal as a fallback input.
2. `categorize`: apply rules (code only). Priority: my rule → Cal's sector (ענף) from the statement → uncategorized.
3. `agent`: handle unmatched transactions and flag exceptions (above a threshold, new merchant, foreign currency, possible duplicate, new subscription).
4. `approve`: CLI prompt to approve or re-categorize each suggestion (Todoist integration may come later).
5. `learn`: write approved results back to rules or memory.
6. `report`: monthly breakdown by category, comparison with last month, and an exceptions section (Markdown or HTML).

## Learning milestones (build in this order)
1. Manual CSV input with rules only, and a basic report
2. Add the scraper
3. Add the agent with tools (`lookup_merchant`, `propose_category`, `request_approval`, `save_rule`)
4. Approval flow and memory writes
5. Schedule a monthly run

## Working style
I'm learning, so explain design decisions briefly as we go, and build one milestone at a time.
