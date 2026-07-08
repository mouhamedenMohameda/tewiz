import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { createTrip, getTrip, updateTrip } from '@/lib/freight';
import { AppText, Button, Card, DateField, ScreenHeader, TextField } from '@/components/ui';
import { colors, spacing } from '@/theme';

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

export default function AddTripScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;

  const [loading, setLoading] = useState(editing);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [date, setDate] = useState('');
  const [capacity, setCapacity] = useState('');
  const [pricePerKg, setPricePerKg] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [note, setNote] = useState('');
  const [paused, setPaused] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getTrip(id).then((tr) => {
      setOrigin(tr.originCity); setDestination(tr.destinationCity); setDate(tr.departureDate);
      setCapacity(String(tr.capacityKg)); setPricePerKg(String(tr.pricePerKgMru));
      setMinPrice(String(tr.minPriceMru)); setVehicleType(tr.vehicleType ?? '');
      setNote(tr.note ?? ''); setPaused(tr.status === 'paused');
    }).catch(() => Alert.alert(t('freight.errTitle'), t('freight.notFound'))).finally(() => setLoading(false));
  }, [id, t]);

  async function save() {
    const capN = parseInt(capacity, 10);
    const priceN = parseInt(pricePerKg, 10);
    if (!origin.trim() || !destination.trim() || !date || !Number.isFinite(capN) || capN <= 0) {
      Alert.alert(t('freight.add.incompleteTitle'), t('freight.add.incompleteBody'));
      return;
    }
    const payload = {
      origin_city: origin.trim(),
      destination_city: destination.trim(),
      departure_date: date,
      capacity_kg: capN,
      price_per_kg_mru: Number.isFinite(priceN) ? priceN : 0,
      min_price_mru: parseInt(minPrice, 10) || 0,
      vehicle_type: vehicleType.trim() || undefined,
      note: note.trim() || undefined,
    };
    setSaving(true);
    try {
      if (editing) await updateTrip(id!, { ...payload, status: paused ? 'paused' : 'active' });
      else await createTrip(payload);
      Alert.alert(editing ? t('freight.add.savedEditTitle') : t('freight.add.savedNewTitle'), t('freight.add.savedBody'), [
        { text: t('common.ok'), onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert(t('freight.errTitle'), e?.response?.data?.error?.message ?? t('freight.add.errSave'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScreenHeader title={t('freight.add.headerEdit')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={editing ? t('freight.add.editTitle') : t('freight.add.newTitle')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}><TextField label={t('freight.add.departLabel')} value={origin} onChangeText={setOrigin} placeholder={t('freight.add.departPlaceholder')} /></View>
          <View style={{ flex: 1 }}><TextField label={t('freight.add.destLabel')} value={destination} onChangeText={setDestination} placeholder={t('freight.add.destPlaceholder')} /></View>
        </View>
        <DateField label={t('freight.add.departDateLabel')} value={date} onChange={setDate} minDate={todayISO()} placeholder={t('freight.add.datePickPlaceholder')} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}><TextField label={t('freight.add.capacityLabel')} value={capacity} onChangeText={setCapacity} keyboardType="number-pad" placeholder={t('freight.add.capacityPlaceholder')} /></View>
          <View style={{ flex: 1 }}><TextField label={t('freight.add.pricePerKgLabel')} value={pricePerKg} onChangeText={setPricePerKg} keyboardType="number-pad" placeholder={t('freight.add.pricePerKgPlaceholder')} /></View>
        </View>
        <TextField label={t('freight.add.minPriceLabel')} value={minPrice} onChangeText={setMinPrice} keyboardType="number-pad" placeholder={t('freight.add.minPricePlaceholder')} />
        <TextField label={t('freight.add.vehicleTypeLabel')} value={vehicleType} onChangeText={setVehicleType} placeholder={t('freight.add.vehicleTypePlaceholder')} />
        <TextField label={t('freight.add.noteLabel')} value={note} onChangeText={setNote} placeholder={t('freight.add.notePlaceholder')} multiline />

        {editing ? (
          <Card padding={spacing.lg}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <AppText variant="label" color={colors.ink}>{t('freight.add.pauseLabel')}</AppText>
              <Switch value={paused} onValueChange={setPaused} />
            </View>
          </Card>
        ) : null}

        <Button title={editing ? t('freight.add.saveEdit') : t('freight.add.saveNew')} icon="check" busy={saving} onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}
