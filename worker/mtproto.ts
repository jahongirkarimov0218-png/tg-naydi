/**
 * Standalone Telegram MTProto worker daemon (GramJS).
 *
 * Runs OUTSIDE Vercel Serverless (VPS / Railway / Fly.io / local host) and shares
 * the same JobStore (Upstash Redis or FileStore). Never bundled into Next.js.
 *
 * All business logic lives in `worker/live-processor.ts` and `worker/gramjs-adapter.ts`
 * so it is 100% unit-tested without live Telegram calls.
 */

import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import bigInt from 'big-integer';
import { getJobStore } from '@/lib/job-store';
import type { JobStore } from '@/lib/job-store/types';
import { logError, logInfo } from '@/lib/logger';
import { MtprotoLookupProvider, type MtprotoClientLike } from '@/lib/providers/mtproto';
import {
  extractPersonalChannelUsername,
  mapImportedTelegramUsers,
} from './gramjs-adapter';
import { loadDotEnvFile } from './env-loader';
import { startWorkerHealthServer, type WorkerHealthServerHandle } from './health-server';
import {
  computeNextPollDelayMs,
  processNextLiveBatch,
  readWorkerEnvConfig,
  readWorkerIdlePollMs,
} from './live-processor';

const HEARTBEAT_INTERVAL_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createGramJsClientAdapter(client: TelegramClient): MtprotoClientLike {
  return {
    async importContacts(phones) {
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
      const users = response.users.filter((u): u is Api.User => u instanceof Api.User);
      return mapImportedTelegramUsers(phones, response.imported, users);
    },

    async getPersonalChannelUsername(userId, accessHash) {
      const inputUser = new Api.InputUser({
        userId: bigInt(userId),
        accessHash: bigInt(accessHash),
      });
      const full = await client.invoke(new Api.users.GetFullUser({ id: inputUser }));
      const personalId = (full.fullUser as { personalChannelId?: { toString(): string } })
        .personalChannelId;
      const chats = full.chats.map((c) => ({
        id: c.id,
        username: c instanceof Api.Channel ? c.username : undefined,
        isChannel: c instanceof Api.Channel,
      }));
      return extractPersonalChannelUsername(personalId, chats);
    },

    async deleteContacts(users) {
      if (users.length === 0) return;
      const inputUsers = users.map(
        (u) => new Api.InputUser({ userId: bigInt(u.userId), accessHash: bigInt(u.accessHash) })
      );
      await client.invoke(new Api.contacts.DeleteContacts({ id: inputUsers }));
    },
  };
}

function requireWorkerStore(): JobStore {
  const store = getJobStore();
  if (!store) {
    throw new Error('JobStore is unconfigured. Provide UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  }
  return store;
}

async function runSingleDaemonTick(
  store: JobStore,
  provider: MtprotoLookupProvider,
  idlePollMs: number
): Promise<number> {
  try {
    const tick = await processNextLiveBatch(store, provider);
    return computeNextPollDelayMs(tick, idlePollMs);
  } catch (err) {
    logError('Worker loop iteration error', err);
    return 5_000;
  }
}

function readOptionalHealthPort(env: Record<string, string | undefined> = process.env): number | null {
  const raw = env.PORT?.trim() || env.WORKER_HEALTH_PORT?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : null;
}

async function runDaemon(): Promise<void> {
  loadDotEnvFile();
  const { apiId, apiHash, sessionStr } = readWorkerEnvConfig();
  const idlePollMs = readWorkerIdlePollMs();
  const store = requireWorkerStore();

  const startedAtMs = Date.now();
  let connected = false;
  let lastHeartbeatAtMs: number | null = null;
  let healthServer: WorkerHealthServerHandle | null = null;

  const healthPort = readOptionalHealthPort();
  if (healthPort !== null) {
    healthServer = await startWorkerHealthServer(healthPort, () => ({
      connected,
      lastHeartbeatAtMs,
      startedAtMs,
    }));
    logInfo('Worker health HTTP server listening', { port: healthServer.port });
  }

  const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
    connectionRetries: 5,
  });
  await client.connect();
  connected = true;
  logInfo('MTProto worker connected cleanly', { idlePollMs, heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS });

  const provider = new MtprotoLookupProvider(createGramJsClientAdapter(client));
  let active = true;

  const beat = async () => {
    const now = Date.now();
    await store.setWorkerHeartbeat(now);
    lastHeartbeatAtMs = now;
  };

  const heartbeatTimer = setInterval(() => {
    void beat().catch((err) => logError('Heartbeat failed', err));
  }, HEARTBEAT_INTERVAL_MS);
  await beat();

  const stop = async () => {
    active = false;
    connected = false;
    clearInterval(heartbeatTimer);
    if (healthServer) {
      await healthServer.close().catch(() => undefined);
    }
    await client.disconnect();
    logInfo('MTProto worker stopped');
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());

  while (active) {
    const delayMs = await runSingleDaemonTick(store, provider, idlePollMs);
    await sleep(delayMs);
  }
}

if (require.main === module) {
  void runDaemon();
}
