import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Easing, Linking, Pressable, RefreshControl,
  ScrollView, StyleSheet, Switch, useWindowDimensions, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { openWhatsAppLink } from '@/lib/whatsapp';
import { useAuth } from '@/lib/auth';
import { balanceTooLowMessage } from '@/lib/apiError';
import { formatMru } from '@/lib/format';
import { usePolling } from '@/lib/usePolling';
import { getMapbox, NKC_CENTER } from '@/lib/mapbox';
import { resumeOfflineTracking, startOfflineTracking, stopOfflineTracking } from '@/lib/track-task';
import { ensureFullScreenIntentPermission } from '@/lib/fullScreenIntentPermission';
import { ensureOverlayPermission } from '@/lib/overlayPermission';
import { ensureBatteryExemption } from '@/lib/batteryExemption';
import { ModeToggle } from '@/components/ModeToggle';
import { MapShell } from '@/components/MapShell';
import { BottomSheet } from '@/components/BottomSheet';
import { DemandHeatmap, type DemandCell } from '@/components/DemandHeatmap';
import { resetRideAlerts } from '@/components/CaptainRideWatcher';
import { BonusCard } from '@/components/BonusCard';
import { NotificationsBellButton } from '@/components/NotificationsBellButton';
import {
  AppText, Button, Card, FadeInView, Icon, PressableScale, type IconName,
} from '@/components/ui';
import { colors, gradients, radius, shadow, spacing, statusTone } from '@/theme';
import { APP_NAME } from '@/lib/brand';

type Presence = 'offline' | 'online' | 'on_ride';

