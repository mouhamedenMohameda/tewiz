import { pool } from '../../db/pool.js';
import { getPricingSettings } from '../admin/app-settings.service.js';
import { pushTickets } from '../../lib/metrics.js';

/**
 * Expo's documented per-ticket error codes. Anything outside this set is
 * counted as 'other': `ticket.message` is free text, and free text as a
 * Prometheus label is how a metrics endpoint grows without bound.
 *
 * The one that matters most here is InvalidCredentials — it means Expo cannot
 * reach the push service for that platform (a missing FCM key for Android, for
 * instance), so EVERY notification fails while ride creation looks perfectly
 * healthy.
 */
const PUSH_TICKET_STATUSES = new Set([
  'DeviceNotRegistered',
  'InvalidCredentials',
  'MessageTooBig',
  'MessageRateExceeded',
  'MismatchSenderId',
  'ExpoError',
  'ProviderError',
]);

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
  // iOS 15+ interruption level. 'time-sensitive' lets the notification break
  // through Focus / Do-Not-Disturb and light the lock screen WITHOUT needing
  // the Apple-approved Critical Alerts entitlement. Requires the app to declare
  // the Time Sensitive Notifications capability (see app.config.ts iOS
  // entitlements). Ignored by Android, which uses channel importance instead.
  interruptionLevel?: 'passive' | 'active' | 'time-sensitive' | 'critical';
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
 * How long a captain ride alert stays worth delivering. See the note at its
 * use site: bounded above by searching_timeout_s, below by 2G latency.
 */
const CAPTAIN_ALERT_TTL_S = 180;

/**
 * How many times a single push is attempted before we give up.
 *
 * Bounded, and deliberately small. Unbounded retries against a dead Expo would
 * pile up across every ride broadcast in the outage and eventually starve the
 * event loop — trading a lost notification for a lost API.
 */
const PUSH_MAX_ATTEMPTS = 3;
const PUSH_RETRY_BASE_MS = 200;

/**
 * Is this failure worth trying again?
 *
 * `null` means the request never got an answer (DNS, timeout, reset) — the most
 * common transient case on this platform's network. 429 and 5xx are Expo
 * telling us to come back later.
 *
 * Everything else is a 4xx: the payload is wrong, and retrying it only sends
 * the same broken request again.
 */
function isRetryableFailure(status: number | null): boolean {
  if (status === null) return true;
  if (status === 429) return true;
  return status >= 500;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends one push message (which may target many tokens via `to`).
 *
 * Fire-and-forget: errors are logged, never thrown. The caller is always a
 * `void`-ed promise on a ride path, so a rejection here would surface as an
 * unhandled rejection rather than as a useful error.
 *
 * Transient failures are retried with exponential backoff. Without this, a
 * thirty-second Expo blip silently lost EVERY ride broadcast in that window —
 * and the only recovery was the 5 s inbox poll, which reaches exactly the
 * captains who needed the push least (the ones already looking at the app).
 */
export async function sendPush(message: PushMessage, isRetry = false): Promise<void> {
  for (let attempt = 1; attempt <= PUSH_MAX_ATTEMPTS; attempt++) {
    const outcome = await attemptPush(message, isRetry);
    if (outcome.done) return;

    if (attempt < PUSH_MAX_ATTEMPTS && isRetryableFailure(outcome.status)) {
      // 200 ms, then 400 ms. Long enough to outlast a blip, short enough that a
      // ride alert is still worth delivering when it finally lands.
      await sleep(PUSH_RETRY_BASE_MS * 2 ** (attempt - 1));
      continue;
    }
    // eslint-disable-next-line no-console
    console.warn('[push] giving up after', attempt, 'attempt(s)', outcome.status ?? 'network error');
    return;
  }
}

/**
 * One attempt. Returns `done: true` when there is nothing left to do — either
 * the send succeeded, or it failed in a way retrying cannot fix.
 */
async function attemptPush(
  message: PushMessage,
  isRetry: boolean,
): Promise<{ done: boolean; status: number | null }> {
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
        return { done: true, status: res.status };
      }
      // eslint-disable-next-line no-console
      console.warn('[push] expo push API responded', res.status, text);
      // Let the caller decide: a 502 is worth another go, a 400 is not.
      return { done: !isRetryableFailure(res.status), status: res.status };
    }

    // A 200 only means Expo accepted the request — each token gets its own
    // ticket, and an individual ticket can still fail (bad credentials,
    // stale token, etc). Surface those instead of failing silently.
    const parsed = JSON.parse(text) as { data?: PushTicket[] };
    const tickets = parsed.data ?? [];
    const tokens = Array.isArray(message.to) ? message.to : [message.to];
    const deadTokens: string[] = [];
    tickets.forEach((ticket, i) => {
      if (ticket.status !== 'error') {
        pushTickets.inc({ status: 'ok' });
        return;
      }
      const code = ticket.details?.error;
      pushTickets.inc({ status: code && PUSH_TICKET_STATUSES.has(code) ? code : 'other' });
      // eslint-disable-next-line no-console
      console.warn('[push] ticket error', code ?? ticket.message, tokens[i]);
      if (code === 'DeviceNotRegistered') deadTokens.push(tokens[i]!);
    });
    await pruneDeadTokens(deadTokens);
    return { done: true, status: res.status };
  } catch (err) {
    // No answer at all — DNS, timeout, connection reset. The most common
    // transient failure on this platform's network, and the one most worth
    // retrying. `status: null` marks it as such.
    // eslint-disable-next-line no-console
    console.warn('[push] failed to send', err);
    return { done: false, status: null };
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
      // iOS: break through Focus/DND and light the lock screen for an incoming
      // ride. This is the iOS counterpart to Android's full-screen intent —
      // Apple forbids third-party full-screen takeovers, so Time-Sensitive is
      // the strongest conformant signal. No-op on Android.
      interruptionLevel: 'time-sensitive',
      // Was 60 s, which is shorter than an ordinary delivery on a Mauritanian
      // 2G link: the push service simply DISCARDED the alert before it arrived
      // and the captain never learned the ride existed. 180 s outlives a slow
      // delivery while still expiring well inside searching_timeout_s (300 s
      // by default), so an alert can never outlive the ride it describes.
      ttl: CAPTAIN_ALERT_TTL_S,
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
      ttl: CAPTAIN_ALERT_TTL_S,
    });
  }
}

