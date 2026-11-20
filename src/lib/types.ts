export type SupportedCountry = 'RU' | 'UZ' | 'KZ' | 'UA' | 'BY' | 'US';

export type ProviderMode = 'SANDBOX' | 'LIVE_MTPROTO';

export type StorageMode = 'upstash' | 'file' | 'unconfigured';

export type JobStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'paused'
  | 'rate_limited'
  | 'completed'
  | 'failed';

export type AccountType = 'person' | 'channel' | 'bot';

export type ItemStatus =
  | 'pending'
  | 'checking'
  | 'found'
  | 'found_no_username'
  | 'not_found_or_hidden'
  | 'error';

export type LookupOutcome =
  | {
      status: 'found';
      username: string;
      accountType: AccountType;
      personalUsername?: string;
      linkedChannel?: string;
    }
  | {
      status: 'found_no_username';
      accountType: 'person';
    }
  | {
      status: 'not_found_or_hidden';
    }
  | {
      status: 'error';
      errorCode: string;
    };

export interface BatchLookupResult {
  items: Record<string, LookupOutcome>;
  floodWaitSeconds?: number;
}

export interface JobItem {
  index: number;
  phone: string; // canonical E.164 (NEVER returned raw in GET /api/jobs/[id])
  maskedPhone: string;
  status: ItemStatus;
  username?: string;
  accountType?: AccountType;
  personalUsername?: string;
  linkedChannel?: string;
  errorCode?: string;
  checkedAt?: string;
}

export interface PublicJobItem {
  index: number;
  maskedPhone: string;
  status: ItemStatus;
  username?: string;
  accountType?: AccountType;
  personalUsername?: string;
  linkedChannel?: string;
  errorCode?: string;
  checkedAt?: string;
}

export interface JobStats {
  total: number;
  processed: number;
  pending: number;
  foundWithUsername: number;
  personWithUsername: number;
  channelWithUsername: number;
  botWithUsername: number;
  foundNoUsername: number;
  notFoundOrHidden: number;
  errors: number;
}

export interface Job {
  id: string;
  tokenHash: string;
  fileName: string;
  providerMode: ProviderMode;
  status: JobStatus;
  batchSize: number;
  pauseMs: number;
  defaultCountry: SupportedCountry;
  totalSourceRows: number;
  duplicatesRemoved: number;
  invalidRows: number;
  items: JobItem[];
  stats: JobStats;
  floodWaitTriggeredPhones?: string[];
  retryAfterAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface PublicJobView {
  id: string;
  fileName: string;
  providerMode: ProviderMode;
  status: JobStatus;
  batchSize: number;
  pauseMs: number;
  defaultCountry: SupportedCountry;
  totalSourceRows: number;
  duplicatesRemoved: number;
  invalidRows: number;
  stats: JobStats;
  items: PublicJobItem[];
  totalItems: number;
  offset: number;
  limit: number;
  retryAfterAt?: string;
  retryAfterSec?: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface RecentJobMetrics {
  recentJobsTotal: number;
  recentJobsCompleted: number;
  recentJobsFailed: number;
  recentFloodWaits: number;
  errorRate: number;
}
