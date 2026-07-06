import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getCar, requestBooking, type Car } from '@/lib/carRental';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, DateField, Icon, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const [car, setCar] = useState<Car | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [withDriver, setWithDriver] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    getCar(id).then(setCar).catch(() => Alert.alert('Erreur', 'Voiture introuvable'));
  }, [id]);

  if (!car) return <ActivityIndicator style={{ marginTop: spacing.xl }} />;

  const days = dayCount(start, end);
  const perDay = car.pricePerDayMru + (withDriver ? car.driverDayRateMru ?? 0 : 0);
  const total = days * perDay;

  async function book() {
    if (days <= 0) {
      Alert.alert('Dates', 'Choisissez une date de début et de fin valides.');
      return;
    }
    setSubmitting(true);
    try {
      await requestBooking({ listing_id: car!.id, start_date: start, end_date: end, with_driver: withDriver });
      Alert.alert('Demande envoyée', 'Le propriétaire va confirmer. Suivez le statut dans « Mes réservations ».', [
        { text: 'OK', onPress: () => router.replace('/(app)/car-rental/my-bookings') },
      ]);
    } catch (e: any) {
      Alert.alert('Erreur', e?.response?.data?.error?.message ?? 'Réservation impossible.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={car.title} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
        {car.photos.length > 0 ? (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {car.photos.map((p) => (
              <Image key={p} source={{ uri: p }} style={{ width: 380, height: 240 }} resizeMode="cover" />
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
            <AppText variant="h2" color={colors.ember}>{formatMru(car.pricePerDayMru)}/j</AppText>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            <Spec icon="pin" label={car.city} />
            {car.year ? <Spec icon="calendar" label={String(car.year)} /> : null}
            {car.seats ? <Spec icon="person" label={`${car.seats} places`} /> : null}
            {car.transmission ? <Spec icon="tune" label={car.transmission === 'auto' ? 'Auto' : 'Manuelle'} /> : null}
          </View>

          {car.description ? <AppText variant="body" color={colors.ink2}>{car.description}</AppText> : null}

          <Card padding={spacing.lg} style={{ gap: spacing.sm }}>
            <Row label="Caution" value={car.depositMru > 0 ? formatMru(car.depositMru) : '—'} />
            {car.withDriver ? <Row label="Chauffeur / jour" value={formatMru(car.driverDayRateMru ?? 0)} /> : null}
            <Row label="Propriétaire" value={`${car.ownerName}${car.ownerRating != null ? `  ⭐ ${car.ownerRating.toFixed(1)}` : ''}`} />
          </Card>

          {/* Booking */}
          <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.sm }}>RÉSERVER</AppText>
          <DateField label="Du" value={start} onChange={setStart} minDate={todayISO()} placeholder="Date de début" />
          <DateField label="Au" value={end} onChange={setEnd} minDate={start || todayISO()} placeholder="Date de fin" />

          {car.withDriver ? (
            <Pressable onPress={() => setWithDriver((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Icon name={withDriver ? 'check' : 'close'} size={20} color={withDriver ? colors.success : colors.muted} />
              <AppText variant="body" color={colors.ink}>Avec chauffeur (+{formatMru(car.driverDayRateMru ?? 0)}/j)</AppText>
            </Pressable>
          ) : null}

          {days > 0 ? (
            <Card padding={spacing.lg} style={{ backgroundColor: colors.emberSoft }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <AppText variant="body" color={colors.ink2}>{days} jour{days > 1 ? 's' : ''} × {formatMru(perDay)}</AppText>
                <AppText variant="h2" color={colors.ember}>{formatMru(total)}</AppText>
              </View>
            </Card>
          ) : null}

          <Button title="Demander la réservation" icon="check" busy={submitting} disabled={days <= 0} onPress={book} />
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
