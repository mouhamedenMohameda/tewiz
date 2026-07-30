/**
 * Android battery-optimisation exemption — the reliability layer under the
 * incoming-ride full-screen alert.
 *
 * Why this exists: the alert mechanism itself is proven to work (Notifee posts a
 * `category=call` notification with a fullScreenIntent, and Android takes over
 * the lock screen). But on device it failed intermittently — roughly 3 rides out
 * of 15 — with no error anywhere. That signature is the OS, not the app: while
 * a captain is online the process must stay resident and receive high-priority
 * FCM without deferral, and Android's battery optimiser is free to doze it,
 * delay message delivery, or reclaim the process. Being on the exemption list
 * removes that freedom.
 *
 * This does NOT protect against a captain force-stopping the app (swiping it out
 * of recents on aggressive OEMs sets `stopped=true`, and Android then blocks all
 * FCM delivery by design — no app, Uber included, can work around that).
 *
 * Guided once, like the overlay and full-screen-intent prompts: we can't read
 * the exemption state from JS without a native module, so we don't try — we send
 * the captain to the system dialog once and persist a flag so we never nag.
 *
 * No-ops off Android, so it is safe to call unconditionally.
 */
import { Alert, Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { i18n } from './i18n';

// expo-intent-launcher is imported lazily so an older dev client that lacks the
// native module can still import this file (same pattern as overlayPermission).

const HANDLED_KEY = '@tewiz/battery-exemption-handled';

// Session guard so two quick goOnline() calls can't stack dialogs.
let promptedThisSession = false;

/**
 * Open the system battery-optimisation prompt for THIS app. The direct action
 * shows a simple allow/deny dialog; if an OEM doesn't handle it we fall back to
 * the exemption list, then to the app's settings page.
 */
async function openBatterySettings(): Promise<void> {
  const pkg = Application.applicationId;
  try {
    const IntentLauncher = await import('expo-intent-launcher');
    try {
      // Direct per-app dialog — one tap for the captain.
      await IntentLauncher.startActivityAsync(
        'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
        pkg ? { data: `package:${pkg}` } : undefined,
      );
      return;
    } catch {
      // Some OEMs refuse the direct action: fall back to the full list.
      await IntentLauncher.startActivityAsync(
        'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
      );
      return;
    }
  } catch {
    try { await Linking.openSettings(); } catch {}
  }
}

/**
 * Show the one-time guided prompt. Called when a captain goes online.
 *
 * @param opts.appName Display name interpolated into the copy.
 * @param opts.force   Re-show even if previously handled (manual recovery).
 */
export async function ensureBatteryExemption(
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
    t('captain.state.batteryTitle') as string,
    t('captain.state.batteryBody', { app: opts.appName ?? 'Tewiz' }) as string,
    [
      { text: t('captain.state.bgLocationLater') as string, style: 'cancel' },
      {
        text: t('captain.state.batteryEnable') as string,
        onPress: () => {
          void (async () => {
            await openBatterySettings();
            try { await AsyncStorage.setItem(HANDLED_KEY, '1'); } catch {}
          })();
        },
      },
    ],
  );
}
