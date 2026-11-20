/**
 * Live MTProto canary verification script for TG Naydi.
 *
 * Verifies against live Production:
 *   1. Unauthorized POST /api/jobs without OPERATOR_ACCESS_KEY -> HTTP 401
 *   2. POST /api/auth/operator -> HTTP 200 + Secure; HttpOnly; SameSite=lax cookie
 *   3. GET /api/health -> providerMode=LIVE_MTPROTO, storageMode=upstash, workerOnline=true
 *   4. Canary job (2 safe phones, batchSize=2, pauseMs=15000) processed by live worker -> completed
 *   5. GET /api/jobs/:id -> 0 raw E.164 phones in JSON
 *   6. GET /api/jobs/:id/export -> UTF-8 BOM [EF BB BF] + mode=LIVE_MTPROTO
 *   7. DELETE /api/jobs/:id -> 200, then GET -> 404
 *
 * Reads OPERATOR_ACCESS_KEY from process.env or local .env.local (never prints secrets).
 *
 * Usage:
 *   node scripts/smoke/live_canary.mjs https://tg-naydi.vercel.app
 */

import fs from 'node:fs';
import path from 'node:path';

const baseUrlArg = process.argv[2]?.trim();
if (!baseUrlArg || !/^https?:\/\//.test(baseUrlArg)) {
  console.error('Usage: node scripts/smoke/live_canary.mjs <base-url>');
  process.exit(1);
}
const BASE_URL = baseUrlArg.replace(/\/+$/, '');
const IS_HTTPS = BASE_URL.startsWith('https://');
const RAW_E164_RE = /\+\d{10,15}/;

function loadOperatorKey() {
  const fromEnv = process.env.OPERATOR_ACCESS_KEY?.trim();
  if (fromEnv) return fromEnv;
  const envFile = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envFile)) return '';
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^OPERATOR_ACCESS_KEY=(.*)$/);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

function assert(cond, msg) {
  if (!cond) throw new Error(`CANARY ASSERTION FAILED: ${msg}`);
}

