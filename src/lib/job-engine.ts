import crypto from 'node:crypto';
import type {
  Job,
  JobItem,
  JobStats,
  ProviderMode,
  PublicJobItem,
  PublicJobView,
  SupportedCountry,
} from '@/lib/types';
import { JOB_TTL_SECONDS, type JobStore } from '@/lib/job-store/types';
import { maskPhone } from '@/lib/phone-normalizer';
import { SandboxLookupProvider } from '@/lib/providers/sandbox';
import { logInfo } from '@/lib/logger';

export const MAX_JOB_PHONES = 10_000;
export const MAX_CHUNK_SIZE = 500;
export const LIVE_MIN_PAUSE_MS = 15_000;
export const LIVE_MAX_BATCH_SIZE = 15;
const STEP_LEASE_TTL_MS = 15_000;

export function computeJobStats(items: JobItem[]): JobStats {
  let processed = 0;
  let pending = 0;
  let personWithUsername = 0;
  let channelWithUsername = 0;
  let botWithUsername = 0;
  let foundNoUsername = 0;
  let notFoundOrHidden = 0;
  let errors = 0;

  for (const item of items) {
    if (item.status === 'pending' || item.status === 'checking') {
      pending += 1;
      continue;
    }
    processed += 1;
    if (item.status === 'found' && item.username) {
      if (item.accountType === 'channel') channelWithUsername += 1;
      else if (item.accountType === 'bot') botWithUsername += 1;
      else personWithUsername += 1;
    } else if (item.status === 'found_no_username') {
      foundNoUsername += 1;
    } else if (item.status === 'not_found_or_hidden') {
      notFoundOrHidden += 1;
    } else if (item.status === 'error') {
      errors += 1;
    }
  }

  return {
    total: items.length,
    processed,
    pending,
    foundWithUsername: personWithUsername + channelWithUsername + botWithUsername,
    personWithUsername,
    channelWithUsername,
    botWithUsername,
    foundNoUsername,
    notFoundOrHidden,
    errors,
  };
}

export function clampBatchConfig(
  mode: ProviderMode,
  batchSize: number,
  pauseMs: number
): { batchSize: number; pauseMs: number } {
  const safeBatch = Number.isFinite(batchSize) ? Math.floor(batchSize) : 5;
  const safePause = Number.isFinite(pauseMs) ? Math.floor(pauseMs) : 800;

  if (mode === 'LIVE_MTPROTO') {
    return {
      batchSize: Math.min(Math.max(1, safeBatch), LIVE_MAX_BATCH_SIZE),
      pauseMs: Math.max(LIVE_MIN_PAUSE_MS, safePause),
    };
  }
  return {
    batchSize: Math.min(Math.max(1, safeBatch), 25),
    pauseMs: Math.min(Math.max(100, safePause), 60_000),
  };
}

export function createNewJobRecord(params: {
  tokenHash: string;
  fileName: string;
  providerMode: ProviderMode;
  batchSize: number;
  pauseMs: number;
  defaultCountry: SupportedCountry;
  totalSourceRows: number;
  duplicatesRemoved: number;
  invalidRows: number;
}): Job {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + JOB_TTL_SECONDS * 1000);
  const clamped = clampBatchConfig(params.providerMode, params.batchSize, params.pauseMs);

  return {
    id: crypto.randomUUID(),
    tokenHash: params.tokenHash,
    fileName: params.fileName.slice(0, 120) || 'contacts.csv',
    providerMode: params.providerMode,
    status: 'draft',
    batchSize: clamped.batchSize,
    pauseMs: clamped.pauseMs,
    defaultCountry: params.defaultCountry,
    totalSourceRows: Math.max(0, Math.floor(params.totalSourceRows)),
    duplicatesRemoved: Math.max(0, Math.floor(params.duplicatesRemoved)),
    invalidRows: Math.max(0, Math.floor(params.invalidRows)),
    items: [],
    stats: computeJobStats([]),
    floodWaitTriggeredPhones: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function appendUniquePhonesToJob(job: Job, phones: string[]): { added: number } {
  if (job.status !== 'draft') {
    throw new Error('Chunks can only be appended while job is in draft status');
  }
  if (phones.length > MAX_CHUNK_SIZE) {
    throw new Error(`Chunk size exceeds limit of ${MAX_CHUNK_SIZE}`);
  }

  const existing = new Set(job.items.map((i) => i.phone));
  let added = 0;

  for (const phone of phones) {
    if (!/^\+\d{7,15}$/.test(phone)) continue;
    if (existing.has(phone)) continue;
    if (job.items.length >= MAX_JOB_PHONES) {
      throw new Error(`Job exceeds maximum allowed ${MAX_JOB_PHONES} unique numbers`);
    }
    existing.add(phone);
    job.items.push({
      index: job.items.length,
      phone,
      maskedPhone: maskPhone(phone),
      status: 'pending',
    });
    added += 1;
  }

  job.stats = computeJobStats(job.items);
  job.updatedAt = new Date().toISOString();
  return { added };
}

export function toPublicJobView(
  job: Job,
  options: { offset?: number; limit?: number; filter?: 'all' | 'person' | 'channel' | 'bot' | 'found' } = {}
): PublicJobView {
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(Math.max(1, options.limit ?? 200), 500);
  const filter = options.filter ?? 'all';

  const filtered = job.items.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'found') return item.status === 'found' && Boolean(item.username);
    return item.status === 'found' && item.accountType === filter;
  });

  const slice: PublicJobItem[] = filtered.slice(offset, offset + limit).map((item) => ({
    index: item.index,
    maskedPhone: item.maskedPhone,
    status: item.status,
    username: item.username,
    accountType: item.accountType,
    personalUsername: item.personalUsername,
    linkedChannel: item.linkedChannel,
    errorCode: item.errorCode,
    checkedAt: item.checkedAt,
  }));

  let retryAfterSec: number | undefined;
  if (job.status === 'rate_limited' && job.retryAfterAt) {
    const remainingMs = new Date(job.retryAfterAt).getTime() - Date.now();
    retryAfterSec = remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  return {
    id: job.id,
    fileName: job.fileName,
    providerMode: job.providerMode,
    status: job.status,
    batchSize: job.batchSize,
    pauseMs: job.pauseMs,
    defaultCountry: job.defaultCountry,
    totalSourceRows: job.totalSourceRows,
    duplicatesRemoved: job.duplicatesRemoved,
    invalidRows: job.invalidRows,
    stats: job.stats,
    items: slice,
    totalItems: filtered.length,
    offset,
    limit,
    retryAfterAt: job.retryAfterAt,
    retryAfterSec,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
  };
}

