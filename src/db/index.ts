import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
const DEFAULT_PATH = fileURLToPath(new URL("../../data/app.db", import.meta.url));

/** Runs `work` as one all-or-nothing database transaction. Inside another one, it joins it. */
export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  if (db.isTransaction) return work(); // SQLite can't nest BEGIN; the outer transaction decides
  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Applies every numbered .sql file that hasn't run yet, in order. Safe to call on every start. */
export function runMigrations(db: DatabaseSync): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(db.prepare("SELECT name FROM schema_version").all().map((row) => row.name));
  for (const name of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    inTransaction(db, () => {
      db.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
      db.prepare("INSERT INTO schema_version (name, applied_at) VALUES (?, ?)").run(name, new Date().toISOString());
    });
  }
}

/** Opens the database and brings its schema up to date. `path` can be ":memory:" for tests. */
export function openDb(path = process.env.DB_PATH ?? DEFAULT_PATH): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON"); // SQLite leaves these unenforced unless asked
  db.exec("PRAGMA journal_mode = WAL"); // readers don't block the writer: CLI and API can overlap
  db.exec("PRAGMA busy_timeout = 5000"); // wait for a lock instead of failing at once
  runMigrations(db);
  return db;
}
