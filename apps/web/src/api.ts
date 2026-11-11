// The only file that calls fetch(). Types come from the core with `import type`,
// so there is one definition and none of the core's code reaches the browser.

import type { Job } from "../../api/src/jobs";
import type { ImportBatch } from "../../../src/db/imports";
import type { CategoryRow, RuleRow } from "../../../src/db/rules";
import type { FetchImport, StatementImport } from "../../../src/imports";
import type { Summary } from "../../../src/report";
import type { CategorizedTransaction } from "../../../src/types";

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

/** A transaction as the search and edit routes return it: categorized, with its billing month. */
export type TransactionRow = CategorizedTransaction & { billingMonth: string };
export type { CategoryRow, RuleRow };

export interface TransactionFilters {
  from?: string;
  to?: string;
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
};
