/**
 * Which runtime the JS is executing in.
 *
 * Expo Go is a *shared* binary: its Info.plist / manifest are Expo's, not ours,
 * so the entitlements our app.config.ts declares (background location, the
 * `location` background mode…) simply do not exist there. iOS therefore never
 * offers "Always" in the settings — only Never / Ask / While Using — and
 * `requestBackgroundPermissionsAsync()` can never succeed.
 *
 * Anything that would ask the captain for background location must check this
 * first, otherwise the request loops forever on a permission the OS cannot
 * grant. A dev build (`expo run:ios` / EAS) is the only place to test it.
 */
import Constants from 'expo-constants';

export function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

/**
 * True when the running binary cannot obtain background ("Always") location at
 * all — no amount of prompting or settings trips will change it.
 */
export function backgroundLocationUnavailable(): boolean {
  return isExpoGo();
}
