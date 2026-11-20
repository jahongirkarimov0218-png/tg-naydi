import { describe, expect, it } from 'vitest';
import {
  maskPhone,
  normalizePhone,
  validateAndDedupePhones,
} from '@/lib/phone-normalizer';
import { redactSensitiveText } from '@/lib/logger';

describe('phone-normalizer', () => {
  it('normalizes Russian numbers from 8-prefix, 10-digit, and formatted strings', () => {
    expect(normalizePhone('+7 (905) 123-45-67', 'RU')).toBe('+79051234567');
    expect(normalizePhone('8 905 123-45-67', 'RU')).toBe('+79051234567');
    expect(normalizePhone('89051234567', 'RU')).toBe('+79051234567');
    expect(normalizePhone('9051234567', 'RU')).toBe('+79051234567');
  });

  it('normalizes Uzbekistan and international numbers regardless of default country', () => {
    expect(normalizePhone('+998 90 123-45-67', 'RU')).toBe('+998901234567');
    expect(normalizePhone('90 123 45 67', 'UZ')).toBe('+998901234567');
    expect(normalizePhone('+1 (415) 555-2671', 'RU')).toBe('+14155552671');
  });

  it('handles Excel copy-paste artifacts: NBSP, zero-width spaces, leading apostrophe, and tel: URI', () => {
    expect(normalizePhone("+7\u00A0(905)\u00A0123-45-67", 'RU')).toBe('+79051234567');
    expect(normalizePhone("'\u200B8\u00A0905\u00A0123\u00A045\u00A067", 'RU')).toBe('+79051234567');
    expect(normalizePhone('tel:+79051234567', 'RU')).toBe('+79051234567');
  });

  it('rejects clearly invalid inputs', () => {
    expect(normalizePhone('', 'RU')).toBeNull();
    expect(normalizePhone('12345', 'RU')).toBeNull();
    expect(normalizePhone('not-a-phone', 'RU')).toBeNull();
  });

  it('masks Russian and international phones for UI display', () => {
    expect(maskPhone('+79051234567')).toBe('+7 905 •••-45-67');
    expect(maskPhone('+998901234567')).toBe('+998 90 •••-45-67');
  });

  it('deduplicates canonical E.164 numbers while preserving order and counts', () => {
    const res = validateAndDedupePhones(
      [
        '+7 (905) 123-45-67',
        '8 905 123 45 67', // duplicate of first
        '+7 963 777-65-43',
        'invalid-row',
        '+79637776543', // duplicate of second
      ],
      'RU'
    );

    expect(res.uniquePhones).toEqual(['+79051234567', '+79637776543']);
    expect(res.totalRows).toBe(5);
    expect(res.duplicatesRemoved).toBe(2);
    expect(res.invalidRows).toBe(1);
  });
});

describe('logger PII redaction', () => {
  it('redacts raw phone numbers and session-like secrets from log messages', () => {
    const raw =
      'Failed lookup for +79051234567 and +998 90 123-45-67 with TELEGRAM_SESSION=1BVtsOHoBu1234567890abcdef';
    const safe = redactSensitiveText(raw);
    expect(safe).not.toContain('9051234567');
    expect(safe).not.toContain('998 90 123-45-67');
    expect(safe).not.toContain('1BVtsOHoBu');
    expect(safe).toContain('[REDACTED_PHONE]');
    expect(safe).toContain('[REDACTED_SECRET]');
  });
});
