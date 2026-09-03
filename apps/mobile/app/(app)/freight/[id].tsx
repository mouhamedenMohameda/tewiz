import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { getTrip, requestBooking, type FreightTrip } from '@/lib/freight';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, Icon, ScreenHeader, TextField } from '@/components/ui';
import { colors, spacing } from '@/theme';
import { useThemeRepaint } from '@/theme/ThemeProvider';

export default function FreightTripScreen() {
  useThemeRepaint();
  const router = useRouter();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<FreightTrip | null>(null);
  const [cargo, setCargo] = useState('');
  const [weight, setWeight] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    getTrip(id).then(setTrip).catch(() => Alert.alert(t('freight.errTitle'), t('freight.notFound')));
  }, [id, t]);

  if (!trip) return <ActivityIndicator style={{ marginTop: spacing.xl }} />;

  const weightN = parseInt(weight, 10) || 0;
  const total = Math.max(weightN * trip.pricePerKgMru, trip.minPriceMru);
  const overCapacity = weightN > trip.remainingKg;

  async function book() {
    if (!cargo.trim() || weightN <= 0) {
      Alert.alert(t('freight.detail.incompleteTitle'), t('freight.detail.incompleteBody'));
      return;
    }
    setSubmitting(true);
    try {
      await requestBooking({ trip_id: trip!.id, cargo_description: cargo.trim(), weight_kg: weightN });
      Alert.alert(t('freight.detail.sentTitle'), t('freight.detail.sentBody'), [
        { text: t('common.ok'), onPress: () => router.replace('/(app)/freight/my-shipments') },
      ]);
    } catch (e: any) {
      Alert.alert(t('freight.errTitle'), e?.response?.data?.error?.message ?? t('freight.detail.errBooking'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={`${trip.originCity} → ${trip.destinationCity}`} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <Card padding={spacing.lg} style={{ gap: spacing.sm }}>
          <Row label={t('freight.detail.rowDate')} value={trip.departureDate} />
          <Row label={t('freight.detail.rowCapacity')} value={t('freight.detail.rowCapacityValue', { remaining: trip.remainingKg, capacity: trip.capacityKg })} />
          <Row label={t('freight.detail.rowPrice')} value={trip.minPriceMru
            ? t('freight.detail.rowPriceWithMin', { price: formatMru(trip.pricePerKgMru), min: formatMru(trip.minPriceMru) })
            : t('freight.detail.rowPriceValue', { price: formatMru(trip.pricePerKgMru) })} />
          {trip.vehicleType ? <Row label={t('freight.detail.rowVehicle')} value={trip.vehicleType} /> : null}
          <Row label={t('freight.detail.rowCarrier')} value={`${trip.carrierName}${trip.carrierRating != null ? `  ⭐ ${trip.carrierRating.toFixed(1)}` : ''}`} />
          {trip.note ? <AppText variant="body" color={colors.ink2}>{trip.note}</AppText> : null}
        </Card>

        <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.sm }}>{t('freight.detail.reserveHeader')}</AppText>
        <TextField label={t('freight.detail.cargoLabel')} value={cargo} onChangeText={setCargo} placeholder={t('freight.detail.cargoPlaceholder')} multiline />
        <TextField label={t('freight.detail.weightLabel')} value={weight} onChangeText={setWeight} keyboardType="number-pad" placeholder={t('freight.detail.weightPlaceholder')} />

        {overCapacity ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Icon name="alert" size={16} color={colors.danger} />
            <AppText variant="caption" color={colors.danger}>{t('freight.detail.overCapacity', { remaining: trip.remainingKg })}</AppText>
          </View>
        ) : null}

        {weightN > 0 && !overCapacity ? (
          <Card padding={spacing.lg} style={{ backgroundColor: colors.emberSoft }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <AppText variant="body" color={colors.ink2}>{weightN} kg × {formatMru(trip.pricePerKgMru)}</AppText>
              <AppText variant="h2" color={colors.ember}>{formatMru(total)}</AppText>
            </View>
          </Card>
        ) : null}

        <Button title={t('freight.detail.bookAction')} icon="check" busy={submitting} disabled={weightN <= 0 || overCapacity} onPress={book} />
      </ScrollView>
    </SafeAreaView>
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
