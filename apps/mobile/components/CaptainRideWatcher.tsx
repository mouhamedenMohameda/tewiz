import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { i18n } from '@/lib/i18n';

type RideType = 'passenger' | 'colis';

type RideSource = 'app' | 'operator';

interface InboxItem {
  id: string;
  rideType: RideType;
  source?: RideSource;
  isForOther: boolean;
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null };
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
  dropoff: EndpointEnrichment;
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
const seenRides = new Map<string, number>();
const SEEN_STORAGE_KEY = '@tewiz/captain-seen-rides';
const PAUSE_STORAGE_KEY = '@tewiz/captain-pause-until';

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

// Pause-notifications timestamp (ms since epoch). When `Date.now() < pausedUntil`,
// the watcher polls but doesn't open the modal or ring. Persisted across reloads.
let pausedUntil = 0;
async function loadPauseFromStorage() {
  try {
    const raw = await AsyncStorage.getItem(PAUSE_STORAGE_KEY);
    if (raw) pausedUntil = Number(raw) || 0;
  } catch {}
}
async function setPauseFor(minutes: number) {
  pausedUntil = Date.now() + minutes * 60_000;
  try {
    await AsyncStorage.setItem(PAUSE_STORAGE_KEY, String(pausedUntil));
  } catch {}
}

/**
 * Public utility: wipe both the "seen rides" set and the "pause" timer.
 * Called from the captain home button when notifications appear stuck.
 */