export type StepOutcome =
  | { kind: 'ok'; job: Job }
  | { kind: 'delegated'; job: Job }
  | { kind: 'busy'; job: Job }
  | { kind: 'rate_limited'; job: Job; retryAfterSec: number };

export async function runSandboxJobStep(store: JobStore, jobId: string): Promise<StepOutcome | null> {
  const initial = await store.getJob(jobId);
  if (!initial) return null;

  if (initial.providerMode === 'LIVE_MTPROTO') {
    return { kind: 'delegated', job: initial };
  }

  if (initial.status === 'rate_limited' && initial.retryAfterAt) {
    const remainingMs = new Date(initial.retryAfterAt).getTime() - Date.now();
    if (remainingMs > 0) {
      return {
        kind: 'rate_limited',
        job: initial,
        retryAfterSec: Math.ceil(remainingMs / 1000),
      };
    }
    initial.status = 'running';
    initial.retryAfterAt = undefined;
  }

  if (initial.status !== 'running') {
    return { kind: 'ok', job: initial };
  }

  const leaseId = await store.acquireJobLease(jobId, STEP_LEASE_TTL_MS);
  if (!leaseId) {
    return { kind: 'busy', job: initial };
  }

  try {
    const fresh = await store.getJob(jobId);
    if (!fresh) return null;
    if (fresh.status === 'rate_limited' && fresh.retryAfterAt) {
      const remainingMs = new Date(fresh.retryAfterAt).getTime() - Date.now();
      if (remainingMs > 0) {
        return {
          kind: 'rate_limited',
          job: fresh,
          retryAfterSec: Math.ceil(remainingMs / 1000),
        };
      }
      fresh.status = 'running';
      fresh.retryAfterAt = undefined;
    }

    if (fresh.status !== 'running') {
      return { kind: 'ok', job: fresh };
    }

    const pending = fresh.items.filter((i) => i.status === 'pending').slice(0, fresh.batchSize);
    if (pending.length === 0) {
      fresh.status = 'completed';
      fresh.stats = computeJobStats(fresh.items);
      fresh.updatedAt = new Date().toISOString();
      await store.saveJob(fresh);
      await store.recordJobOutcome('completed');
      return { kind: 'ok', job: fresh };
    }

    const provider = new SandboxLookupProvider();
    const alreadyTriggered = fresh.floodWaitTriggeredPhones ?? [];
    const batchRes = await provider.lookupBatch(
      pending.map((p) => p.phone),
      { alreadyTriggeredFloodPhones: alreadyTriggered }
    );

    // Re-read right before committing to prevent resurrecting deleted PII or clobbering concurrent pause
    const latest = await store.getJob(jobId);
    if (!latest) {
      return null;
    }

    const checkedAt = new Date().toISOString();
    for (const item of latest.items) {
      const outcome = batchRes.items[item.phone];
      if (!outcome) continue;
      item.checkedAt = checkedAt;
      if (outcome.status === 'found') {
        item.status = 'found';
        item.username = outcome.username;
        item.accountType = outcome.accountType;
        item.personalUsername = outcome.personalUsername;
        item.linkedChannel = outcome.linkedChannel;
      } else if (outcome.status === 'found_no_username') {
        item.status = 'found_no_username';
        item.accountType = 'person';
      } else if (outcome.status === 'not_found_or_hidden') {
        item.status = 'not_found_or_hidden';
      } else {
        item.status = 'error';
        item.errorCode = outcome.errorCode;
      }
    }

    latest.stats = computeJobStats(latest.items);

    if (batchRes.floodWaitSeconds && batchRes.floodWaitSeconds > 0) {
      const blockedPhone = pending.find((p) => !(p.phone in batchRes.items))?.phone;
      const latestTriggered = latest.floodWaitTriggeredPhones ?? [];
      if (blockedPhone && !latestTriggered.includes(blockedPhone)) {
        latest.floodWaitTriggeredPhones = [...latestTriggered, blockedPhone];
      }
      latest.retryAfterAt = new Date(Date.now() + batchRes.floodWaitSeconds * 1000).toISOString();
      if (latest.status !== 'paused') {
        latest.status = 'rate_limited';
      }
      await store.recordJobOutcome('rate_limited');
      logInfo('Sandbox job hit simulated FLOOD_WAIT cooldown', {
        jobId: latest.id,
        retryAfterSec: batchRes.floodWaitSeconds,
      });
    } else if (latest.stats.pending === 0) {
      latest.status = 'completed';
      latest.retryAfterAt = undefined;
      await store.recordJobOutcome('completed');
    } else if (latest.status === 'rate_limited') {
      latest.status = 'running';
      latest.retryAfterAt = undefined;
    }

    latest.updatedAt = new Date().toISOString();
    await store.saveJob(latest);
    return { kind: 'ok', job: latest };
  } finally {
    await store.releaseJobLease(jobId, leaseId);
  }
}
