import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useImportKeystone } from './useImportKeystone';

const mockGetHDPath = jest.fn();
const mockShowImportMorePopup = jest.fn();
const mockSetSetting = jest.fn();

jest.mock('jotai', () => ({
  useAtom: () => [undefined, mockSetSetting],
}));

jest.mock('../HDSetting/MainContainer', () => ({
  settingAtom: {},
}));

jest.mock('@/hooks/useShowImportMoreAddressPopup', () => ({
  useShowImportMoreAddressPopup: () => ({
    showImportMorePopup: (...args: unknown[]) =>
      mockShowImportMorePopup(...args),
  }),
}));

jest.mock('@/core/apis', () => ({
  apiKeystone: {
    getCurrentUsedHDPathType: (...args: unknown[]) => mockGetHDPath(...args),
  },
}));

jest.mock('@rabby-wallet/eth-keyring-ledger/dist/utils', () => ({
  LedgerHDPathType: {
    LedgerLive: 'LedgerLive',
    BIP44: 'BIP44',
    Legacy: 'Legacy',
  },
}));

jest.mock('@rabby-wallet/keyring-utils', () => ({
  HARDWARE_KEYRING_TYPES: {
    Keystone: {
      type: 'QR Hardware Wallet Device',
      brandName: 'Keystone',
    },
  },
  KEYRING_TYPE: {
    KeystoneKeyring: 'QR Hardware Wallet Device',
  },
}));

describe('useImportKeystone', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHDPath.mockResolvedValue('LedgerLive');
  });

  it('opens the import sheet with the selected wallet id', async () => {
    const { result } = renderHook(() => useImportKeystone());

    await waitFor(() => {
      expect(mockGetHDPath).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current('wallet-a');
    });

    expect(mockGetHDPath).toHaveBeenCalledWith('wallet-a');
    expect(mockSetSetting).toHaveBeenCalledWith({
      startNumber: 1,
      hdPath: 'LedgerLive',
    });
    expect(mockShowImportMorePopup).toHaveBeenCalledWith({
      type: 'QR Hardware Wallet Device',
      brandName: 'Keystone',
      keystoneKeyringId: 'wallet-a',
    });
  });

  it('falls back to the default wallet resolution when no id is given', async () => {
    const { result } = renderHook(() => useImportKeystone());

    await waitFor(() => {
      expect(mockGetHDPath).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current();
    });

    expect(mockShowImportMorePopup).toHaveBeenCalledWith({
      type: 'QR Hardware Wallet Device',
      brandName: 'Keystone',
      keystoneKeyringId: undefined,
    });
  });
});
