type FakeKeyringConfig = {
  walletId?: string;
  syncWalletId?: string;
  alias?: string;
  accounts?: Array<{ address: string; index: number }>;
  ready?: boolean;
  requestId?: string | null;
  maxAccountLimit?: number;
};

type FakeInteraction = {
  on: jest.Mock;
  once: jest.Mock;
  emit: jest.Mock;
  removeAllListeners: jest.Mock;
};

/**
 * Builds a minimal KeystoneKeyring double with mutable wallet identity.
 *
 * @param config - Initial keyring state.
 * @param config.walletId - Wallet id exposed by `getWalletId`.
 * @param config.syncWalletId - Wallet id assigned after a simulated QR sync.
 * @param config.alias - Optional wallet alias.
 * @param config.accounts - Accounts reported by the keyring.
 * @param config.ready - Result of `isReady`.
 * @param config.requestId - Pending sign request id, if any.
 * @param config.maxAccountLimit - Result of `getMaxAccountLimit`.
 * @returns The fake keyring plus its fake interaction provider.
 */
function createFakeKeyring(config: FakeKeyringConfig = {}) {
  const interaction: FakeInteraction = {
    on: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
    removeAllListeners: jest.fn(),
  };
  const accounts = config.accounts ?? [];
  let alias = config.alias ?? '';

  const keyring = {
    __syncWalletId: config.syncWalletId ?? config.walletId ?? '',
    __requestId: config.requestId ?? null,
    getWalletId: jest.fn(() => config.walletId ?? ''),
    getWalletName: jest.fn(() => alias || 'Keystone'),
    getWalletAlias: jest.fn(() => alias),
    setWalletAlias: jest.fn((value: string) => {
      alias = value.trim();
    }),
    getDeviceFingerprint: jest.fn(
      () => (config.walletId ?? '').split(':')[0] ?? '',
    ),
    getWalletMode: jest.fn(() => 'hd'),
    getCurrentUsedHDPathType: jest.fn(async () => 'BIP44'),
    getCurrentAccounts: jest.fn(async () => accounts),
    getAccounts: jest.fn(async () => accounts.map(account => account.address)),
    isReady: jest.fn(async () => config.ready ?? true),
    getAddresses: jest.fn(async (start: number, end: number) =>
      accounts.slice(start, end),
    ),
    getMaxAccountLimit: jest.fn(async () => config.maxAccountLimit),
    setAccountToUnlock: jest.fn(),
    forgetDevice: jest.fn(),
    readKeyring: jest.fn(async () => undefined),
    submitCryptoHDKey: jest.fn(() => {
      keyring.getWalletId.mockReturnValue(keyring.__syncWalletId);
    }),
    submitCryptoAccount: jest.fn(() => {
      keyring.getWalletId.mockReturnValue(keyring.__syncWalletId);
    }),
    exportCurrentSignRequestIdIfExist: jest.fn(async () => keyring.__requestId),
    submitSignature: jest.fn(),
    getAccountInfo: jest.fn(async (address: string) => ({
      address,
      keyringId: keyring.getWalletId(),
    })),
    getInteraction: jest.fn(() => interaction),
    interaction,
  };

  return keyring;
}

/**
 * Loads `core/apis/keystone.ts` with mocked service APIs and an empty module
 * registry, so the module-level pairing maps start clean.
 *
 * @param options - Existing keyrings that should look registered.
 * @param options.serviceKeyrings - Keyrings returned by the service snapshots.
 * @returns The API module plus mocks and the keyrings created by pairing.
 */
