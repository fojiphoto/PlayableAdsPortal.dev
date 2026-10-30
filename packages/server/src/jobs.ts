/**
 * Async job model + in-process worker (Gap #6).
 *
 * Dependency-free, like the rest of this server: the queue is the SQLite `jobs` table (durable across
 * restarts, inspectable with any sqlite client) and the worker is a single setTimeout loop in the
 * API process — right for the single-instance Render deploy. Handlers are registered per `kind`
 * ("export" today; capture/compiler plug in the same way). Swap `startWorker` for a separate process
 * and `claimNextJob` for a shared store if the server is ever horizontally scaled.
 *
 * Tests never start the loop: they call {@link drainJobs}, which runs the queue to empty inline.
 */
import {
  claimNextJob,
  completeJob,
  createJob,
  failJob,
  pruneEvents,
  pruneJobs,
  recoverStaleJobs,
  setJobProgress,
  type JobRow,
} from "./repo.js";

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
export function enqueue(userId: string, kind: string, payload: unknown): JobRow {
  if (!handlers.has(kind)) throw new Error(`no handler registered for job kind "${kind}"`);
  const job = createJob(userId, kind, payload);
  kick();
  return job;
}

/** Claim and run one queued job. Returns false when the queue is empty. */
export async function runOne(): Promise<boolean> {
  const job = claimNextJob();
  if (!job) return false;
  const handler = handlers.get(job.kind);
  if (!handler) {
    failJob(job.id, `Unknown job kind "${job.kind}"`);
    return true;
  }
  try {
    const result = await handler(job, (pct, label) => setJobProgress(job.id, pct, label));
    completeJob(job.id, result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    failJob(job.id, msg || "Job failed");
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

async function tick(): Promise<void> {
  if (!started || busy) return;
  busy = true;
  let didWork = false;
  try {
    didWork = await runOne();
    const nowMs = Date.now();
    if (nowMs - lastPrune > 6 * 60 * 60_000) {
      lastPrune = nowMs;
      pruneJobs(new Date(nowMs - 7 * 86_400_000).toISOString());
      pruneEvents(new Date(nowMs - 90 * 86_400_000).toISOString());
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

/** Start the in-process worker: recover jobs interrupted by a restart, then poll the queue. */
export function startWorker(opts: { idleMs?: number } = {}): void {
  if (started) return;
  started = true;
  idleMs = opts.idleMs ?? idleMs;
  const recovered = recoverStaleJobs();
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
