/**
 * Background job: auto-cancel rides that stayed in 'searching' for longer
 * than `app_settings.searching_timeout_s`.
 *
 * Why this exists:
 *   When no captain accepts a ride, today it would stay 'searching' forever.
 *   The booker has no signal that no one is coming, and the admin dashboard
 *   fills up with phantom rides. This job runs every 30 s in-process (no
 *   external cron needed, same pattern as heatmap.service.ts), flips stale
 *   rides to 'cancelled_by_system' with reason 'no_captain_accepted', and
 *   tells each affected rider that nobody came.
 *
 * Behaviour:
 *   - Takes a cluster lock first, so only ONE API instance does the work per
 *     tick (see lib/cluster-lock.ts). Losing the lock is a silent no-op.
 *   - Reads the timeout from app_settings (cached). 0 → job becomes a no-op.
 *   - Uses a single SQL UPDATE so a slow tick can't race with itself, and
 *     RETURNs the affected rides so their bookers can be notified.
 *   - Only affects rides whose status is still 'searching'. Rides that moved
 *     to 'pending_passenger_confirm', 'accepted', etc. are untouched.
 *   - No captain reassignment side-effects (no captain was assigned by
 *     definition — the ride was still searching).
 */

import { pool } from '../../db/pool.js';
import { getPricingSettings } from '../admin/app-settings.service.js';
import { ridesExpiredNoCaptain } from '../../lib/metrics.js';
import { notifyRiderRideExpired } from '../push/expo-push.js';
import { withClusterLock } from '../../lib/cluster-lock.js';

const TICK_INTERVAL_MS = 30_000;

/** A ride this tick gave up on, and who was waiting for it. */
export interface ExpiredRide {
  id: string;
  bookerId: string;
}

/**
 * Shorter than TICK_INTERVAL_MS so a process killed mid-tick cannot block the
 * job until someone notices, but long enough to cover a slow UPDATE plus the
 * per-rider notifications that follow it.
 */
const LOCK_TTL_MS = 25_000;

/**
 * Cancel every ride that outlived the search timeout, and return them.
 *
 * The RETURNING clause is not incidental: without it the job knows only HOW
 * MANY rides it killed, never WHOSE — and a job that cannot name the people it
 * just disappointed cannot tell them. That was the actual blocker on notifying
 * riders, not the notification itself.
 */
export async function expireSearchingRides(): Promise<ExpiredRide[]> {
  // Only one instance per tick. Losing the race is a no-op, not a failure —
  // another process is already doing exactly this work.
  const outcome = await withClusterLock('ride-expiry', LOCK_TTL_MS, expireSearchingRidesLocked);
  return outcome.ran ? outcome.result : [];
}

async function expireSearchingRidesLocked(): Promise<ExpiredRide[]> {
  const { searchingTimeoutS } = await getPricingSettings();
  if (searchingTimeoutS <= 0) return [];

  const { rows } = await pool.query<{ id: string; booker_id: string }>(
    `UPDATE rides
        SET status        = 'cancelled_by_system',
            cancelled_at  = now(),
            cancel_reason = 'no_captain_accepted'
      WHERE status = 'searching'
        AND requested_at < now() - make_interval(secs => $1)
    RETURNING id, booker_id`,
    [searchingTimeoutS],
  );
  const expired: ExpiredRide[] = rows.map((r) => ({ id: r.id, bookerId: r.booker_id }));

  // The clearest failure signal the marketplace has: a rider asked, nobody came.
  // Counted here rather than derived from the cancel_reason so it is visible as a
  // rate the moment it happens, without waiting for the 30s gauge refresh.
  if (expired.length > 0) {
    ridesExpiredNoCaptain.inc(expired.length);
    // Awaited, not fired and forgotten: this is a background job with nobody
    // waiting on it, so there is no latency to protect — and swallowing the
    // await would make a broken push invisible. Individually guarded so one
    // rider's dead token cannot stop the rest being told.
    await Promise.all(expired.map(async (ride) => {
      try {
        await notifyRiderRideExpired(ride.bookerId, { id: ride.id });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[ride-expiry] could not notify rider', { rideId: ride.id, err });
      }
    }));
  }
  return expired;
}

export function startRideExpiryCron() {
  const tick = async () => {
    try {
      const expired = await expireSearchingRides();
      if (expired.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[ride-expiry] cancelled ${expired.length} stale searching ride(s)`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[ride-expiry] tick failed', err);
    }
  };
  // First run after a short delay so the server's "listening" log isn't
  // interleaved with our first cancellation.
  setTimeout(tick, 10_000);
  setInterval(tick, TICK_INTERVAL_MS).unref();
}
