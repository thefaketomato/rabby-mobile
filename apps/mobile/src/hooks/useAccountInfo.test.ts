import { renderHook, waitFor } from '@testing-library/react-native';
import { KEYRING_TYPE } from '@rabby-wallet/keyring-utils';

import { useAccountsInfo } from './useAccountInfo';

const mockGetAccountInfoByAddress = jest.fn();

jest.mock('@/core/apis', () => ({
  apiKeyring: { requestKeyring: jest.fn() },
  apiKeystone: {
    getAccountInfoByAddress: (...args: unknown[]) =>
      mockGetAccountInfoByAddress(...args),
  },
  apiMnemonic: { getMnemonicAddressInfo: jest.fn() },
}));

describe('useAccountsInfo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes Keystone wallet metadata for address detail', async () => {
    mockGetAccountInfoByAddress.mockResolvedValue({
      address: '0xabc',
      index: 2,
      hdPathType: 'BIP44',
      walletName: 'Treasury',
      deviceFingerprint: 'aabbccdd',
    });

    const { result } = renderHook(() =>
      useAccountsInfo(KEYRING_TYPE.KeystoneKeyring, '0xabc', 'Keystone'),
    );

    await waitFor(() => {
      expect(result.current?.walletName).toBe('Treasury');
    });
    expect(result.current).toMatchObject({
      walletName: 'Treasury',
      deviceFingerprint: 'aabbccdd',
      hdPathType: 'BIP44',
      hdPathTypeLabel: 'BIP44',
      index: 2,
    });
    expect(mockGetAccountInfoByAddress).toHaveBeenCalledWith('0xabc');
  });
});
