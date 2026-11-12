-- Recurring income and expenses (M5). Months are COMPUTED from definitions (src/recurring.ts);
-- only exceptions for a single month are stored. "Change from this month on" ends a definition
-- and starts a new one (previous_id), so earlier months keep their history.

CREATE TABLE recurring_definitions (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  amount              REAL NOT NULL CHECK (amount > 0),
  currency            TEXT NOT NULL DEFAULT 'ILS',
  category_id         INTEGER REFERENCES categories (id),
  day_of_month        INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
  start_month         TEXT NOT NULL,
  end_month           TEXT, -- inclusive; NULL = still running
  -- Set when it's paid by card: the charge from this merchant (within the tolerance) is the actual payment.
  merchant            TEXT,
  normalized_merchant TEXT,
  tolerance           REAL NOT NULL DEFAULT 0.1 CHECK (tolerance >= 0 AND tolerance <= 1),
  previous_id         INTEGER REFERENCES recurring_definitions (id), -- the definition this one continues
  created_at          TEXT NOT NULL,
  CHECK (end_month IS NULL OR end_month >= start_month)
);

CREATE TABLE recurring_exceptions (
  definition_id INTEGER NOT NULL REFERENCES recurring_definitions (id) ON DELETE CASCADE,
  month         TEXT NOT NULL,
  amount        REAL CHECK (amount IS NULL OR amount > 0), -- this month only, instead of the definition's
  skipped       INTEGER NOT NULL DEFAULT 0,                 -- e.g. no rent this month
  note          TEXT,
  PRIMARY KEY (definition_id, month)
);
