import { NextRequest, NextResponse } from 'next/server';
import { extractJobToken, verifyJobToken } from '@/lib/auth';
import { buildResultCsv } from '@/lib/csv-exporter';
import { getJobStore } from '@/lib/job-store';

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
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (!verifyJobToken(job.tokenHash, extractJobToken(req, id))) {
    return NextResponse.json({ error: 'Unauthorized job access' }, { status: 401 });
  }

  const delimiterParam = req.nextUrl.searchParams.get('delimiter');
  const delimiter: ';' | ',' = delimiterParam === 'comma' ? ',' : ';';
  const onlyFound = req.nextUrl.searchParams.get('onlyFound') === '1';

  const csvContent = buildResultCsv(job, { delimiter, onlyFound });
  const safeBase = job.fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'result';
  const suffix = onlyFound ? '_only_usernames' : '';
  const downloadName = `result_${safeBase}${suffix}.csv`;

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${downloadName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
