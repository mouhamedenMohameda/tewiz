import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

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
 * Sets up the Android "ride-alerts" channel with high importance.
 * Required for Android 8+ — without a channel, Android uses defaults
 * and ignores per-message sound settings.
 */
async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('ride-alerts', {
    name: 'Nouvelles courses',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 500, 250, 500],
    lightColor: '#10a35e',
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/**
 * Asks for notification permission, retrieves the Expo Push Token, and
 * sends it to the backend. Called after captain login / after captain
 * promotion. Safe to call multiple times — backend upserts on
 * (user_id, device_id).
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
