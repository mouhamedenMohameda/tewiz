import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, RefreshControl, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { JOB_STATUS_KEYS, listMyJobs, type ConvoyageJob, type JobStatus } from '@/lib/convoyage';
import { AppText, Button, Card, Icon, ScreenHeader } from '@/components/ui';
import { colors, radius, schemed, spacing } from '@/theme';
import { useThemeRepaint } from '@/theme/ThemeProvider';

// schemed(): a bare object literal here would freeze whichever
// palette was active when this module was first imported, and then
// never follow the user into dark mode.
const STATUS_COLOR = schemed(() => ({
  open: colors.warning,
  assigned: colors.success,
  completed: colors.ink2,
  cancelled: colors.muted,
  expired: colors.muted,
}));

export default function ConvoyageScreen() {
  useThemeRepaint();
  const router = useRouter();
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<ConvoyageJob[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setJobs(await listMyJobs()); } catch { setJobs([]); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={t('convoyage.title')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm }}>
        <Button title={t('convoyage.newRequest')} icon="send" onPress={() => router.push('/(app)/convoyage/new-job')} />
        <Button title={t('convoyage.iAmConvoyeur')} variant="secondary" size="sm" icon="ride"
          onPress={() => router.push('/(app)/convoyage/convoyeur')} />
      </View>

      {jobs === null ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(j) => j.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <AppText color={colors.muted} style={{ textAlign: 'center', marginTop: spacing.xl }}>
              {t('convoyage.emptyList')}
            </AppText>
          }
          renderItem={({ item }) => (
            <Card padding={spacing.lg} style={{ gap: spacing.sm }}
              onPress={item.status === 'open' ? () => router.push(`/(app)/convoyage/${item.id}`) : undefined}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <AppText variant="label" color={colors.ink} style={{ flex: 1 }}>
                  {item.pickupLabel} → {item.dropoffLabel}
                </AppText>
                <View style={{ borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, borderWidth: 1, borderColor: STATUS_COLOR[item.status] }}>
                  <AppText variant="caption" color={STATUS_COLOR[item.status]}>{t(JOB_STATUS_KEYS[item.status])}</AppText>
                </View>
              </View>
              <AppText variant="caption" color={colors.muted}>
                {item.vehicleModel ? `${item.vehicleModel} · ` : ''}{item.vehiclePlate}{item.desiredDate ? ` · ${item.desiredDate}` : ''}
              </AppText>

              {item.status === 'open' ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <AppText variant="caption" color={colors.ember}>
                    {item.proposalCount > 1
                      ? t('convoyage.proposalsMany', { count: item.proposalCount })
                      : t('convoyage.proposalsOne', { count: item.proposalCount })}
                  </AppText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <AppText variant="caption" color={colors.ember}>{t('convoyage.seeChoose')}</AppText>
                    <Icon name="chevron" size={16} color={colors.ember} />
                  </View>
                </View>
              ) : item.provider ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <AppText variant="caption" color={colors.ink2}>
                    {item.provider.name}{item.provider.ratingAvg != null ? ` ⭐ ${item.provider.ratingAvg.toFixed(1)}` : ''}
                  </AppText>
                  <Button title={t('convoyage.callBtn')} icon="phone" size="sm"
                    onPress={() => { void Linking.openURL(`tel:${item.provider!.phone}`); }} />
                </View>
              ) : null}
            </Card>
          )}
        />
      )}
    </SafeAreaView>
  );
}
