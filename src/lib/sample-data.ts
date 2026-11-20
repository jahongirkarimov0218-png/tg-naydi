import type { LookupOutcome } from '@/lib/types';

export const KAZAN_SAMPLE_FILENAME = 'Контакты Казани.csv';

/**
 * 25 source rows -> 22 unique valid phones (2 duplicates removed + 1 invalid row).
 * In SandboxLookupProvider these 22 numbers reconcile to:
 *   19 found with username = 14 person ("человек, пиши") + 5 channel ("канал")
 *   3 not_found_or_hidden
 * Directly echoes docs/design/ref-02-monitor-and-results.jpg.
 */
const KAZAN_SAMPLE_CSV_TEXT = [
  'Имя;Телефон;Город',
  'Beze Cakes;+7 (905) 111-45-67;Казань',
  'SpeakUp Kids;8 963 222-65-43;Казань',
  'Mimi Nails;+7 921 333-12-34;Казань',
  'Kazan Coffee;89994442233;Казань',
  'Volga Flowers;+7 906 555-44-55;Казань',
  'Beze Cakes (дубль);8-905-111-45-67;Казань',
  'Kazan Pilates;+7 (917) 601-11-22;Казань',
  'ChakChak Lab;+7 917 602-33-44;Казань',
  'Tatar Travel;8 (917) 603-55-66;Казань',
  'Art Studio KZN;9176047788;Казань',
  'Dentist Pro;+7 917 605-99-00;Казань',
  'Kids Swim KZN;+7 917 606-12-12;Казань',
  'Auto Detail KZN;8 917 607-34-34;Казань',
  'Beauty Loft;+7 917 608-56-56;Казань',
  'Kazan Yoga;+7 917 609-78-78;Казань',
  'Некорректный контакт;не-номер-123;Казань',
  'Woodcraft KZN;+7 917 610-90-90;Казань',
  'Photo Space KZN;+7 917 611-21-21;Казань',
  'Legal Advice KZN;+7 917 612-43-43;Казань',
  'Bakery Dom;+7 917 613-65-65;Казань',
  'Fitness Club KZN;+7 917 614-87-87;Казань',
  'SpeakUp Kids (дубль);+79632226543;Казань',
  'Closed Contact 1;+7 917 615-10-10;Казань',
  'Closed Contact 2;+7 917 616-20-20;Казань',
  'Closed Contact 3;+7 917 617-30-30;Казань',
].join('\r\n');

export const KAZAN_SAMPLE_CSV_BYTES = new TextEncoder().encode(`\uFEFF${KAZAN_SAMPLE_CSV_TEXT}`);

export const KAZAN_FIXTURE_MAP: Record<string, LookupOutcome> = {
  '+79051114567': { status: 'found', username: '@beze_cakes_kzn', accountType: 'person' },
  '+79632226543': {
    status: 'found',
    username: '@speakup_kids_kzn',
    accountType: 'channel',
    personalUsername: '@speakup_admin',
    linkedChannel: '@speakup_kids_kzn',
  },
  '+79213331234': { status: 'found', username: '@mimi_nails_kzn', accountType: 'person' },
  '+79994442233': { status: 'found', username: '@kazan_coffee_bar', accountType: 'person' },
  '+79065554455': {
    status: 'found',
    username: '@volga_flowers_ch',
    accountType: 'channel',
    personalUsername: '@volga_manager',
    linkedChannel: '@volga_flowers_ch',
  },
  '+79176011122': { status: 'found', username: '@kazan_pilates_studio', accountType: 'person' },
  '+79176023344': { status: 'found', username: '@chakchak_lab_kzn', accountType: 'person' },
  '+79176035566': {
    status: 'found',
    username: '@tatar_travel_guide',
    accountType: 'channel',
    linkedChannel: '@tatar_travel_guide',
  },
  '+79176047788': { status: 'found', username: '@art_studio_kzn', accountType: 'person' },
  '+79176059900': { status: 'found', username: '@dentist_pro_kzn', accountType: 'person' },
  '+79176061212': {
    status: 'found',
    username: '@kids_swim_kzn',
    accountType: 'channel',
    linkedChannel: '@kids_swim_kzn',
  },
  '+79176073434': { status: 'found', username: '@auto_detail_kzn', accountType: 'person' },
  '+79176085656': { status: 'found', username: '@beauty_loft_kzn', accountType: 'person' },
  '+79176097878': { status: 'found', username: '@kazan_yoga_club', accountType: 'person' },
  '+79176109090': { status: 'found', username: '@woodcraft_kzn', accountType: 'person' },
  '+79176112121': { status: 'found', username: '@photo_space_kzn', accountType: 'person' },
  '+79176124343': { status: 'found', username: '@legal_advice_kzn', accountType: 'person' },
  '+79176136565': { status: 'found', username: '@bakery_dom_kzn', accountType: 'person' },
  '+79176148787': {
    status: 'found',
    username: '@fitness_club_kzn',
    accountType: 'channel',
    linkedChannel: '@fitness_club_kzn',
  },
  '+79176151010': { status: 'not_found_or_hidden' },
  '+79176162020': { status: 'not_found_or_hidden' },
  '+79176173030': { status: 'not_found_or_hidden' },
};
