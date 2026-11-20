const PHONE_PATTERN = /\+?\d[\d\s\-()]{8,18}\d/g;
const SECRET_KV_PATTERN =
  /\b(TELEGRAM_SESSION|TELEGRAM_API_HASH|UPSTASH_REDIS_REST_TOKEN|OPERATOR_ACCESS_KEY|jobToken|accessToken)\s*([=:])\s*([^\s,;'"`]+)/gi;

export function redactSensitiveText(input: string): string {
  return input
    .replace(SECRET_KV_PATTERN, '$1$2[REDACTED_SECRET]')
    .replace(PHONE_PATTERN, '[REDACTED_PHONE]');
}

function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (/phone|token|secret|session|hash|password|key/i.test(key)) {
      out[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      out[key] = redactSensitiveText(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function logInfo(message: string, meta?: Record<string, unknown>): void {
  const safeMsg = redactSensitiveText(message);
  const safeMeta = sanitizeMeta(meta);
  if (safeMeta) {
    console.info(`[tg-naydi] ${safeMsg}`, safeMeta);
  } else {
    console.info(`[tg-naydi] ${safeMsg}`);
  }
}

export function logError(message: string, err?: unknown, meta?: Record<string, unknown>): void {
  const safeMsg = redactSensitiveText(message);
  const errText =
    err instanceof Error ? redactSensitiveText(err.message) : err ? redactSensitiveText(String(err)) : undefined;
  const safeMeta = sanitizeMeta(meta);
  console.error(`[tg-naydi] ${safeMsg}`, { ...(safeMeta ?? {}), ...(errText ? { error: errText } : {}) });
}
