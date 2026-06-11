import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { type ApplicationDto } from '@/lib/kyc';
import { Field, PrimaryButton } from '@/lib/form';

export default function PersonalScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState('');
  const [nni, setNni] = useState('');
  const [dob, setDob] = useState(''); // YYYY-MM-DD
  const [address, setAddress] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<ApplicationDto>('/captain/applications/me');
        if (r.data) {
          setFullName(r.data.fullName ?? '');
          setNni(r.data.nni ?? '');
          setDob(r.data.dateOfBirth ?? '');
          setAddress(r.data.addressLabel ?? '');
          setEmergencyName(r.data.emergencyContactName ?? '');
          setEmergencyPhone(r.data.emergencyContactPhone ?? '');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    if (!/^\d{6,15}$/.test(nni)) {
      Alert.alert('NNI invalide', 'Le NNI doit contenir 6 à 15 chiffres.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      Alert.alert('Date invalide', 'Format attendu : AAAA-MM-JJ (ex 1990-05-23).');
      return;
    }
    setSaving(true);
    try {
      await api.patch('/captain/applications/me', {
        fullName: fullName.trim(),
        nni,
        dateOfBirth: dob,
        addressLabel: address.trim(),
        emergencyContactName: emergencyName.trim() || undefined,
        emergencyContactPhone: emergencyPhone.trim(),
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
            Informations personnelles
          </Text>

          <Field label="Nom complet" value={fullName} onChangeText={setFullName}
            placeholder="Ahmed Ould Mohamed" autoCapitalize="words" />
          <Field label="NNI" value={nni} onChangeText={(t) => setNni(t.replace(/\D/g, ''))}
            placeholder="1234567890" keyboardType="number-pad" maxLength={15}
            helper="Numéro National d'Identité — 6 à 15 chiffres" />
          <Field label="Date de naissance" value={dob} onChangeText={setDob}
            placeholder="AAAA-MM-JJ" keyboardType="numeric" maxLength={10}
            helper="Format : 1990-05-23" />
          <Field label="Adresse" value={address} onChangeText={setAddress}
            placeholder="Tevragh Zeina, près mosquée Saudique" />
          <Field label="Contact d'urgence — nom" value={emergencyName} onChangeText={setEmergencyName}
            placeholder="Fatimetou (épouse)" autoCapitalize="words" />
          <Field label="Contact d'urgence — téléphone" value={emergencyPhone}
            onChangeText={(t) => setEmergencyPhone(t.replace(/[^\d+]/g, ''))}
            placeholder="+22245XXXXXXX" keyboardType="phone-pad" />

          <PrimaryButton title="Enregistrer" onPress={save} busy={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
