/**
 * Account screen — profile summary, sign-out, and in-app account deletion.
 *
 * Account deletion is mandatory for the stores (App Store guideline 5.1.1(v)
 * and Google Play's account-deletion policy). It is a SOFT delete server-side
 * (DELETE /auth/me): personal data is stripped and access is revoked, while the
 * wallet/ride ledger is preserved for accounting. We double-confirm before
 * firing because it is irreversible from the user's side.
 */

import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AppText, Button, Icon, Screen, ScreenHeader } from '@/components/ui';
import { colors, radius, shadow, spacing } from '@/theme';
import { APP_NAME } from '@/lib/brand';

export default function AccountScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);
  const [busy, setBusy] = useState(false);

  async function logout() {
    await clear();
    router.replace('/(auth)');
  }

  async function reallyDelete() {
    setBusy(true);
    try {
      await api.delete('/auth/me');
      await clear();
      router.replace('/(auth)');
    } catch (e: any) {
      setBusy(false);
      const msg = e?.response?.data?.error?.message ?? t('account.deleteError');
      Alert.alert(t('common.error'), msg);
    }
  }

  function confirmDelete() {
    Alert.alert(
      t('account.confirm1Title'),
      t('account.confirm1Body', { app: APP_NAME }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () =>
            // Second confirmation — deletion is irreversible.
            Alert.alert(
              t('account.confirm2Title'),
              t('account.confirm2Body'),
              [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('account.confirm2Action'), style: 'destructive', onPress: reallyDelete },
              ],
            ),
        },
      ],
    );
  }

  const roleLabel = user ? t(`roles.${user.role}` as const) : '';

  return (
    <Screen>
      <ScreenHeader title={t('account.title')} onBack={() => router.back()} />

      {/* Profile summary */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          padding: spacing.lg,
          ...shadow.card,
        }}
      >
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: radius.md,
            backgroundColor: colors.emberSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="person" size={30} color={colors.ember} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="title" numberOfLines={1}>
            {user?.fullName ?? user?.phone ?? t('account.guestName')}
          </AppText>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
            {[roleLabel, user?.phone].filter(Boolean).join(' · ')}
          </AppText>
        </View>
      </View>

      {/* Actions */}
      <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
        <Button title={t('account.logout')} variant="secondary" icon="logout" onPress={logout} />
        <Button
          title={t('account.delete')}
          variant="danger"
          icon="trash"
          busy={busy}
          onPress={confirmDelete}
        />
      </View>

      <AppText
        variant="caption"
        color={colors.muted}
        style={{ marginTop: spacing.lg, lineHeight: 18 }}
      >
        {t('account.deleteHint')}
      </AppText>
    </Screen>
  );
}
