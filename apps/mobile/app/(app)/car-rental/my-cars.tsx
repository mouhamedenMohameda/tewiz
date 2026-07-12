import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  BOOKING_STATUS_KEYS, confirmReturn, listIncomingBookings, listMyCars,
  markNoReturn, markNoShow, openDispute, pickupBooking, rateBooking, respondBooking,
  type BookingStatus, type Car, type OwnerBooking,
} from '@/lib/carRental';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, Icon, ScreenHeader } from '@/components/ui';
import { BookingActionModal, OtpDisplay, RatingModal } from '@/components/CarRentalModals';
import { colors, radius, spacing } from '@/theme';

const STATUS_COLOR: Record<BookingStatus, string> = {
  pending: colors.warning,
  confirmed: colors.success,
  declined: colors.danger,
  cancelled: colors.muted,
  in_progress: colors.ember,
  completed: colors.ink2,
  no_show: colors.danger,
  no_return: colors.danger,
  disputed: colors.warning,
};

// Terminal states we hide from the owner's active list to reduce noise.
const HIDDEN: BookingStatus[] = ['declined', 'cancelled'];

export default function MyCarsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [cars, setCars] = useState<Car[] | null>(null);
  const [requests, setRequests] = useState<OwnerBooking[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [pickupFor, setPickupFor] = useState<OwnerBooking | null>(null);
  const [confirmReturnFor, setConfirmReturnFor] = useState<OwnerBooking | null>(null);
  const [rateFor, setRateFor] = useState<OwnerBooking | null>(null);

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

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await fn();
      await load();
    } catch (e: any) {
      Alert.alert(t('carRental.errTitle'), e?.response?.data?.error?.message ?? t('carRental.mine.errAction'));
    } finally {
      setBusyId(null);
    }
  }

  function confirmNoReturn(id: string) {
    Alert.alert(t('carRental.noReturn.confirmTitle'), t('carRental.noReturn.confirmBody'), [
      { text: t('carRental.otp.cancelBtn'), style: 'cancel' },
      { text: t('carRental.noReturn.confirmBtn'), style: 'destructive', onPress: () => run(id, () => markNoReturn(id)) },
    ]);
  }

  function dispute(id: string) {
    Alert.alert(t('carRental.dispute.confirmTitle'), t('carRental.dispute.confirmBody'), [
      { text: t('carRental.otp.cancelBtn'), style: 'cancel' },
      { text: t('carRental.dispute.openBtn'), style: 'destructive', onPress: () => run(id, () => openDispute(id, [])) },
    ]);
  }

  async function submitPickup(otp: string, photos: string[]) {
    if (!pickupFor) return;
    setModalBusy(true);
    try {
      await pickupBooking(pickupFor.id, otp, photos);
      setPickupFor(null);
      Alert.alert(t('carRental.pickup.successTitle'), t('carRental.pickup.successBody'));
      await load();
    } catch (e: any) {
      Alert.alert(t('carRental.errTitle'), e?.response?.data?.error?.message ?? t('carRental.pickup.errInvalid'));
    } finally {
      setModalBusy(false);
    }
  }

  async function submitConfirmReturn(_otp: string, photos: string[]) {
    if (!confirmReturnFor) return;
    setModalBusy(true);
    try {
      await confirmReturn(confirmReturnFor.id, photos);
      setConfirmReturnFor(null);
      await load();
    } catch (e: any) {
      Alert.alert(t('carRental.errTitle'), e?.response?.data?.error?.message ?? t('carRental.mine.errAction'));
    } finally {
      setModalBusy(false);
    }
  }

  async function submitRating(stars: number, comment: string) {
    if (!rateFor) return;
    setModalBusy(true);
    try {
      await rateBooking(rateFor.id, stars, comment);
      setRateFor(null);
      await load();
    } catch (e: any) {
      Alert.alert(t('carRental.errTitle'), e?.response?.data?.error?.message ?? t('carRental.rate.errRate'));
    } finally {
      setModalBusy(false);
    }
  }

  const visible = requests.filter((r) => !HIDDEN.includes(r.status));

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

          {visible.length > 0 ? (
            <>
              <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.sm }}>
                {t('carRental.mine.requestsLabel', { count: visible.length })}
              </AppText>
              {visible.map((r) => (
                <Card key={r.id} padding={spacing.lg} style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <AppText variant="label" color={colors.ink} style={{ flex: 1 }}>{r.carTitle}</AppText>
                    <View style={{ borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, borderWidth: 1, borderColor: STATUS_COLOR[r.status] }}>
                      <AppText variant="caption" color={STATUS_COLOR[r.status]}>{t(BOOKING_STATUS_KEYS[r.status])}</AppText>
                    </View>
                  </View>
                  <AppText variant="caption" color={colors.muted}>
                    {t('carRental.mine.daysMeta', { start: r.startDate, end: r.endDate, days: r.days })}
                    {r.withDriver ? t('carRental.mine.daysWithDriver') : ''}
                  </AppText>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <AppText variant="caption" color={colors.ink2}>{r.renterName}</AppText>
                      {r.counterpartRatingCount > 0 ? (
                        <>
                          <Icon name="star" size={12} color={colors.warning} />
                          <AppText variant="caption" color={colors.ink2}>{r.counterpartRatingAvg.toFixed(1)}</AppText>
                        </>
                      ) : null}
                    </View>
                    <AppText variant="label" color={colors.ember}>{formatMru(r.totalMru)}</AppText>
                  </View>

                  {r.depositMru > 0 && (r.status === 'confirmed' || r.status === 'in_progress') ? (
                    <AppText variant="caption" color={colors.muted}>
                      {t('carRental.deposit.dueLine', { amount: formatMru(r.depositMru) })}
                    </AppText>
                  ) : null}

                  {/* Return code the owner reads to the renter at the end. */}
                  {r.status === 'in_progress' && r.returnOtp ? (
                    <OtpDisplay
                      label={t('carRental.returnCode.label')}
                      code={r.returnOtp}
                      hint={t('carRental.returnCode.hint')}
                    />
                  ) : null}

                  {(r.status === 'confirmed' || r.status === 'in_progress') && r.renterPhone ? (
                    <Button title={t('carRental.bookings.callBtn', { phone: r.renterPhone })} icon="phone" size="sm"
                      onPress={() => { void Linking.openURL(`tel:${r.renterPhone}`); }} />
                  ) : null}

                  {r.status === 'pending' ? (
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <Button title={t('carRental.mine.confirmBtn')} size="sm" busy={busyId === r.id} onPress={() => run(r.id, () => respondBooking(r.id, 'confirm'))} style={{ flex: 1 }} />
                      <Button title={t('carRental.mine.declineBtn')} size="sm" variant="secondary" onPress={() => run(r.id, () => respondBooking(r.id, 'decline'))} style={{ flex: 1 }} />
                    </View>
                  ) : null}

                  {r.status === 'confirmed' ? (
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <Button title={t('carRental.pickup.startBtn')} icon="check" size="sm" onPress={() => setPickupFor(r)} style={{ flex: 1 }} />
                      <Button title={t('carRental.mine.noShowBtn')} size="sm" variant="secondary" onPress={() => run(r.id, () => markNoShow(r.id))} disabled={busyId === r.id} style={{ flex: 1 }} />
                    </View>
                  ) : null}

                  {r.status === 'in_progress' ? (
                    <Button title={t('carRental.noReturn.startBtn')} size="sm" variant="danger" onPress={() => confirmNoReturn(r.id)} disabled={busyId === r.id} />
                  ) : null}

                  {(r.status === 'in_progress' || r.status === 'completed') ? (
                    <Button title={t('carRental.dispute.openBtn')} variant="ghost" size="sm" onPress={() => dispute(r.id)} disabled={busyId === r.id} />
                  ) : null}

                  {r.status === 'completed' ? (
                    <>
                      {r.depositMru > 0 && !r.depositReturned ? (
                        <Button title={t('carRental.confirmReturn.startBtn')} icon="check" size="sm" onPress={() => setConfirmReturnFor(r)} />
                      ) : null}
                      {!r.ratedByMe ? (
                        <Button title={t('carRental.rate.rateRenterBtn')} icon="star" size="sm" variant="secondary" onPress={() => setRateFor(r)} />
                      ) : null}
                    </>
                  ) : null}
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

      <BookingActionModal
        visible={pickupFor !== null}
        title={t('carRental.pickup.title')}
        hint={t('carRental.pickup.hint')}
        requireOtp
        withPhotos
        submitLabel={t('carRental.pickup.confirmBtn')}
        busy={modalBusy}
        onSubmit={submitPickup}
        onClose={() => setPickupFor(null)}
      />

      <BookingActionModal
        visible={confirmReturnFor !== null}
        title={t('carRental.confirmReturn.title')}
        hint={t('carRental.confirmReturn.hint')}
        requireOtp={false}
        withPhotos
        submitLabel={t('carRental.confirmReturn.confirmBtn')}
        busy={modalBusy}
        onSubmit={submitConfirmReturn}
        onClose={() => setConfirmReturnFor(null)}
      />

      <RatingModal
        visible={rateFor !== null}
        name={rateFor?.renterName ?? ''}
        busy={modalBusy}
        onSubmit={submitRating}
        onClose={() => setRateFor(null)}
      />
    </SafeAreaView>
  );
}
