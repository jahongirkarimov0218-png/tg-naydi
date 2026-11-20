import { NextRequest, NextResponse } from 'next/server';
import {
  cooldownErrorResponse,
  withAuthorizedJob,
  type JobRouteContext,
} from '@/lib/api-helpers';
import { toPublicJobView, transitionJobToActive } from '@/lib/job-engine';

export async function POST(req: NextRequest, context: JobRouteContext): Promise<NextResponse> {
  return withAuthorizedJob(
    req,
    context,
    async ({ job, store }) => {
      if (job.items.length === 0) {
        return NextResponse.json(
          { error: 'Cannot start a job with 0 valid numbers' },
          { status: 400 }
        );
      }

      const result = transitionJobToActive(job, ['draft', 'paused', 'rate_limited']);
      if (!result.ok) {
        return cooldownErrorResponse(result.retryAfterSec, result.job);
      }

      await store.saveJob(result.job);
      return NextResponse.json({ job: toPublicJobView(result.job) });
    },
    { requireLiveOperator: true }
  );
}
