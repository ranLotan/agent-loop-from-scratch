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
6. **Recurring items (M5):** salary, rent, mortgage, utilities, with expected vs actual.
7. **Did I spend more than I earned? (M6):** one ledger per purchase month (card + manual money), Net, expenses by category, and a 6-month trend. Recurring items count automatically or after I confirm the month's amount, plus one-time entries.

## Main screens
| Screen | What it shows |
|---|---|
| **Dashboard** | By purchase month (M6): a status strip (card data · review · manual, with a "Next step"), Income − Expenses = **Net**, items awaiting confirmation, expenses by category (pie + legend table, a slice opens Transactions), 6-month income vs expenses trend |
| **Card transactions** | By purchase month (or by Cal statement): table of all card transactions, plus charges not billed yet, with search, filters (month, category, category source, currency, card), and inline edit |
| **Review** | The agent's pending proposals and flags. Approve / change / new category / note / skip, the same choices as `npm run approve` |
| **Rules** | Merchant rules and categories: create, edit, delete |
| **Imports** | Upload a Cal xlsx/csv or trigger a scrape, plus the history of import batches with their total checks |
| **Manual transactions** | For the month: recurring items (confirm, or edit this month only / from now on) and one-time entries. Recurring definitions are managed on a sub-page |

Each transaction shows **how it was categorized**: Rule, Cal sector, Agent (approved proposal) or Manual.

## Current scope
- Credit card data from Visa Cal (scraper + xlsx/csv import), as today.
- Everything runs locally: Vite dev server + Express API on loopback + SQLite file.
- The existing CLI, agent, approval policy and evals are preserved and reused.

**Income:** the card statement has no income. It comes only from manual transactions: recurring items (M5) and one-time entries (M6). Bank statements stay manual (no automatic bank import). Net is in shekels only.

## Explicitly excluded
- Cloud hosting, Docker, Kubernetes, remote databases
- Multi-user support, authentication, public API
- Mobile apps
- Commercial SaaS concerns (billing, tenancy, analytics)
- Open Banking integration
- Budgets, forecasting and investment tracking (not planned. Could be revisited later.)
