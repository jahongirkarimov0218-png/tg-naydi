import { NextRequest, NextResponse } from 'next/server';
import { getJobCookieName } from '@/lib/auth';
import { withAuthorizedJob, type JobRouteContext } from '@/lib/api-helpers';
import { toPublicJobView, type PublicItemFilter } from '@/lib/job-engine';
import { logInfo } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const VALID_FILTERS = new Set<PublicItemFilter>(['all', 'person', 'channel', 'bot', 'found']);

function parseQueryInt(raw: string | null, fallback: number): number {
  const num = Number(raw ?? fallback);
  return Number.isFinite(num) ? num : fallback;
}

function parseFilter(raw: string | null): PublicItemFilter {
  return raw && VALID_FILTERS.has(raw as PublicItemFilter) ? (raw as PublicItemFilter) : 'all';
}

export async function GET(req: NextRequest, context: JobRouteContext): Promise<NextResponse> {
  return withAuthorizedJob(req, context, async ({ job }) => {
    const params = req.nextUrl.searchParams;
    return NextResponse.json({
      job: toPublicJobView(job, {
        offset: parseQueryInt(params.get('offset'), 0),
        limit: parseQueryInt(params.get('limit'), 200),
        filter: parseFilter(params.get('filter')),
      }),
    });
  });
}

export async function DELETE(req: NextRequest, context: JobRouteContext): Promise<NextResponse> {
  return withAuthorizedJob(req, context, async ({ id, store }) => {
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
  });
}
