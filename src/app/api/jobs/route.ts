import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  generateSecretToken,
  getProviderMode,
  hashSecret,
  setJobTokenCookie,
  verifyOperatorAccess,
} from '@/lib/auth';
import { createNewJobRecord, toPublicJobView } from '@/lib/job-engine';
import { getJobStore } from '@/lib/job-store';
import { logInfo } from '@/lib/logger';

const CreateJobSchema = z.object({
  fileName: z.string().min(1).max(160).default('contacts.csv'),
  batchSize: z.number().int().min(1).max(50).optional().default(5),
  pauseMs: z.number().int().min(0).max(120_000).optional().default(800),
  defaultCountry: z.enum(['RU', 'UZ', 'KZ', 'UA', 'BY', 'US']).optional().default('RU'),
  totalSourceRows: z.number().int().min(0).optional().default(0),
  duplicatesRemoved: z.number().int().min(0).optional().default(0),
  invalidRows: z.number().int().min(0).optional().default(0),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const store = getJobStore();
  if (!store) {
    return NextResponse.json(
      {
        code: 'STORAGE_NOT_CONFIGURED',
        error:
          'На Vercel не подключён Upstash Redis (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). Подключите бесплатный Upstash Redis для надёжного сохранения прогресса.',
      },
      { status: 503 }
    );
  }

  if (!verifyOperatorAccess(req)) {
    return NextResponse.json(
      {
        code: 'OPERATOR_AUTH_REQUIRED',
        error: 'Для запуска проверки в режиме LIVE MTProto требуется ключ оператора.',
      },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const parsed = CreateJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const providerMode = getProviderMode();
  const rawToken = generateSecretToken();
  const job = createNewJobRecord({
    tokenHash: hashSecret(rawToken),
    fileName: parsed.data.fileName,
    providerMode,
    batchSize: parsed.data.batchSize,
    pauseMs: parsed.data.pauseMs,
    defaultCountry: parsed.data.defaultCountry,
    totalSourceRows: parsed.data.totalSourceRows,
    duplicatesRemoved: parsed.data.duplicatesRemoved,
    invalidRows: parsed.data.invalidRows,
  });

  await store.saveJob(job);
  logInfo('Created draft lookup job', { jobId: job.id, providerMode });

  const res = NextResponse.json({ job: toPublicJobView(job) }, { status: 201 });
  setJobTokenCookie(res, job.id, rawToken);
  return res;
}
