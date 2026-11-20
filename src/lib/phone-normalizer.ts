import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import type { E164Phone, SupportedCountry } from '@/lib/types';

export interface PhoneBatchValidation {
  totalRows: number;
  uniquePhones: E164Phone[];
  duplicatesRemoved: number;
  invalidRows: number;
}

const E164_RE = /^\+\d{7,15}$/;

export function parseE164Phone(raw: string): E164Phone | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return E164_RE.test(trimmed) ? (trimmed as E164Phone) : null;
}

function stripCopyPasteNoise(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .replace(/^'+/, '')
    .replace(/^tel:\s*/i, '')
    .trim();
}

export function normalizePhone(
  raw: string,
  defaultCountry: SupportedCountry = 'RU'
): E164Phone | null {
  if (typeof raw !== 'string') return null;
  const cleaned = stripCopyPasteNoise(raw);
  if (!cleaned || /[a-zA-Zа-яА-ЯёЁ]/.test(cleaned)) return null;

  const parsed = cleaned.startsWith('+')
    ? parsePhoneNumberFromString(cleaned)
    : parsePhoneNumberFromString(cleaned, defaultCountry as CountryCode);

  return parsed?.isValid() ? (parsed.number as E164Phone) : null;
}

export function maskPhone(e164: string): string {
  const clean = e164.trim();
  if (/^\+7\d{10}$/.test(clean)) {
    return `+7 ${clean.slice(2, 5)} •••-${clean.slice(8, 10)}-${clean.slice(10, 12)}`;
  }
  if (/^\+998\d{9}$/.test(clean)) {
    return `+998 ${clean.slice(4, 6)} •••-${clean.slice(9, 11)}-${clean.slice(11, 13)}`;
  }
  if (/^\+\d{7,15}$/.test(clean)) {
    if (clean.length <= 9) {
      return `${clean.slice(0, 3)} •••-${clean.slice(-2)}`;
    }
    const prefixLen = Math.max(3, Math.min(5, clean.length - 7));
    return `${clean.slice(0, prefixLen)} •••-${clean.slice(-4, -2)}-${clean.slice(-2)}`;
  }
  return '•••';
}

export function validateAndDedupePhones(
  rawValues: string[],
  defaultCountry: SupportedCountry = 'RU'
): PhoneBatchValidation {
  const seen = new Set<E164Phone>();
  const uniquePhones: E164Phone[] = [];
  let duplicatesRemoved = 0;
  let invalidRows = 0;

  for (const raw of rawValues) {
    const normalized = normalizePhone(raw, defaultCountry);
    if (!normalized) {
      invalidRows += 1;
      continue;
    }
    if (seen.has(normalized)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(normalized);
    uniquePhones.push(normalized);
  }

  return {
    totalRows: rawValues.length,
    uniquePhones,
    duplicatesRemoved,
    invalidRows,
  };
}
