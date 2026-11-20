import type { BatchLookupResult, LookupOutcome } from '@/lib/types';
import type { TelegramLookupProvider } from '@/lib/providers/types';

export interface ImportedTelegramContact {
  clientId: string;
  phone: string;
  userId: string;
  accessHash: string;
  username?: string;
  bot: boolean;
}

export interface MtprotoClientLike {
  importContacts(phones: string[]): Promise<ImportedTelegramContact[]>;
  getPersonalChannelUsername(userId: string, accessHash: string): Promise<string | null>;
  deleteContacts(users: Array<{ userId: string; accessHash: string }>): Promise<void>;
}

function extractFloodWaitSeconds(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const candidate = err as { seconds?: unknown; errorMessage?: unknown; message?: unknown };
  if (typeof candidate.seconds === 'number' && candidate.seconds > 0) {
    return Math.ceil(candidate.seconds);
  }
  const msg = String(candidate.errorMessage ?? candidate.message ?? '');
  const match = msg.match(/FLOOD_WAIT_(\d+)/i);
  return match ? Number(match[1]) : null;
}

function normalizeHandle(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const clean = raw.trim().replace(/^@+/, '');
  return clean ? `@${clean}` : undefined;
}

function classifyResolvedUser(
  contact: ImportedTelegramContact,
  personalChannelUsername: string | null
): LookupOutcome {
  const userHandle = normalizeHandle(contact.username);
  const channelHandle = normalizeHandle(personalChannelUsername);

  if (contact.bot && userHandle) {
    return { status: 'found', username: userHandle, accountType: 'bot' };
  }
  if (channelHandle) {
    return {
      status: 'found',
      username: channelHandle,
      accountType: 'channel',
      ...(userHandle ? { personalUsername: userHandle } : {}),
      linkedChannel: channelHandle,
    };
  }
  if (userHandle) {
    return { status: 'found', username: userHandle, accountType: 'person' };
  }
  return { status: 'found_no_username', accountType: 'person' };
}

async function resolveSingleContact(
  client: MtprotoClientLike,
  match: ImportedTelegramContact
): Promise<{ outcome?: LookupOutcome; floodWaitSeconds?: number }> {
  if (match.bot) {
    return { outcome: classifyResolvedUser(match, null) };
  }
  try {
    const channel = await client.getPersonalChannelUsername(match.userId, match.accessHash);
    return { outcome: classifyResolvedUser(match, channel) };
  } catch (err) {
    const wait = extractFloodWaitSeconds(err);
    if (wait !== null) return { floodWaitSeconds: wait };
    return { outcome: { status: 'error', errorCode: 'FULL_USER_LOOKUP_FAILED' } };
  }
}

export class MtprotoLookupProvider implements TelegramLookupProvider {
  readonly mode = 'LIVE_MTPROTO' as const;

  constructor(private readonly client: MtprotoClientLike) {}

  async lookupBatch(phones: string[]): Promise<BatchLookupResult> {
    const items: Record<string, LookupOutcome> = {};
    let imported: ImportedTelegramContact[];

    try {
      imported = await this.client.importContacts(phones);
    } catch (err) {
      const wait = extractFloodWaitSeconds(err);
      if (wait !== null) return { items, floodWaitSeconds: wait };
      throw err;
    }

    const byPhone = new Map(imported.map((c) => [c.phone, c]));
    let floodWaitSeconds: number | undefined;

    try {
      for (const phone of phones) {
        const match = byPhone.get(phone);
        if (!match) {
          items[phone] = { status: 'not_found_or_hidden' };
          continue;
        }
        const resolved = await resolveSingleContact(this.client, match);
        if (resolved.floodWaitSeconds !== undefined) {
          floodWaitSeconds = resolved.floodWaitSeconds;
          break;
        }
        if (resolved.outcome) {
          items[phone] = resolved.outcome;
        }
      }
    } finally {
      if (imported.length > 0) {
        await this.client
          .deleteContacts(imported.map((c) => ({ userId: c.userId, accessHash: c.accessHash })))
          .catch(() => undefined);
      }
    }

    return floodWaitSeconds !== undefined ? { items, floodWaitSeconds } : { items };
  }
}
