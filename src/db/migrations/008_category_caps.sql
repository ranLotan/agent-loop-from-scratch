-- Monthly caps per category (M7): how much I allow myself to spend in a category each month, in shekels.
-- NULL = no cap. One cap for every month (no history). Spent vs cap is computed in src/caps.ts, never stored.
-- The by-hand bucket can't have one: that's checked in src/db/rules.ts (setCaps), like other policy.
ALTER TABLE categories ADD COLUMN monthly_cap REAL CHECK (monthly_cap IS NULL OR monthly_cap > 0);
