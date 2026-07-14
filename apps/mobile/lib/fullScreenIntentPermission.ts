/**
 * Android 14+ "full-screen intent" permission helper.
 *
 * Background: the full-screen "incoming ride" screen (see lib/fullScreenRideAlert.ts)
 * relies on posting a notification with a `fullScreenAction`. On Android 13 and
 * below the `USE_FULL_SCREEN_INTENT` permission is granted at install, so the
 * screen pops over the keyguard with no user action. On **Android 14+ (API 34)**
 * the OS revokes it by default for apps that aren't the default phone/alarm app —
 * the notification silently degrades to a heads-up banner instead of the
 * call-style full-screen. The user has to enable it once under
 * Settings → Special app access → Full-screen intents.
 *
 * Notifee 9.x exposes no way to *read* that permission state from JS (its
 * getNotificationSettings only reports the exact-alarm setting), and neither
 * expo-notifications nor expo-application do. So we can't reliably detect
 * whether it's already granted without a native module. Instead we take the
 * pragmatic route every messaging app uses: a one-time guided prompt that sends
 * the captain straight to the right system screen. We stop nagging once they've
 * been sent there (persisted flag) so it never becomes annoying.
 *
 * Everything is a no-op off Android / below API 34, so it's safe to call
 * unconditionally.
 */
import { Alert, Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { i18n } from './i18n';

// NOTE: expo-intent-launcher is loaded lazily (dynamic import) inside the
// function below — NOT at module top level — so that a build which doesn't
// yet include the native module (e.g. an older dev client) can still import
// this file without crashing the screen that imports it. Same defensive
// pattern as getNotifee() in fullScreenRideAlert.ts.

// Android 14 = API level 34: the first version that gates USE_FULL_SCREEN_INTENT.
const ANDROID_14 = 34;

// Set once the captain has been guided to the settings screen, so we don't
// prompt again on every "go online".
const HANDLED_KEY = '@tewiz/fsi-handled';

// Session guard: even before the persisted flag is written, don't stack two
// dialogs if goOnline() runs twice in quick succession.
let promptedThisSession = false;

function isAndroid14Plus(): boolean {
  return Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= ANDROID_14;
}

/**
 * Open the exact "Full-screen intents" special-access screen for this app.
 * The Android 14 settings action needs our package as intent *data*
 * (`package:<id>`), which only IntentLauncher can express — Linking.openSettings
 * lands on the generic app page. Falls back to the generic page if the specific
 * action isn't handled by the OEM's settings app.
 */
async function openFullScreenIntentSettings(): Promise<void> {
  const pkg = Application.applicationId;
  try {
    const IntentLauncher = await import('expo-intent-launcher');
    await IntentLauncher.startActivityAsync(
      'android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT',
      pkg ? { data: `package:${pkg}` } : undefined,
    );
  } catch {
    // OEM without that dedicated screen (rare) — the app's notification page is
    // the best fallback; the toggle usually lives there too.
    try { await Linking.openSettings(); } catch {}
  }
}

/**
 * Show the one-time guided prompt if we're on Android 14+ and haven't already
 * sent the captain to the settings screen. Called when a captain goes online.
 *
 * @param opts.force  Re-show even if previously handled (used by the manual
 *                    "notifications stuck" recovery action).
 */
export async function ensureFullScreenIntentPermission(
  opts: { force?: boolean } = {},
): Promise<void> {
  if (!isAndroid14Plus()) return;
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
    t('captain.state.fsiTitle') as string,
    t('captain.state.fsiBody') as string,
    [
      // "Later": leave the persisted flag unset so the next online session
      // nudges again — but don't re-pop within this session.
      { text: t('captain.state.bgLocationLater') as string, style: 'cancel' },
      {
        text: t('captain.state.fsiEnable') as string,
        onPress: () => {
          void (async () => {
            await openFullScreenIntentSettings();
            // They've been guided to the toggle; stop nagging on future logins.
            try { await AsyncStorage.setItem(HANDLED_KEY, '1'); } catch {}
          })();
        },
      },
    ],
  );
}
