import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractJobToken,
  generateSecretToken,
  getJobCookieName,
  getProviderMode,
  hashSecret,
  setJobTokenCookie,
  setOperatorCookie,
  timingSafeEqualHex,
  verifyJobToken,
  verifyOperatorAccess,
} from '@/lib/auth';
import {
  appendUniquePhonesToJob,
  applyOutcomeToItem,
  computeJobStats,
  createNewJobRecord,
  MAX_CHUNK_SIZE,
  runSandboxJobStep,
  toPublicJobView,
  transitionJobToActive,
} from '@/lib/job-engine';
import { FileJobStore } from '@/lib/job-store/file-store';
import { UpstashRedisJobStore } from '@/lib/job-store/upstash-store';
import { getJobStore, getStorageMode } from '@/lib/job-store';
import { logError, logInfo, redactSensitiveText } from '@/lib/logger';
import { parseE164Phone } from '@/lib/phone-normalizer';
import type { JobItem } from '@/lib/types';

describe('auth & boundary security invariants', () => {
  afterEach(() => {
    delete process.env.PROVIDER_MODE;
    delete process.env.OPERATOR_ACCESS_KEY;
  });

  it('validates hex digests in constant time and rejects length/empty/malformed mismatches', () => {
    const h1 = hashSecret('token-a');
    const h2 = hashSecret('token-b');
    expect(timingSafeEqualHex(h1, h1)).toBe(true);
    expect(timingSafeEqualHex(h1, h2)).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(false);
    expect(timingSafeEqualHex(h1, h1.slice(0, 10))).toBe(false);
    expect(timingSafeEqualHex('zzzz', 'zzzz')).toBe(false);
    expect(generateSecretToken()).toMatch(/^[a-f0-9]{64}$/);
  });

  it('sanitizes job cookie names and resolves x-job-token header before cookie', () => {
    expect(getJobCookieName('../job-123!@#')).toBe('tgnaydi_job_job-123');

    const reqWithHeader = new NextRequest('http://localhost/api/jobs/abc', {
      headers: {
        'x-job-token': ' header-secret ',
        cookie: 'tgnaydi_job_abc=cookie-secret',
      },
    });
    expect(extractJobToken(reqWithHeader, 'abc')).toBe('header-secret');

    const reqWithCookie = new NextRequest('http://localhost/api/jobs/abc', {
      headers: { cookie: 'tgnaydi_job_abc=cookie-secret' },
    });
    expect(extractJobToken(reqWithCookie, 'abc')).toBe('cookie-secret');

    const reqEmpty = new NextRequest('http://localhost/api/jobs/abc');
    expect(extractJobToken(reqEmpty, 'abc')).toBeNull();

    const hash = hashSecret('cookie-secret');
    expect(verifyJobToken(hash, 'cookie-secret')).toBe(true);
    expect(verifyJobToken(hash, 'wrong-secret')).toBe(false);
    expect(verifyJobToken(hash, null)).toBe(false);
  });

  it('sets HttpOnly SameSite=Lax cookies for job tokens and operator sessions', () => {
    const res = NextResponse.json({ ok: true });
    setJobTokenCookie(res, 'job-1', 'raw-tok');
    setOperatorCookie(res, 'op-key');
    const jobCookie = res.cookies.get('tgnaydi_job_job-1');
    const opCookie = res.cookies.get('tgnaydi_operator');
    expect(jobCookie?.value).toBe('raw-tok');
    expect(jobCookie?.httpOnly).toBe(true);
    expect(jobCookie?.sameSite).toBe('lax');
    expect(jobCookie?.path).toBe('/');
    expect(jobCookie?.secure).toBe(false);
    expect(jobCookie?.maxAge).toBe(86_400);
    expect(opCookie?.value).toBe(hashSecret('op-key'));
    expect(opCookie?.httpOnly).toBe(true);
    expect(opCookie?.path).toBe('/');
    expect(opCookie?.maxAge).toBe(43_200);

    // Production env MUST set secure: true
    vi.stubEnv('NODE_ENV', 'production');
    const prodRes = NextResponse.json({ ok: true });
    setJobTokenCookie(prodRes, 'job-2', 'raw-tok');
    expect(prodRes.cookies.get('tgnaydi_job_job-2')?.secure).toBe(true);
    vi.unstubAllEnvs();
  });

  it('enforces fail-closed operator access in LIVE_MTPROTO via header or cookie', () => {
    process.env.PROVIDER_MODE = 'SANDBOX';
    expect(getProviderMode()).toBe('SANDBOX');
    expect(verifyOperatorAccess(new NextRequest('http://localhost/api/jobs'))).toBe(true);

    process.env.PROVIDER_MODE = 'LIVE_MTPROTO';
    expect(getProviderMode()).toBe('LIVE_MTPROTO');
    // Unset OPERATOR_ACCESS_KEY -> fail closed
    expect(verifyOperatorAccess(new NextRequest('http://localhost/api/jobs'))).toBe(false);

    process.env.OPERATOR_ACCESS_KEY = '  op-secret-123  ';
    expect(
      verifyOperatorAccess(
        new NextRequest('http://localhost/api/jobs', { headers: { 'x-operator-key': 'op-secret-123' } })
      )
    ).toBe(true);
    expect(
      verifyOperatorAccess(
        new NextRequest('http://localhost/api/jobs', { headers: { 'x-operator-key': 'wrong' } })
      )
    ).toBe(false);
    expect(
      verifyOperatorAccess(
        new NextRequest('http://localhost/api/jobs', {
          headers: { cookie: `tgnaydi_operator=${hashSecret('op-secret-123')}` },
        })
      )
    ).toBe(true);
    expect(
      verifyOperatorAccess(
        new NextRequest('http://localhost/api/jobs', {
          headers: { cookie: `tgnaydi_operator=${hashSecret('wrong')}` },
        })
      )
    ).toBe(false);
  });
});

