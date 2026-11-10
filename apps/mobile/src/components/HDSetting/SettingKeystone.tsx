import { apiKeystone } from '@/core/apis';
import type { KeystoneWalletInfo } from '@/core/apis/keystone';
import { LedgerHDPathType } from '@rabby-wallet/eth-keyring-ledger/dist/utils';
import { KEYRING_TYPE } from '@rabby-wallet/keyring-utils';
import { BottomSheetTextInput, TouchableOpacity } from '@gorhom/bottom-sheet';
import { useAtom } from 'jotai';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import {
  isLoadedAtom,
  MainContainer,
  settingAtom,
  Props as MainContainerProps,
  MAX_ACCOUNT_COUNT,
} from './MainContainer';
import { AppColorsVariants } from '@/constant/theme';
import { useThemeColors } from '@/hooks/theme';
import RcIconArrowRight from '@/assets/icons/approval/edit-arrow-right.svg';
import DeleteSVG from '@/assets2024/icons/common/delete-cc.svg';
import PlusSVG from '@/assets2024/icons/common/plus-cc.svg';
import { Button } from '@/components';
import { TrackedModal } from '@/components/Modal/TrackedModal';
import { Text } from '@/components/Typography';
import { WalletIcon } from '@/components2024/WalletIcon/WalletIcon';
import { toast } from '@/components2024/Toast';
import { MODAL_GATE_IDS } from '@/utils/modalGate';

const getStyles = (colors: AppColorsVariants) =>
  StyleSheet.create({
    walletCard: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      backgroundColor: colors['neutral-card-2'],
      borderRadius: 16,
      marginBottom: 12,
      gap: 12,
    },
    walletInfo: {
      flex: 1,
      rowGap: 4,
    },
    walletName: {
      fontSize: 17,
      color: colors['neutral-title-1'],
      fontWeight: '700',
    },
    walletMeta: {
      fontSize: 14,
      color: colors['neutral-foot'],
    },
    renameButton: {
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    renameText: {
      fontSize: 14,
      color: colors['blue-default'],
      fontWeight: '500',
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      backgroundColor: colors['neutral-card-2'],
      borderRadius: 16,
      marginBottom: 12,
      justifyContent: 'space-between',
    },
    actionButtonMain: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: 8,
    },
    actionButtonText: {
      fontSize: 14,
      color: colors['neutral-title-1'],
      fontWeight: '500',
    },
    dangerText: {
      color: colors['red-default'],
    },
    modalMask: {
      backgroundColor: 'rgba(0,0,0,0.4)',
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    modal: {
      marginHorizontal: 20,
      maxWidth: 353,
      width: '100%',
      backgroundColor: colors['neutral-bg-1'],
      borderRadius: 16,
      position: 'relative',
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: '500',
      color: colors['neutral-title-1'],
      padding: 20,
    },
    modalDescText: {
      fontSize: 14,
      color: colors['neutral-body'],
      lineHeight: 20,
    },
    modalDesc: {
      marginBottom: 40,
      marginTop: -4,
      paddingHorizontal: 20,
    },
    renameInputWrap: {
      paddingHorizontal: 20,
      marginTop: -4,
      marginBottom: 24,
    },
    renameInput: {
      borderRadius: 12,
      padding: 16,
      fontSize: 16,
      backgroundColor: colors['neutral-card-2'],
      color: colors['neutral-title-1'],
    },
    modalFooter: {
      borderTopColor: colors['neutral-line'],
      borderTopWidth: 0.5,
      padding: 20,
      flexDirection: 'row',
      columnGap: 13,
      justifyContent: 'space-between',
    },
    closeButton: {
      width: 150,
      backgroundColor: 'transparent',
      borderColor: colors['blue-default'],
      borderWidth: 1,
      height: 48,
      borderRadius: 8,
    },
    closeButtonText: {
      color: colors['blue-default'],
    },
    confirmButton: {
      width: 150,
      height: 48,
      borderRadius: 8,
    },
  });

