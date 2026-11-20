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

  it('handles importContacts FloodWait message, rethrows non-flood errors, marks getFullUser errors, and tolerates deleteContacts failure', async () => {
    const floodOnImport: MtprotoClientLike = {
      importContacts: vi.fn().mockRejectedValue({ errorMessage: 'FLOOD_WAIT_19' }),
      getPersonalChannelUsername: vi.fn(),
      deleteContacts: vi.fn(),
    };
    const p1 = new MtprotoLookupProvider(floodOnImport);
    expect(await p1.lookupBatch(['+79051110001'])).toEqual({ items: {}, floodWaitSeconds: 19 });
    expect(floodOnImport.deleteContacts).not.toHaveBeenCalled();

    const fatalOnImport: MtprotoClientLike = {
      importContacts: vi.fn().mockRejectedValue(new Error('AUTH_KEY_UNREGISTERED')),
      getPersonalChannelUsername: vi.fn(),
      deleteContacts: vi.fn(),
    };
    await expect(new MtprotoLookupProvider(fatalOnImport).lookupBatch(['+79051110001'])).rejects.toThrow(
      'AUTH_KEY_UNREGISTERED'
    );

    // Zero seconds or string throw must NOT be misclassified as FLOOD_WAIT
    const zeroSecFlood: MtprotoClientLike = {
      importContacts: vi.fn().mockRejectedValue({ seconds: 0, message: 'NOT_FLOOD' }),
      getPersonalChannelUsername: vi.fn(),
      deleteContacts: vi.fn(),
    };
    await expect(new MtprotoLookupProvider(zeroSecFlood).lookupBatch(['+79051110001'])).rejects.toEqual({
      seconds: 0,
      message: 'NOT_FLOOD',
    });

    // Empty import result does NOT call deleteContacts
    const emptyClient: MtprotoClientLike = {
      importContacts: vi.fn().mockResolvedValue([]),
      getPersonalChannelUsername: vi.fn(),
      deleteContacts: vi.fn(),
    };
    expect(await new MtprotoLookupProvider(emptyClient).lookupBatch(['+79051110001'])).toEqual({
      items: { '+79051110001': { status: 'not_found_or_hidden' } },
    });
    expect(emptyClient.deleteContacts).not.toHaveBeenCalled();

    // Fractional seconds ceils cleanly, and bots skip getPersonalChannelUsername
    const botClient: MtprotoClientLike = {
      importContacts: vi.fn().mockResolvedValue([
        { clientId: '0', phone: '+79051110001', userId: '1', accessHash: 'a1', username: 'bot_u', bot: true },
        { clientId: '1', phone: '+79051110002', userId: '2', accessHash: 'a2', username: 'human_u', bot: false },
      ]),
      getPersonalChannelUsername: vi.fn().mockRejectedValue({ seconds: 1.2 }),
      deleteContacts: vi.fn().mockResolvedValue(undefined),
    };
    const botRes = await new MtprotoLookupProvider(botClient).lookupBatch(['+79051110001', '+79051110002']);
    expect(botClient.getPersonalChannelUsername).toHaveBeenCalledTimes(1);
    expect(botRes.floodWaitSeconds).toBe(2);
    expect(botRes.items['+79051110001']).toEqual({ status: 'found', username: '@bot_u', accountType: 'bot' });

    const partialErrorClient: MtprotoClientLike = {
      importContacts: vi.fn().mockResolvedValue([
        { clientId: '0', phone: '+79051110001', userId: '1', accessHash: 'a1', username: '  @@clean_u ', bot: false },
        { clientId: '1', phone: '+79051110002', userId: '2', accessHash: 'a2', username: 'ok_u', bot: false },
        { clientId: '2', phone: '+79051110003', userId: '3', accessHash: 'a3', username: undefined, bot: true },
      ]),
      getPersonalChannelUsername: vi
        .fn()
        .mockRejectedValueOnce(new Error('RPC_TIMEOUT'))
        .mockResolvedValueOnce('  @@linked_ch '),
      deleteContacts: vi.fn().mockRejectedValue(new Error('cleanup failed')),
    };
    const p3 = new MtprotoLookupProvider(partialErrorClient);
    const out = await p3.lookupBatch(['+79051110001', '+79051110002', '+79051110003']);
    expect(out.items['+79051110001']).toEqual({ status: 'error', errorCode: 'FULL_USER_LOOKUP_FAILED' });
    expect(out.items['+79051110002']).toEqual({
      status: 'found',
      username: '@linked_ch',
      accountType: 'channel',
      personalUsername: '@ok_u',
      linkedChannel: '@linked_ch',
    });
    expect(out.items['+79051110003']).toEqual({ status: 'found_no_username', accountType: 'person' });
  });
});
