import { config } from "./config.js";
import { db } from "./db.js";

/**
 * Fixed-window rate limiter.
 *
 *   memory — per process (the default with SQLite: one instance).
 *   db     — counters in the `rate_limits` table, shared by every instance (the default with
 *            Postgres; force either with RATE_LIMIT_STORE=memory|db). One atomic upsert per hit.
 */
interface Bucket {
  count: number;
  reset: number;
}
const buckets = new Map<string, Bucket>();

function useDb(): boolean {
  if (config.rateLimitStore) return config.rateLimitStore === "db";
  try {
    return db().kind === "postgres";
  } catch {
    return false; // database not open yet (unit tests of pure code)
  }
}

/** Record one hit for `key`; true while within `max` per `windowMs`, false once over. */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  if (useDb()) {
    // a fresh window when the stored one has expired, else one more hit in it — atomically
    const row = await db()
      .prepare(
        `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET
           count = CASE WHEN rate_limits.reset_at < ? THEN 1 ELSE rate_limits.count + 1 END,
           reset_at = CASE WHEN rate_limits.reset_at < ? THEN ? ELSE rate_limits.reset_at END
         RETURNING count`,
      )
      .get<{ count: number }>(key, now + windowMs, now, now, now + windowMs);
    return Number(row?.count ?? 1) <= max;
  }
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= max;
}

/** Clear a key's window (e.g. after a successful login). */
export async function clearRateLimit(key: string): Promise<void> {
  buckets.delete(key);
  if (useDb()) await db().prepare("DELETE FROM rate_limits WHERE key = ?").run(key);
}

/** Forget every window (tests: each case starts with fresh limits). */
export async function resetRateLimits(): Promise<void> {
  buckets.clear();
  try {
    await db().prepare("DELETE FROM rate_limits").run();
  } catch {
    /* database not open */
  }
}

/** Housekeeping for the shared store: drop expired windows. */
export async function pruneRateLimits(): Promise<number> {
  if (!useDb()) return 0;
  return (await db().prepare("DELETE FROM rate_limits WHERE reset_at < ?").run(Date.now())).changes;
}

// occasional sweep of expired in-memory buckets so the map can't grow unbounded
const timer = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60_000);
timer.unref?.();
