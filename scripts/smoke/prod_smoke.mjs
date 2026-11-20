/**
 * Independent external HTTPS smoke & security probe for TG Naydi on Vercel + Upstash Redis.
 *
 * Usage:
 *   node scripts/smoke/prod_smoke.mjs https://<app>.vercel.app
 */

const baseUrlArg = process.argv[2]?.trim();
if (!baseUrlArg || !/^https?:\/\//.test(baseUrlArg)) {
  console.error('Usage: node scripts/smoke/prod_smoke.mjs <base-url>');
  process.exit(1);
}
const BASE_URL = baseUrlArg.replace(/\/+$/, '');
const IS_HTTPS = BASE_URL.startsWith('https://');
const RAW_E164_RE = /\+\d{10,15}/;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`SMOKE ASSERTION FAILED: ${message}`);
  }
}

function extractCookieHeader(res) {
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
  assert(setCookies.length > 0, 'Expected Set-Cookie header on POST /api/jobs');
  const jobCookie = setCookies.find((c) => c.startsWith('tgnaydi_job_'));
  assert(Boolean(jobCookie), `Missing tgnaydi_job_* cookie in: ${setCookies.join('; ')}`);
  assert(/;\s*httponly/i.test(jobCookie), 'Cookie missing HttpOnly attribute');
  assert(/;\s*samesite=lax/i.test(jobCookie), 'Cookie missing SameSite=Lax attribute');
  if (IS_HTTPS) {
    assert(/;\s*secure/i.test(jobCookie), 'HTTPS production cookie missing Secure attribute');
  }
  return {
    rawSetCookie: jobCookie.replace(/=[^;]+/, '=[REDACTED]'),
    cookiePair: jobCookie.split(';')[0],
  };
}

