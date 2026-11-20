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
  if (match) {
    return Number(match[1]);
  }
  return null;
}

function normalizeHandle(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const clean = raw.trim().replace(/^@+/, '');
  return clean ? `@${clean}` : undefined;
}

export function classifyResolvedUser(
  contact: ImportedTelegramContact,
  personalChannelUsername: string | null
): LookupOutcome {
  const userHandle = normalizeHandle(contact.username);
  const channelHandle = normalizeHandle(personalChannelUsername);

  if (contact.bot && userHandle) {
    return {
      status: 'found',
      username: userHandle,
      accountType: 'bot',
    };
  }

  // Strictly classify linked personal channels via userFull.personal_channel_id (no bio scraping)
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
    return {
      status: 'found',
      username: userHandle,
      accountType: 'person',
    };
  }

  return {
    status: 'found_no_username',
    accountType: 'person',
  };
}

export class MtprotoLookupProvider implements TelegramLookupProvider {
  readonly mode = 'LIVE_MTPROTO' as const;

  constructor(private readonly client: MtprotoClientLike) {}

  async lookupBatch(phones: string[]): Promise<BatchLookupResult> {
    const items: Record<string, LookupOutcome> = {};
    let imported: ImportedTelegramContact[] = [];

    try {
      imported = await this.client.importContacts(phones);
    } catch (err) {
      const wait = extractFloodWaitSeconds(err);
      if (wait !== null) {
        return { items, floodWaitSeconds: wait };
      }
      throw err;
    }

    const byPhone = new Map<string, ImportedTelegramContact>();
    for (const contact of imported) {
      byPhone.set(contact.phone, contact);
    }

    let floodWaitSeconds: number | undefined;

    try {
      for (const phone of phones) {
        const match = byPhone.get(phone);
        if (!match) {
          // Telegram deliberately does not distinguish unregistered vs privacy-hidden phone numbers
          items[phone] = { status: 'not_found_or_hidden' };
          continue;
        }

        let personalChannelUsername: string | null = null;
        if (!match.bot) {
          try {
            personalChannelUsername = await this.client.getPersonalChannelUsername(
              match.userId,
              match.accessHash
            );
          } catch (err) {
            const wait = extractFloodWaitSeconds(err);
            if (wait !== null) {
              floodWaitSeconds = wait;
              break;
            }
            items[phone] = { status: 'error', errorCode: 'FULL_USER_LOOKUP_FAILED' };
            continue;
          }
        }

        items[phone] = classifyResolvedUser(match, personalChannelUsername);
      }
    } finally {
      if (imported.length > 0) {
        try {
          await this.client.deleteContacts(
            imported.map((c) => ({ userId: c.userId, accessHash: c.accessHash }))
          );
        } catch {
          // Best-effort address book cleanup; do not mask primary lookup outcome or FLOOD_WAIT
        }
      }
    }

    return floodWaitSeconds !== undefined ? { items, floodWaitSeconds } : { items };
  }
}