function extractNamedCookie(res, prefix) {
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
  const found = setCookies.find((c) => c.startsWith(prefix));
  assert(Boolean(found), `Missing ${prefix}* cookie`);
  assert(/;\s*httponly/i.test(found), `${prefix} cookie missing HttpOnly`);
  assert(/;\s*samesite=lax/i.test(found), `${prefix} cookie missing SameSite=Lax`);
  if (IS_HTTPS) {
    assert(/;\s*secure/i.test(found), `${prefix} HTTPS cookie missing Secure`);
  }
  return {
    pair: found.split(';')[0],
    redacted: found.replace(/=[^;]+/, '=[REDACTED]'),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  const operatorKey = loadOperatorKey();
  assert(operatorKey.length >= 16, 'OPERATOR_ACCESS_KEY missing or too short in env/.env.local');

  // 1. Verify /api/health shows LIVE_MTPROTO + upstash + workerOnline=true
  const healthRes = await fetch(`${BASE_URL}/api/health`, { cache: 'no-store' });
  const health = await healthRes.json();
  assert(healthRes.status === 200, `GET /api/health returned ${healthRes.status}`);
  assert(health.status === 'ok', `Health status not ok: ${JSON.stringify(health)}`);
  assert(health.providerMode === 'LIVE_MTPROTO', `Expected LIVE_MTPROTO, got ${health.providerMode}`);
  assert(health.storageMode === 'upstash', `Expected upstash, got ${health.storageMode}`);
  assert(health.workerOnline === true, `Expected workerOnline=true, got ${health.workerOnline}`);
  console.log(
    `[PASS] GET /api/health: HTTP 200 — providerMode=${health.providerMode}, storageMode=${health.storageMode}, workerOnline=${health.workerOnline}`
  );

  // 2. Unauthorized POST /api/jobs MUST fail with 401
  const unauthCreate = await fetch(`${BASE_URL}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileName: 'unauth.csv', batchSize: 2, pauseMs: 15000 }),
  });
  assert(unauthCreate.status === 401, `Expected 401 without operator key, got ${unauthCreate.status}`);
  console.log('[PASS] POST /api/jobs (no operator key): HTTP 401 — fail-closed operator gate active');

  // 3. Authenticate operator via POST /api/auth/operator
  const authRes = await fetch(`${BASE_URL}/api/auth/operator`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: operatorKey }),
  });
  assert(authRes.status === 200, `POST /api/auth/operator returned ${authRes.status}`);
  const opCookie = extractNamedCookie(authRes, 'tgnaydi_operator=');
  console.log(`[PASS] POST /api/auth/operator: HTTP 200 — cookie=${opCookie.redacted}`);

  // 4. Create canary job (2 phones, batchSize=2, pauseMs=15000)
  const canaryPhones = ['+79990000001', '+79990000002'];
  const createRes = await fetch(`${BASE_URL}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: opCookie.pair },
    body: JSON.stringify({
      fileName: 'live-canary.csv',
      batchSize: 2,
      pauseMs: 15000,
      defaultCountry: 'RU',
      totalSourceRows: canaryPhones.length,
      duplicatesRemoved: 0,
      invalidRows: 0,
    }),
  });
  const createJson = await createRes.json();
  assert(createRes.status === 201, `POST /api/jobs returned ${createRes.status}: ${JSON.stringify(createJson)}`);
  assert(createJson.job?.providerMode === 'LIVE_MTPROTO', 'Job not in LIVE_MTPROTO mode');
  assert(createJson.job?.batchSize <= 5 && createJson.job?.pauseMs >= 15000, 'Safety floors not enforced');
  const jobCookie = extractNamedCookie(createRes, 'tgnaydi_job_');
  const jobId = createJson.job.id;
  const bothCookies = `${opCookie.pair}; ${jobCookie.pair}`;
  console.log(`[PASS] POST /api/jobs (canary): HTTP 201 — jobId=${jobId}, batchSize=${createJson.job.batchSize}, pauseMs=${createJson.job.pauseMs}`);

  // 5. Upload 2 canary phones
  const chunkRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/chunks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: bothCookies },
    body: JSON.stringify({ phones: canaryPhones }),
  });
  const chunkJson = await chunkRes.json();
  assert(chunkRes.status === 200 && chunkJson.added === 2, `POST /chunks failed: ${chunkRes.status}`);
  console.log(`[PASS] POST /api/jobs/:id/chunks: HTTP 200 — added=${chunkJson.added}`);

  // 6. Start job -> queued for live worker
  const startRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/start`, {
    method: 'POST',
    headers: { cookie: bothCookies },
  });
  const startJson = await startRes.json();
  assert(startRes.status === 200, `POST /start failed: ${startRes.status}`);
  assert(startJson.job?.status === 'queued', `Expected queued in LIVE_MTPROTO, got ${startJson.job?.status}`);
  console.log(`[PASS] POST /api/jobs/:id/start: HTTP 200 — status=${startJson.job.status}`);

  // 7. Wait for standalone worker/mtproto.ts to process via Upstash + Telegram MTProto
  let completedJob = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(2000);
    const pollRes = await fetch(`${BASE_URL}/api/jobs/${jobId}`, {
      headers: { cookie: bothCookies },
      cache: 'no-store',
    });
    const pollText = await pollRes.text();
    assert(pollRes.status === 200, `Poll GET /api/jobs/:id failed: ${pollRes.status}`);
    assert(!RAW_E164_RE.test(pollText), 'Raw E.164 phone leaked in live poll JSON!');
    const pollJson = JSON.parse(pollText);
    const st = pollJson.job?.status;
    if (st === 'completed') {
      completedJob = pollJson.job;
      break;
    }
    if (st === 'failed') {
      throw new Error(`Live worker marked canary job failed: ${pollJson.job?.lastError}`);
    }
  }
  assert(Boolean(completedJob), 'Timed out waiting for worker/mtproto.ts to complete canary job');
  assert(completedJob.stats?.processed === 2, `Expected processed=2, got ${completedJob.stats?.processed}`);
  console.log(
    `[PASS] Worker completed canary job: processed=${completedJob.stats.processed}/2, found=${completedJob.stats.foundWithUsername}, notFoundOrHidden=${completedJob.stats.notFoundOrHidden}, 0 raw E.164 phones in JSON`
  );

  // 8. Export CSV & verify UTF-8 BOM + LIVE_MTPROTO mode column
  const exportRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/export`, {
    headers: { cookie: bothCookies },
  });
  assert(exportRes.status === 200, `GET /export returned ${exportRes.status}`);
  const bytes = new Uint8Array(await exportRes.arrayBuffer());
  assert(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, 'Missing UTF-8 BOM');
  const csvText = new TextDecoder('utf-8').decode(bytes.subarray(3));
  assert(csvText.includes(';LIVE_MTPROTO;'), 'CSV missing LIVE_MTPROTO mode marker');
  console.log(`[PASS] GET /api/jobs/:id/export: HTTP 200 — UTF-8 BOM [EF BB BF] + LIVE_MTPROTO verified (${bytes.length} bytes)`);

  // 9. Delete job & verify 404
  const delRes = await fetch(`${BASE_URL}/api/jobs/${jobId}`, {
    method: 'DELETE',
    headers: { cookie: bothCookies },
  });
  assert(delRes.status === 200, `DELETE /api/jobs/:id failed: ${delRes.status}`);
  const afterDel = await fetch(`${BASE_URL}/api/jobs/${jobId}`, {
    headers: { cookie: bothCookies },
    cache: 'no-store',
  });
  assert(afterDel.status === 404, `Expected 404 post-DELETE, got ${afterDel.status}`);
  console.log('[PASS] DELETE /api/jobs/:id -> HTTP 200, post-DELETE GET -> HTTP 404');

  console.log(`\nALL LIVE_MTPROTO CANARY CHECKS PASSED (${BASE_URL}).`);
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
