import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { getCar, requestBooking, type Car } from '@/lib/carRental';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, DateField, Icon, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import { wrapRow } from '@/components/ui';

function dayCount(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  return Math.floor((e - s) / 86_400_000) + 1;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CarDetailScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [car, setCar] = useState<Car | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [withDriver, setWithDriver] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    getCar(id).then(setCar).catch(() => Alert.alert(t('carRental.errTitle'), t('carRental.errCarNotFound')));
  }, [id, t]);

  if (!car) return <ActivityIndicator style={{ marginTop: spacing.xl }} />;

  const days = dayCount(start, end);
  const perDay = car.pricePerDayMru + (withDriver ? car.driverDayRateMru ?? 0 : 0);
  const total = days * perDay;

  async function book() {
    if (days <= 0) {
      Alert.alert(t('carRental.detail.datesInvalidTitle'), t('carRental.detail.datesInvalidBody'));
      return;
    }
    setSubmitting(true);
    try {
      await requestBooking({ listing_id: car!.id, start_date: start, end_date: end, with_driver: withDriver });
      Alert.alert(t('carRental.detail.sentTitle'), t('carRental.detail.sentBody'), [
        { text: t('common.ok'), onPress: () => router.replace('/(app)/car-rental/my-bookings') },
      ]);
    } catch (e: any) {
      Alert.alert(t('carRental.errTitle'), e?.response?.data?.error?.message ?? t('carRental.detail.errBooking'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={car.title} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
        {car.photos.length > 0 ? (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {car.photos.map((p) => (
              <Image key={p} source={{ uri: p }} style={{ width: 380, height: 240 }} contentFit="cover" />
            ))}
          </ScrollView>
        ) : (
          <View style={{ height: 200, backgroundColor: colors.sunken, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="car" size={48} color={colors.faint} />
          </View>
        )}

        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <AppText variant="h2" color={colors.ink} style={{ flex: 1 }}>{car.title}</AppText>
            <AppText variant="h2" color={colors.ember}>{t('carRental.pricePerDay', { price: formatMru(car.pricePerDayMru) })}</AppText>
          </View>

          <View style={{ flexDirection: wrapRow, flexWrap: 'wrap', gap: spacing.md }}>
            <Spec icon="pin" label={car.city} />
            {car.year ? <Spec icon="calendar" label={String(car.year)} /> : null}
            {car.seats ? <Spec icon="person" label={t('carRental.seatsLabel', { count: car.seats })} /> : null}
            {car.transmission ? <Spec icon="tune" label={car.transmission === 'auto' ? t('carRental.detail.transmissionAuto') : t('carRental.detail.transmissionManual')} /> : null}
          </View>

          {car.description ? <AppText variant="body" color={colors.ink2}>{car.description}</AppText> : null}

          <Card padding={spacing.lg} style={{ gap: spacing.sm }}>
            <Row label={t('carRental.detail.rowCaution')} value={car.depositMru > 0 ? formatMru(car.depositMru) : '—'} />
            {car.withDriver ? <Row label={t('carRental.detail.rowDriverDay')} value={formatMru(car.driverDayRateMru ?? 0)} /> : null}
            <Row label={t('carRental.detail.rowOwner')} value={`${car.ownerName}${car.ownerRating != null ? `  ⭐ ${car.ownerRating.toFixed(1)}` : ''}`} />
          </Card>

          <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.sm }}>{t('carRental.detail.reserveHeader')}</AppText>
          <DateField label={t('carRental.detail.dateFrom')} value={start} onChange={setStart} minDate={todayISO()} placeholder={t('carRental.detail.dateFromPlaceholder')} />
          <DateField label={t('carRental.detail.dateTo')} value={end} onChange={setEnd} minDate={start || todayISO()} placeholder={t('carRental.detail.dateToPlaceholder')} />

          {car.withDriver ? (
            <Pressable onPress={() => setWithDriver((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Icon name={withDriver ? 'check' : 'close'} size={20} color={withDriver ? colors.success : colors.muted} />
              <AppText variant="body" color={colors.ink}>{t('carRental.detail.withDriverToggle', { price: formatMru(car.driverDayRateMru ?? 0) })}</AppText>
            </Pressable>
          ) : null}

          {days > 0 ? (
            <Card padding={spacing.lg} style={{ backgroundColor: colors.emberSoft }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <AppText variant="body" color={colors.ink2}>
                  {days > 1
                    ? t('carRental.detail.dayMany', { count: days, price: formatMru(perDay) })
                    : t('carRental.detail.dayOne', { count: days, price: formatMru(perDay) })}
                </AppText>
                <AppText variant="h2" color={colors.ember}>{formatMru(total)}</AppText>
              </View>
            </Card>
          ) : null}

          <Button title={t('carRental.detail.reserveBtn')} icon="check" busy={submitting} disabled={days <= 0} onPress={book} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Spec({ icon, label }: { icon: 'pin' | 'calendar' | 'person' | 'tune'; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name={icon} size={16} color={colors.muted} />
      <AppText variant="caption" color={colors.ink2}>{label}</AppText>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <AppText variant="body" color={colors.ink2}>{label}</AppText>
      <AppText variant="body" color={colors.ink}>{value}</AppText>
    </View>
  );
}
