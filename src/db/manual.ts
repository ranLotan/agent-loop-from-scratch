// One-time income and expenses outside the card (M6): a gift, a repair paid by bank transfer.
// Counted in the ledger as soon as they exist; no confirmation step.

import type { DatabaseSync } from "node:sqlite";
import { inTransaction, NotFoundError, ValidationError } from "./index";

export interface ManualEntry {
  id: number;
  /** YYYY-MM-DD; its month is the ledger month it counts in. */
  date: string;
  name: string;
  kind: "income" | "expense";
  /** In shekels (the ledger's Net is ILS only). Always positive: `kind` says which way it goes. */
  amount: number;
  currency: "ILS";
  category: string | null;
  note: string | null;
}

export type NewManualEntry = Pick<ManualEntry, "date" | "name" | "kind" | "amount"> & Partial<Pick<ManualEntry, "category" | "note">>;

const SELECT = `SELECT e.*, c.name AS category FROM manual_entries e LEFT JOIN categories c ON c.id = e.category_id`;

function toEntry(r: Record<string, unknown>): ManualEntry {
  return {
    id: Number(r.id),
    date: r.date as string,
    name: r.name as string,
    kind: r.kind as ManualEntry["kind"],
    amount: r.amount as number,
    currency: "ILS",
    category: (r.category as string | null) ?? null,
    note: (r.note as string | null) ?? null,
  };
}

/** A real calendar date, not just the right shape ("2026-02-30" is refused). */
function isDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Checks a whole entry and returns its row values. Every write goes through here. */
function validRow(db: DatabaseSync, e: NewManualEntry & { currency?: unknown }) {
  if (!isDate(e.date)) throw new ValidationError(`Expected a date like 2026-09-14, got "${String(e.date)}"`);
  const name = typeof e.name === "string" ? e.name.replace(/\s+/g, " ").trim() : "";
  if (!name) throw new ValidationError("The name is empty");
  if (e.kind !== "income" && e.kind !== "expense") throw new ValidationError("kind must be income or expense");
  if (!(typeof e.amount === "number" && Number.isFinite(e.amount) && e.amount > 0)) throw new ValidationError("The amount must be a positive number");
  if (e.currency !== undefined && e.currency !== "ILS") throw new ValidationError("One-time entries are in shekels (ILS) only");
  let categoryId: number | null = null;
  if (e.category) {
    const row = db.prepare("SELECT id FROM categories WHERE name = ?").get(e.category);
    if (!row) throw new ValidationError(`Unknown category "${e.category}"`);
    categoryId = Number(row.id);
  }
  const note = typeof e.note === "string" ? e.note.trim() || null : null;
  return { date: e.date, name, kind: e.kind, amount: e.amount, category_id: categoryId, note };
}

/** Entries oldest first; only those dated in `month` when it's given. */
export function listManualEntries(db: DatabaseSync, month?: string): ManualEntry[] {
  const rows = month
    ? db.prepare(`${SELECT} WHERE substr(e.date, 1, 7) = ? ORDER BY e.date, e.id`).all(month)
    : db.prepare(`${SELECT} ORDER BY e.date, e.id`).all();
  return rows.map(toEntry);
}

export function getManualEntry(db: DatabaseSync, id: number): ManualEntry {
  const row = db.prepare(`${SELECT} WHERE e.id = ?`).get(id);
  if (!row) throw new NotFoundError(`No one-time entry ${id}`);
  return toEntry(row);
}

export function createManualEntry(db: DatabaseSync, input: NewManualEntry): ManualEntry {
  const row = validRow(db, input);
  const id = db
    .prepare(`INSERT INTO manual_entries (date, name, kind, amount, category_id, note, created_at)
              VALUES (:date, :name, :kind, :amount, :category_id, :note, :created_at)`)
    .run({ ...row, created_at: new Date().toISOString() }).lastInsertRowid;
  return getManualEntry(db, Number(id));
}

/** Edits an entry directly: a one-off has no "this month only" vs "from now on". */
export function updateManualEntry(db: DatabaseSync, id: number, edit: Partial<NewManualEntry>): ManualEntry {
  return inTransaction(db, () => {
    const row = validRow(db, { ...getManualEntry(db, id), ...edit });
    db.prepare(`UPDATE manual_entries SET date = :date, name = :name, kind = :kind, amount = :amount,
                category_id = :category_id, note = :note WHERE id = :id`).run({ ...row, id });
    return getManualEntry(db, id);
  });
}

export function deleteManualEntry(db: DatabaseSync, id: number): void {
  getManualEntry(db, id);
  db.prepare("DELETE FROM manual_entries WHERE id = ?").run(id);
}
