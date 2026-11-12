-- M6: the ledger month (src/ledger.ts) is the month a charge counts in, next to the billing month.
-- Set by upsertTransactions() on every import. Rows imported before this migration are filled in by
-- backfillLedgerMonths() (src/db/transactions.ts) when the store opens, so the rule lives in one place (TypeScript).
ALTER TABLE transactions ADD COLUMN ledger_month TEXT;
CREATE INDEX transactions_ledger_month ON transactions (ledger_month);

-- Cal charges approved but not billed yet. They have no stable id (see milestone-6.md, R1), so they
-- are never matched to billed rows: every scrape deletes them all and inserts the new list.
CREATE TABLE pending_charges (
  id                  INTEGER PRIMARY KEY,
  import_batch_id     INTEGER NOT NULL REFERENCES import_batches (id), -- the scrape that saw them
  ledger_month        TEXT NOT NULL,
  date                TEXT NOT NULL,
  merchant            TEXT NOT NULL,
  normalized_merchant TEXT NOT NULL,
  amount              REAL NOT NULL,
  currency            TEXT NOT NULL,
  original_amount     REAL,
  original_currency   TEXT,
  sector              TEXT,
  card                TEXT
);
CREATE INDEX pending_charges_ledger_month ON pending_charges (ledger_month);
