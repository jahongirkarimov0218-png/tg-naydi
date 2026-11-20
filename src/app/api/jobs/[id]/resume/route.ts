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
      const result = transitionJobToActive(job, ['paused', 'rate_limited']);
      if (!result.ok) {
        return cooldownErrorResponse(result.retryAfterSec, result.job);
      }

      await store.saveJob(result.job);
      return NextResponse.json({ job: toPublicJobView(result.job) });
    },
    { requireLiveOperator: true }
  );
}
