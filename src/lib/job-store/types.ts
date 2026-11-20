import type { Job, RecentJobMetrics } from '@/lib/types';

export const JOB_TTL_SECONDS = 86_400; // 24 hours PII auto-expiry

export interface JobStore {
  getJob(id: string): Promise<Job | null>;
  saveJob(job: Job): Promise<void>;
  deleteJob(id: string): Promise<void>;

  acquireJobLease(id: string, ttlMs: number): Promise<string | null>;
  releaseJobLease(id: string, leaseId: string): Promise<void>;

  listActiveLiveJobs(): Promise<Job[]>;
  acquireGlobalSessionLock(ttlMs: number): Promise<string | null>;
  releaseGlobalSessionLock(lockId: string): Promise<void>;

  setWorkerHeartbeat(timestampMs: number): Promise<void>;
  getWorkerHeartbeat(): Promise<number | null>;

  recordJobOutcome(outcome: 'completed' | 'failed' | 'rate_limited'): Promise<void>;
  getRecentMetrics(): Promise<RecentJobMetrics>;
}
