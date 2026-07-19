/**
 * iOS Live Activity for the *active ride* (course en cours).
 *
 * While a captain is on a ride, a Live Activity shows the trip state on the
 * lock screen and in the Dynamic Island — pickup → dropoff, phase (en route /
 * arrivé / en course) and fare — without the captain having to open the app.
 * This is the iOS complement to the Android full-screen flow: Android can pop
 * UI over the keyguard for the *incoming* ride; iOS keeps a live glanceable
 * card for the *ongoing* ride.
 *
 * Architecture:
 *   - JS builds fully-rendered display strings (i18n stays here) and hands them
 *     to the native module `LiveActivity` (see modules/live-activity, Swift
 *     ActivityKit) which owns the start/update/end lifecycle.
 *   - The SwiftUI rendering lives in the widget extension (targets/rideactivity).
 *
 * Everything is defensive and iOS-only:
 *   - Android and web: no-op (the native module isn't linked there).
 *   - Old builds / iOS < 16.2 / user disabled Live Activities: the native
 *     functions return early, so JS callers never throw — same graceful
 *     degradation pattern as getNotifee() in fullScreenRideAlert.ts.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { i18n } from './i18n';
import { formatMru } from './format';

// Resolves to the Swift module registered as Name("LiveActivity"), or null when
// it isn't linked (Android, web, or a build made before this module existed).
const LiveActivity = requireOptionalNativeModule<{
  areActivitiesEnabled: () => boolean;
  start: (rideId: string, title: string, state: RideActivityState) => Promise<string | null>;
  update: (state: RideActivityState) => Promise<void>;
  end: () => Promise<void>;
}>('LiveActivity');

// The dynamic content the widget renders. All strings, already localized/
// formatted in JS so the Swift side stays a dumb renderer.
export interface RideActivityState {
  statusLabel: string; // "En route vers le client" / "Arrivé" / "Course en cours"
  pickup: string;
  dropoff: string;
  fare: string; // "1 200 MRU" or "—"
  phase: string; // raw status: 'accepted' | 'arrived' | 'in_progress'
}

// The subset of the ride we need to render the activity. Kept structural so the
// hook doesn't couple to the full Ride type in rides.tsx.
export interface LiveActivityRide {
  id: string;
  rideType: 'passenger' | 'colis' | 'private_driver' | 'convoyage';
  status: string;
  isOpen?: boolean;
  pickup: { label: string | null };
  dropoff: { label: string | null } | null;
  fareEstimateMru: number | null;
  liveMeter?: { fareMru: number } | null;
}

// Non-terminal states where an activity should be showing.
export const ACTIVE_STATUSES = new Set(['accepted', 'arrived', 'in_progress']);

// Short header label per ride type. Kept as literals (not i18n) because the
// widget is a secondary surface and these are brand-ish; localize later if
// needed by adding keys and swapping this map for i18n.t.
const TITLE_BY_TYPE: Record<LiveActivityRide['rideType'], string> = {
  passenger: '🚖 Course',
  colis: '📦 Colis',
  private_driver: '🕐 Captain Privé',
  convoyage: '🚗 Convoyage',
};

export function buildTitle(ride: LiveActivityRide): string {
  return TITLE_BY_TYPE[ride.rideType] ?? '🚖 Course';
}

export function buildState(ride: LiveActivityRide): RideActivityState {
  const t = i18n.t.bind(i18n);

  // Only accepted/arrived/in_progress have step labels; fall back to raw status.
  const statusLabel = ACTIVE_STATUSES.has(ride.status)
    ? (t(`captain.rides.stepLabel.${ride.status}`) as string)
    : ride.status;

  const pickup = ride.pickup.label ?? (t('captain.rides.pickupFallback') as string);

  const dropoff = ride.rideType === 'private_driver'
    ? (t('captain.rides.openDestinationShort') as string)
    : ride.isOpen
      ? (t('captain.rides.openDestinationShort') as string)
      : (ride.dropoff?.label ?? (t('captain.rides.dropoffFallback') as string));

  // Open rides show the live trusted meter; others the estimate.
  const fareMru = ride.isOpen ? (ride.liveMeter?.fareMru ?? null) : ride.fareEstimateMru;
  const fare = fareMru != null ? formatMru(fareMru) : '—';

  return { statusLabel, pickup, dropoff, fare, phase: ride.status };
}

/** Whether Live Activities are available and enabled (iOS 16.2+ + user setting). */
export function liveActivitiesEnabled(): boolean {
  if (Platform.OS !== 'ios' || !LiveActivity) return false;
  try {
    return LiveActivity.areActivitiesEnabled();
  } catch {
    return false;
  }
}

