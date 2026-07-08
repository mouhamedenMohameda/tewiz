import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  listIncomingBookings, listMyTrips, respondBooking, type CarrierBooking, type FreightTrip,
} from '@/lib/freight';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, Icon, ScreenHeader } from '@/components/ui';
import { colors, spacing } from '@/theme';

export default function MyTripsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [trips, setTrips] = useState<FreightTrip[] | null>(null);
  const [requests, setRequests] = useState<CarrierBooking[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [tr, r] = await Promise.all([listMyTrips(), listIncomingBookings()]);
      setTrips(tr);
      setRequests(r);
    } catch { setTrips([]); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }
  async function respond(id: string, action: 'confirm' | 'decline') {
    setBusy(id);
    try { await respondBooking(id, action); await load(); }
    catch (e: any) { Alert.alert(t('freight.errTitle'), e?.response?.data?.error?.message ?? t('freight.mine.errAction')); }
    finally { setBusy(null); }
  }

  const pending = requests.filter((r) => r.status === 'pending');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={t('freight.mine.title')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
      {trips === null ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          <Button title={t('freight.mine.publishBtn')} icon="send" onPress={() => router.push('/(app)/freight/add-trip')} />

          {pending.length > 0 ? (
            <>
              <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.sm }}>{t('freight.mine.pendingLabel', { count: pending.length })}</AppText>
              {pending.map((r) => (
                <Card key={r.id} padding={spacing.lg} style={{ gap: spacing.sm }}>
                  <AppText variant="label" color={colors.ink}>{r.originCity} → {r.destinationCity}</AppText>
                  <AppText variant="caption" color={colors.muted}>{r.cargoDescription} · {r.weightKg} kg</AppText>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <AppText variant="caption" color={colors.ink2}>{r.shipperName}</AppText>
                    <AppText variant="label" color={colors.ember}>{formatMru(r.totalMru)}</AppText>
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Button title={t('freight.mine.confirmBtn')} size="sm" busy={busy === r.id} onPress={() => respond(r.id, 'confirm')} style={{ flex: 1 }} />
                    <Button title={t('freight.mine.declineBtn')} size="sm" variant="secondary" onPress={() => respond(r.id, 'decline')} style={{ flex: 1 }} />
                  </View>
                </Card>
              ))}
            </>
          ) : null}

          <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.sm }}>{t('freight.mine.sectionMine')}</AppText>
          {trips.length === 0 ? (
            <AppText color={colors.muted} style={{ textAlign: 'center', marginTop: spacing.md }}>{t('freight.mine.emptyMine')}</AppText>
          ) : trips.map((tr) => (
            <Card key={tr.id} padding={spacing.lg} style={{ gap: 2 }} onPress={() => router.push(`/(app)/freight/add-trip?id=${tr.id}`)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <AppText variant="label" color={colors.ink} style={{ flex: 1 }}>{tr.originCity} → {tr.destinationCity}</AppText>
                <Icon name="chevron" size={20} color={colors.faint} />
              </View>
              <AppText variant="caption" color={colors.muted}>
                {t('freight.mine.cardSummary', { date: tr.departureDate, remaining: tr.remainingKg, capacity: tr.capacityKg, price: formatMru(tr.pricePerKgMru) })}
                {tr.status === 'paused' ? t('freight.mine.pausedSuffix') : ''}
              </AppText>
            </Card>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
