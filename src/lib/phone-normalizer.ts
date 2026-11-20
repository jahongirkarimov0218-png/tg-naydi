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

function toParseCandidate(cleaned: string, digitsOnly: string, defaultCountry: SupportedCountry): string {
  if (defaultCountry !== 'RU' || cleaned.startsWith('+')) {
    return cleaned;
  }
  if (digitsOnly.length === 11 && digitsOnly.startsWith('8')) {
    return `+7${digitsOnly.slice(1)}`;
  }
  if (digitsOnly.length === 10 && digitsOnly.startsWith('9')) {
    return `+7${digitsOnly}`;
  }
  return cleaned;
}

export function normalizePhone(
  raw: string,
  defaultCountry: SupportedCountry = 'RU'
): E164Phone | null {
  if (typeof raw !== 'string') return null;
  const cleaned = stripCopyPasteNoise(raw);
  if (!cleaned || /[a-zA-Zа-яА-ЯёЁ]/.test(cleaned)) return null;

  const digitsOnly = cleaned.replace(/\D/g, '');
  if (digitsOnly.length < 7 || digitsOnly.length > 15) return null;

  const candidate = toParseCandidate(cleaned, digitsOnly, defaultCountry);
  const parsed = candidate.startsWith('+')
    ? parsePhoneNumberFromString(candidate)
    : parsePhoneNumberFromString(candidate, defaultCountry as CountryCode);

  return parsed && parsed.isValid() ? (parsed.number as E164Phone) : null;
}

export function maskPhone(e164: string): string {
  const clean = e164.trim();
  // Russian / Kazakh +7 AAA BBB-CC-DD -> +7 AAA •••-CC-DD
  if (/^\+7\d{10}$/.test(clean)) {
    const area = clean.slice(2, 5);
    const tail1 = clean.slice(8, 10);
    const tail2 = clean.slice(10, 12);
    return `+7 ${area} •••-${tail1}-${tail2}`;
  }
  // Uzbekistan +998 AA BBB-CC-DD -> +998 AA •••-CC-DD
  if (/^\+998\d{9}$/.test(clean)) {
    const area = clean.slice(4, 6);
    const tail1 = clean.slice(9, 11);
    const tail2 = clean.slice(11, 13);
    return `+998 ${area} •••-${tail1}-${tail2}`;
  }
  // Generic E.164 mask: always hide at least 3 middle digits even on short 7-8 digit international numbers
  if (/^\+\d{7,15}$/.test(clean)) {
    const digitsCount = clean.length - 1;
    if (digitsCount <= 8) {
      const prefix = clean.slice(0, 3);
      const tail = clean.slice(-2);
      return `${prefix} •••-${tail}`;
    }
    const prefixLen = Math.min(5, clean.length - 7);
    const prefix = clean.slice(0, Math.max(3, prefixLen));
    const tail1 = clean.slice(-4, -2);
    const tail2 = clean.slice(-2);
    return `${prefix} •••-${tail1}-${tail2}`;
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
