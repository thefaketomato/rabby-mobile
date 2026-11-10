import { RLP } from '@ethereumjs/rlp';
import { TransactionFactory } from '@ethereumjs/tx';
import type { StoredKeyring } from '@keystonehq/base-eth-keyring';
import { BaseKeyring } from '@keystonehq/base-eth-keyring';
import { DataType, EthSignRequest } from '@keystonehq/bc-ur-registry-eth';
import Eth, { HDPathType as KeystoneHDPathType } from '@keystonehq/hw-app-eth';
import { toChecksumAddress } from 'ethereumjs-util';
import { v4 as uuidv4 } from 'uuid';

import {
  KeystoneInteractionProvider,
  type RequestSignPayload,
} from './KeystoneInteractionProvider';

export type { RequestSignPayload } from './KeystoneInteractionProvider';

export enum HDPathType {
  LedgerLive = 'LedgerLive',
  Legacy = 'Legacy',
  BIP44 = 'BIP44',
}

const pathBase = 'm';

export const AcquireMemeStoreData = 'AcquireMemeStoreData';
export const MemStoreDataReady = 'MemStoreDataReady';
export const DEFAULT_BRAND = 'Keystone';
const DEFAULT_KEYRING_NAME = 'QR Hardware';

enum KEYRING_ACCOUNT {
  standard = 'account.standard',
  ledger_live = 'account.ledger_live',
  ledger_legacy = 'account.ledger_legacy',
}

const AccountTypeMap = {
  [KEYRING_ACCOUNT.standard]: HDPathType.BIP44,
  [KEYRING_ACCOUNT.ledger_live]: HDPathType.LedgerLive,
  [KEYRING_ACCOUNT.ledger_legacy]: HDPathType.Legacy,
};

type PagedAccount = { address: string; balance: any; index: number };

type IStoredKeyring = {
  brandsMap?: Record<string, string>;
  walletAlias?: string;
} & StoredKeyring;

/**
 * Keyring for an air-gapped Keystone wallet.
 *
 * A single instance represents exactly one Keystone wallet (one master
 * fingerprint + derivation). Multiple physical devices, or multiple
 * derivations of the same device, are supported by creating multiple
 * instances. `KeyringService` already persists and restores multiple keyrings
 * with the same `type`, and signing resolves the keyring by account address.
 *
 * Historically this class extended `@keystonehq/metamask-airgapped-keyring`'s
 * `MetaMaskKeyring`, which returns a process-wide singleton from its
 * constructor and therefore cannot represent more than one wallet. We extend
 * `BaseKeyring` directly and own a per-instance `KeystoneInteractionProvider`.
 */
export default class KeystoneKeyring extends BaseKeyring {
  perPage = 5;

  memStoreData: RequestSignPayload | undefined;

  brandsMap: Record<string, string> = {};

  currentBrand: string = DEFAULT_BRAND;

  walletAlias = '';

  private eth: Eth | null = null;

  private readonly interaction = new KeystoneInteractionProvider();

  getInteraction = (): KeystoneInteractionProvider => this.interaction;

  constructor(opts?: IStoredKeyring) {
    super();

    const memStore = this.getMemStore();

    // Pull: the sign page asks for the current request.
    this.interaction.on(AcquireMemeStoreData, () => {
      const request = memStore.getState().sign?.request;
      if (request) {
        this.interaction.emit(MemStoreDataReady, request);
      }
    });

    // Push: the request may be created after the page pulled
    // (e.g. slow pre-sign checks), so announce each new request once.
    // Each keyring owns its own provider/memStore, so this is per wallet.
    let pushedRequestId: string | undefined;
    memStore.subscribe(state => {
      const request = state.sign?.request;
      if (!request) {
        pushedRequestId = undefined;
        return;
      }
      if (request.requestId !== pushedRequestId) {
        pushedRequestId = request.requestId;
        this.interaction.emit(MemStoreDataReady, request);
      }
    });

    // `BaseKeyring`'s constructor calls `deserialize(undefined)`; restore data is
    // applied afterwards by `KeyringService._restoreKeyring`. Applying it here
    // too covers direct `new KeystoneKeyring(storedData)` callers.
    if (opts && Object.keys(opts).length > 0) {
      this.deserialize(opts);
    }
  }

  getMemStore = () => this.interaction.memStore;

  resetStore = () => this.interaction.reset();

  submitCryptoHDKey = (cbor: string) =>
    this.interaction.submitCryptoHDKey(cbor);

  submitCryptoAccount = (cbor: string) =>
    this.interaction.submitCryptoAccount(cbor);

  submitSignature = (requestId: string, cbor: string) =>
    this.interaction.submitSignature(requestId, cbor);

  cancelSync = () => this.interaction.cancelSync();

  cancelSignRequest = () => this.interaction.cancelRequestSignature();

