import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

/**
 * Database layer (parity gap #16): one async interface over two engines.
 *
 *   SQLite   (default)  — node:sqlite, a file on the persistent disk; zero setup.
 *   Postgres            — DATABASE_URL=postgres://… (node-postgres pool), for a managed DB and for
 *                         running several server instances. Tests also run against PGlite (real
 *                         Postgres in WASM, FORGE_DB_DRIVER=pglite) so both dialects stay green.
 *
 * Queries are written once, SQLite-style (`?` placeholders); the Postgres driver rewrites them
 * ($1…, INSERT OR IGNORE → ON CONFLICT DO NOTHING) and normalises results to what SQLite returns
 * (numbers for COUNT/SUM, 0/1 for booleans), so callers never branch on the engine.
 */

// Load Node's built-in SQLite via createRequire so the bundler/test-runner (Vite) doesn't try
// to resolve "node:sqlite" as a package. Types come from the erased `import type`.
const nodeRequire = createRequire(import.meta.url);
type SqliteDB = InstanceType<typeof import("node:sqlite").DatabaseSync>;

export interface Statement {
  get<T = unknown>(...params: unknown[]): Promise<T | undefined>;
  all<T = unknown>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<{ changes: number }>;
}
export interface Database {
  readonly kind: "sqlite" | "postgres";
  prepare(sql: string): Statement;
  /** one or more statements without parameters (schema, maintenance) */
  exec(sql: string): Promise<void>;
  /** run `fn` in a transaction; queries made inside it (through db()) join it */
  tx<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

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
  current_org_id         TEXT,
  is_admin               INTEGER NOT NULL DEFAULT 0,
  last_login_at          TEXT,
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

CREATE TABLE IF NOT EXISTS support_threads (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',   -- open | closed
  user_unread  INTEGER NOT NULL DEFAULT 0,     -- support replies the user hasn't seen
  admin_unread INTEGER NOT NULL DEFAULT 0,     -- user messages support hasn't seen
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_org ON support_threads(org_id, updated_at);
CREATE TABLE IF NOT EXISTS support_messages (
  id             TEXT PRIMARY KEY,
  thread_id      TEXT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON support_messages(thread_id, created_at);
CREATE TABLE IF NOT EXISTS feedback_bugs (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  page       TEXT,
  handled_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contact_messages (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  company    TEXT,
  message    TEXT NOT NULL,
  handled_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reminder_log (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,
  sent_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminder_log(user_id, kind, sent_at);

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

-- preloader kits (gap #12): a template library per workspace; the workspace default applies to every
-- export unless an app or concept picks another kit (apps.kit_id / concepts.kit_id; 'none' = no preloader)
CREATE TABLE IF NOT EXISTS preloader_kits (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  template     TEXT NOT NULL DEFAULT 'classic',
  bg           TEXT,
  accent       TEXT,
  text         TEXT,
  show_percent INTEGER NOT NULL DEFAULT 0,
  logo         BLOB,
  logo_mime    TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kits_org ON preloader_kits(org_id);

-- server-side settings that must survive restarts (e.g. the generated plugin licence signing key)
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Unity plugin distribution (gap #13): every download is a signed, watermarked licence
CREATE TABLE IF NOT EXISTS plugin_downloads (
  id         TEXT PRIMARY KEY,               -- licence id (lid), embedded in the package
  wm         TEXT NOT NULL UNIQUE,           -- short watermark code shown to people (XXXX-XXXX-XXXX)
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  email      TEXT NOT NULL,                  -- kept even if the user is deleted (leak tracing)
  org_id     TEXT,
  version    TEXT NOT NULL,
  ip         TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plugin_dl_user ON plugin_downloads(user_id, created_at);
-- which accounts use which download (a download used by many accounts = a leaked copy)
CREATE TABLE IF NOT EXISTS plugin_usage (
  lid          TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  first_seen   TEXT NOT NULL,
  last_seen    TEXT NOT NULL,
  last_version TEXT,
  requests     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (lid, user_id)
);
CREATE TABLE IF NOT EXISTS plugin_bans (
  id         TEXT PRIMARY KEY,
  scope      TEXT NOT NULL,                  -- download | user
  target     TEXT NOT NULL,                  -- licence id, or user id
  reason     TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  lifted_at  TEXT,
  lifted_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_plugin_bans_target ON plugin_bans(scope, target);

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
  value       REAL,                       -- optional numeric payload of a custom event
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
-- shared fixed-window rate limits (used when the database is shared by several instances)
CREATE TABLE IF NOT EXISTS rate_limits (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at BIGINT NOT NULL
);
`;

/** Additive migrations for databases created by older versions (idempotent). */
const MIGRATIONS = [
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
    "ALTER TABLE events ADD COLUMN value REAL",
    "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN last_login_at TEXT",
    "ALTER TABLE orgs ADD COLUMN default_kit_id TEXT",
    "ALTER TABLE apps ADD COLUMN kit_id TEXT",
    "ALTER TABLE concepts ADD COLUMN kit_id TEXT",
    // gap #16: binary data can live in an object store (the *_key column), the inline column then stays empty
    "ALTER TABLE creatives ADD COLUMN source_key TEXT",
    "ALTER TABLE exports ADD COLUMN bytes_key TEXT",
    "ALTER TABLE uploads ADD COLUMN bytes_key TEXT",
    "ALTER TABLE preloader_kits ADD COLUMN logo_key TEXT",
    // gap #16: running jobs prove they're alive, so another instance only recovers truly abandoned ones
    "ALTER TABLE jobs ADD COLUMN heartbeat_at TEXT",
    // per-workspace policy: every member must have two-factor authentication on
    "ALTER TABLE orgs ADD COLUMN require_2fa INTEGER NOT NULL DEFAULT 0",
];

// node:sqlite takes null (not undefined) and Uint8Array; node-postgres wants Buffers for bytea
function normParam(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

// ── SQLite ───────────────────────────────────────────────────────────────────
class SqliteDatabase implements Database {
  readonly kind = "sqlite" as const;
  private cache = new Map<string, ReturnType<SqliteDB["prepare"]>>();
  private txScope = new AsyncLocalStorage<boolean>();
  private txDone: Promise<void> | null = null;
  constructor(readonly raw: SqliteDB) {}

  /** While a transaction is open, statements from outside it wait (one connection is shared). */
  private async gate(): Promise<void> {
    while (this.txDone && !this.txScope.getStore()) await this.txDone;
  }
  private stmt(sql: string) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }
  prepare(sql: string): Statement {
    return {
      get: async <T>(...p: unknown[]) => {
        await this.gate();
        return this.stmt(sql).get(...(p.map(normParam) as never[])) as T | undefined;
      },
      all: async <T>(...p: unknown[]) => {
        await this.gate();
        return this.stmt(sql).all(...(p.map(normParam) as never[])) as T[];
      },
      run: async (...p: unknown[]) => {
        await this.gate();
        return { changes: Number(this.stmt(sql).run(...(p.map(normParam) as never[])).changes) };
      },
    };
  }
  async exec(sql: string): Promise<void> {
    await this.gate();
    this.raw.exec(sql);
  }
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    if (this.txScope.getStore()) return fn(); // nested: join the open transaction
    await this.gate();
    let release!: () => void;
    this.txDone = new Promise<void>((r) => (release = r));
    try {
      return await this.txScope.run(true, async () => {
        this.raw.exec("BEGIN");
        try {
          const out = await fn();
          this.raw.exec("COMMIT");
          return out;
        } catch (e) {
          this.raw.exec("ROLLBACK");
          throw e;
        }
      });
    } finally {
      this.txDone = null;
      release();
    }
  }
  async close(): Promise<void> {
    this.cache.clear();
    try {
      this.raw.close();
    } catch {
      /* already closed */
    }
  }
}

// ── Postgres (node-postgres pool, or PGlite in tests) ─────────────────────────
interface PgResult {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
  affectedRows?: number;
}
interface PgClient {
  query(text: string, params?: unknown[]): Promise<PgResult>;
  /** several statements, no parameters */
  execMany(sql: string): Promise<void>;
}
interface PgBackend {
  root: PgClient;
  transaction<T>(fn: (c: PgClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const pgSqlCache = new Map<string, string>();
/** SQLite-style SQL → Postgres: `?` → `$n` (outside quotes), INSERT OR IGNORE → ON CONFLICT DO NOTHING. */
export function toPostgresSql(sql: string): string {
  const hit = pgSqlCache.get(sql);
  if (hit) return hit;
  let out = "";
  let n = 0;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === "?") out += `$${++n}`;
    else out += ch;
  }
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(out)) out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, "INSERT INTO").trimEnd().replace(/;?$/, " ON CONFLICT DO NOTHING");
  pgSqlCache.set(sql, out);
  return out;
}

/** Postgres returns booleans (EXISTS…) where SQLite returns 0/1; keep callers dialect-free. */
function normRow<T>(row: Record<string, unknown> | undefined): T | undefined {
  if (!row) return undefined;
  for (const k in row) if (typeof row[k] === "boolean") row[k] = row[k] ? 1 : 0;
  return row as T;
}
function pgParam(v: unknown): unknown {
  const n = normParam(v);
  if (n instanceof Uint8Array && !Buffer.isBuffer(n)) return Buffer.from(n.buffer, n.byteOffset, n.byteLength);
  return n;
}

class PgDatabase implements Database {
  readonly kind = "postgres" as const;
  private scope = new AsyncLocalStorage<PgClient>();
  constructor(private backend: PgBackend) {}
  private client(): PgClient {
    return this.scope.getStore() ?? this.backend.root;
  }
  prepare(sql: string): Statement {
    const text = toPostgresSql(sql);
    const q = (p: unknown[]) => this.client().query(text, p.map(pgParam));
    return {
      get: async <T>(...p: unknown[]) => normRow<T>((await q(p)).rows[0]),
      all: async <T>(...p: unknown[]) => (await q(p)).rows.map((r) => normRow<T>(r)!),
      run: async (...p: unknown[]) => {
        const r = await q(p);
        return { changes: Number(r.rowCount ?? r.affectedRows ?? 0) };
      },
    };
  }
  async exec(sql: string): Promise<void> {
    await this.client().execMany(sql);
  }
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    if (this.scope.getStore()) return fn();
    return this.backend.transaction((c) => this.scope.run(c, fn));
  }
  async close(): Promise<void> {
    await this.backend.close();
  }
}

/** The schema in Postgres types (BYTEA, DOUBLE PRECISION), without SQLite pragmas. */
export function postgresSchema(): string {
  return SCHEMA.replace(/PRAGMA[^;]*;/g, "").replace(/\bBLOB\b/g, "BYTEA").replace(/\bREAL\b/g, "DOUBLE PRECISION");
}
const pgMigration = (stmt: string) =>
  stmt.replace(/ADD COLUMN /, "ADD COLUMN IF NOT EXISTS ").replace(/\bBLOB\b/g, "BYTEA").replace(/\bREAL\b/g, "DOUBLE PRECISION");

// COUNT/SUM come back as int8/numeric strings; make them numbers like SQLite's
const INT8 = 20;
const NUMERIC = 1700;

async function openNodePostgres(url: string): Promise<PgBackend> {
  const pg = (await import("pg")).default;
  pg.types.setTypeParser(INT8, (v: string) => Number(v));
  pg.types.setTypeParser(NUMERIC, (v: string) => Number(v));
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    ssl: /sslmode=(require|verify)/.test(url) || process.env.PGSSL === "1" ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "0" } : undefined,
  });
  const wrap = (c: { query: (t: string, p?: unknown[]) => Promise<PgResult> }): PgClient => ({
    query: (t, p) => c.query(t, p),
    execMany: async (sql) => {
      await c.query(sql);
    },
  });
  return {
    root: wrap(pool as never),
    async transaction(fn) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const out = await fn(wrap(c as never));
        await c.query("COMMIT");
        return out;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openPglite(): Promise<PgBackend> {
  const { PGlite } = await import("@electric-sql/pglite");
  const lite = new PGlite({ parsers: { [INT8]: (v: string) => Number(v), [NUMERIC]: (v: string) => Number(v) } });
  await lite.waitReady;
  const wrap = (c: { query: (t: string, p?: unknown[]) => Promise<unknown>; exec: (s: string) => Promise<unknown> }): PgClient => ({
    query: (t, p) => c.query(t, p) as Promise<PgResult>,
    execMany: async (sql) => {
      await c.exec(sql);
    },
  });
  return {
    root: wrap(lite as never),
    transaction: (fn) => lite.transaction((tx) => fn(wrap(tx as never))),
    close: () => lite.close(),
  };
}

// ── lifecycle ────────────────────────────────────────────────────────────────
export type DbDriver = "sqlite" | "postgres" | "pglite";
let current: Database | undefined;

/** Which engine this process uses: FORGE_DB_DRIVER, else Postgres when DATABASE_URL is set, else SQLite. */
export function dbDriver(): DbDriver {
  const d = process.env.FORGE_DB_DRIVER;
  if (d === "sqlite" || d === "postgres" || d === "pglite") return d;
  return config.databaseUrl ? "postgres" : "sqlite";
}

/** The open database. Call `initDb()` once at startup (the app, scripts and tests do). */
export function db(): Database {
  if (!current) throw new Error("database not initialised — await initDb() first");
  return current;
}

async function createSchema(d: Database): Promise<void> {
  if (d.kind === "sqlite") {
    await d.exec(SCHEMA);
    for (const stmt of MIGRATIONS) {
      try {
        await d.exec(stmt);
      } catch {
        /* column already present */
      }
    }
  } else {
    await d.exec(postgresSchema());
    for (const stmt of MIGRATIONS) await d.exec(pgMigration(stmt));
  }
}

/**
 * Open a database and create/upgrade its schema, without making it the app's database (scripts that
 * copy between two databases use this; the app uses `initDb`).
 */
export async function openDatabase(opts: { driver?: DbDriver; path?: string; url?: string } = {}): Promise<Database> {
  const driver = opts.driver ?? dbDriver();
  let d: Database;
  if (driver === "sqlite") {
    const path = opts.path ?? config.dbPath;
    if (path !== ":memory:") {
      try {
        mkdirSync(dirname(path), { recursive: true });
      } catch {
        /* ignore */
      }
    }
    const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    d = new SqliteDatabase(new DatabaseSync(path));
  } else if (driver === "pglite") {
    d = new PgDatabase(await openPglite());
  } else {
    const url = opts.url ?? config.databaseUrl;
    if (!url) throw new Error("DATABASE_URL is required for the postgres driver");
    d = new PgDatabase(await openNodePostgres(url));
  }
  await createSchema(d);
  return d;
}

/** Open (and create/upgrade) the app's database. Idempotent. */
export async function initDb(opts: { driver?: DbDriver; path?: string; url?: string } = {}): Promise<Database> {
  if (current) return current;
  const d = await openDatabase(opts);
  current = d;
  await migrateOrgs(d);
  await migratePreloaders(d);
  return d;
}

/** Tables in creation order — parents before children, so copying in this order satisfies foreign keys. */
export const TABLE_ORDER: string[] = [...SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!);

/** Column names of a table. */
export async function columnsOf(d: Database, table: string): Promise<string[]> {
  if (d.kind === "sqlite") return (await d.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>()).map((r) => r.name);
  return (
    await d
      .prepare("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position")
      .all<{ name: string }>(table)
  ).map((r) => r.name);
}

export async function closeDb(): Promise<void> {
  const d = current;
  current = undefined;
  await d?.close();
}

/** Every application table (for resets and the SQLite → Postgres copy). */
export async function tableNames(d: Database = db()): Promise<string[]> {
  if (d.kind === "sqlite")
    return (await d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all<{ name: string }>()).map((r) => r.name);
  return (await d.prepare("SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename").all<{ name: string }>()).map((r) => r.name);
}

/**
 * For tests: an empty database. SQLite gets a fresh in-memory file; Postgres/PGlite keep the
 * connection and truncate every table (much faster than re-creating the engine).
 */
export async function resetDb(): Promise<void> {
  const driver = dbDriver();
  if (driver === "sqlite") {
    await closeDb();
    await initDb({ driver, path: ":memory:" });
    return;
  }
  if (!current) {
    await initDb({ driver });
  }
  const names = await tableNames(current!);
  if (names.length) await current!.exec(`TRUNCATE ${names.map((n) => `"${n}"`).join(", ")} CASCADE`);
}

/**
 * Orgs migration (idempotent, runs at every start): every user owns a personal workspace, apps
 * without a workspace join their creator's, the current-workspace pointer is set, and the legacy
 * flat `memberships` rows become org memberships of the owner's workspace.
 */
export async function migrateOrgs(d: Database = db()): Promise<void> {
  const nowIso = new Date().toISOString();
  const orphans = await d
    .prepare("SELECT u.id, u.email FROM users u WHERE NOT EXISTS (SELECT 1 FROM orgs o WHERE o.owner_user_id = u.id)")
    .all<{ id: string; email: string }>();
  const insOrg = d.prepare("INSERT INTO orgs (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)");
  const insMem = d.prepare("INSERT OR IGNORE INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)");
  for (const u of orphans) {
    const id = randomUUID();
    await insOrg.run(id, `${u.email.split("@")[0] || "my"}'s workspace`, u.id, nowIso);
    await insMem.run(id, u.id, nowIso);
  }
  await d
    .prepare("UPDATE apps SET org_id = (SELECT o.id FROM orgs o WHERE o.owner_user_id = apps.user_id ORDER BY o.created_at LIMIT 1) WHERE org_id IS NULL")
    .run();
  await d
    .prepare(
      "UPDATE users SET current_org_id = (SELECT o.id FROM orgs o WHERE o.owner_user_id = users.id ORDER BY o.created_at LIMIT 1) WHERE current_org_id IS NULL",
    )
    .run();
  await d
    .prepare(
      `INSERT OR IGNORE INTO org_members (org_id, user_id, role, created_at)
       SELECT o.id, m.member_user_id, CASE WHEN m.role = 'admin' THEN 'admin' ELSE 'member' END, m.created_at
       FROM memberships m JOIN orgs o ON o.owner_user_id = m.owner_user_id`,
    )
    .run();
}

/**
 * Preloader migration (idempotent): the legacy single preloader per billing owner (`preloaders`) becomes
 * a "Brand kit" in every workspace that user owns — the workspace default when it was enabled — and the
 * legacy row is removed once copied, so it never re-runs.
 */
export async function migratePreloaders(d: Database = db()): Promise<void> {
  const rows = await d.prepare("SELECT * FROM preloaders").all<{
    user_id: string;
    logo: Uint8Array | null;
    logo_mime: string | null;
    bg: string | null;
    enabled: number;
  }>();
  if (!rows.length) return;
  const nowIso = new Date().toISOString();
  const orgsOf = d.prepare("SELECT id FROM orgs WHERE owner_user_id = ?");
  const ins = d.prepare(
    "INSERT INTO preloader_kits (id, org_id, name, template, bg, logo, logo_mime, created_at, updated_at) VALUES (?, ?, 'Brand kit', 'classic', ?, ?, ?, ?, ?)",
  );
  const setDefault = d.prepare("UPDATE orgs SET default_kit_id = ? WHERE id = ? AND default_kit_id IS NULL");
  const del = d.prepare("DELETE FROM preloaders WHERE user_id = ?");
  await d.tx(async () => {
    for (const r of rows) {
      if (r.logo || r.bg) {
        for (const o of await orgsOf.all<{ id: string }>(r.user_id)) {
          const id = randomUUID();
          await ins.run(id, o.id, r.bg, r.logo ? Buffer.from(r.logo) : null, r.logo_mime, nowIso, nowIso);
          if (r.enabled) await setDefault.run(id, o.id);
        }
      }
      await del.run(r.user_id);
    }
  });
}