async function run() {
  const results = [];
  const record = (step, status, detail) => {
    results.push({ step, status, detail });
    console.log(`[PASS] ${step}: HTTP ${status} — ${detail}`);
  };

  // 1. Healthcheck (must use Upstash Redis)
  const healthRes = await fetch(`${BASE_URL}/api/health`, { cache: 'no-store' });
  const health = await healthRes.json();
  assert(healthRes.status === 200, `GET /api/health returned ${healthRes.status}`);
  assert(health.status === 'ok', `Health status not ok: ${JSON.stringify(health)}`);
  assert(
    health.storageMode === 'upstash',
    `Expected storageMode="upstash", got "${health.storageMode}"`
  );
  record(
    'GET /api/health',
    healthRes.status,
    `status=${health.status}, storageMode=${health.storageMode}, providerMode=${health.providerMode}, commitSha=${health.commitSha?.slice(0, 7) ?? 'unknown'}`
  );

  // 2. Create draft job (POST /api/jobs)
  const testPhones = [
    '+79051114567',
    '+79632226543',
    '+79213331234',
    '+79994442233',
  ];
  const createRes = await fetch(`${BASE_URL}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fileName: 'smoke-test.csv',
      batchSize: 2,
      pauseMs: 100,
      defaultCountry: 'RU',
      totalSourceRows: testPhones.length,
      duplicatesRemoved: 0,
      invalidRows: 0,
    }),
  });
  const createJson = await createRes.json();
  assert(createRes.status === 201, `POST /api/jobs returned ${createRes.status}: ${JSON.stringify(createJson)}`);
  assert(typeof createJson.job?.id === 'string', 'Missing job.id in POST /api/jobs response');
  assert(!RAW_E164_RE.test(JSON.stringify(createJson)), 'Raw E.164 phone leaked in POST /api/jobs JSON');
  const { cookiePair, rawSetCookie } = extractCookieHeader(createRes);
  const jobId = createJson.job.id;
  record('POST /api/jobs', createRes.status, `jobId=${jobId}, cookie=${rawSetCookie}`);

  // 3. Unauthorized access without cookie MUST fail with 401
  const unauthRes = await fetch(`${BASE_URL}/api/jobs/${jobId}`, { cache: 'no-store' });
  assert(unauthRes.status === 401, `Expected 401 without cookie, got ${unauthRes.status}`);
  record('GET /api/jobs/:id (no cookie)', unauthRes.status, 'unauthorized access blocked');

  const authHeaders = { cookie: cookiePair };

  // 3b. Upload phone chunk (POST /api/jobs/:id/chunks)
  const chunkRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/chunks`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ phones: testPhones }),
  });
  const chunkJson = await chunkRes.json();
  assert(chunkRes.status === 200, `POST /chunks returned ${chunkRes.status}: ${JSON.stringify(chunkJson)}`);
  assert(chunkJson.added === 4, `Expected added=4, got ${chunkJson.added}`);
  assert(!RAW_E164_RE.test(JSON.stringify(chunkJson)), 'Raw E.164 phone leaked in POST /chunks JSON');
  record('POST /api/jobs/:id/chunks', chunkRes.status, `added=${chunkJson.added}, total=${chunkJson.totalItems ?? chunkJson.job?.stats?.total}`);

  // 4. Start job
  const startRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/start`, {
    method: 'POST',
    headers: authHeaders,
  });
  const startJson = await startRes.json();
  assert(startRes.status === 200, `POST /start returned ${startRes.status}: ${JSON.stringify(startJson)}`);
  assert(startJson.job?.status === 'running', `Expected running, got ${startJson.job?.status}`);
  record('POST /api/jobs/:id/start', startRes.status, `status=${startJson.job.status}`);

  // 5. Step 1 (processes first 2 of 4 items)
  const step1Res = await fetch(`${BASE_URL}/api/jobs/${jobId}/step`, {
    method: 'POST',
    headers: authHeaders,
  });
  const step1Json = await step1Res.json();
  assert(step1Res.status === 200, `POST /step (1) returned ${step1Res.status}`);
  assert(step1Json.job?.stats?.processed === 2, `Expected 2 processed, got ${step1Json.job?.stats?.processed}`);
  assert(!RAW_E164_RE.test(JSON.stringify(step1Json)), 'Raw E.164 phone leaked in step1 JSON');
  record('POST /api/jobs/:id/step (batch 1)', step1Res.status, `processed=${step1Json.job.stats.processed}/4`);

  // 6. Pause job
  const pauseRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/pause`, {
    method: 'POST',
    headers: authHeaders,
  });
  const pauseJson = await pauseRes.json();
  assert(pauseRes.status === 200, `POST /pause returned ${pauseRes.status}`);
  assert(pauseJson.job?.status === 'paused', `Expected paused, got ${pauseJson.job?.status}`);
  record('POST /api/jobs/:id/pause', pauseRes.status, `status=${pauseJson.job.status}`);

  // 7. Reload state (F5 durability via Upstash Redis)
  const reloadRes = await fetch(`${BASE_URL}/api/jobs/${jobId}`, {
    headers: authHeaders,
    cache: 'no-store',
  });
  const reloadText = await reloadRes.text();
  assert(reloadRes.status === 200, `GET /api/jobs/:id returned ${reloadRes.status}`);
  assert(!RAW_E164_RE.test(reloadText), 'Raw E.164 phone leaked in GET /api/jobs/:id JSON');
  const reloadJson = JSON.parse(reloadText);
  assert(reloadJson.job?.status === 'paused', `Expected persisted paused status, got ${reloadJson.job?.status}`);
  assert(reloadJson.job?.stats?.processed === 2, `Expected persisted processed=2, got ${reloadJson.job?.stats?.processed}`);
  record('GET /api/jobs/:id (F5 reload)', reloadRes.status, 'paused + processed=2 persisted in Upstash, 0 raw E.164 phones');

  // 8. Resume & finish remaining items
  const resumeRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/resume`, {
    method: 'POST',
    headers: authHeaders,
  });
  assert(resumeRes.status === 200, `POST /resume returned ${resumeRes.status}`);
  record('POST /api/jobs/:id/resume', resumeRes.status, 'resumed');

  let finalJob = null;
  for (let i = 0; i < 5; i += 1) {
    const stepRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/step`, {
      method: 'POST',
      headers: authHeaders,
    });
    const stepJson = await stepRes.json();
    assert(stepRes.status === 200, `POST /step (loop ${i}) returned ${stepRes.status}`);
    finalJob = stepJson.job;
    if (finalJob?.status === 'completed') break;
  }
  assert(finalJob?.status === 'completed', `Job did not complete; status=${finalJob?.status}`);
  assert(finalJob?.stats?.processed === 4, `Expected processed=4, got ${finalJob?.stats?.processed}`);
  record('POST /api/jobs/:id/step (finish)', 200, `status=completed, processed=4/4`);

  // 9. Export CSV & verify raw UTF-8 BOM [0xEF, 0xBB, 0xBF]
  const exportRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/export`, {
    headers: authHeaders,
  });
  assert(exportRes.status === 200, `GET /export returned ${exportRes.status}`);
  const bytes = new Uint8Array(await exportRes.arrayBuffer());
  assert(
    bytes.length > 20 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    `Export CSV missing UTF-8 BOM [EF BB BF]; got [${bytes[0]}, ${bytes[1]}, ${bytes[2]}]`
  );
  const csvText = new TextDecoder('utf-8').decode(bytes.subarray(3));
  assert(
    csvText.startsWith('phone;username;type;type_label;status;'),
    `CSV header mismatch: ${csvText.slice(0, 80)}`
  );
  record('GET /api/jobs/:id/export', exportRes.status, `UTF-8 BOM [EF BB BF] + Russian Excel ';' header verified, ${bytes.length} bytes`);

  // 10. Delete job & verify 404 on subsequent GET
  const delRes = await fetch(`${BASE_URL}/api/jobs/${jobId}`, {
    method: 'DELETE',
    headers: authHeaders,
  });
  assert(delRes.status === 200, `DELETE /api/jobs/:id returned ${delRes.status}`);
  record('DELETE /api/jobs/:id', delRes.status, 'job & PII deleted');

  const afterDelRes = await fetch(`${BASE_URL}/api/jobs/${jobId}`, {
    headers: authHeaders,
    cache: 'no-store',
  });
  assert(afterDelRes.status === 404, `Expected 404 after DELETE, got ${afterDelRes.status}`);
  record('GET /api/jobs/:id (post-DELETE)', afterDelRes.status, 'confirmed removed from Upstash Redis');

  console.log(`\nALL ${results.length} LIVE HTTPS SMOKE & SECURITY CHECKS PASSED (${BASE_URL}).`);
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
