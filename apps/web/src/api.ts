// The only file that calls fetch(). Types come from the core with `import type`,
// so there is one definition and none of the core's code reaches the browser.

import type { Job } from "../../api/src/jobs";
import type { AppliedAnswer, FlagAnswer } from "../../../src/agent/apply";
import type { Answer } from "../../../src/agent/review";
import type { AgentRunResult } from "../../../src/agent/service";
import type { FlagRow, ProposalCharge, ProposalRow, ProposalWithCharges, RunRow } from "../../../src/db/proposals";
import type { ImportBatch } from "../../../src/db/imports";
import type { Occurrence, RecurringDefinition, RecurringSummary } from "../../../src/recurring";
import type { CategoryRow, RuleRow } from "../../../src/db/rules";
import type { FetchImport, StatementImport } from "../../../src/imports";
import type { Summary } from "../../../src/report";
import type { CategorizedTransaction } from "../../../src/types";
import type { ManualEntry } from "../../../src/db/manual";
import type { LedgerEntry, LedgerSummary, PieSlice } from "../../../src/ledger";
import type { MonthLedger, MonthStatus, TrendPoint } from "../../../src/ledger-service";

export type { FetchImport, ImportBatch, Job, StatementImport };

export interface MonthSummary {
  month: string;
  summary: Summary;
  previous: { month: string; summary: Summary } | null;
}

/** A scrape job; `result` is set once it's done. */
export type ScrapeJob = Job & { result?: FetchImport };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json(); // 204 No Content (a delete) has no body
}

/** A JSON request body. Content-Type: application/json also makes it a non-simple request (CSRF). */
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** A transaction as the search and edit routes return it: categorized, with its billing and ledger months. */
export type TransactionRow = CategorizedTransaction & { billingMonth: string; ledgerMonth: string };
/** A charge not billed yet (M6). Read-only: the next scrape replaces it. */
export type PendingRow = CategorizedTransaction & { ledgerMonth: string; pending: true; scrapedAt: string };
export type { CategoryRow, RuleRow };

/** Which month the month filter means: the purchase month (ledger) or the Cal statement it was billed on. */
export type MonthBy = "ledger" | "billing";

export interface TransactionFilters {
  from?: string;
  to?: string;
  by?: MonthBy;
  q?: string;
  category?: string;
  source?: string;
}

export interface TransactionEdit {
  /** null or "" = remove your category edit (the rule or Cal applies again). */
  category?: string | null;
  /** null or "" = back to the bank's merchant name. */
  description?: string | null;
  /** Make the category a rule for the merchant instead of an edit on this one charge. */
  createRule?: boolean;
}

/** Only the filters that are set, so the URL stays clean (?q=aroma rather than ?q=aroma&category=&source=). */
function queryOf(filters: TransactionFilters): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return query.size ? `?${query}` : "";
}

