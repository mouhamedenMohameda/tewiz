import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Image, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  listIncomingBookings, listMyCars, respondBooking,
  type Car, type OwnerBooking,
} from '@/lib/carRental';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, Icon, ScreenHeader } from '@/components/ui';
import { colors, spacing } from '@/theme';

export default function MyCarsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [cars, setCars] = useState<Car[] | null>(null);
  const [requests, setRequests] = useState<OwnerBooking[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([listMyCars(), listIncomingBookings()]);
      setCars(c);
      setRequests(r);
    } catch {
      setCars([]);
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  async function respond(id: string, action: 'confirm' | 'decline') {
    setBusy(id);
    try {
      await respondBooking(id, action);
      await load();
    } catch (e: any) {
      Alert.alert(t('carRental.errTitle'), e?.response?.data?.error?.message ?? t('carRental.mine.errAction'));
    } finally {
      setBusy(null);
    }
  }

  const pending = requests.filter((r) => r.status === 'pending');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={t('carRental.mine.title')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
      {cars === null ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <Button title={t('carRental.mine.addBtn')} icon="send" onPress={() => router.push('/(app)/car-rental/add-car')} />

          {pending.length > 0 ? (
            <>
              <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.sm }}>
                {t('carRental.mine.pendingLabel', { count: pending.length })}
              </AppText>
              {pending.map((r) => (
                <Card key={r.id} padding={spacing.lg} style={{ gap: spacing.sm }}>
                  <AppText variant="label" color={colors.ink}>{r.carTitle}</AppText>
                  <AppText variant="caption" color={colors.muted}>
                    {t('carRental.mine.daysMeta', { start: r.startDate, end: r.endDate, days: r.days })}
                    {r.withDriver ? t('carRental.mine.daysWithDriver') : ''}
                  </AppText>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <AppText variant="caption" color={colors.ink2}>{r.renterName}</AppText>
                    <AppText variant="label" color={colors.ember}>{formatMru(r.totalMru)}</AppText>
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Button title={t('carRental.mine.confirmBtn')} size="sm" busy={busy === r.id} onPress={() => respond(r.id, 'confirm')} style={{ flex: 1 }} />
                    <Button title={t('carRental.mine.declineBtn')} size="sm" variant="secondary" onPress={() => respond(r.id, 'decline')} style={{ flex: 1 }} />
                  </View>
                </Card>
              ))}
            </>
          ) : null}

          <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.sm }}>
            {t('carRental.mine.sectionMine')}
          </AppText>
          {cars.length === 0 ? (
            <AppText color={colors.muted} style={{ textAlign: 'center', marginTop: spacing.md }}>
              {t('carRental.mine.emptyMine')}
            </AppText>
          ) : cars.map((c) => (
            <Card key={c.id} padding={0} style={{ overflow: 'hidden' }} onPress={() => router.push(`/(app)/car-rental/add-car?id=${c.id}`)}>
              <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
                {c.photos[0] ? (
                  <Image source={{ uri: c.photos[0] }} style={{ width: 90, height: 90 }} resizeMode="cover" />
                ) : (
                  <View style={{ width: 90, height: 90, backgroundColor: colors.sunken, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="car" size={28} color={colors.faint} />
                  </View>
                )}
                <View style={{ flex: 1, paddingVertical: spacing.md, paddingRight: spacing.md, gap: 2 }}>
                  <AppText variant="label" color={colors.ink}>{c.title}</AppText>
                  <AppText variant="caption" color={colors.muted}>{c.city} · {t('carRental.pricePerDay', { price: formatMru(c.pricePerDayMru) })}</AppText>
                  {c.status === 'paused' ? <AppText variant="caption" color={colors.warning}>{t('carRental.mine.pausedLabel')}</AppText> : null}
                </View>
                <Icon name="chevron" size={20} color={colors.faint} />
              </View>
            </Card>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
