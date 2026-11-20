/**
 * Standalone Telegram MTProto worker daemon (GramJS).
 *
 * Runs OUTSIDE Vercel Serverless (VPS / Railway / Fly.io / local host) and shares
 * the same JobStore (Upstash Redis or FileStore). Never bundled into Next.js.
 *
 * Enforces:
 *   - Global FIFO mutex on the single Telegram session (lock:mtproto:session)
 *   - 15s worker heartbeat (visible in /api/health -> workerOnline)
 *   - Conservative rate limiting (pauseMs >= 15000, batchSize <= 15)
 *   - Strict respect for Telegram FLOOD_WAIT_X (auto-pauses job to rate_limited)
 *   - Immediate address book cleanup (contacts.deleteContacts in finally)
 */

import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import bigInt from 'big-integer';
import { getJobStore } from '@/lib/job-store';
import { logError, logInfo } from '@/lib/logger';
import {
  MtprotoLookupProvider,
  type ImportedTelegramContact,
  type MtprotoClientLike,
} from '@/lib/providers/mtproto';
import { computeJobStats } from '@/lib/job-engine';

const LIVE_MIN_PAUSE_MS = 15_000;
const LIVE_MAX_BATCH_SIZE = 15;
const HEARTBEAT_INTERVAL_MS = 15_000;
const SESSION_LOCK_TTL_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createGramJsAdapter(client: TelegramClient): MtprotoClientLike {
  return {
    async importContacts(phones: string[]): Promise<ImportedTelegramContact[]> {
      const inputContacts = phones.map(
        (phone, idx) =>
          new Api.InputPhoneContact({
            clientId: bigInt(idx + 1),
            phone,
            firstName: `Check${idx + 1}`,
            lastName: '',
          })
      );

      const response = await client.invoke(
        new Api.contacts.ImportContacts({ contacts: inputContacts })
      );

      const usersById = new Map<string, Api.User>();
      for (const u of response.users) {
        if (u instanceof Api.User) {
          usersById.set(String(u.id), u);
        }
      }

      const imported: ImportedTelegramContact[] = [];
      for (const item of response.imported) {
        const idx = Number(item.clientId.toString()) - 1;
        const phone = phones[idx];
        const user = usersById.get(String(item.userId));
        if (!phone || !user) continue;
        imported.push({
          clientId: String(item.clientId),
          phone,
          userId: String(user.id),
          accessHash: user.accessHash ? String(user.accessHash) : '0',
          username: user.username || undefined,
          bot: Boolean(user.bot),
        });
      }
      return imported;
    },

    async getPersonalChannelUsername(userId: string, accessHash: string): Promise<string | null> {
      const inputUser = new Api.InputUser({
        userId: bigInt(userId),
        accessHash: bigInt(accessHash),
      });
      const full = await client.invoke(new Api.users.GetFullUser({ id: inputUser }));
      const personalChannelId = (full.fullUser as { personalChannelId?: { toString(): string } })
        .personalChannelId;
      if (!personalChannelId) return null;

      const targetId = personalChannelId.toString();
      for (const chat of full.chats) {
        if (chat instanceof Api.Channel && String(chat.id) === targetId && chat.username) {
          return chat.username;
        }
      }
      return null;
    },

    async deleteContacts(users: Array<{ userId: string; accessHash: string }>): Promise<void> {
      if (users.length === 0) return;
      const inputUsers = users.map(
        (u) =>
          new Api.InputUser({
            userId: bigInt(u.userId),
            accessHash: bigInt(u.accessHash),
          })
      );
      await client.invoke(new Api.contacts.DeleteContacts({ id: inputUsers }));
    },
  };
}

async function main(): Promise<void> {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH?.trim();
  const sessionStr = process.env.TELEGRAM_SESSION?.trim();

  if (!apiId || !apiHash || !sessionStr) {
    throw new Error(
      'Missing TELEGRAM_API_ID, TELEGRAM_API_HASH, or TELEGRAM_SESSION. Set them in your private worker environment.'
    );
  }

  const store = getJobStore();
  if (!store) {
    throw new Error('JobStore is unconfigured. Provide UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  }

  const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.connect();
  logInfo('MTProto worker connected cleanly');

  const provider = new MtprotoLookupProvider(createGramJsAdapter(client));
  let shuttingDown = false;

  const heartbeatTimer = setInterval(() => {
    void store.setWorkerHeartbeat(Date.now()).catch((err) => logError('Heartbeat failed', err));
  }, HEARTBEAT_INTERVAL_MS);
  await store.setWorkerHeartbeat(Date.now());

  const stop = async () => {
    shuttingDown = true;
    clearInterval(heartbeatTimer);
    await client.disconnect();
    logInfo('MTProto worker stopped');
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());

  while (!shuttingDown) {
    try {
      const activeJobs = await store.listActiveLiveJobs();
      const now = Date.now();
      const nextJob = activeJobs.find((j) => {
        if (j.status === 'rate_limited' && j.retryAfterAt) {
          return new Date(j.retryAfterAt).getTime() <= now;
        }
        return j.status === 'queued' || j.status === 'running';
      });

      if (!nextJob) {
        await sleep(3_000);
        continue;
      }

      const globalLock = await store.acquireGlobalSessionLock(SESSION_LOCK_TTL_MS);
      if (!globalLock) {
        await sleep(2_000);
        continue;
      }

      try {
        const fresh = await store.getJob(nextJob.id);
        if (!fresh || fresh.status === 'paused' || fresh.status === 'completed' || fresh.status === 'failed') {
          continue;
        }

        const safeBatchSize = Math.min(Math.max(1, fresh.batchSize), LIVE_MAX_BATCH_SIZE);
        const safePauseMs = Math.max(fresh.pauseMs, LIVE_MIN_PAUSE_MS);
        const pending = fresh.items.filter((i) => i.status === 'pending').slice(0, safeBatchSize);

        if (pending.length === 0) {
          fresh.status = 'completed';
          fresh.stats = computeJobStats(fresh.items);
          fresh.updatedAt = new Date().toISOString();
          await store.saveJob(fresh);
          await store.recordJobOutcome('completed');
          continue;
        }

        fresh.status = 'running';
        fresh.retryAfterAt = undefined;
        fresh.updatedAt = new Date().toISOString();
        await store.saveJob(fresh);

        const result = await provider.lookupBatch(pending.map((p) => p.phone));
        const checkedAt = new Date().toISOString();

        for (const item of fresh.items) {
          const outcome = result.items[item.phone];
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

        fresh.stats = computeJobStats(fresh.items);
        if (result.floodWaitSeconds && result.floodWaitSeconds > 0) {
          fresh.status = 'rate_limited';
          fresh.retryAfterAt = new Date(Date.now() + result.floodWaitSeconds * 1000).toISOString();
          await store.recordJobOutcome('rate_limited');
          logInfo('Live job hit FLOOD_WAIT; respecting Telegram cooldown', {
            jobId: fresh.id,
            retryAfterSec: result.floodWaitSeconds,
          });
        } else if (fresh.stats.pending === 0) {
          fresh.status = 'completed';
          await store.recordJobOutcome('completed');
        }
        fresh.updatedAt = new Date().toISOString();
        await store.saveJob(fresh);

        await sleep(safePauseMs);
      } finally {
        await store.releaseGlobalSessionLock(globalLock);
      }
    } catch (err) {
      logError('Worker loop iteration error', err);
      await sleep(5_000);
    }
  }
}

void main();
