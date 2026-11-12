-- Cal rules: map one of Cal's sectors (ענף) to one of my categories. Applied live by categorize(),
-- after my edit and my merchant rule. A sector with no Cal rule leaves the charge uncategorized.
-- category_id points by id, like merchant_rules, so renaming a category needs no extra update.
CREATE TABLE cal_rules (
  id          INTEGER PRIMARY KEY,
  sector      TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES categories (id),
  created_at  TEXT NOT NULL
);
