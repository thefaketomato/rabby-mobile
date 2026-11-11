import { LedgerHDPathType } from '@rabby-wallet/eth-keyring-ledger/dist/utils';
import {
  HARDWARE_KEYRING_TYPES,
  KEYRING_TYPE,
} from '@rabby-wallet/keyring-utils';
import { useAtom } from 'jotai';
import React, { useEffect } from 'react';
import { settingAtom } from '../HDSetting/MainContainer';
import { useShowImportMoreAddressPopup } from '@/hooks/useShowImportMoreAddressPopup';
import { apiKeystone } from '@/core/apis';

export const useImportKeystone = () => {
  const [_2, setSetting] = useAtom(settingAtom);
  const { showImportMorePopup } = useShowImportMoreAddressPopup();
  const ref = React.useRef<LedgerHDPathType>(LedgerHDPathType.BIP44);

  useEffect(() => {
    apiKeystone
      .getCurrentUsedHDPathType()
      .then(type => {
        if (type) {
          ref.current = type;
        }
      })
      .catch(() => {
        console.log("Failed to get Keystone's HD Path Type, use default BIP44");
        ref.current = LedgerHDPathType.BIP44;
      });
  }, []);

  /**
   * Open the "import more addresses" flow for a Keystone wallet.
   *
   * @param walletId - Optional wallet id. When omitted the API falls back to the
   * only paired wallet (legacy callers).
   * @returns Resolves once the import sheet has been requested.
   */
  const goImport = React.useCallback(
    async (walletId?: string) => {
      let hdPath = ref.current;

      if (walletId) {
        try {
          hdPath = await apiKeystone.getCurrentUsedHDPathType(walletId);
        } catch (e) {
          console.log(
            "Failed to get Keystone's HD Path Type for wallet, use default",
          );
        }
      }

      setSetting({
        startNumber: 1,
        hdPath: hdPath || LedgerHDPathType.BIP44,
      });
      showImportMorePopup({
        type: HARDWARE_KEYRING_TYPES.Keystone.type as KEYRING_TYPE,
        brandName: HARDWARE_KEYRING_TYPES.Keystone.brandName,
        keystoneWalletId: walletId,
      });
    },
    [setSetting, showImportMorePopup],
  );

  return goImport;
};
