// Agent runs in SQLite, read and written as the ProposalsFile shape that run.ts and approve.ts use.

import type { DatabaseSync } from "node:sqlite";
import type { ProposalsFile } from "../agent/proposals";
import type { CandidateReason } from "../candidates";
import { normalizeMerchant } from "../categorize";
import type { Answer } from "../agent/review";
import { ConflictError, inTransaction, NotFoundError } from "./index";

/**
 * Stores a new agent run. If the run is already stored (same month and createdAt), only records which
 * proposals and flags are now in `reviewed`. That's how approve.ts saves after every answer.
 * Returns how many proposals and flags were inserted.
 */
export interface RunMeta {
  stoppedBy: string;
  iterations: number;
  inputTokens: number;
  outputTokens: number;
}

export function saveProposalsFile(db: DatabaseSync, file: ProposalsFile, meta?: RunMeta): { proposals: number; flags: number } {
  return inTransaction(db, () => {
    const now = new Date().toISOString();
    const reviewed = new Set(file.reviewed);
    const existing = db.prepare("SELECT id FROM agent_runs WHERE billing_month = ? AND created_at = ?").get(file.month, file.createdAt);

    if (existing) {
      const markProposal = db.prepare(
        "UPDATE agent_proposals SET status = 'answered', answered_at = ? WHERE run_id = ? AND merchant = ? AND status = 'pending'",
      );
      const markFlag = db.prepare("UPDATE exception_flags SET status = 'ok' WHERE run_id = ? AND transaction_id = ? AND status = 'pending'");
      for (const key of reviewed) {
        markProposal.run(now, existing.id, key);
        markFlag.run(existing.id, key);
      }
      return { proposals: 0, flags: 0 };
    }

    const runId = db
      .prepare(`
        INSERT INTO agent_runs (billing_month, model, created_at, stopped_by, iterations, input_tokens, output_tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(file.month, file.model, file.createdAt, meta?.stoppedBy ?? null, meta?.iterations ?? null, meta?.inputTokens ?? null, meta?.outputTokens ?? null)
      .lastInsertRowid;
    const addProposal = db.prepare(`
      INSERT INTO agent_proposals (run_id, merchant, normalized_merchant, category, confidence, reason, new_category_idea, status, answered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (run_id, normalized_merchant) DO NOTHING
    `);
    const addFlag = db.prepare(`
      INSERT INTO exception_flags (run_id, transaction_id, severity, explanation, reasons_json, status)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (run_id, transaction_id) DO NOTHING
    `);

    let proposals = 0;
    for (const p of file.proposals) {
      const answered = reviewed.has(p.merchant);
      proposals += Number(
        addProposal.run(runId, p.merchant, normalizeMerchant(p.merchant), p.category, p.confidence, p.reason, p.new_category_idea ?? null,
          answered ? "answered" : "pending", answered ? now : null).changes,
      );
    }
    let flags = 0;
    for (const f of file.flags) {
      const status = reviewed.has(f.transaction_id) ? "ok" : "pending";
      flags += Number(addFlag.run(runId, f.transaction_id, f.severity, f.explanation, JSON.stringify(f.candidate.reasons), status).changes);
    }
    return { proposals, flags };
  });
}

/** The newest agent run for a month, as a ProposalsFile, or null if the agent never ran on it. */
export function loadProposalsFile(db: DatabaseSync, month: string): ProposalsFile | null {
  const run = db
    .prepare("SELECT id, model, created_at FROM agent_runs WHERE billing_month = ? ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(month);
  if (!run) return null;

  const proposalRows = db.prepare("SELECT * FROM agent_proposals WHERE run_id = ? ORDER BY id").all(run.id);
  const flagRows = db
    .prepare(`
      SELECT f.*, t.date, t.merchant, t.amount, t.currency
      FROM exception_flags f JOIN transactions t ON t.id = f.transaction_id
      WHERE f.run_id = ? ORDER BY f.id
    `)
    .all(run.id);

  return {
    month,
    createdAt: run.created_at as string,
    model: run.model as string,
    proposals: proposalRows.map((r) => ({
      merchant: r.merchant as string,
      category: r.category as string,
      confidence: r.confidence as "high" | "medium" | "low",
      reason: r.reason as string,
      new_category_idea: r.new_category_idea as string | null,
    })),
    flags: flagRows.map((r) => ({
      transaction_id: r.transaction_id as string,
      severity: r.severity as "info" | "warning",
      explanation: r.explanation as string,
      candidate: {
        id: r.transaction_id as string,
        date: r.date as string,
        merchant: r.merchant as string,
        amount: r.amount as number,
        currency: r.currency as string,
        reasons: JSON.parse(r.reasons_json as string) as CandidateReason[],
      },
    })),
    reviewed: [
      ...proposalRows.filter((r) => r.status !== "pending").map((r) => r.merchant as string),
      ...flagRows.filter((r) => r.status !== "pending").map((r) => r.transaction_id as string),
    ],
  };
}

// ---------- Review, one item at a time (M4) ----------

export type ProposalStatus = "pending" | "approved" | "changed" | "new_category" | "noted" | "skipped" | "answered";

export interface ProposalRow {
  id: number;
  runId: number;
  month: string;
  merchant: string;
  category: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  newCategoryIdea: string | null;
  status: ProposalStatus;
  /** Exactly what the owner answered; null for pending items and for answers migrated from JSON. */
  answer: Answer | null;
  answeredAt: string | null;
}

export interface FlagRow {
  id: number;
  runId: number;
  month: string;
  transactionId: string;
  date: string;
  merchant: string;
  amount: number;
  currency: string;
  severity: "info" | "warning";
  explanation: string;
  reasons: CandidateReason[];
  status: "pending" | "ok" | "noted";
}

export interface RunRow {
  id: number;
  month: string;
  model: string;
  createdAt: string;
  stoppedBy: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

const toProposal = (r: Record<string, unknown>): ProposalRow => ({
  id: Number(r.id),
  runId: Number(r.run_id),
  month: r.billing_month as string,
  merchant: r.merchant as string,
  category: r.category as string,
  confidence: r.confidence as ProposalRow["confidence"],
  reason: r.reason as string,
  newCategoryIdea: r.new_category_idea as string | null,
  status: r.status as ProposalStatus,
  answer: r.answer_json ? JSON.parse(r.answer_json as string) : null,
  answeredAt: r.answered_at as string | null,
});

const toFlag = (r: Record<string, unknown>): FlagRow => ({
  id: Number(r.id),
  runId: Number(r.run_id),
  month: r.billing_month as string,
  transactionId: r.transaction_id as string,
  date: r.date as string,
  merchant: r.merchant as string,
  amount: r.amount as number,
  currency: r.currency as string,
  severity: r.severity as FlagRow["severity"],
  explanation: r.explanation as string,
  reasons: JSON.parse(r.reasons_json as string),
  status: r.status as FlagRow["status"],
});

/** The newest agent run for a month, or null. */
export function latestRun(db: DatabaseSync, month: string): RunRow | null {
  const r = db.prepare("SELECT * FROM agent_runs WHERE billing_month = ? ORDER BY created_at DESC, id DESC LIMIT 1").get(month);
  return r
    ? {
        id: Number(r.id),
        month: r.billing_month as string,
        model: r.model as string,
        createdAt: r.created_at as string,
        stoppedBy: r.stopped_by as string | null,
        inputTokens: r.input_tokens as number | null,
        outputTokens: r.output_tokens as number | null,
      }
    : null;
}

const PROPOSALS_SQL = `
  SELECT p.*, r.billing_month FROM agent_proposals p JOIN agent_runs r ON r.id = p.run_id`;
const FLAGS_SQL = `
  SELECT f.*, r.billing_month, t.date, t.merchant, t.amount, t.currency
  FROM exception_flags f JOIN agent_runs r ON r.id = f.run_id JOIN transactions t ON t.id = f.transaction_id`;

/** The proposals of a month's newest run, in the order the agent made them. */
export function listProposals(db: DatabaseSync, month: string): ProposalRow[] {
  const run = latestRun(db, month);
  return run ? db.prepare(`${PROPOSALS_SQL} WHERE p.run_id = ? ORDER BY p.id`).all(run.id).map(toProposal) : [];
}

/** One charge behind a proposal, so the owner can see what was actually bought before deciding. */
export interface ProposalCharge {
  id: string;
  date: string;
  amount: number;
  currency: string;
  /** Set for a foreign purchase or an installment plan (what was charged differs from the purchase). */
  originalAmount: number | null;
  originalCurrency: string | null;
  installments: { number: number; total: number } | null;
  memo: string | null;
}

export type ProposalWithCharges = ProposalRow & { charges: ProposalCharge[] };

/**
 * listProposals plus each merchant's charges on the reviewed statement (the run's billing month), oldest first.
 * The agent proposes once per merchant; these are the rows that one answer will categorize.
 */
export function listProposalsWithCharges(db: DatabaseSync, month: string): ProposalWithCharges[] {
  const charges = db.prepare(`
    SELECT id, date, amount, currency, original_amount, original_currency, installment_number, installment_total, memo
    FROM transactions
    WHERE billing_month = ? AND normalized_merchant = ? AND missing_since_batch_id IS NULL
    ORDER BY date, position
  `);
  return listProposals(db, month).map((p) => ({
    ...p,
    charges: charges.all(p.month, normalizeMerchant(p.merchant)).map((r) => ({
      id: r.id as string,
      date: r.date as string,
      amount: r.amount as number,
      currency: r.currency as string,
      originalAmount: r.original_amount as number | null,
      originalCurrency: r.original_currency as string | null,
      installments: r.installment_number === null ? null : { number: Number(r.installment_number), total: Number(r.installment_total) },
      memo: r.memo as string | null,
    })),
  }));
}

export function listFlags(db: DatabaseSync, month: string): FlagRow[] {
  const run = latestRun(db, month);
  return run ? db.prepare(`${FLAGS_SQL} WHERE f.run_id = ? ORDER BY f.id`).all(run.id).map(toFlag) : [];
}

export function getProposal(db: DatabaseSync, id: number): ProposalRow {
  const r = db.prepare(`${PROPOSALS_SQL} WHERE p.id = ?`).get(id);
  if (!r) throw new NotFoundError(`No proposal ${id}`);
  return toProposal(r);
}

export function getFlag(db: DatabaseSync, id: number): FlagRow {
  const r = db.prepare(`${FLAGS_SQL} WHERE f.id = ?`).get(id);
  if (!r) throw new NotFoundError(`No flag ${id}`);
  return toFlag(r);
}

/** Records the owner's answer. Answering twice is refused: the first answer already wrote its rules and notes. */
export function recordProposalAnswer(db: DatabaseSync, id: number, status: Exclude<ProposalStatus, "pending">, answer: Answer): void {
  const changed = db
    .prepare("UPDATE agent_proposals SET status = ?, answer_json = ?, answered_at = ? WHERE id = ? AND status = 'pending'")
    .run(status, JSON.stringify(answer), new Date().toISOString(), id).changes;
  if (!changed) throw new ConflictError(`Proposal ${id} was already answered`);
}

export function recordFlagAnswer(db: DatabaseSync, id: number, status: "ok" | "noted"): void {
  const changed = db.prepare("UPDATE exception_flags SET status = ? WHERE id = ? AND status = 'pending'").run(status, id).changes;
  if (!changed) throw new ConflictError(`Flag ${id} was already answered`);
}
