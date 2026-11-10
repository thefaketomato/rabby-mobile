import type { InteractionProvider } from '@keystonehq/base-eth-keyring';
import type { EthSignRequest } from '@keystonehq/bc-ur-registry-eth';
import {
  CryptoAccount,
  CryptoHDKey,
  ETHSignature,
} from '@keystonehq/bc-ur-registry-eth';
import { EventEmitter } from 'events';
import { stringify as uuidStringify } from 'uuid';

export type RequestSignPayload = {
  requestId: string;
  payload: {
    type: string;
    cbor: string;
  };
  title?: string;
  description?: string;
};

type KeystoneMemStoreState = {
  sync: {
    reading: boolean;
  };
  sign: {
    request?: RequestSignPayload;
  };
  _version: number;
};

const SYNC_SUCCESS_HDKEY = 'keystone-sync_success-hdkey';
const SYNC_SUCCESS_ACCOUNT = 'keystone-sync_success-account';
const SYNC_CANCEL = 'keystone-sync_cancel';

/**
 * Minimal observable store for the Keystone sync/sign state.
 *
 * The upstream `@keystonehq/metamask-airgapped-keyring` uses
 * `@metamask/obs-store` here, but a plain object is enough for our usage and
 * avoids pulling another dependency into the React Native bundle.
 */
type KeystoneMemStoreListener = (state: KeystoneMemStoreState) => void;

export class KeystoneMemStore {
  private state: KeystoneMemStoreState = {
    sync: { reading: false },
    sign: {},
    _version: 1,
  };

  private readonly listeners = new Set<KeystoneMemStoreListener>();

  getState(): KeystoneMemStoreState {
    return this.state;
  }

  subscribe(listener: KeystoneMemStoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  updateState(patch: Partial<KeystoneMemStoreState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener(this.state));
  }
}

/**
 * Per-keyring Keystone interaction provider.
 *
 * This is a port of `MetamaskInteractionProvider` from
 * `@keystonehq/metamask-airgapped-keyring@0.15.2` (MIT), with one important
 * difference: the upstream provider is a process-wide singleton, which makes
 * it impossible to keep more than one Keystone wallet in memory.
 *
 * Every `KeystoneKeyring` instance owns its own provider, so sync listeners and
 * the pending sign request are scoped to a single wallet.
 */
export class KeystoneInteractionProvider
  extends EventEmitter
  implements InteractionProvider
{
  readonly memStore = new KeystoneMemStore();

  private readonly cleanSyncListeners = (): void => {
    this.removeAllListeners(SYNC_SUCCESS_HDKEY);
    this.removeAllListeners(SYNC_SUCCESS_ACCOUNT);
    this.removeAllListeners(SYNC_CANCEL);
  };

  private readonly cleanSignListeners = (requestId: string): void => {
    this.removeAllListeners(`${requestId}-signed`);
    this.removeAllListeners(`${requestId}-canceled`);
  };

  readCryptoHDKeyOrCryptoAccount = (): Promise<CryptoHDKey | CryptoAccount> => {
    return new Promise((resolve, reject) => {
      this.memStore.updateState({ sync: { reading: true } });

      this.on(SYNC_SUCCESS_HDKEY, (cbor: string) => {
        const cryptoHDKey = CryptoHDKey.fromCBOR(Buffer.from(cbor, 'hex'));
        this.cleanSyncListeners();
        this.resetState();
        resolve(cryptoHDKey);
      });

      this.on(SYNC_SUCCESS_ACCOUNT, (cbor: string) => {
        const cryptoAccount = CryptoAccount.fromCBOR(Buffer.from(cbor, 'hex'));
        this.cleanSyncListeners();
        this.resetState();
        resolve(cryptoAccount);
      });

      this.on(SYNC_CANCEL, () => {
        this.cleanSyncListeners();
        this.resetState();
        reject(
          new Error(
            'KeystoneError#sync_cancel. Sync process canceled, please retry',
          ),
        );
      });
    });
  };

  submitCryptoHDKey = (cbor: string): void => {
    this.emit(SYNC_SUCCESS_HDKEY, cbor);
  };

  submitCryptoAccount = (cbor: string): void => {
    this.emit(SYNC_SUCCESS_ACCOUNT, cbor);
  };

  cancelSync = (): void => {
    this.emit(SYNC_CANCEL);
  };

  requestSignature = (
    signRequest: EthSignRequest,
    requestTitle?: string,
    requestDescription?: string,
  ): Promise<ETHSignature> => {
    return new Promise((resolve, reject) => {
      const requestIdBuffer = signRequest.getRequestId();

      if (!requestIdBuffer) {
        reject(
          new Error(
            'KeystoneError#invalid_data: sign request is missing requestId',
          ),
        );
        return;
      }

      const ur = signRequest.toUR();
      const requestId = uuidStringify(requestIdBuffer);
      const signPayload: RequestSignPayload = {
        requestId,
        payload: {
          type: ur.type,
          cbor: ur.cbor.toString('hex'),
        },
        title: requestTitle,
        description: requestDescription,
      };

      this.memStore.updateState({
        sign: {
          request: signPayload,
        },
      });

      this.once(`${requestId}-signed`, (cbor: string) => {
        const ethSignature = ETHSignature.fromCBOR(Buffer.from(cbor, 'hex'));
        this.resetState();
        resolve(ethSignature);
      });

      this.once(`${requestId}-canceled`, () => {
        this.resetState();
        reject(
          new Error(
            'KeystoneError#Tx_canceled. Signing canceled, please retry',
          ),
        );
      });
    });
  };

  submitSignature = (requestId: string, cbor: string): void => {
    this.emit(`${requestId}-signed`, cbor);
  };

  cancelRequestSignature = (): void => {
    const signPayload = this.memStore.getState().sign.request;

    if (signPayload) {
      const { requestId } = signPayload;
      this.memStore.updateState({ sign: {} });
      this.emit(`${requestId}-canceled`);
    }
  };

  reset = (): void => {
    this.cleanSyncListeners();

    const signPayload = this.memStore.getState().sign.request;
    if (signPayload) {
      this.cleanSignListeners(signPayload.requestId);
    }

    this.resetState();
  };

  resetState = (): void => {
    this.memStore.updateState({
      sync: { reading: false },
      sign: {},
    });
  };
}
