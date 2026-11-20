import crypto from 'node:crypto';
import { KAZAN_FIXTURE_MAP } from '@/lib/sample-data';
import type { BatchLookupResult, LookupOutcome } from '@/lib/types';
import type { LookupBatchContext, TelegramLookupProvider } from '@/lib/providers/types';

const SANDBOX_FLOOD_WAIT_TRIGGER_PHONE = '+79990000429';
const SANDBOX_FLOOD_WAIT_SECONDS = 3;

const ADJECTIVES = [
  'alex',
  'dmitry',
  'elena',
  'marina',
  'timur',
  'kamila',
  'artem',
  'sofia',
  'rustam',
  'olga',
  'studio',
  'market',
  'agency',
  'craft',
  'digital',
];

const NOUNS = [
  'sales',
  'pro',
  'lab',
  'team',
  'hub',
  'design',
  'media',
  'shop',
  'club',
  'service',
  'group',
  'biz',
];

function deterministicOutcomeForPhone(phone: string): LookupOutcome {
  if (KAZAN_FIXTURE_MAP[phone]) {
    return KAZAN_FIXTURE_MAP[phone];
  }

  const hash = crypto.createHash('sha256').update(`tgnaydi-sandbox:${phone}`).digest();
  const bucket = hash[0] % 100;

  if (bucket < 58) {
    const adj = ADJECTIVES[hash[1] % ADJECTIVES.length];
    const noun = NOUNS[hash[2] % NOUNS.length];
    const suffix = String((hash[3] % 90) + 10);
    return {
      status: 'found',
      username: `@${adj}_${noun}_${suffix}`,
      accountType: 'person',
    };
  }

  if (bucket < 76) {
    const adj = ADJECTIVES[hash[1] % ADJECTIVES.length];
    const noun = NOUNS[hash[2] % NOUNS.length];
    const handle = `@${adj}_${noun}_ch`;
    return {
      status: 'found',
      username: handle,
      accountType: 'channel',
      linkedChannel: handle,
    };
  }

  if (bucket < 84) {
    return {
      status: 'found_no_username',
      accountType: 'person',
    };
  }

  return {
    status: 'not_found_or_hidden',
  };
}

export class SandboxLookupProvider implements TelegramLookupProvider {
  readonly mode = 'SANDBOX' as const;

  async lookupBatch(
    phones: string[],
    ctx?: LookupBatchContext
  ): Promise<BatchLookupResult> {
    const triggered = new Set(ctx?.alreadyTriggeredFloodPhones ?? []);
    const items: Record<string, LookupOutcome> = {};

    for (const phone of phones) {
      if (phone === SANDBOX_FLOOD_WAIT_TRIGGER_PHONE && !triggered.has(phone)) {
        return {
          items,
          floodWaitSeconds: SANDBOX_FLOOD_WAIT_SECONDS,
        };
      }
      items[phone] = deterministicOutcomeForPhone(phone);
    }

    return { items };
  }
}
