import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RulesFile, Transaction } from "./types";

/** All state lives as plain files under data/, so you can open and edit it by hand. */
export const DATA_DIR = fileURLToPath(new URL("../data", import.meta.url));

const transactionsPath = (month: string) => join(DATA_DIR, "transactions", `${month}.json`);
export const reportPath = (period: string) => join(DATA_DIR, "reports", `${period}.md`);

function writeFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

export function saveTransactions(month: string, transactions: Transaction[]): string {
  const path = transactionsPath(month);
  writeFile(path, JSON.stringify(transactions, null, 2) + "\n");
  return path;
}

export function loadTransactions(month: string): Transaction[] | null {
  const path = transactionsPath(month);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/** Imported statement months for a year, sorted, e.g. ["2026-08", "2026-09"]. */
export function listMonths(year: string): string[] {
  const dir = join(DATA_DIR, "transactions");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => new RegExp(`^${year}-(0[1-9]|1[0-2])\\.json$`).test(f))
    .map((f) => f.slice(0, 7))
    .sort();
}

export function loadRules(): RulesFile {
  return JSON.parse(readFileSync(join(DATA_DIR, "rules.json"), "utf8"));
}

/** `period` is a month (2026-09) or a year (2026). */
export function saveReport(period: string, markdown: string): string {
  const path = reportPath(period);
  writeFile(path, markdown);
  return path;
}
