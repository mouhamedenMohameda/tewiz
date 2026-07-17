import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { getAppConfig } from './appConfig';

const DEVICE_ID_KEY = '@tewiz/device-id';
const PERMISSION_ASKED_KEY = '@tewiz/notif-permission-asked';

/**
 * Stable per-install device id. Persisted so the server can dedupe push
 * tokens per device (a user with phone + tablet keeps two rows).
 */
async function getOrCreateDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (id) return id;
  id = 'tewiz-' + Math.random().toString(36).slice(2, 12);
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

// Foreground behavior: when a push lands while the app is open, show the
// banner + play the sound. Without this the OS would just silently update
// the badge.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Sets up the Android notification channels. Required for Android 8+ —
 * a push referencing a channel that doesn't exist on-device is silently
 * dropped by the OS whenever the app isn't in the foreground (in the
 * foreground our JS notification handler shows it regardless, which is
 * why a missing channel only shows up as "notifications don't arrive
 * when the app is closed").
 */
async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  const config = getAppConfig();
  await Notifications.setNotificationChannelAsync('ride-alerts', {
    name: 'Nouvelles courses',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: config.captainAlertSoundMode === 'critical'
      ? [0, 500, 250, 500, 250, 500]
      : [0, 400, 250, 400],
    lightColor: '#10a35e',
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: 'default',
  });
  // Used by admin/bonus/info broadcasts (notifications.service.ts) — a
  // lower-key channel than ride-alerts since these aren't time-critical.
  await Notifications.setNotificationChannelAsync('general', {
    name: 'Notifications générales',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: '#10a35e',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: 'default',
  });
}

/**
 * Asks for notification permission, retrieves the Expo Push Token, and
 * sends it to the backend. Called from RootLayout whenever a signed-in
 * user id is present (cold start with a persisted session, or a fresh
 * login/signup during the current app session). Safe to call multiple
 * times — backend upserts on (user_id, device_id).
 *
 * Returns true if we have a valid token registered, false otherwise.
 */
export async function registerForPushNotifications(): Promise<boolean> {
  // Push only works on physical devices. Skip silently on simulators.
  if (!Device.isDevice) return false;

  try {
    await ensureAndroidChannel();

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const ask = await Notifications.requestPermissionsAsync();
      status = ask.status;
      await AsyncStorage.setItem(PERMISSION_ASKED_KEY, '1');
    }
    if (status !== 'granted') return false;

    // The Expo project id is required to mint an Expo Push Token.
    // Falls back to the EAS project id from the app config.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;

    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );

    const deviceId = await getOrCreateDeviceId();
    await api.post('/auth/push-token', {
      deviceId,
      token: tokenResp.data,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    return true;
  } catch (err) {
    // Network down / project id missing / user denied — never block UI.
    // eslint-disable-next-line no-console
    console.warn('[notifications] register failed', err);
    return false;
  }
}

/**
 * Drops the push token on logout so the server stops sending pushes to a
 * device that's no longer signed in.
 */
export async function unregisterPushToken() {
  try {
    const deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) return;
    await api.delete('/auth/push-token', { data: { deviceId } });
  } catch {
    // Best-effort cleanup.
  }
}