export async function resetRideAlerts() {
  seenRides.clear();
  pausedUntil = 0;
  try {
    await AsyncStorage.removeItem(SEEN_STORAGE_KEY);
    await AsyncStorage.removeItem(PAUSE_STORAGE_KEY);
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

  const [alertRide, setAlertRide] = useState<InboxItem | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [insights, setInsights] = useState<RideInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  // Tracks an explicit failure so we don't render skeletons forever when the
  // /insights endpoint is unreachable (e.g. backend not deployed yet).
  const [insightsError, setInsightsError] = useState(false);

  const ringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const onRideRef = useRef(false); // skip polling inbox when on a ride

  const [, forceRerender] = useState(0);

  // Configure audio + request notification permission on mount.
  // Also hydrate the persisted seen-rides set and pause timestamp.
  useEffect(() => {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      staysActiveInBackground: false,
    }).catch(() => {});

    void loadSeenFromStorage();
    void loadPauseFromStorage();

    (async () => {
      try {
        const cur = await Notifications.getPermissionsAsync();
        if (!cur.granted) {
          await Notifications.requestPermissionsAsync({
            ios: { allowAlert: true, allowBadge: false, allowSound: true },
          });
        }
      } catch {
        // Ignore — modal still shows visually.
      }
    })();
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
            fare: ride.fareEstimateMru ? formatMru(ride.fareEstimateMru) : tt('captainAlert.fareUnknown'),
          }),
          sound: 'default',
          data: { rideId: ride.id },
        },
        trigger: null,
      });
    } catch {}
  }, []);

  const stopRinging = useCallback(async () => {
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
    if (soundRef.current) {
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
  }, []);

  const startRinging = useCallback(async (ride: InboxItem) => {
    await stopRinging();
    void fireOneBeep(ride);
    ringIntervalRef.current = setInterval(() => { void fireOneBeep(ride); }, 2000);
  }, [fireOneBeep, stopRinging]);

  // The polling loop: only runs when in captain mode (and authenticated).
  useEffect(() => {
    if (!user || user.role !== 'captain' || activeMode !== 'captain') return;

    let cancelled = false;

    async function tick() {
      if (cancelled) return;
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

        // Honor the "Pause notifications" timer: poll continues silently so
        // the inbox is fresh when the pause ends, but no modal pops.
        if (Date.now() < pausedUntil) {
          forceRerender((c) => c + 1); // keep banner countdown live
          return;
        }

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
    if (!alertRide) return;
    setAccepting(true);
    try {
      await api.post(`/captain/rides/${alertRide.id}/accept`);
      await stopRinging();
      setAlertRide(null);
      // Land the captain on the rides screen so the CurrentRideCard
      // (call button, step actions) is right there.
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

  const pauseFiveMin = useCallback(async () => {
    await stopRinging();
    await setPauseFor(5);
    setAlertRide(null);
    forceRerender((c) => c + 1);
  }, [stopRinging]);

  const resumeNotifications = useCallback(async () => {
    pausedUntil = 0;
    try { await AsyncStorage.removeItem(PAUSE_STORAGE_KEY); } catch {}
    forceRerender((c) => c + 1);
  }, []);

  const isPaused = Date.now() < pausedUntil;
  const pauseMinsLeft = isPaused
    ? Math.max(1, Math.ceil((pausedUntil - Date.now()) / 60_000))
    : 0;

  return (
    <>
      {isPaused ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 24,
            alignItems: 'center', zIndex: 50,
          }}
        >
          <Pressable
            onPress={resumeNotifications}
            style={({ pressed }) => ({
              backgroundColor: pressed ? '#a16207' : '#ca8a04',
              paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999,
              flexDirection: 'row', alignItems: 'center', gap: 8,
              shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
            })}
          >
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
              {t('captainAlert.pausedBadge', { mins: pauseMinsLeft })}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <Modal
        visible={!!alertRide}
        animationType="slide"
        transparent={false}
        onRequestClose={refuseAlert}
      >
      <SafeAreaView style={{ flex: 1, backgroundColor: '#0f172a' }}>
        {alertRide ? (
          <View style={{ flex: 1 }}>
            <ScrollView
              contentContainerStyle={{ padding: 20, paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
            >
              {/* Header pill row + hero amount */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={{ color: '#bfdbfe', fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>
                  {alertRide.rideType === 'colis' ? t('captainAlert.newColisCaps') : t('captainAlert.newRideCaps')}
                </Text>
                {alertRide.source === 'operator' ? (
                  <View style={{
                    backgroundColor: '#7c3aed', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                  }}>
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
                      {t('captainAlert.callCenterBadge')}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={{
                marginTop: 10,
                flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
              }}>
                <View>
                  <Text style={{ color: '#fff', fontSize: 42, fontWeight: '800' }}>
                    {alertRide.fareEstimateMru ? formatMru(alertRide.fareEstimateMru) : '—'}
                  </Text>
                  <Text style={{ color: '#cbd5e1', fontSize: 13, marginTop: 2 }}>
                    {(alertRide.distanceToPickupM / 1000).toFixed(1)} {t('common.kmShort')} · {t('captainAlert.fromYourPosition')}
                  </Text>
                </View>
                <View style={{
                  backgroundColor: '#1e293b', paddingHorizontal: 12, paddingVertical: 8,
                  borderRadius: 12, alignItems: 'flex-end',
                }}>
                  <Text style={{ color: '#94a3b8', fontSize: 10, letterSpacing: 0.5 }}>
                    {t('captainAlert.tripLabel').toUpperCase()}
                  </Text>
                  <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 2 }}>
                    {alertRide.distanceM ? `${(alertRide.distanceM / 1000).toFixed(1)} ${t('common.kmShort')}` : '—'}
                  </Text>
                </View>
              </View>

              {/* Route card */}
              <View style={{
                marginTop: 16, backgroundColor: '#1e293b',
                borderRadius: 16, padding: 16, gap: 14,
              }}>
                <RoutePoint
                  color="#10a35e"
                  label={t('common.from')}
                  rawLabel={alertRide.pickup.label}
                  fallback={t('captain.rides.pickupFallback')}
                  enrichment={insights?.pickup ?? null}
                  t={t}
                />
                <View style={{ height: 1, backgroundColor: '#334155' }} />
                <RoutePoint
                  color="#f59e0b"
                  label={t('common.to')}
                  rawLabel={alertRide.dropoff.label}
                  fallback={t('captain.rides.dropoffFallback')}
                  enrichment={insights?.dropoff ?? null}
                  t={t}
                />
              </View>

              {/* Destination demand card */}
              <DestinationCard insights={insights} loading={insightsLoading} error={insightsError} t={t} />

              {/* Rider profile card */}
              <RiderCard insights={insights} loading={insightsLoading} error={insightsError} t={t} />
            </ScrollView>

            {/* Sticky action bar */}
            <View style={{
              padding: 16, paddingTop: 12, gap: 10,
              borderTopWidth: 1, borderTopColor: '#1e293b',
              backgroundColor: '#0f172a',
            }}>
              <Pressable
                disabled={accepting}
                onPress={acceptAlert}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? '#059669' : '#10a35e',
                  opacity: accepting ? 0.6 : 1,
                  paddingVertical: 18, borderRadius: 14,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
                })}
              >
                {accepting && <ActivityIndicator color="#fff" />}
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>
                  {t('captainAlert.accept')}
                </Text>
              </Pressable>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  disabled={accepting}
                  onPress={refuseAlert}
                  style={({ pressed }) => ({
                    flex: 1,
                    backgroundColor: pressed ? '#334155' : 'transparent',
                    paddingVertical: 14, borderRadius: 14,
                    borderWidth: 1, borderColor: '#475569',
                    alignItems: 'center',
                  })}
                >
                  <Text style={{ color: '#cbd5e1', fontSize: 14, fontWeight: '600' }}>
                    {t('captainAlert.refuse')}
                  </Text>
                  <Text style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                    {t('captainAlert.refuseSub')}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={accepting}
                  onPress={pauseFiveMin}
                  style={({ pressed }) => ({
                    flex: 1,
                    backgroundColor: pressed ? '#334155' : 'transparent',
                    paddingVertical: 14, borderRadius: 14,
                    borderWidth: 1, borderColor: '#475569',
                    alignItems: 'center',
                  })}
                >
                  <Text style={{ color: '#cbd5e1', fontSize: 14, fontWeight: '600' }}>
                    {t('captainAlert.pause5')}
                  </Text>
                  <Text style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                    {t('captainAlert.pauseSub')}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
    </>
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
  // Display logic:
  //   - real label   → use as-is.
  //   - generic/null + nearest POI → "Près de X"
  //   - generic/null + no POI      → fallback ("Point de prise en charge")
  // The neighborhood (OSM `place`) is always appended as a sub-line when
  // available, so the captain knows the moughataa/quartier even when the
  // primary label is accurate.
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

  // Sub-line: neighborhood and/or the POI distance, depending on what
  // information we surfaced in `main`.
  const subParts: string[] = [];
  if (neighborhood) subParts.push(neighborhood.name);
  if (!generic && near && near.name !== rawLabel) {
    subParts.push(t('captainAlert.nearLabel', { name: near.name }));
  }
  const sub = subParts.join(' · ');

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
      <View style={{
        width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginTop: 6,
      }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#94a3b8', fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          {label}
        </Text>
        <Text style={{ color: '#fff', fontSize: 15, marginTop: 2, lineHeight: 20 }} numberOfLines={2}>
          {main}
        </Text>
        {sub ? (
          <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 2, lineHeight: 16 }} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function SectionTitle({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <View style={{ marginTop: 18, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ fontSize: 16 }}>{icon}</Text>
      <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 0.3 }}>{title}</Text>
      {hint ? (
        <Text style={{ color: '#64748b', fontSize: 11, marginLeft: 'auto' }}>{hint}</Text>
      ) : null}
    </View>
  );
}

function SkeletonBar({ width = '100%', height = 14 }: { width?: number | string; height?: number }) {
  // Lighter than the card background (#1e293b) so it stays visible.
  return (
    <View style={{
      width: width as any, height,
      backgroundColor: '#334155', borderRadius: 4,
      opacity: 0.6,
    }} />
  );
}

function EmptyHint({ icon, text, sub }: { icon: string; text: string; sub?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 6, gap: 6 }}>
      <Text style={{ fontSize: 28 }}>{icon}</Text>
      <Text style={{ color: '#cbd5e1', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
        {text}
      </Text>
      {sub ? (
        <Text style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', lineHeight: 16 }}>
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
  // Special case: brand-new database / no rides anywhere near the destination
  // window. Don't try to compute a "trend" — just say so clearly.
  const isEmpty = insights !== null
    && insights.destination.ridesLast2h === 0
    && insights.destination.ridesYesterdaySameHour === 0;

  const trend = insights?.destination.trend ?? 'similar';
  const accent = isEmpty
    ? '#64748b'
    : trend === 'hotter' ? '#10a35e'
    : trend === 'cooler' ? '#f59e0b'
    : '#60a5fa';
  const headline = isEmpty
    ? t('captainAlert.zone.empty')
    : trend === 'hotter' ? t('captainAlert.zone.hotter')
    : trend === 'cooler' ? t('captainAlert.zone.cooler')
    : t('captainAlert.zone.similar');

  return (
    <>
      <SectionTitle
        icon="📍"
        title={t('captainAlert.zone.title')}
        hint={insights ? t('captainAlert.zone.hint', { km: insights.destination.radiusKm }) : ''}
      />
      <View style={{
        backgroundColor: '#1e293b', borderRadius: 16, padding: 16,
        // borderStartWidth flips automatically in RTL layouts; borderLeftWidth would
        // stay on the visual left even in Arabic.
        borderStartWidth: 3, borderStartColor: accent,
      }}>
        {loading || (!insights && !error) ? (
          <View style={{ gap: 10 }}>
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
            <Text style={{ color: accent, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 }}>
              {headline.toUpperCase()}
            </Text>
            <Text style={{ color: '#cbd5e1', fontSize: 13, marginTop: 8, lineHeight: 18 }}>
              {t('captainAlert.zone.encourageEmpty')}
            </Text>
          </>
        ) : (
          <>
            <Text style={{ color: accent, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 }}>
              {headline.toUpperCase()}
            </Text>
            <View style={{ flexDirection: 'row', marginTop: 12, gap: 12 }}>
              <ZoneStat
                value={insights!.destination.ridesLast2h}
                label={t('captainAlert.zone.last2h')}
                highlight
              />
              <View style={{ width: 1, backgroundColor: '#334155' }} />
              <ZoneStat
                value={insights!.destination.ridesYesterdaySameHour}
                label={t('captainAlert.zone.yesterday')}
              />
            </View>
            <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 12, lineHeight: 16 }}>
              {trend === 'hotter'
                ? t('captainAlert.zone.encourageHotter')
                : trend === 'cooler'
                  ? t('captainAlert.zone.encourageCooler')
                  : t('captainAlert.zone.encourageSimilar')}
            </Text>
          </>
        )}
      </View>
    </>
  );
}

function ZoneStat({ value, label, highlight }: { value: number; label: string; highlight?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{
        color: highlight ? '#fff' : '#cbd5e1',
        fontSize: 28, fontWeight: '800', letterSpacing: -0.5,
      }}>
        {value}
      </Text>
      <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 2, lineHeight: 14 }}>
        {label}
      </Text>
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
      <SectionTitle icon="👤" title={t('captainAlert.rider.title')} />
      <View style={{ backgroundColor: '#1e293b', borderRadius: 16, padding: 16 }}>
        {loading || (!insights && !error) ? (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#334155', opacity: 0.6 }} />
              <View style={{ flex: 1, gap: 6 }}>
                <SkeletonBar width="55%" height={14} />
                <SkeletonBar width="35%" height={10} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{
                width: 44, height: 44, borderRadius: 22,
                backgroundColor: isGuest ? '#334155' : '#3730a3',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                  {isGuest ? '?' : initials}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                  {rider.fullName ?? t('captainAlert.rider.unknown')}
                </Text>
                <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>
                  {isGuest
                    ? t('captainAlert.rider.guest')
                    : memberSinceMonths
                      ? t('captainAlert.rider.memberSince', { months: memberSinceMonths })
                      : t('captainAlert.rider.memberJustJoined')}
                </Text>
              </View>
              {isFirstRide && !isGuest ? (
                <View style={{ backgroundColor: '#312e81', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                  <Text style={{ color: '#a5b4fc', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>
                    {t('captainAlert.rider.newBadge')}
                  </Text>
                </View>
              ) : null}
            </View>

            {isGuest ? (
              <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 12, lineHeight: 16 }}>
                {t('captainAlert.rider.guestExplain')}
              </Text>
            ) : isFirstRide ? (
              <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 12, lineHeight: 16 }}>
                {t('captainAlert.rider.firstRideExplain')}
              </Text>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                <RiderChip icon="🛣️" value={String(rider.totalRides)} label={t('captainAlert.rider.rides')} />
                {rider.avgRating !== null ? (
                  <RiderChip
                    icon="⭐"
                    value={rider.avgRating.toFixed(1)}
                    label={t('captainAlert.rider.rating', { count: rider.ratingsCount })}
                    highlight
                  />
                ) : null}
                {rider.totalRides > 0 ? (
                  <RiderChip
                    icon={completionPct >= 80 ? '✅' : '⚠️'}
                    value={`${completionPct}%`}
                    label={t('captainAlert.rider.completion')}
                    highlight={completionPct >= 80}
                  />
                ) : null}
                {rider.noShowRides > 0 ? (
                  <RiderChip
                    icon="🚫"
                    value={String(rider.noShowRides)}
                    label={t('captainAlert.rider.noShow')}
                    warning
                  />
                ) : null}
              </View>
            )}
          </>
        )}
      </View>
    </>
  );
}

function RiderChip({
  icon, value, label, highlight, warning,
}: {
  icon: string; value: string; label: string; highlight?: boolean; warning?: boolean;
}) {
  const bg = warning ? '#7f1d1d' : highlight ? '#064e3b' : '#334155';
  const valueColor = warning ? '#fecaca' : highlight ? '#6ee7b7' : '#fff';
  return (
    <View style={{
      backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10,
      flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 88,
    }}>
      <Text style={{ fontSize: 13 }}>{icon}</Text>
      <View>
        <Text style={{ color: valueColor, fontSize: 14, fontWeight: '700' }}>{value}</Text>
        <Text style={{ color: '#94a3b8', fontSize: 10, marginTop: -1 }}>{label}</Text>
      </View>
    </View>
  );
}
