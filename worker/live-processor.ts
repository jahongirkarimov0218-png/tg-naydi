import {
  applyBatchOutcomes,
  completeEmptyPendingJob,
  computeJobStats,
  LIVE_MAX_BATCH_SIZE,
  LIVE_MIN_PAUSE_MS,
} from '@/lib/job-engine';
import type { JobStore } from '@/lib/job-store/types';
import { logError, logInfo, redactSensitiveText } from '@/lib/logger';
import type { TelegramLookupProvider } from '@/lib/providers/types';
import type { BatchLookupResult, Job } from '@/lib/types';

const SESSION_LOCK_TTL_MS = 60_000;
export const DEFAULT_IDLE_POLL_MS = 15_000;
const MIN_IDLE_POLL_MS = 3_000;
const MAX_IDLE_POLL_MS = 60_000;

export type LiveTickResult =
  | { kind: 'cooldown'; waitMs: number }
  | { kind: 'idle' }
  | { kind: 'locked' }
  | { kind: 'processed'; jobId: string; status: Job['status']; pauseMs: number }
  | { kind: 'failed'; jobId: string };

export function readWorkerIdlePollMs(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = Number(env.WORKER_IDLE_POLL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_IDLE_POLL_MS;
  return Math.min(MAX_IDLE_POLL_MS, Math.max(MIN_IDLE_POLL_MS, Math.floor(raw)));
}

export function computeNextPollDelayMs(
  tick: LiveTickResult,
  idlePollMs: number = DEFAULT_IDLE_POLL_MS
): number {
  switch (tick.kind) {
    case 'cooldown':
      return Math.min(5_000, Math.max(500, tick.waitMs));
    case 'locked':
      return 2_000;
    case 'processed':
      return tick.pauseMs > 0 ? Math.min(tick.pauseMs, 5_000) : 500;
    case 'failed':
      return 5_000;
    default:
      return idlePollMs;
  }
}

export function readWorkerEnvConfig(env: Record<string, string | undefined> = process.env): {
  apiId: number;
  apiHash: string;
  sessionStr: string;
} {
  const apiId = Number(env.TELEGRAM_API_ID);
  const apiHash = env.TELEGRAM_API_HASH?.trim() ?? '';
  const sessionStr = env.TELEGRAM_SESSION?.trim() ?? '';
  if (!apiId || !apiHash || !sessionStr) {
    throw new Error(
      'Missing TELEGRAM_API_ID, TELEGRAM_API_HASH, or TELEGRAM_SESSION. Set them in your private worker environment.'
    );
  }
  return { apiId, apiHash, sessionStr };
}

function isLiveJobRunnable(job: Job, nowMs: number): boolean {
  if (job.status === 'rate_limited' && job.retryAfterAt) {
    return new Date(job.retryAfterAt).getTime() <= nowMs;
  }
  return job.status === 'queued' || job.status === 'running';
}

function pickNextRunnableLiveJob(jobs: Job[], nowMs: number): Job | null {
  return jobs.find((j) => isLiveJobRunnable(j, nowMs)) ?? null;
}

async function markLiveJobFailed(
  store: JobStore,
  jobId: string,
  err: unknown,
  nowMs: number
): Promise<void> {
  const latest = await store.getJob(jobId);
  if (!latest) return;
  latest.status = 'failed';
  latest.lastError = redactSensitiveText(err instanceof Error ? err.message : String(err));
  latest.updatedAt = new Date(nowMs).toISOString();
  await store.saveJob(latest);
  await store.recordJobOutcome('failed');
  logError('Live MTProto job failed with unrecoverable error', err, { jobId });
}

async function commitLiveBatchResult(
  store: JobStore,
  jobId: string,
  result: BatchLookupResult,
  safePauseMs: number,
  nowMs: number
): Promise<LiveTickResult> {
  // Re-read right before saving to prevent resurrecting deleted PII or clobbering concurrent pause
  const latest = await store.getJob(jobId);
  if (!latest) return { kind: 'idle' };

  const nowIso = new Date(nowMs).toISOString();
  latest.items = applyBatchOutcomes(latest.items, result.items, nowIso);
  latest.stats = computeJobStats(latest.items);

  let pauseMs = 0;
  if (result.floodWaitSeconds && result.floodWaitSeconds > 0) {
    const cooldownTs = nowMs + result.floodWaitSeconds * 1000;
    latest.retryAfterAt = new Date(cooldownTs).toISOString();
    if (latest.status !== 'paused') {
      latest.status = 'rate_limited';
    }
    await store.setSessionCooldownUntil(cooldownTs);
    await store.recordJobOutcome('rate_limited');
    logInfo('Live job hit FLOOD_WAIT; enforcing session-wide cooldown', {
      jobId: latest.id,
      retryAfterSec: result.floodWaitSeconds,
    });
  } else if (latest.stats.pending === 0) {
    latest.status = 'completed';
    latest.retryAfterAt = undefined;
    await store.recordJobOutcome('completed');
  } else {
    await store.setSessionCooldownUntil(nowMs + safePauseMs);
    pauseMs = safePauseMs;
  }

  latest.updatedAt = nowIso;
  await store.saveJob(latest);
  return { kind: 'processed', jobId: latest.id, status: latest.status, pauseMs };
}

async function executeLockedLiveBatch(
  store: JobStore,
  provider: TelegramLookupProvider,
  jobId: string,
  nowMs: number
): Promise<LiveTickResult> {
  const fresh = await store.getJob(jobId);
  if (!fresh || fresh.status === 'paused' || fresh.status === 'completed' || fresh.status === 'failed') {
    return { kind: 'idle' };
  }

  const safeBatchSize = Math.min(Math.max(1, fresh.batchSize), LIVE_MAX_BATCH_SIZE);
  const safePauseMs = Math.max(fresh.pauseMs, LIVE_MIN_PAUSE_MS);
  const pending = fresh.items.filter((i) => i.status === 'pending').slice(0, safeBatchSize);

  if (pending.length === 0) {
    await completeEmptyPendingJob(store, fresh, nowMs);
    return { kind: 'processed', jobId: fresh.id, status: 'completed', pauseMs: 0 };
  }

  fresh.status = 'running';
  fresh.retryAfterAt = undefined;
  fresh.updatedAt = new Date(nowMs).toISOString();
  await store.saveJob(fresh);

  try {
    const result = await provider.lookupBatch(pending.map((p) => p.phone));
    return await commitLiveBatchResult(store, jobId, result, safePauseMs, nowMs);
  } catch (err) {
    await markLiveJobFailed(store, jobId, err, nowMs);
    return { kind: 'failed', jobId };
  }
}

export async function processNextLiveBatch(
  store: JobStore,
  provider: TelegramLookupProvider,
  nowMs: number = Date.now()
): Promise<LiveTickResult> {
  // Check queue first so 24/7 idle ticks use only 1 Redis command (ZRANGE) instead of 2
  const activeJobs = await store.listActiveLiveJobs();
  if (activeJobs.length === 0) return { kind: 'idle' };

  const cooldownUntil = await store.getSessionCooldownUntil();
  if (cooldownUntil && cooldownUntil > nowMs) {
    return { kind: 'cooldown', waitMs: cooldownUntil - nowMs };
  }

  const nextJob = pickNextRunnableLiveJob(activeJobs, nowMs);
  if (!nextJob) return { kind: 'idle' };

  const globalLock = await store.acquireGlobalSessionLock(SESSION_LOCK_TTL_MS);
  if (!globalLock) return { kind: 'locked' };

  try {
    return await executeLockedLiveBatch(store, provider, nextJob.id, nowMs);
  } finally {
    await store.releaseGlobalSessionLock(globalLock);
  }
}
