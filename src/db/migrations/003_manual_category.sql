-- The built-in "to categorize by hand" bucket (MANUAL_CATEGORY in src/categorize.ts).
-- A rule to it keeps a merchant away from the agent; each charge then waits for the owner's own edit.
-- `system` = 1: it can't be renamed or deleted, and the agent never proposes it.
ALTER TABLE categories ADD COLUMN system INTEGER NOT NULL DEFAULT 0;
INSERT INTO categories (name, origin, created_at, system) VALUES ('לסיווג ידני', 'seed', datetime('now'), 1)
ON CONFLICT (name) DO UPDATE SET system = 1;
