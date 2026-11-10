import { KEYRING_TYPE } from '@rabby-wallet/keyring-utils';
import * as sinon from 'sinon';

import { KeyringService } from './keyringService';
import mockEncryptor from '../test/mock-encryptor';

const password = 'password123';

describe('KeyringService setup', () => {
  let keyringService: KeyringService;

  beforeAll(() => {
    keyringService = new KeyringService({ encryptor: mockEncryptor as any });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('boot', () => {
    it('should load store', async () => {
      keyringService.loadStore({});
      expect(keyringService.store).toBeDefined();
    });

    it('should booted', async () => {
      keyringService.boot('password');
      expect(keyringService.store.getState().booted).toBeUndefined();
    });
  });

  describe('setLocked', () => {
    it('setLocked correctly sets lock state', async () => {
      await keyringService.setLocked();
      await expect(keyringService.persistAllKeyrings()).rejects.toThrow(
        'KeyringService - password is not a string',
      );
      expect(keyringService.memStore.getState().isUnlocked).toBe(false);
      expect(keyringService.keyrings).toHaveLength(0);
    });

    it('emits "lock" event', async () => {
      const spy = sinon.spy();
      keyringService.on('lock', spy);
      await keyringService.setLocked();
      expect(spy.calledOnce).toBe(true);
    });
  });
});

describe('keyringService', () => {
  let keyringService: KeyringService;

  beforeEach(async () => {
    keyringService = new KeyringService({ encryptor: mockEncryptor as any });
    keyringService.loadStore({});
    await keyringService.boot(password);
    await keyringService.clearKeyrings();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('submitPassword', () => {
    it('emits "unlock" event', async () => {
      await keyringService.setLocked();
      const spy = sinon.spy();
      keyringService.on('unlock', spy);

      await keyringService.submitPassword(password);
      expect(spy.calledOnce).toBe(true);
    });

    it('resets the submitting guard when password verification fails', async () => {
      await keyringService.setLocked();
      sinon
        .stub(keyringService, 'verifyPassword')
        .rejects(new Error('bad password'));

      await expect(
        keyringService.submitPassword('wrong-password'),
      ).rejects.toThrow('bad password');
      expect((keyringService as any)._isSubmittingPassword).toBe(false);

      sinon.restore();
      await keyringService.submitPassword(password);
      expect(keyringService.memStore.getState().isUnlocked).toBe(true);
    });

    it('skips pre-verification for trusted passwords when a vault exists', async () => {
      await keyringService.setLocked();
      keyringService.store.updateState({ vault: 'encrypted-vault' });

      const verifySpy = sinon.spy(keyringService, 'verifyPassword');
      const unlockStub = sinon
        .stub(keyringService, 'unlockKeyrings')
        .resolves([]);

      await keyringService.submitPassword(password, { trustedPassword: true });

      expect(verifySpy.called).toBe(false);
      expect(unlockStub.calledOnce).toBe(true);
      expect(unlockStub.firstCall.args[0]).toBe(password);
      expect(keyringService.memStore.getState().isUnlocked).toBe(true);
    });

    it('rejects trusted passwords when vault decryption fails', async () => {
      await keyringService.setLocked();
      keyringService.store.updateState({ vault: 'encrypted-vault' });

      const verifySpy = sinon.spy(keyringService, 'verifyPassword');
      sinon
        .stub(keyringService, 'unlockKeyrings')
        .rejects(new Error('bad vault'));

      await expect(
        keyringService.submitPassword(password, { trustedPassword: true }),
      ).rejects.toThrow('bad vault');

      expect(verifySpy.called).toBe(false);
      expect(keyringService.memStore.getState().isUnlocked).toBe(false);
      expect((keyringService as any)._isSubmittingPassword).toBe(false);
    });
  });

  describe('startDeferredKeyringRuntimeRestore', () => {
    it('does not let late restore completions mutate runtime keyrings after a failure', async () => {
      let releaseSlowRestore!: () => void;

      class SlowKeyring {
        static type = 'SlowKeyring';
        type = 'SlowKeyring';

        async deserialize() {
          await new Promise<void>(resolve => {
            releaseSlowRestore = resolve;
          });
        }

        async getAccounts() {
          return ['0xslow'];
        }
      }

      class FailingKeyring {
        static type = 'FailingKeyring';
        type = 'FailingKeyring';

        async deserialize() {
          throw new Error('restore failed');
        }

        async getAccounts() {
          return [];
        }
      }

      keyringService = new KeyringService({
        encryptor: mockEncryptor as any,
        keyringClasses: [SlowKeyring, FailingKeyring] as any,
      });
      keyringService.loadStore({
        hasEncryptedKeyringData: true,
      });
      await keyringService.boot(password);

      const previousKeyring = {
        type: 'PreviousKeyring',
      } as any;
      keyringService.keyrings = [previousKeyring];
      keyringService.memStore.updateState({
        keyringRuntimeReady: false,
      });
      (keyringService as any).pendingKeyringRuntimeRestore = {
        keyringsToRestore: [
          { type: 'SlowKeyring', data: {} },
          { type: 'FailingKeyring', data: {} },
        ],
        unencryptedKeyringData: [],
        hasUnencryptedKeyringData: false,
        scheduledAt: Date.now(),
      };

      await expect(
        keyringService.startDeferredKeyringRuntimeRestore('test'),
      ).rejects.toThrow('restore failed');
      expect(keyringService.keyrings).toEqual([previousKeyring]);

      releaseSlowRestore();
      await Promise.resolve();
      await Promise.resolve();

      expect(keyringService.keyrings).toEqual([previousKeyring]);
    });
  });
});

describe('multi-wallet keyring ids', () => {
  function createFakeKeyring(walletId: string, addresses: string[]) {
    return {
      type: KEYRING_TYPE.KeystoneKeyring,
      getWalletId: () => walletId,
      getAccountsWithBrand: async () =>
        addresses.map(address => ({ address, brandName: 'Keystone' })),
      getAccounts: async () => addresses,
    } as any;
  }

  it('tags displayed groups and accounts with the wallet id', async () => {
    const service = new KeyringService({ encryptor: mockEncryptor as any });
    service.loadStore({});
    service.keyrings = [
      createFakeKeyring('wallet-a', [
        '0x0000000000000000000000000000000000000001',
      ]),
      createFakeKeyring('wallet-b', [
        '0x0000000000000000000000000000000000000002',
      ]),
    ];
    service.memStore.updateState({ keyringRuntimeReady: true });

    const groups = await service.getAllTypedVisibleAccounts();
    expect(groups.map(group => group.keyringId)).toEqual([
      'wallet-a',
      'wallet-b',
    ]);

    const accounts = await service.getAllVisibleAccountsArray();
    expect(accounts.map(account => account.keyringId)).toEqual([
      'wallet-a',
      'wallet-b',
    ]);
  });

  it('keeps the wallet id in the public account snapshot', async () => {
    const service = new KeyringService({ encryptor: mockEncryptor as any });
    service.loadStore({});
    service.store.updateState({
      publicAccountSnapshot: {
        version: 4,
        updatedAt: Date.now(),
        accounts: [
          {
            address: '0x0000000000000000000000000000000000000001',
            type: KEYRING_TYPE.KeystoneKeyring,
            brandName: 'Keystone',
            keyringId: 'wallet-a',
          },
        ],
      },
    });
    service.memStore.updateState({ keyringRuntimeReady: false });

    const accounts = await service.getAllVisibleAccountsArray();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].keyringId).toBe('wallet-a');
    expect(service.getPublicAccountSnapshotAccounts()[0].keyringId).toBe(
      'wallet-a',
    );
  });
});
