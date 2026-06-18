/**
 * Login screen — phone + admin-generated password.
 *
 * Self-signup is disabled. Users must contact the administrator to have an
 * account created and receive their initial password (via WhatsApp).
 */

import { useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Application from 'expo-application';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, radius, shadow, spacing } from '@/theme';
import { AppText, Button, FadeInView, Icon, TextField } from '@/components/ui';
import { APP_NAME } from '@/lib/brand';

const DEVICE_ID_FALLBACK = 'unknown-device';

export default function LoginScreen() {
  const router = useRouter();
  const setSession = useAuth((s) => s.setSession);

  const [phone, setPhone] = useState('+222');
  const [password, setPassword] = useState('');
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

  function contactAdmin() {
    const url = 'https://wa.me/33656696974?text=' +
      encodeURIComponent(`Bonjour, je voudrais créer un compte ${APP_NAME}.`);
    Linking.openURL(url).catch(() => undefined);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl }}
        >
          {/* Back */}
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={{
              width: 44, height: 44, borderRadius: radius.md, marginTop: spacing.sm,
              backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
              ...shadow.card,
            }}
          >
            <Icon name="chevronBack" size={22} color={colors.ink} />
          </Pressable>

          <FadeInView style={{ marginTop: spacing.xxl }}>
            <View
              style={{
                width: 64, height: 64, borderRadius: radius.lg,
                backgroundColor: colors.emberSoft,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Icon name="person" size={34} color={colors.ember} />
            </View>
            <AppText variant="display" style={{ marginTop: spacing.lg }}>
              Bon retour
            </AppText>
            <AppText variant="body" color={colors.ink2} style={{ marginTop: spacing.sm, maxWidth: 320 }}>
              Entrez votre numéro et le mot de passe transmis par l'administrateur sur WhatsApp.
            </AppText>
          </FadeInView>

          <FadeInView delay={120} style={{ marginTop: spacing.xxl, gap: spacing.base }}>
            <TextField
              label="Numéro de téléphone"
              icon="phone"
              autoFocus
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              placeholder="+22245XXXXXXX"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="telephoneNumber"
            />

            <TextField
              label="Mot de passe"
              icon="lock"
              secure
              mono
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              maxLength={32}
            />
          </FadeInView>

          <View style={{ flex: 1, minHeight: spacing.xl }} />

          <Button title="Se connecter" iconRight="arrow" busy={busy} onPress={submit} />

          <Pressable onPress={contactAdmin} style={{ marginTop: spacing.xl, alignItems: 'center' }}>
            <AppText variant="caption" color={colors.ink2} align="center">
              Pas de compte ?{' '}
              <AppText variant="caption" color={colors.ember}>Contactez l'administrateur</AppText>
            </AppText>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
