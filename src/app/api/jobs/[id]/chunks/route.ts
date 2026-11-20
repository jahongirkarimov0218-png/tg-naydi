import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseJsonBody, withAuthorizedJob, type JobRouteContext } from '@/lib/api-helpers';
import { appendUniquePhonesToJob, MAX_CHUNK_SIZE, toPublicJobView } from '@/lib/job-engine';

const ChunkSchema = z.object({
  phones: z.array(z.string()).min(1).max(MAX_CHUNK_SIZE),
});

export async function POST(req: NextRequest, context: JobRouteContext): Promise<NextResponse> {
  return withAuthorizedJob(req, context, async ({ job, store }) => {
    const parsedJson = await parseJsonBody(req);
    if (!parsedJson.ok) return parsedJson.response;

    const parsed = ChunkSchema.safeParse(parsedJson.data);
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
  });
}
