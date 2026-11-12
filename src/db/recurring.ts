// Recurring definitions and their one-month exceptions in SQLite. Months themselves are computed (src/recurring.ts).

import type { DatabaseSync } from "node:sqlite";
import { normalizeMerchant } from "../categorize";
import { isMonth } from "../normalize";
import { splitDefinition, type DefinitionChanges, type RecurringDefinition, type RecurringException } from "../recurring";
import { inTransaction, NotFoundError, ValidationError } from "./index";

/** What a new definition needs; the rest has defaults. */
export type NewDefinition = Pick<RecurringDefinition, "name" | "kind" | "amount" | "startMonth"> &
  Partial<Pick<RecurringDefinition, "currency" | "category" | "dayOfMonth" | "endMonth" | "merchant" | "tolerance" | "confirmMode">>;

/** An edit that applies to every month of the definition (fixing a mistake, or ending it). */
export type DefinitionEdit = DefinitionChanges & Partial<Pick<RecurringDefinition, "startMonth" | "endMonth">>;

function toDefinition(r: Record<string, unknown>): RecurringDefinition {
  return {
    id: Number(r.id),
    name: r.name as string,
    kind: r.kind as RecurringDefinition["kind"],
    amount: r.amount as number,
    currency: r.currency as string,
    category: (r.category as string | null) ?? null,
    dayOfMonth: r.day_of_month === null ? null : Number(r.day_of_month),
    startMonth: r.start_month as string,
    endMonth: r.end_month as string | null,
    merchant: r.merchant as string | null,
    tolerance: r.tolerance as number,
    previousId: r.previous_id === null ? null : Number(r.previous_id),
    confirmMode: r.confirm_mode as RecurringDefinition["confirmMode"],
  };
}

const SELECT = `SELECT d.*, c.name AS category FROM recurring_definitions d LEFT JOIN categories c ON c.id = d.category_id`;

export function listDefinitions(db: DatabaseSync): RecurringDefinition[] {
  return db.prepare(`${SELECT} ORDER BY d.kind DESC, d.name, d.start_month`).all().map(toDefinition);
}

export function getDefinition(db: DatabaseSync, id: number): RecurringDefinition {
  const row = db.prepare(`${SELECT} WHERE d.id = ?`).get(id);
  if (!row) throw new NotFoundError(`No recurring item ${id}`);
  return toDefinition(row);
}

/** Checks a whole definition and returns its row values. Every write goes through here. */
function validRow(db: DatabaseSync, d: Omit<RecurringDefinition, "id">) {
  const name = d.name?.replace(/\s+/g, " ").trim();
  if (!name) throw new ValidationError("The name is empty");
  if (d.kind !== "income" && d.kind !== "expense") throw new ValidationError("kind must be income or expense");
  if (!(typeof d.amount === "number" && d.amount > 0)) throw new ValidationError("The amount must be a positive number");
  if (!/^[A-Z]{3}$/.test(d.currency)) throw new ValidationError(`Not a currency code: "${d.currency}"`);
  if (!isMonth(d.startMonth)) throw new ValidationError(`Expected a start month like 2026-09, got "${d.startMonth}"`);
  if (d.endMonth !== null && (!isMonth(d.endMonth) || d.endMonth < d.startMonth)) {
    throw new ValidationError(`The end month must be a month on or after ${d.startMonth}`);
  }
  if (d.dayOfMonth !== null && !(Number.isInteger(d.dayOfMonth) && d.dayOfMonth >= 1 && d.dayOfMonth <= 31)) {
    throw new ValidationError("The day must be 1–31");
  }
  if (!(d.tolerance >= 0 && d.tolerance <= 1)) throw new ValidationError("The tolerance must be between 0 and 1 (0.1 = 10%)");
  let categoryId: number | null = null;
  if (d.category) {
    const row = db.prepare("SELECT id FROM categories WHERE name = ?").get(d.category);
    if (!row) throw new ValidationError(`Unknown category "${d.category}"`);
    categoryId = Number(row.id);
  }
  const merchant = d.merchant?.replace(/\s+/g, " ").trim() || null;
  if (d.confirmMode !== "auto" && d.confirmMode !== "confirm") throw new ValidationError("confirmMode must be auto or confirm");
  if (d.confirmMode === "confirm") {
    // A card-paid item is confirmed by its card charge; and the ledger's Net is in shekels.
    if (merchant) throw new ValidationError("Paid by card: its card charge is the confirmation, so it can't be in confirm mode");
    if (d.currency !== "ILS") throw new ValidationError("Confirm mode is for shekel (ILS) items only");
  }
  return {
    name,
    kind: d.kind,
    amount: d.amount,
    currency: d.currency,
    category_id: categoryId,
    day_of_month: d.dayOfMonth,
    start_month: d.startMonth,
    end_month: d.endMonth,
    merchant,
    normalized_merchant: merchant && normalizeMerchant(merchant),
    tolerance: d.tolerance,
    confirm_mode: d.confirmMode,
    previous_id: d.previousId,
  };
}

