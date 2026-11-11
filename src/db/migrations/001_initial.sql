-- The first schema. Never edit a migration that has run: add a new numbered file instead.

CREATE TABLE import_batches (
  id            INTEGER PRIMARY KEY,
  source        TEXT NOT NULL CHECK (source IN ('xlsx', 'csv', 'scraper', 'json-migration')),
  file_name     TEXT,
  file_sha256   TEXT,
  billing_month TEXT NOT NULL,
  checks_json   TEXT,
  tx_count      INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);
-- Partial index: the same file can't be imported twice, but scrapes have no file at all.
CREATE UNIQUE INDEX import_batches_file ON import_batches (file_sha256) WHERE file_sha256 IS NOT NULL;

CREATE TABLE transactions (
  id                   TEXT PRIMARY KEY, -- assignIds() in src/normalize.ts
  billing_month        TEXT NOT NULL,
  position             INTEGER NOT NULL, -- order within the statement
  date                 TEXT NOT NULL,
  merchant             TEXT NOT NULL,
  normalized_merchant  TEXT NOT NULL,
  amount               REAL NOT NULL,
  currency             TEXT NOT NULL,
  original_amount      REAL,
  original_currency    TEXT,
  type                 TEXT,
  installment_number   INTEGER,
  installment_total    INTEGER,
  sector               TEXT,
  memo                 TEXT,
  card                 TEXT,
  source               TEXT NOT NULL CHECK (source IN ('xlsx', 'csv', 'scraper')),
  import_batch_id      INTEGER REFERENCES import_batches (id),
  -- Edits made by the owner. A re-import must never overwrite these three.
  category_override    TEXT,
  description_override TEXT,
  override_source      TEXT CHECK (override_source IN ('manual', 'agent')),
  updated_at           TEXT NOT NULL
);
CREATE INDEX transactions_month ON transactions (billing_month, position);
CREATE INDEX transactions_merchant ON transactions (normalized_merchant);

CREATE TABLE categories (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  origin     TEXT NOT NULL CHECK (origin IN ('seed', 'owner')),
  created_at TEXT NOT NULL
);

CREATE TABLE merchant_rules (
  id                  INTEGER PRIMARY KEY,
  merchant            TEXT NOT NULL,
  normalized_merchant TEXT NOT NULL UNIQUE,
  category_id         INTEGER NOT NULL REFERENCES categories (id),
  created_from        TEXT NOT NULL CHECK (created_from IN ('seed', 'approve', 'manual')),
  created_at          TEXT NOT NULL
);

CREATE TABLE agent_runs (
  id            INTEGER PRIMARY KEY,
  billing_month TEXT NOT NULL,
  model         TEXT NOT NULL,
  stopped_by    TEXT, -- not recorded in the older JSON proposal files
  iterations    INTEGER,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  created_at    TEXT NOT NULL
);

CREATE TABLE agent_proposals (
  id                  INTEGER PRIMARY KEY,
  run_id              INTEGER NOT NULL REFERENCES agent_runs (id),
  merchant            TEXT NOT NULL,
  normalized_merchant TEXT NOT NULL,
  category            TEXT NOT NULL,
  confidence          TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  reason              TEXT NOT NULL,
  new_category_idea   TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'changed', 'new_category', 'noted', 'skipped')),
  answer_json         TEXT,
  answered_at         TEXT,
  UNIQUE (run_id, normalized_merchant)
);

CREATE TABLE exception_flags (
  id             INTEGER PRIMARY KEY,
  run_id         INTEGER NOT NULL REFERENCES agent_runs (id),
  transaction_id TEXT NOT NULL REFERENCES transactions (id),
  severity       TEXT NOT NULL CHECK (severity IN ('info', 'warning')),
  explanation    TEXT NOT NULL,
  reasons_json   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'noted')),
  UNIQUE (run_id, transaction_id)
);
