import { describe, expect, it } from 'vitest';
import { decodeCsvBytes, parseCsvBuffer } from '@/lib/csv-parser';
import { buildResultCsv, sanitizeCsvCell } from '@/lib/csv-exporter';
import { KAZAN_SAMPLE_CSV_BYTES } from '@/lib/sample-data';
import type { Job } from '@/lib/types';

// Helper to encode Cyrillic string into real Windows-1251 bytes
function encodeWindows1251(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code >= 0x0410 && code <= 0x044f) {
      bytes.push(code - 0x0410 + 0xc0);
    } else if (code === 0x0401) {
      bytes.push(0xa8);
    } else if (code === 0x0451) {
      bytes.push(0xb8);
    } else {
      bytes.push(0x3f);
    }
  }
  return new Uint8Array(bytes);
}

describe('csv-parser', () => {
  it('decodes Windows-1251 Russian Excel CSV with semicolon delimiter and detects phone column', () => {
    const cp1251Csv =
      'Имя;Телефон;Город\r\nАнна;8 (905) 111-45-67;Казань\r\nИван;+7 963 222-65-43;Москва\r\nАнна дубль;+79051114567;Казань\r\nБитый;abc;Казань\r\n';
    const bytes = encodeWindows1251(cp1251Csv);

    const decoded = decodeCsvBytes(bytes);
    expect(decoded.encoding).toBe('windows-1251');
    expect(decoded.text).toContain('Телефон');
    expect(decoded.text).toContain('Казань');

    const parsed = parseCsvBuffer(bytes, 'RU');
    expect(parsed.delimiter).toBe(';');
    expect(parsed.selectedColumn).toBe('Телефон');
    expect(parsed.uniquePhones).toEqual(['+79051114567', '+79632226543']);
    expect(parsed.duplicatesRemoved).toBe(1);
    expect(parsed.invalidRows).toBe(1);
  });

  it('parses UTF-8 with BOM and built-in Kazan sample fixture cleanly', () => {
    const parsed = parseCsvBuffer(KAZAN_SAMPLE_CSV_BYTES, 'RU');
    expect(parsed.totalRows).toBe(25);
    expect(parsed.uniquePhones.length).toBe(22);
    expect(parsed.duplicatesRemoved).toBe(2);
    expect(parsed.invalidRows).toBe(1);
  });

  it('parses plain TXT list of phones without headers', () => {
    const bytes = new TextEncoder().encode('+79051234567\n89631234567\n');
    const parsed = parseCsvBuffer(bytes, 'RU');
    expect(parsed.uniquePhones).toEqual(['+79051234567', '+79631234567']);
  });

  it('selects Тел column over Контактное лицо in Russian CRM exports (regression B4)', () => {
    const crmCsv =
      'Контактное лицо;Тел;Город\r\nАнна Петрова;8 (905) 111-45-67;Казань\r\nИван Смирнов;+7 963 222-65-43;Казань\r\n';
    const bytes = encodeWindows1251(crmCsv);
    const parsed = parseCsvBuffer(bytes, 'RU');
    expect(parsed.selectedColumn).toBe('Тел');
    expect(parsed.uniquePhones).toEqual(['+79051114567', '+79632226543']);
  });
});

describe('csv-exporter', () => {
  it('neutralizes CSV formula injection while keeping valid E.164 phones and Telegram usernames intact', () => {
    expect(sanitizeCsvCell('+79051234567')).toBe('+79051234567');
    expect(sanitizeCsvCell('@beze_cakes_kzn')).toBe('@beze_cakes_kzn');
    expect(sanitizeCsvCell('=HYPERLINK("http://evil.com","click")')).toBe(
      '\'=HYPERLINK("http://evil.com","click")'
    );
    expect(sanitizeCsvCell('=cmd|\' /C calc\'!A0')).toBe("'=cmd|' /C calc'!A0");
    expect(sanitizeCsvCell('+1+1(cmd)')).toBe("'+1+1(cmd)");
    expect(sanitizeCsvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(sanitizeCsvCell('\t=1+1')).toBe("'\t=1+1");
    expect(sanitizeCsvCell(' =1+1')).toBe("' =1+1");
    expect(sanitizeCsvCell('\n=HYPERLINK("x")')).toBe('\'\n=HYPERLINK("x")');
  });

  it('builds UTF-8 BOM Excel CSV with mode stamp and onlyFound filter', () => {
    const job: Job = {
      id: 'job-1',
      tokenHash: 'hash',
      fileName: 'contacts.csv',
      providerMode: 'SANDBOX',
      status: 'completed',
      batchSize: 5,
      pauseMs: 500,
      defaultCountry: 'RU',
      totalSourceRows: 3,
      duplicatesRemoved: 0,
      invalidRows: 0,
      items: [
        {
          index: 0,
          phone: '+79051234567',
          maskedPhone: '+7 905 •••-45-67',
          status: 'found',
          username: '@beze_cakes_kzn',
          accountType: 'person',
          checkedAt: '2026-11-20T06:00:00.000Z',
        },
        {
          index: 1,
          phone: '+79631234567',
          maskedPhone: '+7 963 •••-45-67',
          status: 'found',
          username: '@speakup_kids_kzn',
          accountType: 'channel',
          personalUsername: '@speakup_owner',
          linkedChannel: '@speakup_kids_kzn',
          checkedAt: '2026-11-20T06:00:01.000Z',
        },
        {
          index: 2,
          phone: '+79211234567',
          maskedPhone: '+7 921 •••-45-67',
          status: 'not_found_or_hidden',
          checkedAt: '2026-11-20T06:00:02.000Z',
        },
      ],
      stats: {
        total: 3,
        processed: 3,
        pending: 0,
        foundWithUsername: 2,
        personWithUsername: 1,
        channelWithUsername: 1,
        botWithUsername: 0,
        foundNoUsername: 0,
        notFoundOrHidden: 1,
        errors: 0,
      },
      createdAt: '2026-11-20T06:00:00.000Z',
      updatedAt: '2026-11-20T06:00:02.000Z',
      expiresAt: '2026-11-21T06:00:00.000Z',
    };

    const fullCsv = buildResultCsv(job, { delimiter: ';', onlyFound: false });
    expect(fullCsv.startsWith('\uFEFF')).toBe(true);
    expect(fullCsv).toContain(
      'phone;username;type;type_label;status;personal_username;linked_channel;mode;checked_at'
    );
    expect(fullCsv).toContain('+79051234567;@beze_cakes_kzn;person;человек;found;;;SANDBOX;');
    expect(fullCsv).toContain(
      '+79631234567;@speakup_kids_kzn;channel;канал;found;@speakup_owner;@speakup_kids_kzn;SANDBOX;'
    );
    expect(fullCsv).toContain('+79211234567;;;не найден / скрыт;not_found_or_hidden;;;SANDBOX;');

    const onlyFoundCsv = buildResultCsv(job, { delimiter: ',', onlyFound: true });
    expect(onlyFoundCsv.trim().split(/\r?\n/)).toHaveLength(3); // header + 2 found
    expect(onlyFoundCsv).not.toContain('+79211234567');
  });
});