describe('logger recursive PII redaction & console wrappers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs sanitized messages and recursively redacts nested PII, arrays, and deep objects', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logInfo('Plain message for +79051234567');
    expect(infoSpy).toHaveBeenLastCalledWith('[tg-naydi] Plain message for [REDACTED_PHONE]');

    const deepObj = { a: { b: { c: { d: { e: { f: { g: 'too-deep' } } } } } } };
    logInfo('With meta', {
      phone: '+79051234567',
      nested: { session: 'abc', items: ['call +7 905 123-45-67', 42] },
      deepObj,
    });
    const metaArg = infoSpy.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(metaArg.phone).toBe('[REDACTED]');
    expect((metaArg.nested as Record<string, unknown>).session).toBe('[REDACTED]');
    expect((metaArg.nested as Record<string, unknown>).items).toEqual([
      'call [REDACTED_PHONE]',
      42,
    ]);
    expect(JSON.stringify(metaArg.deepObj)).toContain('[TRUNCATED]');

    logError('Err with Error', new Error('Failed +79051234567'), { token: 'secret' });
    expect(errSpy.mock.calls.at(-1)?.[0]).toBe('[tg-naydi] Err with Error');
    expect(errSpy.mock.calls.at(-1)?.[1]).toEqual({
      token: '[REDACTED]',
      error: 'Failed [REDACTED_PHONE]',
    });

    logError('Err with string', 'raw string TELEGRAM_API_HASH=abc123');
    expect(errSpy.mock.calls.at(-1)?.[1]).toEqual({
      error: 'raw string TELEGRAM_API_HASH=[REDACTED_SECRET]',
    });

    logError('Err without cause');
    expect(errSpy.mock.calls.at(-1)?.[1]).toEqual({});
    expect(redactSensitiveText('jobToken:mysecretvalue')).toBe('jobToken:[REDACTED_SECRET]');
    expect(redactSensitiveText('call 8 905 123-45-67 now')).toBe('call [REDACTED_PHONE] now');
    expect(redactSensitiveText('telegram_session=lowercase_secret')).toBe(
      'telegram_session=[REDACTED_SECRET]'
    );
    // Exact depth 5 survives, depth 6 truncates
    const depth5 = { l1: { l2: { l3: { l4: { l5: 'ok-at-5' } } } } };
    logInfo('Depth boundary', depth5);
    const d5Meta = infoSpy.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(JSON.stringify(d5Meta)).toContain('ok-at-5');
    expect(JSON.stringify(d5Meta)).not.toContain('[TRUNCATED]');
  });
});

