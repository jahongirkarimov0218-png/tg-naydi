import type { Job, RecentJobMetrics } from '@/lib/types';

export const JOB_TTL_SECONDS = 86_400; // 24 hours PII auto-expiry
const WORKER_HEARTBEAT_TTL_MS = 90_000; // 3x 30s worker heartbeat interval

export function isWorkerHeartbeatFresh(hb: number | null, nowMs: number = Date.now()): boolean {
  return hb !== null && nowMs - hb < WORKER_HEARTBEAT_TTL_MS;
}

function isJobExpired(job: Job, nowMs: number = Date.now()): boolean {
  return Boolean(job.expiresAt && new Date(job.expiresAt).getTime() <= nowMs);
}

export async function returnActiveOrExpire(
  job: Job | null,
  onExpire: (id: string) => Promise<void>
): Promise<Job | null> {
  if (!job) return null;
  if (isJobExpired(job)) {
    await onExpire(job.id);
    return null;
  }
  return job;
}

export function isActiveLiveJob(job: Job): boolean {
  return (
    job.providerMode === 'LIVE_MTPROTO' &&
    (job.status === 'queued' || job.status === 'running' || job.status === 'rate_limited')
  );
}

export function buildRecentJobMetrics(
  completed: number,
  failed: number,
  rateLimited: number
): RecentJobMetrics {
  const total = completed + failed;
  return {
    recentJobsTotal: total,
    recentJobsCompleted: completed,
    recentJobsFailed: failed,
    recentFloodWaits: rateLimited,
    errorRate: total > 0 ? failed / total : 0,
  };
}
