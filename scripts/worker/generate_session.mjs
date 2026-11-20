/**
 * Interactive Telegram MTProto StringSession generator for TG Naydi.
 *
 * Reads TELEGRAM_API_ID and TELEGRAM_API_HASH from .env.local (or process.env),
 * runs GramJS login with your dedicated technical Telegram account, and saves
 * TELEGRAM_SESSION directly into local gitignored .env.local without printing
 * the session string to the terminal.
 *
 * Usage:
 *   pnpm run worker:session
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const ENV_FILE = path.resolve(process.cwd(), '.env.local');

function loadLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key] && val) {
      process.env[key] = val;
    }
  }
}

function upsertEnvVar(filePath, key, value) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = existing ? existing.split(/\r?\n/) : [];
  let replaced = false;
  const updated = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) {
    updated.push(`${key}=${value}`);
  }
  const normalized = `${updated.join('\n').replace(/\n+$/, '')}\n`;
  fs.writeFileSync(filePath, normalized, 'utf8');
}

async function main() {
  loadLocalEnv(ENV_FILE);

  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = (process.env.TELEGRAM_API_HASH || '').trim();
  if (!apiId || !apiHash) {
    console.error(
      '[ERROR] TELEGRAM_API_ID и TELEGRAM_API_HASH не найдены. Проверьте .env.local.'
    );
    process.exit(1);
  }

  console.log('\n=== TG Naydi — Генерация TELEGRAM_SESSION ===');
  console.log('ВАЖНО: используйте ОТДЕЛЬНЫЙ технический аккаунт Telegram (не личный!).');
  console.log('Секретная строка сессии будет записана прямо в .env.local и не выведется в консоль.\n');

  const rl = readline.createInterface({ input, output });
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.start({
      phoneNumber: async () =>
        (await rl.question('1. Номер телефона Telegram (в формате +998... или +7...): ')).trim(),
      phoneCode: async () =>
        (await rl.question('2. Введите 5-значный код, который пришёл в Telegram: ')).trim(),
      password: async () =>
        (await rl.question('3. Пароль 2FA (если включён; если нет — просто Enter): ')).trim(),
      onError: (err) => {
        console.error('[Telegram error]:', err instanceof Error ? err.message : String(err));
      },
    });

    const sessionString = String(client.session.save());
    if (!sessionString) {
      throw new Error('Telegram returned an empty session string.');
    }

    upsertEnvVar(ENV_FILE, 'TELEGRAM_SESSION', sessionString);
    console.log('\n[OK] TELEGRAM_SESSION успешно сохранён в .env.local (в консоль не выводится).');
    console.log('Теперь можно запускать воркер командой: pnpm run worker:mtproto\n');
  } finally {
    rl.close();
    await client.disconnect().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('[FAILED]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
