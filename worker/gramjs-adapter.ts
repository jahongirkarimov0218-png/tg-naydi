import type { ImportedTelegramContact } from '@/lib/providers/mtproto';

export interface RawTelegramUserLike {
  id: { toString(): string } | string | number;
  accessHash?: { toString(): string } | string | number | null;
  username?: string | null;
  bot?: boolean | null;
}

export interface RawImportedRefLike {
  clientId: { toString(): string } | string | number;
  userId: { toString(): string } | string | number;
}

export interface RawTelegramChannelLike {
  id: { toString(): string } | string | number;
  username?: string | null;
  isChannel: boolean;
}

export function mapImportedTelegramUsers(
  phones: string[],
  importedRefs: RawImportedRefLike[],
  users: RawTelegramUserLike[]
): ImportedTelegramContact[] {
  const usersById = new Map<string, RawTelegramUserLike>();
  for (const user of users) {
    usersById.set(String(user.id), user);
  }

  const out: ImportedTelegramContact[] = [];
  for (const item of importedRefs) {
    const idx = Number(String(item.clientId)) - 1;
    const phone = phones[idx];
    const user = usersById.get(String(item.userId));
    if (!phone || !user) continue;
    out.push({
      clientId: String(item.clientId),
      phone,
      userId: String(user.id),
      accessHash: user.accessHash ? String(user.accessHash) : '0',
      username: user.username || undefined,
      bot: Boolean(user.bot),
    });
  }
  return out;
}

export function extractPersonalChannelUsername(
  personalChannelId: { toString(): string } | string | number | null | undefined,
  chats: RawTelegramChannelLike[]
): string | null {
  if (personalChannelId === null || personalChannelId === undefined) return null;
  const targetId = String(personalChannelId);
  const match = chats.find((c) => c.isChannel && String(c.id) === targetId && Boolean(c.username));
  return match?.username ?? null;
}
