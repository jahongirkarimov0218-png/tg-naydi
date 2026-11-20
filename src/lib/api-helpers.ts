import { NextRequest, NextResponse } from 'next/server';
import { extractJobToken, verifyJobToken, verifyOperatorAccess } from '@/lib/auth';
import { toPublicJobView, transitionJobToActive } from '@/lib/job-engine';
import { getJobStore } from '@/lib/job-store';
import type { JobStore } from '@/lib/job-store/types';
import type { Job } from '@/lib/types';

export type JobRouteContext = { params: Promise<{ id: string }> };

export interface AuthorizedJobArgs {
  req: NextRequest;
  id: string;
  store: JobStore;
  job: Job;
}

export function storageUnconfiguredResponse(detailed = false): NextResponse {
  if (detailed) {
    return NextResponse.json(
      {
        code: 'STORAGE_NOT_CONFIGURED',
        error:
          'На Vercel не подключён Upstash Redis (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). Подключите бесплатный Upstash Redis для надёжного сохранения прогресса.',
      },
      { status: 503 }
    );
  }
  return NextResponse.json({ code: 'STORAGE_NOT_CONFIGURED' }, { status: 503 });
}

export function cooldownErrorResponse(retryAfterSec: number, job: Job): NextResponse {
  return NextResponse.json(
    {
      error: 'FLOOD_WAIT cooldown active',
      retryAfterSec,
      job: toPublicJobView(job),
    },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
  );
}

export async function parseJsonBody(
  req: NextRequest
): Promise<{ ok: true; data: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, data: await req.json() };
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) };
  }
}

export async function withAuthorizedJob(
  req: NextRequest,
  context: JobRouteContext,
  handler: (args: AuthorizedJobArgs) => Promise<NextResponse>,
  options: { requireLiveOperator?: boolean } = {}
): Promise<NextResponse> {
  const store = getJobStore();
  if (!store) return storageUnconfiguredResponse();

  const { id } = await context.params;
  const job = await store.getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found or expired' }, { status: 404 });
  }

  if (!verifyJobToken(job.tokenHash, extractJobToken(req, id))) {
    return NextResponse.json({ error: 'Unauthorized job access' }, { status: 401 });
  }

  if (options.requireLiveOperator && job.providerMode === 'LIVE_MTPROTO' && !verifyOperatorAccess(req)) {
    return NextResponse.json({ code: 'OPERATOR_AUTH_REQUIRED' }, { status: 401 });
  }

  return handler({ req, id, store, job });
}

export function createActivationHandler(options: {
  allowedFrom: ReadonlyArray<Job['status']>;
  requireItems?: boolean;
}) {
  return async function POST(req: NextRequest, context: JobRouteContext): Promise<NextResponse> {
    return withAuthorizedJob(
      req,
      context,
      async ({ job, store }) => {
        if (options.requireItems && job.items.length === 0) {
          return NextResponse.json(
            { error: 'Cannot start a job with 0 valid numbers' },
            { status: 400 }
          );
        }
        const result = transitionJobToActive(job, options.allowedFrom);
        if (!result.ok) {
          return cooldownErrorResponse(result.retryAfterSec, result.job);
        }
        await store.saveJob(result.job);
        return NextResponse.json({ job: toPublicJobView(result.job) });
      },
      { requireLiveOperator: true }
    );
  };
}
