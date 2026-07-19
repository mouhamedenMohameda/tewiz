/**
 * Android "display over other apps" (SYSTEM_ALERT_WINDOW) permission helper —
 * the "superposition" that makes the incoming-ride screen behave like Uber.
 *
 * Why this matters: the full-screen "incoming ride" flow (lib/fullScreenRideAlert.ts)
 * already pops over the LOCK screen. But when the captain is UNLOCKED and using
 * another app, Android 10+ blocks apps from launching an activity from the
 * background — so the ride would only show as a heads-up banner. Granting
 * SYSTEM_ALERT_WINDOW lifts that background-activity-start restriction, so the
 * exact same Notifee `fullScreenAction` now takes over the screen over whatever
 * app the captain is in. No custom overlay View is needed — the permission is
 * the whole unlock.
 *
 * Like the full-screen-intent helper, this is a one-time guided prompt: neither
 * expo-notifications nor expo-application can READ the overlay state from JS
 * without a native module, so we don't try to detect it — we send the captain to
 * the exact system toggle once and persist a flag so we never nag again.
 *
 * Everything is a no-op off Android, so it's safe to call unconditionally.
 */
import { Alert, Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { i18n } from './i18n';

// expo-intent-launcher is loaded lazily below (not at module top level) so an
// older dev client that lacks the native module can still import this file.
// Same defensive pattern as fullScreenIntentPermission.ts / getNotifee().

// Set once the captain has been guided to the overlay settings screen.
const HANDLED_KEY = '@tewiz/overlay-handled';

// Session guard so two quick goOnline() calls don't stack dialogs.
let promptedThisSession = false;

/**
 * Open the exact "Display over other apps" screen for THIS app. The Android
 * action needs our package as intent data (`package:<id>`) to land directly on
 * our toggle; falls back to the generic app settings if an OEM doesn't handle it.
 */
async function openOverlaySettings(): Promise<void> {
  const pkg = Application.applicationId;
  try {
    const IntentLauncher = await import('expo-intent-launcher');
    await IntentLauncher.startActivityAsync(
      'android.settings.action.MANAGE_OVERLAY_PERMISSION',
      pkg ? { data: `package:${pkg}` } : undefined,
    );
  } catch {
    try { await Linking.openSettings(); } catch {}
  }
}

/**
 * Show the one-time guided prompt if we haven't already sent the captain to the
 * overlay settings screen. Called when a captain goes online.
 *
 * @param opts.appName  Display name to interpolate into the copy.
 * @param opts.force    Re-show even if previously handled (manual recovery).
 */
export async function ensureOverlayPermission(
  opts: { appName?: string; force?: boolean } = {},
): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (promptedThisSession && !opts.force) return;

  if (!opts.force) {
    try {
      const handled = await AsyncStorage.getItem(HANDLED_KEY);
      if (handled) return;
    } catch {
      // Storage unreadable — better to prompt than to stay silent.
    }
  }

  promptedThisSession = true;

  const t = i18n.t.bind(i18n);
  Alert.alert(
    t('captain.state.overlayTitle') as string,
    t('captain.state.overlayBody', { app: opts.appName ?? 'Tewiz' }) as string,
    [
      { text: t('captain.state.bgLocationLater') as string, style: 'cancel' },
      {
        text: t('captain.state.overlayEnable') as string,
        onPress: () => {
          void (async () => {
            await openOverlaySettings();
            try { await AsyncStorage.setItem(HANDLED_KEY, '1'); } catch {}
          })();
        },
      },
    ],
  );
}
