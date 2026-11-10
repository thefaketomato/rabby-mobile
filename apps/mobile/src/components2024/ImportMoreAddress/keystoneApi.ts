import { apiKeystone } from '@/core/apis';

/**
 * Keystone address API bound to one wallet.
 *
 * `ImportMoreAddress` is shared by all hardware types, so it calls the HD APIs
 * without a wallet id. Keystone needs every call scoped to the wallet the sheet
 * was opened for; this wrapper supplies that id.
 *
 * @param keystoneKeyringId - Wallet id from pairing / navigation params.
 * @returns The Keystone API with the wallet id pre-applied.
 */
export function createKeystoneHDAddressApi(keystoneKeyringId?: string) {
  return {
    ...apiKeystone,
    getAddresses: (start: number, end: number) =>
      apiKeystone.getAddresses(start, end, keystoneKeyringId),
    getCurrentAccounts: () => apiKeystone.getCurrentAccounts(keystoneKeyringId),
    getMaxAccountLimit: () => apiKeystone.getMaxAccountLimit(keystoneKeyringId),
    importAddress: (index: number) =>
      apiKeystone.importAddress(index, keystoneKeyringId),
  };
}
