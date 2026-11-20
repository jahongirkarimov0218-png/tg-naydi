import { NextRequest, NextResponse } from 'next/server';
import { extractJobToken, verifyJobToken } from '@/lib/auth';
import { runSandboxJobStep, toPublicJobView } from '@/lib/job-engine';
import { getJobStore } from '@/lib/job-store';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const store = getJobStore();
  if (!store) {
    return NextResponse.json({ code: 'STORAGE_NOT_CONFIGURED' }, { status: 503 });
  }

  const { id } = await context.params;
  const existing = await store.getJob(id);
  if (!existing) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (!verifyJobToken(existing.tokenHash, extractJobToken(req, id))) {
    return NextResponse.json({ error: 'Unauthorized job access' }, { status: 401 });
  }

  const outcome = await runSandboxJobStep(store, id);
  if (!outcome) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (outcome.kind === 'delegated') {
    return NextResponse.json(
      { delegatedToWorker: true, job: toPublicJobView(outcome.job) },
      { status: 202 }
    );
  }

  if (outcome.kind === 'rate_limited') {
    return NextResponse.json(
      {
        error: 'Telegram FLOOD_WAIT cooldown active',
        retryAfterSec: outcome.retryAfterSec,
        job: toPublicJobView(outcome.job),
      },
      { status: 429, headers: { 'Retry-After': String(outcome.retryAfterSec) } }
    );
  }

  if (outcome.kind === 'busy') {
    return NextResponse.json(
      { busy: true, job: toPublicJobView(outcome.job) },
      { status: 202 }
    );
  }

  return NextResponse.json({ job: toPublicJobView(outcome.job) });
}
