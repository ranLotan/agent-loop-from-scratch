// Recurring income and expenses (M5): pure code, no database. Like calendar recurrence:
// a definition describes every month; exceptions change one month; nothing is stored ahead.

import { normalizeMerchant } from "./categorize";
import { round2 } from "./normalize";
import type { Totals } from "./report";
import type { Transaction } from "./types";

export interface RecurringDefinition {
  id: number;
  name: string;
  kind: "income" | "expense";
  amount: number;
  currency: string;
  category: string | null;
  /** The usual day of the month, for display. Clamped to the month's length (31 → 28 in February). */
  dayOfMonth: number | null;
  startMonth: string;
  /** Inclusive; null = still running. */
  endMonth: string | null;
  /** Paid by card: a charge from this merchant within the tolerance is the actual payment. null = outside the card. */
  merchant: string | null;
  /** 0.1 = the charge may differ from the expected amount by up to 10%. */
  tolerance: number;
  /** The definition this one continues ("from this month on" splits a definition in two). */
  previousId: number | null;
}

/** One month that differs from its definition. */
export interface RecurringException {
  definitionId: number;
  month: string;
  amount: number | null;
  skipped: boolean;
  note: string | null;
}

export type OccurrenceStatus =
  | "skipped" //   you said: not this month
  | "paid" //      by card: the matching charge was found on this month's statement
  | "not_seen" //  by card, but no matching charge on the statement
  | "expected"; // outside the card: counted at its expected amount

export interface Occurrence {
  definitionId: number;
  name: string;
  kind: RecurringDefinition["kind"];
  category: string | null;
  month: string;
  /** YYYY-MM-DD, from dayOfMonth; null without one. */
  expectedDate: string | null;
  /** This month's amount: the exception's if set, else the definition's. */
  expectedAmount: number;
  currency: string;
  /** This month was changed or skipped on its own. */
  changed: boolean;
  note: string | null;
  paidBy: "card" | "outside";
  status: OccurrenceStatus;
  /** The card charge that paid it, when status is "paid". */
  transaction: { id: string; date: string; amount: number } | null;
}

/** "2026-01" shifted by n months: shiftMonth("2026-01", -1) = "2025-12". */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function isActive(def: RecurringDefinition, month: string): boolean {
  return def.startMonth <= month && (def.endMonth === null || month <= def.endMonth);
}

function expectedDate(day: number | null, month: string): string | null {
  if (day === null) return null;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/**
 * The month's recurring items. `transactions` is that month's card statement (empty if not imported):
 * a card-paid item is "paid" when a charge from its merchant, in its currency, is within the tolerance
 * of the expected amount. Each charge pays at most one item, and the closest amount wins.
 */
export function occurrencesFor(
  month: string,
  definitions: RecurringDefinition[],
  exceptions: RecurringException[],
  transactions: Transaction[],
): Occurrence[] {
  const used = new Set<string>();
  const statementImported = transactions.length > 0;

  return definitions
    .filter((def) => isActive(def, month))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((def) => {
      const exception = exceptions.find((e) => e.definitionId === def.id && e.month === month);
      const expectedAmount = exception?.amount ?? def.amount;
      const base = {
        definitionId: def.id,
        name: def.name,
        kind: def.kind,
        category: def.category,
        month,
        expectedDate: expectedDate(def.dayOfMonth, month),
        expectedAmount,
        currency: def.currency,
        changed: exception !== undefined && (exception.amount !== null || exception.skipped),
        note: exception?.note ?? null,
        paidBy: def.merchant ? ("card" as const) : ("outside" as const),
        transaction: null,
      };
      if (exception?.skipped) return { ...base, status: "skipped" as const };
      if (!def.merchant) return { ...base, status: "expected" as const };

      const merchant = normalizeMerchant(def.merchant);
      const match = transactions
        .filter(
          (t) =>
            !used.has(t.id) &&
            normalizeMerchant(t.merchant) === merchant &&
            t.currency === def.currency &&
            Math.abs(t.amount - expectedAmount) <= def.tolerance * expectedAmount,
        )
        .sort((a, b) => Math.abs(a.amount - expectedAmount) - Math.abs(b.amount - expectedAmount))[0];
      if (match) {
        used.add(match.id);
        return { ...base, status: "paid" as const, transaction: { id: match.id, date: match.date, amount: match.amount } };
      }
      // Without a statement for the month there's nothing to look in yet.
      return { ...base, status: statementImported ? ("not_seen" as const) : ("expected" as const) };
    });
}

export interface RecurringSummary {
  /** Income outside the card (salary...), at the amounts expected this month. */
  income: Totals;
  /** Recurring expenses outside the card (rent, mortgage...). Card-paid ones are already in card spending. */
  outsideExpenses: Totals;
  paidByCard: number;
  notSeen: number;
}

/** Card-paid items are never added here: their charge is already part of the card statement's totals. */
export function summarizeRecurring(occurrences: Occurrence[]): RecurringSummary {
  const income: Totals = {};
  const outsideExpenses: Totals = {};
  for (const o of occurrences) {
    if (o.status !== "expected" || o.paidBy !== "outside") continue;
    const target = o.kind === "income" ? income : outsideExpenses;
    target[o.currency] = round2((target[o.currency] ?? 0) + o.expectedAmount);
  }
  return {
    income,
    outsideExpenses,
    paidByCard: occurrences.filter((o) => o.status === "paid").length,
    notSeen: occurrences.filter((o) => o.status === "not_seen").length,
  };
}

export type DefinitionChanges = Partial<Omit<RecurringDefinition, "id" | "startMonth" | "endMonth" | "previousId">>;

/**
 * "From this month on": the old definition ends the month before `fromMonth`, and a new one starts at
 * `fromMonth` with the changes. Earlier months are untouched. Returns what to save; it doesn't save.
 */
export function splitDefinition(
  def: RecurringDefinition,
  fromMonth: string,
  changes: DefinitionChanges,
): { ended: RecurringDefinition; next: Omit<RecurringDefinition, "id"> } {
  if (fromMonth <= def.startMonth) throw new Error(`${fromMonth} isn't after the start (${def.startMonth}): edit the definition instead`);
  if (def.endMonth !== null && fromMonth > def.endMonth) throw new Error(`${def.name} already ended in ${def.endMonth}`);
  const { id: _id, ...rest } = def;
  return {
    ended: { ...def, endMonth: shiftMonth(fromMonth, -1) },
    next: { ...rest, ...changes, startMonth: fromMonth, endMonth: def.endMonth, previousId: def.id },
  };
}
