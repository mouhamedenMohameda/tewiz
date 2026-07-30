/**
 * Background job: auto-cancel rides that stayed in 'searching' for longer
 * than `app_settings.searching_timeout_s`.
 *
 * Why this exists:
 *   When no captain accepts a ride, today it would stay 'searching' forever.
 *   The booker has no signal that no one is coming, and the admin dashboard
 *   fills up with phantom rides. This job runs every 30 s in-process (no
 *   external cron needed, same pattern as heatmap.service.ts) and flips
 *   stale rides to 'cancelled_by_system' with reason 'no_captain_accepted'.
 *
 * Behaviour:
 *   - Reads the timeout from app_settings (cached). 0 → job becomes a no-op.
 *   - Uses a single SQL UPDATE so a slow tick can't race with itself.
 *   - Only affects rides whose status is still 'searching'. Rides that moved
 *     to 'pending_passenger_confirm', 'accepted', etc. are untouched.
 *   - No captain reassignment side-effects (no captain was assigned by
 *     definition — the ride was still searching).
 */

import { pool } from '../../db/pool.js';
import { getPricingSettings } from '../admin/app-settings.service.js';
import { ridesExpiredNoCaptain } from '../../lib/metrics.js';

const TICK_INTERVAL_MS = 30_000;

export async function expireSearchingRides(): Promise<number> {
  const { searchingTimeoutS } = await getPricingSettings();
  if (searchingTimeoutS <= 0) return 0;

  const { rowCount } = await pool.query(
    `UPDATE rides
        SET status        = 'cancelled_by_system',
            cancelled_at  = now(),
            cancel_reason = 'no_captain_accepted'
      WHERE status = 'searching'
        AND requested_at < now() - make_interval(secs => $1)`,
    [searchingTimeoutS],
  );
  const expired = rowCount ?? 0;
  // The clearest failure signal the marketplace has: a rider asked, nobody came.
  // Counted here rather than derived from the cancel_reason so it is visible as a
  // rate the moment it happens, without waiting for the 30s gauge refresh.
  if (expired > 0) ridesExpiredNoCaptain.inc(expired);
  return expired;
}

export function startRideExpiryCron() {
  const tick = async () => {
    try {
      const n = await expireSearchingRides();
      if (n > 0) {
        // eslint-disable-next-line no-console
        console.log(`[ride-expiry] cancelled ${n} stale searching ride(s)`);
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
