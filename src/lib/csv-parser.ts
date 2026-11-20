import Papa from 'papaparse';
import { normalizePhone, validateAndDedupePhones } from '@/lib/phone-normalizer';
import type { SupportedCountry } from '@/lib/types';

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
  uniquePhones: string[];
  duplicatesRemoved: number;
  invalidRows: number;
}

const PHONE_HEADER_RE =
  /(?:^|[\s._/-])(?:phone|телефон|номер|тел|mobile|мобил|tel)(?:$|[\s._/-])|phone|телефон|номер|мобил/i;

export function decodeCsvBytes(bytes: Uint8Array): DecodedCsv {
  // Strip UTF-8 BOM if present
  const hasUtf8Bom =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const slice = hasUtf8Bom ? bytes.subarray(3) : bytes;

  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(slice);
    return { text: utf8, encoding: 'utf-8' };
  } catch {
    const cp1251 = new TextDecoder('windows-1251').decode(bytes);
    return { text: cp1251, encoding: 'windows-1251' };
  }
}

function detectDelimiter(sampleText: string): string {
  const firstLines = sampleText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (firstLines.length === 0) return ',';

  const candidates = [';', ',', '\t'];
  let best = ',';
  let bestScore = 0;

  for (const delim of candidates) {
    const counts = firstLines.map((line) => line.split(delim).length - 1);
    const minCount = Math.min(...counts);
    const total = counts.reduce((acc, n) => acc + n, 0);
    if (minCount > 0 && total > bestScore) {
      bestScore = total;
      best = delim;
    }
  }
  return best;
}

export function detectPhoneColumn(
  headers: string[],
  rows: Record<string, string>[],
  defaultCountry: SupportedCountry
): { selectedColumn: string; ambiguous: boolean } {
  const sample = rows.slice(0, 20);
  const scored = headers.map((header) => {
    const nonEmpty = sample
      .map((r) => (r[header] ?? '').trim())
      .filter((v) => v.length > 0);
    const ratio =
      nonEmpty.length === 0
        ? 0
        : nonEmpty.filter((v) => normalizePhone(v, defaultCountry) !== null).length /
          nonEmpty.length;
    const headerMatch = PHONE_HEADER_RE.test(header);
    return { header, ratio, headerMatch };
  });

  // Sort primarily by actual valid phone ratio, using explicit phone header name as tie-breaker
  scored.sort((a, b) => {
    if (Math.abs(b.ratio - a.ratio) >= 0.15) return b.ratio - a.ratio;
    if (a.headerMatch !== b.headerMatch) return a.headerMatch ? -1 : 1;
    return b.ratio - a.ratio;
  });

  const strong = scored.filter((s) => s.ratio >= 0.5);
  if (strong.length >= 1) {
    const ambiguous =
      strong.length > 1 &&
      Math.abs(strong[0].ratio - strong[1].ratio) < 0.15 &&
      strong[0].headerMatch === strong[1].headerMatch;
    return { selectedColumn: strong[0].header, ambiguous };
  }

  const headerMatches = scored.filter((s) => s.headerMatch);
  if (headerMatches.length >= 1) {
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

  const delimiter = detectDelimiter(trimmed);
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Check if file is a headerless plain list of phone numbers (single column where first line is itself a valid phone)
  const firstLineParts = lines[0].split(delimiter);
  if (firstLineParts.length === 1 && normalizePhone(firstLineParts[0], defaultCountry) !== null) {
    const validation = validateAndDedupePhones(lines, defaultCountry);
    return {
      encoding,
      delimiter: '\n',
      headers: ['phone'],
      selectedColumn: 'phone',
      columnAmbiguous: false,
      totalRows: validation.totalRows,
      uniquePhones: validation.uniquePhones,
      duplicatesRemoved: validation.duplicatesRemoved,
      invalidRows: validation.invalidRows,
    };
  }

  const parsed = Papa.parse<Record<string, string>>(trimmed, {
    header: true,
    delimiter,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const headers = (parsed.meta.fields ?? []).filter((h) => h.length > 0);
  const rows = parsed.data.filter((row) =>
    Object.values(row).some((v) => typeof v === 'string' && v.trim().length > 0)
  );

  let selectedColumn = columnOverride && headers.includes(columnOverride) ? columnOverride : '';
  let columnAmbiguous = false;

  if (!selectedColumn) {
    const detected = detectPhoneColumn(headers, rows, defaultCountry);
    selectedColumn = detected.selectedColumn;
    columnAmbiguous = detected.ambiguous;
  }

  const rawValues = rows.map((row) => String(row[selectedColumn] ?? ''));
  const validation = validateAndDedupePhones(rawValues, defaultCountry);

  return {
    encoding,
    delimiter,
    headers,
    selectedColumn,
    columnAmbiguous,
    totalRows: validation.totalRows,
    uniquePhones: validation.uniquePhones,
    duplicatesRemoved: validation.duplicatesRemoved,
    invalidRows: validation.invalidRows,
  };
}
