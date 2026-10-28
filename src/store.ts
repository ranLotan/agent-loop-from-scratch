import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Rule, RulesFile, Transaction } from "./types";

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

/** All transactions from months before `month` (this year and last), oldest first. */
export function loadHistory(month: string): Transaction[] {
  const year = Number(month.slice(0, 4));
  return [...listMonths(String(year - 1)), ...listMonths(String(year))]
    .filter((m) => m < month)
    .flatMap((m) => loadTransactions(m) ?? []);
}

/** The untouched scraper output, for debugging the mapping. Gitignored. */
export const rawPath = (name: string) => join(DATA_DIR, "raw", name);

export function saveRaw(name: string, data: unknown): string {
  const path = rawPath(name);
  writeFile(path, JSON.stringify(data, null, 2) + "\n");
  return path;
}

const rulesPath = () => join(DATA_DIR, "rules.json");

export function loadRules(): RulesFile {
  return JSON.parse(readFileSync(rulesPath(), "utf8"));
}

/** Appends rules, keeping one rule per line so the file stays easy to read and diff by hand. */
export function addRules(newRules: Rule[]): void {
  const file = loadRules();
  file.rules.push(...newRules);
  const categories = file.categories.map((c) => `    ${JSON.stringify(c)}`).join(",\n");
  const rules = file.rules
    .map((r) => `    { "merchant": ${JSON.stringify(r.merchant)}, "category": ${JSON.stringify(r.category)} }`)
    .join(",\n");
  writeFile(rulesPath(), `{\n  "categories": [\n${categories}\n  ],\n  "rules": [\n${rules}\n  ]\n}\n`);
}

/** Long-term memory: human-approved notes the agent reads on every run. Gitignored. */
export const memoryPath = () => join(DATA_DIR, "memory.md");

const MEMORY_HEADER = "# Agent memory\n\nNotes from past reviews, one per line. Edit or delete freely.\n\n";

/** The note lines ("- ...") of data/memory.md, oldest first. */
export function loadMemory(): string[] {
  if (!existsSync(memoryPath())) return [];
  return readFileSync(memoryPath(), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("- "));
}

export function appendMemory(notes: string[]): void {
  if (!notes.length) return;
  const current = existsSync(memoryPath()) ? readFileSync(memoryPath(), "utf8") : MEMORY_HEADER;
  writeFile(memoryPath(), current + notes.join("\n") + "\n");
}

/** What the agent proposed for a month, waiting for (or after) human review. Gitignored. */
export const proposalsPath = (month: string) => join(DATA_DIR, "proposals", `${month}.json`);

export function saveProposals<T>(month: string, data: T): string {
  writeFile(proposalsPath(month), JSON.stringify(data, null, 2) + "\n");
  return proposalsPath(month);
}

export function loadProposals<T>(month: string): T | null {
  return existsSync(proposalsPath(month)) ? JSON.parse(readFileSync(proposalsPath(month), "utf8")) : null;
}

/** `period` is a month (2026-09) or a year (2026). */
export function saveReport(period: string, markdown: string): string {
  const path = reportPath(period);
  writeFile(path, markdown);
  return path;
}
