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
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Application from 'expo-application';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { loginAsDemo, type DemoRole } from '@/lib/guest';
import { useAppConfig } from '@/lib/appConfig';
import { colors, radius, shadow, spacing } from '@/theme';
import { AppText, Button, FadeInView, Icon, TextField } from '@/components/ui';
import { APP_NAME } from '@/lib/brand';

const DEVICE_ID_FALLBACK = 'unknown-device';

export default function LoginScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const setSession = useAuth((s) => s.setSession);
  const config = useAppConfig();

  // Start empty (not pre-filled with "+222"). Pre-filling broke the
  // App Store reviewer who typed their number on top of "+222" and got
  // "+222+22244000001" — invalid. Empty + a clear placeholder forces
  // the user to type the full number once, which normalizePhone() then
  // turns into a canonical "+222XXXXXXXX" before submission.
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [demoRole, setDemoRole] = useState<DemoRole | null>(null);

  /**
   * Normalize what the user typed into a canonical "+222XXXXXXXX".
   * Accepts:
   *   - "+22244000001"  → "+22244000001"  (already canonical)
   *   - "22244000001"   → "+22244000001"  (missing the +)
   *   - "44000001"      → "+22244000001"  (just the 8 local digits)
   *   - "44 00 00 01"   → "+22244000001"  (spaces, dashes, dots stripped)
   *   - "+222 44 000001"→ "+22244000001"
   */
  function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 8 && /^[234]/.test(digits)) return `+222${digits}`;
    if (digits.length === 11 && digits.startsWith('222')) return `+${digits}`;
    return raw.trim();
  }

  // Default to rider role from this app's perspective; the backend will
  // promote us to captain if the DB role is captain.
  const role = 'rider';

  async function submit() {
    const normalizedPhone = normalizePhone(phone);
    // Trim the password: pasting the demo password from App Store Connect can
    // append a trailing space/newline on iOS, which produced a 401 for the
    // reviewer even though the credentials were correct. Real passwords are
    // alphanumeric (no leading/trailing spaces), so trimming is always safe.
    const pwd = password.trim();

    if (normalizedPhone.replace(/\D/g, '').length < 11) {
      Alert.alert(t('auth.login.invalidPhoneTitle'), t('auth.login.invalidPhoneBody'));
      return;
    }
    if (pwd.length < 4) {
      Alert.alert(t('auth.login.missingPasswordTitle'), t('auth.login.missingPasswordBody'));
      return;
    }

    setBusy(true);
    try {
      // `getIosIdForVendorAsync()` THROWS on Android (not returns null), so
      // we must branch on Platform.OS — otherwise login rejects before the
      // network call ever happens.
      let deviceId = DEVICE_ID_FALLBACK;
      try {
        if (Platform.OS === 'ios') {
          deviceId = (await Application.getIosIdForVendorAsync()) ?? DEVICE_ID_FALLBACK;
        } else if (Platform.OS === 'android') {
          deviceId = Application.getAndroidId() ?? DEVICE_ID_FALLBACK;
        }
      } catch {
        // fall back to the static default
      }

      const r = await api.post<{
        user: { id: string; phone: string; role: 'rider' | 'captain' | 'admin'; fullName: string | null; isTester?: boolean; mustResetPassword?: boolean };
        tokens: { accessToken: string; refreshToken: string };
      }>('/auth/login', {
        phone: normalizedPhone,
        password: pwd,
        role,
        deviceId,
      });

      await setSession({
        user: {
          id: r.data.user.id,
          phone: r.data.user.phone,
          role: r.data.user.role,
          fullName: r.data.user.fullName,
          // Without this the dataset-collection entry stays hidden until the
          // next cold start: the /auth/me refresh that carries this flag runs
          // only on layout mount, which has already passed by the time a login
          // completes.
          isTester: r.data.user.isTester ?? false,
        },
        accessToken: r.data.tokens.accessToken,
        refreshToken: r.data.tokens.refreshToken,
      });

      router.replace('/(app)');
    } catch (e: any) {
      const err = e.response?.data?.error;
      const status = e.response?.status;
      let title = t('common.error');
      let msg = err?.message ?? t('errors.server');

      if (status === 401 || err?.code === 'invalid_credentials') {
        title = t('auth.login.invalidCredsTitle');
        msg = t('auth.login.invalidCredsBody');
      } else if (status === 403 && err?.code === 'no_password_set') {
        title = t('auth.login.notActivatedTitle');
        msg = t('auth.login.notActivatedBody');
      } else if (status === 429) {
        title = t('auth.login.tooManyTitle');
        msg = err?.message ?? t('auth.login.tooManyBody');
      }
      Alert.alert(title, msg);
    } finally {
      setBusy(false);
    }
  }

  async function startDemo(roleAccount: DemoRole) {
    setDemoRole(roleAccount);
    try {
      await loginAsDemo(roleAccount);
      router.replace('/(app)');
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message ?? t('errors.server');
      Alert.alert(t('common.error'), msg);
    } finally {
      setDemoRole(null);
    }
  }

  function contactAdmin() {
    const url = 'https://wa.me/22233322777?text=' +
      encodeURIComponent(t('auth.login.contactMessage', { app: APP_NAME }));
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
              {t('auth.login.title')}
            </AppText>
            <AppText variant="body" color={colors.ink2} style={{ marginTop: spacing.sm, maxWidth: 320 }}>
              {t('auth.login.subtitle')}
            </AppText>
          </FadeInView>

          <FadeInView delay={60} style={{ marginTop: spacing.xxl, gap: spacing.base }}>
            <TextField
              label={t('auth.login.phoneLabel')}
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
              label={t('auth.login.passwordLabel')}
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

          <Button title={t('auth.login.submit')} iconRight="arrow" busy={busy} onPress={() => submit()} />

          {config.showDemoButtons && (
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
              <Button
                title={t('auth.login.demoRider')}
                variant="secondary"
                icon="person"
                busy={demoRole === 'rider'}
                onPress={() => startDemo('rider')}
                style={{ flex: 1 }}
              />
              <Button
                title={t('auth.login.demoCaptain')}
                variant="secondary"
                icon="captain"
                busy={demoRole === 'captain'}
                onPress={() => startDemo('captain')}
                style={{ flex: 1 }}
              />
            </View>
          )}

          <Pressable onPress={contactAdmin} style={{ marginTop: spacing.xl, alignItems: 'center' }}>
            <AppText variant="caption" color={colors.ink2} align="center">
              {t('auth.login.noAccount')}{' '}
              <AppText variant="caption" color={colors.ember}>{t('auth.login.contactAdmin')}</AppText>
            </AppText>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
