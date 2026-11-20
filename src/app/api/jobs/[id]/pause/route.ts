import { NextRequest, NextResponse } from 'next/server';
import { extractJobToken, verifyJobToken } from '@/lib/auth';
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

  if (job.status === 'running' || job.status === 'queued' || job.status === 'rate_limited') {
    job.status = 'paused';
    job.updatedAt = new Date().toISOString();
    await store.saveJob(job);
  }

  return NextResponse.json({ job: toPublicJobView(job) });
}
