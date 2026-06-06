import { useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  Pressable, Text, TextInput, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Application from 'expo-application';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function CodeScreen() {
  const router = useRouter();
  const { phone, devCode } = useLocalSearchParams<{ phone: string; devCode?: string }>();
  const setSession = useAuth((s) => s.setSession);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await api.post('/auth/otp/verify', {
        phone,
        code,
        role: 'rider',
        deviceId: 'tewiz-rider-' + Math.random().toString(36).slice(2, 10),
      });
      await setSession({
        user: r.data.user,
        accessToken: r.data.tokens.accessToken,
        refreshToken: r.data.tokens.refreshToken,
      });
      router.replace('/(app)/');
    } catch (e: any) {
      Alert.alert('Erreur',
        e.response?.data?.error?.message ?? 'Code incorrect.');
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
            Entrez le code
          </Text>
          <Text style={{ fontSize: 16, color: '#64748b', marginTop: 8 }}>
            Code envoyé à {phone}
          </Text>

          {devCode ? (
            <View style={{
              marginTop: 16, padding: 12, borderRadius: 10,
              backgroundColor: '#fef9c3', borderWidth: 1, borderColor: '#fde68a',
            }}>
              <Text style={{ color: '#854d0e', fontSize: 13 }}>
                Code dev: <Text style={{ fontWeight: '700' }}>{devCode}</Text>
              </Text>
            </View>
          ) : null}

          <View style={{ marginTop: 32 }}>
            <TextInput
              autoFocus
              keyboardType="number-pad"
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
              style={{
                borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12,
                paddingHorizontal: 14, paddingVertical: 18, fontSize: 24,
                color: '#0f172a', backgroundColor: '#f8fafc',
                textAlign: 'center', letterSpacing: 12, fontWeight: '600',
              }}
              placeholder="······"
              placeholderTextColor="#94a3b8"
              maxLength={6}
            />
          </View>

          <Pressable
            disabled={busy || code.length !== 6}
            onPress={submit}
            style={({ pressed }) => ({
              marginTop: 24,
              backgroundColor: pressed ? '#2540ac' : '#2d4fd6',
              opacity: busy || code.length !== 6 ? 0.5 : 1,
              paddingVertical: 16, borderRadius: 12,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            })}
          >
            {busy && <ActivityIndicator color="#fff" />}
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
              Vérifier
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
