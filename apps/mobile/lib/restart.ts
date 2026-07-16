/**
 * Full JS reload — the only clean way to apply an LTR↔RTL flip.
 *
 * `I18nManager.forceRTL()` only affects native views created AFTER the call:
 * flipping it on a running app leaves the mounted screens half-mirrored (the
 * "dancing header" bug). Reloading the bundle rebuilds every view from
 * scratch, so the whole tree comes back in one consistent direction.
 *
 * Dev (Expo Go / dev-client): DevSettings.reload() restarts the bundle.
 * Release: expo-updates reloadAsync() relaunches from the embedded bundle.
 *
 * Returns false when no reload mechanism worked — the caller should then ask
 * the user to restart the app manually.
 */

import { DevSettings } from 'react-native';

export async function reloadApp(): Promise<boolean> {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    try {
      DevSettings.reload();
      return true;
    } catch {
      return false;
    }
  }
  try {
    const Updates = await import('expo-updates');
    await Updates.reloadAsync();
    return true;
  } catch {
    return false;
  }
}
