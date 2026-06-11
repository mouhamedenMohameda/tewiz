import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, Switch, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { type ApplicationDto } from '@/lib/kyc';
import { Field, PrimaryButton } from '@/lib/form';

export default function VehicleScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [plate, setPlate] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [color, setColor] = useState('');
  const [seats, setSeats] = useState('4');
  const [acceptsColis, setAcceptsColis] = useState(false);
  const [acceptsLongDistance, setAcceptsLongDistance] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<ApplicationDto>('/captain/applications/me');
        if (r.data) {
          setPlate(r.data.vehiclePlate ?? '');
          setBrand(r.data.vehicleBrand ?? '');
          setModel(r.data.vehicleModel ?? '');
          setYear(r.data.vehicleYear?.toString() ?? '');
          setColor(r.data.vehicleColor ?? '');
          setSeats(r.data.vehicleSeats?.toString() ?? '4');
          setAcceptsColis(r.data.acceptsColis);
          setAcceptsLongDistance(r.data.acceptsLongDistance);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    const yearNum = Number(year);
    const seatsNum = Number(seats);
    const currentYear = new Date().getFullYear();
    if (!yearNum || yearNum < 1980 || yearNum > currentYear + 1) {
      Alert.alert('Année invalide', `Entre 1980 et ${currentYear + 1}.`);
      return;
    }
    if (!seatsNum || seatsNum < 1 || seatsNum > 8) {
      Alert.alert('Places invalides', 'Entre 1 et 8.');
      return;
    }
    setSaving(true);
    try {
      await api.patch('/captain/applications/me', {
        vehiclePlate: plate.trim().toUpperCase(),
        vehicleBrand: brand.trim(),
        vehicleModel: model.trim(),
        vehicleYear: yearNum,
        vehicleColor: color.trim(),
        vehicleSeats: seatsNum,
        acceptsColis,
        acceptsLongDistance,
      });
      router.back();
    } catch (e: any) {
      Alert.alert('Erreur', e.response?.data?.error?.message ?? 'Impossible d\'enregistrer.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Pressable onPress={() => router.back()}>
            <Text style={{ color: '#64748b', fontSize: 14 }}>‹ Retour</Text>
          </Pressable>
          <Text style={{ fontSize: 24, fontWeight: '700', color: '#0f172a', marginTop: 12 }}>
            Véhicule
          </Text>

          <Field label="Plaque d'immatriculation" value={plate}
            onChangeText={setPlate} placeholder="1234 AB" autoCapitalize="characters" />
          <Field label="Marque" value={brand} onChangeText={setBrand}
            placeholder="Toyota" autoCapitalize="words" />
          <Field label="Modèle" value={model} onChangeText={setModel}
            placeholder="Corolla" autoCapitalize="words" />
          <Field label="Année" value={year}
            onChangeText={(t) => setYear(t.replace(/\D/g, '').slice(0, 4))}
            placeholder="2018" keyboardType="number-pad" maxLength={4} />
          <Field label="Couleur" value={color} onChangeText={setColor}
            placeholder="Blanc" autoCapitalize="words" />
          <Field label="Nombre de places passagers" value={seats}
            onChangeText={(t) => setSeats(t.replace(/\D/g, '').slice(0, 1))}
            placeholder="4" keyboardType="number-pad" maxLength={1} />

          <View style={{
            marginTop: 24, backgroundColor: '#fff', borderRadius: 14, padding: 16,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#0f172a' }}>Accepter les colis</Text>
              <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                Livraisons sans passager (commission 10%).
              </Text>
            </View>
            <Switch value={acceptsColis} onValueChange={setAcceptsColis} />
          </View>

          <View style={{
            marginTop: 12, backgroundColor: '#fff', borderRadius: 14, padding: 16,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#0f172a' }}>Longue distance</Text>
              <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                Courses inter-villes (Nouakchott — Nouadhibou, etc.).
              </Text>
            </View>
            <Switch value={acceptsLongDistance} onValueChange={setAcceptsLongDistance} />
          </View>

          <PrimaryButton title="Enregistrer" onPress={save} busy={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
