import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProposalsFile } from "./agent/proposals";
import type { Answer } from "./agent/review";
import * as importsDb from "./db/imports";
import type { BatchInfo, ImportBatch, ImportResult } from "./db/imports";
import { inTransaction, NotFoundError, openDb, ValidationError } from "./db/index";
import * as proposalsDb from "./db/proposals";
import { loadProposalsFile, saveProposalsFile, type RunMeta } from "./db/proposals";
import * as rulesDb from "./db/rules";
import * as transactionsDb from "./db/transactions";
import type { OverrideChange, StoredTransaction, TransactionSearch } from "./db/transactions";
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

// ---------- Editing from the dashboard (M3) ----------

export type { CategoryRow, RuleRow } from "./db/rules";
export type { OverrideChange, StoredTransaction, TransactionSearch } from "./db/transactions";
export { ConflictError, NotFoundError, ValidationError } from "./db/index";

export const searchTransactions = (search?: TransactionSearch) => transactionsDb.searchTransactions(db(), search);
export const getTransaction = (id: string) => transactionsDb.getTransaction(db(), id);

/**
 * Edits one transaction. With `createRule`, the category becomes a rule for the merchant instead:
 * every charge of that merchant follows it, so this one's own category edit is cleared rather than duplicated.
 * The description edit is kept either way. All or nothing.
 */
export function editTransaction(id: string, change: OverrideChange, opts: { createRule?: boolean } = {}): StoredTransaction {
  return inTransaction(db(), () => {
    const current = transactionsDb.getTransaction(db(), id);
    if (!current) throw new NotFoundError(`No transaction ${id}`);
    if (!opts.createRule) return transactionsDb.setOverride(db(), id, change);

    if (!change.category) throw new ValidationError("Pick a category to make a rule");
    rulesDb.setRule(db(), current.merchant, change.category, "manual");
    return transactionsDb.setOverride(db(), id, { ...change, category: null });
  });
}

export const listRules = () => rulesDb.listRules(db());
export const setRule = (merchant: string, category: string) => rulesDb.setRule(db(), merchant, category, "manual");
export const updateRule = (id: number, category: string) => rulesDb.updateRule(db(), id, category);
export const deleteRule = (id: number) => rulesDb.deleteRule(db(), id);

export const listCategories = () => rulesDb.listCategories(db());
export const addCategory = (name: string) => rulesDb.addCategory(db(), name);
export const renameCategory = (id: number, name: string) => rulesDb.renameCategory(db(), id, name);
export const deleteCategory = (id: number) => rulesDb.deleteCategory(db(), id);

/** Long-term memory: human-approved notes the agent reads on every run. Gitignored. */
// MEMORY_PATH lets tests use a temp file instead of your real notes.
export const memoryPath = () => process.env.MEMORY_PATH ?? join(DATA_DIR, "memory.md");

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
export function saveProposals<T extends ProposalsFile>(_month: string, data: T, meta?: RunMeta): string {
  saveProposalsFile(db(), data, meta);
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

// ---------- Review, one item at a time (M4) ----------

export type { FlagRow, ProposalRow, ProposalStatus, RunRow } from "./db/proposals";

export const latestRun = (month: string) => proposalsDb.latestRun(db(), month);
export const listProposals = (month: string) => proposalsDb.listProposals(db(), month);
export const listFlags = (month: string) => proposalsDb.listFlags(db(), month);
export const getProposal = (id: number) => proposalsDb.getProposal(db(), id);
export const getFlag = (id: number) => proposalsDb.getFlag(db(), id);
export const recordProposalAnswer = (id: number, status: Exclude<proposalsDb.ProposalStatus, "pending">, answer: Answer) =>
  proposalsDb.recordProposalAnswer(db(), id, status, answer);
export const recordFlagAnswer = (id: number, status: "ok" | "noted") => proposalsDb.recordFlagAnswer(db(), id, status);
export const setMonthCategory = (month: string, merchant: string, category: string) =>
  transactionsDb.setMonthCategory(db(), month, merchant, category);

/** Runs several store writes as one all-or-nothing change (applying one review answer). */
export const asOneChange = <T>(work: () => T): T => inTransaction(db(), work);
