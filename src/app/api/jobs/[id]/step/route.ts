import { NextRequest, NextResponse } from 'next/server';
import {
  cooldownErrorResponse,
  withAuthorizedJob,
  type JobRouteContext,
} from '@/lib/api-helpers';
import { runSandboxJobStep, toPublicJobView } from '@/lib/job-engine';

export async function POST(req: NextRequest, context: JobRouteContext): Promise<NextResponse> {
  return withAuthorizedJob(req, context, async ({ id, store }) => {
    const outcome = await runSandboxJobStep(store, id);
    if (!outcome) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    switch (outcome.kind) {
      case 'delegated':
        return NextResponse.json(
          { delegatedToWorker: true, job: toPublicJobView(outcome.job) },
          { status: 202 }
        );
      case 'rate_limited':
        return cooldownErrorResponse(outcome.retryAfterSec, outcome.job);
      case 'busy':
        return NextResponse.json({ busy: true, job: toPublicJobView(outcome.job) }, { status: 202 });
      default:
        return NextResponse.json({ job: toPublicJobView(outcome.job) });
    }
  });
}
