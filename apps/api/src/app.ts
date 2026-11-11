// The dashboard API: thin routes over the core in ../../src. No business logic lives here.
//
// createApp builds the app without listening, so tests can start it on a random port
// with fake data (dependency injection, same idea as runLoop's ModelClient).

import express, { type ErrorRequestHandler, type RequestHandler, type Response } from "express";
import { extname } from "node:path";
import { categorize, validateRules } from "../../../src/categorize";
import type { ImportBatch } from "../../../src/db/imports";
import { ConflictError, NotFoundError, ValidationError } from "../../../src/db/index";
import type { CategoryRow, RuleRow } from "../../../src/db/rules";
import type { OverrideChange, StoredTransaction, TransactionSearch } from "../../../src/db/transactions";
import type { FetchImport, StatementImport } from "../../../src/imports";
import { isMonth } from "../../../src/normalize";
import { summarize } from "../../../src/report";
import type { CategorizedTransaction, RulesFile, Transaction } from "../../../src/types";
import { createJobs } from "./jobs";

/** Everything the routes use. deps.ts passes the real core functions; tests pass fakes or the real ones. */
export interface Deps {
  listMonths(): string[];
  loadTransactions(month: string): Transaction[] | null;
  loadRules(): RulesFile;
  importStatement(bytes: Buffer, fileName: string, month?: string): StatementImport;
  listImports(): ImportBatch[];
  fetchMonth(month: string): Promise<FetchImport>;
  // M3: editing
  searchTransactions(search: TransactionSearch): StoredTransaction[];
  editTransaction(id: string, change: OverrideChange, opts: { createRule?: boolean }): StoredTransaction;
  listRules(): RuleRow[];
  setRule(merchant: string, category: string): RuleRow;
  updateRule(id: number, category: string): RuleRow;
  deleteRule(id: number): void;
  listCategories(): CategoryRow[];
  addCategory(name: string): CategoryRow;
  renameCategory(id: number, name: string): CategoryRow;
  deleteCategory(id: number): void;
}

const SOURCES = new Set(["manual", "agent", "rule", "cal", "none"]);

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1"]);
const ALLOWED_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const STATEMENT_TYPES = new Set([".xlsx", ".xls", ".csv"]);
const MAX_UPLOAD = "5mb";

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

/**
 * CSRF guard for writes. Any web page can send a POST to 127.0.0.1; the browser marks where it came from
 * in the Origin header. Only the dashboard may write. No Origin at all = not a browser (curl, tests).
 */
const originCheck: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  if (req.method !== "GET" && origin && !ALLOWED_ORIGINS.has(origin)) {
    res.status(403).json({ error: "Forbidden origin" });
    return;
  }
  next();
};

/** Express 5 sends errors thrown in (async) routes here. Four arguments = error handler. */
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // The core's typed errors say what went wrong; body parsers set a 4xx status (413 too large, 400 bad JSON).
  // Anything else is our bug, so it stays a 500 and gets logged.
  const status =
    err instanceof ValidationError ? 400
    : err instanceof NotFoundError ? 404
    : err instanceof ConflictError ? 409
    : typeof err.status === "number" && err.status >= 400 && err.status < 500 ? err.status
    : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: (err as Error).message ?? "Internal error" });
};

/** "2026-01" → "2025-12". The calendar month before, so a gap shows as "no comparison". */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** 400 for a malformed month (same check as the CLI). Returns the month, or null if it already replied. */
function requireMonth(raw: unknown, res: Response): string | null {
  if (typeof raw === "string" && isMonth(raw)) return raw;
  res.status(400).json({ error: `Expected a month like 2026-09, got "${String(raw ?? "")}"` });
  return null;
}

