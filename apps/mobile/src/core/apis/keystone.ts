import type { LedgerHDPathType } from '@rabby-wallet/eth-keyring-ledger/dist/utils';
import KeystoneKeyring, {
  AcquireMemeStoreData,
  MemStoreDataReady,
} from '@rabby-wallet/eth-keyring-keystone/dist/KeystoneKeyring';
import { KEYRING_CLASS, KEYRING_TYPE } from '@rabby-wallet/keyring-utils';
import { nanoid } from 'nanoid';

import {
  ensureKeyringRuntimeReadyForApi,
  getKeyringInstancesSnapshot,
  getKeyringsByTypeSnapshot,
  keyringServiceApi,
} from '@/core/serviceApi/keyring';
import { preferenceServiceApi } from '@/core/serviceApi/preference';
import { EVENTS, eventBus } from '@/utils/events';

export type KeystoneWalletInfo = {
  walletId: string;
  name: string;
  alias: string;
  fingerprint: string;
  mode: 'hd' | 'pubkey';
  hdPathType: LedgerHDPathType;
  accounts: Array<{ address: string; index: number }>;
  isReady: boolean;
};

type QRHardwareSyncType = 'crypto-hdkey' | 'crypto-account';

/**
 * Keyrings created by `beginPairing` and waiting for a QR payload.
 * They are intentionally not persisted until the first account is imported.
 */
const pendingPairings = new Map<string, KeystoneKeyring>();

/**
 * Keyrings that completed a QR sync but have not been registered in the
 * keyring service yet (registration happens on the first account import).
 */
const pairedKeyrings = new Map<string, KeystoneKeyring>();

function getServiceKeyrings(): KeystoneKeyring[] {
  return getKeyringsByTypeSnapshot(
    KEYRING_TYPE.KeystoneKeyring,
  ) as unknown as KeystoneKeyring[];
}

function isKeyringRegistered(keyring: KeystoneKeyring): boolean {
  const instances = getKeyringInstancesSnapshot() as unknown as unknown[];
  return instances.includes(keyring);
}

/** Service keyrings plus not-yet-persisted paired keyrings, without duplicates. */
function getAllKeyrings(): KeystoneKeyring[] {
  const keyrings = [...getServiceKeyrings()];
  pairedKeyrings.forEach(keyring => {
    if (!keyrings.includes(keyring)) {
      keyrings.push(keyring);
    }
  });
  return keyrings;
}

function findKeyringById(walletId: string): KeystoneKeyring | undefined {
  return getAllKeyrings().find(keyring => keyring.getWalletId() === walletId);
}

/**
 * Resolve the keyring to operate on.
 *
 * With `walletId` the match is exact. Without it, exactly one synced Keystone
 * wallet must exist; otherwise we throw instead of silently operating on the
 * wrong device.
 *
 * @param walletId - Optional wallet id returned by pairing or `getWallets`.
 * @returns The matching keyring.
 */
async function resolveKeyring(walletId?: string): Promise<KeystoneKeyring> {
  await ensureKeyringRuntimeReadyForApi('api.keystone.resolve_wallet');

  if (walletId) {
    const keyring = findKeyringById(walletId);
    if (keyring) {
      return keyring;
    }
    throw new Error(`Keystone wallet not found: ${walletId}`);
  }

  const keyrings = getAllKeyrings().filter(keyring =>
    Boolean(keyring.getWalletId()),
  );
  if (keyrings.length === 1) {
    return keyrings[0];
  }
  if (keyrings.length === 0) {
    throw new Error('No Keystone wallet found');
  }

  throw new Error(
    'Multiple Keystone wallets found; a walletId is required for this operation',
  );
}

