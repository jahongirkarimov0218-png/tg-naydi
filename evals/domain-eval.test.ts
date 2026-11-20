/**
 * TG Naydi — 15-Case Deterministic Domain & Policy Eval Suite (Stage 08).
 *
 * Run via: pnpm run eval:domain
 * Every incident resolved in production is appended here as a permanent regression case.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeCsvBytes, parseCsvBuffer } from '@/lib/csv-parser';
import { buildResultCsv, sanitizeCsvCell } from '@/lib/csv-exporter';
import { maskPhone, normalizePhone } from '@/lib/phone-normalizer';
import { redactSensitiveText } from '@/lib/logger';
import { KAZAN_SAMPLE_CSV_BYTES } from '@/lib/sample-data';
import { SandboxLookupProvider } from '@/lib/providers/sandbox';
import { MtprotoLookupProvider, type MtprotoClientLike } from '@/lib/providers/mtproto';
import { FileJobStore } from '@/lib/job-store/file-store';
import { getJobStore, getStorageMode } from '@/lib/job-store';
import {
  appendUniquePhonesToJob,
  computeJobStats,
  createNewJobRecord,
  runSandboxJobStep,
  toPublicJobView,
} from '@/lib/job-engine';
import { evaluateHealthAnomaly } from '../scripts/monitoring/anomaly_detector.mjs';
import { POST as createJobPOST } from '@/app/api/jobs/route';
import { GET as getJobGET } from '@/app/api/jobs/[id]/route';

function encodeCp1251(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) out.push(code);
    else if (code >= 0x0410 && code <= 0x044f) out.push(code - 0x0410 + 0xc0);
    else if (code === 0x0401) out.push(0xa8);
    else if (code === 0x0451) out.push(0xb8);
    else out.push(0x3f);
  }
  return new Uint8Array(out);
}

describe('TG Naydi Domain & Policy Evals (15 real cases)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tgnaydi-eval-'));
    process.env.TGNAYDI_DATA_DIR = tmpDir;
    process.env.PROVIDER_MODE = 'SANDBOX';
    delete process.env.VERCEL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(async () => {
    delete process.env.TGNAYDI_DATA_DIR;
    delete process.env.VERCEL;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('EVAL-01: decodes Russian Windows-1251 Excel CSV without mojibake', () => {
    const bytes = encodeCp1251('Клиент;Телефон\r\nОльга;8 (905) 111-45-67\r\n');
    const decoded = decodeCsvBytes(bytes);
    expect(decoded.encoding).toBe('windows-1251');
    expect(decoded.text).toContain('Клиент;Телефон');
  });

  it('EVAL-02: auto-detects semicolon delimiter and Russian phone column', () => {
    const bytes = encodeCp1251('Имя;Мобильный;Город\r\nАлия;+7 963 222-65-43;Казань\r\n');
    const parsed = parseCsvBuffer(bytes, 'RU');
    expect(parsed.delimiter).toBe(';');
    expect(parsed.selectedColumn).toBe('Мобильный');
    expect(parsed.uniquePhones).toEqual(['+79632226543']);
  });

  it('EVAL-03: normalizes RU 8-prefix, 10-digit, and UZ +998 formats cleanly', () => {
    expect(normalizePhone('8 (905) 123-45-67', 'RU')).toBe('+79051234567');
    expect(normalizePhone('9051234567', 'RU')).toBe('+79051234567');
    expect(normalizePhone('+998 (90) 123-45-67', 'RU')).toBe('+998901234567');
  });

  it('EVAL-04: deduplicates mixed-format duplicates while keeping source row audit counts', () => {
    const parsed = parseCsvBuffer(KAZAN_SAMPLE_CSV_BYTES, 'RU');
    expect(parsed.totalRows).toBe(25);
    expect(parsed.uniquePhones).toHaveLength(22);
    expect(parsed.duplicatesRemoved).toBe(2);
    expect(parsed.invalidRows).toBe(1);
  });

  it('EVAL-05: persists paused state in FileJobStore and survives simulated F5 reload', async () => {
    const store = new FileJobStore(tmpDir);
    const job = createNewJobRecord({
      tokenHash: 'h',
      fileName: 'kzn.csv',
      providerMode: 'SANDBOX',
      batchSize: 2,
      pauseMs: 200,
      defaultCountry: 'RU',
      totalSourceRows: 4,
      duplicatesRemoved: 0,
      invalidRows: 0,
    });
    appendUniquePhonesToJob(job, ['+79051114567', '+79632226543', '+79213331234', '+79994442233']);
    job.status = 'running';
    await store.saveJob(job);

    await runSandboxJobStep(store, job.id);
    const afterStep = (await store.getJob(job.id))!;
    afterStep.status = 'paused';
    await store.saveJob(afterStep);

    // Fresh store instance simulating server restart / F5 reload
    const freshStore = new FileJobStore(tmpDir);
    const reloaded = (await freshStore.getJob(job.id))!;
    expect(reloaded.status).toBe('paused');
    expect(reloaded.stats.processed).toBe(2);
    expect(reloaded.stats.pending).toBe(2);
  });

  it('EVAL-06: respects FLOOD_WAIT with rate_limited cooldown instead of bypassing rate limits', async () => {
    const store = new FileJobStore(tmpDir);
    const job = createNewJobRecord({
      tokenHash: 'h',
      fileName: 'flood.csv',
      providerMode: 'SANDBOX',
      batchSize: 5,
      pauseMs: 200,
      defaultCountry: 'RU',
      totalSourceRows: 2,
      duplicatesRemoved: 0,
      invalidRows: 0,
    });
    appendUniquePhonesToJob(job, ['+79051114567', '+79990000429']);
    job.status = 'running';
    await store.saveJob(job);

    const step1 = await runSandboxJobStep(store, job.id);
    expect(step1?.kind).toBe('ok');
    expect(step1?.job.status).toBe('rate_limited');
    expect(step1?.job.retryAfterAt).toBeDefined();

    const step2 = await runSandboxJobStep(store, job.id);
    expect(step2?.kind).toBe('rate_limited');
  });

  it('EVAL-07: classifies channel strictly via personalChannelId and always calls deleteContacts', async () => {
    const deleteContacts = vi.fn().mockResolvedValue(undefined);
    const mockClient: MtprotoClientLike = {
      importContacts: vi.fn().mockResolvedValue([
        { clientId: '1', phone: '+79051110002', userId: '2', accessHash: 'a2', username: 'owner', bot: false },
      ]),
      getPersonalChannelUsername: vi.fn().mockResolvedValue('brand_channel'),
      deleteContacts,
    };
    const provider = new MtprotoLookupProvider(mockClient);
    const out = await provider.lookupBatch(['+79051110002']);
    expect(out.items['+79051110002']).toEqual({
      status: 'found',
      username: '@brand_channel',
      accountType: 'channel',
      personalUsername: '@owner',
      linkedChannel: '@brand_channel',
    });
    expect(deleteContacts).toHaveBeenCalledTimes(1);
  });

  it('EVAL-08: preserves counter reconciliation invariant (found === person + channel + bot)', async () => {
    const provider = new SandboxLookupProvider();
    const parsed = parseCsvBuffer(KAZAN_SAMPLE_CSV_BYTES, 'RU');
    const batch = await provider.lookupBatch(parsed.uniquePhones);
    const items = parsed.uniquePhones.map((phone, index) => {
      const outcome = batch.items[phone];
      return {
        index,
        phone,
        maskedPhone: maskPhone(phone),
        status: outcome.status,
        username: outcome.status === 'found' ? outcome.username : undefined,
        accountType: outcome.status === 'found' || outcome.status === 'found_no_username' ? outcome.accountType : undefined,
      };
    });
    const stats = computeJobStats(items);
    expect(stats.foundWithUsername).toBe(
      stats.personWithUsername + stats.channelWithUsername + stats.botWithUsername
    );
    expect(stats.foundWithUsername).toBe(19);
    expect(stats.personWithUsername).toBe(14);
    expect(stats.channelWithUsername).toBe(5);
  });

  it('EVAL-09: neutralizes CSV formula injection while keeping valid E.164 and @username intact', () => {
    expect(sanitizeCsvCell('=HYPERLINK("http://x","y")')).toBe('\'=HYPERLINK("http://x","y")');
    expect(sanitizeCsvCell('@SUM(A1:A5)')).toBe("'@SUM(A1:A5)");
    expect(sanitizeCsvCell('+79051114567')).toBe('+79051114567');
    expect(sanitizeCsvCell('@beze_cakes_kzn')).toBe('@beze_cakes_kzn');
  });

  it('EVAL-10: redacts raw phones and secrets in logs and masks all phones in public API view', () => {
    const safeLog = redactSensitiveText('Error on +79051114567 TELEGRAM_SESSION=secret123456');
    expect(safeLog).not.toContain('79051114567');
    expect(safeLog).not.toContain('secret123456');

    const job = createNewJobRecord({
      tokenHash: 'h',
      fileName: 'pii.csv',
      providerMode: 'SANDBOX',
      batchSize: 5,
      pauseMs: 200,
      defaultCountry: 'RU',
      totalSourceRows: 1,
      duplicatesRemoved: 0,
      invalidRows: 0,
    });
    appendUniquePhonesToJob(job, ['+79051114567']);
    const publicJson = JSON.stringify(toPublicJobView(job));
    expect(publicJson).not.toContain('+79051114567');
    expect(publicJson).toContain('+7 905 •••-45-67');
  });

  it('EVAL-11: uses unified honest not_found_or_hidden status and stamps mode in UTF-8 BOM CSV', () => {
    const job = createNewJobRecord({
      tokenHash: 'h',
      fileName: 'honest.csv',
      providerMode: 'SANDBOX',
      batchSize: 5,
      pauseMs: 200,
      defaultCountry: 'RU',
      totalSourceRows: 1,
      duplicatesRemoved: 0,
      invalidRows: 0,
    });
    appendUniquePhonesToJob(job, ['+79176151010']);
    job.items[0].status = 'not_found_or_hidden';
    const csv = buildResultCsv(job, { delimiter: ';', onlyFound: false });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('не найден / скрыт;not_found_or_hidden;;;SANDBOX;');
  });

  it('EVAL-12: enforces cookie auth on GET /api/jobs/[id] (blocks unauthorized PII access)', async () => {
    const createRes = await createJobPOST(
      new NextRequest('http://localhost/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: 'private.csv' }),
      })
    );
    const { job } = await createRes.json();
    const res = await getJobGET(new NextRequest(`http://localhost/api/jobs/${job.id}`), {
      params: Promise.resolve({ id: job.id }),
    });
    expect(res.status).toBe(401);
  });

  it('EVAL-13: fails closed on Vercel when Upstash Redis credentials are missing', () => {
    process.env.VERCEL = '1';
    expect(getStorageMode()).toBe('unconfigured');
    expect(getJobStore()).toBeNull();
  });

  it('EVAL-14: PreToolUse hook mechanically blocks secret access and direct push to main (exit 2)', () => {
    const output = execFileSync('python', ['scripts/verify_guards.py'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    expect(output).toContain('ALL ADVERSARIAL GUARD CHECKS PASSED.');
  });

  it('EVAL-15: Maintain-loop anomaly detector escalates Level-3 breach to intent generation', () => {
    const baseline = [
      { status: 'ok', errorRate: 0.01, latencyMs: 100, timestamp: '2026-11-20T01:00:00Z' },
      { status: 'ok', errorRate: 0.01, latencyMs: 102, timestamp: '2026-11-20T02:00:00Z' },
      { status: 'ok', errorRate: 0.01, latencyMs: 98, timestamp: '2026-11-20T03:00:00Z' },
    ];
    const evalRes = evaluateHealthAnomaly(baseline, {
      status: 'ok',
      errorRate: 0.15,
      latencyMs: 110,
    });
    expect(evalRes.level).toBe(3);
    expect(evalRes.action).toBe('create_incident_intent');
  });
});
