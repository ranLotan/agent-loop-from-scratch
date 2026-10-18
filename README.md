# Cal Expense Agent

Monthly Visa Cal report by category. A learning project for agent design; see [CLAUDE.md](CLAUDE.md).

## Usage

```
npm install
npm run import -- <cal-export.xlsx|.csv> [YYYY-MM]   # month defaults to the statement's billing date
npm run report -- YYYY-MM                           # → data/reports/YYYY-MM.md
npm run annual -- YYYY                              # all imported months of the year → data/reports/YYYY.md
npm test
```

On import, each section's rows are checked against the total printed on the statement. A `✗` means the file was misread.

## Categories

The first match wins: a rule in `data/rules.json`, then Cal's sector (ענף), then uncategorized.

```json
{ "merchant": "אונלי וויפס בע\"מ", "category": "ילדים" }
```

- The merchant name must match exactly. Case and extra spaces are ignored.
- The category must be listed in `categories`.

## Notes

- Foreign-currency sections (חיוב מיידי) stay in their own currency columns and aren't converted.
- `data/transactions/` and `data/reports/` are gitignored.
