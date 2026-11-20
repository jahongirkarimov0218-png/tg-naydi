import type { AccountType, ItemStatus, Job } from '@/lib/types';

const VALID_E164_RE = /^\+\d{7,15}$/;
const VALID_TG_USERNAME_RE = /^@[a-zA-Z0-9_]{3,32}$/;

export function sanitizeCsvCell(value: string): string {
  if (!value) return '';
  if (VALID_E164_RE.test(value) || VALID_TG_USERNAME_RE.test(value)) {
    return value;
  }

  // Neutralize Excel / Calc formula injection payloads
  const firstChar = value.charAt(0);
  if (
    firstChar === '=' ||
    firstChar === '\t' ||
    firstChar === '\r' ||
    firstChar === '+' ||
    firstChar === '-' ||
    firstChar === '@'
  ) {
    return `'${value}`;
  }
  return value;
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

export function getRussianTypeLabel(status: ItemStatus, accountType?: AccountType): string {
  if (status === 'found') {
    if (accountType === 'channel') return 'канал';
    if (accountType === 'bot') return 'бот';
    return 'человек';
  }
  if (status === 'found_no_username') return 'без username';
  if (status === 'not_found_or_hidden') return 'не найден / скрыт';
  if (status === 'error') return 'ошибка';
  return 'в очереди';
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

  const rows = job.items.filter((item) =>
    onlyFound ? item.status === 'found' && Boolean(item.username) : true
  );

  const lines = [headers.join(delimiter)];
  for (const item of rows) {
    const fields = [
      item.phone,
      item.username ?? '',
      item.accountType ?? '',
      getRussianTypeLabel(item.status, item.accountType),
      item.status,
      item.personalUsername ?? '',
      item.linkedChannel ?? '',
      job.providerMode,
      item.checkedAt ?? '',
    ];
    lines.push(fields.map((f) => escapeCsvField(f, delimiter)).join(delimiter));
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