export const SettingKeystone: React.FC<{
  onDone: () => void;
  brand: string;
  keystoneKeyringId?: string;
  onAddAnother?: () => void;
  onRemoved?: () => void;
}> = ({ onDone, brand, keystoneKeyringId, onAddAnother, onRemoved }) => {
  const { t } = useTranslation();
  const [, setLoading] = React.useState(false);
  const [hdPathOptions, setHdPathOptions] = React.useState<
    MainContainerProps['hdPathOptions']
  >([]);
  const [disableStartFrom, setDisableStartFrom] = React.useState(false);
  const [wallet, setWallet] = React.useState<KeystoneWalletInfo>();
  const [renameVisible, setRenameVisible] = React.useState(false);
  const [removeVisible, setRemoveVisible] = React.useState(false);
  const [aliasInput, setAliasInput] = React.useState('');
  const [renaming, setRenaming] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  React.useEffect(() => {
    const getHdPathOptions = async () => {
      const hdPathType = await apiKeystone.getCurrentUsedHDPathType(
        keystoneKeyringId,
      );

      if (hdPathType === LedgerHDPathType.BIP44) {
        return [
          {
            title: 'BIP44',
            description: t('page.newAddress.hd.keystone.hdPathType.bip44'),
            noChainDescription: t(
              'page.newAddress.hd.keystone.hdPathTypeNoChain.bip44',
            ),
            value: LedgerHDPathType.BIP44,
          },
        ];
      } else if (hdPathType === LedgerHDPathType.LedgerLive) {
        return [
          {
            title: 'Ledger Live',
            description: t('page.newAddress.hd.keystone.hdPathType.ledgerLive'),
            noChainDescription: t(
              'page.newAddress.hd.keystone.hdPathTypeNoChain.ledgerLive',
            ),
            value: LedgerHDPathType.LedgerLive,
          },
        ];
      } else {
        return [
          {
            title: 'Legacy',
            description: t('page.newAddress.hd.keystone.hdPathType.legacy'),
            noChainDescription: t(
              'page.newAddress.hd.keystone.hdPathTypeNoChain.legacy',
            ),
            value: LedgerHDPathType.Legacy,
          },
        ];
      }
    };

    getHdPathOptions().then(setHdPathOptions);

    apiKeystone.getMaxAccountLimit(keystoneKeyringId).then(limit => {
      setDisableStartFrom((limit ?? MAX_ACCOUNT_COUNT) < MAX_ACCOUNT_COUNT);
    });
  }, [t, keystoneKeyringId]);

  const reloadWallet = React.useCallback(async () => {
    try {
      const info = await apiKeystone.getWallet(keystoneKeyringId);
      setWallet(info);
    } catch (error) {
      console.error('Failed to load Keystone wallet details', error);
    }
  }, [keystoneKeyringId]);

  React.useEffect(() => {
    reloadWallet();
  }, [reloadWallet]);

  const colors = useThemeColors();
  const styles = React.useMemo(() => getStyles(colors), [colors]);
  const [setting, setSetting] = useAtom(settingAtom);
  const [isLoaded, setIsLoaded] = useAtom(isLoadedAtom);

  const handleConfirm = React.useCallback(
    value => {
      setSetting(value);
      onDone?.();
    },
    [onDone, setSetting],
  );

  React.useEffect(() => {
    setLoading(false);

    if (isLoaded) {
      return;
    }

    setIsLoaded(true);
  }, [isLoaded, setIsLoaded, setSetting]);

  const handleOpenRename = React.useCallback(() => {
    setAliasInput(wallet?.alias || '');
    setRenameVisible(true);
  }, [wallet?.alias]);

  const handleRenameClose = React.useCallback(() => {
    setRenameVisible(false);
  }, []);

  const handleRenameConfirm = React.useCallback(async () => {
    if (renaming) {
      return;
    }
    setRenaming(true);
    try {
      const name = await apiKeystone.renameWallet(
        keystoneKeyringId,
        aliasInput,
      );
      setWallet(prev =>
        prev
          ? {
              ...prev,
              alias: aliasInput.trim(),
              name,
            }
          : prev,
      );
      setRenameVisible(false);
      toast.info(t('page.newAddress.keystone.settings.renamed'));
    } catch (error: any) {
      toast.error(
        error?.message || t('page.newAddress.keystone.settings.renameFailed'),
      );
    } finally {
      setRenaming(false);
    }
  }, [aliasInput, keystoneKeyringId, renaming, t]);

  const handleAddAnother = React.useCallback(() => {
    onDone?.();
    onAddAnother?.();
  }, [onAddAnother, onDone]);

  const handleOpenRemove = React.useCallback(() => {
    setRemoveVisible(true);
  }, []);

  const handleRemoveClose = React.useCallback(() => {
    setRemoveVisible(false);
  }, []);

  const handleRemoveConfirm = React.useCallback(async () => {
    if (removing) {
      return;
    }
    setRemoving(true);
    try {
      await apiKeystone.removeAddressAndForgetDevice(keystoneKeyringId);
      setRemoveVisible(false);
      onDone?.();
      onRemoved?.();
    } catch (error: any) {
      toast.error(
        error?.message || t('page.newAddress.keystone.settings.removeFailed'),
      );
    } finally {
      setRemoving(false);
    }
  }, [keystoneKeyringId, onDone, onRemoved, removing, t]);

  const walletMeta = React.useMemo(() => {
    if (!wallet) {
      return '';
    }
    const fingerprint = wallet.fingerprint
      ? t('page.newAddress.keystone.select.fingerprint', {
          fingerprint: wallet.fingerprint.toUpperCase(),
        })
      : '';
    const addressCount = t('page.newAddress.keystone.select.addressCount', {
      count: wallet.accounts.length,
    });
    return [fingerprint, addressCount].filter(Boolean).join(' · ');
  }, [t, wallet]);

  return (
    <MainContainer
      hdPathOptions={hdPathOptions}
      disableHdPathOptions
      disableStartFrom={disableStartFrom}
      onConfirm={handleConfirm}
      setting={setting}>
      {wallet ? (
        <View style={styles.walletCard}>
          <WalletIcon
            type={KEYRING_TYPE.KeystoneKeyring}
            width={40}
            height={40}
            borderRadius={20}
          />
          <View style={styles.walletInfo}>
            <Text style={styles.walletName} numberOfLines={1}>
              {wallet.name || brand}
            </Text>
            {walletMeta ? (
              <Text style={styles.walletMeta} numberOfLines={1}>
                {walletMeta}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={handleOpenRename}
            style={styles.renameButton}>
            <Text style={styles.renameText}>
              {t('page.newAddress.keystone.settings.rename')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <TouchableOpacity onPress={handleAddAnother} style={styles.actionButton}>
        <View style={styles.actionButtonMain}>
          <PlusSVG width={20} height={20} color={colors['neutral-foot']} />
          <Text style={styles.actionButtonText}>
            {t('page.newAddress.keystone.settings.addAnother')}
          </Text>
        </View>
        <RcIconArrowRight />
      </TouchableOpacity>
      <TouchableOpacity onPress={handleOpenRemove} style={styles.actionButton}>
        <View style={styles.actionButtonMain}>
          <DeleteSVG width={20} height={20} color={colors['red-default']} />
          <Text
            style={StyleSheet.flatten([
              styles.actionButtonText,
              styles.dangerText,
            ])}>
            {t('page.newAddress.keystone.settings.remove')}
          </Text>
        </View>
        <RcIconArrowRight />
      </TouchableOpacity>
      <TrackedModal
        modalId={MODAL_GATE_IDS.hdKeystoneRenameWallet}
        visible={renameVisible}
        transparent
        animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalMask}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {t('page.newAddress.keystone.settings.renameTitle')}
            </Text>
            <View style={styles.renameInputWrap}>
              <BottomSheetTextInput
                autoFocus
                style={styles.renameInput}
                value={aliasInput}
                onChangeText={setAliasInput}
                placeholder={t(
                  'page.newAddress.keystone.settings.renamePlaceholder',
                )}
                placeholderTextColor={colors['neutral-foot']}
                maxLength={32}
                returnKeyType="done"
                onSubmitEditing={handleRenameConfirm}
              />
            </View>
            <View style={styles.modalFooter}>
              <Button
                type="clear"
                buttonStyle={styles.closeButton}
                titleStyle={styles.closeButtonText}
                onPress={handleRenameClose}
                title={t('global.Cancel')}
              />
              <Button
                buttonStyle={styles.confirmButton}
                loading={renaming}
                disabled={renaming}
                onPress={handleRenameConfirm}
                title={t('global.Confirm')}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </TrackedModal>
      <TrackedModal
        modalId={MODAL_GATE_IDS.hdKeystoneRemoveWallet}
        visible={removeVisible}
        transparent
        animationType="fade">
        <View style={styles.modalMask}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {t('page.newAddress.keystone.settings.removeTitle')}
            </Text>
            <View style={styles.modalDesc}>
              <Text style={styles.modalDescText}>
                {t('page.newAddress.keystone.settings.removeContent')}
              </Text>
            </View>
            <View style={styles.modalFooter}>
              <Button
                type="clear"
                buttonStyle={styles.closeButton}
                titleStyle={styles.closeButtonText}
                onPress={handleRemoveClose}
                title={t('global.Cancel')}
              />
              <Button
                buttonStyle={styles.confirmButton}
                loading={removing}
                disabled={removing}
                onPress={handleRemoveConfirm}
                title={t('global.Confirm')}
              />
            </View>
          </View>
        </View>
      </TrackedModal>
    </MainContainer>
  );
};
