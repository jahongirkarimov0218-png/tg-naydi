import crypto from 'node:crypto';
import { Redis } from '@upstash/redis';
import type { Job, RecentJobMetrics } from '@/lib/types';
import {
  buildRecentJobMetrics,
  isActiveLiveJob,
  JOB_TTL_SECONDS,
  returnActiveOrExpire,
} from '@/lib/job-store/helpers';
import type { JobStore } from '@/lib/job-store/types';

const LIVE_QUEUE_KEY = 'tgnaydi:live:queue';
const GLOBAL_LOCK_KEY = 'tgnaydi:lock:mtproto:session';
const HEARTBEAT_KEY = 'tgnaydi:worker:heartbeat';
const COOLDOWN_KEY = 'tgnaydi:mtproto:cooldown_until';
const METRICS_KEY = 'tgnaydi:metrics:jobs';

export const ATOMIC_RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export interface RedisLike {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number; nx?: true; px?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  zadd(key: string, scoreMember: { score: number; member: string }): Promise<unknown>;
  zrem(key: string, ...members: string[]): Promise<unknown>;
  zrange<T>(key: string, start: number, stop: number): Promise<T>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  hincrby(key: string, field: string, increment: number): Promise<unknown>;
  hgetall<T extends Record<string, unknown>>(key: string): Promise<T | null>;
}

export class UpstashRedisJobStore implements JobStore {
  private readonly redis: RedisLike;

  constructor(urlOrClient: string | RedisLike, token?: string) {
    this.redis =
      typeof urlOrClient === 'string'
        ? (new Redis({ url: urlOrClient, token: token ?? '' }) as unknown as RedisLike)
        : urlOrClient;
  }

  private jobKey(id: string): string {
    return `tgnaydi:job:${id}`;
  }

  private leaseKey(id: string): string {
    return `tgnaydi:lease:${id}`;
  }

  async getJob(id: string): Promise<Job | null> {
    const job = await this.redis.get<Job>(this.jobKey(id));
    return returnActiveOrExpire(job, (expiredId) => this.deleteJob(expiredId));
  }

  async saveJob(job: Job): Promise<void> {
    await this.redis.set(this.jobKey(job.id), job, { ex: JOB_TTL_SECONDS });
    if (isActiveLiveJob(job)) {
      await this.redis.zadd(LIVE_QUEUE_KEY, {
        score: new Date(job.createdAt).getTime(),
        member: job.id,
      });
    } else {
      await this.redis.zrem(LIVE_QUEUE_KEY, job.id);
    }
  }

  async deleteJob(id: string): Promise<void> {
    await Promise.all([
      this.redis.del(this.jobKey(id)),
      this.redis.del(this.leaseKey(id)),
      this.redis.zrem(LIVE_QUEUE_KEY, id),
    ]);
  }

  async acquireJobLease(id: string, ttlMs: number): Promise<string | null> {
    const owner = crypto.randomUUID();
    const res = await this.redis.set(this.leaseKey(id), owner, { nx: true, px: ttlMs });
    return res === 'OK' ? owner : null;
  }

  async releaseJobLease(id: string, leaseId: string): Promise<void> {
    await this.redis.eval(ATOMIC_RELEASE_LUA, [this.leaseKey(id)], [leaseId]);
  }

  async listActiveLiveJobs(): Promise<Job[]> {
    const ids = await this.redis.zrange<string[]>(LIVE_QUEUE_KEY, 0, 50);
    const jobs: Job[] = [];
    for (const id of ids) {
      const job = await this.getJob(id);
      if (job && isActiveLiveJob(job)) {
        jobs.push(job);
      } else {
        await this.redis.zrem(LIVE_QUEUE_KEY, id);
      }
    }
    return jobs;
  }

  async acquireGlobalSessionLock(ttlMs: number): Promise<string | null> {
    const owner = crypto.randomUUID();
    const res = await this.redis.set(GLOBAL_LOCK_KEY, owner, { nx: true, px: ttlMs });
    return res === 'OK' ? owner : null;
  }

  async releaseGlobalSessionLock(lockId: string): Promise<void> {
    await this.redis.eval(ATOMIC_RELEASE_LUA, [GLOBAL_LOCK_KEY], [lockId]);
  }

  async setWorkerHeartbeat(timestampMs: number): Promise<void> {
    await this.redis.set(HEARTBEAT_KEY, timestampMs, { ex: 120 });
  }

  async getWorkerHeartbeat(): Promise<number | null> {
    const val = await this.redis.get<number>(HEARTBEAT_KEY);
    return typeof val === 'number' ? val : null;
  }

  async setSessionCooldownUntil(timestampMs: number): Promise<void> {
    const ttlSec = Math.max(60, Math.ceil((timestampMs - Date.now()) / 1000) + 60);
    await this.redis.set(COOLDOWN_KEY, timestampMs, { ex: ttlSec });
  }

  async getSessionCooldownUntil(): Promise<number | null> {
    const val = await this.redis.get<number>(COOLDOWN_KEY);
    return typeof val === 'number' ? val : null;
  }

  async recordJobOutcome(outcome: 'completed' | 'failed' | 'rate_limited'): Promise<void> {
    const fieldMap = {
      completed: 'completed',
      failed: 'failed',
      rate_limited: 'rateLimited',
    } as const;
    await this.redis.hincrby(METRICS_KEY, fieldMap[outcome], 1);
  }

  async getRecentMetrics(): Promise<RecentJobMetrics> {
    const data = (await this.redis.hgetall<Record<string, number>>(METRICS_KEY)) ?? {};
    return buildRecentJobMetrics(
      Number(data.completed ?? 0),
      Number(data.failed ?? 0),
      Number(data.rateLimited ?? 0)
    );
  }
}
