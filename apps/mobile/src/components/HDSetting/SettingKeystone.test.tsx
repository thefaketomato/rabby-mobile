import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { SettingKeystone } from './SettingKeystone';

const mockGetHDPath = jest.fn();
const mockGetMaxAccountLimit = jest.fn();
const mockGetWallet = jest.fn();
const mockRenameWallet = jest.fn();
const mockRemoveWallet = jest.fn();
const mockToastInfo = jest.fn();
const mockToastError = jest.fn();

jest.mock('@/core/apis', () => ({
  apiKeystone: {
    getCurrentUsedHDPathType: (...args: unknown[]) => mockGetHDPath(...args),
    getMaxAccountLimit: (...args: unknown[]) => mockGetMaxAccountLimit(...args),
    getWallet: (...args: unknown[]) => mockGetWallet(...args),
    renameWallet: (...args: unknown[]) => mockRenameWallet(...args),
    removeAddressAndForgetDevice: (...args: unknown[]) =>
      mockRemoveWallet(...args),
  },
}));

jest.mock('./MainContainer', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    MainContainer: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(View, null, children),
    settingAtom: {},
    isLoadedAtom: {},
    MAX_ACCOUNT_COUNT: 50,
  };
});

jest.mock('jotai', () => ({
  useAtom: () => [undefined, jest.fn()],
}));

jest.mock('@rabby-wallet/eth-keyring-ledger/dist/utils', () => ({
  LedgerHDPathType: {
    LedgerLive: 'LedgerLive',
    BIP44: 'BIP44',
    Legacy: 'Legacy',
  },
}));

jest.mock('@rabby-wallet/keyring-utils', () => ({
  KEYRING_TYPE: { KeystoneKeyring: 'QR Hardware Wallet Device' },
}));

jest.mock('@/hooks/theme', () => ({
  useThemeColors: () =>
    new Proxy({}, { get: () => '#000000' }) as Record<string, string>,
}));

jest.mock('@/components', () => {
  const ReactModule = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({
      title,
      onPress,
      disabled,
    }: {
      title?: string;
      onPress?: () => void;
      disabled?: boolean;
    }) =>
      ReactModule.createElement(
        Pressable,
        { onPress, disabled, testID: `button-${title}` },
        ReactModule.createElement(Text, null, title),
      ),
  };
});

jest.mock('@/components/Modal/TrackedModal', () => {
  const ReactModule = require('react');
  return {
    TrackedModal: ({
      visible,
      children,
    }: {
      visible?: boolean;
      children?: React.ReactNode;
    }) =>
      visible
        ? ReactModule.createElement(ReactModule.Fragment, null, children)
        : null,
  };
});

jest.mock('@/components/Typography', () => {
  const { Text, TextInput } = require('react-native');
  return { Text, TextInput };
});

jest.mock('@/utils/modalGate', () => ({
  MODAL_GATE_IDS: {
    hdKeystoneRenameWallet: 'rename',
    hdKeystoneRemoveWallet: 'remove',
  },
}));

jest.mock('@/components2024/WalletIcon/WalletIcon', () => ({
  WalletIcon: () => null,
}));
jest.mock('@/components2024/Toast', () => ({
  toast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));
jest.mock('@/assets/icons/approval/edit-arrow-right.svg', () => () => null);
jest.mock('@/assets2024/icons/common/delete-cc.svg', () => () => null);
jest.mock('@/assets2024/icons/common/plus-cc.svg', () => () => null);
jest.mock('@gorhom/bottom-sheet', () => {
  const { TextInput, TouchableOpacity, View } = require('react-native');
  return {
    BottomSheetTextInput: TextInput,
    TouchableOpacity,
    BottomSheetView: View,
  };
});
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values && 'fingerprint' in values ? `${key}:${values.fingerprint}` : key,
  }),
}));

