/**
 * Globally listen for taps on push notifications and route accordingly.
 *
 * Ride alerts are owned by <CaptainRideWatcher /> (it shows a modal + plays
 * the alarm). Every OTHER push type we send (info, bonus_config, bonus_earned,
 * system) is meant for the inbox — tapping it should open /notifications.
 *
 * Also handles the "cold start tap" case (`getLastNotificationResponseAsync`)
 * so when a captain swipes a notification while the app is killed, opening
 * via that notification still routes them into the inbox.
 */

import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useRootNavigationState, useRouter } from 'expo-router';

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
    if (!navigationReady) return;

    const openInbox = () => {
      // Pushing on the next frame avoids dispatching navigation updates while
      // the root container is still finalizing its initial render.
      requestAnimationFrame(() => {
        router.push('/(app)/notifications');
      });
    };

    // Cold start: user tapped a push while the app was killed.
    (async () => {
      const last = await Notifications.getLastNotificationResponseAsync();
      const type = last?.notification.request.content.data?.type;
      if (isInboxNotification(type)) {
        openInbox();
      }
    })();

    // Warm taps while the app is backgrounded or foregrounded.
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const type = resp.notification.request.content.data?.type;
      if (isInboxNotification(type)) {
        openInbox();
      }
    });
    return () => sub.remove();
  }, [navigationReady, router]);

  return null;
}