function insert(db: DatabaseSync, d: Omit<RecurringDefinition, "id">): RecurringDefinition {
  const row = validRow(db, d);
  const id = db
    .prepare(`
      INSERT INTO recurring_definitions (name, kind, amount, currency, category_id, day_of_month, start_month, end_month,
        merchant, normalized_merchant, tolerance, confirm_mode, previous_id, created_at)
      VALUES (:name, :kind, :amount, :currency, :category_id, :day_of_month, :start_month, :end_month,
        :merchant, :normalized_merchant, :tolerance, :confirm_mode, :previous_id, :created_at)
    `)
    .run({ ...row, created_at: new Date().toISOString() }).lastInsertRowid;
  return getDefinition(db, Number(id));
}

export function createDefinition(db: DatabaseSync, input: NewDefinition): RecurringDefinition {
  return insert(db, {
    currency: "ILS",
    category: null,
    dayOfMonth: null,
    endMonth: null,
    merchant: null,
    tolerance: 0.1,
    confirmMode: "auto",
    ...input,
    previousId: null,
  });
}

/** Changes the definition for EVERY month it covers (a correction, or setting an end month to stop it). */
export function updateDefinition(db: DatabaseSync, id: number, edit: DefinitionEdit): RecurringDefinition {
  const current = getDefinition(db, id);
  // previous_id never changes on an edit (and node:sqlite rejects named parameters the SQL doesn't use).
  const { previous_id: _unchanged, ...row } = validRow(db, { ...current, ...edit, previousId: current.previousId });
  db.prepare(`
    UPDATE recurring_definitions SET name = :name, kind = :kind, amount = :amount, currency = :currency,
      category_id = :category_id, day_of_month = :day_of_month, start_month = :start_month, end_month = :end_month,
      merchant = :merchant, normalized_merchant = :normalized_merchant, tolerance = :tolerance, confirm_mode = :confirm_mode
    WHERE id = :id
  `).run({ ...row, id });
  return getDefinition(db, id);
}

/**
 * "From this month on": ends the definition the month before and starts a continuation with the changes.
 * Exceptions already set for later months move to the continuation, so they still apply. All or nothing.
 */
export function changeFrom(
  db: DatabaseSync,
  id: number,
  fromMonth: string,
  changes: DefinitionChanges,
): { ended: RecurringDefinition; created: RecurringDefinition } {
  if (!isMonth(fromMonth)) throw new ValidationError(`Expected a month like 2026-09, got "${fromMonth}"`);
  return inTransaction(db, () => {
    let split;
    try {
      split = splitDefinition(getDefinition(db, id), fromMonth, changes);
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      throw new ValidationError((err as Error).message);
    }
    const ended = updateDefinition(db, id, { endMonth: split.ended.endMonth });
    const created = insert(db, split.next);
    db.prepare("UPDATE recurring_exceptions SET definition_id = ? WHERE definition_id = ? AND month >= ?").run(created.id, id, fromMonth);
    return { ended, created };
  });
}

