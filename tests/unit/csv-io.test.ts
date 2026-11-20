import { describe, expect, it } from 'vitest';
import { decodeCsvBytes, parseCsvBuffer } from '@/lib/csv-parser';
import { buildResultCsv, sanitizeCsvCell } from '@/lib/csv-exporter';
import { parseE164Phone } from '@/lib/phone-normalizer';
import { KAZAN_SAMPLE_CSV_BYTES } from '@/lib/sample-data';
import type { Job } from '@/lib/types';
import { encodeWindows1251 } from '../helpers/cp1251';

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
    expect(parsed.columnAmbiguous).toBe(false);
    expect(parsed.uniquePhones).toEqual(['+79051114567', '+79632226543']);
  });

  it('handles empty buffers, tab delimiters, column overrides, ambiguity flags, and header fallback', () => {
    const empty = parseCsvBuffer(new TextEncoder().encode('   \r\n  '), 'RU');
    expect(empty.totalRows).toBe(0);
    expect(empty.headers).toEqual([]);
    expect(empty.uniquePhones).toEqual([]);

    const tsv = new TextEncoder().encode('Name\tPhone\tAltPhone\nA\t+79051114567\t+79632226543\nB\t+79213331234\t+79994442233\n');
    const ambig = parseCsvBuffer(tsv, 'RU');
    expect(ambig.delimiter).toBe('\t');
    expect(ambig.columnAmbiguous).toBe(true);
    expect(ambig.selectedColumn).toBe('Phone');

    const overridden = parseCsvBuffer(tsv, 'RU', 'AltPhone');
    expect(overridden.selectedColumn).toBe('AltPhone');
    expect(overridden.columnAmbiguous).toBe(false);
    expect(overridden.uniquePhones).toEqual(['+79632226543', '+79994442233']);

    // No valid phones in rows -> falls back to matching header, else first column
    const noValidWithHeader = parseCsvBuffer(
      new TextEncoder().encode('Name,Телефон\nAlice,bad\n'),
      'RU'
    );
    expect(noValidWithHeader.selectedColumn).toBe('Телефон');
    expect(noValidWithHeader.invalidRows).toBe(1);

    const noValidNoHeader = parseCsvBuffer(
      new TextEncoder().encode('ColA,ColB\nx,y\n'),
      'RU'
    );
    expect(noValidNoHeader.selectedColumn).toBe('ColA');
    expect(noValidNoHeader.columnAmbiguous).toBe(true);

    // Tie-breaker: two 100%-valid columns where one explicitly matches phone header -> not ambiguous
    const tieBreak = parseCsvBuffer(
      new TextEncoder().encode('Other;Тел\n+79051114567;+79632226543\n+79213331234;+79994442233\n'),
      'RU'
    );
    expect(tieBreak.selectedColumn).toBe('Тел');
    expect(tieBreak.columnAmbiguous).toBe(false);

    // Ratio difference >= 0.15 chooses higher validity column even if header differs
    const ratioWin = parseCsvBuffer(
      new TextEncoder().encode('Телефон;MainCol\nbad;+79051114567\n+79632226543;+79213331234\n'),
      'RU'
    );
    expect(ratioWin.selectedColumn).toBe('MainCol');
    expect(ratioWin.columnAmbiguous).toBe(false);

    // Headerless single-column file with blank lines & non-phone headerless ignored
    const plainWithBlanks = parseCsvBuffer(
      new TextEncoder().encode('  +79051114567  \r\n\r\n  +79632226543  \r\n'),
      'RU'
    );
    expect(plainWithBlanks.delimiter).toBe('\n');
    expect(plainWithBlanks.headers).toEqual(['phone']);
    expect(plainWithBlanks.selectedColumn).toBe('phone');
    expect(plainWithBlanks.columnAmbiguous).toBe(false);
    expect(plainWithBlanks.uniquePhones).toEqual(['+79051114567', '+79632226543']);

    // Comma CSV with trimmed headers and missing cell in a row
    const commaTrim = parseCsvBuffer(
      new TextEncoder().encode('  Name ,  Phone  \nAlice,+79051114567\nBob,\n'),
      'RU'
    );
    expect(commaTrim.delimiter).toBe(',');
    expect(commaTrim.headers).toEqual(['Name', 'Phone']);
    expect(commaTrim.uniquePhones).toEqual(['+79051114567']);
    expect(commaTrim.invalidRows).toBe(1);
  });
});

