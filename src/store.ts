import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProposalsFile } from "./agent/proposals";
import * as importsDb from "./db/imports";
import type { BatchInfo, ImportBatch, ImportResult } from "./db/imports";
import { openDb } from "./db/index";
import { loadProposalsFile, saveProposalsFile } from "./db/proposals";
import * as rulesDb from "./db/rules";
import * as transactionsDb from "./db/transactions";
import type { Rule, RulesFile, Transaction } from "./types";

// The one place the rest of the code reads and writes state. Business data lives in SQLite
// (data/app.db); memory notes, raw scraper output and reports stay plain files under data/.

export const DATA_DIR = fileURLToPath(new URL("../data", import.meta.url));

let database: DatabaseSync | undefined;
/** Opened on first use, so importing this module has no side effects. */
function db(): DatabaseSync {
  return (database ??= openDb());
}
const dbLabel = () => process.env.DB_PATH ?? "data/app.db";

export const reportPath = (period: string) => join(DATA_DIR, "reports", `${period}.md`);

function writeFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

/**
 * Records an import of a month and makes it the month's current rows: new rows added, known rows
 * refreshed (edits kept), rows it no longer has marked missing. The same file twice changes nothing.
 */
export function importTransactions(month: string, transactions: Transaction[], info: BatchInfo): ImportResult {
  return importsDb.importBatch(db(), month, transactions, info);
}

/** Every import, newest first. */
export function listImports(): ImportBatch[] {
  return importsDb.listImportBatches(db());
}

/** Where the business data lives, for messages. */
export const databaseLabel = dbLabel;

export function loadTransactions(month: string): Transaction[] | null {
  return transactionsDb.loadTransactions(db(), month);
}

/** Imported statement months for a year, sorted, e.g. ["2026-08", "2026-09"]. */
export function listMonths(year: string): string[] {
  return listAllMonths().filter((m) => m.startsWith(`${year}-`));
}

/** Every imported statement month, any year, sorted. Used by the dashboard API. */
export function listAllMonths(): string[] {
  return transactionsDb.listMonths(db());
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

export function loadRules(): RulesFile {
  return rulesDb.loadRules(db());
}

/** Adds rules approved by the owner. A merchant that already has a rule is skipped. */
export function addRules(newRules: Rule[]): void {
  rulesDb.addRules(db(), newRules, "approve");
}

/** Adds categories the owner created in `approve`. Existing names are ignored. */
export function addCategories(names: string[]): void {
  rulesDb.addCategories(db(), names, "owner");
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

/** Saves an agent run, or, for a run already saved, which of its items have been reviewed. */
export function saveProposals<T extends ProposalsFile>(_month: string, data: T): string {
  saveProposalsFile(db(), data);
  return `${dbLabel()} (agent run for ${data.month})`;
}

/** The newest agent run for a month, waiting for (or after) human review. */
export function loadProposals<T extends ProposalsFile = ProposalsFile>(month: string): T | null {
  return loadProposalsFile(db(), month) as T | null;
}

/** `period` is a month (2026-09) or a year (2026). */
export function saveReport(period: string, markdown: string): string {
  const path = reportPath(period);
  writeFile(path, markdown);
  return path;
}
