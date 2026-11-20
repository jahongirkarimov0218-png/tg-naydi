import type { Job, JobItem } from '@/lib/types';

const VALID_E164_RE = /^\+\d{7,15}$/;
const VALID_TG_USERNAME_RE = /^@[a-zA-Z0-9_]{3,32}$/;
const FORMULA_PREFIX_RE = /^[\s\t\r\n]*[=+\-@]|^[\t\r\n]/;

export function sanitizeCsvCell(value: string): string {
  if (!value || VALID_E164_RE.test(value) || VALID_TG_USERNAME_RE.test(value)) {
    return value;
  }
  return FORMULA_PREFIX_RE.test(value) ? `'${value}` : value;
}

function escapeCsvField(value: string, delimiter: ';' | ','): string {
  const safe = sanitizeCsvCell(value);
  if (
    safe.includes(delimiter) ||
    safe.includes('"') ||
    safe.includes('\n') ||
    safe.includes('\r')
  ) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function getRussianTypeLabel(item: JobItem): string {
  switch (item.status) {
    case 'found':
      if (item.accountType === 'channel') return 'канал';
      if (item.accountType === 'bot') return 'бот';
      return 'человек';
    case 'found_no_username':
      return 'без username';
    case 'not_found_or_hidden':
      return 'не найден / скрыт';
    case 'error':
      return 'ошибка';
    default:
      return 'в очереди';
  }
}

function extractExportFields(item: JobItem): {
  username: string;
  accountType: string;
  personalUsername: string;
  linkedChannel: string;
} {
  if (item.status === 'found') {
    return {
      username: item.username,
      accountType: item.accountType,
      personalUsername: item.personalUsername ?? '',
      linkedChannel: item.linkedChannel ?? '',
    };
  }
  return {
    username: '',
    accountType: item.status === 'found_no_username' ? item.accountType : '',
    personalUsername: '',
    linkedChannel: '',
  };
}

function formatJobItemRow(item: JobItem, providerMode: Job['providerMode']): string[] {
  const fields = extractExportFields(item);
  const checkedAt = 'checkedAt' in item ? (item.checkedAt ?? '') : '';

  return [
    item.phone,
    fields.username,
    fields.accountType,
    getRussianTypeLabel(item),
    item.status,
    fields.personalUsername,
    fields.linkedChannel,
    providerMode,
    checkedAt,
  ];
}

export function buildResultCsv(
  job: Job,
  options: { delimiter: ';' | ','; onlyFound: boolean } = { delimiter: ';', onlyFound: false }
): string {
  const { delimiter, onlyFound } = options;
  const headers = [
    'phone',
    'username',
    'type',
    'type_label',
    'status',
    'personal_username',
    'linked_channel',
    'mode',
    'checked_at',
  ];

  const rows = job.items.filter((item) => (onlyFound ? item.status === 'found' : true));
  const lines = [headers.join(delimiter)];
  for (const item of rows) {
    const fields = formatJobItemRow(item, job.providerMode);
    lines.push(fields.map((f) => escapeCsvField(f, delimiter)).join(delimiter));
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
