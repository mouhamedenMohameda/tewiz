import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Easing, Modal, Pressable, ScrollView, View,
} from 'react-native';
// Use the app's typographic component so Arabic and Latin scripts both use
// the same font stack as the rest of the app instead of the system default.
import { AppText as Text, Button, Card, Icon } from '@/components/ui';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/env';
import { useAppConfig } from '@/lib/appConfig';
import { formatMru } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { i18n } from '@/lib/i18n';
import { colors, radius, shadow, spacing } from '@/theme';
import { wrapRow } from '@/components/ui';

type RideType = 'passenger' | 'colis';

type RideSource = 'app' | 'operator';

interface InboxItem {
  id: string;
  rideType: RideType;
  source?: RideSource;
  isForOther: boolean;
  pickup: { lat: number; lng: number; label: string | null };
  // Null for open rides (no upfront destination).
  dropoff: { lat: number; lng: number; label: string | null } | null;
  isOpen?: boolean;
  fareEstimateMru: number | null;
  distanceM: number | null;
  distanceToPickupM: number;
  isFavorite: boolean;
  homewardProgressM: number | null;
  requestedAt: string;
}

interface PoiLite {
  name: string;
  distanceM: number;
  category: string | null;
}

interface EndpointEnrichment {
  nearestPoi: PoiLite | null;
  neighborhood: PoiLite | null;
}

interface RideInsights {
  destination: {
    radiusKm: number;
    ridesLast2h: number;
    ridesYesterdaySameHour: number;
    trend: 'hotter' | 'cooler' | 'similar';
    nearbyPois: PoiLite[];
  };
  rider: {
    userId: string | null;
    fullName: string | null;
    memberSince: string | null;
    totalRides: number;
    completedRides: number;
    cancelledByRiderRides: number;
    noShowRides: number;
    completionRate: number;
    avgRating: number | null;
    ratingsCount: number;
  };
  pickup: EndpointEnrichment;
  // Open rides have no upfront destination → server returns null.
  dropoff: EndpointEnrichment | null;
}

// Module-level so a ride the captain already saw doesn't re-alert when the
// captain switches screens or toggles modes. Also persisted to AsyncStorage
// so Expo Go fast-refresh / app restarts don't replay the same alerts.
//
// We store {rideId → millisecond timestamp} and expire entries after
// SEEN_TTL_MS. The previous design used a plain Set capped at 200 — if the
// cap was reached, the oldest entry was evicted and a course refused 30 min
// earlier could re-alert. The TTL makes the eviction deterministic.
const SEEN_TTL_MS = 60 * 60_000; // 1 hour

// How long the full-screen alert rings before it auto-dismisses when the
// captain doesn't react. After this window the alarm stops and the modal
// closes so the phone isn't left ringing forever. The ride stays in the inbox
// (marked "seen", so it won't re-ring) and is still acceptable from the list.
const RING_DURATION_MS = 15_000; // 15 s

const seenRides = new Map<string, number>();
const SEEN_STORAGE_KEY = '@tewiz/captain-seen-rides';

function isSeen(rideId: string): boolean {
  const ts = seenRides.get(rideId);
  if (!ts) return false;
  if (Date.now() - ts > SEEN_TTL_MS) {
    seenRides.delete(rideId);
    return false;
  }
  return true;
}

function markSeen(rideId: string) {
  seenRides.set(rideId, Date.now());
}

function pruneExpired() {
  const now = Date.now();
  for (const [id, ts] of seenRides) {
    if (now - ts > SEEN_TTL_MS) seenRides.delete(id);
  }
}

let seenLoaded = false;
async function loadSeenFromStorage() {
  if (seenLoaded) return;
  try {
    const raw = await AsyncStorage.getItem(SEEN_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Accept both legacy (string[]) and current ([id, ts][]) shapes so
      // upgrading the app doesn't replay every previously-seen ride.
      if (Array.isArray(parsed)) {
        const now = Date.now();
        for (const entry of parsed) {
          if (typeof entry === 'string') {
            // Legacy: no timestamp → assume "just now" so the TTL applies.
            seenRides.set(entry, now);
          } else if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number') {
            if (now - entry[1] < SEEN_TTL_MS) seenRides.set(entry[0], entry[1]);
          }
        }
      }
    }
  } catch {}
  seenLoaded = true;
}

