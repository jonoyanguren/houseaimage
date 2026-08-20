import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * The database.
 *
 * SQLite, built into Node, so this costs no dependency and no server — which
 * is the whole reason it is the default rather than an opt-in. Everything that
 * used to live in a `Map` on `globalThis` now survives a restart, and that was
 * not a nicety: a stale model id left in memory took down three attempts in a
 * row, and every reload lost the reel someone had just paid for.
 *
 * ⚠️ `node:sqlite` is still marked experimental, which is why it lives behind
 * the same seam as everything else here. If it moves, one module moves.
 *
 * ⚠️ **This file holds credentials** — the provider key and the OAuth refresh
 * token — for exactly the reason `.env.local` does: a server that renders at
 * three in the morning cannot ask anyone to type them again. Protect it like
 * you would protect `.env.local`. It is in `.gitignore`.
 *
 * For several instances behind a load balancer this is the wrong store, and
 * the answer is Postgres in this same seam, not a shared file.
 */

const globalForDb = globalThis as unknown as { __houseaimageDb?: DatabaseSync };

/** Overridable so tests get their own file and a deployment can use a volume. */
function databasePath(): string {
  const configured = process.env.DATABASE_PATH?.trim();
  return configured || path.join(process.cwd(), ".data", "houseaimage.db");
}

function migrate(db: DatabaseSync): void {
  // One statement per concept, all idempotent: this runs on every boot.
  db.exec(`
    CREATE TABLE IF NOT EXISTS batches (
      id         TEXT PRIMARY KEY,
      updated_at INTEGER NOT NULL,
      payload    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS batches_updated_at ON batches (updated_at);

    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function getDb(): DatabaseSync {
  if (globalForDb.__houseaimageDb) return globalForDb.__houseaimageDb;

  const file = databasePath();
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });

  const db = new DatabaseSync(file);

  // Write-ahead logging: a poll reading a batch no longer blocks the write
  // that finishes it, which matters because both happen constantly.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");

  migrate(db);

  globalForDb.__houseaimageDb = db;
  return db;
}

/**
 * A small key/value table, for the things that are one object rather than a
 * collection: the operator's settings, the OAuth sessions.
 */
export function readJson<T>(key: string): T | undefined {
  const row = getDb().prepare("SELECT value FROM kv WHERE key = ?").get(key) as
    | { value: string }
    | undefined;

  if (!row) return undefined;

  try {
    return JSON.parse(row.value) as T;
  } catch {
    // A row we cannot parse is a row from an older shape. Ignoring it falls
    // back to defaults, which is better than refusing to start.
    return undefined;
  }
}

export function writeJson(key: string, value: unknown): void {
  getDb()
    .prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}

/** Test seam: drop the connection so the next call opens a fresh one. */
export function __closeDb(): void {
  globalForDb.__houseaimageDb?.close();
  globalForDb.__houseaimageDb = undefined;
}
