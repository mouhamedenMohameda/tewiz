/**
 * Shown by the service screens (car rental, convoyage, light moving, private
 * driver, roadside assistance, equipment rental, intercity freight) when their
 * tariff quote can't be fetched.
 *
 * These screens all used to `.catch(() => Alert.alert(t('errors.generic')))`
 * on the quote request and then fall through to `if (!quote) return
 * <ActivityIndicator />`. So on a failure the user dismissed an alert and was
 * left facing a spinner that would never stop — the screen looked like it was
 * still working when it had already given up. This is the honest version of
 * that state: it says what happened and offers the way out.
 */

import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText, Button, Icon, Screen } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

export function QuoteUnavailable() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
        <View style={{
          width: 64, height: 64, borderRadius: radius.lg, marginBottom: spacing.sm,
          backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="alert" size={32} color={colors.danger} />
        </View>
        <AppText variant="h2" align="center">{t('common.impossible')}</AppText>
        <AppText variant="body" color={colors.ink2} align="center">
          {t('errors.generic')}
        </AppText>
        <Button
          title={t('common.back')}
          variant="secondary"
          icon="chevronBack"
          fullWidth={false}
          style={{ marginTop: spacing.lg }}
          onPress={() => router.back()}
        />
      </View>
    </Screen>
  );
}

export default QuoteUnavailable;