export const api = {
  months: () => request<string[]>("/months"),
  summary: (month: string) => request<MonthSummary>(`/months/${month}/summary`),
  transactions: (month: string) => request<CategorizedTransaction[]>(`/months/${month}/transactions`),

  imports: () => request<ImportBatch[]>("/imports"),
  /** Sends the file itself as the body. `month` is optional: the statement's own billing month otherwise. */
  uploadStatement: (file: File, month?: string) => {
    const query = new URLSearchParams({ name: file.name });
    if (month) query.set("month", month);
    return request<StatementImport>(`/imports?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
  },

  startScrape: (month: string) =>
    request<{ jobId: string }>("/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month }),
    }),
  job: (id: string) => request<ScrapeJob>(`/jobs/${id}`),

  searchTransactions: (filters: TransactionFilters) => request<TransactionRow[]>(`/transactions${queryOf(filters)}`),
  pending: (month?: string) => request<PendingRow[]>(`/pending${month ? `?month=${month}` : ""}`),
  editTransaction: (id: string, edit: TransactionEdit) =>
    request<TransactionRow>(`/transactions/${encodeURIComponent(id)}`, json("PATCH", edit)),

  rules: () => request<RuleRow[]>("/rules"),
  addRule: (merchant: string, category: string) => request<RuleRow>("/rules", json("POST", { merchant, category })),
  updateRule: (id: number, category: string) => request<RuleRow>(`/rules/${id}`, json("PATCH", { category })),
  deleteRule: (id: number) => request<void>(`/rules/${id}`, json("DELETE")),

  categories: () => request<CategoryRow[]>("/categories"),
  addCategory: (name: string) => request<CategoryRow>("/categories", json("POST", { name })),
  renameCategory: (id: number, name: string) => request<CategoryRow>(`/categories/${id}`, json("PATCH", { name })),
  deleteCategory: (id: number) => request<void>(`/categories/${id}`, json("DELETE")),

  startAgentRun: (month: string) => request<{ jobId: string }>("/agent-runs", json("POST", { month })),
  review: (month: string) => request<Review>(`/review?month=${month}`),
  answerProposal: (id: number, answer: Answer) => request<AppliedAnswer>(`/proposals/${id}/answer`, json("POST", answer)),
  answerFlag: (id: number, answer: FlagAnswer) => request<FlagRow>(`/flags/${id}/answer`, json("POST", answer)),

  recurring: () => request<RecurringDefinition[]>("/recurring"),
  recurringMonth: (month: string) => request<RecurringMonth>(`/months/${month}/recurring`),
  createRecurring: (input: RecurringInput) => request<RecurringDefinition>("/recurring", json("POST", input)),
  /** Every month of the item. { endMonth } stops it. */
  updateRecurring: (id: number, edit: Partial<RecurringInput> & { endMonth?: string | null }) =>
    request<RecurringDefinition>(`/recurring/${id}`, json("PATCH", edit)),
  /** From `month` on; earlier months keep the old values. */
  changeRecurringFrom: (id: number, month: string, changes: Partial<RecurringInput>) =>
    request<{ ended: RecurringDefinition; created: RecurringDefinition }>(`/recurring/${id}/change-from`, json("POST", { month, ...changes })),
  deleteRecurring: (id: number) => request<void>(`/recurring/${id}`, json("DELETE")),
  /** One month only. { amount: null, skipped: false, note: null } = back to normal. */
  setRecurringMonth: (id: number, month: string, change: { amount?: number | null; skipped?: boolean; note?: string | null }) =>
    request<unknown>(`/recurring/${id}/months/${month}`, json("PUT", change)),

  // M6: the ledger. These return finished numbers; the pages only display them.
  ledger: (month: string) => request<MonthLedger>(`/months/${month}/ledger`),
  trend: (end: string, n = 6) => request<TrendPoint[]>(`/ledger/trend?end=${end}&n=${n}`),
  status: (month: string) => request<MonthStatus>(`/months/${month}/status`),
  confirmMonth: (id: number, month: string, amount: number) =>
    request<unknown>(`/recurring/${id}/occurrences/${month}/confirm`, json("POST", { amount })),
  unconfirmMonth: (id: number, month: string) => request<unknown>(`/recurring/${id}/occurrences/${month}/confirm`, json("DELETE")),
  manualEntries: (month: string) => request<ManualEntry[]>(`/manual-entries?month=${month}`),
  createManualEntry: (input: ManualEntryInput) => request<ManualEntry>("/manual-entries", json("POST", input)),
  updateManualEntry: (id: number, edit: Partial<ManualEntryInput>) => request<ManualEntry>(`/manual-entries/${id}`, json("PATCH", edit)),
  deleteManualEntry: (id: number) => request<void>(`/manual-entries/${id}`, json("DELETE")),
};

export type { Occurrence, RecurringDefinition, RecurringSummary };
export interface RecurringMonth {
  occurrences: Occurrence[];
  summary: RecurringSummary;
}
/** What the forms send; "" for an optional text field means "none". */
export type RecurringInput = Pick<RecurringDefinition, "name" | "kind" | "amount"> & {
  startMonth?: string;
  category?: string | null;
  merchant?: string | null;
  dayOfMonth?: number | null;
  confirmMode?: RecurringDefinition["confirmMode"];
};

export type { LedgerEntry, LedgerSummary, ManualEntry, MonthLedger, MonthStatus, PieSlice, TrendPoint };
/** What the one-time form sends. */
export type ManualEntryInput = Pick<ManualEntry, "date" | "name" | "kind" | "amount"> & { category?: string | null; note?: string | null };

/** A month's newest agent run, its proposals and flags. */
export interface Review {
  run: RunRow | null;
  proposals: ProposalWithCharges[];
  flags: FlagRow[];
}
export type { AgentRunResult, Answer, AppliedAnswer, FlagAnswer, FlagRow, ProposalCharge, ProposalRow, ProposalWithCharges, RunRow };
