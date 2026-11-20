import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileJobStore } from '@/lib/job-store/file-store';
import { appendUniquePhonesToJob, createNewJobRecord } from '@/lib/job-engine';
import type { TelegramLookupProvider } from '@/lib/providers/types';
import {
  computeNextPollDelayMs,
  processNextLiveBatch,
  readWorkerEnvConfig,
} from '../../worker/live-processor';
import {
  extractPersonalChannelUsername,
  mapImportedTelegramUsers,
} from '../../worker/gramjs-adapter';

describe('Live MTProto worker processor (behavioral tests)', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function makeStore(): Promise<FileJobStore> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tgnaydi-worker-'));
    dirs.push(dir);
    return new FileJobStore(dir);
  }

  function createQueuedLiveJob(fileName: string, phones: string[]) {
    const job = createNewJobRecord({
      tokenHash: 'hash',
      fileName,
      providerMode: 'LIVE_MTPROTO',
      batchSize: 2,
      pauseMs: 15_000,
      defaultCountry: 'RU',
      totalSourceRows: phones.length,
      duplicatesRemoved: 0,
      invalidRows: 0,
    });
    appendUniquePhonesToJob(job, phones);
    job.status = 'queued';
    return job;
  }

  it('enforces session-wide FLOOD_WAIT cooldown across ALL queued live jobs', async () => {
    const store = await makeStore();
    const job1 = createQueuedLiveJob('job1.csv', ['+79051110001', '+79051110002']);
    const job2 = createQueuedLiveJob('job2.csv', ['+79051110003']);
    job1.createdAt = '2026-11-20T06:00:00.000Z';
    job2.createdAt = '2026-11-20T06:01:00.000Z';
    await store.saveJob(job1);
    await store.saveJob(job2);

    const provider: TelegramLookupProvider = {
      mode: 'LIVE_MTPROTO',
      lookupBatch: vi.fn().mockResolvedValue({
        items: { '+79051110001': { status: 'found', username: '@first', accountType: 'person' } },
        floodWaitSeconds: 120,
      }),
    };

    const t0 = 1_700_000_000_000;
    const tick1 = await processNextLiveBatch(store, provider, t0);
    expect(tick1.kind).toBe('processed');
    expect((await store.getJob(job1.id))?.status).toBe('rate_limited');

    // Immediately attempting next tick MUST respect session-wide cooldown and NOT run job2
    const tick2 = await processNextLiveBatch(store, provider, t0 + 10_000);
    expect(tick2.kind).toBe('cooldown');
    expect(provider.lookupBatch).toHaveBeenCalledTimes(1);
    expect((await store.getJob(job2.id))?.status).toBe('queued');
  });

  it('never resurrects deleted PII when DELETE races with an in-flight batch', async () => {
    const store = await makeStore();
    const job = createQueuedLiveJob('delete-race.csv', ['+79051110001']);
    await store.saveJob(job);

    const provider: TelegramLookupProvider = {
      mode: 'LIVE_MTPROTO',
      lookupBatch: vi.fn().mockImplementation(async () => {
        // Simulate user clicking "Удалить базу" while MTProto RPC is in flight
        await store.deleteJob(job.id);
        return {
          items: { '+79051110001': { status: 'found', username: '@ghost', accountType: 'person' } },
        };
      }),
    };

    const tick = await processNextLiveBatch(store, provider, Date.now());
    expect(tick.kind).toBe('idle');
    expect(await store.getJob(job.id)).toBeNull();
  });

  it('preserves concurrent PAUSE while saving processed batch items', async () => {
    const store = await makeStore();
    const job = createQueuedLiveJob('pause-race.csv', ['+79051110001', '+79051110002', '+79051110003']);
    await store.saveJob(job);

    const provider: TelegramLookupProvider = {
      mode: 'LIVE_MTPROTO',
      lookupBatch: vi.fn().mockImplementation(async () => {
        const current = (await store.getJob(job.id))!;
        current.status = 'paused';
        await store.saveJob(current);
        return {
          items: {
            '+79051110001': { status: 'found', username: '@one', accountType: 'person' },
            '+79051110002': { status: 'not_found_or_hidden' },
          },
        };
      }),
    };

    const tick = await processNextLiveBatch(store, provider, Date.now());
    expect(tick.kind).toBe('processed');
    const saved = (await store.getJob(job.id))!;
    expect(saved.status).toBe('paused');
    expect(saved.stats.processed).toBe(2);
    expect(saved.stats.pending).toBe(1);
  });

  it('marks job failed with redacted lastError on unrecoverable provider exception', async () => {
    const store = await makeStore();
    const job = createQueuedLiveJob('fail.csv', ['+79051110001']);
    await store.saveJob(job);

    const provider: TelegramLookupProvider = {
      mode: 'LIVE_MTPROTO',
      lookupBatch: vi.fn().mockRejectedValue(
        new Error('AUTH_KEY_UNREGISTERED for +79051110001 TELEGRAM_SESSION=secret12345')
      ),
    };

    const tick = await processNextLiveBatch(store, provider, Date.now());
    expect(tick.kind).toBe('failed');
    const saved = (await store.getJob(job.id))!;
    expect(saved.status).toBe('failed');
    expect(saved.lastError).not.toContain('79051110001');
    expect(saved.lastError).not.toContain('secret12345');
    expect((await store.getRecentMetrics()).recentJobsFailed).toBe(1);
  });

  it('returns idle when no active jobs and locked when global session mutex is held', async () => {
    const store = await makeStore();
    const provider: TelegramLookupProvider = {
      mode: 'LIVE_MTPROTO',
      lookupBatch: vi.fn(),
    };

    expect((await processNextLiveBatch(store, provider, Date.now())).kind).toBe('idle');

    const job = createQueuedLiveJob('locked.csv', ['+79051110001']);
    await store.saveJob(job);
    const lock = await store.acquireGlobalSessionLock(60_000);
    expect((await processNextLiveBatch(store, provider, Date.now())).kind).toBe('locked');
    await store.releaseGlobalSessionLock(lock!);
  });

  it('maps GramJS imported contacts and extracts personalChannelId usernames accurately', () => {
    const mapped = mapImportedTelegramUsers(
      ['+79051110001', '+79051110002'],
      [
        { clientId: 1, userId: 101 },
        { clientId: 99, userId: 999 }, // out-of-range skipped safely
      ],
      [{ id: 101, accessHash: '555', username: 'alice', bot: false }]
    );
    expect(mapped).toEqual([
      {
        clientId: '1',
        phone: '+79051110001',
        userId: '101',
        accessHash: '555',
        username: 'alice',
        bot: false,
      },
    ]);

    expect(
      extractPersonalChannelUsername('777', [
        { id: '777', username: 'brand_ch', isChannel: true },
      ])
    ).toBe('brand_ch');
    expect(extractPersonalChannelUsername(null, [])).toBeNull();
  });

  it('computes bounded poll delays and validates required worker env config', () => {
    expect(computeNextPollDelayMs({ kind: 'cooldown', waitMs: 200 })).toBe(500);
    expect(computeNextPollDelayMs({ kind: 'cooldown', waitMs: 30_000 })).toBe(5_000);
    expect(computeNextPollDelayMs({ kind: 'locked' })).toBe(2_000);
    expect(computeNextPollDelayMs({ kind: 'processed', jobId: '1', status: 'running', pauseMs: 15_000 })).toBe(5_000);
    expect(computeNextPollDelayMs({ kind: 'processed', jobId: '1', status: 'completed', pauseMs: 0 })).toBe(500);
    expect(computeNextPollDelayMs({ kind: 'failed', jobId: '1' })).toBe(5_000);
    expect(computeNextPollDelayMs({ kind: 'idle' })).toBe(3_000);

    expect(() => readWorkerEnvConfig({})).toThrow(/Missing TELEGRAM_API_ID/);
    expect(
      readWorkerEnvConfig({
        TELEGRAM_API_ID: '12345',
        TELEGRAM_API_HASH: ' hash-abc ',
        TELEGRAM_SESSION: ' sess-xyz ',
      })
    ).toEqual({ apiId: 12345, apiHash: 'hash-abc', sessionStr: 'sess-xyz' });
  });
});
