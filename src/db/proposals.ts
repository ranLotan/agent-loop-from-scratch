// Agent runs in SQLite, read and written as the ProposalsFile shape that run.ts and approve.ts use.

import type { DatabaseSync } from "node:sqlite";
import type { ProposalsFile } from "../agent/proposals";
import type { CandidateReason } from "../candidates";
import { normalizeMerchant } from "../categorize";
import { inTransaction } from "./index";

/**
 * Stores a new agent run. If the run is already stored (same month and createdAt), only records which
 * proposals and flags are now in `reviewed`. That's how approve.ts saves after every answer.
 * Returns how many proposals and flags were inserted.
 */
export function saveProposalsFile(db: DatabaseSync, file: ProposalsFile): { proposals: number; flags: number } {
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

    const runId = db.prepare("INSERT INTO agent_runs (billing_month, model, created_at) VALUES (?, ?, ?)").run(file.month, file.model, file.createdAt)
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