function loadKeystoneModule({ serviceKeyrings = [] as any[] } = {}) {
  jest.resetModules();

  const constructed: any[] = [];
  let pendingCounter = 0;

  const mocks = {
    addKeyring: jest.fn(async (keyring: any) => {
      serviceKeyrings.push(keyring);
    }),
    addNewAccount: jest.fn(async () => [{ address: '0ximported' }]),
    removeAccount: jest.fn(async () => undefined),
    getKeyringForAccount: jest.fn(),
    persistKeyringsForKeyring: jest.fn(async () => true),
    initCurrentAccount: jest.fn(async () => undefined),
    emit: jest.fn(),
  };

  const KeystoneKeyringMock = jest.fn().mockImplementation(() => {
    const keyring = createFakeKeyring();
    constructed.push(keyring);
    return keyring;
  });

  jest.doMock(
    '@rabby-wallet/eth-keyring-keystone/dist/KeystoneKeyring',
    () => ({
      __esModule: true,
      default: KeystoneKeyringMock,
      AcquireMemeStoreData: 'AcquireMemeStoreData',
      MemStoreDataReady: 'MemStoreDataReady',
    }),
  );
  jest.doMock('@rabby-wallet/keyring-utils', () => ({
    KEYRING_TYPE: { KeystoneKeyring: 'QR Hardware Wallet Device' },
    KEYRING_CLASS: {
      HARDWARE: { KEYSTONE: 'QR Hardware Wallet Device' },
    },
  }));
  jest.doMock('nanoid', () => ({
    nanoid: () => `pending-${++pendingCounter}`,
  }));
  jest.doMock('@/core/serviceApi/keyring', () => ({
    ensureKeyringRuntimeReadyForApi: jest.fn(async () => undefined),
    getKeyringInstancesSnapshot: () => serviceKeyrings,
    getKeyringsByTypeSnapshot: () => serviceKeyrings,
    keyringServiceApi: {
      addKeyring: mocks.addKeyring,
      addNewAccount: mocks.addNewAccount,
      removeAccount: mocks.removeAccount,
      getKeyringForAccount: mocks.getKeyringForAccount,
      persistKeyringsForKeyring: mocks.persistKeyringsForKeyring,
    },
  }));
  jest.doMock('@/core/serviceApi/preference', () => ({
    preferenceServiceApi: {
      initCurrentAccount: mocks.initCurrentAccount,
    },
  }));
  jest.doMock('@/utils/events', () => ({
    eventBus: { emit: mocks.emit },
    EVENTS: {
      QRHARDWARE: { ACQUIRE_MEMSTORE_SUCCEED: 'ACQUIRE_MEMSTORE_SUCCEED' },
    },
  }));

  const api = require('./keystone');

  return { api, serviceKeyrings, constructed, mocks, KeystoneKeyringMock };
}

/**
 * Asserts that a promise rejects, without using the disallowed `.rejects`
 * matchers.
 *
 * @param promise - Promise that should reject.
 * @param pattern - Expected message pattern.
 * @returns The captured error.
 */
async function expectRejects(promise: Promise<unknown>, pattern: RegExp) {
  let error: Error | undefined;
  try {
    await promise;
  } catch (err) {
    error = err as Error;
  }
  expect(error?.message).toMatch(pattern);
  return error;
}

