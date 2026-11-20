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
  const rawBase = job.fileName.replace(/\.[^.]+$/, '');
  const asciiBase = rawBase
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'contacts';
  const suffix = onlyFound ? '_only_usernames' : '';
  const asciiDownloadName = `result_${asciiBase}${suffix}.csv`;
  const utf8DownloadName = encodeURIComponent(`result_${rawBase || 'contacts'}${suffix}.csv`);

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${asciiDownloadName}"; filename*=UTF-8''${utf8DownloadName}`,
      'Cache-Control': 'no-store',
    },
  });
}
