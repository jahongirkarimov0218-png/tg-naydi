import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as healthGET } from '@/app/api/health/route';
import { POST as operatorPOST } from '@/app/api/auth/operator/route';
import { POST as createJobPOST } from '@/app/api/jobs/route';
import { GET as getJobGET, DELETE as deleteJobDELETE } from '@/app/api/jobs/[id]/route';
import { POST as chunksPOST } from '@/app/api/jobs/[id]/chunks/route';
import { POST as startPOST } from '@/app/api/jobs/[id]/start/route';
import { POST as stepPOST } from '@/app/api/jobs/[id]/step/route';
import { POST as pausePOST } from '@/app/api/jobs/[id]/pause/route';
import { POST as resumePOST } from '@/app/api/jobs/[id]/resume/route';
import { GET as exportGET } from '@/app/api/jobs/[id]/export/route';

function extractCookieHeader(res: Response): string {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return '';
  return setCookie.split(';')[0];
}

describe('TG Naydi API end-to-end integration flow', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tgnaydi-api-'));
    process.env.TGNAYDI_DATA_DIR = tmpDir;
    process.env.PROVIDER_MODE = 'SANDBOX';
    delete process.env.VERCEL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.OPERATOR_ACCESS_KEY;
  });

  afterEach(async () => {
    delete process.env.TGNAYDI_DATA_DIR;
    delete process.env.PROVIDER_MODE;
    delete process.env.VERCEL;
    delete process.env.OPERATOR_ACCESS_KEY;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('runs full lifecycle (upload -> start -> step -> pause -> F5 reload -> resume -> export -> delete) with strict PII masking and cookie auth', async () => {
    // 1. Create job
    const createReq = new NextRequest('http://localhost/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileName: 'Контакты Казани.csv',
        batchSize: 2,
        pauseMs: 500,
        defaultCountry: 'RU',
        totalSourceRows: 5,
        duplicatesRemoved: 1,
        invalidRows: 0,
      }),
    });
    const createRes = await createJobPOST(createReq);
    expect(createRes.status).toBe(201);
    const cookie = extractCookieHeader(createRes);
    expect(cookie).toContain('tgnaydi_job_');
    const created = await createRes.json();
    const jobId: string = created.job.id;

    // Unauthorized access without cookie must return 401
    const unauthRes = await getJobGET(new NextRequest(`http://localhost/api/jobs/${jobId}`), {
      params: Promise.resolve({ id: jobId }),
    });
    expect(unauthRes.status).toBe(401);

    // 2. Append chunks
    const chunkRes = await chunksPOST(
      new NextRequest(`http://localhost/api/jobs/${jobId}/chunks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          phones: ['+79051114567', '+79632226543', '+79213331234', '+79176151010'],
        }),
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(chunkRes.status).toBe(200);

    // 3. Start & process 1 batch of 2
    const startRes = await startPOST(
      new NextRequest(`http://localhost/api/jobs/${jobId}/start`, {
        method: 'POST',
        headers: { cookie },
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(startRes.status).toBe(200);

    const step1Res = await stepPOST(
      new NextRequest(`http://localhost/api/jobs/${jobId}/step`, {
        method: 'POST',
        headers: { cookie },
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(step1Res.status).toBe(200);
    const afterStep1 = await step1Res.json();
    expect(afterStep1.job.stats.processed).toBe(2);
    expect(afterStep1.job.stats.pending).toBe(2);

    // 4. Pause & simulate F5 reload GET
    const pauseRes = await pausePOST(
      new NextRequest(`http://localhost/api/jobs/${jobId}/pause`, {
        method: 'POST',
        headers: { cookie },
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(pauseRes.status).toBe(200);

    const reloadRes = await getJobGET(
      new NextRequest(`http://localhost/api/jobs/${jobId}`, { headers: { cookie } }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(reloadRes.status).toBe(200);
    const reloadRawText = await reloadRes.text();
    // Raw phone MUST NEVER appear in GET /api/jobs/[id]
    expect(reloadRawText).not.toContain('+79051114567');
    expect(reloadRawText).toContain('+7 905 •••-45-67');

    const reloaded = JSON.parse(reloadRawText);
    expect(reloaded.job.status).toBe('paused');
    expect(reloaded.job.stats.processed).toBe(2);

    // 5. Resume & complete remaining batch
    const resumeRes = await resumePOST(
      new NextRequest(`http://localhost/api/jobs/${jobId}/resume`, {
        method: 'POST',
        headers: { cookie },
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(resumeRes.status).toBe(200);

    const step2Res = await stepPOST(
      new NextRequest(`http://localhost/api/jobs/${jobId}/step`, {
        method: 'POST',
        headers: { cookie },
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(step2Res.status).toBe(200);
    const completed = (await step2Res.json()).job;
    expect(completed.status).toBe('completed');
    expect(completed.stats.foundWithUsername).toBe(
      completed.stats.personWithUsername +
        completed.stats.channelWithUsername +
        completed.stats.botWithUsername
    );
    expect(completed.stats.foundWithUsername).toBe(3);
    expect(completed.stats.personWithUsername).toBe(2);
    expect(completed.stats.channelWithUsername).toBe(1);
    expect(completed.stats.notFoundOrHidden).toBe(1);

    // 6. Export CSV (UTF-8 BOM + mode=SANDBOX + raw phones)
    const exportRes = await exportGET(
      new NextRequest(`http://localhost/api/jobs/${jobId}/export?delimiter=semicolon`, {
        headers: { cookie },
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(exportRes.status).toBe(200);
    const rawBytes = new Uint8Array(await exportRes.arrayBuffer());
    expect([rawBytes[0], rawBytes[1], rawBytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const csvText = new TextDecoder('utf-8').decode(rawBytes);
    expect(csvText).toContain('+79051114567;@beze_cakes_kzn;person;человек;found;');
    expect(csvText).toContain('SANDBOX');

    // 7. Immediate PII deletion
    const delRes = await deleteJobDELETE(
      new NextRequest(`http://localhost/api/jobs/${jobId}`, {
        method: 'DELETE',
        headers: { cookie },
      }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(delRes.status).toBe(200);

    const afterDel = await getJobGET(
      new NextRequest(`http://localhost/api/jobs/${jobId}`, { headers: { cookie } }),
      { params: Promise.resolve({ id: jobId }) }
    );
    expect(afterDel.status).toBe(404);
  });

  it('transitions to rate_limited on FLOOD_WAIT trigger phone and returns 429 during cooldown', async () => {
    const createRes = await createJobPOST(
      new NextRequest('http://localhost/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: 'flood.csv', batchSize: 5, pauseMs: 500 }),
      })
    );
    const cookie = extractCookieHeader(createRes);
    const { job } = await createRes.json();

    await chunksPOST(
      new NextRequest(`http://localhost/api/jobs/${job.id}/chunks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ phones: ['+79051114567', '+79990000429'] }),
      }),
      { params: Promise.resolve({ id: job.id }) }
    );
    await startPOST(
      new NextRequest(`http://localhost/api/jobs/${job.id}/start`, { method: 'POST', headers: { cookie } }),
      { params: Promise.resolve({ id: job.id }) }
    );

    const step1 = await stepPOST(
      new NextRequest(`http://localhost/api/jobs/${job.id}/step`, { method: 'POST', headers: { cookie } }),
      { params: Promise.resolve({ id: job.id }) }
    );
    expect(step1.status).toBe(200);
    const body1 = await step1.json();
    expect(body1.job.status).toBe('rate_limited');
    expect(body1.job.retryAfterSec).toBeGreaterThan(0);

    // Immediate retry before cooldown expires returns 429
    const stepTooSoon = await stepPOST(
      new NextRequest(`http://localhost/api/jobs/${job.id}/step`, { method: 'POST', headers: { cookie } }),
      { params: Promise.resolve({ id: job.id }) }
    );
    expect(stepTooSoon.status).toBe(429);

    // Regression B1: pause -> start during active FLOOD_WAIT MUST NOT bypass cooldown
    await pausePOST(
      new NextRequest(`http://localhost/api/jobs/${job.id}/pause`, { method: 'POST', headers: { cookie } }),
      { params: Promise.resolve({ id: job.id }) }
    );
    const startBypassAttempt = await startPOST(
      new NextRequest(`http://localhost/api/jobs/${job.id}/start`, { method: 'POST', headers: { cookie } }),
      { params: Promise.resolve({ id: job.id }) }
    );
    expect(startBypassAttempt.status).toBe(429);
  });

  it('enforces operator key, safety floors, and worker delegation in LIVE_MTPROTO mode', async () => {
    process.env.PROVIDER_MODE = 'LIVE_MTPROTO';
    process.env.OPERATOR_ACCESS_KEY = 'super-secret-op-key';

    // Without operator cookie -> 401
    const denied = await createJobPOST(
      new NextRequest('http://localhost/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: 'live.csv', batchSize: 25, pauseMs: 100 }),
      })
    );
    expect(denied.status).toBe(401);

    // Authenticate operator
    const authRes = await operatorPOST(
      new NextRequest('http://localhost/api/auth/operator', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'super-secret-op-key' }),
      })
    );
    expect(authRes.status).toBe(200);
    const opCookie = extractCookieHeader(authRes);

    // Create live job -> clamps batchSize <= 15 and pauseMs >= 15000
    const createdRes = await createJobPOST(
      new NextRequest('http://localhost/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: opCookie },
        body: JSON.stringify({ fileName: 'live.csv', batchSize: 25, pauseMs: 100 }),
      })
    );
    expect(createdRes.status).toBe(201);
    const jobCookie = extractCookieHeader(createdRes);
    const combinedCookie = `${opCookie}; ${jobCookie}`;
    const created = (await createdRes.json()).job;
    expect(created.batchSize).toBe(15);
    expect(created.pauseMs).toBe(15_000);

    await chunksPOST(
      new NextRequest(`http://localhost/api/jobs/${created.id}/chunks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: combinedCookie },
        body: JSON.stringify({ phones: ['+79051114567'] }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    );

    const startRes = await startPOST(
      new NextRequest(`http://localhost/api/jobs/${created.id}/start`, {
        method: 'POST',
        headers: { cookie: combinedCookie },
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect((await startRes.json()).job.status).toBe('queued');

    // /step must NOT run MTProto in serverless; returns 202 delegatedToWorker
    const stepRes = await stepPOST(
      new NextRequest(`http://localhost/api/jobs/${created.id}/step`, {
        method: 'POST',
        headers: { cookie: combinedCookie },
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(stepRes.status).toBe(202);
    expect((await stepRes.json()).delegatedToWorker).toBe(true);
  });

  it('fails closed on Vercel without Upstash Redis configuration', async () => {
    process.env.VERCEL = '1';

    const healthRes = await healthGET();
    const health = await healthRes.json();
    expect(health.storageMode).toBe('unconfigured');

    const createRes = await createJobPOST(
      new NextRequest('http://localhost/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: 'x.csv' }),
      })
    );
    expect(createRes.status).toBe(503);
    const errBody = await createRes.json();
    expect(errBody.code).toBe('STORAGE_NOT_CONFIGURED');
  });

  it('reports ok health with live worker heartbeat and rejects malformed API requests cleanly', async () => {
    const healthyRes = await healthGET();
    expect(healthyRes.status).toBe(200);
    const healthy = await healthyRes.json();
    expect(healthy.status).toBe('ok');
    expect(healthy.storageMode).toBe('file');
    expect(healthy.workerOnline).toBe(false);

    // Operator endpoint error paths
    expect(
      (await operatorPOST(new NextRequest('http://localhost/api/auth/operator', { method: 'POST', body: '{}' }))).status
    ).toBe(503);
    process.env.OPERATOR_ACCESS_KEY = 'real-op-key';
    expect(
      (await operatorPOST(new NextRequest('http://localhost/api/auth/operator', { method: 'POST', body: 'not-json' }))).status
    ).toBe(400);
    expect(
      (await operatorPOST(new NextRequest('http://localhost/api/auth/operator', { method: 'POST', body: JSON.stringify({ key: '' }) }))).status
    ).toBe(400);
    expect(
      (await operatorPOST(new NextRequest('http://localhost/api/auth/operator', { method: 'POST', body: JSON.stringify({ key: 'wrong' }) }))).status
    ).toBe(401);

    // Malformed create job body & starting 0-item job
    expect(
      (await createJobPOST(new NextRequest('http://localhost/api/jobs', { method: 'POST', body: 'bad-json' }))).status
    ).toBe(400);
    const emptyJobRes = await createJobPOST(
      new NextRequest('http://localhost/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: 'empty.csv' }),
      })
    );
    const cookie = extractCookieHeader(emptyJobRes);
    const { job } = await emptyJobRes.json();
    expect(
      (
        await startPOST(
          new NextRequest(`http://localhost/api/jobs/${job.id}/start`, { method: 'POST', headers: { cookie } }),
          { params: Promise.resolve({ id: job.id }) }
        )
      ).status
    ).toBe(400);
  });
});
