// The only file that calls fetch(). Types come from the core with `import type`,
// so there is one definition and none of the core's code reaches the browser.

import type { Summary } from "../../../src/report";
import type { CategorizedTransaction } from "../../../src/types";

export interface MonthSummary {
  month: string;
  summary: Summary;
  previous: { month: string; summary: Summary } | null;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  months: () => get<string[]>("/months"),
  summary: (month: string) => get<MonthSummary>(`/months/${month}/summary`),
  transactions: (month: string) => get<CategorizedTransaction[]>(`/months/${month}/transactions`),
};