async function findKeyringByAddress(
  address: string,
): Promise<KeystoneKeyring | undefined> {
  await ensureKeyringRuntimeReadyForApi('api.keystone.find_wallet_by_address');

  try {
    const keyring = await keyringServiceApi.getKeyringForAccount(
      address,
      KEYRING_TYPE.KeystoneKeyring,
    );
    if (keyring) {
      return keyring as KeystoneKeyring;
    }
  } catch {
    // Fall through to the in-memory (paired but not persisted) keyrings.
  }

  const target = address.toLowerCase();
  for (const keyring of getAllKeyrings()) {
    const accounts = await keyring.getAccounts();
    if (accounts.some(account => account.toLowerCase() === target)) {
      return keyring;
    }
  }

  return undefined;
}

async function ensureKeyringRegistered(
  keyring: KeystoneKeyring,
): Promise<void> {
  if (!isKeyringRegistered(keyring)) {
    await keyringServiceApi.addKeyring(keyring as any);
  }
  const walletId = keyring.getWalletId();
  if (walletId) {
    pairedKeyrings.delete(walletId);
  }
}

async function toWalletInfo(
  keyring: KeystoneKeyring,
): Promise<KeystoneWalletInfo> {
  return {
    walletId: keyring.getWalletId(),
    name: keyring.getWalletName(),
    alias: keyring.getWalletAlias(),
    fingerprint: keyring.getDeviceFingerprint(),
    mode: keyring.getWalletMode(),
    hdPathType:
      (await keyring.getCurrentUsedHDPathType()) as unknown as LedgerHDPathType,
    accounts: await keyring.getCurrentAccounts(),
    isReady: await keyring.isReady(),
  };
}

//
// Pairing lifecycle
//

/**
 * Start a fresh pairing session. The returned keyring is never reused, so a
 * second QR payload can never overwrite an already paired wallet.
 *
 * @returns Opaque id to pass to `submitQRHardwareSync` / `cancelPairing`.
 */
export async function beginPairing(): Promise<{ pendingId: string }> {
  await ensureKeyringRuntimeReadyForApi('api.keystone.begin_pairing');

  const pendingId = nanoid();
  pendingPairings.set(pendingId, new KeystoneKeyring());
  return { pendingId };
}

/**
 * Feed a scanned QR payload into a pending pairing session and finish the
 * pairing. The wallet is not added to the keyring service until its first
 * account is imported; `pairedKeyrings` keeps it resolvable in the meantime.
 *
 * @param type - UR type of the scanned payload.
 * @param cbor - Raw CBOR payload from the QR code.
 * @param pendingId - Optional id from `beginPairing`; inferred when only one
 * pairing session is open.
 * @returns The wallet id and whether that wallet was already paired.
 */
export async function submitQRHardwareSync(
  type: QRHardwareSyncType,
  cbor: string,
  pendingId?: string,
): Promise<{ walletId: string; isExisting: boolean }> {
  const sessionId = pendingId ?? getOnlyPendingId();
  const keyring = pendingPairings.get(sessionId);
  if (!keyring) {
    throw new Error('Keystone pairing session not found');
  }

  const reading = keyring.readKeyring();
  if (type === 'crypto-hdkey') {
    keyring.submitCryptoHDKey(cbor);
  } else {
    keyring.submitCryptoAccount(cbor);
  }
  await reading;

  pendingPairings.delete(sessionId);

  const walletId = keyring.getWalletId();
  if (!walletId) {
    keyring.forgetDevice();
    throw new Error('Keystone sync did not produce a wallet id');
  }

  const existing = findKeyringById(walletId);
  if (existing) {
    keyring.forgetDevice();
    return { walletId, isExisting: true };
  }

  pairedKeyrings.set(walletId, keyring);
  return { walletId, isExisting: false };
}

/**
 * Abandon a pairing session without persisting anything.
 *
 * @param pendingId - Id returned by `beginPairing`.
 */
export async function cancelPairing(pendingId: string): Promise<void> {
  const keyring = pendingPairings.get(pendingId);
  if (!keyring) {
    return;
  }
  pendingPairings.delete(pendingId);
  keyring.forgetDevice();
}