const wallet = {
  walletId: 'wallet-a',
  name: 'Keystone A',
  alias: '',
  fingerprint: 'aabbccdd',
  mode: 'hd' as const,
  hdPathType: 'BIP44' as any,
  accounts: [{ address: '0xaaa', index: 1 }],
  isReady: true,
};

describe('SettingKeystone', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHDPath.mockResolvedValue('BIP44');
    mockGetMaxAccountLimit.mockResolvedValue(50);
    mockGetWallet.mockResolvedValue(wallet);
    mockRenameWallet.mockResolvedValue('Treasury');
    mockRemoveWallet.mockResolvedValue(undefined);
  });

  it('shows the wallet name and fingerprint', async () => {
    const view = render(
      <SettingKeystone
        onDone={jest.fn()}
        brand="Keystone"
        keystoneKeyringId="wallet-a"
      />,
    );

    await waitFor(() => {
      expect(view.getByText('Keystone A')).toBeTruthy();
    });
    expect(
      view.getByText(
        /page\.newAddress\.keystone\.select\.fingerprint:AABBCCDD/u,
      ),
    ).toBeTruthy();
    expect(mockGetWallet).toHaveBeenCalledWith('wallet-a');
    expect(
      view.getByText('page.newAddress.keystone.settings.rename'),
    ).toBeTruthy();
    expect(
      view.getByText('page.newAddress.keystone.settings.addAnother'),
    ).toBeTruthy();
    expect(
      view.getByText('page.newAddress.keystone.settings.remove'),
    ).toBeTruthy();
  });

  it('renames the wallet through the scoped API', async () => {
    const view = render(
      <SettingKeystone
        onDone={jest.fn()}
        brand="Keystone"
        keystoneKeyringId="wallet-a"
      />,
    );

    await waitFor(() => {
      expect(
        view.getByText('page.newAddress.keystone.settings.rename'),
      ).toBeTruthy();
    });
    fireEvent.press(view.getByText('page.newAddress.keystone.settings.rename'));

    const input = view.getByPlaceholderText(
      'page.newAddress.keystone.settings.renamePlaceholder',
    );
    fireEvent.changeText(input, 'Treasury');
    fireEvent.press(view.getByTestId('button-global.Confirm'));

    await waitFor(() => {
      expect(mockRenameWallet).toHaveBeenCalledWith('wallet-a', 'Treasury');
    });
    expect(mockToastInfo).toHaveBeenCalledWith(
      'page.newAddress.keystone.settings.renamed',
    );
    await waitFor(() => {
      expect(view.getByText('Treasury')).toBeTruthy();
    });
  });

  it('removes only the selected wallet and closes the flow', async () => {
    const onDone = jest.fn();
    const onRemoved = jest.fn();
    const view = render(
      <SettingKeystone
        onDone={onDone}
        onRemoved={onRemoved}
        brand="Keystone"
        keystoneKeyringId="wallet-a"
      />,
    );

    await waitFor(() => {
      expect(
        view.getByText('page.newAddress.keystone.settings.remove'),
      ).toBeTruthy();
    });
    fireEvent.press(view.getByText('page.newAddress.keystone.settings.remove'));
    fireEvent.press(view.getByTestId('button-global.Confirm'));

    await waitFor(() => {
      expect(mockRemoveWallet).toHaveBeenCalledWith('wallet-a');
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it('hands off to the add-another flow', async () => {
    const onDone = jest.fn();
    const onAddAnother = jest.fn();
    const view = render(
      <SettingKeystone
        onDone={onDone}
        onAddAnother={onAddAnother}
        brand="Keystone"
        keystoneKeyringId="wallet-a"
      />,
    );

    await waitFor(() => {
      expect(
        view.getByText('page.newAddress.keystone.settings.addAnother'),
      ).toBeTruthy();
    });
    fireEvent.press(
      view.getByText('page.newAddress.keystone.settings.addAnother'),
    );

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onAddAnother).toHaveBeenCalledTimes(1);
  });
});
