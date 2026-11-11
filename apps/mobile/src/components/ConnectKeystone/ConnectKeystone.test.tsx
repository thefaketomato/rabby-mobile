import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { ConnectKeystone } from './ConnectKeystone';

const mockGetWallets = jest.fn();
const mockBeginPairing = jest.fn();
const mockImportFirstAddress = jest.fn();
const mockCancelPairing = jest.fn();
const mockGoImport = jest.fn(async () => undefined);
const mockToastInfo = jest.fn();
const mockToastError = jest.fn();
const mockNavigateDeprecated = jest.fn();

jest.mock('@/core/apis', () => ({
  apiKeystone: {
    getWallets: (...args: unknown[]) => mockGetWallets(...args),
    beginPairing: (...args: unknown[]) => mockBeginPairing(...args),
    importFirstAddress: (...args: unknown[]) => mockImportFirstAddress(...args),
    cancelPairing: async (...args: unknown[]) => {
      mockCancelPairing(...args);
    },
  },
}));

jest.mock('./useImportKeystone', () => ({
  useImportKeystone: () => mockGoImport,
}));

jest.mock('./CameraPermissionScreen', () => {
  const ReactModule = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    CameraPermissionScreen: ({ onNext }: { onNext: () => void }) =>
      ReactModule.createElement(
        Pressable,
        { testID: 'camera-screen', onPress: onNext },
        ReactModule.createElement(Text, null, 'camera-screen'),
      ),
  };
});

jest.mock('./ScanDeviceScreen', () => {
  const ReactModule = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    ScanDeviceScreen: ({
      onScanFinish,
    }: {
      onScanFinish: (result: { walletId: string; isExisting: boolean }) => void;
    }) =>
      ReactModule.createElement(
        View,
        null,
        ReactModule.createElement(Text, null, 'scan-screen'),
        ReactModule.createElement(
          Pressable,
          {
            testID: 'scan-existing',
            onPress: () =>
              onScanFinish({ walletId: 'existing-id', isExisting: true }),
          },
          ReactModule.createElement(Text, null, 'scan-existing'),
        ),
        ReactModule.createElement(
          Pressable,
          {
            testID: 'scan-new',
            onPress: () =>
              onScanFinish({ walletId: 'new-id', isExisting: false }),
          },
          ReactModule.createElement(Text, null, 'scan-new'),
        ),
      ),
  };
});

jest.mock('@/components2024/Card', () => {
  const ReactModule = require('react');
  const { Pressable } = require('react-native');
  return {
    Card: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) => ReactModule.createElement(Pressable, { onPress, testID }, children),
  };
});

jest.mock('@/components2024/ListItem/ListItem', () => {
  const ReactModule = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    ListItem: ({
      title,
      subText,
      onPress,
      testID,
    }: {
      title: string;
      subText?: string;
      onPress?: () => void;
      testID?: string;
    }) =>
      ReactModule.createElement(
        Pressable,
        { onPress, testID },
        ReactModule.createElement(Text, null, title),
        subText ? ReactModule.createElement(Text, null, subText) : null,
      ),
  };
});

jest.mock('@/components/Typography', () => ({
  Text: require('react-native').Text,
}));

jest.mock('@/components2024/WalletIcon/WalletIcon', () => ({
  WalletIcon: () => null,
}));
jest.mock('@/assets2024/icons/common/plus-cc.svg', () => () => null);
jest.mock('../customized/BottomSheet', () => {
  const ReactModule = require('react');
  const { Text } = require('react-native');
  return {
    AppBottomSheetModalTitle: ({ title }: { title: string }) =>
      ReactModule.createElement(Text, null, title),
  };
});
jest.mock('../AutoLockView', () => {
  const ReactModule = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});
jest.mock('@/components2024/Toast', () => ({
  toast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));
jest.mock('@/utils/navigation', () => ({
  navigateDeprecated: (...args: unknown[]) => mockNavigateDeprecated(...args),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values && 'fingerprint' in values ? `${key}:${values.fingerprint}` : key,
  }),
}));
jest.mock('@/hooks/theme', () => ({
  useTheme2024: () => ({
    styles: new Proxy({}, { get: () => ({}) }),
    colors2024: new Proxy({}, { get: () => '#000000' }),
  }),
}));

