import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import type { SupportedCountry } from '@/lib/types';

export interface PhoneBatchValidation {
  totalRows: number;
  uniquePhones: string[];
  duplicatesRemoved: number;
  invalidRows: number;
}

export function normalizePhone(
  raw: string,
  defaultCountry: SupportedCountry = 'RU'
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Reject inputs that contain letters (not a phone string)
  if (/[a-zA-Zа-яА-ЯёЁ]/.test(trimmed)) return null;

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length < 7 || digitsOnly.length > 15) return null;

  // Handle common Russian 8-prefix (11 digits) and 10-digit mobile strings cleanly
  let candidate = trimmed;
  if (defaultCountry === 'RU' && !trimmed.startsWith('+')) {
    if (digitsOnly.length === 11 && digitsOnly.startsWith('8')) {
      candidate = `+7${digitsOnly.slice(1)}`;
    } else if (digitsOnly.length === 10 && digitsOnly.startsWith('9')) {
      candidate = `+7${digitsOnly}`;
    }
  }

  const parsed = candidate.startsWith('+')
    ? parsePhoneNumberFromString(candidate)
    : parsePhoneNumberFromString(candidate, defaultCountry as CountryCode);

  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
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
  // Generic E.164 mask preserving country hint + last 4 digits
  if (/^\+\d{7,15}$/.test(clean)) {
    const prefix = clean.slice(0, Math.min(5, clean.length - 4));
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
  const seen = new Set<string>();
  const uniquePhones: string[] = [];
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
