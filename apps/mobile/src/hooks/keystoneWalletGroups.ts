import { HARDWARE_KEYRING_TYPES } from '@rabby-wallet/keyring-utils';
import { groupBy } from 'lodash';

export type KeystoneAccountLike = {
  keyringId?: string;
};

export type KeystoneWalletGroup<T extends KeystoneAccountLike> = {
  keyringId?: string;
  /** Display label for the wallet group; empty when accounts have no wallet id. */
  name: string;
  list: T[];
};

/**
 * Split Keystone accounts into one group per wallet.
 *
 * Accounts without a `keyringId` (old snapshots / other keyring types) stay in
 * a single fallback group so the UI degrades to the previous brand grouping.
 *
 * @param accounts - Keystone accounts to group.
 * @param walletNameById - Wallet id to display name mapping.
 * @returns Groups sorted by account count, with labels like `Treasury · A1B2`.
 */
export function groupKeystoneWalletAccounts<T extends KeystoneAccountLike>(
  accounts: T[],
  walletNameById: Map<string, string>,
): KeystoneWalletGroup<T>[] {
  const fallbackKey = HARDWARE_KEYRING_TYPES.Keystone.brandName;
  const groups = groupBy(accounts, account => account.keyringId || fallbackKey);

  return Object.values(groups)
    .sort((a, b) => b.length - a.length)
    .map(group => {
      const keyringId = group[0]?.keyringId;
      if (!keyringId) {
        return { name: '', list: group };
      }

      const walletName = walletNameById.get(keyringId);
      const fingerprint = keyringId.split(':')[0]?.toUpperCase() ?? '';
      const shortFingerprint = fingerprint
        ? fingerprint.slice(Math.max(0, fingerprint.length - 4))
        : '';

      return {
        keyringId,
        name: walletName
          ? [walletName, shortFingerprint].filter(Boolean).join(' · ')
          : '',
        list: group,
      };
    });
}
