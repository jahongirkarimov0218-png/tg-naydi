import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { extractJobToken, verifyJobToken } from '@/lib/auth';
import { appendUniquePhonesToJob, MAX_CHUNK_SIZE, toPublicJobView } from '@/lib/job-engine';
import { getJobStore } from '@/lib/job-store';

type RouteContext = { params: Promise<{ id: string }> };

const ChunkSchema = z.object({
  phones: z.array(z.string()).min(1).max(MAX_CHUNK_SIZE),
});

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ChunkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Invalid chunk payload (1..${MAX_CHUNK_SIZE} E.164 phones expected)` },
      { status: 400 }
    );
  }

  try {
    const { added } = appendUniquePhonesToJob(job, parsed.data.phones);
    await store.saveJob(job);
    return NextResponse.json({ added, job: toPublicJobView(job) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to append chunk' },
      { status: 400 }
    );
  }
}
