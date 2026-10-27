import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

// Load Node's built-in SQLite via createRequire so the bundler/test-runner (Vite) doesn't try
// to resolve "node:sqlite" as a package. Types come from the erased `import type`.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");
type DB = InstanceType<typeof DatabaseSync>;

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'free',
  totp_secret   TEXT,
  totp_enabled  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS export_usage (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  network    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user_time ON export_usage(user_id, created_at);

CREATE TABLE IF NOT EXISTS apps (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  platform   TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS concepts (
  id         TEXT PRIMARY KEY,
  app_id     TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creatives (
  id           TEXT PRIMARY KEY,
  concept_id   TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  entry        TEXT NOT NULL,
  source_zip   BLOB NOT NULL,
  options_json TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exports (
  id              TEXT PRIMARY KEY,
  creative_id     TEXT NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  network         TEXT NOT NULL,
  filename        TEXT NOT NULL,
  format          TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  max_size_bytes  INTEGER NOT NULL,
  ok              INTEGER NOT NULL,
  validation_json TEXT NOT NULL,
  bytes           BLOB NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE(creative_id, network)
);
`;

let db: DB | undefined;

export function initDb(path: string = config.dbPath): DB {
  if (path !== ":memory:") {
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {
      /* ignore */
    }
  }
  db = new DatabaseSync(path);
  db.exec(SCHEMA);
  // migrations for pre-existing databases (ignore if the column already exists)
  for (const stmt of [
    "ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'",
    "ALTER TABLE users ADD COLUMN totp_secret TEXT",
    "ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0",
  ]) {
    try {
      db.exec(stmt);
    } catch {
      /* column already present */
    }
  }
  return db;
}

export function getDb(): DB {
  if (!db) initDb();
  return db!;
}

/** For tests: swap in a fresh in-memory database. */
export function resetDb(): void {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  initDb(":memory:");
}
