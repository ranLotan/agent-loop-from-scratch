-- A row the latest import of its month no longer has: kept (with any edits), but left out of reports.
-- Cleared again if a later import brings the row back.
ALTER TABLE transactions ADD COLUMN missing_since_batch_id INTEGER REFERENCES import_batches (id);
