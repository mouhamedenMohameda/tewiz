/**
 * Settings — central control panel for the rider/captain.
 *
 * One screen, four sections: Profile (editable display name), Preferences
 * (language picker — fr / ar / en, with RTL hand-off for Arabic), Notifications
 * (deep-link to system settings since permission flips live there) and About
 * (app version + WhatsApp support). The Account section keeps a link out to
 * the dedicated account.tsx where sign-out and account deletion live.
 *
 * Language change persists locally (AsyncStorage) and best-effort to the server
 * via PATCH /auth/me so the user's preference travels across devices and is
 * picked up by voice transcription / notification copy on the API side.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Platform, Pressable, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Application from 'expo-application';
import { api } from '@/lib/api';
import { useAppConfig } from '@/lib/appConfig';
import { useAuth } from '@/lib/auth';
import {
  AppLanguage, SUPPORTED_LANGUAGES, currentLanguage, isRTL, setLanguage,
} from '@/lib/i18n';
import {
  AppText, Button, Card, Icon, PressableScale, Screen, ScreenHeader, TextField,
  type IconName,
} from '@/components/ui';
import { colors, radius, shadow, spacing } from '@/theme';
import { APP_NAME } from '@/lib/brand';

const SUPPORT_WHATSAPP = '2223332277';

interface CaptainPreferences {
  acceptsColis: boolean;
  acceptsLongDistance: boolean;
}

type CaptainPrefKey = keyof CaptainPreferences;

export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const { latestAndroidUrl, latestIosUrl } = useAppConfig();

  // Profile name — local edit buffer so the input stays editable without
  // round-tripping the auth store on every keystroke.
  const [name, setName] = useState(user?.fullName ?? '');
  const [savingName, setSavingName] = useState(false);
  const [lang, setLang] = useState<AppLanguage>(currentLanguage());
  const [captainPrefs, setCaptainPrefs] = useState<CaptainPreferences | null>(null);
  const [loadingCaptainPrefs, setLoadingCaptainPrefs] = useState(false);
  const [busyCaptainPref, setBusyCaptainPref] = useState<CaptainPrefKey | null>(null);

  useEffect(() => {
    setName(user?.fullName ?? '');
  }, [user?.fullName]);

  useEffect(() => {
    if (user?.role !== 'captain') {
      setCaptainPrefs(null);
      return;
    }
    setLoadingCaptainPrefs(true);
    api.get<CaptainPreferences>('/captain/preferences')
      .then((r) => setCaptainPrefs(r.data))
      .catch(() => setCaptainPrefs(null))
      .finally(() => setLoadingCaptainPrefs(false));
  }, [user?.role]);

  async function saveName() {
    const trimmed = name.trim();
    if (!user || trimmed === (user.fullName ?? '')) return;
    setSavingName(true);
    try {
      const r = await api.patch<{ id: string; phone: string | null; role: 'rider' | 'captain' | 'admin'; fullName: string | null }>(
        '/auth/me',
        { fullName: trimmed.length ? trimmed : null },
      );
      await setUser({
        ...user,
        fullName: r.data.fullName,
        phone: r.data.phone,
        role: r.data.role,
      });
      Alert.alert(t('settings.profile.saved'));
    } catch (e: any) {
      Alert.alert(
        t('common.error'),
        e?.response?.data?.error?.message ?? t('settings.profile.saveError'),
      );
    } finally {
      setSavingName(false);
    }
  }

  async function pickLanguage(next: AppLanguage) {
    if (next === lang) return;
    // Best-effort server sync — failure is fine, the local pref is what
    // drives the UI from now on. Fired BEFORE setLanguage: a direction change
    // reloads the whole JS bundle and nothing after it would run.
    void api.patch('/auth/me', { language: next }).catch(() => undefined);
    const { needsRestart } = await setLanguage(next);
    setLang(next);
    // Only reachable when the direction didn't change or the automatic
    // reload wasn't available — ask for a manual restart then.
    if (needsRestart) {
      Alert.alert(t('settings.preferences.restartTitle'), t('settings.preferences.restartBody'));
    }
  }

  async function toggleCaptainPref(key: CaptainPrefKey, next: boolean) {
    if (!captainPrefs) return;
    setBusyCaptainPref(key);
    const prev = captainPrefs;
    setCaptainPrefs({ ...captainPrefs, [key]: next });
    try {
      const r = await api.patch<CaptainPreferences>('/captain/preferences', { [key]: next });
      setCaptainPrefs(r.data);
    } catch (e: any) {
      setCaptainPrefs(prev);
      Alert.alert(
        t('captain.preferences.saveError'),
        e?.response?.data?.error?.message ?? '',
      );
    } finally {
      setBusyCaptainPref(null);
    }
  }

  function openSystemSettings() {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:').catch(() => undefined);
    } else {
      Linking.openSettings().catch(() => undefined);
    }
  }

  function contactSupport() {
    const msg = encodeURIComponent(t('settings.about.supportMessage', { app: APP_NAME }));
    Linking.openURL(`https://wa.me/${SUPPORT_WHATSAPP}?text=${msg}`).catch(() => undefined);
  }

  function openDownload(url: string) {
    Linking.openURL(url).catch(() =>
      Alert.alert(t('common.error'), t('settings.download.openError')),
    );
  }

  const version = Application.nativeApplicationVersion ?? '—';
  const build = Application.nativeBuildVersion ?? '—';
  const nameDirty = name.trim() !== (user?.fullName ?? '');

  return (
    <Screen scroll>
      <ScreenHeader title={t('settings.title')} onBack={() => router.back()} />

      {/* Profile */}
      <Section title={t('settings.profile.section')}>
        <Card padding={spacing.lg} style={{ gap: spacing.md }}>
          <TextField
            label={t('settings.profile.name')}
            icon="person"
            value={name}
            onChangeText={setName}
            placeholder={t('settings.profile.namePlaceholder')}
            autoCapitalize="words"
            maxLength={80}
          />
          <ReadOnlyRow
            icon="phone"
            label={t('settings.profile.phone')}
            value={user?.phone ?? t('settings.profile.noPhone')}
          />
          {nameDirty ? (
            <Button
              title={t('common.save')}
              icon="check"
              busy={savingName}
              onPress={saveName}
            />
          ) : null}
        </Card>
      </Section>

      {/* Preferences — language */}
      <Section title={t('settings.preferences.section')}>
        <Card padding={spacing.lg} style={{ gap: spacing.md }}>
          <AppText variant="label" color={colors.ink2}>
            {t('settings.preferences.language')}
          </AppText>
          <View style={{ gap: spacing.sm }}>
            {SUPPORTED_LANGUAGES.map((code) => (
              <LanguageRow
                key={code}
                code={code}
                active={code === lang}
                onPress={() => pickLanguage(code)}
              />
            ))}
          </View>
          <AppText variant="caption" color={colors.muted} style={{ lineHeight: 18 }}>
            {t('settings.preferences.languageHint')}
          </AppText>
        </Card>
      </Section>

      {/* Home modules */}
      <Section title={t('settings.modules.section')}>
        <Card
          onPress={() => router.push('/(app)/manage-modules')}
          padding={spacing.lg}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
        >
          <RoundIcon name="tune" tint={colors.emberSoft} fg={colors.ember} />
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{t('settings.modules.open')}</AppText>
            <AppText variant="caption" color={colors.muted} style={{ marginTop: 2, lineHeight: 18 }}>
              {t('settings.modules.hint')}
            </AppText>
          </View>
          <Icon name="chevron" size={20} color={colors.faint} />
        </Card>
      </Section>

      {/* Roadside provider — any user (rider or captain) can offer assistance */}
      <Section title="Assistance routière">
        <Card
          onPress={() => router.push('/(app)/roadside/provider')}
          padding={spacing.lg}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
        >
          <RoundIcon name="shield" tint="#FDECEC" fg={colors.danger} />
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">Je suis dépanneur</AppText>
            <AppText variant="caption" color={colors.muted} style={{ marginTop: 2, lineHeight: 18 }}>
              Proposez votre aide et recevez les demandes de dépannage proches.
            </AppText>
          </View>
          <Icon name="chevron" size={20} color={colors.faint} />
        </Card>
      </Section>

      {user?.role === 'captain' ? (
        <Section title={t('captain.preferences.title')}>
          <Card padding={spacing.lg} style={{ gap: spacing.md }}>
            <AppText variant="caption" color={colors.ink2} style={{ lineHeight: 18 }}>
              {t('captain.preferences.intro')}
            </AppText>
            {loadingCaptainPrefs ? (
              <View style={{ paddingVertical: spacing.sm }}>
                <ActivityIndicator color={colors.ember} />
              </View>
            ) : null}
            {captainPrefs ? (
              <View style={{ gap: spacing.md }}>
                <CaptainPrefRow
                  icon="parcel"
                  tint={colors.emberSoft}
                  fg={colors.ember}
                  title={t('captain.preferences.colis')}
                  hint={t('captain.preferences.colisHint')}
                  value={captainPrefs.acceptsColis}
                  busy={busyCaptainPref === 'acceptsColis'}
                  onChange={(v) => toggleCaptainPref('acceptsColis', v)}
                />
                <CaptainPrefRow
                  icon="ride"
                  tint={colors.saffronSoft}
                  fg={colors.warning}
                  title={t('captain.preferences.longDistance')}
                  hint={t('captain.preferences.longDistanceHint')}
                  value={captainPrefs.acceptsLongDistance}
                  busy={busyCaptainPref === 'acceptsLongDistance'}
                  onChange={(v) => toggleCaptainPref('acceptsLongDistance', v)}
                />
              </View>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {/* Notifications */}
      <Section title={t('settings.notifications.section')}>
        <Card
          onPress={openSystemSettings}
          padding={spacing.lg}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
        >
          <RoundIcon name="alert" tint={colors.saffronSoft} fg={colors.warning} />
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{t('settings.notifications.open')}</AppText>
            <AppText variant="caption" color={colors.muted} style={{ marginTop: 2, lineHeight: 18 }}>
              {t('settings.notifications.hint')}
            </AppText>
          </View>
          <Icon name="chevron" size={20} color={colors.faint} />
        </Card>
      </Section>

      {/* Account */}
      <Section title={t('settings.account.section')}>
        <Card
          onPress={() => router.push('/(app)/account')}
          padding={spacing.lg}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
        >
          <RoundIcon name="person" tint={colors.emberSoft} fg={colors.ember} />
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{t('settings.account.open')}</AppText>
            <AppText variant="caption" color={colors.muted} style={{ marginTop: 2, lineHeight: 18 }}>
              {t('settings.account.openHint')}
            </AppText>
          </View>
          <Icon name="chevron" size={20} color={colors.faint} />
        </Card>
      </Section>

      {/* About */}
      <Section title={t('settings.about.section')}>
        <Card padding={spacing.lg} style={{ gap: spacing.md }}>
          <ReadOnlyRow
            icon="sparkle"
            label={t('settings.about.version')}
            value={`${version} (${build})`}
          />
          <Pressable
            onPress={contactSupport}
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: spacing.md,
              paddingVertical: spacing.sm,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <RoundIcon name="whatsapp" tint="#E6F6EC" fg={colors.success} />
            <AppText variant="bodyStrong" color={colors.ember} style={{ flex: 1 }}>
              {t('settings.about.support')}
            </AppText>
            <Icon name="arrow" size={18} color={colors.ember} />
          </Pressable>
        </Card>
      </Section>

      {/* Download the latest build — links managed from the admin panel. Each
          store card is hidden when its URL is not configured. */}
      {latestAndroidUrl || latestIosUrl ? (
        <Section title={t('settings.download.section')}>
          <AppText variant="caption" color={colors.muted} style={{ lineHeight: 18, marginBottom: spacing.md }}>
            {t('settings.download.hint')}
          </AppText>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            {latestAndroidUrl ? (
              <PressableScale
                onPress={() => openDownload(latestAndroidUrl)}
                style={[shadow.card, { flex: 1, aspectRatio: 1, borderRadius: radius.xl }]}
              >
                <View style={{ flex: 1, borderRadius: radius.xl, overflow: 'hidden' }}>
                  <Image
                    source={require('@/assets/stores/playstore.png')}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                </View>
              </PressableScale>
            ) : null}
            {latestIosUrl ? (
              <PressableScale
                onPress={() => openDownload(latestIosUrl)}
                style={[shadow.card, { flex: 1, aspectRatio: 1, borderRadius: radius.xl }]}
              >
                <View style={{ flex: 1, borderRadius: radius.xl, overflow: 'hidden' }}>
                  <Image
                    source={require('@/assets/stores/appstore.png')}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                </View>
              </PressableScale>
            ) : null}
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}

function CaptainPrefRow({
  icon, tint, fg, title, hint, value, busy, onChange,
}: {
  icon: 'parcel' | 'ride';
  tint: string;
  fg: string;
  title: string;
  hint: string;
  value: boolean;
  busy: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base }}>
      <RoundIcon name={icon} tint={tint} fg={fg} size={46} iconSize={24} />
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="caption" color={colors.ink2} style={{ marginTop: 2 }}>{hint}</AppText>
      </View>
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: colors.lineStrong, true: fg }}
          thumbColor={colors.white}
          ios_backgroundColor={colors.lineStrong}
        />
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: spacing.xl }}>
      <AppText variant="overline" color={colors.muted} style={{ marginBottom: spacing.sm }}>
        {title}
      </AppText>
      {children}
    </View>
  );
}

function ReadOnlyRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <RoundIcon name={icon} tint={colors.sunken} fg={colors.ink2} size={40} iconSize={20} />
      <View style={{ flex: 1 }}>
        <AppText variant="caption" color={colors.muted}>{label}</AppText>
        <AppText variant="bodyStrong" numberOfLines={1} style={{ marginTop: 2 }}>{value}</AppText>
      </View>
    </View>
  );
}

function RoundIcon({
  name, tint, fg, size = 44, iconSize = 22,
}: { name: IconName; tint: string; fg: string; size?: number; iconSize?: number }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: radius.md,
      backgroundColor: tint, alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon name={name} size={iconSize} color={fg} />
    </View>
  );
}

function LanguageRow({
  code, active, onPress,
}: { code: AppLanguage; active: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const rtl = isRTL(code);
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.98}
      style={{
        // Plain `row`: the native direction mirrors it already, a manual
        // row-reverse would double-flip under RTL. Only the label's text
        // direction follows the row's own language.
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingVertical: spacing.md, paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        backgroundColor: active ? colors.emberSoft : colors.surface,
        borderWidth: 1,
        borderColor: active ? colors.ember : colors.line,
        ...(active ? shadow.card : null),
      }}
    >
      <View style={{
        width: 28, height: 28, borderRadius: 14,
        backgroundColor: active ? colors.ember : colors.sunken,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {active ? <Icon name="checkSmall" size={18} color={colors.onEmber} /> : null}
      </View>
      <AppText
        variant="bodyStrong"
        color={active ? colors.ember : colors.ink}
        align={rtl ? 'right' : 'left'}
        style={{ flex: 1, writingDirection: rtl ? 'rtl' : 'ltr' }}
      >
        {t(`languages.${code}` as const)}
      </AppText>
      <AppText variant="caption" color={colors.muted}>{code.toUpperCase()}</AppText>
    </PressableScale>
  );
}
