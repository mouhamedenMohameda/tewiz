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
 * Like getPushTokensForUsers but keeps each token's platform, so callers can
 * treat Android and iOS differently (e.g. Android gets an extra data-only push
 * that drives the full-screen "incoming ride" screen).
 */
export async function getPushTokensWithPlatform(
  userIds: string[],
): Promise<{ token: string; platform: string }[]> {
  if (userIds.length === 0) return [];
  const { rows } = await pool.query<{ token: string; platform: string }>(
    `SELECT token, platform FROM push_tokens WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  return rows;
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

interface PushTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Removes push tokens Expo reports as permanently dead (app uninstalled /
 * token rotated) so we stop wasting sends on them.
 */
async function pruneDeadTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await pool.query(`DELETE FROM push_tokens WHERE token = ANY($1::text[])`, [tokens]);
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
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const groups = isRetry ? null : parseExperienceGroups(text);
      if (groups) {
        for (const tokens of groups) {
          await sendPush({ ...message, to: tokens }, true);
        }
        return;
      }
      // eslint-disable-next-line no-console
      console.warn('[push] expo push API responded', res.status, text);
      return;
    }

    // A 200 only means Expo accepted the request — each token gets its own
    // ticket, and an individual ticket can still fail (bad credentials,
    // stale token, etc). Surface those instead of failing silently.
    const parsed = JSON.parse(text) as { data?: PushTicket[] };
    const tickets = parsed.data ?? [];
    const tokens = Array.isArray(message.to) ? message.to : [message.to];
    const deadTokens: string[] = [];
    tickets.forEach((ticket, i) => {
      if (ticket.status !== 'error') return;
      // eslint-disable-next-line no-console
      console.warn('[push] ticket error', ticket.details?.error ?? ticket.message, tokens[i]);
      if (ticket.details?.error === 'DeviceNotRegistered') deadTokens.push(tokens[i]!);
    });
    await pruneDeadTokens(deadTokens);
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
  const tokenRows = await getPushTokensWithPlatform(captainUserIds);
  if (tokenRows.length === 0) return;
  const tokens = tokenRows.map((r) => r.token);
  const settings = await getPricingSettings();

  // The custom `ride-alert` sound must be bundled with the standalone build
  // (Android: notification channel; iOS: a sound file in the app bundle).
  // In Expo Go, the default system sound plays — that's acceptable for dev.
  const title = ride.rideType === 'colis' ? '📦 Nouveau colis'
    : ride.rideType === 'private_driver' ? '🕐 Captain Privé'
    : ride.rideType === 'convoyage' ? '🚗 Convoyage'
    : ride.rideType === 'car_rental' ? '🚗 Location Auto'
    : ride.rideType === 'roadside_assistance' ? '🛠️ Assistance Routière'
    : ride.rideType === 'light_moving' ? '📦 Déménagement Léger'
    : ride.rideType === 'intercity_freight' ? '🚛 Fret Intercité'
    : ride.rideType === 'equipment_rental' ? '🔧 Location Équipement'
    : '🚖 Nouvelle course';
  const body = ride.fareEstimateMru
    ? `Tarif estimé : ${ride.fareEstimateMru} MRU — accepter avant qu'un autre Captain ne prenne.`
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

  // Android-only, in ADDITION to the visible push above: a *data-only* push
  // (no title/body → not drawn by the OS) so the app's headless background task
  // can pop a full-screen "incoming ride" screen over the lock screen even when
  // the app is killed. Older builds have no such task and simply ignore it, so
  // this can never regress the reliable notification they already got.
  const androidTokens = tokenRows.filter((r) => r.platform === 'android').map((r) => r.token);
  for (let i = 0; i < androidTokens.length; i += 100) {
    const batch = androidTokens.slice(i, i + 100);
    await sendPush({
      to: batch,
      data: { type: 'ride_alert', rideId: ride.id, title, body },
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
      body: 'Votre course est confirmée — un Captain arrive bientôt.',
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