describe('apiKeystone multi-wallet', () => {
  it('pairs a wallet without persisting it until the first import', async () => {
    const { api, serviceKeyrings, constructed, mocks } = loadKeystoneModule();
    const walletId = "aabbccdd:hd:m/44'/60'/0'";

    const { pendingId } = await api.beginPairing();
    constructed[0].__syncWalletId = walletId;

    const result = await api.submitQRHardwareSync(
      'crypto-hdkey',
      'cbor',
      pendingId,
    );

    expect(result).toStrictEqual({ walletId, isExisting: false });
    expect(serviceKeyrings).toStrictEqual([]);
    expect(constructed[0].submitCryptoHDKey).toHaveBeenCalledWith('cbor');

    const wallets = await api.getWallets();
    expect(wallets).toHaveLength(1);
    expect(wallets[0].walletId).toBe(walletId);

    const address = await api.importAddress(0, walletId);

    expect(address).toBe('0ximported');
    expect(mocks.addKeyring).toHaveBeenCalledWith(constructed[0]);
    expect(constructed[0].setAccountToUnlock).toHaveBeenCalledWith(0);
    expect(mocks.initCurrentAccount).toHaveBeenCalledTimes(1);
  });

  it('detects an already paired wallet instead of duplicating it', async () => {
    const existing = createFakeKeyring({ walletId: 'aabbccdd:hd:m' });
    const { api, constructed, mocks } = loadKeystoneModule({
      serviceKeyrings: [existing],
    });

    const { pendingId } = await api.beginPairing();
    constructed[0].__syncWalletId = 'aabbccdd:hd:m';

    const result = await api.submitQRHardwareSync(
      'crypto-hdkey',
      'cbor',
      pendingId,
    );

    expect(result).toStrictEqual({
      walletId: 'aabbccdd:hd:m',
      isExisting: true,
    });
    expect(constructed[0].forgetDevice).toHaveBeenCalled();
    expect(mocks.addKeyring).not.toHaveBeenCalled();
  });

  it('fails fast without a walletId when several wallets exist', async () => {
    const walletA = createFakeKeyring({ walletId: 'aaaa:hd:m' });
    const walletB = createFakeKeyring({ walletId: 'bbbb:hd:m' });
    const { api } = loadKeystoneModule({
      serviceKeyrings: [walletA, walletB],
    });

    await expectRejects(api.getAddresses(0, 1), /walletId is required/u);

    const addresses = await api.getAddresses(0, 1, 'bbbb:hd:m');
    expect(addresses).toStrictEqual([]);
    expect(walletB.getAddresses).toHaveBeenCalledWith(0, 1);
    expect(walletA.getAddresses).not.toHaveBeenCalled();
  });

  it('reads account info from the keyring that owns the address', async () => {
    const walletA = createFakeKeyring({
      walletId: 'aaaa:hd:m',
      accounts: [{ address: '0xaaa', index: 1 }],
    });
    const walletB = createFakeKeyring({
      walletId: 'bbbb:hd:m',
      accounts: [{ address: '0xbbb', index: 1 }],
    });
    const { api, mocks } = loadKeystoneModule({
      serviceKeyrings: [walletA, walletB],
    });
    mocks.getKeyringForAccount.mockResolvedValue(walletB);

    const info = await api.getAccountInfoByAddress('0xbbb');

    expect(mocks.getKeyringForAccount).toHaveBeenCalledWith(
      '0xbbb',
      'QR Hardware Wallet Device',
    );
    expect(info).toStrictEqual({ address: '0xbbb', keyringId: 'bbbb:hd:m' });
  });

  it('falls back to in-memory wallets when the address is not registered yet', async () => {
    const { api, constructed, mocks } = loadKeystoneModule();
    const walletId = 'cccc:hd:m';

    const { pendingId } = await api.beginPairing();
    constructed[0].__syncWalletId = walletId;
    await api.submitQRHardwareSync('crypto-hdkey', 'cbor', pendingId);

    constructed[0].getAccounts.mockResolvedValue(['0xccc']);
    mocks.getKeyringForAccount.mockRejectedValue(new Error('not found'));

    const info = await api.getAccountInfoByAddress('0xCCC');

    expect(info).toStrictEqual({ address: '0xCCC', keyringId: walletId });
  });

  it('routes signing requests to the wallet that owns them', async () => {
    const walletA = createFakeKeyring({
      walletId: 'aaaa:hd:m',
      requestId: 'request-a',
    });
    const walletB = createFakeKeyring({ walletId: 'bbbb:hd:m' });
    const { api } = loadKeystoneModule({
      serviceKeyrings: [walletA, walletB],
    });

    expect(await api.exportCurrentSignRequestIdIfExist()).toBe('request-a');

    await api.submitQRHardwareSignature('request-a', 'signature');

    expect(walletA.submitSignature).toHaveBeenCalledWith(
      'request-a',
      'signature',
    );
    expect(walletB.submitSignature).not.toHaveBeenCalled();

    await expectRejects(
      api.submitQRHardwareSignature('unknown', 'signature'),
      /No Keystone wallet is waiting/u,
    );
  });

  it('polls every wallet for memstore data', async () => {
    const walletA = createFakeKeyring({ walletId: 'aaaa:hd:m' });
    const walletB = createFakeKeyring({ walletId: 'bbbb:hd:m' });
    const { api } = loadKeystoneModule({
      serviceKeyrings: [walletA, walletB],
    });

    await api.acquireKeystoneMemStoreData();
    await api.acquireKeystoneMemStoreData();

    // one push forwarder per wallet interaction, even across repeated calls
    expect(walletA.interaction.on).toHaveBeenCalledTimes(1);
    expect(walletB.interaction.on).toHaveBeenCalledTimes(1);
    expect(walletA.interaction.on).toHaveBeenCalledWith(
      'MemStoreDataReady',
      expect.any(Function),
    );
    expect(walletA.interaction.emit).toHaveBeenCalledWith(
      'AcquireMemeStoreData',
    );
    expect(walletB.interaction.emit).toHaveBeenCalledWith(
      'AcquireMemeStoreData',
    );
  });

  it('removes only the requested wallet accounts', async () => {
    const walletA = createFakeKeyring({
      walletId: 'aaaa:hd:m',
      accounts: [{ address: '0xaaa', index: 1 }],
    });
    const walletB = createFakeKeyring({
      walletId: 'bbbb:hd:m',
      accounts: [{ address: '0xbbb', index: 1 }],
    });
    const { api, mocks } = loadKeystoneModule({
      serviceKeyrings: [walletA, walletB],
    });

    await api.removeAddressAndForgetDevice('bbbb:hd:m');

    expect(mocks.removeAccount).toHaveBeenCalledTimes(1);
    expect(mocks.removeAccount).toHaveBeenCalledWith(
      '0xbbb',
      'QR Hardware Wallet Device',
      undefined,
      true,
    );
    expect(walletB.forgetDevice).toHaveBeenCalled();
    expect(walletA.forgetDevice).not.toHaveBeenCalled();
  });

  it('reports readiness per wallet or for any wallet', async () => {
    const walletA = createFakeKeyring({
      walletId: 'aaaa:hd:m',
      ready: true,
    });
    const walletB = createFakeKeyring({
      walletId: 'bbbb:hd:m',
      ready: false,
    });
    const { api } = loadKeystoneModule({
      serviceKeyrings: [walletA, walletB],
    });

    expect(await api.isReady()).toBe(true);
    expect(await api.isReady('bbbb:hd:m')).toBe(false);
    expect(await api.isReady('aaaa:hd:m')).toBe(true);
  });

  it('renames and persists a registered wallet', async () => {
    const wallet = createFakeKeyring({ walletId: 'aaaa:hd:m' });
    const { api, mocks } = loadKeystoneModule({
      serviceKeyrings: [wallet],
    });

    await api.renameWallet('aaaa:hd:m', '  Treasury  ');

    expect(wallet.setWalletAlias).toHaveBeenCalledWith('  Treasury  ');
    expect(mocks.persistKeyringsForKeyring).toHaveBeenCalledWith(wallet);
  });

  it('cancels a pending pairing without persisting it', async () => {
    const { api, constructed, mocks } = loadKeystoneModule();

    const { pendingId } = await api.beginPairing();
    await api.cancelPairing(pendingId);

    expect(constructed[0].forgetDevice).toHaveBeenCalled();
    expect(mocks.addKeyring).not.toHaveBeenCalled();
    await expectRejects(
      api.submitQRHardwareSync('crypto-hdkey', 'cbor', pendingId),
      /pairing session not found/u,
    );
  });
});
