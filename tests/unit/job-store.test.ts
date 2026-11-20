import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileJobStore } from '@/lib/job-store/file-store';
import { getJobStore, getStorageMode } from '@/lib/job-store';
import { parseE164Phone } from '@/lib/phone-normalizer';
import type { Job } from '@/lib/types';

function makeSampleJob(id: string, overrides: Partial<Job> = {}): Job {
  const now = new Date();
  const expires = new Date(now.getTime() + 86_400_000);
  return {
    id,
    tokenHash: 'sha256-hash-abc',
    fileName: 'база.csv',
    providerMode: 'SANDBOX',
    status: 'draft',
    batchSize: 5,
    pauseMs: 800,
    defaultCountry: 'RU',
    totalSourceRows: 2,
    duplicatesRemoved: 0,
    invalidRows: 0,
    items: [
      { index: 0, phone: parseE164Phone('+79051114567')!, maskedPhone: '+7 905 •••-45-67', status: 'pending' },
      { index: 1, phone: parseE164Phone('+79632226543')!, maskedPhone: '+7 963 •••-65-43', status: 'pending' },
    ],
    stats: {
      total: 2,
      processed: 0,
      pending: 2,
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
    expiresAt: expires.toISOString(),
    ...overrides,
  };
}

describe('FileJobStore & StorageMode', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    delete process.env.VERCEL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function createTempStore(): Promise<FileJobStore> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tgnaydi-store-'));
    dirs.push(dir);
    return new FileJobStore(dir);
  }

  it('persists, reloads, updates, and deletes jobs atomically', async () => {
    const store = await createTempStore();
    const job = makeSampleJob('job-crud-1');
    await store.saveJob(job);

    const loaded = await store.getJob('job-crud-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.fileName).toBe('база.csv');
    expect(loaded?.items).toHaveLength(2);

    await store.deleteJob('job-crud-1');
    expect(await store.getJob('job-crud-1')).toBeNull();
  });

  it('enforces exclusive per-job lease locks against concurrent /step races', async () => {
    const store = await createTempStore();
    const lease1 = await store.acquireJobLease('job-race', 15_000);
    expect(lease1).not.toBeNull();

    const lease2 = await store.acquireJobLease('job-race', 15_000);
    expect(lease2).toBeNull();

    await store.releaseJobLease('job-race', lease1!);
    const lease3 = await store.acquireJobLease('job-race', 15_000);
    expect(lease3).not.toBeNull();
    await store.releaseJobLease('job-race', lease3!);
  });

  it('supports FIFO active live jobs queue, global session mutex, heartbeat, and job metrics', async () => {
    const store = await createTempStore();
    const live1 = makeSampleJob('live-1', {
      providerMode: 'LIVE_MTPROTO',
      status: 'queued',
      createdAt: '2026-11-20T06:00:00.000Z',
    });
    const live2 = makeSampleJob('live-2', {
      providerMode: 'LIVE_MTPROTO',
      status: 'queued',
      createdAt: '2026-11-20T06:01:00.000Z',
    });
    const sandbox = makeSampleJob('sb-1', { providerMode: 'SANDBOX', status: 'running' });

    await store.saveJob(live2);
    await store.saveJob(live1);
    await store.saveJob(sandbox);

    const activeLive = await store.listActiveLiveJobs();
    expect(activeLive.map((j) => j.id)).toEqual(['live-1', 'live-2']);

    const lockA = await store.acquireGlobalSessionLock(60_000);
    expect(lockA).not.toBeNull();
    expect(await store.acquireGlobalSessionLock(60_000)).toBeNull();
    await store.releaseGlobalSessionLock(lockA!);

    const nowTs = Date.now();
    await store.setWorkerHeartbeat(nowTs);
    expect(await store.getWorkerHeartbeat()).toBe(nowTs);

    await store.recordJobOutcome('completed');
    await store.recordJobOutcome('completed');
    await store.recordJobOutcome('failed');
    await store.recordJobOutcome('rate_limited');
    const metrics = await store.getRecentMetrics();
    expect(metrics.recentJobsTotal).toBe(3);
    expect(metrics.recentJobsCompleted).toBe(2);
    expect(metrics.recentJobsFailed).toBe(1);
    expect(metrics.recentFloodWaits).toBe(1);
    expect(metrics.errorRate).toBeCloseTo(1 / 3, 4);
  });

  it('expires jobs past their 24h TTL automatically on read', async () => {
    const store = await createTempStore();
    const expired = makeSampleJob('job-expired', {
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
    });
    await store.saveJob(expired);
    expect(await store.getJob('job-expired')).toBeNull();
  });

  it('fails closed on Vercel when Upstash credentials are missing', () => {
    process.env.VERCEL = '1';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(getStorageMode()).toBe('unconfigured');
    expect(getJobStore()).toBeNull();
  });
});
