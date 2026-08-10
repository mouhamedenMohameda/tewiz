/**
 * Welcome / entry screen.
 *
 * No sign-up required: the primary CTA enters the app as an anonymous guest
 * rider (POST /auth/guest). The phone number is captured later, the first time
 * it's actually needed (before a ride or a captain application). Users who
 * already have an account (e.g. a captain on a new device) can still log in via
 * the secondary "J'ai déjà un compte" action.
 *
 * Visual: a golden-hour gradient header carries the brand; the actions sit on
 * the warm sand canvas below.
 */

import { useState } from 'react';
import { Alert, Dimensions, Image, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { loginAsDemo, loginAsGuest, type DemoRole } from '@/lib/guest';
import { useAppConfig } from '@/lib/appConfig';
import { AppLanguage, SUPPORTED_LANGUAGES, currentLanguage, setLanguage } from '@/lib/i18n';
import { colors, gradients, radius, shadow, spacing } from '@/theme';
import { AppText, Button, FadeInView, Icon, PressableScale, Sheet } from '@/components/ui';
import { APP_NAME } from '@/lib/brand';

const { height: SCREEN_H } = Dimensions.get('window');

export default function AuthWelcome() {
  const router = useRouter();
  const { t } = useTranslation();
  const config = useAppConfig();
  const [busy, setBusy] = useState(false);
  const [demoRole, setDemoRole] = useState<DemoRole | null>(null);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [lang, setLangState] = useState<AppLanguage>(currentLanguage());

  async function pickLanguage(next: AppLanguage) {
    setShowLangPicker(false);
    if (next === lang) return;
    const { needsRestart } = await setLanguage(next);
    setLangState(next);
    if (needsRestart) {
      Alert.alert(t('settings.preferences.restartTitle'), t('settings.preferences.restartBody'));
    }
  }

  async function startGuest() {
    setBusy(true);
    try {
      await loginAsGuest();
      router.replace('/(app)');
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message ?? t('errors.network');
      Alert.alert(t('common.error'), msg);
    } finally {
      setBusy(false);
    }
  }

  async function startDemo(role: DemoRole) {
    setDemoRole(role);
    try {
      await loginAsDemo(role);
      router.replace('/(app)');
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message ?? t('errors.network');
      Alert.alert(t('common.error'), msg);
    } finally {
      setDemoRole(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {/* Golden-hour header wash */}
      <LinearGradient
        colors={gradients.sunrise}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: SCREEN_H * 0.56,
          borderBottomLeftRadius: 44,
          borderBottomRightRadius: 44,
        }}
      />
      {/* Faint sun glow behind the brand */}
      <View
        style={{
          position: 'absolute',
          top: SCREEN_H * 0.06,
          alignSelf: 'center',
          width: 260, height: 260, borderRadius: 130,
          backgroundColor: colors.saffron,
          opacity: 0.35,
        }}
      />

      <SafeAreaView style={{ flex: 1 }}>
        {/* Language picker button — top right */}
        <View style={{ alignItems: 'flex-end', paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
          <Pressable
            onPress={() => setShowLangPicker(true)}
            hitSlop={10}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderRadius: radius.pill,
              backgroundColor: 'rgba(255,255,255,0.25)',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Icon name="globe" size={16} color={colors.white} />
            <AppText variant="caption" color={colors.white} style={{ fontWeight: '600' }}>
              {lang.toUpperCase()}
            </AppText>
          </Pressable>
        </View>

        <View style={{ flex: 1, paddingHorizontal: spacing.xl, justifyContent: 'space-between' }}>
          {/* Brand */}
          <FadeInView delay={40} style={{ alignItems: 'center', marginTop: SCREEN_H * 0.12 }}>
            <Image
              source={require('@/assets/icon.png')}
              style={{
                width: 104, height: 104, borderRadius: radius.xxl,
                ...shadow.raised,
              }}
            />

            <AppText
              variant="hero"
              color={colors.white}
              style={{ marginTop: spacing.lg, fontSize: 40, letterSpacing: -1.2 }}
            >
              {APP_NAME}
            </AppText>
            <AppText
              variant="title"
              color={colors.onEspresso}
              align="center"
              style={{ marginTop: spacing.xs, maxWidth: 280, opacity: 0.95 }}
            >
              {t('auth.welcome.tagline')}
            </AppText>
          </FadeInView>

          {/* Actions */}
          <FadeInView delay={120}>
            <Button
              title={t('auth.welcome.primary')}
              variant="dark"
              iconRight="arrow"
              busy={busy}
              onPress={startGuest}
            />
            <View style={{ height: spacing.md }} />
            <Button
              title={t('auth.welcome.secondary')}
              variant="secondary"
              icon="person"
              onPress={() => router.push('/(auth)/phone')}
            />

            {/* Reviewer / demo access — only shown when showDemoButtons is
                enabled server-side (PUT /admin/settings { showDemoButtons: true }).
                Enabled before App Store / Google Play submissions, disabled
                after approval so real users never see these buttons. */}
            {config.showDemoButtons && (
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                <Button
                  title={t('auth.welcome.demoRider')}
                  variant="ghost"
                  icon="person"
                  busy={demoRole === 'rider'}
                  onPress={() => startDemo('rider')}
                  style={{ flex: 1 }}
                />
                <Button
                  title={t('auth.welcome.demoCaptain')}
                  variant="ghost"
                  icon="captain"
                  busy={demoRole === 'captain'}
                  onPress={() => startDemo('captain')}
                  style={{ flex: 1 }}
                />
              </View>
            )}

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.sm,
                marginTop: spacing.xl,
                marginBottom: spacing.sm,
                paddingHorizontal: spacing.base,
              }}
            >
              <Icon name="shield" size={15} color={colors.muted} />
              <AppText variant="caption" color={colors.muted} align="center" style={{ flexShrink: 1 }}>
                {t('auth.welcome.note')}
              </AppText>
            </View>

          </FadeInView>
        </View>
      </SafeAreaView>

      {/* Language picker */}
      <Sheet
        visible={showLangPicker}
        onClose={() => setShowLangPicker(false)}
        title={t('settings.preferences.language')}
        // Nothing to type here, so the sheet's height stays put.
        avoidKeyboard={false}
        contentStyle={{ gap: spacing.sm }}
      >
        {SUPPORTED_LANGUAGES.map((code) => (
          <PressableScale
            key={code}
            onPress={() => pickLanguage(code)}
            scaleTo={0.98}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.md,
              borderRadius: radius.md,
              backgroundColor: code === lang ? colors.emberSoft : colors.surface,
              borderWidth: 1,
              borderColor: code === lang ? colors.ember : colors.line,
            }}
          >
            <View
              style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: code === lang ? colors.ember : colors.sunken,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              {code === lang ? <Icon name="checkSmall" size={18} color={colors.onEmber} /> : null}
            </View>
            <AppText
              variant="bodyStrong"
              color={code === lang ? colors.ember : colors.ink}
              style={{ flex: 1 }}
            >
              {t(`languages.${code}` as const)}
            </AppText>
            <AppText variant="caption" color={colors.muted}>{code.toUpperCase()}</AppText>
          </PressableScale>
        ))}
      </Sheet>
    </View>
  );
}
