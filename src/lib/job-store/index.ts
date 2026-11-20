import type { StorageMode } from '@/lib/types';
import { FileJobStore } from '@/lib/job-store/file-store';
import type { JobStore } from '@/lib/job-store/types';
import { UpstashRedisJobStore } from '@/lib/job-store/upstash-store';

function resolveUpstashCredentials(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.KV_REST_API_URL?.trim();
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

export function getStorageMode(): StorageMode {
  if (resolveUpstashCredentials()) {
    return 'upstash';
  }
  if (process.env.VERCEL === '1') {
    return 'unconfigured';
  }
  return 'file';
}

export function getJobStore(): JobStore | null {
  const creds = resolveUpstashCredentials();
  if (creds) {
    return new UpstashRedisJobStore(creds.url, creds.token);
  }
  if (process.env.VERCEL === '1') {
    // Fail closed on Vercel when Upstash Redis is not configured
    return null;
  }
  return new FileJobStore();
}