describe('csv-exporter', () => {
  it('neutralizes CSV formula injection while keeping valid E.164 phones and Telegram usernames intact', () => {
    expect(sanitizeCsvCell('')).toBe('');
    expect(sanitizeCsvCell('plain text')).toBe('plain text');
    expect(sanitizeCsvCell('a=b+c-d@e')).toBe('a=b+c-d@e'); // mid-cell operators are safe
    expect(sanitizeCsvCell('+79051234567')).toBe('+79051234567');
    expect(sanitizeCsvCell('+79051234567foo')).toBe("'+79051234567foo");
    expect(sanitizeCsvCell('+123456')).toBe("'+123456"); // too short for E.164 -> escaped
    expect(sanitizeCsvCell('@beze_cakes_kzn')).toBe('@beze_cakes_kzn');
    expect(sanitizeCsvCell('@ab')).toBe("'@ab"); // too short for Telegram handle -> escaped
    expect(sanitizeCsvCell('=HYPERLINK("http://evil.com","click")')).toBe(
      '\'=HYPERLINK("http://evil.com","click")'
    );
    expect(sanitizeCsvCell('=cmd|\' /C calc\'!A0')).toBe("'=cmd|' /C calc'!A0");
    expect(sanitizeCsvCell('+1+1(cmd)')).toBe("'+1+1(cmd)");
    expect(sanitizeCsvCell('-2+3')).toBe("'-2+3");
    expect(sanitizeCsvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(sanitizeCsvCell('\t=1+1')).toBe("'\t=1+1");
    expect(sanitizeCsvCell('\r=1+1')).toBe("'\r=1+1");
    expect(sanitizeCsvCell(' =1+1')).toBe("' =1+1");
    expect(sanitizeCsvCell('\n=HYPERLINK("x")')).toBe('\'\n=HYPERLINK("x")');
  });

  it('renders every JobItem status label and RFC-4180 quotes special characters cleanly', () => {
    const p = (n: string) => parseE164Phone(n)!;
    const job: Job = {
      id: 'job-labels',
      tokenHash: 'hash',
      fileName: 'labels.csv',
      providerMode: 'LIVE_MTPROTO',
      status: 'paused',
      batchSize: 5,
      pauseMs: 15_000,
      defaultCountry: 'RU',
      totalSourceRows: 5,
      duplicatesRemoved: 0,
      invalidRows: 0,
      items: [
        { index: 0, phone: p('+79051110001'), maskedPhone: 'm1', status: 'found', username: '@bot_1', accountType: 'bot', personalUsername: 'has"quote' },
        { index: 1, phone: p('+79051110002'), maskedPhone: 'm2', status: 'found_no_username', accountType: 'person', checkedAt: '2026-11-20T06:00:00Z' },
        { index: 2, phone: p('+79051110003'), maskedPhone: 'm3', status: 'error', errorCode: 'ERR' },
        { index: 3, phone: p('+79051110004'), maskedPhone: 'm4', status: 'pending' },
      ],
      stats: {
        total: 4, processed: 3, pending: 1,
        foundWithUsername: 1, personWithUsername: 0, channelWithUsername: 0, botWithUsername: 1,
        foundNoUsername: 1, notFoundOrHidden: 0, errors: 1,
      },
      createdAt: '2026-11-20T06:00:00.000Z',
      updatedAt: '2026-11-20T06:00:00.000Z',
      expiresAt: '2026-11-21T06:00:00.000Z',
    };

    const csv = buildResultCsv(job);
    expect(csv).toContain(';bot;бот;found;"has""quote";;LIVE_MTPROTO;');
    expect(csv).toContain(';person;без username;found_no_username;;;LIVE_MTPROTO;2026-11-20T06:00:00Z');
    expect(csv).toContain(';;ошибка;error;;;LIVE_MTPROTO;');
    expect(csv).toContain(';;в очереди;pending;;;LIVE_MTPROTO;');
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
          phone: parseE164Phone('+79051234567')!,
          maskedPhone: '+7 905 •••-45-67',
          status: 'found',
          username: '@beze_cakes_kzn',
          accountType: 'person',
          checkedAt: '2026-11-20T06:00:00.000Z',
        },
        {
          index: 1,
          phone: parseE164Phone('+79631234567')!,
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
          phone: parseE164Phone('+79211234567')!,
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
