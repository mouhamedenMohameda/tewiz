/**
 * Captain permissions — the single place that knows WHICH authorisations a
 * captain needs, how to read them and how to ask for them.
 *
 * Why this module exists: the OS gives us no way to bundle several permissions
 * into one dialog — iOS and Android each show their own prompt, per permission,
 * and refuse to be grouped. What we CAN control is that the captain only ever
 * performs ONE action ("Tout autoriser") and sees the prompts back to back, at
 * a moment they expect them, instead of being ambushed by a dialog every time
 * they touch a new screen. That single action lives in
 * `components/CaptainPermissions.tsx`; this file is its engine.
 *
 * Two OS rules shape everything here — neither is ours to work around:
 *   1. iOS never grants "Always" from a cold start. `When In Use` must be
 *      granted FIRST, and only then can the background request escalate it.
 *      Hence the ordering in CAPTAIN_PERMISSIONS, which callers must respect.
 *   2. Android 11+ (API 30) removed the background-location dialog entirely:
 *      requesting it returns `denied` without showing anything, and burns the
 *      request. So there we skip the request and guide to the settings page —
 *      see `alwaysNeedsSettings()`.
 *
 * Photos/camera stay deliberately OUT of this list: they're only needed when
 * uploading a KYC document or a wallet receipt, and are already requested
 * just-in-time there. Asking for them upfront is exactly the kind of cold nag
 * this module exists to remove.
 */

import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';

import { showBackgroundLocationDisclosure } from './backgroundLocationDisclosure';
import { registerForPushNotifications } from './notifications';

export type CaptainPermissionKey =
  | 'location'      // foreground GPS — no fix at all without it
  | 'always'        // background/"Always" — keeps dispatch fed while backgrounded
  | 'notifications' // incoming-ride alerts
  | 'microphone';   // voice ride search / voice notes

export type PermStatus = 'granted' | 'denied' | 'undetermined';

export type PermStatuses = Record<CaptainPermissionKey, PermStatus>;

export interface CaptainPermission {
  key: CaptainPermissionKey;
  /** Required ones block going online; optional ones only degrade a feature. */
  required: boolean;
  icon: 'pin' | 'map' | 'bell' | 'voice';
}

/**
 * Declaration order IS the request order — `location` must come before
 * `always` (see rule 1 above). Anything iterating this list to request
 * permissions must walk it in order.
 */
export const CAPTAIN_PERMISSIONS: readonly CaptainPermission[] = [
  { key: 'location', required: true, icon: 'pin' },
  { key: 'always', required: true, icon: 'map' },
  { key: 'notifications', required: true, icon: 'bell' },
  { key: 'microphone', required: false, icon: 'voice' },
] as const;

const ONBOARDING_KEY = '@tewiz/captain-permissions-onboarded';

/** Normalise the various expo permission shapes onto our three states. */
function toStatus(p: { status: string; canAskAgain?: boolean }): PermStatus {
  if (p.status === 'granted') return 'granted';
  if (p.status === 'undetermined') return 'undetermined';
  // `denied` but still askable happens on Android before the first prompt on
  // some OEMs — treat it as undetermined so the UI still offers to ask.
  if (p.status === 'denied' && p.canAskAgain === true) return 'undetermined';
  return 'denied';
}

/**
 * Android 11+ refuses to show a background-location dialog: the only path is
 * the app's settings page ("Toujours autoriser"). Callers must send the captain
 * there instead of calling `request('always')`, which would silently fail.
 */
export function alwaysNeedsSettings(): boolean {
  return Platform.OS === 'android' && Number(Platform.Version) >= 30;
}

/** Read every permission WITHOUT prompting. Safe to call on mount. */
export async function readCaptainPermissions(): Promise<PermStatuses> {
  const [fg, bg, notif, mic] = await Promise.all([
    Location.getForegroundPermissionsAsync().catch(() => null),
    Location.getBackgroundPermissionsAsync().catch(() => null),
    Notifications.getPermissionsAsync().catch(() => null),
    Audio.getPermissionsAsync().catch(() => null),
  ]);
  return {
    location: fg ? toStatus(fg) : 'undetermined',
    always: bg ? toStatus(bg) : 'undetermined',
    notifications: notif ? toStatus(notif) : 'undetermined',
    microphone: mic ? toStatus(mic) : 'undetermined',
  };
}

/** Open this app's settings page — the recovery path for every denied item. */
export async function openAppSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // Nothing else to try; the UI already told the captain what to look for.
  }
}

export interface RequestOutcome {
  status: PermStatus;
  /**
   * True when the captain must finish the job in the system settings — either
   * Android 11+ background location, or a permission previously denied for
   * good. The UI turns the row into a "Corriger" action instead of retrying a
   * prompt that can no longer appear.
   */
  needsSettings: boolean;
  /**
   * The native request THREW — the permission can't be asked for on this build
   * at all. In practice: an app binary whose Info.plist / manifest predates the
   * feature (the classic being `NSLocationAlwaysAndWhenInUseUsageDescription`
   * missing, which makes expo-location throw instead of prompting), or Expo Go,
   * which has no background-location entitlement.
   *
   * This is NOT a refusal and settings won't fix it — only a new build will —
   * so the UI says so rather than blaming the captain.
   */
  unavailable?: boolean;
}

