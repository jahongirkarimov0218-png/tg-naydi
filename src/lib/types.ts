export type SupportedCountry = 'RU' | 'UZ' | 'KZ' | 'UA' | 'BY' | 'US';

export type ProviderMode = 'SANDBOX' | 'LIVE_MTPROTO';

export type StorageMode = 'upstash' | 'file' | 'unconfigured';

type JobStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'paused'
  | 'rate_limited'
  | 'completed'
  | 'failed';

type AccountType = 'person' | 'channel' | 'bot';

/** Branded E.164 phone number parsed once at the input boundary. */
export type E164Phone = string & { readonly __brand: 'E164Phone' };

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

/**
 * Discriminated union making illegal JobItem states unrepresentable at compile time:
 * - 'found' ALWAYS carries a non-optional username and accountType
 * - 'error' ALWAYS carries errorCode
 * - 'pending' / 'not_found_or_hidden' CANNOT carry username or accountType
 */
type JobItemState =
  | { status: 'pending' | 'checking' }
  | {
      status: 'found';
      username: string;
      accountType: AccountType;
      personalUsername?: string;
      linkedChannel?: string;
      checkedAt?: string;
    }
  | {
      status: 'found_no_username';
      accountType: 'person';
      checkedAt?: string;
    }
  | {
      status: 'not_found_or_hidden';
      checkedAt?: string;
    }
  | {
      status: 'error';
      errorCode: string;
      checkedAt?: string;
    };

export type JobItem = {
  index: number;
  phone: E164Phone;
  maskedPhone: string;
} & JobItemState;

export type PublicJobItem = {
  index: number;
  maskedPhone: string;
} & JobItemState;

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

interface JobBaseMetadata {
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
  retryAfterAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface Job extends JobBaseMetadata {
  tokenHash: string;
  items: JobItem[];
  floodWaitTriggeredPhones?: string[];
}

export interface PublicJobView extends JobBaseMetadata {
  items: PublicJobItem[];
  totalItems: number;
  offset: number;
  limit: number;
  retryAfterSec?: number;
}

export interface RecentJobMetrics {
  recentJobsTotal: number;
  recentJobsCompleted: number;
  recentJobsFailed: number;
  recentFloodWaits: number;
  errorRate: number;
}
