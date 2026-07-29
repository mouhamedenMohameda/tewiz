/**
 * Android "incoming ride" full-screen alert (call-style), fired when a new
 * ride arrives while the app is backgrounded or killed.
 *
 * How it works:
 *   1. The API sends Android captains a *data-only* push (no title/body) with
 *      `data.type === 'ride_alert'`. A data-only push wakes a headless JS task
 *      even when the app is killed (a push carrying a `notification` payload
 *      would be shown by the OS directly and never run our JS).
 *   2. That task (BACKGROUND_RIDE_TASK, registered with expo-notifications)
 *      calls Notifee to post a notification with a `fullScreenAction`. On a
 *      locked screen Android launches the app full-screen over the keyguard —
 *      exactly like an incoming call. Unlocked, it shows a heads-up banner.
 *   3. Answering/tapping launches MainActivity; on startup we route to the
 *      captain rides screen and <CaptainRideWatcher> takes over (modal + ring).
 *
 * Everything is guarded: iOS returns early (it cannot auto-launch UI from the
 * background — it keeps the classic notification), and Notifee is loaded
 * dynamically so an old build / Expo Go / web degrades to the normal flow
 * instead of crashing.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

const BACKGROUND_RIDE_TASK = 'TEWIZ_BACKGROUND_RIDE_ALERT';
const CHANNEL_ID = 'ride-fullscreen';
// Keep in sync with RING_DURATION_MS in CaptainRideWatcher: the full-screen
// notification auto-cancels after this window so a missed ride doesn't linger.
const RING_DURATION_MS = 15_000;

interface RideAlertData {
  rideId?: string;
  title?: string;
  body?: string;
}

/**
 * Lazily load the Notifee module NAMESPACE. Returns null when the native module
 * isn't available (old build, Expo Go, web) so callers can no-op instead of
 * throwing.
 *
 * IMPORTANT: the namespace and the callable API instance are NOT the same
 * object. Notifee's index does:
 *
 *   exports.default = Object.assign(apiModule, { SDK_VERSION });
 *   __exportStar(require('./types/NotificationAndroid'), exports);
 *
 * so `AndroidImportance` / `AndroidCategory` / `AndroidVisibility` live on the
 * NAMESPACE only — reading them off `.default` yields undefined. That is exactly
 * what silently killed the full-screen ride alert: `AndroidImportance.HIGH`
 * threw a TypeError inside the try/catch below, so the headless task ran and
 * "finished" normally while never creating the channel or posting anything.
 */
function getNotifeeModule(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    return require('@notifee/react-native');
  } catch {
    return null;
  }
}

/** The callable API instance (displayNotification, createChannel, ...). */
function getNotifee(): any | null {
  const mod = getNotifeeModule();
  return mod ? (mod.default ?? mod) : null;
}

/**
 * Post the full-screen "incoming ride" notification. Android-only; no-ops
 * elsewhere or when Notifee is unavailable.
 */
/**
 * Build the exact channel + notification payloads handed to Notifee.
 *
 * Pure and exported so the enum wiring can be unit-tested: `mod` is the Notifee
 * module NAMESPACE, and the fallbacks are Notifee's own literal values, so even
 * a namespace that is missing the enums (the bug) still produces a working
 * high-importance call-style alert instead of throwing.
 */
export function buildFullScreenAlert(mod: any, data: RideAlertData): {
  channel: Record<string, unknown>;
  notification: Record<string, unknown>;
} {
  const IMPORTANCE_HIGH = mod?.AndroidImportance?.HIGH ?? 4;
  const CATEGORY_CALL = mod?.AndroidCategory?.CALL ?? 'call';
  const VISIBILITY_PUBLIC = mod?.AndroidVisibility?.PUBLIC ?? 1;

  return {
    channel: {
      id: CHANNEL_ID,
      name: 'Courses entrantes',
      importance: IMPORTANCE_HIGH,
      sound: 'default',
      vibration: true,
      vibrationPattern: [300, 500, 300, 500],
      visibility: VISIBILITY_PUBLIC,
      bypassDnd: true,
    },
    notification: {
      id: data.rideId ? `ride-${data.rideId}` : undefined,
      title: data.title ?? '🚖 Nouvelle course',
      body: data.body ?? 'Une nouvelle course est disponible près de vous.',
      data: { type: 'ride_alert', rideId: data.rideId ?? '' },
      android: {
        channelId: CHANNEL_ID,
        importance: IMPORTANCE_HIGH,
        category: CATEGORY_CALL,
        visibility: VISIBILITY_PUBLIC,
        // The star of the show: launch the app full-screen over the lock
        // screen. `launchActivity: 'default'` opens MainActivity.
        fullScreenAction: { id: 'default', launchActivity: 'default' },
        pressAction: { id: 'default', launchActivity: 'default' },
        // Auto-dismiss after the ring window (matches the in-app 15 s rule).
        timeoutAfter: RING_DURATION_MS,
        autoCancel: true,
        lightUpScreen: true,
      },
    },
  };
}