function createWallet(walletId: string, name: string, fingerprint: string) {
  return {
    walletId,
    name,
    alias: '',
    fingerprint,
    mode: 'hd' as const,
    hdPathType: 'BIP44' as any,
    accounts: [{ address: `0x${fingerprint}`, index: 1 }],
    isReady: true,
  };
}

describe('ConnectKeystone', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetWallets.mockResolvedValue([]);
    mockBeginPairing.mockResolvedValue({ pendingId: 'pending-1' });
    mockImportFirstAddress.mockResolvedValue('0xnew');
  });

  it('goes straight to the camera when no wallet is paired', async () => {
    const view = render(<ConnectKeystone />);

    await waitFor(() => {
      expect(view.getByTestId('camera-screen')).toBeTruthy();
    });
    expect(view.queryByTestId('keystone-wallet-select')).toBeNull();
  });

  it('lists paired wallets and opens the selected wallet', async () => {
    mockGetWallets.mockResolvedValue([
      createWallet('wallet-a', 'Keystone A', 'aabbccdd'),
      createWallet('wallet-b', 'Keystone B', '11223344'),
    ]);
    const onDone = jest.fn();
    const view = render(<ConnectKeystone onDone={onDone} />);

    await waitFor(() => {
      expect(view.getByText('Keystone A')).toBeTruthy();
    });
    expect(view.getByText('Keystone B')).toBeTruthy();
    expect(view.getByText(/fingerprint:3344/u)).toBeTruthy();

    fireEvent.press(view.getByTestId('keystone-wallet-wallet-b'));

    await waitFor(() => {
      expect(mockGoImport).toHaveBeenCalledWith('wallet-b');
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('opens the camera from the add-another row', async () => {
    mockGetWallets.mockResolvedValue([
      createWallet('wallet-a', 'Keystone A', 'aabbccdd'),
    ]);
    const view = render(<ConnectKeystone />);

    await waitFor(() => {
      expect(view.getByTestId('keystone-add-wallet')).toBeTruthy();
    });
    fireEvent.press(view.getByTestId('keystone-add-wallet'));

    await waitFor(() => {
      expect(view.getByTestId('camera-screen')).toBeTruthy();
    });
  });

  it('starts a pairing session when the camera screen continues', async () => {
    const view = render(<ConnectKeystone />);

    await waitFor(() => {
      expect(view.getByTestId('camera-screen')).toBeTruthy();
    });
    fireEvent.press(view.getByTestId('camera-screen'));

    await waitFor(() => {
      expect(view.getByText('scan-screen')).toBeTruthy();
    });
    expect(mockBeginPairing).toHaveBeenCalledTimes(1);
  });

  it('routes an already paired wallet to its import flow', async () => {
    const onDone = jest.fn();
    const view = render(<ConnectKeystone onDone={onDone} />);

    await waitFor(() => {
      expect(view.getByTestId('camera-screen')).toBeTruthy();
    });
    fireEvent.press(view.getByTestId('camera-screen'));
    await waitFor(() => {
      expect(view.getByTestId('scan-existing')).toBeTruthy();
    });
    fireEvent.press(view.getByTestId('scan-existing'));

    await waitFor(() => {
      expect(mockToastInfo).toHaveBeenCalled();
      expect(mockGoImport).toHaveBeenCalledWith('existing-id');
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('imports the first address of a new wallet and navigates to success', async () => {
    const onDone = jest.fn();
    const view = render(<ConnectKeystone onDone={onDone} />);

    await waitFor(() => {
      expect(view.getByTestId('camera-screen')).toBeTruthy();
    });
    fireEvent.press(view.getByTestId('camera-screen'));
    await waitFor(() => {
      expect(view.getByTestId('scan-new')).toBeTruthy();
    });
    fireEvent.press(view.getByTestId('scan-new'));

    await waitFor(() => {
      expect(mockImportFirstAddress).toHaveBeenCalledWith({}, 'new-id');
      expect(mockNavigateDeprecated).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          params: expect.objectContaining({
            address: '0xnew',
            keystoneWalletId: 'new-id',
            isFirstImport: true,
          }),
        }),
      );
    });
    expect(onDone).toHaveBeenCalled();
  });
});