function getOnlyPendingId(): string {
  const ids = Array.from(pendingPairings.keys());
  if (ids.length !== 1) {
    throw new Error(
      'Expected exactly one Keystone pairing session; pass pendingId explicitly',
    );
  }
  return ids[0];
}

//
// Legacy single-wallet helpers (kept until the connect UI is wallet-aware)
//

async function getLegacyKeyring(): Promise<KeystoneKeyring> {
  const keyrings = getAllKeyrings();
  if (keyrings.length === 1) {
    return keyrings[0];
  }
  if (keyrings.length > 1) {
    throw new Error(
      'Multiple Keystone wallets found; a walletId is required for this operation',
    );
  }

  const keyring = new KeystoneKeyring();
  await keyringServiceApi.addKeyring(keyring as any);
  return keyring;
}

export async function submitQRHardwareCryptoHDKey(cbor: string) {
  const keyring = await getLegacyKeyring();

  keyring.readKeyring();
  return keyring.submitCryptoHDKey(cbor);
}

export async function submitQRHardwareCryptoAccount(cbor: string) {
  const keyring = await getLegacyKeyring();

  keyring.readKeyring();
  return keyring.submitCryptoAccount(cbor);
}

//
// Wallet-scoped account management
//

export async function importAddress(index: number, walletId?: string) {
  const keyring = await resolveKeyring(walletId);

  await ensureKeyringRegistered(keyring);

  keyring.setAccountToUnlock(index);
  const res = (
    (await keyringServiceApi.addNewAccount(keyring as any))[0] as any
  ).address;

  await preferenceServiceApi.initCurrentAccount();

  return res;
}

export async function importFirstAddress(
  { retryCount = 1 }: { retryCount?: number },
  walletId?: string,
): Promise<string | false> {
  let address;

  const task = async () => {
    try {
      address = await importAddress(0, walletId);
    } catch (e: any) {
      // only catch not `duplicate import` error
      if (!e.message?.includes('import is invalid')) {
        throw e;
      }
      return false;
    }
  };

  for (let i = 0; i < retryCount; i++) {
    try {
      await task();
      break;
    } catch (e) {
      if (i === retryCount - 1) {
        throw e;
      }
    }
  }

  return address;
}

export async function getCurrentUsedHDPathType(walletId?: string) {
  const keyring = await resolveKeyring(walletId);
  const res = await keyring.getCurrentUsedHDPathType();
  return res as unknown as LedgerHDPathType;
}

/**
 * Whether a Keystone wallet is paired.
 *
 * With `walletId` the check is scoped to that wallet. Without it, returns true
 * when any Keystone wallet is ready (legacy callers use this as "is paired").
 *
 * @param walletId - Optional wallet id.
 * @returns True when the requested/any wallet is ready.
 */
export async function isReady(walletId?: string) {
  if (walletId) {
    const keyring = await resolveKeyring(walletId);
    return keyring.isReady();
  }

  const keyrings = getAllKeyrings();
  const ready = await Promise.all(keyrings.map(keyring => keyring.isReady()));
  return ready.some(Boolean);
}

export async function getAddresses(
  start: number,
  end: number,
  walletId?: string,
) {
  const keyring = await resolveKeyring(walletId);

  return keyring.getAddresses(start, end);
}

export async function getCurrentAccounts(walletId?: string) {
  const keyring = await resolveKeyring(walletId);

  return keyring.getCurrentAccounts();
}

export async function getMaxAccountLimit(walletId?: string) {
  const keyring = await resolveKeyring(walletId);

  return keyring.getMaxAccountLimit();
}

/**
 * Every paired Keystone wallet with its display metadata and accounts.
 *
 * @returns Wallet list, in keyring-service order.
 */
