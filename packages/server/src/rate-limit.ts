/**
 * Tiny in-memory fixed-window rate limiter (dependency-free). Fine for the single-instance
 * deploy; swap for a shared store if the server is ever horizontally scaled.
 */
interface Bucket {
  count: number;
  reset: number;
}
const buckets = new Map<string, Bucket>();

/** Record one hit for `key`; return true if still within `max` per `windowMs`, false if over. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= max;
}

/** Clear a key's window (e.g. after a successful login). */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

// occasional sweep of expired buckets so the map can't grow unbounded
const timer = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60_000);
timer.unref?.();
