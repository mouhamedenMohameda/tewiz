import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, RefreshControl, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  FREIGHT_STATUS_KEYS, cancelBooking, listMyBookings, type FreightBookingStatus, type ShipperBooking,
} from '@/lib/freight';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

const STATUS_COLOR: Record<FreightBookingStatus, string> = {
  pending: colors.warning, confirmed: colors.success, declined: colors.danger,
  cancelled: colors.muted, completed: colors.ink2,
};

export default function MyShipmentsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [bookings, setBookings] = useState<ShipperBooking[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setBookings(await listMyBookings()); } catch { setBookings([]); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }
  async function cancel(id: string) {
    try { await cancelBooking(id); void load(); } catch { Alert.alert(t('freight.errTitle'), t('freight.shipments.errCancel')); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={t('freight.shipments.title')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
      {bookings === null ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <AppText color={colors.muted} style={{ textAlign: 'center', marginTop: spacing.xl }}>{t('freight.shipments.empty')}</AppText>
          }
          renderItem={({ item }) => (
            <Card padding={spacing.lg} style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <AppText variant="label" color={colors.ink} style={{ flex: 1 }}>{item.originCity} → {item.destinationCity}</AppText>
                <View style={{ borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, borderWidth: 1, borderColor: STATUS_COLOR[item.status] }}>
                  <AppText variant="caption" color={STATUS_COLOR[item.status]}>{t(FREIGHT_STATUS_KEYS[item.status])}</AppText>
                </View>
              </View>
              <AppText variant="caption" color={colors.muted}>{t('freight.shipments.cardMeta', { cargo: item.cargoDescription, weight: item.weightKg, date: item.departureDate })}</AppText>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <AppText variant="caption" color={colors.ink2}>{item.carrierName}</AppText>
                <AppText variant="label" color={colors.ember}>{formatMru(item.totalMru)}</AppText>
              </View>
              {item.status === 'confirmed' && item.carrierPhone ? (
                <Button title={t('freight.shipments.callBtn', { phone: item.carrierPhone })} icon="phone" size="sm"
                  onPress={() => { void Linking.openURL(`tel:${item.carrierPhone}`); }} />
              ) : null}
              {item.status === 'pending' || item.status === 'confirmed' ? (
                <Button title={t('freight.shipments.cancelBtn')} variant="secondary" size="sm" onPress={() => cancel(item.id)} />
              ) : null}
            </Card>
          )}
        />
      )}
    </SafeAreaView>
  );
}
