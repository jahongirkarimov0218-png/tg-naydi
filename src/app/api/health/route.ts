import { NextResponse } from 'next/server';
import { getProviderMode } from '@/lib/auth';
import { getJobStore, getStorageMode } from '@/lib/job-store';
import type { RecentJobMetrics } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const storageMode = getStorageMode();
  const providerMode = getProviderMode();
  const store = getJobStore();

  let workerOnline = false;
  let metrics: RecentJobMetrics = {
    recentJobsTotal: 0,
    recentJobsCompleted: 0,
    recentJobsFailed: 0,
    recentFloodWaits: 0,
    errorRate: 0,
  };

  if (store) {
    try {
      const [hb, recent] = await Promise.all([
        store.getWorkerHeartbeat(),
        store.getRecentMetrics(),
      ]);
      workerOnline = hb !== null && Date.now() - hb < 45_000;
      metrics = recent;
    } catch {
      return NextResponse.json(
        {
          status: 'degraded',
          version: process.env.npm_package_version || '0.1.0',
          commitSha: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'local',
          providerMode,
          storageMode,
          workerOnline: false,
          metrics,
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      );
    }
  }

  return NextResponse.json({
    status: storageMode === 'unconfigured' ? 'degraded' : 'ok',
    version: process.env.npm_package_version || '0.1.0',
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'local',
    providerMode,
    storageMode,
    workerOnline,
    metrics,
    timestamp: new Date().toISOString(),
  });
}
