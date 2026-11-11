// The only file that calls fetch(). Types come from the core with `import type`,
// so there is one definition and none of the core's code reaches the browser.

import type { Job } from "../../api/src/jobs";
import type { ImportBatch } from "../../../src/db/imports";
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
  return res.json();
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
};