  /**
   * Stable identifier for this wallet: fingerprint + derivation.
   *
   * - `xfp:hd:<hdPath>` for `crypto-hdkey` sync
   * - `xfp:pubkey:<keyringAccount>` for `crypto-account` sync
   *
   * Empty until the first successful sync. Two different wallets always differ;
   * re-scanning the same wallet yields the same id so callers can dedupe.
   *
   * @returns Stable wallet id, or an empty string before the first sync.
   */
  getWalletId(): string {
    if (!this.xfp) {
      return '';
    }

    if (this.getWalletMode() === 'pubkey') {
      return `${this.xfp}:pubkey:${this.keyringAccount}`;
    }

    return `${this.xfp}:hd:${this.hdPath}`;
  }

  getWalletMode(): 'hd' | 'pubkey' {
    return String(this.keyringMode) === 'pubkey' ? 'pubkey' : 'hd';
  }

  getDeviceFingerprint(): string {
    return this.xfp;
  }

  getWalletAlias(): string {
    return this.walletAlias;
  }

  setWalletAlias(alias?: string): void {
    this.walletAlias = (alias || '').trim();
  }

  /**
   * User-facing name: explicit alias, then the name reported by the device
   * during sync, then the brand name.
   *
   * @returns Wallet name suitable for display.
   */
  getWalletName(): string {
    if (this.walletAlias) {
      return this.walletAlias;
    }

    const name = (this.name || '').trim();
    if (!name || name === DEFAULT_KEYRING_NAME) {
      return DEFAULT_BRAND;
    }

    return name;
  }

  /**
   * Asynchronously gets the Keystone device.
   *
   * This function attempts to create an instance of `KeystoneEth` with the help of `TransportWebUSB`.
   * If the current environment does not support `WebUSB` or if it cannot find a Keystone device that supports USB signing,
   * an error is thrown.
   *
   * @async
   * @function getKeystoneDevice
   * @returns A promise that resolves to an instance of `KeystoneEth` or `null` if unable to create an instance.
   * @throws Will throw an error if the current environment does not support `WebUSB` or a Keystone device supporting USB signing could not be found.
   */
  getKeystoneDevice = async () => {
    if (!this.eth) {
      this.eth = await Eth.createWithUSBTransport({
        timeout: 60000,
        disconnectListener: _device => {
          this.eth = null;
        },
      });
    }
    return this.eth;
  };

  async getAddressesViaUSB(type: HDPathType = HDPathType.BIP44) {
    const pathMap = {
      [HDPathType.BIP44]: KeystoneHDPathType.Bip44Standard,
      [HDPathType.LedgerLive]: KeystoneHDPathType.LedgerLive,
      [HDPathType.Legacy]: KeystoneHDPathType.LedgerLegacy,
    };

    const keystoneEth = await this.getKeystoneDevice();
    const result = await keystoneEth.exportPubKeyFromUr({
      type: pathMap[type],
    });
    this.syncKeyring(result as any);
    return Promise.resolve();
  }

  async exportCurrentSignRequestIdIfExist() {
    return this.getMemStore().getState().sign?.request?.requestId ?? null;
  }

  async signTransactionViaUSB(address: string, tx: any) {
    const keystoneEth = await this.getKeystoneDevice();
    return await keystoneEth.signTransaction(this, address, tx);
  }

  async signTransactionUrViaUSB(ur: string) {
    const keystoneEth = await this.getKeystoneDevice();
    return await keystoneEth.signTransactionFromUr(ur);
  }

  /**
   * Keystone's upstream implementation (MetaMaskKeyring) differs from
   * BaseKeyring by passing the signer address in the UR request. Keep that
   * behavior.
   *
   * @param address - Address of the account being used to sign.
   * @param tx - EthereumJS transaction to sign.
   * @returns The signed transaction.
   */
  async signTransaction(address: string, tx: any) {
    const dataType =
      tx.type === 0 ? DataType.transaction : DataType.typedTransaction;

    const messageToSign =
      tx.type === 0
        ? Buffer.from(RLP.encode(tx.getMessageToSign()))
        : Buffer.from(tx.getMessageToSign());

    const hdPath = await this._pathFromAddress(address);
    const chainId = tx.common.chainId();
    const requestId = uuidv4();
    const ethSignRequest = EthSignRequest.constructETHRequest(
      messageToSign,
      dataType,
      hdPath,
      this.xfp,
      requestId,
      chainId,
      address,
    );

    const { r, s, v } = await this.requestSignature(
      requestId,
      ethSignRequest,
      'Scan with your Keystone',
      'After your Keystone has signed the transaction, click on "Scan Keystone" to receive the signature',
    );

    const txJson = tx.toJSON();
    txJson.v = v;
    txJson.s = s;
    txJson.r = r;
    txJson.type = tx.type;

    return TransactionFactory.fromTxData(txJson, {
      common: tx.common,
    });
  }

  async getAccountInfo(address: string) {
    const currentAccount = (await this.getCurrentAccounts()).find(account => {
      return account.address?.toUpperCase() === address?.toUpperCase();
    });
    const walletId = this.getWalletId();

    return {
      address,
      index: currentAccount?.index,
      balance: null,
      hdPathType: await this.getCurrentUsedHDPathType(),
      hdPathBasePublicKey: this.xpub,
      walletId: walletId || undefined,
      walletName: this.getWalletName(),
      deviceFingerprint: this.xfp || undefined,
    };
  }

