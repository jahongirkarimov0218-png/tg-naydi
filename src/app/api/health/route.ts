import { NextResponse } from 'next/server';
import { getProviderMode } from '@/lib/auth';
import { getJobStore, getStorageMode } from '@/lib/job-store';
import { isWorkerHeartbeatFresh } from '@/lib/job-store/helpers';
import type { RecentJobMetrics } from '@/lib/types';

export const dynamic = 'force-dynamic';

const EMPTY_METRICS: RecentJobMetrics = {
  recentJobsTotal: 0,
  recentJobsCompleted: 0,
  recentJobsFailed: 0,
  recentFloodWaits: 0,
  errorRate: 0,
};

function baseHealthFields() {
  return {
    version: process.env.npm_package_version || '0.1.0',
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'local',
    providerMode: getProviderMode(),
    storageMode: getStorageMode(),
    timestamp: new Date().toISOString(),
  };
}

export async function GET(): Promise<NextResponse> {
  const base = baseHealthFields();
  const store = getJobStore();

  if (!store) {
    return NextResponse.json({
      ...base,
      status: 'degraded',
      workerOnline: false,
      metrics: EMPTY_METRICS,
    });
  }

  try {
    const [hb, metrics] = await Promise.all([
      store.getWorkerHeartbeat(),
      store.getRecentMetrics(),
    ]);
    const workerOnline = isWorkerHeartbeatFresh(hb);
    return NextResponse.json({ ...base, status: 'ok', workerOnline, metrics });
  } catch {
    return NextResponse.json(
      { ...base, status: 'degraded', workerOnline: false, metrics: EMPTY_METRICS },
      { status: 503 }
    );
  }
}
