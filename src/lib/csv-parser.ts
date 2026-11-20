import Papa from 'papaparse';
import { normalizePhone, validateAndDedupePhones } from '@/lib/phone-normalizer';
import type { E164Phone, SupportedCountry } from '@/lib/types';

export interface DecodedCsv {
  text: string;
  encoding: 'utf-8' | 'windows-1251';
}

export interface ParsedCsvResult {
  encoding: 'utf-8' | 'windows-1251';
  delimiter: string;
  headers: string[];
  selectedColumn: string;
  columnAmbiguous: boolean;
  totalRows: number;
  uniquePhones: E164Phone[];
  duplicatesRemoved: number;
  invalidRows: number;
}

const PHONE_HEADER_RE = /phone|телефон|номер|мобил|(?<![a-zа-яё])(?:tel|тел)(?![a-zа-яё])/i;

export function decodeCsvBytes(bytes: Uint8Array): DecodedCsv {
  try {
    // TextDecoder('utf-8', { fatal: true }) strips UTF-8 BOM natively and rejects invalid CP1251 bytes
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1251').decode(bytes), encoding: 'windows-1251' };
  }
}

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 5);
  let best = ',';
  let bestScore = 0;

  for (const delim of [';', ',', '\t']) {
    const counts = sample.map((line) => line.split(delim).length - 1);
    const minCount = Math.min(...counts);
    const total = counts.reduce((acc, n) => acc + n, 0);
    if (minCount > 0 && total > bestScore) {
      bestScore = total;
      best = delim;
    }
  }
  return best;
}

function scoreColumn(
  header: string,
  sample: Record<string, string>[],
  defaultCountry: SupportedCountry
) {
  const nonEmpty = sample.map((r) => (r[header] ?? '').trim()).filter(Boolean);
  const valid = nonEmpty.filter((v) => normalizePhone(v, defaultCountry) !== null).length;
  return {
    header,
    ratio: nonEmpty.length > 0 ? valid / nonEmpty.length : 0,
    headerMatch: PHONE_HEADER_RE.test(header),
  };
}

function detectPhoneColumn(
  headers: string[],
  rows: Record<string, string>[],
  defaultCountry: SupportedCountry
): { selectedColumn: string; ambiguous: boolean } {
  const sample = rows.slice(0, 20);
  const scored = headers.map((h) => scoreColumn(h, sample, defaultCountry));

  scored.sort((a, b) => {
    if (Math.abs(b.ratio - a.ratio) >= 0.15) return b.ratio - a.ratio;
    if (a.headerMatch !== b.headerMatch) return a.headerMatch ? -1 : 1;
    return b.ratio - a.ratio;
  });

  const strong = scored.filter((s) => s.ratio >= 0.5);
  if (strong.length > 0) {
    const ambiguous =
      strong.length > 1 &&
      Math.abs(strong[0].ratio - strong[1].ratio) < 0.15 &&
      strong[0].headerMatch === strong[1].headerMatch;
    return { selectedColumn: strong[0].header, ambiguous };
  }

  const headerMatches = scored.filter((s) => s.headerMatch);
  if (headerMatches.length > 0) {
    return { selectedColumn: headerMatches[0].header, ambiguous: headerMatches.length > 1 };
  }

  return { selectedColumn: headers[0] ?? 'phone', ambiguous: headers.length > 1 };
}

export function parseCsvBuffer(
  bytes: Uint8Array,
  defaultCountry: SupportedCountry = 'RU',
  columnOverride?: string
): ParsedCsvResult {
  const { text, encoding } = decodeCsvBytes(bytes);
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      encoding,
      delimiter: ',',
      headers: [],
      selectedColumn: '',
      columnAmbiguous: false,
      totalRows: 0,
      uniquePhones: [],
      duplicatesRemoved: 0,
      invalidRows: 0,
    };
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const delimiter = detectDelimiter(lines);

  if (lines[0].split(delimiter).length === 1 && normalizePhone(lines[0], defaultCountry) !== null) {
    const validation = validateAndDedupePhones(lines, defaultCountry);
    return {
      encoding,
      delimiter: '\n',
      headers: ['phone'],
      selectedColumn: 'phone',
      columnAmbiguous: false,
      ...validation,
    };
  }

  const parsed = Papa.parse<Record<string, string>>(trimmed, {
    header: true,
    delimiter,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const headers = (parsed.meta.fields ?? []).filter(Boolean);
  const rows = parsed.data.filter((row) =>
    Object.values(row).some((v) => typeof v === 'string' && v.trim().length > 0)
  );

  const useOverride = Boolean(columnOverride && headers.includes(columnOverride));
  const detected = useOverride
    ? { selectedColumn: columnOverride!, ambiguous: false }
    : detectPhoneColumn(headers, rows, defaultCountry);

  const rawValues = rows.map((row) => String(row[detected.selectedColumn] ?? ''));
  const validation = validateAndDedupePhones(rawValues, defaultCountry);

  return {
    encoding,
    delimiter,
    headers,
    selectedColumn: detected.selectedColumn,
    columnAmbiguous: detected.ambiguous,
    ...validation,
  };
}