  async getCurrentUsedHDPathType() {
    return AccountTypeMap[this.keyringAccount] ?? HDPathType.BIP44;
  }

  async serialize(): Promise<IStoredKeyring> {
    const data = await super.serialize();
    return {
      ...data,
      brandsMap: this.brandsMap,
      walletAlias: this.walletAlias,
    };
  }

  deserialize(opts?: IStoredKeyring) {
    // `onCreateKeyring` constructs keyrings with `{}` before the stored data is
    // applied. Never let that wipe the defaults that `BaseKeyring` just set.
    if (!opts || Object.keys(opts).length === 0) {
      return;
    }

    super.deserialize(opts);

    if (opts.brandsMap) {
      this.brandsMap = opts.brandsMap;
    }
    if (opts.walletAlias) {
      this.walletAlias = opts.walletAlias;
    }

    if (Array.isArray(this.accounts)) {
      this.accounts.forEach(account => {
        if (!this.brandsMap[account.toLowerCase()]) {
          this.brandsMap[account.toLowerCase()] = DEFAULT_BRAND;
        }
      });
    }
  }

  async getMaxAccountLimit() {
    if (!this.initialized) {
      await this.readKeyring();
    }
    if (this.getWalletMode() === 'pubkey') {
      return Object.keys(this.paths).length;
    }

    return undefined;
  }

  async getAddresses(start: number, end: number) {
    if (!this.initialized) {
      await this.readKeyring();
    }
    if (this.getWalletMode() === 'pubkey') {
      end = Math.min(end, Object.keys(this.paths).length);
      start = Math.min(start, end);
    }
    const accounts: {
      address: string;
      balance: number | null;
      index: number;
    }[] = [];
    for (let i = start; i < end; i++) {
      const address = await this.__addressFromIndex(pathBase, i);
      accounts.push({
        address,
        balance: null,
        index: i + 1,
      });
      this.indexes[toChecksumAddress(address)] = i;
    }
    return accounts;
  }

  async getAccountsWithBrand() {
    const accounts = await this.getAccounts();
    return accounts.map(account => ({
      address: account,
      brandName: this.brandsMap[account.toLowerCase()] || DEFAULT_BRAND,
    }));
  }

  async getFirstPage(): Promise<PagedAccount[]> {
    const pagedAccount = await super.getFirstPage();
    pagedAccount.forEach(account => (account.index += 1));
    return pagedAccount;
  }

  async getNextPage(): Promise<PagedAccount[]> {
    const pagedAccount = await super.getNextPage();
    pagedAccount.forEach(account => (account.index += 1));
    return pagedAccount;
  }

  setCurrentBrand(brand: string) {
    this.currentBrand = brand;
  }

  async addAccounts(n = 1): Promise<string[]> {
    const startIndex = (this as any).unlockedAccount as number;
    const accounts = await super.addAccounts(n);

    // `BaseKeyring.addAccounts` derives addresses but does not populate
    // `indexes`; do it here so `getCurrentAccounts`/`getAccountInfo` work
    // without a prior `getAddresses` call (e.g. the first address after
    // pairing).
    accounts.slice(-n).forEach((account, i) => {
      const checksummed = toChecksumAddress(account);
      if (this.indexes[checksummed] === undefined) {
        this.indexes[checksummed] = startIndex + i;
      }
      if (!this.brandsMap[account.toLowerCase()]) {
        this.brandsMap[account.toLowerCase()] = this.currentBrand;
      }
    });

    return accounts;
  }

  removeAccount(address: string): void {
    super.removeAccount(address);
    delete this.brandsMap[address.toLowerCase()];
  }

  forgetDevice = (): void => {
    // common props
    this.page = 0;
    this.perPage = 5;
    this.accounts = [];
    this.currentAccount = 0;
    this.name = DEFAULT_KEYRING_NAME;
    this.initialized = false;
    // hd props
    this.xfp = '';
    this.xpub = '';
    this.hdPath = '';
    this.indexes = {};
    this.hdk = undefined;
    // pubkey props
    this.paths = {};
    // Rabby metadata
    this.walletAlias = '';
    this.brandsMap = {};
    this.interaction.reset();
  };

  getCurrentAccounts = async () => {
    const addrs = await this.getAccounts();

    return addrs.map((address, accountIndex) => {
      const checksummedAddress = toChecksumAddress(address);
      const storedIndex = this.indexes[checksummedAddress];

      return {
        address,
        // Legacy serialized keyrings may not have `indexes`; fall back to the
        // account order instead of returning NaN.
        index: (storedIndex !== undefined ? storedIndex : accountIndex) + 1,
      };
    });
  };

  isReady = async () => {
    return this.initialized;
  };

  getCurrentBrand = async () => {
    return this.currentBrand;
  };

  checkAllowImport = async (brand: string) => {
    const [account] = await this.getAccountsWithBrand();

    if (!account) {
      this.forgetDevice();
      return {
        allowed: true,
      };
    }

    return {
      brand: account.brandName,
      allowed: account.brandName === brand,
    };
  };
}
