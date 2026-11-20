const PHONE_PATTERN = /(?<![a-fA-F0-9-])\+?\d[\d\s\-()]{8,18}\d(?![a-fA-F0-9-])/g;
const SECRET_KV_PATTERN =
  /\b(TELEGRAM_SESSION|TELEGRAM_API_HASH|UPSTASH_REDIS_REST_TOKEN|OPERATOR_ACCESS_KEY|jobToken|accessToken)\s*([=:])\s*([^\s,;'"`]+)/gi;

export function redactSensitiveText(input: string): string {
  return input
    .replace(SECRET_KV_PATTERN, '$1$2[REDACTED_SECRET]')
    .replace(PHONE_PATTERN, '[REDACTED_PHONE]');
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 5) return '[TRUNCATED]';
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/phone|token|secret|session|hash|password|key/i.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = sanitizeValue(nested, depth + 1);
      }
    }
    return out;
  }
  return value;
}

function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  return sanitizeValue(meta, 0) as Record<string, unknown>;
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
