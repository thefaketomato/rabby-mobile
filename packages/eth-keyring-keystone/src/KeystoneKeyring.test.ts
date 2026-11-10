import { Common } from '@ethereumjs/common';
import {
  FeeMarketEIP1559Transaction,
  LegacyTransaction,
} from '@ethereumjs/tx';
import {
  CryptoHDKey,
  CryptoKeypath,
  DataType,
  EthSignRequest,
  PathComponent,
} from '@keystonehq/bc-ur-registry-eth';
import { toChecksumAddress } from 'ethereumjs-util';
import HDKey from 'hdkey';
import { v4 as uuidv4 } from 'uuid';

import KeystoneKeyring, {
  AcquireMemeStoreData,
  HDPathType,
  MemStoreDataReady,
} from './KeystoneKeyring';

const makeRequest = (requestId: string) => ({
  requestId,
  payload: { type: 'eth-sign-request', cbor: 'a1' },
});

describe('KeystoneKeyring MemStoreDataReady', () => {
  const keyring = new KeystoneKeyring();
  const interaction = keyring.getInteraction();
  const memStore = keyring.getMemStore();
  const onReady = jest.fn();

  beforeAll(() => {
    interaction.on(MemStoreDataReady, onReady);
  });

  beforeEach(() => {
    onReady.mockClear();
    keyring.resetStore();
  });

  it('pushes a request created after the page pulled, once', () => {
    interaction.emit(AcquireMemeStoreData);
    expect(onReady).not.toHaveBeenCalled();

    const request = makeRequest('req-1');
    memStore.updateState({ sign: { request } });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenLastCalledWith(request);

    // unrelated state updates do not push again
    memStore.updateState({ sync: { reading: true } });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('answers a pull when the request already exists', () => {
    const request = makeRequest('req-2');
    memStore.updateState({ sign: { request } });
    onReady.mockClear();

    interaction.emit(AcquireMemeStoreData);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenLastCalledWith(request);
  });

  it('pushes the next request again, even with a reused id after reset', () => {
    memStore.updateState({ sign: { request: makeRequest('req-3') } });
    memStore.updateState({ sign: { request: makeRequest('req-4') } });
    expect(onReady).toHaveBeenCalledTimes(2);

    keyring.resetStore();
    memStore.updateState({ sign: { request: makeRequest('req-4') } });
    expect(onReady).toHaveBeenCalledTimes(3);
  });
});

const SEED = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const MASTER = HDKey.fromMasterSeed(SEED);

type PathTuple = [index: number, hardened: boolean];

const DEFAULT_PATH: PathTuple[] = [
  [44, true],
  [60, true],
  [0, true],
];

/**
 * Builds a Keystone `crypto-hdkey` sync payload for a synthetic wallet.
 *
 * @param options - Wallet identity encoded into the payload.
 * @param options.fingerprint - Master fingerprint as a hex string.
 * @param options.name - Optional wallet name reported by the device.
 * @param options.path - Derivation path components.
 * @returns The crypto HD key to encode as a QR payload.
 */
function makeCryptoHDKey({
  fingerprint,
  name,
  path = DEFAULT_PATH,
}: {
  fingerprint: string;
  name?: string;
  path?: PathTuple[];
}) {
  const node = MASTER.derive(
    `m/${path
      .map(([index, hardened]) => `${index}${hardened ? "'" : ''}`)
      .join('/')}`,
  );

  return new CryptoHDKey({
    isMaster: false,
    key: node.publicKey as Buffer,
    chainCode: node.chainCode as Buffer,
    origin: new CryptoKeypath(
      path.map(([index, hardened]) => new PathComponent({ index, hardened })),
      Buffer.from(fingerprint, 'hex'),
    ),
    name,
  });
}

/**
 * Pairs a keyring with a synthetic `crypto-hdkey` payload.
 *
 * @param keyring - Keyring instance to pair.
 * @param options - Wallet identity for the payload.
 * @param options.fingerprint - Master fingerprint as a hex string.
 * @param options.name - Optional wallet name reported by the device.
 * @param options.path - Derivation path components.
 * @returns The same keyring, after sync.
 */
async function pairWallet(
  keyring: KeystoneKeyring,
  options: { fingerprint: string; name?: string; path?: PathTuple[] },
) {
  const reading = keyring.readKeyring();
  keyring.submitCryptoHDKey(makeCryptoHDKey(options).toCBOR().toString('hex'));
  await reading;
  return keyring;
}

describe('KeystoneKeyring multi-wallet support', () => {
  it('keeps two keyring instances fully isolated', async () => {
    const walletA = await pairWallet(new KeystoneKeyring(), {
      fingerprint: 'aabbccdd',
      name: 'Keystone A',
    });
    const walletB = await pairWallet(new KeystoneKeyring(), {
      fingerprint: '11223344',
      name: 'Keystone B',
    });

    expect(walletA).not.toBe(walletB);
    expect(walletA.getInteraction()).not.toBe(walletB.getInteraction());

    expect(walletA.getWalletId()).toBe("aabbccdd:hd:m/44'/60'/0'");
    expect(walletB.getWalletId()).toBe("11223344:hd:m/44'/60'/0'");
    expect(walletA.getDeviceFingerprint()).toBe('aabbccdd');
    expect(walletB.getDeviceFingerprint()).toBe('11223344');
    expect(walletA.getWalletName()).toBe('Keystone A');
    expect(walletB.getWalletName()).toBe('Keystone B');

    expect(await walletA.getAccounts()).toStrictEqual([]);
    expect(await walletB.getAccounts()).toStrictEqual([]);
  });

  it('routes sync payloads to the pending wallet only', async () => {
    const walletA = new KeystoneKeyring();
    const walletB = new KeystoneKeyring();

    const readingA = walletA.readKeyring();
    const readingB = walletB.readKeyring();

    walletA.submitCryptoHDKey(
      makeCryptoHDKey({ fingerprint: 'aabbccdd', name: 'A' })
        .toCBOR()
        .toString('hex'),
    );
    await readingA;

    expect(walletA.getDeviceFingerprint()).toBe('aabbccdd');
    expect(walletB.getDeviceFingerprint()).toBe('');

    walletB.submitCryptoHDKey(
      makeCryptoHDKey({ fingerprint: '11223344', name: 'B' })
        .toCBOR()
        .toString('hex'),
    );
    await readingB;

    expect(walletB.getDeviceFingerprint()).toBe('11223344');
    expect(walletA.getDeviceFingerprint()).toBe('aabbccdd');
  });

  it('scopes pending sign requests to the wallet that created them', async () => {
    const walletA = await pairWallet(new KeystoneKeyring(), {
      fingerprint: 'aabbccdd',
    });
    const walletB = await pairWallet(new KeystoneKeyring(), {
      fingerprint: '11223344',
    });

    const requestId = uuidv4();
    const signRequest = EthSignRequest.constructETHRequest(
      Buffer.from('00', 'hex'),
      DataType.personalMessage,
      "m/44'/60'/0'/0/0",
      'aabbccdd',
      requestId,
    );

    const pending = walletA.getInteraction().requestSignature(signRequest);
    expect(await walletA.exportCurrentSignRequestIdIfExist()).toBe(requestId);
    expect(await walletB.exportCurrentSignRequestIdIfExist()).toBeNull();

    walletA.cancelSignRequest();
    let error: Error | undefined;
    try {
      await pending;
    } catch (err) {
      error = err as Error;
    }
    expect(error?.message).toMatch(/canceled/u);
    expect(await walletA.exportCurrentSignRequestIdIfExist()).toBeNull();
  });

  it('round-trips wallet metadata through serialize/deserialize', async () => {
    const wallet = await pairWallet(new KeystoneKeyring(), {
      fingerprint: 'aabbccdd',
      name: 'Keystone A',
    });
    await wallet.getAddresses(0, 1);
    await wallet.addAccounts(1);
    wallet.setWalletAlias('  Treasury  ');

    const serialized = await wallet.serialize();
    const restored = new KeystoneKeyring();
    restored.deserialize(serialized);

    expect(restored.getWalletAlias()).toBe('Treasury');
    expect(restored.getWalletName()).toBe('Treasury');
    expect(restored.getWalletId()).toBe(wallet.getWalletId());
    expect(restored.getDeviceFingerprint()).toBe('aabbccdd');
    expect(await restored.getAccounts()).toStrictEqual(
      await wallet.getAccounts(),
    );
  });

  it('survives an empty restore payload from onCreateKeyring', async () => {
    const keyring = new KeystoneKeyring({} as any);

    expect(keyring.getWalletId()).toBe('');
    expect(keyring.getWalletName()).toBe('Keystone');
    expect(await keyring.isReady()).toBe(false);
  });

  it('derives a BIP44 hd path type and returns wallet info per account', async () => {
    const wallet = await pairWallet(new KeystoneKeyring(), {
      fingerprint: 'aabbccdd',
      name: 'Keystone A',
    });
    await wallet.getAddresses(0, 1);
    await wallet.addAccounts(1);

    const [address] = await wallet.getAccounts();
    const info = await wallet.getAccountInfo(address);

    expect(info).toMatchObject({
      address,
      index: 1,
      balance: null,
      hdPathType: HDPathType.BIP44,
      walletId: wallet.getWalletId(),
      walletName: 'Keystone A',
      deviceFingerprint: 'aabbccdd',
    });
  });

  it('uses the brand name when the device reports no name', async () => {
    const wallet = await pairWallet(new KeystoneKeyring(), {
      fingerprint: 'aabbccdd',
    });

    expect(wallet.getWalletName()).toBe('Keystone');

    wallet.setWalletAlias('  Savings  ');
    expect(wallet.getWalletName()).toBe('Savings');
    expect(wallet.getWalletAlias()).toBe('Savings');

    wallet.setWalletAlias(undefined);
    expect(wallet.getWalletName()).toBe('Keystone');
  });

  it('uses the derivation path in the wallet id', async () => {
    const standard = await pairWallet(new KeystoneKeyring(), {
      fingerprint: 'aabbccdd',
    });
    const legacy = await pairWallet(new KeystoneKeyring(), {
      fingerprint: 'aabbccdd',
      path: [
        [44, true],
        [60, true],
        [0, true],
        [0, false],
      ],
    });

    expect(standard.getWalletId()).not.toBe(legacy.getWalletId());
    expect(standard.getWalletId()).toBe("aabbccdd:hd:m/44'/60'/0'");
    expect(legacy.getWalletId()).toBe("aabbccdd:hd:m/44'/60'/0'/0");
  });

  it('handles pubkey-mode wallets', async () => {
    const source = await pairWallet(new KeystoneKeyring(), {
      fingerprint: 'aabbccdd',
    });
    const addressA = toChecksumAddress(
      '0x0000000000000000000000000000000000000001',
    );
    const addressB = toChecksumAddress(
      '0x0000000000000000000000000000000000000002',
    );

    const pubkeyWallet = new KeystoneKeyring();
    pubkeyWallet.deserialize({
      ...(await source.serialize()),
      keyringMode: 'pubkey',
      keyringAccount: 'account.ledger_live',
      initialized: true,
      xpub: '',
      paths: {
        [addressA]: "M/44'/60'/0'/0/0",
        [addressB]: "M/44'/60'/0'/0/1",
      },
    } as any);

    expect(pubkeyWallet.getWalletId()).toBe(
      'aabbccdd:pubkey:account.ledger_live',
    );
    expect(pubkeyWallet.getWalletMode()).toBe('pubkey');
    expect(await pubkeyWallet.getMaxAccountLimit()).toBe(2);
    expect(await pubkeyWallet.getAddresses(0, 5)).toStrictEqual([
      { address: addressA, balance: null, index: 1 },
      { address: addressB, balance: null, index: 2 },
    ]);
  });

  it('tracks account brands and removes them with the account', async () => {
    const wallet = await pairWallet(new KeystoneKeyring(), {
      fingerprint: 'aabbccdd',
    });
    await wallet.addAccounts(1);

    const [address] = await wallet.getAccounts();
    expect(await wallet.getAccountsWithBrand()).toStrictEqual([
      { address, brandName: 'Keystone' },
    ]);

    expect(await wallet.checkAllowImport('Keystone')).toStrictEqual({
      brand: 'Keystone',
      allowed: true,
    });
    expect(await wallet.checkAllowImport('Trezor')).toStrictEqual({
      brand: 'Keystone',
      allowed: false,
    });

    wallet.removeAccount(address);
    expect(await wallet.getAccounts()).toStrictEqual([]);
  });

  it('allows import when the wallet has no accounts', async () => {
    const wallet = new KeystoneKeyring();

    expect(await wallet.checkAllowImport('Keystone')).toStrictEqual({
      allowed: true,
    });
  });

  it('forgets the device and all Rabby metadata', async () => {
    const wallet = await pairWallet(new KeystoneKeyring(), {
      fingerprint: 'aabbccdd',
      name: 'Keystone A',
    });
    await wallet.addAccounts(1);
    wallet.setWalletAlias('Treasury');

    wallet.forgetDevice();

    expect(wallet.getWalletId()).toBe('');
    expect(wallet.getDeviceFingerprint()).toBe('');
    expect(wallet.getWalletAlias()).toBe('');
    expect(wallet.getWalletName()).toBe('Keystone');
    expect(await wallet.getAccounts()).toStrictEqual([]);
    expect(await wallet.isReady()).toBe(false);
    expect(await wallet.getCurrentBrand()).toBe('Keystone');
  });
});


describe('KeystoneKeyring account indexes', () => {
  it('keeps a valid index when an account is added before loading a page', async () => {
    const wallet = await pairWallet(new KeystoneKeyring(), {
      fingerprint: 'aabbccdd',
    });

    await wallet.addAccounts(1);
    const [address] = await wallet.getAccounts();

    expect(await wallet.getCurrentAccounts()).toStrictEqual([
      { address, index: 1 },
    ]);
    expect((await wallet.getAccountInfo(address)).index).toBe(1);
  });

  it('assigns sequential indexes to sequentially added accounts', async () => {
    const wallet = await pairWallet(new KeystoneKeyring(), {
      fingerprint: 'aabbccdd',
    });

    wallet.setAccountToUnlock(0);
    await wallet.addAccounts(1);
    wallet.setAccountToUnlock(1);
    await wallet.addAccounts(1);

    const accounts = await wallet.getCurrentAccounts();
    expect(accounts.map(account => account.index)).toStrictEqual([1, 2]);
  });

  it('falls back to account order when a legacy keyring has no indexes', async () => {
    const wallet = await pairWallet(new KeystoneKeyring(), {
      fingerprint: 'aabbccdd',
    });
    await wallet.addAccounts(1);

    const data = await wallet.serialize();
    const restored = new KeystoneKeyring();
    restored.deserialize({ ...data, indexes: {} });

    const accounts = await restored.getCurrentAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].index).toBe(1);
  });
});

