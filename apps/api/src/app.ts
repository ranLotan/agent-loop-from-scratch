// The dashboard API: thin routes over the core in ../../src. No business logic lives here.
//
// createApp builds the app without listening, so tests can start it on a random port
// with fake data (dependency injection, same idea as runLoop's ModelClient).

import express, { type ErrorRequestHandler, type RequestHandler, type Response } from "express";
import { categorize, validateRules } from "../../../src/categorize";
import { summarize } from "../../../src/report";
import type { CategorizedTransaction, RulesFile, Transaction } from "../../../src/types";

/** Everything the routes read. server.ts passes the real store functions; tests pass fakes. */
export interface Deps {
  listMonths(): string[];
  loadTransactions(month: string): Transaction[] | null;
  loadRules(): RulesFile;
}

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * DNS-rebinding guard. A malicious page can make the browser send requests to 127.0.0.1,
 * but the Host header still says the attacker's domain, and browser JS can't change it.
 */
const hostCheck: RequestHandler = (req, res, next) => {
  if (!ALLOWED_HOSTS.has(req.hostname)) {
    res.status(403).json({ error: "Forbidden host" });
    return;
  }
  next();
};

/** Express 5 sends errors thrown in (async) routes here. Four arguments = error handler. */
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: (err as Error).message ?? "Internal error" });
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-01" → "2025-12". The calendar month before, so a gap shows as "no comparison". */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** 400 for a malformed month (same check as the CLI). Returns the month, or null if it already replied. */
function requireMonth(raw: string, res: Response): string | null {
  if (MONTH.test(raw)) return raw;
  res.status(400).json({ error: `Expected a month like 2026-09, got "${raw}"` });
  return null;
}

export function createApp(deps: Deps) {
  /** Same steps as `npm run report`: rules are validated, then the core categorizes. null = not imported. */
  function categorizedMonth(month: string): CategorizedTransaction[] | null {
    const transactions = deps.loadTransactions(month);
    if (!transactions) return null;
    const rules = deps.loadRules();
    validateRules(rules);
    return categorize(transactions, rules);
  }

  const app = express();
  app.use(hostCheck);
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/months", (_req, res) => {
    res.json(deps.listMonths());
  });

  app.get("/api/months/:month/summary", (req, res) => {
    const month = requireMonth(req.params.month, res);
    if (!month) return;
    const current = categorizedMonth(month);
    if (!current) {
      res.status(404).json({ error: `No transactions for ${month}` });
      return;
    }
    const prev = previousMonth(month);
    const previous = categorizedMonth(prev);
    res.json({
      month,
      summary: summarize(current),
      previous: previous ? { month: prev, summary: summarize(previous) } : null,
    });
  });

  app.get("/api/months/:month/transactions", (req, res) => {
    const month = requireMonth(req.params.month, res);
    if (!month) return;
    const transactions = categorizedMonth(month);
    if (!transactions) {
      res.status(404).json({ error: `No transactions for ${month}` });
      return;
    }
    res.json(transactions);
  });

  // Unknown /api paths get JSON, not Express's default HTML page.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use(errorHandler);
  return app;
}
