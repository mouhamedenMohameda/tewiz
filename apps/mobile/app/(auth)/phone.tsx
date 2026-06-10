/**
 * Login screen — phone + admin-generated password.
 *
 * Self-signup is disabled. Users must contact the administrator to have
 * an account created and receive their initial password (via WhatsApp).
 */

import { useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  Pressable, Text, TextInput, View, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Application from 'expo-application';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const DEVICE_ID_FALLBACK = 'unknown-device';

export default function LoginScreen() {
  const router = useRouter();
  const setSession = useAuth((s) => s.setSession);

  const [phone, setPhone] = useState('+222');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);

  // Default to rider role from this app's perspective; the backend will
  // promote us to captain if the DB role is captain.
  const role = 'rider';

  async function submit() {
    if (phone.replace(/\D/g, '').length < 11) {
      Alert.alert('Numéro invalide', 'Vérifiez votre numéro de téléphone.');
      return;
    }
    if (password.length < 4) {
      Alert.alert('Mot de passe manquant', 'Entrez le mot de passe fourni par l\'administrateur.');
      return;
    }

    setBusy(true);
    try {
      const deviceId =
        (await Application.getIosIdForVendorAsync()) ??
        Application.getAndroidId() ??
        DEVICE_ID_FALLBACK;

      const r = await api.post<{
        user: { id: string; phone: string; role: 'rider' | 'captain' | 'admin'; fullName: string | null; mustResetPassword?: boolean };
        tokens: { accessToken: string; refreshToken: string };
      }>('/auth/login', {
        phone,
        password,
        role,
        deviceId,
      });

      await setSession({
        user: {
          id: r.data.user.id,
          phone: r.data.user.phone,
          role: r.data.user.role,
          fullName: r.data.user.fullName,
        },
        accessToken: r.data.tokens.accessToken,
        refreshToken: r.data.tokens.refreshToken,
      });

      router.replace('/(app)');
    } catch (e: any) {
      const err = e.response?.data?.error;
      const status = e.response?.status;
      let title = 'Erreur';
      let msg = err?.message ?? 'Impossible de joindre le serveur.';

      if (status === 401 || err?.code === 'invalid_credentials') {
        title = 'Identifiants invalides';
        msg = 'Numéro ou mot de passe incorrect.';
      } else if (status === 403 && err?.code === 'no_password_set') {
        title = 'Compte non activé';
        msg = 'Aucun mot de passe défini. Contactez l\'administrateur.';
      } else if (status === 429) {
        title = 'Trop d\'essais';
        msg = err?.message ?? 'Réessayez dans quelques minutes.';
      }
      Alert.alert(title, msg);
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
            Se connecter
          </Text>
          <Text style={{ fontSize: 14, color: '#64748b', marginTop: 8 }}>
            Entrez votre numéro et le mot de passe que vous a transmis l'administrateur sur WhatsApp.
          </Text>

          {/* Phone */}
          <View style={{ marginTop: 28 }}>
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
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="telephoneNumber"
            />
          </View>

          {/* Password */}
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontSize: 13, color: '#475569', marginBottom: 6 }}>
              Mot de passe (8 caractères)
            </Text>
            <View style={{ position: 'relative' }}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPwd}
                style={{
                  borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12,
                  paddingHorizontal: 14, paddingRight: 64, paddingVertical: 14,
                  fontSize: 18, color: '#0f172a', backgroundColor: '#f8fafc',
                  fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
                }}
                placeholder="••••••••"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                maxLength={32}
              />
              <Pressable
                onPress={() => setShowPwd((v) => !v)}
                style={{
                  position: 'absolute', right: 8, top: 0, bottom: 0,
                  justifyContent: 'center', paddingHorizontal: 12,
                }}
              >
                <Text style={{ color: '#10a35e', fontSize: 13, fontWeight: '600' }}>
                  {showPwd ? 'Cacher' : 'Voir'}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Submit */}
          <Pressable
            disabled={busy}
            onPress={submit}
            style={({ pressed }) => ({
              marginTop: 24,
              backgroundColor: pressed ? '#0f7c4a' : '#10a35e',
              opacity: busy ? 0.5 : 1,
              paddingVertical: 16, borderRadius: 12,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            })}
          >
            {busy && <ActivityIndicator color="#fff" />}
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
              Se connecter
            </Text>
          </Pressable>

          {/* Help — admin contact */}
          <Pressable
            onPress={() => {
              const url = 'https://wa.me/22245000000?text=' +
                encodeURIComponent('Bonjour, je voudrais créer un compte Tewiz.');
              Linking.openURL(url).catch(() => undefined);
            }}
            style={{ marginTop: 24, alignItems: 'center' }}
          >
            <Text style={{ color: '#64748b', fontSize: 13 }}>
              Pas de compte ? Contactez l'administrateur sur WhatsApp.
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
