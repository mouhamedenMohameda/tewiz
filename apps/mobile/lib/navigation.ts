import { Linking, Platform } from 'react-native';

/**
 * Hand a destination to the phone's navigation app.
 *
 * Why this exists: street addressing in Nouakchott is sparse and most pickups
 * are described by landmark. A label the rider chose ("chez moi") is useless to
 * a captain who has never been there, so before this the fallback was a phone
 * call on every single ride.
 *
 * Coordinates only, never the label. The label is what a human typed; the
 * lat/lng is what the rider actually pinned, and it is already on the ride.
 */

export interface NavTarget {
  lat: number;
  lng: number;
  /** Shown as the destination name where the target app supports it. */
  label?: string | null;
}

/** Always-resolvable web URL. Opens Maps if installed, the browser if not. */
export function webDirectionsUrl(target: NavTarget): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`;
}

/**
 * The best URL for this platform.
 *
 * Android gets `google.navigation:` — it starts turn-by-turn immediately rather
 * than dropping the driver on a preview screen they have to tap through while
 * holding the wheel. iOS gets `maps://`, which Apple Maps always answers.
 */
export function nativeNavigationUrl(target: NavTarget): string {
  if (Platform.OS === 'android') {
    return `google.navigation:q=${target.lat},${target.lng}&mode=d`;
  }
  return `maps://?daddr=${target.lat},${target.lng}&dirflg=d`;
}

/**
 * Open navigation to `target`, falling back to the web URL.
 *
 * The fallback is not defensive padding: a `google.navigation:` intent on a
 * phone with no Google Maps silently does nothing at all, which to the captain
 * looks like a broken button. `canOpenURL` is checked first, and the fallback
 * also covers the case where it throws (some Android configurations require the
 * scheme to be declared in the manifest to answer at all).
 */
export async function openNavigation(target: NavTarget): Promise<void> {
  const native = nativeNavigationUrl(target);
  const web = webDirectionsUrl(target);
  try {
    if (await Linking.canOpenURL(native)) {
      await Linking.openURL(native);
      return;
    }
  } catch {
    // Fall through to the web URL — never leave the captain with a dead button.
  }
  await Linking.openURL(web);
}

/**
 * Where the captain should be heading right now.
 *
 * Before the passenger is aboard, that is the pickup. Once the ride is under
 * way, it is the destination. Getting this backwards is worse than having no
 * button: it sends the captain away from a rider still standing on the kerb.
 *
 * Returns null when there is nothing to navigate to — an open ride has no
 * destination by definition, and the captain decides where it ends.
 */
export function navigationTargetForRide(ride: {
  status: string;
  pickup: { lat: number; lng: number; label?: string | null };
  dropoff?: { lat: number; lng: number; label?: string | null } | null;
}): NavTarget | null {
  if (ride.status === 'in_progress') {
    return ride.dropoff
      ? { lat: ride.dropoff.lat, lng: ride.dropoff.lng, label: ride.dropoff.label }
      : null;
  }
  return { lat: ride.pickup.lat, lng: ride.pickup.lng, label: ride.pickup.label };
}
