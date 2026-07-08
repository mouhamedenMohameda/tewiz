import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { createJob } from '@/lib/convoyage';
import { AppText, Button, DateField, ScreenHeader, TextField } from '@/components/ui';
import { colors, spacing } from '@/theme';

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

export default function NewConvoyageJobScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [plate, setPlate] = useState('');
  const [model, setModel] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);

  async function useMyPosition() {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return;
      const loc = await Location.getCurrentPositionAsync();
      setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      if (!pickup.trim()) setPickup(t('convoyage.newJob.myPositionLabel'));
    } catch { /* ignore */ }
  }

  async function submit() {
    if (!pickup.trim() || !dropoff.trim() || !plate.trim()) {
      Alert.alert(t('convoyage.newJob.incompleteTitle'), t('convoyage.newJob.incompleteBody'));
      return;
    }
    setSaving(true);
    try {
      await createJob({
        pickup_label: pickup.trim(),
        dropoff_label: dropoff.trim(),
        vehicle_plate: plate.trim(),
        vehicle_model: model.trim() || undefined,
        desired_date: date || undefined,
        note: note.trim() || undefined,
        pickup_lat: coords?.lat,
        pickup_lng: coords?.lng,
      });
      Alert.alert(t('convoyage.newJob.publishedTitle'), t('convoyage.newJob.publishedBody'), [
        { text: t('common.ok'), onPress: () => router.replace('/(app)/convoyage') },
      ]);
    } catch (e: any) {
      Alert.alert(t('convoyage.errTitle'), e?.response?.data?.error?.message ?? t('convoyage.newJob.errPublish'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={t('convoyage.newJob.header')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <AppText variant="body" color={colors.ink2}>
          {t('convoyage.newJob.intro')}
        </AppText>

        <TextField label={t('convoyage.newJob.pickupLabel')} value={pickup} onChangeText={setPickup} placeholder={t('convoyage.newJob.pickupPlaceholder')} icon="pin" />
        <Button title={t('convoyage.newJob.useMyPos')} variant="secondary" size="sm" onPress={useMyPosition} />
        <TextField label={t('convoyage.newJob.dropoffLabel')} value={dropoff} onChangeText={setDropoff} placeholder={t('convoyage.newJob.dropoffPlaceholder')} icon="pin" />

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}><TextField label={t('convoyage.newJob.plateLabel')} value={plate} onChangeText={setPlate} placeholder={t('convoyage.newJob.platePlaceholder')} /></View>
          <View style={{ flex: 1 }}><TextField label={t('convoyage.newJob.modelLabel')} value={model} onChangeText={setModel} placeholder={t('convoyage.newJob.modelPlaceholder')} /></View>
        </View>

        <DateField label={t('convoyage.newJob.desiredDateLabel')} value={date} onChange={setDate} minDate={todayISO()} placeholder={t('convoyage.newJob.datePickPlaceholder')} />
        <TextField label={t('convoyage.newJob.noteLabel')} value={note} onChangeText={setNote} placeholder={t('convoyage.newJob.notePlaceholder')} multiline />

        <Button title={t('convoyage.newJob.publishBtn')} icon="check" busy={saving} onPress={submit} />
      </ScrollView>
    </SafeAreaView>
  );
}