describe('KeystoneKeyring signTransaction', () => {
  const signature = {
    r: Buffer.alloc(32, 1),
    s: Buffer.alloc(32, 2),
    v: Buffer.from([0x1b]),
  };

  const expectedR = BigInt(`0x${signature.r.toString('hex')}`);
  const expectedS = BigInt(`0x${signature.s.toString('hex')}`);

  async function createSigningWallet() {
    const wallet = await pairWallet(new KeystoneKeyring(), {
      fingerprint: 'aabbccdd',
    });
    await wallet.getAddresses(0, 1);
    await wallet.addAccounts(1);
    const [address] = await wallet.getAccounts();
    return { wallet, address };
  }

  it('builds the Keystone request and returns a signed legacy tx', async () => {
    const { wallet, address } = await createSigningWallet();
    const common = new Common({ chain: 1 });
    const tx = LegacyTransaction.fromTxData(
      {
        nonce: BigInt(1),
        gasPrice: BigInt(1),
        gasLimit: BigInt(21000),
        to: '0x0000000000000000000000000000000000000001',
        value: BigInt(1),
      },
      { common },
    );
    const requestSignature = jest
      .spyOn(wallet as any, 'requestSignature')
      .mockResolvedValue(signature);

    const signed = await wallet.signTransaction(address, tx);

    expect(requestSignature).toHaveBeenCalledTimes(1);
    const [, signRequest] = requestSignature.mock.calls[0] as [
      string,
      EthSignRequest,
    ];
    expect(signRequest.getDataType()).toBe(DataType.transaction);
    expect(signRequest.getDerivationPath()).toBe("44'/60'/0'/0/0");
    expect(signRequest.getSourceFingerprint().toString('hex')).toBe(
      'aabbccdd',
    );
    expect(
      signRequest.getSignRequestAddress()?.toString('hex').toLowerCase(),
    ).toBe(address.slice(2).toLowerCase());
    expect(Number(signRequest.getChainId())).toBe(1);

    expect((signed as any).type).toBe(0);
    expect((signed as any).r).toBe(expectedR);
    expect((signed as any).s).toBe(expectedS);
    expect((signed as any).v).toBe(BigInt(27));

    requestSignature.mockRestore();
  });

  it('builds the Keystone request and returns a signed EIP-1559 tx', async () => {
    const { wallet, address } = await createSigningWallet();
    const common = new Common({ chain: 1 });
    const tx = FeeMarketEIP1559Transaction.fromTxData(
      {
        nonce: BigInt(1),
        maxFeePerGas: BigInt(1),
        maxPriorityFeePerGas: BigInt(1),
        gasLimit: BigInt(21000),
        to: '0x0000000000000000000000000000000000000001',
        value: BigInt(1),
      },
      { common },
    );
    const requestSignature = jest
      .spyOn(wallet as any, 'requestSignature')
      .mockResolvedValue({
        ...signature,
        v: Buffer.from([0x01]),
      });

    const signed = await wallet.signTransaction(address, tx);

    expect(requestSignature).toHaveBeenCalledTimes(1);
    const [, signRequest] = requestSignature.mock.calls[0] as [
      string,
      EthSignRequest,
    ];
    expect(signRequest.getDataType()).toBe(DataType.typedTransaction);
    expect(signRequest.getDerivationPath()).toBe("44'/60'/0'/0/0");
    expect(signRequest.getSourceFingerprint().toString('hex')).toBe(
      'aabbccdd',
    );
    expect(
      signRequest.getSignRequestAddress()?.toString('hex').toLowerCase(),
    ).toBe(address.slice(2).toLowerCase());
    expect(Number(signRequest.getChainId())).toBe(1);

    expect((signed as any).type).toBe(2);
    expect((signed as any).r).toBe(expectedR);
    expect((signed as any).s).toBe(expectedS);
    expect((signed as any).v).toBe(BigInt(1));

    requestSignature.mockRestore();
  });
});