/**
 * How long a ride-status update stays worth delivering.
 *
 * Longer than the captain alert (which races other captains and is worthless
 * once someone else takes the ride): "votre captain arrive" is still useful two
 * minutes late, and on a 2G link two minutes is an ordinary delivery time.
 * Bounded below searching_timeout_s so a notification can never outlive the
 * ride it describes.
 */
const RIDE_UPDATE_TTL_S = 300;

/**
 * Push a ride-status change to the RIDER (the booker).
 *
 * Every rider-facing notification funnels through here so the channel, the TTL
 * and the interruption level stay consistent — and so there is exactly one
 * place to look when a rider says they were not told something.
 *
 * Fire-and-forget, like every other push in this module: a ride transition must
 * never fail because Expo is unreachable.
 */
async function notifyRider(
  bookerId: string,
  message: {
    title: string;
    body: string;
    data: Record<string, unknown>;
    /** Break through Focus/DND. Reserved for "act now" moments. */
    urgent?: boolean;
  },
): Promise<void> {
  const tokens = await getPushTokensForUsers([bookerId]);
  if (tokens.length === 0) return;

  for (let i = 0; i < tokens.length; i += 100) {
    await sendPush({
      to: tokens.slice(i, i + 100),
      sound: 'default',
      title: message.title,
      body: message.body,
      data: message.data,
      // Its own channel, so a rider can silence ride updates without silencing
      // anything else — and so captains' "ride-alerts" keeps its own volume.
      channelId: 'ride-updates',
      priority: 'high',
      ...(message.urgent ? { interruptionLevel: 'time-sensitive' as const } : {}),
      ttl: RIDE_UPDATE_TTL_S,
    });
  }
}

/**
 * A captain accepted: tell the rider who is coming, and in what.
 *
 * Naming the captain matters more than it looks. "Votre course a été acceptée"
 * makes the rider open the app to find out anything useful, which defeats the
 * purpose of the notification; "Sidi arrive — Toyota Corolla blanche
 * (AA-1234-BB)" is already the whole answer, readable from the lock screen.
 */
export async function notifyRiderRideAccepted(
  bookerId: string,
  ride: { id: string; captainName: string | null; vehicle: string | null },
): Promise<void> {
  const who = ride.captainName?.trim() || 'Votre Captain';
  await notifyRider(bookerId, {
    title: '🚖 Captain trouvé',
    body: ride.vehicle
      ? `${who} arrive — ${ride.vehicle}.`
      : `${who} est en route vers vous.`,
    data: { type: 'ride_accepted', rideId: ride.id },
  });
}

/**
 * The captain is at the pickup point.
 *
 * Marked urgent: this is the one moment in the flow where the rider is provably
 * NOT looking at their phone — they have been waiting several minutes with it in
 * a pocket. Without breaking through Focus/DND the notification is useless
 * exactly when it is needed.
 */
export async function notifyRiderCaptainArrived(
  bookerId: string,
  ride: { id: string; captainName: string | null },
): Promise<void> {
  const who = ride.captainName?.trim() || 'Votre Captain';
  await notifyRider(bookerId, {
    title: '📍 Votre Captain est arrivé',
    body: `${who} vous attend au point de ramassage.`,
    data: { type: 'captain_arrived', rideId: ride.id },
    urgent: true,
  });
}

/**
 * The assigned captain dropped the ride and it went back to 'searching'.
 *
 * The wording is deliberate: the trip is NOT cancelled, it is being re-offered.
 * Telling the rider "course annulée" would make them rebook and double the load
 * on a dispatch that is already looking for someone.
 */
export async function notifyRiderCaptainCancelled(
  bookerId: string,
  ride: { id: string },
): Promise<void> {
  await notifyRider(bookerId, {
    title: '🔄 Recherche d\'un autre Captain',
    body: 'Votre Captain n\'a pas pu venir. Nous cherchons un autre Captain pour vous.',
    data: { type: 'ride_captain_cancelled', rideId: ride.id },
  });
}

/**
 * Nobody accepted before the search timeout.
 *
 * The most demoralising message the platform sends, so it carries the ride id:
 * the app can offer a one-tap retry, which is the cheapest possible moment to
 * win back a user who has just been let down.
 */
export async function notifyRiderRideExpired(
  bookerId: string,
  ride: { id: string },
): Promise<void> {
  await notifyRider(bookerId, {
    title: '😕 Aucun Captain disponible',
    body: 'Aucun Captain n\'a pu prendre votre course. Réessayez, il y a souvent plus de Captains quelques minutes plus tard.',
    data: { type: 'ride_expired', rideId: ride.id },
  });
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
