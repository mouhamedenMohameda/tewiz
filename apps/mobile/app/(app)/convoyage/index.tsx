import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, RefreshControl, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { JOB_STATUS_LABEL, listMyJobs, type ConvoyageJob, type JobStatus } from '@/lib/convoyage';
import { AppText, Button, Card, Icon, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

const STATUS_COLOR: Record<JobStatus, string> = {
  open: colors.warning,
  assigned: colors.success,
  completed: colors.ink2,
  cancelled: colors.muted,
  expired: colors.muted,
};

export default function ConvoyageScreen() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ConvoyageJob[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setJobs(await listMyJobs()); } catch { setJobs([]); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title="Convoyage" onBack={() => router.back()} />
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm }}>
        <Button title="Nouvelle demande" icon="send" onPress={() => router.push('/(app)/convoyage/new-job')} />
        <Button title="Je suis convoyeur" variant="secondary" size="sm" icon="ride"
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
              Aucune demande de convoyage.
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
                  <AppText variant="caption" color={STATUS_COLOR[item.status]}>{JOB_STATUS_LABEL[item.status]}</AppText>
                </View>
              </View>
              <AppText variant="caption" color={colors.muted}>
                {item.vehicleModel ? `${item.vehicleModel} · ` : ''}{item.vehiclePlate}{item.desiredDate ? ` · ${item.desiredDate}` : ''}
              </AppText>

              {item.status === 'open' ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <AppText variant="caption" color={colors.ember}>
                    {item.proposalCount} proposition{item.proposalCount > 1 ? 's' : ''}
                  </AppText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <AppText variant="caption" color={colors.ember}>Voir & choisir</AppText>
                    <Icon name="chevron" size={16} color={colors.ember} />
                  </View>
                </View>
              ) : item.provider ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <AppText variant="caption" color={colors.ink2}>
                    {item.provider.name}{item.provider.ratingAvg != null ? ` ⭐ ${item.provider.ratingAvg.toFixed(1)}` : ''}
                  </AppText>
                  <Button title="Appeler" icon="phone" size="sm"
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
