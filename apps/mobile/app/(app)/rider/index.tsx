import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Easing, KeyboardAvoidingView,
  Modal, Platform, Pressable, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ModeToggle } from '@/components/ModeToggle';
import { NotificationsBellButton } from '@/components/NotificationsBellButton';
import {
  AppText, Button, Card, FadeInView, Icon, PressableScale, Screen, TextField, wrapRow,
  type IconName,
} from '@/components/ui';
import { colors, gradients, radius, shadow, spacing } from '@/theme';
import { APP_NAME } from '@/lib/brand';
import { useModulePreferences } from '@/lib/modulePreferences';
import { useAppConfig } from '@/lib/appConfig';
import type { AppModule } from '@/lib/modules';
import type { ApplicationDto, ApplicationStatus } from '@/lib/kyc';

type RideStatus =
  | 'pending_passenger_confirm' | 'searching'
  | 'accepted' | 'arrived' | 'in_progress' | 'completed';

interface CurrentRide {
  id: string;
  status: RideStatus;
  pickup: { label: string | null };
  dropoff: { label: string | null };
}

type Intent = 'voice' | 'map' | 'captain';

export default function RiderHome() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);

  const [application, setApplication] = useState<ApplicationDto | null>(null);
  const [loadingApp, setLoadingApp] = useState(true);
  const [current, setCurrent] = useState<CurrentRide | null>(null);

  // Phone gate: a guest must enter a number before booking a ride or applying
  // to be a captain (so the captain can reach them). We stash the intended
  // destination, prompt for the number, then continue.
  const { enabledModules } = useModulePreferences();
  // Admin-managed availability. A service the admin turned off is hidden from
  // the grid (utility modules like history/favorites aren't gated and stay
  // visible). Fail-closed: hidden until the server confirms they're enabled.
  const { modules: moduleFlags } = useAppConfig();
  const visibleModules = enabledModules.filter((m) => moduleFlags[m.key] !== false);

  // Home-screen hierarchy: not every module is worth the same visual weight.
  // Spotlight = the 1-2 services we push hardest. Transport/logistics/food are
  // secondary services tucked behind category tabs. Utility (history,
  // favorites, recurring) are personal shortcuts, bundled into one low-key
  // card so they never compete with actual services for attention.
  const spotlightModules = visibleModules.filter((m) => m.tier === 'spotlight');
  const utilityModules = visibleModules.filter((m) => m.tier === 'utility');
  const categories = ([
    { key: 'transport', label: t('rider.home.tabs.transport') },
    { key: 'logistics', label: t('rider.home.tabs.logistics') },
    { key: 'food', label: t('rider.home.tabs.food') },
  ] as const)
    .map((c) => ({ ...c, modules: visibleModules.filter((m) => m.tier === c.key) }))
    .filter((c) => c.modules.length > 0);
  const [activeCategory, setActiveCategory] = useState<string>('transport');
  const currentCategory = categories.find((c) => c.key === activeCategory) ?? categories[0];

  const [pending, setPending] = useState<Intent | null>(null);
  const [phoneInput, setPhoneInput] = useState('+222');
  const [savingPhone, setSavingPhone] = useState(false);

  const navigateTo = useCallback((intent: Intent) => {
    if (intent === 'voice') router.push('/(app)/rider/voice-ride');
    else if (intent === 'map') router.push('/(app)/rider/new-ride');
    else router.push('/(app)/become-captain');
  }, [router]);

  function go(intent: Intent) {
    if (user?.phone) navigateTo(intent);
    else setPending(intent);
  }

  async function savePhone() {
    if (phoneInput.replace(/\D/g, '').length < 11) {
      Alert.alert(t('phonePrompt.invalidTitle'), t('phonePrompt.invalidBody'));
      return;
    }
    setSavingPhone(true);
    try {
      const r = await api.post<{
        id: string; phone: string;
        role: 'rider' | 'captain' | 'admin'; fullName: string | null;
      }>('/auth/me/phone', { phone: phoneInput });

      const cur = useAuth.getState().user;
      if (cur) {
        await setUser({ ...cur, phone: r.data.phone, role: r.data.role, fullName: r.data.fullName });
      }
      const intent = pending;
      setPending(null);
      if (intent) navigateTo(intent);
    } catch (e: any) {
      const code = e?.response?.data?.error?.code;
      if (code === 'phone_taken') {
        // The number already belongs to an account (e.g. an existing client,
        // a captain, or the admin). A guest can't claim it — guide them to log
        // in to that account instead of dead-ending on an error.
        Alert.alert(
          t('phonePrompt.takenTitle'),
          t('phonePrompt.takenBody', { app: APP_NAME }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('phonePrompt.takenAction'),
              onPress: () => { setPending(null); router.push('/(auth)/phone'); },
            },
          ],
        );
        return;
      }
      const msg = e?.response?.data?.error?.message ?? t('phonePrompt.saveError');
      Alert.alert(t('common.error'), msg);
    } finally {
      setSavingPhone(false);
    }
  }

  const loadApp = useCallback(async () => {
    // Captains don't need to see the "become captain" CTA.
    if (user?.role === 'captain') {
      setApplication(null);
      setLoadingApp(false);
    } else {
      try {
        const r = await api.get<ApplicationDto | null>('/captain/applications/me');
        setApplication(r.data);
      } catch {
        setApplication(null);
      } finally {
        setLoadingApp(false);
      }
    }
    // Always check for an active ride so the "course en cours" banner shows.
    try {
      const r = await api.get<CurrentRide>('/rider/rides/current', {
        validateStatus: (s) => s === 200 || s === 204,
      });
      setCurrent(r.status === 200 ? r.data : null);
    } catch {
      setCurrent(null);
    }
  }, [user?.role]);

  // `useFocusEffect` ALREADY fires on first focus, which for this screen is its
  // mount. Pairing it with a `useEffect(loadApp)` — as this did — meant every
  // arrival on the home screen fired both endpoints twice: four requests where
  // two would do, on a network where that is measured in seconds.
  useFocusEffect(useCallback(() => { loadApp(); }, [loadApp]));

  const blocked = !!current;

  return (
    <Screen scroll onRefresh={loadApp}>
      {/* Header — plain `row` everywhere: Yoga already mirrors rows when the
          native direction is RTL, so a manual row-reverse double-flips the
          layout back to LTR. Never hand-flip direction in screens. */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center', justifyContent: 'space-between',
        marginTop: spacing.sm, marginBottom: spacing.lg,
      }}>
        <View style={{
          flexDirection: 'row',
          alignItems: 'center', gap: spacing.md, flex: 1,
        }}>
          <View style={{
            width: 46, height: 46, borderRadius: radius.md,
            backgroundColor: colors.emberSoft, alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="person" size={28} color={colors.ember} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="overline" color={colors.muted}>{t('common.hello')}</AppText>
            <AppText variant="title" numberOfLines={1} style={{ marginTop: 1 }}>
              {user?.fullName ?? user?.phone}
            </AppText>
          </View>
        </View>
        <View style={{
          flexDirection: 'row',
          alignItems: 'center', gap: spacing.sm,
        }}>
          <NotificationsBellButton />
          <Pressable
            onPress={() => router.push('/(app)/settings')}
            hitSlop={10}
            accessibilityLabel={t('settings.title')}
            style={{
              width: 44, height: 44, borderRadius: radius.md,
              backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
              ...shadow.card,
            }}
          >
            <Icon name="tune" size={22} color={colors.ink} />
          </Pressable>
        </View>
      </View>

      <ModeToggle />

      {/* Active ride */}
      {current ? (
        <FadeInView>
          <LiveRideBanner
            label={t(`rider.status.${current.status}` as const) || current.status}
            onPress={() => router.push('/(app)/rider/current')}
          />
        </FadeInView>
      ) : null}

      {/* Hero — order a ride */}
      <FadeInView delay={30} style={{ marginTop: spacing.lg }}>
        <Hero
          blocked={blocked}
          onVoice={() => go('voice')}
          onMap={() => go('map')}
        />
      </FadeInView>

      {/* Spotlight — the services we push hardest get a full-size featured card. */}
      {spotlightModules.length > 0 ? (
        <FadeInView delay={60}>
          <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.xxl, marginBottom: spacing.md }}>
            {t('rider.home.discover')}
          </AppText>
          <View style={{ flexDirection: wrapRow, gap: spacing.md }}>
            {spotlightModules.map((m) => (
              <SpotlightCard
                key={m.key}
                icon={m.icon}
                label={t(m.label as any)}
                subtitle={t(`rider.home.spotlightSubtitle.${m.key}` as any)}
                tint={m.tint}
                fg={m.fg}
                onPress={() => router.push(m.route as any)}
              />
            ))}
          </View>
        </FadeInView>
      ) : null}

      {/* Secondary services — grouped behind category tabs instead of one flat grid. */}
      {categories.length > 0 && currentCategory ? (
        <FadeInView delay={90} style={{ marginTop: spacing.xxl }}>
          <CategoryTabs
            categories={categories}
            active={currentCategory.key}
            onChange={setActiveCategory}
          />
          <View style={{ flexDirection: wrapRow, flexWrap: 'wrap', gap: spacing.md }}>
            {currentCategory.modules.map((m) => (
              <QuickTile
                key={m.key}
                icon={m.icon}
                label={t(m.label as any)}
                tint={m.tint}
                fg={m.fg}
                onPress={() => router.push(m.route as any)}
              />
            ))}
          </View>
        </FadeInView>
      ) : null}

      {/* Personal shortcuts — bundled into one low-emphasis card, not services. */}
      {utilityModules.length > 0 ? (
        <FadeInView delay={120} style={{ marginTop: spacing.xxl }}>
          <QuickAccessBundle modules={utilityModules} onPress={(route) => router.push(route as any)} />
        </FadeInView>
      ) : null}

      {/* Become a captain — riders only */}
      {user?.role === 'rider' ? (
        <FadeInView delay={150} style={{ marginTop: spacing.xxl }}>
          <BecomeCaptainCard
            loading={loadingApp}
            application={application}
            onPress={() => go('captain')}
          />
        </FadeInView>
      ) : null}

      <PhonePrompt
        visible={pending !== null}
        value={phoneInput}
        onChange={setPhoneInput}
        onCancel={() => setPending(null)}
        onSave={savePhone}
        busy={savingPhone}
      />
    </Screen>
  );
}

