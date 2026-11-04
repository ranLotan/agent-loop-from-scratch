# Product vision

## Purpose
A local dashboard for managing, categorizing and analyzing my personal expenses. It sits on top of the existing CLI expense agent. The dashboard makes the monthly routine (import, review the agent's proposals, read the report) a few clicks instead of several terminal commands, and makes history easy to explore.

It is also a learning project: a practical way to learn React, and to keep practicing agent design (tools, memory, human-in-the-loop).

## Target user
One person (me), on my own computer. I have a Visa Cal card through Bank Beinleumi and I'm comfortable with code. There are no other users, no accounts and no sharing.

## Main use cases
1. **Monthly close:** fetch (scrape) or import this month's statement, see what's uncategorized, run the agent, approve or fix its proposals, and read the month's overview.
2. **Where did the money go?** Spending by category, this month vs previous months, and the biggest merchants.
3. **Find and fix a transaction:** search or filter, change its category or description, and optionally turn the fix into a rule for that merchant.
4. **Manage rules:** see, edit and delete merchant → category rules and categories.
5. **Check exceptions:** large charges, new subscriptions, possible duplicates and foreign charges, with the agent's explanation.
6. *(Future)* **Recurring items:** salary, rent, mortgage, utilities, with expected vs actual.

## Main screens
| Screen | What it shows |
|---|---|
| **Dashboard** | Month picker, total spent (per currency), spending by category, comparison with previous months, count of items awaiting review, exceptions |
| **Transactions** | Table of all transactions with search, filters (month, category, category source, currency, card), and inline edit |
| **Review** | The agent's pending proposals and flags. Approve / change / new category / note / skip, the same choices as `npm run approve` |
| **Rules** | Merchant rules and categories: create, edit, delete |
| **Imports** | Upload a Cal xlsx/csv or trigger a scrape, plus the history of import batches with their total checks |
| **Recurring** *(future)* | Recurring definitions and their expected vs actual occurrences |

Each transaction shows **how it was categorized**: Rule, Cal sector, Agent (approved proposal) or Manual.

## Current scope
- Credit card data from Visa Cal (scraper + xlsx/csv import), as today.
- Everything runs locally: Vite dev server + Express API on loopback + SQLite file.
- The existing CLI, agent, approval policy and evals are preserved and reused.

**Income:** the card statement has no income. "Monthly income" on the dashboard needs manual or recurring entries (Milestone 5) or a future bank-account source. Until then the dashboard shows expenses only.

## Explicitly excluded
- Cloud hosting, Docker, Kubernetes, remote databases
- Multi-user support, authentication, public API
- Mobile apps
- Commercial SaaS concerns (billing, tenancy, analytics)
- Open Banking integration
- Budgets, forecasting and investment tracking (not planned. Could be revisited later.)
