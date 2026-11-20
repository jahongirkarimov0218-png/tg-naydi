import { NextRequest, NextResponse } from 'next/server';
import { withAuthorizedJob, type JobRouteContext } from '@/lib/api-helpers';
import { buildResultCsv } from '@/lib/csv-exporter';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: JobRouteContext): Promise<NextResponse> {
  return withAuthorizedJob(req, context, async ({ job }) => {
    const delimiterParam = req.nextUrl.searchParams.get('delimiter');
    const delimiter: ';' | ',' = delimiterParam === 'comma' ? ',' : ';';
    const onlyFound = req.nextUrl.searchParams.get('onlyFound') === '1';

    const csvContent = buildResultCsv(job, { delimiter, onlyFound });
    const rawBase = job.fileName.replace(/\.[^.]+$/, '');
    const asciiBase =
      rawBase
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
  });
}