/**
 * Request ONE permission, honouring the OS constraints above.
 *
 * NEVER throws. A native request that blows up (see `unavailable`) used to take
 * the whole "Tout autoriser" chain down with it, so the captain got the first
 * dialog and nothing after — the exact bug this function's try/catch prevents.
 *
 * `current` lets the caller pass the statuses it already read, so an
 * already-granted permission is never re-requested (which on iOS is a no-op but
 * on Android can consume the "don't ask again" budget).
 */
export async function requestCaptainPermission(
  key: CaptainPermissionKey,
  current?: PermStatuses,
): Promise<RequestOutcome> {
  try {
    return await requestOne(key, current);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[permissions] request "${key}" failed`, err);
    const status = current?.[key] ?? 'undetermined';
    return { status, needsSettings: false, unavailable: true };
  }
}

async function requestOne(
  key: CaptainPermissionKey,
  current?: PermStatuses,
): Promise<RequestOutcome> {
  const statuses = current ?? (await readCaptainPermissions());
  if (statuses[key] === 'granted') return { status: 'granted', needsSettings: false };

  switch (key) {
    case 'location': {
      const r = await Location.requestForegroundPermissionsAsync();
      const status = toStatus(r);
      return { status, needsSettings: status === 'denied' };
    }

    case 'always': {
      // Foreground first — the OS rejects a background request without it, and
      // on iOS "Always" is strictly an escalation of "When In Use".
      if (statuses.location !== 'granted') {
        return { status: statuses.always, needsSettings: false };
      }

      // Google Play requires OUR disclosure before the OS dialog (and before
      // sending the captain to settings for the same purpose). A decline here
      // is a real decline — we don't request anything.
      if (!(await showBackgroundLocationDisclosure())) {
        return { status: statuses.always, needsSettings: false };
      }

      if (alwaysNeedsSettings()) {
        await openAppSettings();
        // The captain is now in Settings; the panel re-reads on app resume.
        return { status: statuses.always, needsSettings: true };
      }

      const r = await Location.requestBackgroundPermissionsAsync();
      const status = toStatus(r);
      return { status, needsSettings: status === 'denied' };
    }

    case 'notifications': {
      const r = await Notifications.requestPermissionsAsync();
      const status = toStatus(r);
      // Getting the permission is only half the job — dispatch needs the push
      // token registered server-side. Best-effort: never fails the request.
      if (status === 'granted') void registerForPushNotifications();
      return { status, needsSettings: status === 'denied' };
    }

    case 'microphone': {
      const r = await Audio.requestPermissionsAsync();
      const status = toStatus(r);
      return { status, needsSettings: status === 'denied' };
    }
  }
}

/**
 * Run the whole chain in order — the engine behind the single "Tout autoriser"
 * button. Stops asking for `always` when `location` was refused (the OS would
 * reject it anyway), and reports what still needs a trip to the settings.
 *
 * @param onProgress Called after each step so the UI can tick rows live.
 */
export async function requestAllCaptainPermissions(
  onProgress?: (key: CaptainPermissionKey, outcome: RequestOutcome) => void,
): Promise<{
  statuses: PermStatuses;
  needsSettings: CaptainPermissionKey[];
  unavailable: CaptainPermissionKey[];
}> {
  const statuses = await readCaptainPermissions();
  const needsSettings: CaptainPermissionKey[] = [];
  const unavailable: CaptainPermissionKey[] = [];

  for (const item of CAPTAIN_PERMISSIONS) {
    if (statuses[item.key] === 'granted') continue;
    // No point asking for background location once foreground was refused.
    if (item.key === 'always' && statuses.location !== 'granted') continue;

    // One permission failing must never stop the chain: that turned "Tout
    // autoriser" into "autorise la première puis abandonne". requestCaptain-
    // Permission already swallows throws; the guard here also covers a
    // misbehaving onProgress callback.
    let outcome: RequestOutcome;
    try {
      outcome = await requestCaptainPermission(item.key, statuses);
    } catch {
      outcome = { status: statuses[item.key], needsSettings: false, unavailable: true };
    }

    statuses[item.key] = outcome.status;
    if (outcome.needsSettings) needsSettings.push(item.key);
    if (outcome.unavailable) unavailable.push(item.key);
    try {
      onProgress?.(item.key, outcome);
    } catch {
      // A UI callback must not abort the remaining prompts either.
    }
  }

  return { statuses, needsSettings, unavailable };
}

/** True once every REQUIRED permission is granted. */
export function allRequiredGranted(statuses: PermStatuses): boolean {
  return CAPTAIN_PERMISSIONS.every((p) => !p.required || statuses[p.key] === 'granted');
}

/* ------------------------------------------------------------------ *
 *  Onboarding flag — the panel is a one-time welcome, not a recurring
 *  nag. Going online still enforces the mandatory permissions on its
 *  own (captain/index.tsx), so skipping here can never leave a captain
 *  silently untrackable.
 * ------------------------------------------------------------------ */

export async function isPermissionOnboardingDone(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_KEY)) === '1';
  } catch {
    return true; // storage unavailable — never block the app over it
  }
}

export async function markPermissionOnboardingDone(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    // Worst case the panel shows again next launch — harmless.
  }
}
