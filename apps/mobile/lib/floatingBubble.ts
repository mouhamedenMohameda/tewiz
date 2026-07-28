/**
 * Android floating bubble ("chat head") for the *active ride*.
 *
 * The Android complement to the iOS Live Activity (lib/liveActivity.ts): while a
 * ride is active and the captain leaves the app, a draggable bubble stays on top
 * of whatever they're doing; tapping it brings Tewiz back to the foreground.
 *
 * Behaviour (Uber-style): the bubble only appears when the app is NOT in the
 * foreground — no point covering our own UI. It shows on background, hides on
 * return, and hides as soon as the ride ends.
 *
 * Everything is defensive and Android-only:
 *   - iOS / web: no-op (the native module isn't linked there; iOS uses the Live
 *     Activity instead — Apple forbids drawing over other apps).
 *   - Overlay permission not granted / old build: the native side no-ops, so JS
 *     callers never throw. The one-time grant prompt lives in
 *     lib/overlayPermission.ts (already wired when a captain goes online).
 *
 * The active-ride lifecycle reuses the pure, unit-tested reducer from
 * lib/liveActivity.ts so both surfaces agree on what "active" means.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { i18n } from './i18n';
import { ACTIVE_STATUSES, buildTitle, buildState, type LiveActivityRide } from './liveActivity';

// Resolves to the Kotlin module registered as Name("FloatingBubble"), or null
// when it isn't linked (iOS, web, or a build made before this module existed).
const FloatingBubble = requireOptionalNativeModule<{
  canDrawOverlays: () => boolean;
  show: (title: string, subtitle: string) => void;
  hide: () => void;
}>('FloatingBubble');

/** Android + linked + user granted "display over other apps". */
export function bubbleAvailable(): boolean {
  if (Platform.OS !== 'android' || !FloatingBubble) return false;
  try {
    return FloatingBubble.canDrawOverlays();
  } catch {
    return false;
  }
}

function showRideBubble(ride: LiveActivityRide): void {
  if (!bubbleAvailable() || !FloatingBubble) return;
  const s = buildState(ride);
  const hint = i18n.t('captain.rides.bubbleHint') as string;
  const subtitle = `${s.statusLabel} · ${hint}`;
  try {
    FloatingBubble.show(buildTitle(ride), subtitle);
  } catch {
    // unlinked / permission race — degrade silently
  }
}

function hideBubble(): void {
  if (Platform.OS !== 'android' || !FloatingBubble) return;
  try {
    FloatingBubble.hide();
  } catch {}
}

/**
 * Drives the bubble off the polled active ride and the app's foreground state.
 * Mount once on the captain rides screen with the polled `current` ride,
 * alongside useRideLiveActivity. No-ops entirely off Android.
 */
export function useRideFloatingBubble(ride: LiveActivityRide | null): void {
  const rideRef = useRef<LiveActivityRide | null>(ride);
  rideRef.current = ride;
  const shownRef = useRef(false);

  const sync = useCallback((appIsActive: boolean) => {
    if (Platform.OS !== 'android') return;
    const r = rideRef.current;
    const rideActive = !!r && ACTIVE_STATUSES.has(r.status);

    if (rideActive && !appIsActive) {
      showRideBubble(r!);
      shownRef.current = true;
    } else if (shownRef.current) {
      hideBubble();
      shownRef.current = false;
    }
  }, []);

  // Re-evaluate whenever the ride changes (e.g. reaches a terminal state).
  useEffect(() => {
    sync(AppState.currentState === 'active');
  }, [ride, sync]);

  // Show on background / hide on return, and clean up on unmount.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => sync(next === 'active');
    const subscription = AppState.addEventListener('change', onChange);
    return () => {
      subscription.remove();
      if (shownRef.current) {
        hideBubble();
        shownRef.current = false;
      }
    };
  }, [sync]);
}
