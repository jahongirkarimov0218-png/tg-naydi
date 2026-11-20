import crypto from 'node:crypto';
import type {
  Job,
  JobItem,
  JobStats,
  LookupOutcome,
  ProviderMode,
  PublicJobItem,
  PublicJobView,
  SupportedCountry,
} from '@/lib/types';
import { JOB_TTL_SECONDS, type JobStore } from '@/lib/job-store/types';
import { maskPhone, parseE164Phone } from '@/lib/phone-normalizer';
import { SandboxLookupProvider } from '@/lib/providers/sandbox';
import { logInfo } from '@/lib/logger';

const MAX_JOB_PHONES = 10_000;
export const MAX_CHUNK_SIZE = 500;
export const LIVE_MIN_PAUSE_MS = 15_000;
export const LIVE_MAX_BATCH_SIZE = 15;
const STEP_LEASE_TTL_MS = 15_000;

export function getRemainingCooldownSeconds(retryAfterAt?: string, nowMs: number = Date.now()): number {
  if (!retryAfterAt) return 0;
  const remainingMs = new Date(retryAfterAt).getTime() - nowMs;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

export function applyOutcomeToItem(
  item: JobItem,
  outcome: LookupOutcome,
  checkedAt: string
): JobItem {
  const base = { index: item.index, phone: item.phone, maskedPhone: item.maskedPhone };
  switch (outcome.status) {
    case 'found':
      return {
        ...base,
        status: 'found',
        username: outcome.username,
        accountType: outcome.accountType,
        ...(outcome.personalUsername ? { personalUsername: outcome.personalUsername } : {}),
        ...(outcome.linkedChannel ? { linkedChannel: outcome.linkedChannel } : {}),
        checkedAt,
      };
    case 'found_no_username':
      return { ...base, status: 'found_no_username', accountType: 'person', checkedAt };
    case 'not_found_or_hidden':
      return { ...base, status: 'not_found_or_hidden', checkedAt };
    case 'error':
      return { ...base, status: 'error', errorCode: outcome.errorCode, checkedAt };
  }
}

export function applyBatchOutcomes(
  items: JobItem[],
  outcomes: Record<string, LookupOutcome>,
  checkedAt: string
): JobItem[] {
  return items.map((item) => {
    const outcome = outcomes[item.phone];
    return outcome ? applyOutcomeToItem(item, outcome, checkedAt) : item;
  });
}

function accumulateItemStats(stats: JobStats, item: JobItem): void {
  if (item.status === 'pending' || item.status === 'checking') {
    stats.pending += 1;
    return;
  }
  stats.processed += 1;
  switch (item.status) {
    case 'found':
      stats.foundWithUsername += 1;
      if (item.accountType === 'channel') stats.channelWithUsername += 1;
      else if (item.accountType === 'bot') stats.botWithUsername += 1;
      else stats.personWithUsername += 1;
      break;
    case 'found_no_username':
      stats.foundNoUsername += 1;
      break;
    case 'not_found_or_hidden':
      stats.notFoundOrHidden += 1;
      break;
    case 'error':
      stats.errors += 1;
      break;
  }
}

export function computeJobStats(items: JobItem[]): JobStats {
  const stats: JobStats = {
    total: items.length,
    processed: 0,
    pending: 0,
    foundWithUsername: 0,
    personWithUsername: 0,
    channelWithUsername: 0,
    botWithUsername: 0,
    foundNoUsername: 0,
    notFoundOrHidden: 0,
    errors: 0,
  };
  for (const item of items) {
    accumulateItemStats(stats, item);
  }
  return stats;
}

function clampBatchConfig(
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

  const existing = new Set<string>(job.items.map((i) => i.phone));
  let added = 0;

  for (const rawPhone of phones) {
    const phone = parseE164Phone(rawPhone);
    if (!phone || existing.has(phone)) continue;
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

export type TransitionResult =
  | { ok: true; job: Job }
  | { ok: false; retryAfterSec: number; job: Job };

/**
 * Single authoritative transition helper for /start and /resume.
 * Enforces Telegram FLOOD_WAIT cooldown strictly (never bypassed via pause -> start).
 */
export function transitionJobToActive(
  job: Job,
  allowedFrom: ReadonlyArray<Job['status']>,
  nowMs: number = Date.now()
): TransitionResult {
  if (!allowedFrom.includes(job.status)) {
    return { ok: true, job };
  }
  const cooldownSec = getRemainingCooldownSeconds(job.retryAfterAt, nowMs);
  if (cooldownSec > 0) {
    return { ok: false, retryAfterSec: cooldownSec, job };
  }
  job.status = job.providerMode === 'LIVE_MTPROTO' ? 'queued' : 'running';
  job.retryAfterAt = undefined;
  job.updatedAt = new Date(nowMs).toISOString();
  return { ok: true, job };
}

function stripPhoneFromItem(item: JobItem): PublicJobItem {
  const { phone: _redacted, ...rest } = item;
  void _redacted;
  return rest;
}

export type PublicItemFilter = 'all' | 'person' | 'channel' | 'bot' | 'found';

function matchesPublicFilter(item: JobItem, filter: PublicItemFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'found') return item.status === 'found';
  return item.status === 'found' && item.accountType === filter;
}

export function toPublicJobView(
  job: Job,
  options: { offset?: number; limit?: number; filter?: PublicItemFilter } = {}
): PublicJobView {
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(Math.max(1, options.limit ?? 200), 500);
  const filter = options.filter ?? 'all';

  const filtered = job.items.filter((item) => matchesPublicFilter(item, filter));
  const slice = filtered.slice(offset, offset + limit).map(stripPhoneFromItem);
  const retryAfterSec =
    job.status === 'rate_limited' ? getRemainingCooldownSeconds(job.retryAfterAt) : undefined;

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

function checkStepEligibility(job: Job): StepOutcome | 'proceed' {
  if (job.providerMode === 'LIVE_MTPROTO') {
    return { kind: 'delegated', job };
  }
  if (job.status === 'rate_limited') {
    const remainingSec = getRemainingCooldownSeconds(job.retryAfterAt);
    if (remainingSec > 0) {
      return { kind: 'rate_limited', job, retryAfterSec: remainingSec };
    }
    return 'proceed';
  }
  return job.status === 'running' ? 'proceed' : { kind: 'ok', job };
}

function finalizeBatchStatus(
  latest: Job,
  pending: JobItem[],
  resolvedPhones: Record<string, LookupOutcome>,
  floodWaitSeconds?: number
): 'completed' | 'rate_limited' | null {
  if (floodWaitSeconds && floodWaitSeconds > 0) {
    const blockedPhone = pending.find((p) => !(p.phone in resolvedPhones))?.phone;
    const seen = latest.floodWaitTriggeredPhones ?? [];
    if (blockedPhone && !seen.includes(blockedPhone)) {
      latest.floodWaitTriggeredPhones = [...seen, blockedPhone];
    }
    latest.retryAfterAt = new Date(Date.now() + floodWaitSeconds * 1000).toISOString();
    if (latest.status !== 'paused') {
      latest.status = 'rate_limited';
    }
    logInfo('Sandbox job hit simulated FLOOD_WAIT cooldown', {
      jobId: latest.id,
      retryAfterSec: floodWaitSeconds,
    });
    return 'rate_limited';
  }

  if (latest.stats.pending === 0) {
    latest.status = 'completed';
    latest.retryAfterAt = undefined;
    return 'completed';
  }

  if (latest.status === 'rate_limited') {
    latest.status = 'running';
    latest.retryAfterAt = undefined;
  }
  return null;
}

async function executeLeasedSandboxBatch(store: JobStore, jobId: string): Promise<StepOutcome | null> {
  const fresh = await store.getJob(jobId);
  if (!fresh) return null;

  const eligibility = checkStepEligibility(fresh);
  if (eligibility !== 'proceed') return eligibility;

  const pending = fresh.items.filter((i) => i.status === 'pending').slice(0, fresh.batchSize);
  if (pending.length === 0) {
    fresh.status = 'completed';
    fresh.retryAfterAt = undefined;
    fresh.stats = computeJobStats(fresh.items);
    fresh.updatedAt = new Date().toISOString();
    await store.saveJob(fresh);
    await store.recordJobOutcome('completed');
    return { kind: 'ok', job: fresh };
  }

  const provider = new SandboxLookupProvider();
  const batchRes = await provider.lookupBatch(
    pending.map((p) => p.phone),
    { alreadyTriggeredFloodPhones: fresh.floodWaitTriggeredPhones ?? [] }
  );

  // Re-read right before committing to prevent resurrecting deleted PII or clobbering concurrent pause
  const latest = await store.getJob(jobId);
  if (!latest) return null;

  latest.items = applyBatchOutcomes(latest.items, batchRes.items, new Date().toISOString());
  latest.stats = computeJobStats(latest.items);

  const recordedOutcome = finalizeBatchStatus(latest, pending, batchRes.items, batchRes.floodWaitSeconds);
  if (recordedOutcome) {
    await store.recordJobOutcome(recordedOutcome);
  }

  latest.updatedAt = new Date().toISOString();
  await store.saveJob(latest);
  return { kind: 'ok', job: latest };
}

export async function runSandboxJobStep(store: JobStore, jobId: string): Promise<StepOutcome | null> {
  const initial = await store.getJob(jobId);
  if (!initial) return null;

  const eligibility = checkStepEligibility(initial);
  if (eligibility !== 'proceed') return eligibility;

  const leaseId = await store.acquireJobLease(jobId, STEP_LEASE_TTL_MS);
  if (!leaseId) return { kind: 'busy', job: initial };

  try {
    return await executeLeasedSandboxBatch(store, jobId);
  } finally {
    await store.releaseJobLease(jobId, leaseId);
  }
}
