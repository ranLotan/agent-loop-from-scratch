// Categories and merchant rules in SQLite, as the same RulesFile shape the JSON file had.

import type { DatabaseSync } from "node:sqlite";
import { normalizeMerchant } from "../categorize";
import type { Rule, RulesFile } from "../types";
import { inTransaction } from "./index";

/** The rules.json text: one category and one rule per line, so it stays easy to read and diff by hand. */
export function formatRulesFile(file: RulesFile): string {
  const categories = file.categories.map((c) => `    ${JSON.stringify(c)}`).join(",\n");
  const rules = file.rules
    .map((r) => `    { "merchant": ${JSON.stringify(r.merchant)}, "category": ${JSON.stringify(r.category)} }`)
    .join(",\n");
  return `{\n  "categories": [\n${categories}\n  ],\n  "rules": [\n${rules}\n  ]\n}\n`;
}

/** Categories and rules in the order they were added, like the old rules.json. */
export function loadRules(db: DatabaseSync): RulesFile {
  const categories = db
    .prepare("SELECT name FROM categories ORDER BY id")
    .all()
    .map((row) => row.name as string);
  const rules = db
    .prepare(
      "SELECT r.merchant, c.name AS category FROM merchant_rules r JOIN categories c ON c.id = r.category_id ORDER BY r.id",
    )
    .all()
    .map((row) => ({ merchant: row.merchant as string, category: row.category as string }));
  return { categories, rules };
}

/** Adds categories; names that already exist are skipped. Returns how many were added. */
export function addCategories(db: DatabaseSync, names: string[], origin: "seed" | "owner"): number {
  const add = db.prepare("INSERT INTO categories (name, origin, created_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING");
  const now = new Date().toISOString();
  return inTransaction(db, () => names.reduce((added, name) => added + Number(add.run(name, origin, now).changes), 0));
}

/**
 * Adds rules. A merchant that already has a rule (ignoring case and spaces) is skipped.
 * An unknown category throws: add it with addCategories first. Returns how many were added.
 */
export function addRules(db: DatabaseSync, rules: Rule[], createdFrom: "seed" | "approve" | "manual"): number {
  const categoryId = db.prepare("SELECT id FROM categories WHERE name = ?");
  const add = db.prepare(`
    INSERT INTO merchant_rules (merchant, normalized_merchant, category_id, created_from, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (normalized_merchant) DO NOTHING
  `);
  const now = new Date().toISOString();
  return inTransaction(db, () =>
    rules.reduce((added, r) => {
      const category = categoryId.get(r.category);
      if (!category) throw new Error(`Unknown category "${r.category}" for the rule on "${r.merchant}". Add the category first.`);
      return added + Number(add.run(r.merchant, normalizeMerchant(r.merchant), category.id, createdFrom, now).changes);
    }, 0),
  );
}
