/**
 * Async job model + in-process worker (Gap #6).
 *
 * Dependency-free, like the rest of this server: the queue is the `jobs` table (SQLite or Postgres,
 * durable across restarts) and the worker is a setTimeout loop in each API process. Claims are
 * compare-and-set (`WHERE status = 'queued'`), so several instances can share one Postgres queue
 * without double-running a job; running jobs heart-beat, and only jobs whose heartbeat stopped are
 * recovered. Handlers are registered per `kind` ("export", "compile").
 *
 * Tests never start the loop: they call {@link drainJobs}, which runs the queue to empty inline.
 */
import {
  claimNextJob,
  completeJob,
  createJob,
  failJob,
  heartbeatJob,
  pruneEvents,
  pruneJobs,
  pruneUploads,
  recoverStaleJobs,
  setJobProgress,
  type JobRow,
} from "./repo.js";
import { autoRemindersTick } from "./reminders.js";
import { db } from "./db.js";
import { pruneRateLimits } from "./rate-limit.js";
import { sweepOrphanBlobs } from "./blob-maintenance.js";

/** How long a running job may go without a heartbeat before another instance takes it back. */
const STALE_MS = 2 * 60_000;
const HEARTBEAT_MS = 15_000;

/** Report progress from a handler: 0–100 plus an optional human label ("Packing Meta (2/6)"). */
export type Progress = (percent: number, label?: string) => void;
export type JobHandler = (job: JobRow, progress: Progress) => Promise<unknown>;

/** Thrown by handlers for user-facing failures (kept verbatim in `job.error`). */
export class JobError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = "JobError";
  }
}

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(kind: string, handler: JobHandler): void {
  handlers.set(kind, handler);
}

/** Enqueue a job; the worker (if started) wakes immediately. */
export async function enqueue(userId: string, kind: string, payload: unknown): Promise<JobRow> {
  if (!handlers.has(kind)) throw new Error(`no handler registered for job kind "${kind}"`);
  const job = await createJob(userId, kind, payload);
  kick();
  return job;
}

/** Claim and run one queued job. Returns false when the queue is empty. */
export async function runOne(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;
  const handler = handlers.get(job.kind);
  if (!handler) {
    await failJob(job.id, `Unknown job kind "${job.kind}"`);
    return true;
  }
  // keep the claim alive while the handler works (a long compile can go minutes between progress reports)
  const beat = setInterval(() => void heartbeatJob(job.id).catch(() => {}), HEARTBEAT_MS);
  beat.unref?.();
  try {
    const result = await handler(job, (pct, label) => void setJobProgress(job.id, pct, label).catch(() => {}));
    await completeJob(job.id, result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await failJob(job.id, msg || "Job failed");
  } finally {
    clearInterval(beat);
  }
  return true;
}

/** Run the queue until it is empty (tests / CLI). Returns the number of jobs processed. */
export async function drainJobs(): Promise<number> {
  let n = 0;
  while (await runOne()) n++;
  return n;
}

// ── background loop ──────────────────────────────────────────────────────────
let started = false;
let busy = false;
let timer: NodeJS.Timeout | undefined;
let idleMs = 1500;
let lastPrune = 0;
let lastRecover = 0;
let lastSweep = 0;

async function tick(): Promise<void> {
  if (!started || busy) return;
  busy = true;
  let didWork = false;
  try {
    didWork = await runOne();
    const nowMs = Date.now();
    // shared database: pick up jobs left by an instance that died (its heartbeat stopped)
    if (db().kind === "postgres" && nowMs - lastRecover > 60_000) {
      lastRecover = nowMs;
      const n = await recoverStaleJobs(2, STALE_MS);
      if (n) console.log(`[jobs] recovered ${n} abandoned job(s)`);
    }
    if (nowMs - lastPrune > 6 * 60 * 60_000) {
      lastPrune = nowMs;
      await pruneJobs(new Date(nowMs - 7 * 86_400_000).toISOString());
      await pruneEvents(new Date(nowMs - 90 * 86_400_000).toISOString());
      await pruneUploads(new Date(nowMs - 86_400_000).toISOString());
      await pruneRateLimits();
    }
    if (nowMs - lastSweep > 24 * 60 * 60_000) {
      lastSweep = nowMs;
      const r = await sweepOrphanBlobs();
      if (r.deleted) console.log(`[blobs] removed ${r.deleted} orphaned object(s)`);
    }
    try {
      await autoRemindersTick(nowMs);
    } catch (e) {
      console.error("[reminders] failed:", e);
    }
  } catch (e) {
    console.error("[jobs] worker tick failed:", e);
  } finally {
    busy = false;
  }
  if (started) schedule(didWork ? 0 : idleMs);
}

function schedule(delay: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void tick(), delay);
  timer.unref?.();
}

/** Wake the loop now (called on enqueue). No-op when the worker is not started. */
function kick(): void {
  if (started && !busy) schedule(0);
}

/**
 * Start the in-process worker: recover jobs interrupted by a restart, then poll the queue. With SQLite
 * this is the only instance, so every `running` job was interrupted; with Postgres other instances may
 * be mid-job, so only jobs with a stale heartbeat are recovered.
 */
export async function startWorker(opts: { idleMs?: number } = {}): Promise<void> {
  if (started) return;
  started = true;
  idleMs = opts.idleMs ?? idleMs;
  const recovered = await recoverStaleJobs(2, db().kind === "postgres" ? STALE_MS : 0);
  if (recovered) console.log(`[jobs] recovered ${recovered} interrupted job(s)`);
  schedule(0);
}

export function stopWorker(): void {
  started = false;
  if (timer) clearTimeout(timer);
  timer = undefined;
}

/** Public, API-shaped view of a job row (payload/result parsed, snake_case → camelCase). */
export function jobView(j: JobRow) {
  let payload: unknown = null;
  let result: unknown = null;
  try {
    payload = JSON.parse(j.payload_json);
  } catch {
    /* ignore */
  }
  try {
    result = j.result_json ? JSON.parse(j.result_json) : null;
  } catch {
    /* ignore */
  }
  return {
    id: j.id,
    kind: j.kind,
    status: j.status,
    progress: j.status === "done" ? 100 : j.progress,
    label: j.progress_label,
    payload,
    result,
    error: j.error,
    attempts: j.attempts,
    createdAt: j.created_at,
    startedAt: j.started_at,
    finishedAt: j.finished_at,
  };
}