export async function startRideActivity(ride: LiveActivityRide): Promise<void> {
  if (!liveActivitiesEnabled() || !LiveActivity) return;
  try {
    await LiveActivity.start(ride.id, buildTitle(ride), buildState(ride));
  } catch {
    // Native start failed (permission race / unlinked) — degrade silently.
  }
}

export async function updateRideActivity(ride: LiveActivityRide): Promise<void> {
  if (Platform.OS !== 'ios' || !LiveActivity) return;
  try {
    await LiveActivity.update(buildState(ride));
  } catch {}
}

export async function endRideActivity(): Promise<void> {
  if (Platform.OS !== 'ios' || !LiveActivity) return;
  try {
    await LiveActivity.end();
  } catch {}
}

// What the lifecycle should do this tick. Pure and platform-agnostic so it can
// be exhaustively unit-tested without a renderer or the native module.
export type LiveActivityAction =
  | { kind: 'none' }
  | { kind: 'start'; ride: LiveActivityRide }
  | { kind: 'update'; ride: LiveActivityRide }
  | { kind: 'end' };

// The bit of state the decision carries between ticks: which ride is currently
// shown (null = none) and the serialized content last pushed to it.
export interface LiveActivityTracker {
  shownRideId: string | null;
  lastContent: string;
}

export const EMPTY_TRACKER: LiveActivityTracker = { shownRideId: null, lastContent: '' };

/**
 * Pure lifecycle reducer: given the current tracker and the latest polled ride,
 * decide the action and the next tracker. No side effects.
 *
 * Rules (mirrors what a captain expects "under all conditions"):
 *   - ride null / terminal (completed/cancelled/no_show) while one is shown → end.
 *   - a different (or first) active ride → start. The native `start` ends any
 *     existing activity itself, so a ride swap needs a single 'start', not end+start.
 *   - same active ride, changed rendered content (phase/fare/labels) → update.
 *   - otherwise → none (this is the common no-op between polls).
 */
export function decideLiveActivityAction(
  tracker: LiveActivityTracker,
  ride: LiveActivityRide | null,
): { action: LiveActivityAction; next: LiveActivityTracker } {
  const isActive = !!ride && ACTIVE_STATUSES.has(ride.status);

  if (!isActive) {
    if (tracker.shownRideId) {
      return { action: { kind: 'end' }, next: { ...EMPTY_TRACKER } };
    }
    return { action: { kind: 'none' }, next: tracker };
  }

  const content = JSON.stringify(buildState(ride!));

  if (tracker.shownRideId !== ride!.id) {
    return {
      action: { kind: 'start', ride: ride! },
      next: { shownRideId: ride!.id, lastContent: content },
    };
  }

  if (content !== tracker.lastContent) {
    return {
      action: { kind: 'update', ride: ride! },
      next: { shownRideId: ride!.id, lastContent: content },
    };
  }

  return { action: { kind: 'none' }, next: tracker };
}

/**
 * Drives the Live Activity lifecycle off the polled active ride via the pure
 * reducer above:
 *   - start when a ride enters an active state,
 *   - update when its rendered content changes (phase / fare / labels),
 *   - end when it reaches a terminal state or disappears (completed/cancelled).
 *
 * Mount once on the captain rides screen with the polled `current` ride.
 * No-ops entirely off iOS.
 */
export function useRideLiveActivity(ride: LiveActivityRide | null): void {
  const tracker = useRef<LiveActivityTracker>({ ...EMPTY_TRACKER });

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const { action, next } = decideLiveActivityAction(tracker.current, ride);
    tracker.current = next;

    switch (action.kind) {
      case 'start': void startRideActivity(action.ride); break;
      case 'update': void updateRideActivity(action.ride); break;
      case 'end': void endRideActivity(); break;
      case 'none': break;
    }
  }, [ride]);

  // Safety net: end the activity if the screen unmounts mid-ride (logout, mode
  // switch) so it doesn't linger on the lock screen with no app driving it.
  useEffect(() => {
    return () => {
      if (tracker.current.shownRideId) void endRideActivity();
    };
  }, []);
}