/* ------------------------------------------------------------------ */

function PhonePrompt({
  visible, value, onChange, onCancel, onSave, busy,
}: {
  visible: boolean;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}
      >
        <View
          style={{
            backgroundColor: colors.canvas,
            borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
            padding: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.base,
          }}
        >
          <View
            style={{
              width: 48, height: 48, borderRadius: radius.md,
              backgroundColor: colors.emberSoft, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon name="phone" size={26} color={colors.ember} />
          </View>
          <AppText variant="h2">{t('phonePrompt.title')}</AppText>
          <AppText variant="body" color={colors.ink2}>
            {t('phonePrompt.body')}
          </AppText>
          <TextField
            label={t('phonePrompt.phoneLabel')}
            icon="phone"
            autoFocus
            keyboardType="phone-pad"
            value={value}
            onChangeText={onChange}
            placeholder="+22245XXXXXXX"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="telephoneNumber"
          />
          <Button title={t('common.saveAndContinue')} iconRight="arrow" busy={busy} onPress={onSave} />
          <Pressable onPress={onCancel} hitSlop={8} style={{ alignItems: 'center', paddingVertical: spacing.sm }}>
            <AppText variant="caption" color={colors.ink2}>{t('common.cancel')}</AppText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

function LiveRideBanner({ label, onPress }: { label: string; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Card
      onPress={onPress}
      background={colors.espresso}
      elevation="raised"
      padding={spacing.base}
      style={{ marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
    >
      <View style={{
        width: 44, height: 44, borderRadius: radius.md,
        backgroundColor: 'rgba(246,166,35,0.18)', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="ride" size={26} color={colors.saffron} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <PulseDot />
          <AppText variant="overline" color={colors.saffron}>{t('rider.home.currentRide')}</AppText>
        </View>
        <AppText variant="bodyStrong" color={colors.onEspresso} style={{ marginTop: 3 }} numberOfLines={1}>
          {label}
        </AppText>
      </View>
      <Icon name="chevron" size={22} color={colors.onEspressoMuted} />
    </Card>
  );
}

function Hero({ blocked, onVoice, onMap }: { blocked: boolean; onVoice: () => void; onMap: () => void }) {
  const { t } = useTranslation();
  return (
    <LinearGradient
      colors={gradients.sunrise}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: radius.xxl, padding: spacing.xl, ...shadow.ember }}
    >
      <AppText variant="overline" color={colors.onEspresso}>{t('rider.hero.overline')}</AppText>
      {/* alignSelf pins the width-capped title to the reading edge (logical:
          left in LTR, right in RTL) — without it the 240pt box floats. */}
      <AppText
        variant="h1"
        color={colors.white}
        style={{ marginTop: spacing.xs, maxWidth: 240, alignSelf: 'flex-start' }}
      >
        {t('rider.hero.title')}
      </AppText>

      {/* Primary: voice-first. A human agent places the ride from your memo. */}
      <PressableScale
        onPress={blocked ? undefined : onVoice}
        disabled={blocked}
        style={{
          marginTop: spacing.lg, backgroundColor: colors.white, opacity: blocked ? 0.55 : 1,
          borderRadius: radius.lg, paddingVertical: 15, paddingHorizontal: spacing.lg,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
          ...shadow.card,
        }}
      >
        <Icon name="voice" size={22} color={colors.ember} />
        <AppText variant="title" color={colors.ember}>
          {blocked ? t('rider.hero.blocked') : t('rider.hero.voice')}
        </AppText>
      </PressableScale>

      {/* Secondary: pick on the map manually. */}
      <PressableScale
        onPress={blocked ? undefined : onMap}
        disabled={blocked}
        style={{
          marginTop: spacing.sm, opacity: blocked ? 0.4 : 1,
          borderRadius: radius.lg, paddingVertical: 13,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
          borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)',
        }}
      >
        <Icon name="map" size={19} color={colors.white} />
        <AppText variant="bodyStrong" color={colors.white}>{t('rider.hero.map')}</AppText>
      </PressableScale>
    </LinearGradient>
  );
}

function QuickTile({
  icon, label, tint, fg, onPress,
}: { icon: IconName; label: string; tint: string; fg: string; onPress: () => void }) {
  return (
    // `flex-start` is logical: Yoga resolves it to the right edge under RTL.
    <Card onPress={onPress} padding={spacing.base} style={{ flexBasis: '47%', flexGrow: 1, alignItems: 'flex-start' }}>
      <View style={{
        width: 46, height: 46, borderRadius: radius.md,
        backgroundColor: tint, alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={24} color={fg} />
      </View>
      <AppText variant="label" style={{ marginTop: spacing.md }} numberOfLines={1}>{label}</AppText>
    </Card>
  );
}

function SpotlightCard({
  icon, label, subtitle, tint, fg, onPress,
}: { icon: IconName; label: string; subtitle: string; tint: string; fg: string; onPress: () => void }) {
  return (
    <Card onPress={onPress} padding={spacing.lg} style={{ flex: 1, alignItems: 'center' }}>
      <View style={{
        width: 56, height: 56, borderRadius: radius.lg,
        backgroundColor: tint, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
      }}>
        <Icon name={icon} size={26} color={fg} />
      </View>
      <AppText variant="title" align="center" numberOfLines={1}>{label}</AppText>
      <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: 3 }} numberOfLines={1}>
        {subtitle}
      </AppText>
    </Card>
  );
}

function CategoryTabs({
  categories, active, onChange,
}: { categories: { key: string; label: string }[]; active: string; onChange: (key: string) => void }) {
  return (
    <View style={{ flexDirection: wrapRow, flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
      {categories.map((c) => {
        const isActive = c.key === active;
        return (
          <PressableScale
            key={c.key}
            onPress={() => onChange(c.key)}
            style={{
              paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill,
              backgroundColor: isActive ? colors.ember : colors.surfaceAlt,
            }}
          >
            <AppText variant="label" color={isActive ? colors.white : colors.ink2}>{c.label}</AppText>
          </PressableScale>
        );
      })}
    </View>
  );
}

function QuickAccessBundle({
  modules, onPress,
}: { modules: AppModule[]; onPress: (route: string) => void }) {
  const { t } = useTranslation();
  return (
    <Card padding={spacing.base}>
      <AppText variant="overline" color={colors.muted} style={{ marginBottom: spacing.md }}>
        {t('rider.home.quickAccess')}
      </AppText>
      <View style={{ flexDirection: wrapRow }}>
        {modules.map((m, i) => (
          <Pressable
            key={m.key}
            onPress={() => onPress(m.route)}
            style={{
              flex: 1, alignItems: 'center', gap: 6,
              borderStartWidth: i === 0 ? 0 : 1, borderStartColor: colors.line,
            }}
          >
            <View style={{
              width: 30, height: 30, borderRadius: radius.sm,
              backgroundColor: m.tint, alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name={m.icon} size={15} color={m.fg} />
            </View>
            <AppText variant="caption" numberOfLines={1}>{t(m.label as any)}</AppText>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

function BecomeCaptainCard({
  loading, application, onPress,
}: {
  loading: boolean; application: ApplicationDto | null; onPress: () => void;
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <View style={{ alignItems: 'center', padding: spacing.base }}>
        <ActivityIndicator color={colors.ember} />
      </View>
    );
  }

  const status: ApplicationStatus | null = application?.status ?? null;
  const key = describeKey(status);
  const title = t(`becomeCaptain.status.${key}.title`, { app: APP_NAME });
  const subtitle = t(`becomeCaptain.status.${key}.subtitle`);
  const cta = t(`becomeCaptain.status.${key}.cta`);

  return (
    <Card onPress={onPress} background={colors.espresso} elevation="raised" padding={spacing.xl}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{
          width: 52, height: 52, borderRadius: radius.md,
          backgroundColor: 'rgba(246,166,35,0.16)', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="captain" size={30} color={colors.saffron} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="overline" color={colors.saffron}>{t('becomeCaptain.overline')}</AppText>
          <AppText variant="h2" color={colors.onEspresso} style={{ marginTop: 2 }}>{title}</AppText>
        </View>
      </View>
      <AppText variant="body" color={colors.onEspressoMuted} style={{ marginTop: spacing.md }}>
        {subtitle}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.base }}>
        <AppText variant="bodyStrong" color={colors.saffron}>{cta}</AppText>
        <Icon name="arrow" size={17} color={colors.saffron} />
      </View>
    </Card>
  );
}

type StatusKey = 'none' | 'draft' | 'needs_correction' | 'submitted' | 'rejected' | 'approved';

function describeKey(status: ApplicationStatus | null): StatusKey {
  if (status === null) return 'none';
  if (status === 'under_review') return 'submitted';
  return status as StatusKey;
}

/* A soft breathing dot for the live-ride indicator. */
function PulseDot() {
  const o = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 0.25, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(o, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [o]);
  return (
    <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.saffron, opacity: o }} />
  );
}
