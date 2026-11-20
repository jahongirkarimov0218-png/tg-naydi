import type { StorageMode } from '@/lib/types';
import { FileJobStore } from '@/lib/job-store/file-store';
import type { JobStore } from '@/lib/job-store/types';
import { UpstashRedisJobStore } from '@/lib/job-store/upstash-store';

export function getStorageMode(): StorageMode {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && token) {
    return 'upstash';
  }
  if (process.env.VERCEL === '1') {
    return 'unconfigured';
  }
  return 'file';
}

export function getJobStore(): JobStore | null {
  const mode = getStorageMode();
  if (mode === 'upstash') {
    return new UpstashRedisJobStore(
      process.env.UPSTASH_REDIS_REST_URL!.trim(),
      process.env.UPSTASH_REDIS_REST_TOKEN!.trim()
    );
  }
  if (mode === 'unconfigured') {
    // Fail closed on Vercel when Upstash Redis is not configured
    return null;
  }
  return new FileJobStore();
}