// Tell the server whether background ("Always") location is granted, so the
// back-office can distinguish a captain who declined tracking from one who is
// simply parked. Best-effort — a failed report must never block going online.
function reportTrackPermission(granted: boolean): void {
  api.post('/captain/state/track-permission', { granted }).catch(() => {});
}

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
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const M = getMapbox();
  const cameraRef = useRef<any>(null);

  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [state, setState] = useState<StateRow | null>(null);
  const [goingHome, setGoingHome] = useState<GoingHomeSession | null>(null);
  const [cells, setCells] = useState<DemandCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  // Captains-only WhatsApp group link (served only to captains via
  // /captain/whatsapp-group). null = admin hasn't configured one → hide it.
  const [captainWhatsappUrl, setCaptainWhatsappUrl] = useState<string | null>(null);
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

  // Load the Captains-only WhatsApp group link once. Best-effort: any failure
  // just leaves the button hidden.
  useEffect(() => {
    let cancelled = false;
    api.get<{ url: string | null }>('/captain/whatsapp-group')
      .then((r) => { if (!cancelled) setCaptainWhatsappUrl(r.data.url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // Refresh balance/state/going-home periodically (battery-friendly cadence).
  usePolling(load, 30_000);

  // Demand heatmap shown under the home map so the captain sees where the
  // rides are the moment they open the app. Best-effort — the map still works
  // without it. Same cadence as the dedicated heatmap screen.
  const loadHeatmap = useCallback(async () => {
    try {
      const r = await api.get<DemandCell[]>('/captain/heatmap');
      setCells(r.data);
    } catch {
      // silent — no blobs is fine, the map keeps working.
    }
  }, []);

  useEffect(() => { loadHeatmap(); }, [loadHeatmap]);
  usePolling(loadHeatmap, 60_000);

  // Centre the map on the captain on mount. Falls back silently to
  // Nouakchott if the permission isn't granted.
  //
  // READS the permission, never requests it: a passive mount must not pop a
  // dialog. The ask belongs to the "Tout autoriser" panel
  // (components/CaptainPermissions.tsx) and to goOnline() below, both of which
  // are moments the captain expects one.
  useEffect(() => {
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        cameraRef.current?.setCamera({
          centerCoordinate: [loc.coords.longitude, loc.coords.latitude],
          zoomLevel: 13,
          animationDuration: 600,
        });
      } catch {}
    })();
  }, []);

  // Enforce mandatory tracking on EVERY restored "online" session — not just
  // when the captain taps "go online". Otherwise a captain reopening the app
  // (server still says online) would appear online, and be dispatched to,
  // without ever granting location tracking.
  useEffect(() => {
    const presence = state?.presence;
    if (presence !== 'online' && presence !== 'on_ride') return;

    // Never disturb a captain mid-ride: just resume tracking passively.
    if (presence === 'on_ride') {
      void resumeOfflineTracking();
      return;
    }

    (async () => {
      // Same rule as going online: try to start tracking (prompts for the
      // permission if needed). If it runs, stay online. If the native service
      // merely fails to start (e.g. an old build), stay online too. Only an
      // actual REFUSAL of the permission takes the captain back offline.
      const started = await startOfflineTracking();
      reportTrackPermission(started);
      if (started) return;

      const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
      if (bg?.status === 'granted') return; // start failed on this build — keep online

      // Phantom-online without the mandatory permission → take them offline and
      // explain, so "online" always means "trackable".
      try {
        await api.post('/captain/state/offline', {});
        await stopOfflineTracking();
      } catch {}
      await load();
      Alert.alert(
        t('captain.state.bgRequiredTitle'),
        t('captain.state.bgRequiredBody', { app: APP_NAME }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('captain.state.openSettings'), onPress: () => { void Linking.openSettings(); } },
        ],
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.presence]);

  async function goOnline() {
    setToggling(true);
    try {
      // 1. Foreground location — required for any GPS fix at all.
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert(t('captain.state.locationRequiredTitle'),
          t('captain.state.locationRequiredBody', { app: APP_NAME }));
        return;
      }

      // 2. Continuous tracking is what keeps the captain's stored position
      //    fresh so dispatch stays relevant. The PERMISSION is the only part
      //    that's the captain's to give, so that's what we enforce:
      //      - startOfflineTracking() returns false when they DECLINE → block
      //        and send them to settings (this is the "mandatory" part).
      //      - it THROWS when the permission is granted but the OS service
      //        can't start (e.g. an old build whose Info.plist/manifest lacks
      //        the background-location config). We must NOT lock a captain out
      //        over a build issue, so we let them go online without live
      //        tracking this session and just log it.
      const trackingStarted = await startOfflineTracking();
      reportTrackPermission(trackingStarted);
      if (!trackingStarted) {
        // Distinguish a real refusal (→ enforce it, tracking is mandatory) from
        // "permission granted but the native service couldn't start" (a build
        // that lacks the background-location config — don't lock the captain
        // out over that; let them go online without live tracking this session).
        const bg = await Location.getBackgroundPermissionsAsync();
        if (bg.status !== 'granted') {
          Alert.alert(
            t('captain.state.bgRequiredTitle'),
            t('captain.state.bgRequiredBody', { app: APP_NAME }),
            [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('captain.state.openSettings'), onPress: () => { void Linking.openSettings(); } },
            ],
          );
          return; // stay offline until continuous tracking is granted
        }
      }

      // 3. Fresh HIGH-accuracy fix (never a cached one from a previous city),
      //    then go online.
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await api.post('/captain/state/online', {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      });

      // Recentre the home map on the freshly-online captain.
      cameraRef.current?.setCamera({
        centerCoordinate: [loc.coords.longitude, loc.coords.latitude],
        zoomLevel: 14,
        animationDuration: 500,
      });

      // Android 14+: make sure the "incoming ride" alert can take over the
      // screen like a call. No-op on iOS / Android < 14 / once already handled.
      void ensureFullScreenIntentPermission();
      // Android: "superposition" (display over other apps). Lets the incoming
      // ride take over the screen even while the captain is using another app,
      // not just over the lock screen. No-op on iOS / once already handled.
      void ensureOverlayPermission({ appName: APP_NAME });
      // Android: keep the OS from dozing the app while online. Without this the
      // incoming-ride alert fires reliably in principle but drops occasionally
      // in practice (~3 rides in 15 on device) because FCM delivery is deferred.
      // No-op on iOS / once already handled.
      void ensureBatteryExemption({ appName: APP_NAME });

      await load();
    } catch (e: any) {
      // Surface the real cause: an API error carries error.message; a native
      // exception (GPS / tracking start) carries e.message. Falling straight to
      // the generic string hid which step actually failed.
      const detail = balanceTooLowMessage(e, t) ?? e?.response?.data?.error?.message ?? e?.message ?? String(e);
      Alert.alert(t('captain.state.errorTitle'), detail || t('captain.state.errorOnline'));
    } finally {
      setToggling(false);
    }
  }

  async function goOffline() {
    setToggling(true);
    try {
      await api.post('/captain/state/offline', {});
      await stopOfflineTracking();
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
      const msg: string = e.response?.data?.error?.message ?? '';
      if (msg.toLowerCase().includes('going-home') && msg.includes('24')) {
        Alert.alert(t('captain.state.goingHomeCooldownTitle'), t('captain.state.goingHomeCooldownBody'));
      } else {
        Alert.alert(t('captain.state.errorTitle'), balanceTooLowMessage(e, t) ?? (msg || t('captain.state.errorGoingHome')));
      }
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

  // Recentre on the captain — this one MAY prompt, since it's an explicit tap.
  const recenter = useCallback(async () => {
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        perm = await Location.requestForegroundPermissionsAsync();
      }
      if (perm.status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      cameraRef.current?.setCamera({
        centerCoordinate: [loc.coords.longitude, loc.coords.latitude],
        zoomLevel: 14,
        animationDuration: 500,
      });
    } catch {}
  }, []);

  const presence: Presence = state?.presence ?? 'offline';
  const online = presence === 'online' || presence === 'on_ride';

  // Sheet geometry: leave the header + mode toggle uncovered when expanded, and
  // keep the online control visible when collapsed.
  const sheetExpanded = Math.min(winH * 0.86, winH - insets.top - 96);
  const sheetCollapsed = 340;

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {/* Map-first home — the map fills the screen; controls live in the sheet. */}
      <View style={StyleSheet.absoluteFill}>
        <MapShell
          cameraRef={cameraRef}
          centerCoordinate={NKC_CENTER}
          zoomLevel={12}
          showsUserLocation
          style={{ flex: 1 }}
          // Keep the mandatory Mapbox logo + attribution above the collapsed sheet.
          logoPosition={{ bottom: sheetCollapsed + spacing.sm, left: spacing.sm }}
          attributionPosition={{ bottom: sheetCollapsed + spacing.sm, right: spacing.sm }}
        >
          {M && cells.length > 0 ? <DemandHeatmap cells={cells} /> : null}
        </MapShell>
      </View>

      {/* Floating chrome — header + mode toggle over the map. */}
      <View style={{
        position: 'absolute', top: insets.top + spacing.sm,
        left: spacing.base, right: spacing.base,
      }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
          backgroundColor: colors.surface, borderRadius: radius.xl,
          paddingVertical: spacing.sm, paddingHorizontal: spacing.sm + 2,
          ...shadow.card,
        }}>
          <View style={{
            width: 42, height: 42, borderRadius: radius.md,
            backgroundColor: colors.espresso, alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="captain" size={24} color={colors.saffron} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="overline" color={colors.muted}>{t('captain.home.overline')}</AppText>
            <AppText variant="bodyStrong" numberOfLines={1} style={{ marginTop: 1 }}>
              {user?.fullName ?? user?.phone}
            </AppText>
          </View>
          <NotificationsBellButton />
          <Pressable
            onPress={() => router.push('/(app)/settings')}
            hitSlop={10}
            accessibilityLabel={t('settings.title')}
            style={{
              width: 44, height: 44, borderRadius: radius.md,
              backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon name="tune" size={22} color={colors.ink} />
          </Pressable>
        </View>

        <View style={{
          marginTop: spacing.sm, borderRadius: radius.pill,
          backgroundColor: colors.sunken, ...shadow.card,
        }}>
          <ModeToggle />
        </View>
      </View>

      {/* Recentre-on-me, anchored just above the collapsed sheet. */}
      <Pressable
        onPress={recenter}
        hitSlop={8}
        accessibilityLabel={t('captain.home.recenter')}
        style={{
          position: 'absolute', right: spacing.base, bottom: sheetCollapsed + spacing.md,
          width: 48, height: 48, borderRadius: radius.md,
          backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
          ...shadow.card,
        }}
      >
        <Icon name="pin" size={22} color={colors.ember} />
      </Pressable>

      {/* Controls sheet — everything from the old home, reorganised. */}
      <BottomSheet expandedHeight={sheetExpanded} collapsedHeight={sheetCollapsed}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.xs,
            paddingBottom: insets.bottom + spacing.huge,
          }}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={load}
              tintColor={colors.ember}
              colors={[colors.ember]}
            />
          }
        >
          {/* Online / offline state — the primary control */}
          <StateCard
            presence={presence}
            toggling={toggling}
            onGoOnline={goOnline}
            onGoOffline={goOffline}
            onOpenRide={() => router.push('/(app)/captain/rides')}
          />

          {/* Wallet */}
          <FadeInView delay={40}>
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

          {/* Commission bonus — hidden when disabled and no bonus is in flight */}
          <FadeInView delay={70}>
            <BonusCard refreshKey={wallet?.updatedAt} />
          </FadeInView>

          {/* Going-home */}
          <FadeInView delay={100}>
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
          <FadeInView delay={150}>
            <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.xl, marginBottom: spacing.md }}>
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
              <NavRow icon="recurring" tint={statusTone.done.bg} fg={colors.success}
                title={t('captain.nav.recurringTitle')} subtitle={t('captain.nav.recurringSubtitle')}
                onPress={() => router.push('/(app)/captain/recurring')} />
            </View>
          </FadeInView>

          {captainWhatsappUrl ? (
            <FadeInView delay={175}>
              <Pressable
                onPress={() => openWhatsAppLink(
                  captainWhatsappUrl,
                  t('captain.home.whatsappGroupUnavailable'),
                )}
                style={({ pressed }) => ({
                  marginTop: spacing.lg,
                  backgroundColor: pressed ? '#1DA851' : '#25D366',
                  borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.md,
                  flexDirection: 'row', alignItems: 'center', gap: spacing.md,
                })}
                accessibilityRole="button"
              >
                <AppText style={{ fontSize: 20 }}>💬</AppText>
                <AppText variant="label" color="#fff" style={{ flex: 1, fontWeight: '700' }}>
                  {t('captain.home.whatsappGroup')}
                </AppText>
                <AppText color="#fff" style={{ fontSize: 18 }}>›</AppText>
              </Pressable>
            </FadeInView>
          ) : null}

          <Pressable onPress={confirmReset} style={({ pressed }) => ({
            marginTop: spacing.xl, paddingVertical: spacing.md,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
            opacity: pressed ? 0.6 : 1,
          })}>
            <Icon name="refresh" size={15} color={colors.muted} />
            <AppText variant="label" color={colors.muted}>{t('captain.home.resetAlerts')}</AppText>
          </Pressable>
        </ScrollView>
      </BottomSheet>
    </View>
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
          <PulseDot color={colors.success} />
          <AppText variant="overline" color={onRide ? colors.saffron : colors.onEspresso}>{t('captain.state.youAre')}</AppText>
        </View>
        <AppText variant="display" color={colors.white} style={{ marginTop: spacing.xs }}>
          {onRide ? t('captain.state.onRide') : t('captain.state.online')}
        </AppText>
        <AppText variant="body" color={onRide ? colors.onEspressoMuted : colors.onEspresso} style={{ marginTop: spacing.xs }}>
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
