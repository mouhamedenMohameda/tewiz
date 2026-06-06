import { useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  Pressable, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';

export default function PhoneScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('+22245');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await api.post('/auth/otp/request', { phone });
      router.push({
        pathname: '/(auth)/code',
        params: { phone, devCode: r.data._devCode ?? '' },
      });
    } catch (e: any) {
      Alert.alert('Erreur',
        e.response?.data?.error?.message ?? 'Impossible de joindre le serveur.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ padding: 24, flex: 1, justifyContent: 'center' }}>
          <Text style={{ fontSize: 28, fontWeight: '700', color: '#0f172a' }}>
            Bienvenue
          </Text>
          <Text style={{ fontSize: 16, color: '#64748b', marginTop: 8 }}>
            Entrez votre numéro pour commencer.
          </Text>

          <View style={{ marginTop: 32 }}>
            <Text style={{ fontSize: 13, color: '#475569', marginBottom: 6 }}>
              Numéro de téléphone
            </Text>
            <TextInput
              autoFocus
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              style={{
                borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12,
                paddingHorizontal: 14, paddingVertical: 14, fontSize: 18,
                color: '#0f172a', backgroundColor: '#f8fafc',
              }}
              placeholder="+22245XXXXXXX"
              placeholderTextColor="#94a3b8"
            />
          </View>

          <Pressable
            disabled={busy || phone.length < 12}
            onPress={submit}
            style={({ pressed }) => ({
              marginTop: 24,
              backgroundColor: pressed ? '#2540ac' : '#2d4fd6',
              opacity: busy || phone.length < 12 ? 0.5 : 1,
              paddingVertical: 16, borderRadius: 12,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            })}
          >
            {busy && <ActivityIndicator color="#fff" />}
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
              Recevoir le code
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
