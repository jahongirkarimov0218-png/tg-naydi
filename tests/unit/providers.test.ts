import { describe, expect, it, vi } from 'vitest';
import { SandboxLookupProvider } from '@/lib/providers/sandbox';
import {
  MtprotoLookupProvider,
  type MtprotoClientLike,
} from '@/lib/providers/mtproto';
import { KAZAN_FIXTURE_MAP } from '@/lib/sample-data';

describe('SandboxLookupProvider', () => {
  it('reconciles Kazan sample fixture to exactly 19 found (14 person + 5 channel) and 3 not_found_or_hidden', async () => {
    const provider = new SandboxLookupProvider();
    const phones = Object.keys(KAZAN_FIXTURE_MAP);
    const result = await provider.lookupBatch(phones);

    let person = 0;
    let channel = 0;
    let notFound = 0;
    for (const phone of phones) {
      const outcome = result.items[phone];
      expect(outcome).toBeDefined();
      if (outcome.status === 'found') {
        if (outcome.accountType === 'person') person += 1;
        if (outcome.accountType === 'channel') channel += 1;
      } else if (outcome.status === 'not_found_or_hidden') {
        notFound += 1;
      }
    }

    expect(person + channel).toBe(19);
    expect(person).toBe(14);
    expect(channel).toBe(5);
    expect(notFound).toBe(3);
  });

  it('triggers one-shot FLOOD_WAIT for +79990000429 unless already triggered', async () => {
    const provider = new SandboxLookupProvider();
    const first = await provider.lookupBatch(['+79051114567', '+79990000429'], {
      alreadyTriggeredFloodPhones: [],
    });
    expect(first.floodWaitSeconds).toBe(3);
    expect(first.items['+79051114567']?.status).toBe('found');
    expect(first.items['+79990000429']).toBeUndefined();

    const retry = await provider.lookupBatch(['+79990000429'], {
      alreadyTriggeredFloodPhones: ['+79990000429'],
    });
    expect(retry.floodWaitSeconds).toBeUndefined();
    expect(retry.items['+79990000429']).toBeDefined();
  });

  it('produces deterministic results for arbitrary valid phones', async () => {
    const provider = new SandboxLookupProvider();
    const a = await provider.lookupBatch(['+998901234567', '+79112223344']);
    const b = await provider.lookupBatch(['+998901234567', '+79112223344']);
    expect(a).toEqual(b);
  });
});

describe('MtprotoLookupProvider (GramJS contract tests)', () => {
  it('classifies person, linked personal channel, bot, found_no_username, not_found_or_hidden, and always deletes imported contacts', async () => {
    const deleteContacts = vi.fn().mockResolvedValue(undefined);
    const client: MtprotoClientLike = {
      importContacts: vi.fn().mockResolvedValue([
        {
          clientId: '0',
          phone: '+79051110001',
          userId: '101',
          accessHash: 'h1',
          username: 'alice_person',
          bot: false,
        },
        {
          clientId: '1',
          phone: '+79051110002',
          userId: '102',
          accessHash: 'h2',
          username: 'biz_owner',
          bot: false,
        },
        {
          clientId: '2',
          phone: '+79051110003',
          userId: '103',
          accessHash: 'h3',
          username: 'helper_bot',
          bot: true,
        },
        {
          clientId: '3',
          phone: '+79051110004',
          userId: '104',
          accessHash: 'h4',
          username: undefined,
          bot: false,
        },
      ]),
      getPersonalChannelUsername: vi.fn().mockImplementation(async (userId: string) => {
        if (userId === '102') return 'biz_public_channel';
        return null;
      }),
      deleteContacts,
    };

    const provider = new MtprotoLookupProvider(client);
    const phones = [
      '+79051110001',
      '+79051110002',
      '+79051110003',
      '+79051110004',
      '+79051110005', // unregistered or privacy hidden
    ];

    const res = await provider.lookupBatch(phones);

    expect(res.items['+79051110001']).toEqual({
      status: 'found',
      username: '@alice_person',
      accountType: 'person',
    });
    expect(res.items['+79051110002']).toEqual({
      status: 'found',
      username: '@biz_public_channel',
      accountType: 'channel',
      personalUsername: '@biz_owner',
      linkedChannel: '@biz_public_channel',
    });
    expect(res.items['+79051110003']).toEqual({
      status: 'found',
      username: '@helper_bot',
      accountType: 'bot',
    });
    expect(res.items['+79051110004']).toEqual({
      status: 'found_no_username',
      accountType: 'person',
    });
    expect(res.items['+79051110005']).toEqual({
      status: 'not_found_or_hidden',
    });

    expect(deleteContacts).toHaveBeenCalledTimes(1);
    expect(deleteContacts).toHaveBeenCalledWith([
      { userId: '101', accessHash: 'h1' },
      { userId: '102', accessHash: 'h2' },
      { userId: '103', accessHash: 'h3' },
      { userId: '104', accessHash: 'h4' },
    ]);
  });

  it('catches FloodWaitError, stops batch early, still cleans up imported contacts, and returns floodWaitSeconds', async () => {
    const deleteContacts = vi.fn().mockResolvedValue(undefined);
    const floodError = Object.assign(new Error('FLOOD_WAIT_42'), { seconds: 42 });

    const client: MtprotoClientLike = {
      importContacts: vi.fn().mockResolvedValue([
        {
          clientId: '0',
          phone: '+79051110001',
          userId: '101',
          accessHash: 'h1',
          username: 'alice_person',
          bot: false,
        },
        {
          clientId: '1',
          phone: '+79051110002',
          userId: '102',
          accessHash: 'h2',
          username: 'bob_person',
          bot: false,
        },
      ]),
      getPersonalChannelUsername: vi.fn().mockImplementation(async (userId: string) => {
        if (userId === '102') throw floodError;
        return null;
      }),
      deleteContacts,
    };

    const provider = new MtprotoLookupProvider(client);
    const res = await provider.lookupBatch(['+79051110001', '+79051110002']);

    expect(res.floodWaitSeconds).toBe(42);
    expect(res.items['+79051110001']?.status).toBe('found');
    expect(res.items['+79051110002']).toBeUndefined();
    expect(deleteContacts).toHaveBeenCalledTimes(1);
  });
});
