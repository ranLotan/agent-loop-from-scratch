// Categories and merchant rules in SQLite, as the same RulesFile shape the JSON file had.

import type { DatabaseSync } from "node:sqlite";
import { normalizeMerchant } from "../categorize";
import type { CalRule, Rule, RulesFile } from "../types";
import { ConflictError, inTransaction, NotFoundError, ValidationError } from "./index";

/** The rules.json text: one category and one rule per line, so it stays easy to read and diff by hand. */
export function formatRulesFile(file: RulesFile): string {
  const categories = file.categories.map((c) => `    ${JSON.stringify(c)}`).join(",\n");
  const rules = file.rules
    .map((r) => `    { "merchant": ${JSON.stringify(r.merchant)}, "category": ${JSON.stringify(r.category)} }`)
    .join(",\n");
  const calRules = (file.calRules ?? [])
    .map((r) => `    { "sector": ${JSON.stringify(r.sector)}, "category": ${JSON.stringify(r.category)} }`)
    .join(",\n");
  return `{\n  "categories": [\n${categories}\n  ],\n  "rules": [\n${rules}\n  ],\n  "calRules": [\n${calRules}\n  ]\n}\n`;
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
  const calRules = db
    .prepare("SELECT r.sector, c.name AS category FROM cal_rules r JOIN categories c ON c.id = r.category_id ORDER BY r.id")
    .all()
    .map((row) => ({ sector: row.sector as string, category: row.category as string }));
  return { categories, rules, calRules };
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

// ---------- Editing rules and categories (M3) ----------

export interface RuleRow {
  id: number;
  merchant: string;
  category: string;
  createdFrom: "seed" | "approve" | "manual";
}

export interface CategoryRow {
  id: number;
  name: string;
  origin: "seed" | "owner";
  /** Built in (the by-hand bucket): can't be renamed or deleted. */
  system: boolean;
  /** How many rules, Cal rules and transaction edits use it; a category in use can't be deleted. */
  rules: number;
  calRules: number;
  edits: number;
}

export function listRules(db: DatabaseSync): RuleRow[] {
  return db
    .prepare(`
      SELECT r.id, r.merchant, c.name AS category, r.created_from
      FROM merchant_rules r JOIN categories c ON c.id = r.category_id
      ORDER BY r.merchant
    `)
    .all()
    .map((row) => ({
      id: Number(row.id),
      merchant: row.merchant as string,
      category: row.category as string,
      createdFrom: row.created_from as RuleRow["createdFrom"],
    }));
}

function categoryIdOf(db: DatabaseSync, name: string): number {
  const row = db.prepare("SELECT id FROM categories WHERE name = ?").get(name);
  if (!row) throw new ValidationError(`Unknown category "${name}"`);
  return Number(row.id);
}

/** Creates the merchant's rule, or changes its category if it has one (matching ignores case and spaces). */
export function setRule(db: DatabaseSync, merchant: string, category: string, createdFrom: RuleRow["createdFrom"]): RuleRow {
  const name = merchant.replace(/\s+/g, " ").trim();
  if (!name) throw new ValidationError("The merchant name is empty");
  const categoryId = categoryIdOf(db, category);
  db.prepare(`
    INSERT INTO merchant_rules (merchant, normalized_merchant, category_id, created_from, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (normalized_merchant) DO UPDATE SET category_id = excluded.category_id
  `).run(name, normalizeMerchant(name), categoryId, createdFrom, new Date().toISOString());
  return listRules(db).find((r) => normalizeMerchant(r.merchant) === normalizeMerchant(name))!;
}

export function updateRule(db: DatabaseSync, id: number, category: string): RuleRow {
  const categoryId = categoryIdOf(db, category);
  const changed = db.prepare("UPDATE merchant_rules SET category_id = ? WHERE id = ?").run(categoryId, id).changes;
  if (!changed) throw new NotFoundError(`No rule ${id}`);
  return listRules(db).find((r) => r.id === id)!;
}

export function deleteRule(db: DatabaseSync, id: number): void {
  if (!db.prepare("DELETE FROM merchant_rules WHERE id = ?").run(id).changes) throw new NotFoundError(`No rule ${id}`);
}

export function listCategories(db: DatabaseSync): CategoryRow[] {
  return db
    .prepare(`
      SELECT c.id, c.name, c.origin, c.system,
        (SELECT COUNT(*) FROM merchant_rules r WHERE r.category_id = c.id) AS rules,
        (SELECT COUNT(*) FROM cal_rules k WHERE k.category_id = c.id) AS cal_rules,
        (SELECT COUNT(*) FROM transactions t WHERE t.category_override = c.name) AS edits
      FROM categories c ORDER BY c.id
    `)
    .all()
    .map((row) => ({
      id: Number(row.id),
      name: row.name as string,
      origin: row.origin as CategoryRow["origin"],
      system: Boolean(row.system),
      rules: Number(row.rules),
      calRules: Number(row.cal_rules),
      edits: Number(row.edits),
    }));
}

function requireCategoryName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (!trimmed) throw new ValidationError("The category name is empty");
  return trimmed;
}

