import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  AppText,
  Button,
  Card,
  DateField,
  Screen,
  ScreenHeader,
  SelectField,
  TextField,
} from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import { useAuth } from '@/lib/auth';
import { MAURITANIA_CITIES } from '@/lib/cities';
import {
  cancelCarpoolingTrip,
  listMyCarpoolingTrips,
  publishCarpoolingTrip,
  type CarpoolingTrip,
} from '@/lib/carpooling';

// Publishing is free — the driver never pays to post. Boost stays an optional,
// opt-in promotion.
const BOOST_FEE_MRU = 200;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CarpoolingPublishScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);

  const cityOptions = useMemo(
    () => MAURITANIA_CITIES.map((city) => ({ label: city, value: city })),
    [],
  );

  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [dateIso, setDateIso] = useState('');
  const [timeValue, setTimeValue] = useState('08:00');
  const [totalSeats, setTotalSeats] = useState(3);
  const [pricePerSeat, setPricePerSeat] = useState('1500');
  const [driverPhone, setDriverPhone] = useState(user?.phone ?? '');
  const [notes, setNotes] = useState('');
  const [boost, setBoost] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [myTrips, setMyTrips] = useState<CarpoolingTrip[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);

  const loadMyTrips = useCallback(async () => {
    if (user?.role !== 'captain') return;
    setLoadingTrips(true);
    try {
      const list = await listMyCarpoolingTrips();
      setMyTrips(list);
    } catch {
      setMyTrips([]);
    } finally {
      setLoadingTrips(false);
    }
  }, [user?.role]);

  useFocusEffect(useCallback(() => { loadMyTrips(); }, [loadMyTrips]));

  function parseDepartureAt(): string | null {
    if (!dateIso) return null;
    if (!/^\d{2}:\d{2}$/.test(timeValue)) return null;
    const d = new Date(`${dateIso}T${timeValue}:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  async function onPublish() {
    if (user?.role !== 'captain') {
      Alert.alert(t('carpooling.publish.errAccessTitle'), t('carpooling.publish.errAccessBody'));
      return;
    }
    if (!origin || !destination) {
      Alert.alert(t('carpooling.publish.errRequiredTitle'), t('carpooling.publish.errRequiredBody'));
      return;
    }
    if (origin === destination) {
      Alert.alert(t('carpooling.publish.errSameTitle'), t('carpooling.publish.errSameBody'));
      return;
    }
    const departureAt = parseDepartureAt();
    if (!departureAt) {
      Alert.alert(t('carpooling.publish.errDateTitle'), t('carpooling.publish.errDateBody'));
      return;
    }
    const price = parseInt(pricePerSeat, 10);
    if (!Number.isInteger(price) || price <= 0) {
      Alert.alert(t('carpooling.publish.errPriceTitle'), t('carpooling.publish.errPriceBody'));
      return;
    }

    setPublishing(true);
    try {
      await publishCarpoolingTrip({
        origin_city: origin,
        destination_city: destination,
        departure_at: departureAt,
        total_seats: totalSeats,
        price_per_seat_mru: price,
        driver_phone: driverPhone.trim() || undefined,
        notes: notes.trim() || undefined,
        boost,
      });
      Alert.alert(t('carpooling.publish.successTitle'), t('carpooling.publish.successBody'));
      setNotes('');
      setBoost(false);
      setDateIso('');
      await loadMyTrips();
      router.replace('/(app)/carpooling');
    } catch (e: any) {
      if (e?.response?.status === 402) {
        Alert.alert(
          t('carpooling.publish.errBalanceTitle'),
          t('carpooling.publish.errBalanceBody'),
          [
            { text: t('carpooling.publish.errBalanceClose'), style: 'cancel' },
            { text: t('carpooling.publish.errBalanceTopup'), onPress: () => router.push('/(app)/captain/wallet') },
          ],
        );
      } else {
        const msg = e?.response?.data?.error?.message ?? t('carpooling.publish.errPublish');
        Alert.alert(t('carpooling.errTitle'), msg);
      }
    } finally {
      setPublishing(false);
    }
  }

  async function cancelTrip(tripId: string) {
    try {
      await cancelCarpoolingTrip(tripId);
      await loadMyTrips();
    } catch (e: any) {
      Alert.alert(t('carpooling.errTitle'), e?.response?.data?.error?.message ?? t('carpooling.publish.errCancel'));
    }
  }

  return (
    <Screen scroll onRefresh={loadMyTrips} refreshing={loadingTrips}>
      <ScreenHeader title={t('carpooling.publish.header')} onBack={() => router.back()} />

      {user?.role !== 'captain' ? (
        <Card padding={spacing.lg}>
          <AppText variant="body" color={colors.ink2}>
            {t('carpooling.publish.captainOnly')}
          </AppText>
        </Card>
      ) : (
        <View style={{ gap: spacing.md }}>
          <Card padding={spacing.base} style={{ gap: spacing.md }}>
            <SelectField
              label={t('carpooling.publish.originLabel')}
              value={origin}
              onChange={setOrigin}
              options={cityOptions}
              placeholder={t('carpooling.publish.chooseCityPlaceholder')}
              modalTitle={t('carpooling.publish.originLabel')}
              searchable
              searchPlaceholder={t('carpooling.publish.searchCityPlaceholder')}
            />
            <SelectField
              label={t('carpooling.publish.destLabel')}
              value={destination}
              onChange={setDestination}
              options={cityOptions}
              placeholder={t('carpooling.publish.chooseCityPlaceholder')}
              modalTitle={t('carpooling.publish.destLabel')}
              searchable
              searchPlaceholder={t('carpooling.publish.searchCityPlaceholder')}
            />
            <DateField
              label={t('carpooling.publish.dateLabel')}
              value={dateIso}
              onChange={setDateIso}
              placeholder={t('carpooling.publish.datePlaceholder')}
              modalTitle={t('carpooling.publish.dateModalTitle')}
              cancelLabel={t('carpooling.publish.cancelLabel')}
              confirmLabel={t('carpooling.publish.confirmLabel')}
            />
            <TextField
              label={t('carpooling.publish.timeLabel')}
              value={timeValue}
              onChangeText={setTimeValue}
              placeholder={t('carpooling.publish.timePlaceholder')}
              icon="clock"
              autoCapitalize="none"
            />

            <View>
              <AppText variant="label" color={colors.ink2} style={{ marginBottom: spacing.sm }}>
                {t('carpooling.publish.seatsLabel')}
              </AppText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Pressable
                  onPress={() => setTotalSeats((s) => Math.max(1, s - 1))}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: radius.md,
                    backgroundColor: colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: colors.line,
                  }}
                >
                  <AppText variant="title">-</AppText>
                </Pressable>
                <View style={{ paddingHorizontal: spacing.md }}>
                  <AppText variant="h2">{totalSeats}</AppText>
                </View>
                <Pressable
                  onPress={() => setTotalSeats((s) => Math.min(8, s + 1))}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: radius.md,
                    backgroundColor: colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: colors.line,
                  }}
                >
                  <AppText variant="title">+</AppText>
                </Pressable>
              </View>
            </View>

            <TextField
              label={t('carpooling.publish.priceLabel')}
              value={pricePerSeat}
              onChangeText={setPricePerSeat}
              keyboardType="number-pad"
              icon="cash"
            />
            <TextField
              label={t('carpooling.publish.phoneLabel')}
              value={driverPhone}
              onChangeText={setDriverPhone}
              keyboardType="phone-pad"
              icon="phone"
            />
            <TextField
              label={t('carpooling.publish.notesLabel')}
              value={notes}
              onChangeText={setNotes}
              placeholder={t('carpooling.publish.notesPlaceholder')}
              icon="document"
            />

            <Pressable
              onPress={() => setBoost((v) => !v)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderWidth: 1,
                borderColor: boost ? '#F59E0B' : colors.line,
                borderRadius: radius.md,
                padding: spacing.base,
                backgroundColor: boost ? '#FFFBEB' : colors.surface,
              }}
            >
              <View style={{ flex: 1, paddingEnd: spacing.md }}>
                <AppText variant="bodyStrong">{t('carpooling.publish.boostTitle', { price: BOOST_FEE_MRU })}</AppText>
                <AppText variant="caption" color={colors.ink2}>
                  {t('carpooling.publish.boostDesc')}
                </AppText>
              </View>
              <View style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                borderWidth: 2,
                borderColor: boost ? '#D97706' : colors.lineStrong,
                backgroundColor: boost ? '#F59E0B' : 'transparent',
              }} />
            </Pressable>

            <View style={{ borderRadius: radius.md, backgroundColor: '#E6F4EA', padding: spacing.base }}>
              <AppText variant="bodyStrong" style={{ color: colors.success }}>
                {boost
                  ? t('carpooling.publish.boostFeeLine', { fee: BOOST_FEE_MRU })
                  : t('carpooling.publish.freeNote')}
              </AppText>
            </View>

            <Button title={t('carpooling.publish.publishBtn')} icon="check" onPress={onPublish} busy={publishing} />
          </Card>

          <Card padding={spacing.base} style={{ gap: spacing.sm, marginBottom: spacing.xxl }}>
            <AppText variant="h2">{t('carpooling.publish.mineHeader')}</AppText>
            {myTrips.length === 0 ? (
              <AppText variant="body" color={colors.ink2}>{t('carpooling.publish.mineEmpty')}</AppText>
            ) : (
              myTrips.map((trip) => (
                <View
                  key={trip.id}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.line,
                    borderRadius: radius.md,
                    padding: spacing.base,
                    gap: spacing.sm,
                  }}
                >
                  <AppText variant="bodyStrong">{trip.originCity}{' → '}{trip.destinationCity}</AppText>
                  <AppText variant="caption" color={colors.ink2}>
                    {t('carpooling.driver.tripMeta', { date: formatDateTime(trip.departureAt), price: trip.pricePerSeatMru })}
                  </AppText>
                  <AppText variant="caption" color={colors.ink2}>
                    {t('carpooling.driver.seatsLeft', { avail: trip.availableSeats, total: trip.totalSeats })}
                  </AppText>
                  <Button
                    title={t('carpooling.driver.cancelBtn')}
                    size="sm"
                    variant="danger"
                    onPress={() => cancelTrip(trip.id)}
                  />
                </View>
              ))
            )}
          </Card>
        </View>
      )}
    </Screen>
  );
}
