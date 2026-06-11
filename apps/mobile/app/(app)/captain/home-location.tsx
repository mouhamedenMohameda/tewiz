import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { Field, PrimaryButton } from '@/lib/form';

interface Home {
  captainId: string;
  lat: number;
  lng: number;
  label: string;
  setAt: string;
  lockedUntil: string;
  correctionUsed: boolean;
}

export default function HomeLocationScreen() {
  const router = useRouter();
  const [home, setHome] = useState<Home | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get<Home>('/captain/home', {
        validateStatus: (s) => s === 200 || s === 204,
      });
      if (r.status === 204) {
        setHome(null);
        setEditing(true);
      } else {
        setHome(r.data);
        setLabel(r.data.label);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (label.trim().length < 2) {
      Alert.alert('Adresse', 'Décrivez l\'endroit (ex. "près mosquée Saudique").');
      return;
    }
    setSaving(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Position requise', 'Tewiz doit vérifier que vous êtes bien sur place.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const body = {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        label: label.trim(),
        currentLat: loc.coords.latitude,
        currentLng: loc.coords.longitude,
      };
      const method = home ? 'patch' : 'post';
      const r = await api[method]<Home>('/captain/home', body);
      setHome(r.data);
      setEditing(false);
      Alert.alert('Domicile enregistré',
        `Verrouillé jusqu'au ${new Date(r.data.lockedUntil).toLocaleDateString('fr-FR')}.`);
    } catch (e: any) {
      Alert.alert('Impossible', e.response?.data?.error?.message ?? 'Échec.');
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

  const now = Date.now();
  const lockedUntil = home ? new Date(home.lockedUntil).getTime() : 0;
  const isLocked = home ? lockedUntil > now : false;
  const setAtMs = home ? new Date(home.setAt).getTime() : 0;
  const inCorrectionWindow =
    !!home && !home.correctionUsed && (now - setAtMs) < 48 * 3600_000;
  const canEdit = !home || !isLocked || inCorrectionWindow;

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
            Mon domicile
          </Text>
          <Text style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>
            Sert au mode "Je rentre chez moi". Verrouillé 30 jours et vérifié par GPS (200 m).
          </Text>

          {home && !editing ? (
            <View style={{ marginTop: 24, backgroundColor: '#fff', borderRadius: 14, padding: 16 }}>
              <Text style={{ fontSize: 13, color: '#64748b' }}>Adresse</Text>
              <Text style={{ fontSize: 17, fontWeight: '600', color: '#0f172a', marginTop: 4 }}>
                {home.label}
              </Text>
              <Text style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                {home.lat.toFixed(5)}, {home.lng.toFixed(5)}
              </Text>

              <View style={{
                marginTop: 16, padding: 12, borderRadius: 10,
                backgroundColor: isLocked ? '#fef9c3' : '#dcfce7',
              }}>
                <Text style={{
                  fontSize: 12, fontWeight: '700',
                  color: isLocked ? '#854d0e' : '#166534', letterSpacing: 0.5,
                }}>
                  {isLocked ? 'VERROUILLÉ' : 'MODIFIABLE'}
                </Text>
                <Text style={{
                  fontSize: 12, marginTop: 4,
                  color: isLocked ? '#854d0e' : '#166534',
                }}>
                  {isLocked
                    ? `Jusqu'au ${new Date(home.lockedUntil).toLocaleDateString('fr-FR')}`
                    : 'La période de verrouillage est terminée.'}
                  {inCorrectionWindow ? ' · Correction encore possible.' : ''}
                </Text>
              </View>

              {canEdit ? (
                <Pressable
                  onPress={() => setEditing(true)}
                  style={({ pressed }) => ({
                    marginTop: 16, padding: 12, borderRadius: 10,
                    backgroundColor: pressed ? '#e2e8f0' : '#f1f5f9', alignItems: 'center',
                  })}
                >
                  <Text style={{ color: '#0f172a', fontWeight: '600' }}>
                    {inCorrectionWindow ? 'Corriger' : 'Modifier'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={{ marginTop: 16 }}>
              <Field label="Adresse (description)" value={label} onChangeText={setLabel}
                placeholder="Tevragh Zeina, près mosquée Saudique"
                helper="Vous devez être physiquement sur place — la position GPS sera vérifiée." />
              <PrimaryButton title="Enregistrer mon domicile" onPress={save} busy={saving} />
              {home ? (
                <Pressable
                  onPress={() => { setEditing(false); setLabel(home.label); }}
                  style={{ marginTop: 12, padding: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: '#64748b' }}>Annuler</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
