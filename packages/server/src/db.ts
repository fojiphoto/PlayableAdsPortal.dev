import { randomUUID } from "node:crypto";
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
  totp_last_step INTEGER,
  domain        TEXT,
  domain_token  TEXT,
  domain_verified INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  plan_status            TEXT,
  email_verified         INTEGER NOT NULL DEFAULT 0,
  email_verify_hash      TEXT,
  email_verify_expires   TEXT,
  plan_renews_at         TEXT,
  plan_cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  analytics_enabled      INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resets_hash ON password_resets(token_hash);

CREATE TABLE IF NOT EXISTS export_usage (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  network    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user_time ON export_usage(user_id, created_at);

CREATE TABLE IF NOT EXISTS orgs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS org_members (
  org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,              -- owner | admin | member | viewer
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
CREATE TABLE IF NOT EXISTS org_invites (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  invited_by  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  accepted_at TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_invites_hash ON org_invites(token_hash);

-- legacy flat sharing (pre-orgs); migrated into org_members at startup, no longer written
CREATE TABLE IF NOT EXISTS memberships (
  id             TEXT PRIMARY KEY,
  owner_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role           TEXT NOT NULL DEFAULT 'member',
  created_at     TEXT NOT NULL,
  UNIQUE(owner_user_id, member_user_id)
);

CREATE TABLE IF NOT EXISTS preloaders (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  logo       BLOB,
  logo_mime  TEXT,
  bg         TEXT,
  enabled    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS apps (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  platform   TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS concepts (
  id            TEXT PRIMARY KEY,
  app_id        TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  network_order TEXT,
  created_at    TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS jobs (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  status         TEXT NOT NULL,            -- queued | running | done | failed
  payload_json   TEXT NOT NULL,
  result_json    TEXT,
  error          TEXT,
  progress       INTEGER NOT NULL DEFAULT 0,
  progress_label TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  started_at     TEXT,
  finished_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_user_created ON jobs(user_id, created_at);

CREATE TABLE IF NOT EXISTS uploads (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  bytes      BLOB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  creative_id TEXT NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  network     TEXT NOT NULL,
  event       TEXT NOT NULL,            -- impression | engage | start | complete | cta | custom
  name        TEXT,                     -- custom event name
  session     TEXT NOT NULL,            -- per-play id generated by the shim
  preview     INTEGER NOT NULL DEFAULT 0, -- 1 = played in our own device preview
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_creative_time ON events(creative_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at);

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
    "ALTER TABLE users ADD COLUMN totp_last_step INTEGER",
    "ALTER TABLE users ADD COLUMN domain TEXT",
    "ALTER TABLE users ADD COLUMN domain_token TEXT",
    "ALTER TABLE users ADD COLUMN domain_verified INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN stripe_customer_id TEXT",
    "ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT",
    "ALTER TABLE users ADD COLUMN plan_status TEXT",
    "ALTER TABLE concepts ADD COLUMN network_order TEXT",
    "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN email_verify_hash TEXT",
    "ALTER TABLE users ADD COLUMN email_verify_expires TEXT",
    "ALTER TABLE users ADD COLUMN plan_renews_at TEXT",
    "ALTER TABLE users ADD COLUMN plan_cancel_at_period_end INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN analytics_enabled INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE users ADD COLUMN current_org_id TEXT",
    "ALTER TABLE apps ADD COLUMN org_id TEXT",
  ]) {
    try {
      db.exec(stmt);
    } catch {
      /* column already present */
    }
  }
  migrateOrgs(db);
  return db;
}

/**
 * Orgs migration (idempotent, runs at every start): every user owns a personal workspace, apps
 * without a workspace join their creator's, the current-workspace pointer is set, and the legacy
 * flat `memberships` rows become org memberships of the owner's workspace.
 */
export function migrateOrgs(db: DB): void {
  const nowIso = new Date().toISOString();
  const orphans = db
    .prepare("SELECT u.id, u.email FROM users u WHERE NOT EXISTS (SELECT 1 FROM orgs o WHERE o.owner_user_id = u.id)")
    .all() as unknown as { id: string; email: string }[];
  const insOrg = db.prepare("INSERT INTO orgs (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)");
  const insMem = db.prepare("INSERT OR IGNORE INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)");
  for (const u of orphans) {
    const id = randomUUID();
    insOrg.run(id, `${u.email.split("@")[0] || "my"}'s workspace`, u.id, nowIso);
    insMem.run(id, u.id, nowIso);
  }
  db.exec(
    "UPDATE apps SET org_id = (SELECT o.id FROM orgs o WHERE o.owner_user_id = apps.user_id ORDER BY o.created_at LIMIT 1) WHERE org_id IS NULL",
  );
  db.exec(
    "UPDATE users SET current_org_id = (SELECT o.id FROM orgs o WHERE o.owner_user_id = users.id ORDER BY o.created_at LIMIT 1) WHERE current_org_id IS NULL",
  );
  db.exec(
    `INSERT OR IGNORE INTO org_members (org_id, user_id, role, created_at)
     SELECT o.id, m.member_user_id, CASE WHEN m.role = 'admin' THEN 'admin' ELSE 'member' END, m.created_at
     FROM memberships m JOIN orgs o ON o.owner_user_id = m.owner_user_id`,
  );
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
