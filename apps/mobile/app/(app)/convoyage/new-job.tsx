import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { createJob } from '@/lib/convoyage';
import { AppText, Button, DateField, ScreenHeader, TextField } from '@/components/ui';
import { colors, spacing } from '@/theme';

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

export default function NewConvoyageJobScreen() {
  const router = useRouter();
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
      if (!pickup.trim()) setPickup('Ma position');
    } catch { /* ignore */ }
  }

  async function submit() {
    if (!pickup.trim() || !dropoff.trim() || !plate.trim()) {
      Alert.alert('Incomplet', 'Départ, destination et plaque sont requis.');
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
      Alert.alert('Publiée', 'Votre demande est ouverte aux convoyeurs. Vous choisirez parmi les propositions.', [
        { text: 'OK', onPress: () => router.replace('/(app)/convoyage') },
      ]);
    } catch (e: any) {
      Alert.alert('Erreur', e?.response?.data?.error?.message ?? 'Publication impossible.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title="Demande de convoyage" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <AppText variant="body" color={colors.ink2}>
          Un convoyeur conduira votre véhicule d'un point A vers un point B.
        </AppText>

        <TextField label="Départ (A)" value={pickup} onChangeText={setPickup} placeholder="Ex: Nouakchott centre" icon="pin" />
        <Button title="📍 Utiliser ma position" variant="secondary" size="sm" onPress={useMyPosition} />
        <TextField label="Destination (B)" value={dropoff} onChangeText={setDropoff} placeholder="Ex: Rosso" icon="pin" />

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}><TextField label="Plaque" value={plate} onChangeText={setPlate} placeholder="1234 AB 01" /></View>
          <View style={{ flex: 1 }}><TextField label="Modèle" value={model} onChangeText={setModel} placeholder="Toyota Hilux" /></View>
        </View>

        <DateField label="Date souhaitée" value={date} onChange={setDate} minDate={todayISO()} placeholder="Choisir une date" />
        <TextField label="Note" value={note} onChangeText={setNote} placeholder="Détails, état du véhicule… (optionnel)" multiline />

        <Button title="Publier la demande" icon="check" busy={saving} onPress={submit} />
      </ScrollView>
    </SafeAreaView>
  );
}