export function addCategory(db: DatabaseSync, name: string): CategoryRow {
  const trimmed = requireCategoryName(name);
  if (db.prepare("SELECT 1 FROM categories WHERE name = ?").get(trimmed)) throw new ConflictError(`"${trimmed}" already exists`);
  addCategories(db, [trimmed], "owner");
  return listCategories(db).find((c) => c.name === trimmed)!;
}

/**
 * Renames a category everywhere it's used. Rules point to it by id, so they follow on their own;
 * transaction edits store the name as text, so they're updated here, in the same transaction.
 */
export function renameCategory(db: DatabaseSync, id: number, newName: string): CategoryRow {
  const trimmed = requireCategoryName(newName);
  return inTransaction(db, () => {
    const current = db.prepare("SELECT name, system FROM categories WHERE id = ?").get(id);
    if (!current) throw new NotFoundError(`No category ${id}`);
    if (current.system) throw new ConflictError(`"${current.name}" is built in and can't be renamed`);
    if (current.name !== trimmed && db.prepare("SELECT 1 FROM categories WHERE name = ?").get(trimmed)) {
      throw new ConflictError(`"${trimmed}" already exists`);
    }
    db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(trimmed, id);
    db.prepare("UPDATE transactions SET category_override = ? WHERE category_override = ?").run(trimmed, current.name);
    return listCategories(db).find((c) => c.id === id)!;
  });
}

/** Deletes an unused category. One still used by rules or edits is refused, so nothing is left pointing at nothing. */
export function deleteCategory(db: DatabaseSync, id: number): void {
  const category = listCategories(db).find((c) => c.id === id);
  if (!category) throw new NotFoundError(`No category ${id}`);
  if (category.system) throw new ConflictError(`"${category.name}" is built in and can't be deleted`);
  if (category.rules || category.calRules || category.edits) {
    throw new ConflictError(
      `"${category.name}" is used by ${category.rules} rule(s), ${category.calRules} Cal rule(s) and ${category.edits} ` +
        "edited transaction(s). Change those first.",
    );
  }
  db.prepare("DELETE FROM categories WHERE id = ?").run(id);
}

// ---------- Cal rules: Cal sector → my category ----------

export interface CalRuleRow {
  sector: string;
  /** null = no Cal rule yet: charges in this sector stay uncategorized. */
  category: string | null;
  /** How many billed and pending charges carry this sector. */
  count: number;
}

/**
 * Every sector Cal has put on my charges, plus any Cal rule whose sector no charge has (anymore),
 * so the page can offer the unmapped ones without me typing them in.
 */
export function listCalRules(db: DatabaseSync): CalRuleRow[] {
  return db
    .prepare(`
      WITH seen AS (
        SELECT sector FROM transactions WHERE sector IS NOT NULL AND sector <> ''
        UNION ALL
        SELECT sector FROM pending_charges WHERE sector IS NOT NULL AND sector <> ''
      ),
      sectors AS (
        SELECT sector, COUNT(*) AS n FROM seen GROUP BY sector
        UNION ALL
        SELECT sector, 0 FROM cal_rules WHERE sector NOT IN (SELECT sector FROM seen)
      )
      SELECT s.sector, s.n, c.name AS category
      FROM sectors s
      LEFT JOIN cal_rules r ON r.sector = s.sector
      LEFT JOIN categories c ON c.id = r.category_id
      ORDER BY s.sector
    `)
    .all()
    .map((row) => ({ sector: row.sector as string, category: (row.category as string | null) ?? null, count: Number(row.n) }));
}

/** Maps a sector to a category (creates or changes its Cal rule); null removes the Cal rule. */
export function setCalRule(db: DatabaseSync, sector: string, category: string | null): CalRule | null {
  const name = sector.trim();
  if (!name) throw new ValidationError("The sector is empty");
  if (category === null) {
    db.prepare("DELETE FROM cal_rules WHERE sector = ?").run(name);
    return null;
  }
  const categoryId = categoryIdOf(db, category);
  db.prepare(`
    INSERT INTO cal_rules (sector, category_id, created_at) VALUES (?, ?, ?)
    ON CONFLICT (sector) DO UPDATE SET category_id = excluded.category_id
  `).run(name, categoryId, new Date().toISOString());
  return { sector: name, category };
}
