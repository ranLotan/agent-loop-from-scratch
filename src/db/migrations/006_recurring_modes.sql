-- M6: recurring confirm modes, and one-off manual entries.

-- "auto" counts every month (salary); "confirm" counts a month only after you confirm its amount (gas bill).
-- Existing definitions become "auto", so nothing changes for them. A single-column CHECK works with ADD COLUMN.
-- "confirm" only for items outside the card (no merchant): checked in src/db/recurring.ts, because a
-- cross-column CHECK can't be added with ALTER TABLE.
ALTER TABLE recurring_definitions ADD COLUMN confirm_mode TEXT NOT NULL DEFAULT 'auto' CHECK (confirm_mode IN ('auto', 'confirm'));

-- Set when a confirm-mode month is confirmed; its actual amount is the exception's `amount`.
ALTER TABLE recurring_exceptions ADD COLUMN confirmed_at TEXT;

-- One-time income or expenses outside the card (a gift, a repair paid by bank transfer). Its own table, not a
-- flag on recurring_definitions: no schedule, merchant, tolerance, chain or exceptions, so real CHECKs fit.
-- Counted as soon as it's created. ILS only (the ledger's Net is in shekels).
CREATE TABLE manual_entries (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  kind        TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  amount      REAL NOT NULL CHECK (amount > 0),
  currency    TEXT NOT NULL DEFAULT 'ILS' CHECK (currency = 'ILS'),
  category_id INTEGER REFERENCES categories (id),
  note        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX manual_entries_date ON manual_entries (date);
