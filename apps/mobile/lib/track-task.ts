/**
 * Level B — background off-ride location tracking.
 *
 * While a captain is online (even with the app backgrounded or the phone
 * locked), the OS delivers batched GPS fixes to a headless TaskManager task,
 * which forwards them to `POST /captain/state/track`. The server de-noises and
 * stores them in `captain_track`; the back-office draws the path.
 *
 * This module is import-for-side-effects: importing it calls
 * `TaskManager.defineTask` at load time (required — the task must be defined
 * before the OS can invoke it). Call `startOfflineTracking()` when the captain
 * goes online and `stopOfflineTracking()` when they go offline.
 *
 * The task runs in a separate JS context where the Zustand auth store is NOT
 * hydrated, so it reads the tokens straight from SecureStore (which is why they
 * are stored with AFTER_FIRST_UNLOCK — this context runs while the phone is
 * locked) and talks to the API with plain `fetch` (no axios interceptors here).
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { API_URL } from './env';
import { getTokens, setAccessToken, migrateLegacyTokens, type Tokens } from './secureTokens';

export const OFFLINE_LOCATION_TASK = 'offline-location-tracking';

async function readAuth(): Promise<Tokens | null> {
  // SecureStore first; fall back to migrating a legacy session in case the
  // task fires after an update but before the app has hydrated once.
  const tokens = await getTokens();
  if (tokens) return tokens;
  return migrateLegacyTokens();
}

// Refresh the access token from the background context and persist it, so a
// long online session doesn't silently stop uploading once the token expires.
async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const r = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { accessToken?: string };
    if (!data.accessToken) return null;
    await setAccessToken(data.accessToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

interface TrackPoint {
  lat: number;
  lng: number;
  accuracyM?: number;
  speedMps?: number;
  recordedAt: number;
}

async function postBatch(points: TrackPoint[], token: string): Promise<number> {
  const r = await fetch(`${API_URL}/captain/state/track`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ points }),
  });
  return r.status;
}

// The headless task: forward each batch of OS-delivered fixes to the server.
TaskManager.defineTask(OFFLINE_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] })?.locations;
  if (!locations || locations.length === 0) return;

  const auth = await readAuth();
  if (!auth) return; // signed out — nothing we can do from here

  const points: TrackPoint[] = locations.map((l) => ({
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    accuracyM: l.coords.accuracy ?? undefined,
    speedMps: l.coords.speed ?? undefined,
    recordedAt: Math.round(l.timestamp),
  }));

  let status = await postBatch(points, auth.accessToken);
  if (status === 401) {
    const fresh = await refreshAccessToken(auth.refreshToken);
    if (fresh) status = await postBatch(points, fresh);
  }
  // Any other failure is swallowed: the OS will deliver the next batch, and the
  // server stays authoritative. We never block the task on transient errors.
});

/**
 * Begin background tracking. Requires foreground + background location
 * permission; if the user declines "Always"/background, we bail quietly and
 * the feature simply stays off for this captain.
 *
 * Cadence targets ~50 m / 30 s (see the agreed Level B profile). The OS batches
 * fixes and wakes the task with `deferredUpdatesInterval`, which is far more
 * battery-friendly than a foreground timer.
 */
export async function startOfflineTracking(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;

  // Google Play requires our own disclosure BEFORE the OS background-location
  // dialog (see backgroundLocationDisclosure.ts). Skipped once the permission
  // is already granted, since no request follows. Declining is a refusal: the
  // caller takes the captain back offline, exactly as for a denied OS prompt.
  //
  // Imported lazily so the headless TaskManager context — which loads this
  // module for its defineTask side effect — never pulls in i18n or Alert.
  const current = await Location.getBackgroundPermissionsAsync().catch(() => null);
  if (current?.status !== 'granted') {
    const { showBackgroundLocationDisclosure } = await import('./backgroundLocationDisclosure');
    if (!(await showBackgroundLocationDisclosure())) return false;
  }

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return false;

  const already = await Location.hasStartedLocationUpdatesAsync(OFFLINE_LOCATION_TASK);
  if (already) return true;

  try {
    await Location.startLocationUpdatesAsync(OFFLINE_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    // A fix every ~60 s OR every ~50 m of movement, whichever comes first. The
    // time-based tick is essential: a captain waiting for rides is STATIONARY,
    // so a distance-only trigger would let his stored position (and its
    // freshness stamp) go stale and drop him from dispatch. 60 s keeps him well
    // inside the server's freshness window.
    timeInterval: 60_000,
    distanceInterval: 50,          // a fix at most every ~50 m of movement
    deferredUpdatesInterval: 30_000, // …and flush the batch at most every 30 s
    deferredUpdatesDistance: 50,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    // Android requires a persistent foreground-service notification while
    // collecting location in the background.
    foregroundService: Platform.OS === 'android' ? {
      notificationTitle: 'Vous êtes en ligne',
      notificationBody: 'Votre position est partagée avec le support pendant votre service.',
      // Keep the service (and therefore the app process) alive when the captain
      // swipes the app out of recents. With `true`, swiping killed the process,
      // so an incoming-ride push had nothing left to wake: the full-screen alert
      // never fired "app closed" — the exact symptom reported on device. An
      // online captain must stay reachable, like every driver app; going offline
      // still stops it via stopOfflineTracking().
      killServiceOnDestroy: false,
    } : undefined,
    });
    return true;
  } catch (err) {
    // The native location service couldn't start — most often a build whose
    // Info.plist (iOS) / manifest (Android) lacks the background-location
    // config. Never throw: callers treat `false` as "tracking unavailable" and
    // degrade gracefully instead of crashing with an unhandled rejection.
    // eslint-disable-next-line no-console
    console.warn('[track] startLocationUpdatesAsync failed', err);
    return false;
  }
}

/**
 * Resume tracking WITHOUT prompting — for app restarts where the captain is
 * already online. Only starts if background permission was previously granted,
 * so a passive screen mount never triggers a permission dialog.
 */
export async function resumeOfflineTracking(): Promise<void> {
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return;
  const already = await Location.hasStartedLocationUpdatesAsync(OFFLINE_LOCATION_TASK);
  if (already) return;
  await startOfflineTracking();
}

/** Stop background tracking (captain goes offline / logs out). Idempotent. */
export async function stopOfflineTracking(): Promise<void> {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(OFFLINE_LOCATION_TASK);
    if (started) await Location.stopLocationUpdatesAsync(OFFLINE_LOCATION_TASK);
  } catch {
    // Not started / task not registered yet — nothing to stop.
  }
}