async function persistSeen() {
  try {
    pruneExpired();
    // Cap at ~500 entries to avoid unbounded growth on very active captains.
    const arr = Array.from(seenRides.entries()).slice(-500);
    await AsyncStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(arr));
  } catch {}
}

/**
 * Public utility: wipe the "seen rides" set. Called from the captain home
 * button when notifications appear stuck.
 */
export async function resetRideAlerts() {
  seenRides.clear();
  try {
    await AsyncStorage.removeItem(SEEN_STORAGE_KEY);
  } catch {}
}

/**
 * Mounted in the captain layout. Polls /captain/rides/inbox every 5 s while
 * the captain is logged in and in captain mode, and shows a full-screen
 * alert modal (with looping beep) on every new ride. Works on every screen
 * under (app)/captain/*.
 */
export function CaptainRideWatcher() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const activeMode = useAuth((s) => s.activeMode);
  const appConfig = useAppConfig();

  const [alertRide, setAlertRide] = useState<InboxItem | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [insights, setInsights] = useState<RideInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  // Tracks an explicit failure so we don't render skeletons forever when the
  // /insights endpoint is unreachable (e.g. backend not deployed yet).
  const [insightsError, setInsightsError] = useState(false);

  const ringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Auto-dismiss timer: closes the alert after RING_DURATION_MS if untouched.
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  // Drains from 1 → 0 over RING_DURATION_MS, driving the countdown bar at the
  // top of the alert — the same "time is running out" cue as Uber Driver's
  // request timer, synced to the same window the auto-dismiss timeout uses.
  const timerAnim = useRef(new Animated.Value(1)).current;
  const onRideRef = useRef(false); // skip polling inbox when on a ride
  // Synchronous tap/poll guard: prevents double-accept and racey state updates
  // on iOS when the user taps quickly and polling ticks at the same time.
  const acceptPendingRef = useRef(false);

  const customRingtoneUrl = (() => {
    const url = appConfig.captainAlertSoundUrl?.trim();
    if (!url) return null;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return null;
    const base = API_URL.replace(/\/$/, '');
    // Always stream through our API domain to avoid iOS ATS/cipher issues
    // against third-party hosts while keeping admin-configurable URLs.
    return `${base}/public/captain-alert-sound?v=${encodeURIComponent(url)}`;
  })();

  // Configure audio + request notification permission on mount.
  // Also hydrate the persisted seen-rides set.
  useEffect(() => {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      staysActiveInBackground: false,
    }).catch(() => {});

    void loadSeenFromStorage();

    // No permission request here on purpose. This component mounts with the
    // captain layout, so asking from it meant a notification dialog appearing
    // the instant a captain opened any captain screen — one of the pop-ups the
    // single "Tout autoriser" panel (components/CaptainPermissions.tsx) exists
    // to absorb. That panel now owns the ask; without it granted, the in-app
    // modal still shows visually, we just lose the OS-level alert.
  }, []);

  // Read translations off the i18n module directly because this callback is
  // not in render scope, so the t() snapshot via the hook would go stale.
  const fireOneBeep = useCallback(async (ride: InboxItem) => {
    try {
      const tt = i18n.t.bind(i18n);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: ride.rideType === 'colis' ? tt('captainAlert.newColis') : tt('captainAlert.newRide'),
          body: tt('captainAlert.kmFormat', {
            km: (ride.distanceToPickupM / 1000).toFixed(1),
            fare: ride.fareEstimateMru
              ? formatMru(ride.fareEstimateMru)
              : ride.isOpen
                ? tt('captainAlert.openFare')
                : tt('captainAlert.fareUnknown'),
          }),
          sound: 'default',
          interruptionLevel: appConfig.captainAlertSoundMode === 'critical' ? 'critical' : 'active',
          vibrate: appConfig.captainAlertSoundMode === 'critical'
            ? [0, 250, 180, 250, 180, 250]
            : [0, 220, 220, 220],
          priority: 'max',
          data: { rideId: ride.id },
        },
        trigger: null,
      });
    } catch {}
  }, [appConfig.captainAlertSoundMode]);

  const stopRinging = useCallback(async () => {
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
      dismissTimeoutRef.current = null;
    }
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
    if (soundRef.current) {
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    timerAnim.stopAnimation();
  }, []);

  const startRinging = useCallback(async (ride: InboxItem) => {
    await stopRinging();

    timerAnim.setValue(1);
    Animated.timing(timerAnim, {
      toValue: 0,
      duration: RING_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    // Ring for at most RING_DURATION_MS. If the captain hasn't accepted by
    // then, stop the alarm and close the modal — the ride simply disappears
    // from the foreground (it remains in the inbox list, marked "seen", so it
    // won't ring again but can still be tapped/accepted there).
    dismissTimeoutRef.current = setTimeout(() => {
      void stopRinging();
      setAlertRide(null);
    }, RING_DURATION_MS);

    if (customRingtoneUrl) {
      try {
        const created = await Audio.Sound.createAsync(
          { uri: customRingtoneUrl },
          { shouldPlay: false, isLooping: true, volume: 1 },
        );
        soundRef.current = created.sound;
        await soundRef.current.playAsync();
        // Keep one local notification ping so iOS can still show a heads-up
        // style alert while the custom ringtone loops in-app.
        void fireOneBeep(ride);
        return;
      } catch {
        // URL unreachable/unsupported format: fall back to default beeps.
      }
    }

    void fireOneBeep(ride);
    const repeatMs = Math.max(1_000, appConfig.captainAlertRepeatIntervalS * 1000);
    ringIntervalRef.current = setInterval(() => { void fireOneBeep(ride); }, repeatMs);
  }, [appConfig.captainAlertRepeatIntervalS, customRingtoneUrl, fireOneBeep, stopRinging]);

  // The polling loop: only runs when in captain mode (and authenticated).
  useEffect(() => {
    if (!user || user.role !== 'captain' || activeMode !== 'captain') return;

    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      if (acceptPendingRef.current) return;
      try {
        // Skip inbox poll if captain is on a ride — that's already a busy
        // foreground state.
        const cur = await api.get('/captain/rides/current', {
          validateStatus: (s) => s === 200 || s === 204,
        });
        onRideRef.current = cur.status === 200;
        if (onRideRef.current) return;

        const inb = await api.get<InboxItem[]>('/captain/rides/inbox');
        if (cancelled) return;

        // If a modal is currently showing for a ride that's no longer in the
        // inbox (i.e. another captain accepted it, or it was cancelled), close
        // the modal and let the user know.
        setAlertRide((prev) => {
          if (prev) {
            const stillThere = inb.data.some((it) => it.id === prev.id);
            if (!stillThere) {
              void stopRinging();
              Alert.alert(
                i18n.t('captainAlert.alreadyTakenTitle') as string,
                i18n.t('captainAlert.alreadyTaken') as string,
              );
              return null;
            }
            return prev;
          }
          const first = inb.data.find((it) => !isSeen(it.id));
          if (!first) return null;
          markSeen(first.id);
          void persistSeen();
          void startRinging(first);
          return first;
        });
      } catch {
        // Captain offline / no location yet / network error — silent.
      }
    }

    void tick();
    const id = setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user, activeMode, startRinging]);

  // Clean up audio + interval when the component unmounts (logout, mode switch).
  useEffect(() => {
    return () => { void stopRinging(); };
  }, [stopRinging]);

  // Fetch rich insights every time a new alert opens. The modal renders a
  // skeleton until this resolves; if the call fails we mark insightsError so
  // the cards switch to an explicit "data unavailable" state instead of
  // looping the skeleton forever.
  useEffect(() => {
    if (!alertRide) {
      setInsights(null);
      setInsightsLoading(false);
      setInsightsError(false);
      return;
    }
    let cancelled = false;
    setInsightsLoading(true);
    setInsights(null);
    setInsightsError(false);
    api.get<RideInsights>(`/captain/rides/${alertRide.id}/insights`)
      .then((r) => { if (!cancelled) setInsights(r.data); })
      .catch(() => { if (!cancelled) setInsightsError(true); })
      .finally(() => { if (!cancelled) setInsightsLoading(false); });
    return () => { cancelled = true; };
  }, [alertRide]);

  const acceptAlert = useCallback(async () => {
    if (!alertRide || acceptPendingRef.current) return;
    const rideId = alertRide.id;
    acceptPendingRef.current = true;
    setAccepting(true);
    try {
      await api.post(`/captain/rides/${rideId}/accept`);
      await stopRinging();
      setAlertRide(null);
      // Land the captain on the rides screen so the CurrentRideCard
      // (call button, step actions) is right there. Use push (not replace)
      // so the captain home stays in the back stack — otherwise "back" after
      // a ride ends/cancels unwinds to the entry route and loops.
      router.push('/(app)/captain/rides');
    } catch (e: any) {
      const code = e.response?.data?.error?.code;
      if (code === 'not_searching') {
        Alert.alert(t('captainAlert.alreadyTakenTitle'), t('captainAlert.alreadyTaken'));
      } else {
        Alert.alert(t('common.impossible'), e.response?.data?.error?.message ?? t('captainAlert.unavailable'));
      }
      await stopRinging();
      setAlertRide(null);
    } finally {
      setAccepting(false);
      acceptPendingRef.current = false;
    }
  }, [alertRide, router, stopRinging, t]);

  const refuseAlert = useCallback(async () => {
    const rideId = alertRide?.id;
    await stopRinging();
    setAlertRide(null);
    // Fire-and-forget: server-side decline so the ride is never re-offered
    // to this captain even after a reinstall or seenRides cache miss.
    if (rideId) {
      api.post(`/captain/rides/${rideId}/decline`).catch(() => {});
    }
  }, [alertRide, stopRinging]);

  return (
    <Modal
      visible={!!alertRide}
      animationType="slide"
      transparent={false}
      onRequestClose={refuseAlert}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top', 'left', 'right']}>
        {alertRide ? (
          <View style={{ flex: 1 }}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
              showsVerticalScrollIndicator={false}
              bounces
            >
              {/* Countdown — depletes over RING_DURATION_MS, the same "time
                  to decide" pressure as Uber Driver's request timer. */}
              <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden' }}>
                <Animated.View
                  style={{
                    height: '100%', borderRadius: 2, backgroundColor: colors.ember,
                    width: timerAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                  }}
                />
              </View>

              {/* Type + source chips */}
              <View style={{
                flexDirection: wrapRow, alignItems: 'center', gap: 8, flexWrap: 'wrap',
                marginTop: spacing.base,
              }}>
                <View style={{
                  backgroundColor: colors.emberSoft,
                  paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                }}>
                  <Icon name={alertRide.rideType === 'colis' ? 'parcel' : 'ride'} size={13} color={colors.ember} />
                  <Text variant="overline" color={colors.ember}>
                    {alertRide.rideType === 'colis' ? t('captainAlert.newColisCaps') : t('captainAlert.newRideCaps')}
                  </Text>
                </View>
                {alertRide.source === 'operator' ? (
                  <View style={{
                    backgroundColor: colors.surfaceAlt,
                    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                  }}>
                    <Icon name="phone" size={12} color={colors.ink2} />
                    <Text variant="overline" color={colors.ink2}>
                      {t('captainAlert.callCenterBadge')}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Fare — the number the captain actually decides on, so it
                  gets to be the biggest thing on the screen, in plain ink
                  rather than dressed up on a gradient. */}
              <View style={{ marginTop: spacing.lg }}>
                <Text variant="overline" color={colors.muted}>
                  {t('captainAlert.estimatedFare')}
                </Text>
                <Text variant="hero" style={{ fontSize: 44, marginTop: 2 }}>
                  {alertRide.fareEstimateMru ? formatMru(alertRide.fareEstimateMru) : '—'}
                </Text>
              </View>

              {/* Distance to pickup / trip length, side by side — the two
                  numbers Uber's own request card leads with right under the
                  fare ("6 min away" · "2.1 mi trip"). */}
              <View style={{
                flexDirection: 'row', marginTop: spacing.lg,
                backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, padding: spacing.base,
              }}>
                <DistanceStat
                  value={`${(alertRide.distanceToPickupM / 1000).toFixed(1)} ${t('common.kmShort')}`}
                  label={t('captainAlert.fromYourPosition')}
                  highlight
                />
                <View style={{ width: 1, backgroundColor: colors.line }} />
                <DistanceStat
                  value={alertRide.distanceM ? `${(alertRide.distanceM / 1000).toFixed(1)} ${t('common.kmShort')}` : '—'}
                  label={t('captainAlert.tripLabel')}
                />
              </View>

              {/* Route card */}
              <Card style={{ marginTop: spacing.base }} padding={spacing.base}>
                <RoutePoint
                  color={colors.success}
                  label={t('common.from')}
                  rawLabel={alertRide.pickup.label}
                  fallback={t('captain.rides.pickupFallback')}
                  enrichment={insights?.pickup ?? null}
                  t={t}
                />
                <View style={{ height: 1, backgroundColor: colors.line, marginVertical: spacing.md }} />
                <RoutePoint
                  color={colors.ember}
                  label={t('common.to')}
                  rawLabel={alertRide.isOpen
                    ? t('captain.rides.openDestinationShort')
                    : (alertRide.dropoff?.label ?? null)}
                  fallback={t('captain.rides.dropoffFallback')}
                  enrichment={insights?.dropoff ?? null}
                  t={t}
                />
              </Card>

              {/* Destination demand is only meaningful for closed rides. */}
              {!alertRide.isOpen ? (
                <DestinationCard insights={insights} loading={insightsLoading} error={insightsError} t={t} />
              ) : null}

              {/* Rider profile card */}
              <RiderCard insights={insights} loading={insightsLoading} error={insightsError} t={t} />
            </ScrollView>

            {/* Sticky action bar */}
            <View style={{
              paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.base,
              gap: spacing.sm,
              borderTopWidth: 1, borderTopColor: colors.line,
              backgroundColor: colors.surface,
            }}>
              <Button
                title={t('captainAlert.accept')}
                icon="checkSmall"
                busy={accepting}
                onPress={acceptAlert}
              />
              <Pressable
                disabled={accepting}
                onPress={refuseAlert}
                style={({ pressed }) => ({
                  opacity: accepting ? 0.5 : pressed ? 0.6 : 1,
                  paddingVertical: spacing.sm,
                  alignItems: 'center',
                })}
              >
                <Text variant="bodyStrong" color={colors.ink2}>
                  {t('captainAlert.refuse')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

// ─── Helper components for the alert modal ─────────────────────────────────

// Labels stored by the rider app when no real place was picked. We detect
// these and replace them with "Près de <POI>" using the enrichment payload
// returned by the insights endpoint.
const GENERIC_LABELS = new Set<string>([
  'Point sur la carte',
  'Ma position',
  'Pin on map',
  'My location',
  'نقطة على الخريطة',
  'موقعي',
]);

function isGenericLabel(label: string | null | undefined): boolean {
  if (!label) return true;
  return GENERIC_LABELS.has(label.trim());
}

function RoutePoint({
  color, label, rawLabel, fallback, enrichment, t,
}: {
  color: string;
  label: string;
  rawLabel: string | null;
  fallback: string;
  enrichment: EndpointEnrichment | null;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const generic = isGenericLabel(rawLabel);
  const near = enrichment?.nearestPoi;
  const neighborhood = enrichment?.neighborhood;

  let main: string;
  if (!generic && rawLabel) {
    main = rawLabel;
  } else if (near) {
    main = t('captainAlert.nearLabel', { name: near.name });
  } else {
    main = fallback;
  }

  const subParts: string[] = [];
  if (neighborhood) subParts.push(neighborhood.name);
  if (!generic && near && near.name !== rawLabel) {
    subParts.push(t('captainAlert.nearLabel', { name: near.name }));
  }
  const sub = subParts.join(' · ');

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
      <View style={{
        width: 11, height: 11, borderRadius: 6, backgroundColor: color, marginTop: 6,
        borderWidth: 2, borderColor: colors.surface, ...shadow.card,
      }} />
      <View style={{ flex: 1 }}>
        <Text variant="overline" color={colors.muted}>
          {label}
        </Text>
        <Text variant="bodyStrong" color={colors.ink} style={{ marginTop: 2 }} numberOfLines={2}>
          {main}
        </Text>
        {sub ? (
          <Text variant="caption" color={colors.ink2} style={{ marginTop: 2 }} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function SectionTitle({ iconName, title, hint, tint }: {
  iconName: 'pin' | 'person';
  title: string;
  hint?: string;
  tint: string;
}) {
  return (
    <View style={{ marginTop: spacing.lg, marginBottom: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View style={{
        width: 28, height: 28, borderRadius: 14,
        backgroundColor: tint, alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={iconName} size={15} color={colors.white} />
      </View>
      <Text variant="title" color={colors.ink}>{title}</Text>
      {hint ? (
        <Text variant="caption" color={colors.muted} style={{ marginStart: 'auto' }}>{hint}</Text>
      ) : null}
    </View>
  );
}

function SkeletonBar({ width = '100%', height = 14 }: { width?: number | string; height?: number }) {
  return (
    <View style={{
      width: width as any, height,
      backgroundColor: colors.sunken, borderRadius: 4,
    }} />
  );
}

function EmptyHint({ icon, text, sub }: { icon: string; text: string; sub?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.xs }}>
      <Text style={{ fontSize: 28 }}>{icon}</Text>
      <Text variant="bodyStrong" color={colors.ink2} align="center">
        {text}
      </Text>
      {sub ? (
        <Text variant="caption" color={colors.muted} align="center">
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

function DestinationCard({
  insights, loading, error, t,
}: {
  insights: RideInsights | null;
  loading: boolean;
  error: boolean;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const [showAll, setShowAll] = useState(false);

  const isEmpty = insights !== null
    && insights.destination.ridesLast2h === 0
    && insights.destination.ridesYesterdaySameHour === 0;

  const trend = insights?.destination.trend ?? 'similar';
  const accentColor =
    trend === 'hotter' ? colors.success
    : trend === 'cooler' ? colors.warning
    : colors.sun;
  const accentTint =
    trend === 'hotter' ? colors.successSoft
    : trend === 'cooler' ? colors.saffronSoft
    : colors.emberSoft;
  const sectionTint = isEmpty ? colors.muted : accentColor;

  const headline = isEmpty
    ? t('captainAlert.zone.empty')
    : trend === 'hotter' ? t('captainAlert.zone.hotter')
    : trend === 'cooler' ? t('captainAlert.zone.cooler')
    : t('captainAlert.zone.similar');

  const nearbyPois = insights?.destination.nearbyPois ?? [];
  const visiblePois = showAll ? nearbyPois : nearbyPois.slice(0, 3);

  return (
    <>
      <SectionTitle
        iconName="pin"
        title={t('captainAlert.zone.title')}
        hint={insights ? t('captainAlert.zone.hint', { km: insights.destination.radiusKm }) : ''}
        tint={sectionTint}
      />
      <Card padding={spacing.base}>
        {loading || (!insights && !error) ? (
          <View style={{ gap: spacing.sm }}>
            <SkeletonBar width={140} height={16} />
            <SkeletonBar width="85%" height={28} />
            <SkeletonBar width="60%" height={12} />
          </View>
        ) : error || !insights ? (
          <EmptyHint
            icon="📡"
            text={t('captainAlert.zone.errorTitle')}
            sub={t('captainAlert.zone.errorBody')}
          />
        ) : isEmpty ? (
          <>
            <View style={{
              alignSelf: 'flex-start',
              backgroundColor: accentTint,
              paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill,
            }}>
              <Text variant="overline" color={accentColor}>
                {headline.toUpperCase()}
              </Text>
            </View>
            <Text variant="body" color={colors.ink2} style={{ marginTop: spacing.sm }}>
              {t('captainAlert.zone.encourageEmpty')}
            </Text>
          </>
        ) : (
          <>
            <View style={{
              alignSelf: 'flex-start',
              backgroundColor: accentTint,
              paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill,
            }}>
              <Text variant="overline" color={accentColor}>
                {headline.toUpperCase()}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', marginTop: spacing.md, gap: spacing.md }}>
              <ZoneStat
                value={insights!.destination.ridesLast2h}
                label={t('captainAlert.zone.last2h')}
                highlight
              />
              <View style={{ width: 1, backgroundColor: colors.line }} />
              <ZoneStat
                value={insights!.destination.ridesYesterdaySameHour}
                label={t('captainAlert.zone.yesterday')}
              />
            </View>
            <Text variant="caption" color={colors.ink2} style={{ marginTop: spacing.md, lineHeight: 17 }}>
              {trend === 'hotter'
                ? t('captainAlert.zone.encourageHotter')
                : trend === 'cooler'
                  ? t('captainAlert.zone.encourageCooler')
                  : t('captainAlert.zone.encourageSimilar')}
            </Text>
          </>
        )}

        {/* Expandable list of nearby POIs (commerces, mosquées, marchés…) */}
        {nearbyPois.length > 0 ? (
          <View style={{ marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line }}>
            <Text variant="overline" color={colors.muted} style={{ marginBottom: spacing.sm }}>
              {t('captainAlert.zone.nearbyTitle')}
            </Text>
            <View style={{ gap: spacing.sm }}>
              {visiblePois.map((p, i) => (
                <PoiRow key={`${p.name}-${i}`} poi={p} />
              ))}
            </View>
            {nearbyPois.length > 3 ? (
              <Pressable
                onPress={() => setShowAll((s) => !s)}
                style={({ pressed }) => ({
                  marginTop: spacing.md,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.md,
                  backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                })}
              >
                <Text variant="label" color={colors.ember}>
                  {showAll
                    ? t('captainAlert.zone.seeLess')
                    : t('captainAlert.zone.seeMore', { count: nearbyPois.length - 3 })}
                </Text>
                <Icon name={showAll ? 'chevronDown' : 'chevron'} size={14} color={colors.ember} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Card>
    </>
  );
}

/** The pair of numbers under the fare — distance to pickup, trip length. */
function DistanceStat({ value, label, highlight }: { value: string; label: string; highlight?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text variant="h2" color={highlight ? colors.ember : colors.ink}>
        {value}
      </Text>
      <Text variant="caption" color={colors.ink2} style={{ marginTop: 2 }}>
        {label}
      </Text>
    </View>
  );
}

function ZoneStat({ value, label, highlight }: { value: number; label: string; highlight?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text variant="display" color={highlight ? colors.ember : colors.ink} style={{ fontSize: 32, lineHeight: 34 }}>
        {value}
      </Text>
      <Text variant="caption" color={colors.ink2} style={{ marginTop: 2 }}>
        {label}
      </Text>
    </View>
  );
}

function PoiRow({ poi }: { poi: PoiLite }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View style={{
        width: 32, height: 32, borderRadius: 16,
        backgroundColor: colors.emberSoft,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="pin" size={14} color={colors.ember} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" color={colors.ink} numberOfLines={1}>{poi.name}</Text>
        {poi.category ? (
          <Text variant="caption" color={colors.muted} numberOfLines={1}>
            {poi.category} · {poi.distanceM < 1000 ? `${poi.distanceM} m` : `${(poi.distanceM / 1000).toFixed(1)} km`}
          </Text>
        ) : (
          <Text variant="caption" color={colors.muted}>
            {poi.distanceM < 1000 ? `${poi.distanceM} m` : `${(poi.distanceM / 1000).toFixed(1)} km`}
          </Text>
        )}
      </View>
    </View>
  );
}

function RiderCard({
  insights, loading, error, t,
}: {
  insights: RideInsights | null;
  loading: boolean;
  error: boolean;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const rider = insights?.rider;
  const initials = (rider?.fullName ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('') || '?';

  const memberSinceMonths = rider?.memberSince
    ? Math.max(1, Math.round((Date.now() - new Date(rider.memberSince).getTime()) / (1000 * 60 * 60 * 24 * 30)))
    : null;

  const completionPct = rider ? Math.round(rider.completionRate * 100) : 0;
  const isGuest = !!rider && rider.userId === null;
  const isFirstRide = !!rider && !isGuest && rider.totalRides <= 1;

  return (
    <>
      <SectionTitle iconName="person" title={t('captainAlert.rider.title')} tint={colors.espresso} />
      <Card padding={spacing.base}>
        {loading || (!insights && !error) ? (
          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.sunken }} />
              <View style={{ flex: 1, gap: 6 }}>
                <SkeletonBar width="55%" height={14} />
                <SkeletonBar width="35%" height={10} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <SkeletonBar width={88} height={36} />
              <SkeletonBar width={88} height={36} />
            </View>
          </View>
        ) : error || !rider ? (
          <EmptyHint
            icon="🔌"
            text={t('captainAlert.rider.errorTitle')}
            sub={t('captainAlert.rider.errorBody')}
          />
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{
                width: 48, height: 48, borderRadius: 24,
                backgroundColor: isGuest ? colors.surfaceAlt : colors.ember,
                alignItems: 'center', justifyContent: 'center',
                ...shadow.ember,
              }}>
                <Text variant="title" color={isGuest ? colors.muted : colors.white}>
                  {isGuest ? '?' : initials}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" color={colors.ink} numberOfLines={1}>
                  {rider.fullName ?? t('captainAlert.rider.unknown')}
                </Text>
                <Text variant="caption" color={colors.ink2} style={{ marginTop: 2 }}>
                  {isGuest
                    ? t('captainAlert.rider.guest')
                    : memberSinceMonths
                      ? t('captainAlert.rider.memberSince', { months: memberSinceMonths })
                      : t('captainAlert.rider.memberJustJoined')}
                </Text>
              </View>
              {isFirstRide && !isGuest ? (
                <View style={{
                  backgroundColor: colors.saffronSoft,
                  paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
                }}>
                  <Text variant="overline" color={colors.warning}>
                    {t('captainAlert.rider.newBadge')}
                  </Text>
                </View>
              ) : null}
            </View>

            {isGuest ? (
              <View style={{
                marginTop: spacing.md, padding: spacing.md,
                backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
              }}>
                <Text variant="caption" color={colors.ink2}>
                  {t('captainAlert.rider.guestExplain')}
                </Text>
              </View>
            ) : isFirstRide ? (
              <View style={{
                marginTop: spacing.md, padding: spacing.md,
                backgroundColor: colors.saffronSoft, borderRadius: radius.md,
                flexDirection: 'row', gap: spacing.sm,
              }}>
                <Text style={{ fontSize: 18 }}>✨</Text>
                <Text variant="caption" color={colors.ink2} style={{ flex: 1, lineHeight: 17 }}>
                  {t('captainAlert.rider.firstRideExplain')}
                </Text>
              </View>
            ) : (
              <View style={{ flexDirection: wrapRow, flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                <RiderChip icon="🛣️" value={String(rider.totalRides)} label={t('captainAlert.rider.rides')} variant="neutral" />
                {rider.avgRating !== null ? (
                  <RiderChip
                    icon="⭐"
                    value={rider.avgRating.toFixed(1)}
                    label={t('captainAlert.rider.rating', { count: rider.ratingsCount })}
                    variant="gold"
                  />
                ) : null}
                {rider.totalRides > 0 ? (
                  <RiderChip
                    icon={completionPct >= 80 ? '✅' : '⚠️'}
                    value={`${completionPct}%`}
                    label={t('captainAlert.rider.completion')}
                    variant={completionPct >= 80 ? 'success' : 'warning'}
                  />
                ) : null}
                {rider.noShowRides > 0 ? (
                  <RiderChip
                    icon="🚫"
                    value={String(rider.noShowRides)}
                    label={t('captainAlert.rider.noShow')}
                    variant="danger"
                  />
                ) : null}
              </View>
            )}
          </>
        )}
      </Card>
    </>
  );
}

function RiderChip({
  icon, value, label, variant = 'neutral',
}: {
  icon: string;
  value: string;
  label: string;
  variant?: 'neutral' | 'gold' | 'success' | 'warning' | 'danger';
}) {
  // `fg`, not `value`: the worklets babel plugin rewrites `.value` inside style
  // objects into a Reanimated warning that crashes without Reanimated present.
  // This one is currently safe (it feeds a `color=` prop, not a style object),
  // but it is one refactor away from the same trap — and bg/fg is the naming the
  // rest of the design system already uses.
  const palette = {
    neutral: { bg: colors.surfaceAlt, fg: colors.ink, label: colors.ink2 },
    gold:    { bg: colors.saffronSoft, fg: colors.warning, label: colors.ink2 },
    success: { bg: colors.successSoft, fg: colors.success, label: colors.ink2 },
    warning: { bg: colors.saffronSoft, fg: colors.warning, label: colors.ink2 },
    danger:  { bg: colors.dangerSoft, fg: colors.danger, label: colors.ink2 },
  }[variant];
  return (
    <View style={{
      backgroundColor: palette.bg,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md,
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 96,
    }}>
      <Text style={{ fontSize: 14 }}>{icon}</Text>
      <View>
        <Text variant="bodyStrong" color={palette.fg}>{value}</Text>
        <Text variant="caption" color={palette.label} style={{ marginTop: -2 }}>{label}</Text>
      </View>
    </View>
  );
}
