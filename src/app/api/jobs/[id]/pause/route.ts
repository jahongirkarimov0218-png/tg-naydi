import { NextRequest, NextResponse } from 'next/server';
import { withAuthorizedJob, type JobRouteContext } from '@/lib/api-helpers';
import { toPublicJobView } from '@/lib/job-engine';

const PAUSABLE_STATUSES = new Set(['running', 'queued', 'rate_limited']);

export async function POST(req: NextRequest, context: JobRouteContext): Promise<NextResponse> {
  return withAuthorizedJob(req, context, async ({ job, store }) => {
    if (PAUSABLE_STATUSES.has(job.status)) {
      job.status = 'paused';
      job.updatedAt = new Date().toISOString();
      await store.saveJob(job);
    }
    return NextResponse.json({ job: toPublicJobView(job) });
  });
}
