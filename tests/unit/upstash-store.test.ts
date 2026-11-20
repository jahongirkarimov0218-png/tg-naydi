import { describe, expect, it } from 'vitest';
import {
  ATOMIC_RELEASE_LUA,
  UpstashRedisJobStore,
  type RedisLike,
} from '@/lib/job-store/upstash-store';
import { JOB_TTL_SECONDS } from '@/lib/job-store/helpers';
import { parseE164Phone } from '@/lib/phone-normalizer';
import type { Job } from '@/lib/types';

function createFakeRedis(): RedisLike & {
  kv: Map<string, { value: unknown; ex?: number; px?: number }>;
  zsets: Map<string, Map<string, number>>;
  hashes: Map<string, Record<string, number>>;
  evalCalls: Array<{ script: string; keys: string[]; args: string[] }>;
} {
  const kv = new Map<string, { value: unknown; ex?: number; px?: number }>();
  const zsets = new Map<string, Map<string, number>>();
  const hashes = new Map<string, Record<string, number>>();
  const evalCalls: Array<{ script: string; keys: string[]; args: string[] }> = [];

  return {
    kv,
    zsets,
    hashes,
    evalCalls,
    async get<T>(key: string): Promise<T | null> {
      return (kv.get(key)?.value as T | undefined) ?? null;
    },
    async set(key: string, value: unknown, opts?: { ex?: number; nx?: true; px?: number }) {
      if (opts?.nx && kv.has(key)) return null;
      kv.set(key, { value, ex: opts?.ex, px: opts?.px });
      return 'OK';
    },
    async del(...keys: string[]) {
      let count = 0;
      for (const k of keys) {
        if (kv.delete(k)) count += 1;
      }
      return count;
    },
    async zadd(key: string, { score, member }: { score: number; member: string }) {
      if (!zsets.has(key)) zsets.set(key, new Map());
      zsets.get(key)!.set(member, score);
      return 1;
    },
    async zrem(key: string, ...members: string[]) {
      const set = zsets.get(key);
      if (!set) return 0;
      let removed = 0;
      for (const m of members) {
        if (set.delete(m)) removed += 1;
      }
      return removed;
    },
    async zrange<T>(key: string, start: number, stop: number): Promise<T> {
      const set = zsets.get(key);
      if (!set) return [] as unknown as T;
      const sorted = [...set.entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
      return sorted.slice(start, stop + 1) as unknown as T;
    },
    async eval(script: string, keys: string[], args: string[]) {
      evalCalls.push({ script, keys, args });
      // Execute real compare-and-delete semantics
      const key = keys[0];
      const expected = args[0];
      if (kv.get(key)?.value === expected) {
        kv.delete(key);
        return 1;
      }
      return 0;
    },
    async hincrby(key: string, field: string, increment: number) {
      if (!hashes.has(key)) hashes.set(key, {});
      const h = hashes.get(key)!;
      h[field] = (h[field] ?? 0) + increment;
      return h[field];
    },
    async hgetall<T extends Record<string, unknown>>(key: string): Promise<T | null> {
      const h = hashes.get(key);
      return h ? ({ ...h } as unknown as T) : null;
    },
  };
}

function makeLiveJob(id: string, overrides: Partial<Job> = {}): Job {
  const now = new Date();
  return {
    id,
    tokenHash: 'hash',
    fileName: 'live.csv',
    providerMode: 'LIVE_MTPROTO',
    status: 'queued',
    batchSize: 5,
    pauseMs: 15_000,
    defaultCountry: 'RU',
    totalSourceRows: 1,
    duplicatesRemoved: 0,
    invalidRows: 0,
    items: [
      { index: 0, phone: parseE164Phone('+79051114567')!, maskedPhone: '+7 905 •••-45-67', status: 'pending' },
    ],
    stats: {
      total: 1,
      processed: 0,
      pending: 1,
      foundWithUsername: 0,
      personWithUsername: 0,
      channelWithUsername: 0,
      botWithUsername: 0,
      foundNoUsername: 0,
      notFoundOrHidden: 0,
      errors: 0,
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    ...overrides,
  };
}

describe('UpstashRedisJobStore (behavioral contract tests)', () => {
  it('saves jobs with 24h PII TTL, maintains FIFO live queue, and prunes expired/inactive jobs', async () => {
    const redis = createFakeRedis();
    const store = new UpstashRedisJobStore(redis);

    const live1 = makeLiveJob('live-1', { createdAt: '2026-11-20T06:00:00.000Z' });
    const live2 = makeLiveJob('live-2', { createdAt: '2026-11-20T06:01:00.000Z' });
    const expired = makeLiveJob('live-exp', {
      createdAt: '2026-11-20T05:00:00.000Z',
      expiresAt: new Date(Date.now() - 5000).toISOString(),
    });
    const paused = makeLiveJob('live-paused', { status: 'paused' });

    await store.saveJob(live2);
    await store.saveJob(live1);
    await store.saveJob(expired);
    await store.saveJob(paused);

    expect(redis.kv.get('tgnaydi:job:live-1')?.ex).toBe(JOB_TTL_SECONDS);

    const queue = await store.listActiveLiveJobs();
    expect(queue.map((j) => j.id)).toEqual(['live-1', 'live-2']);
    expect(await store.getJob('live-exp')).toBeNull();
    expect(await store.getJob('missing-id')).toBeNull();

    await store.deleteJob('live-1');
    expect(await store.getJob('live-1')).toBeNull();
  });

  it('uses atomic Lua compare-and-delete for per-job leases and global session locks', async () => {
    const redis = createFakeRedis();
    const store = new UpstashRedisJobStore(redis);

    const lease = await store.acquireJobLease('job-1', 15_000);
    expect(lease).not.toBeNull();
    expect(await store.acquireJobLease('job-1', 15_000)).toBeNull();

    // Wrong owner MUST NOT release the active lease
    await store.releaseJobLease('job-1', 'wrong-owner');
    expect(await store.acquireJobLease('job-1', 15_000)).toBeNull();

    // Correct owner releases via ATOMIC_RELEASE_LUA
    await store.releaseJobLease('job-1', lease!);
    expect(redis.evalCalls.at(-1)?.script).toBe(ATOMIC_RELEASE_LUA);
    expect(await store.acquireJobLease('job-1', 15_000)).not.toBeNull();

    const lock = await store.acquireGlobalSessionLock(60_000);
    expect(lock).not.toBeNull();
    expect(await store.acquireGlobalSessionLock(60_000)).toBeNull();
    await store.releaseGlobalSessionLock('wrong-owner');
    expect(await store.acquireGlobalSessionLock(60_000)).toBeNull();
    await store.releaseGlobalSessionLock(lock!);
    expect(await store.acquireGlobalSessionLock(60_000)).not.toBeNull();
  });

  it('persists worker heartbeat, session cooldown, and aggregated job metrics', async () => {
    const redis = createFakeRedis();
    const store = new UpstashRedisJobStore(redis);

    expect(await store.getWorkerHeartbeat()).toBeNull();
    expect(await store.getSessionCooldownUntil()).toBeNull();

    const now = Date.now();
    await store.setWorkerHeartbeat(now);
    await store.setSessionCooldownUntil(now + 30_000);
    expect(await store.getWorkerHeartbeat()).toBe(now);
    expect(await store.getSessionCooldownUntil()).toBe(now + 30_000);

    expect((await store.getRecentMetrics()).errorRate).toBe(0);
    await store.recordJobOutcome('completed');
    await store.recordJobOutcome('failed');
    await store.recordJobOutcome('rate_limited');
    const metrics = await store.getRecentMetrics();
    expect(metrics).toEqual({
      recentJobsTotal: 2,
      recentJobsCompleted: 1,
      recentJobsFailed: 1,
      recentFloodWaits: 1,
      errorRate: 0.5,
    });
  });
});
