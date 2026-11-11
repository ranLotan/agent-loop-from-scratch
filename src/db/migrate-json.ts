// One-time move from the JSON files under data/ to SQLite. Safe to repeat; the JSON files are only read.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ProposalsFile } from "../agent/proposals";
import { validateRules } from "../categorize";
import { assignIds } from "../normalize";
import { totalsByCurrency, type Totals } from "../report";
import type { RulesFile, Transaction } from "../types";
import { importBatch } from "./imports";
import { inTransaction } from "./index";
import { saveProposalsFile } from "./proposals";
import { addCategories, addRules } from "./rules";
import { loadTransactions } from "./transactions";

export interface MonthResult {
  month: string;
  rows: number;
  alreadyImported: boolean;
  /** Same row count and same totals per currency in the JSON file and in the database. */
  matches: boolean;
  json: Totals;
  db: Totals;
}

export interface MigrationResult {
  months: MonthResult[];
  categoriesAdded: number;
  rulesAdded: number;
  runsAdded: number;
  proposalsAdded: number;
  flagsAdded: number;
  /** Flags whose transaction couldn't be found after the ids were recalculated. */
  flagsSkipped: number;
}

const MONTH_FILE = /^\d{4}-(0[1-9]|1[0-2])\.json$/;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const jsonFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => MONTH_FILE.test(f)).sort() : []);

function sameTotals(a: Totals, b: Totals): boolean {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((c) => Math.abs((a[c] ?? 0) - (b[c] ?? 0)) < 0.005);
}

/** Copies rules, transactions and agent proposals from `dataDir` into `db`, as one all-or-nothing transaction. */
export function migrateJson(db: DatabaseSync, dataDir: string): MigrationResult {
  return inTransaction(db, () => {
    const result: MigrationResult = {
      months: [],
      categoriesAdded: 0,
      rulesAdded: 0,
      runsAdded: 0,
      proposalsAdded: 0,
      flagsAdded: 0,
      flagsSkipped: 0,
    };

    // 1. Categories and rules. Existing ones are kept: once migrated, the database is the source of truth.
    //    Without a rules.json (a fresh clone), the committed example seeds the categories.
    const rulesPath = [join(dataDir, "rules.json"), join(dataDir, "rules.example.json")].find((p) => existsSync(p));
    if (rulesPath) {
      const rules = readJson<RulesFile>(rulesPath);
      validateRules(rules);
      result.categoriesAdded = addCategories(db, rules.categories, "seed");
      result.rulesAdded = addRules(db, rules.rules, "seed");
    }

    // 2. Transactions, with ids recalculated by the new scheme. Old → new is kept for the flags below.
    const newIdOf = new Map<string, string>(); // "month|old id" → new id
    const txDir = join(dataDir, "transactions");
    for (const file of jsonFiles(txDir)) {
      const month = file.slice(0, 7);
      const text = readFileSync(join(txDir, file), "utf8");
      const old: Transaction[] = JSON.parse(text);
      const rows = assignIds(old.map(({ id: _oldId, ...rest }) => rest), month);
      old.forEach((t, i) => newIdOf.set(`${month}|${t.id}`, rows[i].id));

      const imported = importBatch(db, month, rows, {
        source: "json-migration",
        fileName: `transactions/${file}`,
        fileSha256: sha256(text),
      });
      const alreadyImported = imported.duplicate;

      const stored = loadTransactions(db, month) ?? [];
      const json = totalsByCurrency(old);
      const dbTotals = totalsByCurrency(stored);
      result.months.push({
        month,
        rows: rows.length,
        alreadyImported,
        json,
        db: dbTotals,
        matches: stored.length === rows.length && sameTotals(json, dbTotals),
      });
    }

    // 3. Agent runs, proposals and flags. A run already stored (same month and time) is skipped.
    //    Flags and `reviewed` hold old transaction ids, so they're translated to the new ones first.
    const propDir = join(dataDir, "proposals");
    const findRun = db.prepare("SELECT id FROM agent_runs WHERE billing_month = ? AND created_at = ?");
    const txExists = db.prepare("SELECT 1 FROM transactions WHERE id = ?");
    for (const file of jsonFiles(propDir)) {
      const p = readJson<ProposalsFile>(join(propDir, file));
      if (findRun.get(p.month, p.createdAt)) continue;

      const toNewId = (oldId: string) => newIdOf.get(`${p.month}|${oldId}`);
      const flags = p.flags.flatMap((f) => {
        const id = toNewId(f.transaction_id);
        if (!id || !txExists.get(id)) {
          result.flagsSkipped++;
          return [];
        }
        return [{ ...f, transaction_id: id, candidate: { ...f.candidate, id } }];
      });
      const saved = saveProposalsFile(db, { ...p, flags, reviewed: p.reviewed.map((key) => toNewId(key) ?? key) });
      result.runsAdded++;
      result.proposalsAdded += saved.proposals;
      result.flagsAdded += saved.flags;
    }

    return result;
  });
}