export async function getWallets(): Promise<KeystoneWalletInfo[]> {
  await ensureKeyringRuntimeReadyForApi('api.keystone.get_wallets');

  const keyrings = getAllKeyrings().filter(keyring =>
    Boolean(keyring.getWalletId()),
  );

  return Promise.all(keyrings.map(toWalletInfo));
}

/**
 * Find the wallet that owns an address.
 *
 * @param address - Account address.
 * @returns Wallet info, or undefined when the address is not a Keystone account.
 */
export async function getWalletByAccount(
  address: string,
): Promise<KeystoneWalletInfo | undefined> {
  const keyring = await findKeyringByAddress(address);
  return keyring ? toWalletInfo(keyring) : undefined;
}

/**
 * Read the keyring-level account info for a Keystone address.
 *
 * This must resolve the keyring by address (not by type): with multiple
 * Keystone keyrings, the first instance of the type may not own the address.
 *
 * @param address - Account address.
 * @returns Account info including `keyringId`, `walletName` and `index`.
 */
export async function getAccountInfoByAddress(address: string) {
  const keyring = await findKeyringByAddress(address);
  if (!keyring) {
    throw new Error(`No Keystone wallet found for address ${address}`);
  }
  return keyring.getAccountInfo(address);
}

export async function renameWallet(walletId: string, alias: string) {
  const keyring = await resolveKeyring(walletId);
  keyring.setWalletAlias(alias);

  if (isKeyringRegistered(keyring)) {
    await keyringServiceApi.persistKeyringsForKeyring(keyring as any);
  }

  return keyring.getWalletName();
}

export async function removeAddressAndForgetDevice(walletId?: string) {
  const keyring = await resolveKeyring(walletId);
  const accounts = await keyring.getCurrentAccounts();

  if (isKeyringRegistered(keyring)) {
    for (const account of accounts) {
      await keyringServiceApi.removeAccount(
        account.address,
        KEYRING_CLASS.HARDWARE.KEYSTONE,
        undefined,
        true,
      );
    }
  }

  const resolvedWalletId = keyring.getWalletId();
  if (resolvedWalletId) {
    pairedKeyrings.delete(resolvedWalletId);
  }
  keyring.forgetDevice();
  return;
}

//
// Signing
//

/**
 * Find the pending sign request id across all Keystone wallets.
 *
 * @returns The pending request id, or null when no wallet is signing.
 */
export async function exportCurrentSignRequestIdIfExist() {
  const keyrings = getAllKeyrings();
  for (const keyring of keyrings) {
    const requestId = await keyring.exportCurrentSignRequestIdIfExist();
    if (requestId) {
      return requestId;
    }
  }
  return null;
}

const forwardedInteractions = new WeakSet();

export async function acquireKeystoneMemStoreData() {
  const keyrings = getAllKeyrings();

  keyrings.forEach(keyring => {
    const interaction = keyring.getInteraction();
    // The keyring pushes MemStoreDataReady when a request is created later,
    // so forward it once per wallet interaction instead of per call.
    if (!forwardedInteractions.has(interaction)) {
      forwardedInteractions.add(interaction);
      interaction.on(MemStoreDataReady, request => {
        eventBus.emit(EVENTS.QRHARDWARE.ACQUIRE_MEMSTORE_SUCCEED, {
          request,
        });
      });
    }
    interaction.emit(AcquireMemeStoreData);
  });
}

export async function submitQRHardwareSignature(
  requestId: string,
  cbor: string,
) {
  const keyrings = getAllKeyrings();
  const owners = await Promise.all(
    keyrings.map(async keyring => ({
      keyring,
      requestId: await keyring.exportCurrentSignRequestIdIfExist(),
    })),
  );

  const owner = owners.find(item => item.requestId === requestId);
  if (owner) {
    return owner.keyring.submitSignature(requestId, cbor);
  }

  if (keyrings.length === 1) {
    return keyrings[0].submitSignature(requestId, cbor);
  }

  throw new Error(`No Keystone wallet is waiting for signature ${requestId}`);
}
