import { NextRequest, NextResponse } from 'next/server';
import { extractJobToken, getJobCookieName, verifyJobToken } from '@/lib/auth';
import { toPublicJobView } from '@/lib/job-engine';
import { getJobStore } from '@/lib/job-store';
import { logInfo } from '@/lib/logger';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const store = getJobStore();
  if (!store) {
    return NextResponse.json({ code: 'STORAGE_NOT_CONFIGURED' }, { status: 503 });
  }

  const { id } = await context.params;
  const job = await store.getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found or expired' }, { status: 404 });
  }

  const rawToken = extractJobToken(req, id);
  if (!verifyJobToken(job.tokenHash, rawToken)) {
    return NextResponse.json({ error: 'Unauthorized job access' }, { status: 401 });
  }

  const url = req.nextUrl;
  const offset = Number(url.searchParams.get('offset') ?? '0');
  const limit = Number(url.searchParams.get('limit') ?? '200');
  const filterParam = url.searchParams.get('filter');
  const filter =
    filterParam === 'person' ||
    filterParam === 'channel' ||
    filterParam === 'bot' ||
    filterParam === 'found'
      ? filterParam
      : 'all';

  return NextResponse.json({
    job: toPublicJobView(job, {
      offset: Number.isFinite(offset) ? offset : 0,
      limit: Number.isFinite(limit) ? limit : 200,
      filter,
    }),
  });
}

export async function DELETE(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const store = getJobStore();
  if (!store) {
    return NextResponse.json({ code: 'STORAGE_NOT_CONFIGURED' }, { status: 503 });
  }

  const { id } = await context.params;
  const job = await store.getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const rawToken = extractJobToken(req, id);
  if (!verifyJobToken(job.tokenHash, rawToken)) {
    return NextResponse.json({ error: 'Unauthorized job access' }, { status: 401 });
  }

  await store.deleteJob(id);
  logInfo('Deleted job and PII data immediately', { jobId: id });
  const res = NextResponse.json({ deleted: true });
  res.cookies.set(getJobCookieName(id), '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return res;
}