/** Deletes a definition and its exceptions. A continuation that pointed to it simply loses that link. */
export function deleteDefinition(db: DatabaseSync, id: number): void {
  inTransaction(db, () => {
    getDefinition(db, id);
    db.prepare("UPDATE recurring_definitions SET previous_id = NULL WHERE previous_id = ?").run(id);
    db.prepare("DELETE FROM recurring_definitions WHERE id = ?").run(id); // exceptions: ON DELETE CASCADE
  });
}

export function listExceptions(db: DatabaseSync): RecurringException[] {
  return db
    .prepare("SELECT * FROM recurring_exceptions ORDER BY month")
    .all()
    .map((r) => ({
      definitionId: Number(r.definition_id),
      month: r.month as string,
      amount: r.amount as number | null,
      skipped: Boolean(r.skipped),
      note: r.note as string | null,
      confirmedAt: r.confirmed_at as string | null,
    }));
}

export interface MonthChange {
  /** This month's amount; null = back to the definition's. */
  amount?: number | null;
  skipped?: boolean;
  note?: string | null;
}

/** Changes one month only. Setting everything back to normal removes the exception. */
export function setMonth(db: DatabaseSync, id: number, month: string, change: MonthChange): RecurringException | null {
  const def = getDefinition(db, id);
  if (!isMonth(month)) throw new ValidationError(`Expected a month like 2026-09, got "${month}"`);
  if (month < def.startMonth || (def.endMonth !== null && month > def.endMonth)) {
    throw new ValidationError(`${def.name} doesn't run in ${month}`);
  }
  if (change.amount != null && !(change.amount > 0)) throw new ValidationError("The amount must be a positive number");

  const current = listExceptions(db).find((e) => e.definitionId === id && e.month === month);
  const next = {
    amount: change.amount !== undefined ? change.amount : (current?.amount ?? null),
    skipped: change.skipped ?? current?.skipped ?? false,
    note: (change.note !== undefined ? change.note : (current?.note ?? null))?.trim() || null,
  };
  // A confirmation is "this amount, confirmed": without an amount (or when skipped) there's nothing confirmed.
  const confirmedAt = next.amount !== null && !next.skipped ? (current?.confirmedAt ?? null) : null;
  if (next.amount === null && !next.skipped && next.note === null) {
    db.prepare("DELETE FROM recurring_exceptions WHERE definition_id = ? AND month = ?").run(id, month);
    return null;
  }
  db.prepare(`
    INSERT INTO recurring_exceptions (definition_id, month, amount, skipped, note, confirmed_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (definition_id, month) DO UPDATE SET
      amount = excluded.amount, skipped = excluded.skipped, note = excluded.note, confirmed_at = excluded.confirmed_at
  `).run(id, month, next.amount, next.skipped ? 1 : 0, next.note, confirmedAt);
  return { definitionId: id, month, ...next, confirmedAt };
}

/**
 * Confirms a confirm-mode month at its actual amount (always this month only: changing the usual amount
 * is "from this month on"). Next month suggests this amount. Confirming again overwrites it.
 */
export function confirmMonth(db: DatabaseSync, id: number, month: string, amount: number): RecurringException {
  return inTransaction(db, () => {
    const def = getDefinition(db, id);
    if (def.confirmMode !== "confirm" || def.merchant) throw new ValidationError(`${def.name} isn't in confirm mode: it counts automatically`);
    if (!(typeof amount === "number" && amount > 0)) throw new ValidationError("The amount must be a positive number");
    setMonth(db, id, month, { amount, skipped: false }); // validates the month and keeps the note
    const confirmedAt = new Date().toISOString();
    db.prepare("UPDATE recurring_exceptions SET confirmed_at = ? WHERE definition_id = ? AND month = ?").run(confirmedAt, id, month);
    return listExceptions(db).find((e) => e.definitionId === id && e.month === month)!;
  });
}

/** Takes a confirmation back: the month waits for confirmation again, with nothing counted. */
export function unconfirmMonth(db: DatabaseSync, id: number, month: string): RecurringException | null {
  return inTransaction(db, () => {
    getDefinition(db, id);
    db.prepare("UPDATE recurring_exceptions SET confirmed_at = NULL WHERE definition_id = ? AND month = ?").run(id, month);
    return setMonth(db, id, month, { amount: null }); // back to the suggestion; a note alone keeps the row
  });
}
