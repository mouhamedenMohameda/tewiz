/**
 * Globally listen for taps on push notifications and route accordingly.
 *
 * Ride alerts (`ride_alert`) route to the captain rides screen so that tapping
 * the push — even when the app was backgrounded or killed — opens the ride
 * directly. Once there, <CaptainRideWatcher /> shows the full-screen modal +
 * plays the alarm (it polls the inbox). Every OTHER push type we send (info,
 * bonus_config, bonus_earned, system) is meant for the inbox — tapping it
 * should open /notifications.
 *
 * Also handles the "cold start tap" case (`getLastNotificationResponseAsync`)
 * so when a captain swipes a notification while the app is killed, opening
 * via that notification still routes them to the right screen.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRootNavigationState, useRouter } from 'expo-router';
import { getInitialFullScreenRide } from '@/lib/fullScreenRideAlert';

const RIDE_ALERT_TYPES = new Set(['ride_alert', 'voice_ride_confirmed']);

function isInboxNotification(rawType: unknown): boolean {
  if (typeof rawType !== 'string') return false;
  if (RIDE_ALERT_TYPES.has(rawType)) return false;
  // Server tags general notifications as `notification:<type>`.
  return rawType.startsWith('notification:');
}

export function NotificationTapHandler() {
  const router = useRouter();
  const rootNavState = useRootNavigationState();
  const navigationReady = !!rootNavState?.key;

  useEffect(() => {
    if (!navigationReady || Platform.OS === 'web') return;

    const routeForType = (type: unknown) => {
      if (type === 'ride_alert') {
        // Land on the captain rides screen; CaptainRideWatcher takes over the
        // modal + alarm once its inbox poll catches the ride.
        requestAnimationFrame(() => {
          router.push('/(app)/captain/rides');
        });
      } else if (isInboxNotification(type)) {
        requestAnimationFrame(() => {
          router.push('/(app)/notifications');
        });
      }
    };

    (async () => {
      // Cold start via the Android full-screen "incoming ride" notification
      // (Notifee) — expo-notifications doesn't know about it, so ask Notifee.
      const fsRide = await getInitialFullScreenRide();
      if (fsRide) {
        routeForType('ride_alert');
        return;
      }
      const last = await Notifications.getLastNotificationResponseAsync();
      routeForType(last?.notification.request.content.data?.type);
    })();

    // Warm taps while the app is backgrounded or foregrounded.
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      routeForType(resp.notification.request.content.data?.type);
    });
    return () => sub.remove();
  }, [navigationReady, router]);

  return null;
}