describe('job-store factory selection', () => {
  afterEach(() => {
    delete process.env.VERCEL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('requires BOTH Upstash URL and token, otherwise uses FileJobStore locally and fails closed on Vercel', () => {
    delete process.env.VERCEL;
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(getStorageMode()).toBe('file');
    expect(getJobStore()).toBeInstanceOf(FileJobStore);

    process.env.UPSTASH_REDIS_REST_URL = '   ';
    process.env.UPSTASH_REDIS_REST_TOKEN = '   ';
    expect(getStorageMode()).toBe('file');

    process.env.UPSTASH_REDIS_REST_URL = '  https://example.upstash.io  ';
    process.env.UPSTASH_REDIS_REST_TOKEN = '  tok-123  ';
    expect(getStorageMode()).toBe('upstash');
    expect(getJobStore()).toBeInstanceOf(UpstashRedisJobStore);

    process.env.VERCEL = '1';
    delete process.env.UPSTASH_REDIS_REST_URL;
    expect(getStorageMode()).toBe('unconfigured');
    expect(getJobStore()).toBeNull();
  });
});

describe('job-engine boundary & state-machine invariants', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('computes stats accurately across every discriminated JobItem state', () => {
    const p = (n: string) => parseE164Phone(n)!;
    const items: JobItem[] = [
      { index: 0, phone: p('+79051110001'), maskedPhone: 'm1', status: 'pending' },
      { index: 1, phone: p('+79051110002'), maskedPhone: 'm2', status: 'checking' },
      { index: 2, phone: p('+79051110003'), maskedPhone: 'm3', status: 'found', username: '@u1', accountType: 'person' },
      { index: 3, phone: p('+79051110004'), maskedPhone: 'm4', status: 'found', username: '@ch1', accountType: 'channel' },
      { index: 4, phone: p('+79051110005'), maskedPhone: 'm5', status: 'found', username: '@b1', accountType: 'bot' },
      { index: 5, phone: p('+79051110006'), maskedPhone: 'm6', status: 'found_no_username', accountType: 'person' },
      { index: 6, phone: p('+79051110007'), maskedPhone: 'm7', status: 'not_found_or_hidden' },
      { index: 7, phone: p('+79051110008'), maskedPhone: 'm8', status: 'error', errorCode: 'E1' },
    ];

    const stats = computeJobStats(items);
    expect(stats).toEqual({
      total: 8,
      processed: 6,
      pending: 2,
      foundWithUsername: 3,
      personWithUsername: 1,
      channelWithUsername: 1,
      botWithUsername: 1,
      foundNoUsername: 1,
      notFoundOrHidden: 1,
      errors: 1,
    });
  });

  it('clamps config bounds, validates chunks, filters public view, and enforces cooldown transitions', () => {
    const sandboxJob = createNewJobRecord({
      tokenHash: 'h',
      fileName: '',
      providerMode: 'SANDBOX',
      batchSize: Number.NaN,
      pauseMs: 10,
      defaultCountry: 'RU',
      totalSourceRows: -5,
      duplicatesRemoved: -1,
      invalidRows: -2,
    });
    expect(sandboxJob.fileName).toBe('contacts.csv');
    expect(sandboxJob.batchSize).toBe(5);
    expect(sandboxJob.pauseMs).toBe(100);
    expect(sandboxJob.totalSourceRows).toBe(0);
    expect(sandboxJob.duplicatesRemoved).toBe(0);
    expect(sandboxJob.invalidRows).toBe(0);

    const cappedSandbox = createNewJobRecord({
      tokenHash: 'h',
      fileName: 'a'.repeat(200),
      providerMode: 'SANDBOX',
      batchSize: 99,
      pauseMs: 999_999,
      defaultCountry: 'RU',
      totalSourceRows: 10,
      duplicatesRemoved: 0,
      invalidRows: 0,
    });
    expect(cappedSandbox.fileName.length).toBe(120);
    expect(cappedSandbox.batchSize).toBe(25);
    expect(cappedSandbox.pauseMs).toBe(60_000);

    const added = appendUniquePhonesToJob(sandboxJob, [
      '+79051110001',
      '+79051110001', // dup
      'not-e164',
      '+79051110002',
    ]);
    expect(added.added).toBe(2);

    // Oversized chunk rejected
    expect(() =>
      appendUniquePhonesToJob(sandboxJob, Array.from({ length: MAX_CHUNK_SIZE + 1 }, () => '+79051110003'))
    ).toThrow(/exceeds limit/);

    // Apply outcomes & test public view filters + pagination bounds
    sandboxJob.items[0] = applyOutcomeToItem(
      sandboxJob.items[0],
      { status: 'found', username: '@p1', accountType: 'person' },
      '2026-11-20T00:00:00Z'
    );
    sandboxJob.items[1] = applyOutcomeToItem(
      sandboxJob.items[1],
      { status: 'error', errorCode: 'BOOM' },
      '2026-11-20T00:00:00Z'
    );
    expect(toPublicJobView(sandboxJob, { filter: 'found' }).totalItems).toBe(1);
    expect(toPublicJobView(sandboxJob, { filter: 'person' }).totalItems).toBe(1);
    expect(toPublicJobView(sandboxJob, { filter: 'channel' }).totalItems).toBe(0);
    expect(toPublicJobView(sandboxJob, { filter: 'bot' }).totalItems).toBe(0);
    expect(toPublicJobView(sandboxJob, { offset: 1, limit: 1 }).items).toHaveLength(1);
    expect(toPublicJobView(sandboxJob, { offset: 1, limit: 1 }).items[0].index).toBe(1);
    expect(toPublicJobView(sandboxJob).retryAfterSec).toBeUndefined();
    expect(toPublicJobView(sandboxJob, { offset: -5, limit: 9999 }).limit).toBe(500);
    expect(toPublicJobView(sandboxJob, { offset: 0, limit: 0 }).limit).toBe(1);

    // Enforces exact MAX_JOB_PHONES (10,000) ceiling
    const bigJob = createNewJobRecord({
      tokenHash: 'h',
      fileName: 'big.csv',
      providerMode: 'SANDBOX',
      batchSize: 5,
      pauseMs: 200,
      defaultCountry: 'RU',
      totalSourceRows: 10_001,
      duplicatesRemoved: 0,
      invalidRows: 0,
    });
    for (let start = 0; start < 10_000; start += 500) {
      const chunk = Array.from(
        { length: 500 },
        (_, j) => `+7900${String(start + j).padStart(7, '0')}`
      );
      appendUniquePhonesToJob(bigJob, chunk);
    }
    expect(bigJob.items).toHaveLength(10_000);
    expect(() => appendUniquePhonesToJob(bigJob, ['+79999999999'])).toThrow(/maximum allowed 10000/);

    // Transition checks
    const tNow = 1_700_000_000_000;
    sandboxJob.status = 'rate_limited';
    sandboxJob.retryAfterAt = new Date(tNow + 5000).toISOString();
    expect(transitionJobToActive(sandboxJob, ['paused'], tNow)).toEqual({ ok: true, job: sandboxJob });
    expect(transitionJobToActive(sandboxJob, ['rate_limited'], tNow)).toEqual({
      ok: false,
      retryAfterSec: 5,
      job: sandboxJob,
    });
    const resumed = transitionJobToActive(sandboxJob, ['rate_limited'], tNow + 6000);
    expect(resumed.ok).toBe(true);
    expect(sandboxJob.status).toBe('running');
    expect(sandboxJob.retryAfterAt).toBeUndefined();

    // Non-draft chunk append rejected
    expect(() => appendUniquePhonesToJob(sandboxJob, ['+79051110009'])).toThrow(/draft/);
  });

  it('handles missing job, busy lease, empty pending completion, and expired rate_limited recovery in runSandboxJobStep', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tgnaydi-engine-'));
    dirs.push(dir);
    const store = new FileJobStore(dir);

    expect(await runSandboxJobStep(store, 'nonexistent')).toBeNull();

    const job = createNewJobRecord({
      tokenHash: 'h',
      fileName: 'edge.csv',
      providerMode: 'SANDBOX',
      batchSize: 1,
      pauseMs: 200,
      defaultCountry: 'RU',
      totalSourceRows: 2,
      duplicatesRemoved: 0,
      invalidRows: 0,
    });
    appendUniquePhonesToJob(job, ['+79051114567', '+79632226543']);
    job.status = 'paused';
    await store.saveJob(job);

    // Paused job -> no-op ok
    const pausedStep = await runSandboxJobStep(store, job.id);
    expect(pausedStep?.kind).toBe('ok');
    expect(pausedStep?.job.stats.processed).toBe(0);

    // Expired rate_limited with pending items -> auto-resumes to running
    job.status = 'rate_limited';
    job.retryAfterAt = new Date(Date.now() - 1000).toISOString();
    await store.saveJob(job);
    const recoveredStep = await runSandboxJobStep(store, job.id);
    expect(recoveredStep?.kind).toBe('ok');
    expect(recoveredStep?.job.status).toBe('running');
    expect(recoveredStep?.job.stats.processed).toBe(1);

    // Busy lease -> returns kind: 'busy'
    const lease = await store.acquireJobLease(job.id, 15_000);
    expect((await runSandboxJobStep(store, job.id))?.kind).toBe('busy');
    await store.releaseJobLease(job.id, lease!);

    // Remaining item finishes -> completed; another step on 0-pending running completes cleanly
    await runSandboxJobStep(store, job.id);
    const done = (await store.getJob(job.id))!;
    expect(done.status).toBe('completed');

    // Simulate running job with 0 pending items
    done.status = 'running';
    await store.saveJob(done);
    const zeroPending = await runSandboxJobStep(store, done.id);
    expect(zeroPending?.job.status).toBe('completed');

    // FLOOD_WAIT triggers once for +79990000429, records triggered phone, and succeeds after cooldown expires
    const floodJob = createNewJobRecord({
      tokenHash: 'h',
      fileName: 'fw.csv',
      providerMode: 'SANDBOX',
      batchSize: 5,
      pauseMs: 200,
      defaultCountry: 'RU',
      totalSourceRows: 2,
      duplicatesRemoved: 0,
      invalidRows: 0,
    });
    appendUniquePhonesToJob(floodJob, ['+79051114567', '+79990000429']);
    floodJob.status = 'running';
    await store.saveJob(floodJob);
    const fw1 = await runSandboxJobStep(store, floodJob.id);
    expect(fw1?.job.status).toBe('rate_limited');
    expect(fw1?.job.floodWaitTriggeredPhones).toContain('+79990000429');

    // Expire cooldown -> second step completes cleanly without infinite flood loop
    const storedFw = (await store.getJob(floodJob.id))!;
    storedFw.retryAfterAt = new Date(Date.now() - 1000).toISOString();
    await store.saveJob(storedFw);
    const fw2 = await runSandboxJobStep(store, floodJob.id);
    expect(fw2?.kind).toBe('ok');
    expect(fw2?.job.status).toBe('completed');
    expect(fw2?.job.retryAfterAt).toBeUndefined();
  });
});
