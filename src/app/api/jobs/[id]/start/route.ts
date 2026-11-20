import { NextRequest, NextResponse } from 'next/server';
import { extractJobToken, verifyJobToken, verifyOperatorAccess } from '@/lib/auth';
import { toPublicJobView } from '@/lib/job-engine';
import { getJobStore } from '@/lib/job-store';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const store = getJobStore();
  if (!store) {
    return NextResponse.json({ code: 'STORAGE_NOT_CONFIGURED' }, { status: 503 });
  }

  const { id } = await context.params;
  const job = await store.getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (!verifyJobToken(job.tokenHash, extractJobToken(req, id))) {
    return NextResponse.json({ error: 'Unauthorized job access' }, { status: 401 });
  }

  if (job.providerMode === 'LIVE_MTPROTO' && !verifyOperatorAccess(req)) {
    return NextResponse.json({ code: 'OPERATOR_AUTH_REQUIRED' }, { status: 401 });
  }

  if (job.items.length === 0) {
    return NextResponse.json({ error: 'Cannot start a job with 0 valid numbers' }, { status: 400 });
  }

  if (job.status === 'draft') {
    job.status = job.providerMode === 'LIVE_MTPROTO' ? 'queued' : 'running';
    job.retryAfterAt = undefined;
    job.updatedAt = new Date().toISOString();
    await store.saveJob(job);
  } else if (job.status === 'paused' || job.status === 'rate_limited') {
    if (job.retryAfterAt && new Date(job.retryAfterAt).getTime() > Date.now()) {
      const retryAfterSec = Math.ceil((new Date(job.retryAfterAt).getTime() - Date.now()) / 1000);
      return NextResponse.json(
        { error: 'FLOOD_WAIT cooldown still active', retryAfterSec, job: toPublicJobView(job) },
        { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
      );
    }
    job.status = job.providerMode === 'LIVE_MTPROTO' ? 'queued' : 'running';
    job.retryAfterAt = undefined;
    job.updatedAt = new Date().toISOString();
    await store.saveJob(job);
  }

  return NextResponse.json({ job: toPublicJobView(job) });
}
