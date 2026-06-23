import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Easing, Pressable, Switch, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatMru } from '@/lib/format';
import { usePolling } from '@/lib/usePolling';
import { ModeToggle } from '@/components/ModeToggle';
import { resetRideAlerts } from '@/components/CaptainRideWatcher';
import {
  AppText, Button, Card, FadeInView, Icon, PressableScale, Screen, type IconName,
} from '@/components/ui';
import { colors, gradients, radius, shadow, spacing } from '@/theme';
import { APP_NAME } from '@/lib/brand';

type Presence = 'offline' | 'online' | 'on_ride';

interface WalletSummary {
  balanceMru: number;
  updatedAt: string;
}

interface StateRow {
  presence: Presence;
  updated_at: string;
  lat: number | null;
  lng: number | null;
}

interface GoingHomeSession {
  id: string;
  startedAt: string;
  expiresAt: string;
}

export default function CaptainHome() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const user = useAuth((s) => s.user);

  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [state, setState] = useState<StateRow | null>(null);
  const [goingHome, setGoingHome] = useState<GoingHomeSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [togglingGoingHome, setTogglingGoingHome] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [walletRes, stateRes, ghRes] = await Promise.allSettled([
        api.get<WalletSummary>('/captain/wallet'),
        api.get<StateRow>('/captain/state'),
        api.get<GoingHomeSession>('/captain/state/going-home'),
      ]);
      if (walletRes.status === 'fulfilled') setWallet(walletRes.value.data);
      if (stateRes.status === 'fulfilled') {
        setState(stateRes.value.data);
      } else {
        // 404 = no state row yet → captain has never been online.
        setState({ presence: 'offline', updated_at: '', lat: null, lng: null });
      }
      if (ghRes.status === 'fulfilled' && ghRes.value.status !== 204) {
        setGoingHome(ghRes.value.data);
      } else {
        setGoingHome(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Refresh balance/state/going-home periodically (battery-friendly cadence).
  usePolling(load, 30_000);

  async function goOnline() {
    setToggling(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert(t('captain.state.locationRequiredTitle'),
          t('captain.state.locationRequiredBody', { app: APP_NAME }));
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await api.post('/captain/state/online', {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      });
      await load();
    } catch (e: any) {
      Alert.alert(t('captain.state.errorTitle'),
        e.response?.data?.error?.message ?? t('captain.state.errorOnline'));
    } finally {
      setToggling(false);
    }
  }

  async function goOffline() {
    setToggling(true);
    try {
      await api.post('/captain/state/offline', {});
      await load();
    } catch (e: any) {
      Alert.alert(t('captain.state.errorTitle'),
        e.response?.data?.error?.message ?? t('captain.state.errorOffline'));
    } finally {
      setToggling(false);
    }
  }

  async function toggleGoingHome(next: boolean) {
    setTogglingGoingHome(true);
    try {
      if (next) {
        const r = await api.post<GoingHomeSession>('/captain/state/going-home', {});
        setGoingHome(r.data);
      } else {
        await api.delete('/captain/state/going-home');
        setGoingHome(null);
      }
    } catch (e: any) {
      Alert.alert(t('captain.state.errorTitle'),
        e.response?.data?.error?.message ?? t('captain.state.errorGoingHome'));
    } finally {
      setTogglingGoingHome(false);
    }
  }

  function confirmReset() {
    Alert.alert(
      t('captain.home.resetTitle'),
      t('captain.home.resetBody'),
      [
        { text: t('common.no'), style: 'cancel' },
        {
          text: t('captain.home.resetConfirm'),
          onPress: async () => {
            await resetRideAlerts();
            Alert.alert(t('common.done'), t('captain.home.resetDoneBody'));
          },
        },
      ],
    );
  }

  const presence: Presence = state?.presence ?? 'offline';
  const online = presence === 'online' || presence === 'on_ride';

  return (
    <Screen scroll onRefresh={load} refreshing={loading}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        marginTop: spacing.sm, marginBottom: spacing.lg,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 }}>
          <View style={{
            width: 46, height: 46, borderRadius: radius.md,
            backgroundColor: colors.espresso, alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="captain" size={26} color={colors.saffron} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="overline" color={colors.muted}>{t('captain.home.overline')}</AppText>
            <AppText variant="title" numberOfLines={1} style={{ marginTop: 1 }}>
              {user?.fullName ?? user?.phone}
            </AppText>
          </View>
        </View>
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
          <Icon name="person" size={22} color={colors.ink} />
        </Pressable>
      </View>

      <ModeToggle />

      {/* Online / offline state — the primary control */}
      <FadeInView style={{ marginTop: spacing.lg }}>
        <StateCard
          presence={presence}
          toggling={toggling}
          onGoOnline={goOnline}
          onGoOffline={goOffline}
          onOpenRide={() => router.push('/(app)/captain/rides')}
        />
      </FadeInView>

      {/* Wallet */}
      <FadeInView delay={70}>
        <Card
          onPress={() => router.push('/(app)/captain/wallet')}
          padding={spacing.lg}
          style={{ marginTop: spacing.base, flexDirection: 'row', alignItems: 'center', gap: spacing.base }}
        >
          <View style={{
            width: 50, height: 50, borderRadius: radius.md,
            backgroundColor: colors.saffronSoft, alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="wallet" size={26} color={colors.warning} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="overline" color={colors.muted}>{t('captain.home.wallet')}</AppText>
            <AppText variant="h1" style={{ marginTop: 1 }}>
              {wallet ? formatMru(wallet.balanceMru) : '—'}
            </AppText>
          </View>
          <Icon name="chevron" size={22} color={colors.faint} />
        </Card>
      </FadeInView>

      {/* Going-home */}
      <FadeInView delay={130}>
        <Card
          padding={spacing.lg}
          style={{ marginTop: spacing.base, flexDirection: 'row', alignItems: 'center', gap: spacing.base }}
        >
          <View style={{
            width: 50, height: 50, borderRadius: radius.md,
            backgroundColor: colors.emberSoft, alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="home" size={24} color={colors.ember} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{t('captain.home.goingHome')}</AppText>
            <AppText variant="caption" color={colors.ink2} style={{ marginTop: 2 }}>
              {t('captain.home.goingHomeHint')}
            </AppText>
            {goingHome ? (
              <AppText variant="caption" color={colors.ember} style={{ marginTop: 3 }}>
                {t('captain.home.goingHomeActiveUntil', {
                  time: new Date(goingHome.expiresAt).toLocaleTimeString(i18n.language, {
                    hour: '2-digit', minute: '2-digit',
                  }),
                })}
              </AppText>
            ) : null}
          </View>
          {togglingGoingHome ? (
            <ActivityIndicator color={colors.ember} />
          ) : (
            <Switch
              value={!!goingHome}
              onValueChange={toggleGoingHome}
              disabled={!online}
              trackColor={{ false: colors.lineStrong, true: colors.ember }}
              thumbColor={colors.white}
              ios_backgroundColor={colors.lineStrong}
            />
          )}
        </Card>
      </FadeInView>

      {/* Navigation */}
      <FadeInView delay={190}>
        <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.xxl, marginBottom: spacing.md }}>
          {t('captain.home.manage')}
        </AppText>
        <View style={{ gap: spacing.md }}>
          <NavRow icon="ride" tint={colors.emberSoft} fg={colors.ember}
            title={t('captain.nav.ridesTitle')} subtitle={t('captain.nav.ridesSubtitle')}
            onPress={() => router.push('/(app)/captain/rides')} />
          <NavRow icon="home" tint={colors.saffronSoft} fg={colors.warning}
            title={t('captain.nav.homeTitle')} subtitle={t('captain.nav.homeSubtitle')}
            onPress={() => router.push('/(app)/captain/home-location')} />
          <NavRow icon="heatmap" tint={colors.dangerSoft} fg={colors.danger}
            title={t('captain.nav.heatmapTitle')} subtitle={t('captain.nav.heatmapSubtitle')}
            onPress={() => router.push('/(app)/captain/heatmap')} />
          <NavRow icon="recurring" tint="#E9EFE6" fg={colors.success}
            title={t('captain.nav.recurringTitle')} subtitle={t('captain.nav.recurringSubtitle')}
            onPress={() => router.push('/(app)/captain/recurring')} />
          <NavRow icon="tune" tint={colors.surfaceAlt} fg={colors.ink}
            title={t('captain.nav.preferencesTitle')} subtitle={t('captain.nav.preferencesSubtitle')}
            onPress={() => router.push('/(app)/captain/preferences')} />
        </View>
      </FadeInView>

      <Pressable onPress={confirmReset} style={({ pressed }) => ({
        marginTop: spacing.xl, paddingVertical: spacing.md,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
        opacity: pressed ? 0.6 : 1,
      })}>
        <Icon name="refresh" size={15} color={colors.muted} />
        <AppText variant="label" color={colors.muted}>{t('captain.home.resetAlerts')}</AppText>
      </Pressable>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */

function StateCard({
  presence, toggling, onGoOnline, onGoOffline, onOpenRide,
}: {
  presence: Presence; toggling: boolean;
  onGoOnline: () => void; onGoOffline: () => void;
  onOpenRide: () => void;
}) {
  const { t } = useTranslation();
  const online = presence === 'online' || presence === 'on_ride';
  const onRide = presence === 'on_ride';

  if (online) {
    const gradient = (
      <LinearGradient
        colors={onRide ? gradients.espresso : gradients.sunrise}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: radius.xxl, padding: spacing.xl, ...(onRide ? shadow.raised : shadow.ember) }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <PulseDot color={onRide ? colors.saffron : colors.white} />
          <AppText variant="overline" color={onRide ? colors.saffron : '#FFF1DD'}>{t('captain.state.youAre')}</AppText>
        </View>
        <AppText variant="display" color={colors.white} style={{ marginTop: spacing.xs }}>
          {onRide ? t('captain.state.onRide') : t('captain.state.online')}
        </AppText>
        <AppText variant="body" color={onRide ? colors.onEspressoMuted : '#FFF1DD'} style={{ marginTop: spacing.xs }}>
          {onRide ? t('captain.state.onRideBody') : t('captain.state.onlineBody')}
        </AppText>

        {onRide ? (
          <View
            style={{
              marginTop: spacing.lg,
              borderRadius: radius.lg, paddingVertical: 13,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
              borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)',
            }}
          >
            <Icon name="ride" size={19} color={colors.white} />
            <AppText variant="bodyStrong" color={colors.white}>{t('captain.state.openRide')}</AppText>
            <Icon name="chevron" size={18} color={colors.white} />
          </View>
        ) : (
          <PressableScale
            onPress={onGoOffline}
            disabled={toggling}
            style={{
              marginTop: spacing.lg, opacity: toggling ? 0.6 : 1,
              borderRadius: radius.lg, paddingVertical: 13,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
              borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)',
            }}
          >
            {toggling
              ? <ActivityIndicator color={colors.white} />
              : <Icon name="power" size={19} color={colors.white} />}
            <AppText variant="bodyStrong" color={colors.white}>{t('captain.state.goOffline')}</AppText>
          </PressableScale>
        )}
      </LinearGradient>
    );
    if (onRide) {
      return (
        <PressableScale onPress={onOpenRide} accessibilityLabel={t('captain.state.openRide')}>
          {gradient}
        </PressableScale>
      );
    }
    return gradient;
  }

  return (
    <Card padding={spacing.xl}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.faint }} />
        <AppText variant="overline" color={colors.muted}>{t('captain.state.youAre')}</AppText>
      </View>
      <AppText variant="display" style={{ marginTop: spacing.xs }}>{t('captain.state.offline')}</AppText>
      <AppText variant="body" color={colors.ink2} style={{ marginTop: spacing.xs }}>
        {t('captain.state.offlineBody')}
      </AppText>
      <Button
        title={t('captain.state.goOnline')}
        icon="power"
        busy={toggling}
        onPress={onGoOnline}
        style={{ marginTop: spacing.lg }}
      />
    </Card>
  );
}

function NavRow({
  icon, tint, fg, title, subtitle, onPress,
}: {
  icon: IconName; tint: string; fg: string; title: string; subtitle: string; onPress: () => void;
}) {
  return (
    <Card onPress={onPress} padding={spacing.base}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base }}>
      <View style={{
        width: 46, height: 46, borderRadius: radius.md,
        backgroundColor: tint, alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={24} color={fg} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="title">{title}</AppText>
        <AppText variant="caption" color={colors.ink2} style={{ marginTop: 2 }}>{subtitle}</AppText>
      </View>
      <Icon name="chevron" size={20} color={colors.faint} />
    </Card>
  );
}

/* A soft breathing dot for the live state indicator. */
function PulseDot({ color }: { color: string }) {
  const o = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 0.25, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(o, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [o]);
  return <Animated.View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: color, opacity: o }} />;
}
