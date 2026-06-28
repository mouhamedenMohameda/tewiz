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
import { useRouter } from 'expo-router';

const RIDE_ALERT_TYPES = new Set(['ride_alert', 'voice_ride_confirmed']);

function isInboxNotification(rawType: unknown): boolean {
  if (typeof rawType !== 'string') return false;
  if (RIDE_ALERT_TYPES.has(rawType)) return false;
  // Server tags general notifications as `notification:<type>`.
  return rawType.startsWith('notification:');
}

export function NotificationTapHandler() {
  const router = useRouter();

  useEffect(() => {
    // Cold start: user tapped a push while the app was killed.
    (async () => {
      const last = await Notifications.getLastNotificationResponseAsync();
      const type = last?.notification.request.content.data?.type;
      if (isInboxNotification(type)) {
        router.push('/(app)/notifications');
      }
    })();

    // Warm taps while the app is backgrounded or foregrounded.
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const type = resp.notification.request.content.data?.type;
      if (isInboxNotification(type)) {
        router.push('/(app)/notifications');
      }
    });
    return () => sub.remove();
  }, [router]);

  return null;
}
