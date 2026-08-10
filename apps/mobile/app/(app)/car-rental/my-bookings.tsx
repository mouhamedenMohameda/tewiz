import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, RefreshControl, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  BOOKING_STATUS_KEYS, cancelBooking, listMyBookings, openDispute, rateBooking, returnBooking,
  type BookingStatus, type RenterBooking,
} from '@/lib/carRental';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, Icon, ScreenHeader } from '@/components/ui';
import { BookingActionModal, OtpDisplay, RatingModal } from '@/components/CarRentalModals';
import { colors, radius, schemed, spacing } from '@/theme';

// schemed(): a bare object literal here would freeze whichever
// palette was active when this module was first imported, and then
// never follow the user into dark mode.
const STATUS_COLOR = schemed(() => ({
  pending: colors.warning,
  confirmed: colors.success,
  declined: colors.danger,
  cancelled: colors.muted,
  in_progress: colors.ember,
  completed: colors.ink2,
  no_show: colors.danger,
  no_return: colors.danger,
  disputed: colors.warning,
}));

export default function MyBookingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [bookings, setBookings] = useState<RenterBooking[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [returnFor, setReturnFor] = useState<RenterBooking | null>(null);
  const [rateFor, setRateFor] = useState<RenterBooking | null>(null);

  const load = useCallback(async () => {
    try { setBookings(await listMyBookings()); } catch { setBookings([]); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  async function cancel(id: string) {
    try { await cancelBooking(id); void load(); } catch { Alert.alert(t('carRental.errTitle'), t('carRental.bookings.errCancel')); }
  }

  async function submitReturn(otp: string, photos: string[]) {
    if (!returnFor) return;
    setBusy(true);
    try {
      await returnBooking(returnFor.id, otp, photos);
      setReturnFor(null);
      Alert.alert(t('carRental.return.successTitle'), t('carRental.return.successBody'));
      await load();
    } catch (e: any) {
      Alert.alert(t('carRental.errTitle'), e?.response?.data?.error?.message ?? t('carRental.return.errInvalid'));
    } finally {
      setBusy(false);
    }
  }

  async function submitRating(stars: number, comment: string) {
    if (!rateFor) return;
    setBusy(true);
    try {
      await rateBooking(rateFor.id, stars, comment);
      setRateFor(null);
      await load();
    } catch (e: any) {
      Alert.alert(t('carRental.errTitle'), e?.response?.data?.error?.message ?? t('carRental.rate.errRate'));
    } finally {
      setBusy(false);
    }
  }

  function dispute(id: string) {
    Alert.alert(t('carRental.dispute.confirmTitle'), t('carRental.dispute.confirmBody'), [
      { text: t('carRental.otp.cancelBtn'), style: 'cancel' },
      {
        text: t('carRental.dispute.openBtn'), style: 'destructive',
        onPress: async () => {
          try { await openDispute(id, []); await load(); }
          catch (e: any) { Alert.alert(t('carRental.errTitle'), e?.response?.data?.error?.message ?? t('carRental.errTitle')); }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={t('carRental.bookings.title')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
      {bookings === null ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <AppText color={colors.muted} style={{ textAlign: 'center', marginTop: spacing.xl }}>
              {t('carRental.bookings.empty')}
            </AppText>
          }
          renderItem={({ item }) => (
            <Card padding={spacing.lg} style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <AppText variant="label" color={colors.ink} style={{ flex: 1 }}>{item.carTitle}</AppText>
                <View style={{ backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, borderWidth: 1, borderColor: STATUS_COLOR[item.status] }}>
                  <AppText variant="caption" color={STATUS_COLOR[item.status]}>{t(BOOKING_STATUS_KEYS[item.status])}</AppText>
                </View>
              </View>
              <AppText variant="caption" color={colors.muted}>
                {t('carRental.bookings.daysMeta', { start: item.startDate, end: item.endDate, days: item.days })}
                {item.withDriver ? t('carRental.mine.daysWithDriver') : ''}
              </AppText>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <AppText variant="caption" color={colors.ink2}>{item.city} · {item.ownerName}</AppText>
                  {item.counterpartRatingCount > 0 ? (
                    <>
                      <Icon name="star" size={12} color={colors.warning} />
                      <AppText variant="caption" color={colors.ink2}>{item.counterpartRatingAvg.toFixed(1)}</AppText>
                    </>
                  ) : null}
                </View>
                <AppText variant="label" color={colors.ember}>{formatMru(item.totalMru)}</AppText>
              </View>

              {item.depositMru > 0 && (item.status === 'confirmed' || item.status === 'in_progress') ? (
                <AppText variant="caption" color={colors.muted}>
                  {t('carRental.deposit.line', { amount: formatMru(item.depositMru) })}
                </AppText>
              ) : null}

              {/* Pickup code the renter reads to the owner at handover. */}
              {item.status === 'confirmed' && item.pickupOtp ? (
                <OtpDisplay
                  label={t('carRental.pickup.codeLabel')}
                  code={item.pickupOtp}
                  hint={t('carRental.pickup.codeHint')}
                />
              ) : null}

              {(item.status === 'confirmed' || item.status === 'in_progress') && item.ownerPhone ? (
                <Button title={t('carRental.bookings.callBtn', { phone: item.ownerPhone })} icon="phone" size="sm"
                  onPress={() => { void Linking.openURL(`tel:${item.ownerPhone}`); }} />
              ) : null}

              {item.status === 'in_progress' ? (
                <Button title={t('carRental.return.startBtn')} icon="check" size="sm" onPress={() => setReturnFor(item)} />
              ) : null}

              {item.status === 'completed' && !item.ratedByMe ? (
                <Button title={t('carRental.rate.rateOwnerBtn')} icon="star" size="sm" onPress={() => setRateFor(item)} />
              ) : null}

              {item.status === 'completed' && item.depositMru > 0 ? (
                <AppText variant="caption" color={item.depositReturned ? colors.success : colors.warning}>
                  {item.depositReturned ? t('carRental.deposit.returned') : t('carRental.deposit.pendingReturn')}
                </AppText>
              ) : null}

              {(item.status === 'pending' || item.status === 'confirmed') ? (
                <Button title={t('carRental.bookings.cancelBtn')} variant="secondary" size="sm" onPress={() => cancel(item.id)} />
              ) : null}
              {(item.status === 'in_progress' || item.status === 'completed') ? (
                <Button title={t('carRental.dispute.openBtn')} variant="ghost" size="sm" onPress={() => dispute(item.id)} />
              ) : null}
            </Card>
          )}
        />
      )}

      <BookingActionModal
        visible={returnFor !== null}
        title={t('carRental.return.title')}
        hint={t('carRental.return.hint')}
        requireOtp
        withPhotos
        submitLabel={t('carRental.return.confirmBtn')}
        busy={busy}
        onSubmit={submitReturn}
        onClose={() => setReturnFor(null)}
      />

      <RatingModal
        visible={rateFor !== null}
        name={rateFor?.ownerName ?? ''}
        busy={busy}
        onSubmit={submitRating}
        onClose={() => setRateFor(null)}
      />
    </SafeAreaView>
  );
}
