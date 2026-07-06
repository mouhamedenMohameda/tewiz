import { pool } from '../../db/pool.js';
import { getPricingSettings } from '../admin/app-settings.service.js';

/**
 * Minimal Expo Push HTTP API client.
 * Docs: https://docs.expo.dev/push-notifications/sending-notifications/
 *
 * We use fire-and-forget: failures are logged but never bubble up to the
 * caller, because notifications are an enhancement — a missed push must
 * never break ride creation. The captain still sees the ride via inbox
 * polling.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  to: string | string[];
  sound?: string | { name: string; critical?: boolean; volume?: number };
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  ttl?: number;
}

/**
 * Fetches every push token registered for the given user ids.
 * Returns one token per device (a captain might have phone + tablet).
 */
export async function getPushTokensForUsers(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { rows } = await pool.query<{ token: string }>(
    `SELECT token FROM push_tokens WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  return rows.map((r) => r.token);
}

/**
 * Extracts token groups from a PUSH_TOO_MANY_EXPERIENCE_IDS error body.
 * Expo rejects a request mixing tokens from different projects (happens when
 * the DB holds tokens registered by builds of another Expo account) and its
 * error `details` maps each project to its tokens — we use that to resend
 * per group. Returns null when the body is any other error.
 */
function parseExperienceGroups(body: string): string[][] | null {
  try {
    const parsed = JSON.parse(body) as {
      errors?: { code?: string; details?: Record<string, unknown> }[];
    };
    const details = parsed.errors?.find((e) => e.code === 'PUSH_TOO_MANY_EXPERIENCE_IDS')?.details;
    if (!details) return null;
    const groups = Object.values(details).filter(
      (v): v is string[] => Array.isArray(v) && v.every((t) => typeof t === 'string'),
    );
    return groups.length > 1 ? groups : null;
  } catch {
    return null;
  }
}

/**
 * Sends one push message (which may target many tokens via `to`).
 * Fire-and-forget. Errors are logged, never thrown.
 */
export async function sendPush(message: PushMessage, isRetry = false): Promise<void> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'accept-encoding': 'gzip, deflate',
        'content-type': 'application/json',
      },
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const groups = isRetry ? null : parseExperienceGroups(text);
      if (groups) {
        for (const tokens of groups) {
          await sendPush({ ...message, to: tokens }, true);
        }
        return;
      }
      // eslint-disable-next-line no-console
      console.warn('[push] expo push API responded', res.status, text);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[push] failed to send', err);
  }
}

/**
 * Notify every captain whose token we have, with a ride-alert payload.
 * Caller is responsible for filtering down to *eligible* captains
 * (online, within radius, accepts colis if applicable, etc.).
 */
export async function notifyCaptainsNewRide(
  captainUserIds: string[],
  ride: { id: string; rideType: string; fareEstimateMru: number | null },
): Promise<void> {
  const tokens = await getPushTokensForUsers(captainUserIds);
  if (tokens.length === 0) return;
  const settings = await getPricingSettings();

  // The custom `ride-alert` sound must be bundled with the standalone build
  // (Android: notification channel; iOS: a sound file in the app bundle).
  // In Expo Go, the default system sound plays — that's acceptable for dev.
  const title = ride.rideType === 'colis' ? '📦 Nouveau colis'
    : ride.rideType === 'private_driver' ? '🕐 Chauffeur Privé'
    : ride.rideType === 'convoyage' ? '🚗 Convoyage'
    : ride.rideType === 'car_rental' ? '🚗 Location Auto'
    : ride.rideType === 'roadside_assistance' ? '🛠️ Assistance Routière'
    : ride.rideType === 'light_moving' ? '📦 Déménagement Léger'
    : ride.rideType === 'intercity_freight' ? '🚛 Fret Intercité'
    : ride.rideType === 'equipment_rental' ? '🔧 Location Équipement'
    : '🚖 Nouvelle course';
  const body = ride.fareEstimateMru
    ? `Tarif estimé : ${ride.fareEstimateMru} MRU — accepter avant qu'un autre chauffeur ne prenne.`
    : 'Une nouvelle course est disponible près de vous.';

  // Expo accepts up to 100 tokens per request; chunk to stay safe.
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100);
    await sendPush({
      to: batch,
      sound: settings.captainAlertSoundMode === 'critical'
        ? { name: 'default', critical: true, volume: 1 }
        : 'default',
      title,
      body,
      data: { type: 'ride_alert', rideId: ride.id },
      channelId: 'ride-alerts',
      priority: 'high',
      ttl: 60,
    });
  }
}

const ROADSIDE_PROBLEM_LABEL: Record<string, string> = {
  pneu: 'Pneu crevé',
  batterie: 'Batterie',
  essence: 'Panne d\'essence',
  moteur: 'Panne moteur',
  remorquage: 'Remorquage',
  accident: 'Accident',
  autre: 'Panne',
};

/**
 * Urgent SOS push to opted-in roadside providers near a stranded driver.
 * Mirrors notifyCaptainsNewRide but with its own copy + payload type so the
 * app can route the tap to the roadside inbox.
 */
export async function notifyProvidersRoadside(
  providerUserIds: string[],
  req: { id: string; problemType: string; distanceM?: number | null },
): Promise<void> {
  const tokens = await getPushTokensForUsers(providerUserIds);
  if (tokens.length === 0) return;
  const settings = await getPricingSettings();

  const label = ROADSIDE_PROBLEM_LABEL[req.problemType] ?? 'Panne';
  const dist = req.distanceM != null ? ` à ${(req.distanceM / 1000).toFixed(1)} km` : '';
  const title = `🆘 ${label}${dist}`;
  const body = 'Un conducteur en panne demande de l\'aide près de vous — accepter avant les autres.';

  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100);
    await sendPush({
      to: batch,
      sound: settings.captainAlertSoundMode === 'critical'
        ? { name: 'default', critical: true, volume: 1 }
        : 'default',
      title,
      body,
      data: { type: 'roadside_alert', requestId: req.id },
      channelId: 'ride-alerts',
      priority: 'high',
      ttl: 120,
    });
  }
}

/**
 * Notify a rider that the admin has turned their voice memo into a real ride.
 * Fire-and-forget. The waiting screen also learns this via polling; the push
 * is what wakes the app when it's backgrounded.
 */
export async function notifyVoiceRideConfirmed(
  userId: string,
  payload: { voiceRequestId: string; rideId: string },
): Promise<void> {
  const tokens = await getPushTokensForUsers([userId]);
  if (tokens.length === 0) return;
  for (let i = 0; i < tokens.length; i += 100) {
    await sendPush({
      to: tokens.slice(i, i + 100),
      sound: 'default',
      title: '✅ Course confirmée',
      body: 'Votre course est confirmée — un chauffeur arrive bientôt.',
      data: {
        type: 'voice_ride_confirmed',
        voiceRequestId: payload.voiceRequestId,
        rideId: payload.rideId,
      },
      channelId: 'ride-alerts',
      priority: 'high',
      ttl: 300,
    });
  }
}
