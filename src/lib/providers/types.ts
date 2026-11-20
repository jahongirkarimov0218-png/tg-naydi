import type { BatchLookupResult, ProviderMode } from '@/lib/types';

export interface LookupBatchContext {
  alreadyTriggeredFloodPhones?: string[];
}

export interface TelegramLookupProvider {
  readonly mode: ProviderMode;
  lookupBatch(phones: string[], ctx?: LookupBatchContext): Promise<BatchLookupResult>;
}