export function createApp(deps: Deps) {
  const jobs = createJobs();

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
  app.use(originCheck);
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

  app.get("/api/imports", (_req, res) => {
    res.json(deps.listImports());
  });

  // The file is the raw request body: POST /api/imports?name=sep.xlsx[&month=2026-09]
  app.post("/api/imports", express.raw({ type: "application/octet-stream", limit: MAX_UPLOAD }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(415).json({ error: "Send the file as the request body, with Content-Type: application/octet-stream" });
      return;
    }
    const name = req.query.name;
    if (typeof name !== "string" || !STATEMENT_TYPES.has(extname(name).toLowerCase())) {
      res.status(400).json({ error: "Add ?name=<file name> ending in .xlsx, .xls or .csv" });
      return;
    }
    let month: string | undefined;
    if (req.query.month !== undefined && req.query.month !== "") {
      const checked = requireMonth(req.query.month, res);
      if (!checked) return;
      month = checked;
    }

    let result: StatementImport;
    try {
      result = deps.importStatement(req.body, name, month);
    } catch (err) {
      // The file itself was the problem (no header row, no billing date, ...): tell the user why.
      res.status(422).json({ error: (err as Error).message });
      return;
    }
    res.status(result.duplicate ? 200 : 201).json(result);
  });

  app.post("/api/scrape", (req, res) => {
    const month = requireMonth(req.body?.month, res);
    if (!month) return;
    const { job, alreadyRunning } = jobs.start("scrape", () => deps.fetchMonth(month));
    if (alreadyRunning) {
      res.status(409).json({ error: "A scrape is already running", jobId: job.id });
      return;
    }
    res.status(202).json({ jobId: job.id });
  });

  app.get("/api/jobs/:id", (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: "No such job" });
      return;
    }
    res.json(job);
  });

  // ---------- M3: search and edit ----------

  // GET /api/transactions?from=&to=&q=&category=&source=&currency=   (every filter optional)
  app.get("/api/transactions", (req, res) => {
    const { from, to, q, category, source, currency } = req.query;
    for (const value of [from, to]) if (value !== undefined && value !== "" && !requireMonth(value, res)) return;
    if (source !== undefined && (typeof source !== "string" || !SOURCES.has(source))) {
      res.status(400).json({ error: "source must be one of manual, agent, rule, cal, none" });
      return;
    }
    const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
    const rules = deps.loadRules();
    validateRules(rules);
    // SQL narrows by month and text; the category is computed by categorize(), so it's filtered after it.
    const rows = categorize(deps.searchTransactions({ from: text(from), to: text(to), q: text(q), currency: text(currency) }), rules);
    res.json(
      rows.filter(
        (t) => (!text(category) || t.category === category) && (!text(source) || (t.categorySource ?? "none") === source),
      ),
    );
  });

  // PATCH /api/transactions/:id  { category?: string|null, description?: string|null, createRule?: boolean }
  app.patch("/api/transactions/:id", (req, res) => {
    const body = req.body ?? {};
    const { category, description, createRule } = body;
    const optionalText = (v: unknown) => v === undefined || v === null || typeof v === "string";
    if (!optionalText(category) || !optionalText(description) || (createRule !== undefined && typeof createRule !== "boolean")) {
      res.status(400).json({ error: "Expected { category?: string | null, description?: string | null, createRule?: boolean }" });
      return;
    }
    const change: OverrideChange = {};
    if (category !== undefined) change.category = category === "" ? null : category;
    if (description !== undefined) change.description = description?.trim() || null; // blank = back to the bank's name
    const saved = deps.editTransaction(req.params.id, change, { createRule });
    const [categorized] = categorize([saved], deps.loadRules());
    res.json({ ...categorized, billingMonth: saved.billingMonth });
  });

  const idOf = (raw: string, res: Response): number | null => {
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) return id;
    res.status(400).json({ error: `Not an id: "${raw}"` });
    return null;
  };
  const requireText = (value: unknown, field: string, res: Response): string | null => {
    if (typeof value === "string" && value.trim()) return value;
    res.status(400).json({ error: `${field} is required` });
    return null;
  };

  app.get("/api/rules", (_req, res) => {
    res.json(deps.listRules());
  });
  app.post("/api/rules", (req, res) => {
    const merchant = requireText(req.body?.merchant, "merchant", res);
    const category = merchant && requireText(req.body?.category, "category", res);
    if (!merchant || !category) return;
    res.status(201).json(deps.setRule(merchant, category));
  });
  app.patch("/api/rules/:id", (req, res) => {
    const id = idOf(req.params.id, res);
    const category = id && requireText(req.body?.category, "category", res);
    if (!id || !category) return;
    res.json(deps.updateRule(id, category));
  });
  app.delete("/api/rules/:id", (req, res) => {
    const id = idOf(req.params.id, res);
    if (!id) return;
    deps.deleteRule(id);
    res.status(204).end();
  });

  app.get("/api/categories", (_req, res) => {
    res.json(deps.listCategories());
  });
  app.post("/api/categories", (req, res) => {
    const name = requireText(req.body?.name, "name", res);
    if (!name) return;
    res.status(201).json(deps.addCategory(name));
  });
  app.patch("/api/categories/:id", (req, res) => {
    const id = idOf(req.params.id, res);
    const name = id && requireText(req.body?.name, "name", res);
    if (!id || !name) return;
    res.json(deps.renameCategory(id, name));
  });
  app.delete("/api/categories/:id", (req, res) => {
    const id = idOf(req.params.id, res);
    if (!id) return;
    deps.deleteCategory(id);
    res.status(204).end();
  });

  // Unknown /api paths get JSON, not Express's default HTML page.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use(errorHandler);
  return app;
}