export async function displayFullScreenRideAlert(data: RideAlertData): Promise<void> {
  if (Platform.OS !== 'android') return;
  const mod = getNotifeeModule();
  if (!mod) return;
  const notifee = mod.default ?? mod;

  const { channel, notification } = buildFullScreenAlert(mod, data);

  try {
    await notifee.createChannel(channel);
    await notifee.displayNotification(notification);
  } catch (err) {
    // Never throw out of a headless task — but DO log. Swallowing this silently
    // is precisely what hid the enum bug above: the task ran, "finished" fine,
    // and the captain simply never got a full-screen alert, with nothing in the
    // logs to explain it. A visible warning turns that into a 30-second fix.
    // eslint-disable-next-line no-console
    console.warn('[ride-alert] full-screen notification failed', err);
  }
}

/**
 * Extracts the ride-alert payload from the various shapes expo-notifications
 * hands the background task across platforms/SDK versions. Defensive because
 * the exact nesting isn't guaranteed.
 */
export function extractRideAlert(taskData: unknown): RideAlertData | null {
  const d = taskData as any;

  // Candidate "content" objects across the shapes expo-notifications hands us
  // in foreground / different SDK versions.
  const candidates: any[] = [
    d?.notification?.request?.content?.data,
    d?.notification?.data,
    d?.data,
    d,
  ];

  // Android data-only FCM path (the real one for a killed/backgrounded app):
  // the payload arrives as a JSON *string* under data.dataString (and data.body).
  // Parse those and add them as candidates.
  const stringFields = [d?.data?.dataString, d?.data?.body, d?.dataString, d?.body];
  for (const s of stringFields) {
    if (typeof s === 'string') {
      try {
        candidates.push(JSON.parse(s));
      } catch {
        // not JSON (e.g. a plain notification body) — ignore
      }
    }
  }

  for (const content of candidates) {
    if (content && content.type === 'ride_alert') {
      return {
        rideId: typeof content.rideId === 'string' ? content.rideId : undefined,
        title: typeof content.title === 'string' ? content.title : undefined,
        body: typeof content.body === 'string' ? content.body : undefined,
      };
    }
  }
  return null;
}

// Headless task that runs when a data-only ride push arrives while the app is
// backgrounded or killed. Must be defined at module top level.
TaskManager.defineTask(BACKGROUND_RIDE_TASK, async ({ data, error }) => {
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[ride-alert] background task error', error);
    return;
  }
  const alert = extractRideAlert(data);
  if (!alert) {
    // Not a ride push (or a payload shape extractRideAlert doesn't know yet).
    // Logged because a missed shape looks exactly like "push never arrived".
    // eslint-disable-next-line no-console
    console.warn('[ride-alert] no ride payload in task data');
    return;
  }
  await displayFullScreenRideAlert(alert);
});

// Notifee background event (fires when the user answers/taps the full-screen
// notification while backgrounded/killed). The action launches the app; the
// startup router handles the rest, so there's nothing to do here beyond
// acknowledging the event. Registered at top level as Notifee requires.
(() => {
  if (Platform.OS !== 'android') return;
  const notifee = getNotifee();
  if (!notifee) return;
  try {
    notifee.onBackgroundEvent(async () => {});
  } catch {}
})();

/**
 * Register the background notification task with expo-notifications. Safe to
 * call every launch. Android-only.
 */
export async function registerBackgroundRideAlertTask(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.registerTaskAsync(BACKGROUND_RIDE_TASK);
  } catch {
    // expo-task-manager not linked yet (old build) — ignore.
  }
}

/**
 * If the app was cold-started by tapping/answering the full-screen ride
 * notification, returns its ride payload (so the caller can route to the ride
 * screen). Returns null otherwise. Android-only.
 */
export async function getInitialFullScreenRide(): Promise<RideAlertData | null> {
  if (Platform.OS !== 'android') return null;
  const notifee = getNotifee();
  if (!notifee) return null;
  try {
    const initial = await notifee.getInitialNotification();
    const type = initial?.notification?.data?.type;
    if (type === 'ride_alert') {
      const rideId = initial?.notification?.data?.rideId;
      return { rideId: typeof rideId === 'string' ? rideId : undefined };
    }
  } catch {}
  return null;
}
