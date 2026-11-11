import { RootNames } from '@/constant/layout';
import { apiKeystone } from '@/core/apis';
import type { KeystoneWalletInfo } from '@/core/apis/keystone';
import { navigateDeprecated } from '@/utils/navigation';
import {
  HARDWARE_KEYRING_TYPES,
  KEYRING_TYPE,
} from '@rabby-wallet/keyring-utils';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { CameraPermissionScreen } from './CameraPermissionScreen';
import { ScanDeviceScreen } from './ScanDeviceScreen';
import { useImportKeystone } from './useImportKeystone';
import AutoLockView from '../AutoLockView';
import { AppBottomSheetModalTitle } from '../customized/BottomSheet';
import { Text } from '@/components/Typography';
import { Card } from '@/components2024/Card';
import { ListItem } from '@/components2024/ListItem/ListItem';
import { WalletIcon } from '@/components2024/WalletIcon/WalletIcon';
import { toast } from '@/components2024/Toast';
import PlusSVG from '@/assets2024/icons/common/plus-cc.svg';
import { useTheme2024 } from '@/hooks/theme';
import { createGetStyles2024 } from '@/utils/styles';

type ConnectScreen = 'select' | 'camera' | 'scan';

const getStyle = createGetStyles2024(({ colors2024 }) => ({
  root: {
    height: '100%',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    color: colors2024['neutral-title-1'],
    fontFamily: 'SF Pro Rounded',
  },
  description: {
    marginTop: 8,
    marginBottom: 16,
    fontSize: 15,
    lineHeight: 20,
    color: colors2024['neutral-secondary'],
    fontFamily: 'SF Pro Rounded',
  },
  list: {
    flexGrow: 0,
    flexShrink: 1,
  },
  listCard: {
    padding: 0,
    paddingVertical: 4,
  },
  walletItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 68,
    backgroundColor: colors2024['neutral-line'],
  },
  addCard: {
    marginTop: 16,
    marginBottom: 24,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  addMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addText: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    color: colors2024['neutral-title-1'],
    fontFamily: 'SF Pro Rounded',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));

function shortFingerprint(wallet: KeystoneWalletInfo) {
  const fingerprint = (wallet.fingerprint || '').toUpperCase();
  return fingerprint.length > 4
    ? fingerprint.slice(fingerprint.length - 4)
    : fingerprint;
}

export const ConnectKeystone: React.FC<{
  onDone?: () => void;
}> = ({ onDone }) => {
  const { t } = useTranslation();
  const { styles, colors2024 } = useTheme2024({ getStyle });
  const goImport = useImportKeystone();

  const [screen, setScreen] = React.useState<ConnectScreen>('select');
  const [wallets, setWallets] = React.useState<KeystoneWalletInfo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [pendingId, setPendingId] = React.useState<string | undefined>(
    undefined,
  );
  const pendingIdRef = React.useRef<string | undefined>(undefined);

  const setPending = React.useCallback((id?: string) => {
    pendingIdRef.current = id;
    setPendingId(id);
  }, []);

  React.useEffect(() => {
    let alive = true;

    apiKeystone
      .getWallets()
      .then(list => {
        if (!alive) {
          return;
        }
        setWallets(list);
        setScreen(list.length ? 'select' : 'camera');
      })
      .catch(error => {
        console.error('Failed to load Keystone wallets', error);
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    return () => {
      const id = pendingIdRef.current;
      if (id) {
        apiKeystone.cancelPairing(id).catch(() => undefined);
      }
    };
  }, []);

  const startScan = React.useCallback(async () => {
    try {
      const { pendingId: id } = await apiKeystone.beginPairing();
      setPending(id);
      setScreen('scan');
    } catch (error) {
      console.error('Failed to start Keystone pairing', error);
      toast.error(t('page.newAddress.keystone.select.pairingFailed'));
    }
  }, [setPending, t]);

  const openWallet = React.useCallback(
    async (walletId: string) => {
      await goImport(walletId);
      onDone?.();
    },
    [goImport, onDone],
  );

  const handleScanFinish = React.useCallback(
    async (result: { walletId: string; isExisting: boolean }) => {
      setPending(undefined);

      if (result.isExisting) {
        toast.info(t('page.newAddress.keystone.select.alreadyAdded'));
        await openWallet(result.walletId);
        return;
      }

      const address = await apiKeystone.importFirstAddress({}, result.walletId);

      if (address) {
        navigateDeprecated(RootNames.StackAddress, {
          screen: RootNames.ImportSuccess2024,
          params: {
            type: HARDWARE_KEYRING_TYPES.Keystone.type as KEYRING_TYPE,
            brandName: HARDWARE_KEYRING_TYPES.Keystone.brandName,
            address,
            isFirstImport: true,
            keystoneWalletId: result.walletId,
          },
        });
        onDone?.();
      } else {
        await openWallet(result.walletId);
      }
    },
    [onDone, openWallet, setPending, t],
  );

  const walletSubText = React.useCallback(
    (wallet: KeystoneWalletInfo) => {
      const fingerprint = shortFingerprint(wallet);
      const fingerprintLabel = fingerprint
        ? t('page.newAddress.keystone.select.fingerprint', { fingerprint })
        : '';
      const addressCount = t('page.newAddress.keystone.select.addressCount', {
        count: wallet.accounts.length,
      });

      return [fingerprintLabel, addressCount].filter(Boolean).join(' · ');
    },
    [t],
  );

  const renderSelect = () => {
    if (loading) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator color={colors2024['brand-default']} />
        </View>
      );
    }

    return (
      <View style={styles.root} testID="keystone-wallet-select">
        <AppBottomSheetModalTitle
          title={t('page.newAddress.keystone.select.title')}
          style={styles.title}
        />
        <Text style={styles.description}>
          {t('page.newAddress.keystone.select.description')}
        </Text>
        <ScrollView style={styles.list}>
          <Card style={styles.listCard}>
            {wallets.map((wallet, index) => (
              <React.Fragment key={wallet.walletId}>
                {index > 0 ? <View style={styles.separator} /> : null}
                <ListItem
                  style={styles.walletItem}
                  testID={`keystone-wallet-${wallet.walletId}`}
                  Icon={
                    <WalletIcon
                      type={KEYRING_TYPE.KeystoneKeyring}
                      width={40}
                      height={40}
                      borderRadius={20}
                    />
                  }
                  title={wallet.name}
                  subText={walletSubText(wallet)}
                  onPress={() => {
                    openWallet(wallet.walletId).catch(console.error);
                  }}
                />
              </React.Fragment>
            ))}
          </Card>
        </ScrollView>
        <Card
          style={styles.addCard}
          testID="keystone-add-wallet"
          onPress={() => setScreen('camera')}>
          <View style={styles.addMain}>
            <PlusSVG
              width={20}
              height={20}
              color={colors2024['neutral-secondary']}
            />
            <Text style={styles.addText}>
              {t('page.newAddress.keystone.select.addAnother')}
            </Text>
          </View>
        </Card>
      </View>
    );
  };

  return (
    <AutoLockView as="View" style={{ height: '100%' }}>
      {screen === 'select' ? renderSelect() : null}
      {screen === 'camera' ? (
        <CameraPermissionScreen
          onNext={() => {
            startScan().catch(console.error);
          }}
        />
      ) : null}
      {screen === 'scan' && pendingId ? (
        <ScanDeviceScreen
          pendingId={pendingId}
          onScanFinish={handleScanFinish}
        />
      ) : null}
    </AutoLockView>
  );
};
