import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import { useAuth } from '@/lib/auth';

type RideType = 'passenger' | 'colis';

interface InboxItem {
  id: string;
  rideType: RideType;
  isForOther: boolean;
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null };
  fareEstimateKhoums: number | null;
  distanceM: number | null;
  distanceToPickupM: number;
  isFavorite: boolean;
  homewardProgressM: number | null;
  requestedAt: string;
}

// Module-level so a ride the captain already saw doesn't re-alert when the
// captain switches screens or toggles modes. Also persisted to AsyncStorage
// so Expo Go fast-refresh / app restarts don't replay the same alerts.
const seenRideIds = new Set<string>();
const SEEN_STORAGE_KEY = '@tewiz/captain-seen-rides';
const PAUSE_STORAGE_KEY = '@tewiz/captain-pause-until';

let seenLoaded = false;
async function loadSeenFromStorage() {
  if (seenLoaded) return;
  try {
    const raw = await AsyncStorage.getItem(SEEN_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      arr.forEach((id) => seenRideIds.add(id));
    }
  } catch {}
  seenLoaded = true;
}
async function persistSeen() {
  try {
    // Cap the persisted set at ~200 entries to avoid unbounded growth.
    const arr = Array.from(seenRideIds).slice(-200);
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
  seenRideIds.clear();
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
  const user = useAuth((s) => s.user);
  const activeMode = useAuth((s) => s.activeMode);

  const [alertRide, setAlertRide] = useState<InboxItem | null>(null);
  const [accepting, setAccepting] = useState(false);

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

  const fireOneBeep = useCallback(async (ride: InboxItem) => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: ride.rideType === 'colis' ? '📦 Nouveau colis' : '🚖 Nouvelle course',
          body: `${(ride.distanceToPickupM / 1000).toFixed(1)} km — ${
            ride.fareEstimateKhoums ? formatMru(ride.fareEstimateKhoums) : 'tarif inconnu'
          }`,
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

        // Only alert if no modal is currently showing.
        setAlertRide((prev) => {
          if (prev) return prev;
          const first = inb.data.find((it) => !seenRideIds.has(it.id));
          if (!first) return null;
          seenRideIds.add(first.id);
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
      Alert.alert('Impossible', e.response?.data?.error?.message ?? 'Course indisponible.');
      await stopRinging();
      setAlertRide(null);
    } finally {
      setAccepting(false);
    }
  }, [alertRide, router, stopRinging]);

  const refuseAlert = useCallback(async () => {
    await stopRinging();
    setAlertRide(null);
  }, [stopRinging]);

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
              🔕 Notifications en pause · {pauseMinsLeft} min · Reprendre
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
          <View style={{ flex: 1, padding: 24, justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: '#bfdbfe', fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>
                {alertRide.rideType === 'colis' ? '📦 NOUVEAU COLIS' : '🚖 NOUVELLE COURSE'}
              </Text>
              <Text style={{ color: '#fff', fontSize: 48, fontWeight: '800', marginTop: 8 }}>
                {(alertRide.distanceToPickupM / 1000).toFixed(1)} km
              </Text>
              <Text style={{ color: '#cbd5e1', fontSize: 14, marginTop: 2 }}>
                de votre position
              </Text>

              <View style={{
                marginTop: 32, backgroundColor: '#1e293b',
                borderRadius: 16, padding: 18, gap: 16,
              }}>
                <View>
                  <Text style={{ color: '#94a3b8', fontSize: 12 }}>De</Text>
                  <Text style={{ color: '#fff', fontSize: 16, marginTop: 2 }} numberOfLines={2}>
                    {alertRide.pickup.label ?? 'Point de prise en charge'}
                  </Text>
                </View>
                <View>
                  <Text style={{ color: '#94a3b8', fontSize: 12 }}>Vers</Text>
                  <Text style={{ color: '#fff', fontSize: 16, marginTop: 2 }} numberOfLines={2}>
                    {alertRide.dropoff.label ?? 'Destination'}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View>
                    <Text style={{ color: '#94a3b8', fontSize: 12 }}>Tarif estimé</Text>
                    <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 2 }}>
                      {alertRide.fareEstimateKhoums ? formatMru(alertRide.fareEstimateKhoums) : '—'}
                    </Text>
                  </View>
                  <View>
                    <Text style={{ color: '#94a3b8', fontSize: 12 }}>Trajet</Text>
                    <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 2 }}>
                      {alertRide.distanceM ? `${(alertRide.distanceM / 1000).toFixed(1)} km` : '—'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={{ gap: 12 }}>
              <Pressable
                disabled={accepting}
                onPress={acceptAlert}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? '#059669' : '#10a35e',
                  opacity: accepting ? 0.6 : 1,
                  paddingVertical: 20, borderRadius: 14,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
                })}
              >
                {accepting && <ActivityIndicator color="#fff" />}
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>
                  Accepter
                </Text>
              </Pressable>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable
                  disabled={accepting}
                  onPress={refuseAlert}
                  style={({ pressed }) => ({
                    flex: 1,
                    backgroundColor: pressed ? '#334155' : 'transparent',
                    paddingVertical: 16, borderRadius: 14,
                    borderWidth: 1, borderColor: '#475569',
                    alignItems: 'center',
                  })}
                >
                  <Text style={{ color: '#cbd5e1', fontSize: 14, fontWeight: '600' }}>
                    Refuser
                  </Text>
                  <Text style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                    cette course
                  </Text>
                </Pressable>
                <Pressable
                  disabled={accepting}
                  onPress={pauseFiveMin}
                  style={({ pressed }) => ({
                    flex: 1,
                    backgroundColor: pressed ? '#334155' : 'transparent',
                    paddingVertical: 16, borderRadius: 14,
                    borderWidth: 1, borderColor: '#475569',
                    alignItems: 'center',
                  })}
                >
                  <Text style={{ color: '#cbd5e1', fontSize: 14, fontWeight: '600' }}>
                    Pause 5 min
                  </Text>
                  <Text style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                    aucune alerte
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
