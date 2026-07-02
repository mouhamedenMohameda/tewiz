import { pool } from '../../db/pool.js';
import { getPricingSettings } from '../admin/app-settings.service.js';

// Periodic anti-fraud scan over partner earnings (day-1 requirement).
//
// Suspicious PENDING earnings are frozen (status='on_hold' + hold_reason),
// never deleted — an admin reviews the /admin/partners fraud report and
// either releases (back to 'pending') or cancels each line. Signals:
//
//   pair_recurrence   same rider↔captain pair completed more than N rides
//                     in the 7 days up to this ride — collusion loops.
//   short_distance    ride shorter than the configured minimum — fake
//                     micro-rides farmed for commission shares.
//   creation_burst    more than M rides created by the same individual
//                     member within 1 hour — bot-like booking sprees.
//
// Thresholds live in app_settings so ops can tune them without a deploy.
// Idempotent and cheap: each pass only looks at still-'pending' lines.

export interface FraudScanResult {
  pairRecurrence: number;
  shortDistance: number;
  creationBurst: number;
}

export async function scanPartnerEarnings(): Promise<FraudScanResult> {
  const s = await getPricingSettings();

  const pair = await pool.query(
    `UPDATE partner_earnings pe
        SET status = 'on_hold',
            hold_reason = 'pair_recurrence: paire client-chauffeur > '
                          || $1 || ' courses sur 7 jours'
       FROM rides r
      WHERE pe.ride_id = r.id
        AND pe.status = 'pending'
        AND pe.role IN ('ride_creator', 'captain_provider')
        AND r.captain_id IS NOT NULL
        AND (SELECT count(*) FROM rides r2
              WHERE r2.booker_id = r.booker_id
                AND r2.captain_id = r.captain_id
                AND r2.status = 'completed'
                AND r2.completed_at >= r.completed_at - interval '7 days'
                AND r2.completed_at <= r.completed_at) > $1`,
    [s.partnerFraudPairMaxRides7d],
  );

  const short = await pool.query(
    `UPDATE partner_earnings pe
        SET status = 'on_hold',
            hold_reason = 'short_distance: ' || COALESCE(r.distance_m::text, '?')
                          || ' m < ' || $1 || ' m'
       FROM rides r
      WHERE pe.ride_id = r.id
        AND pe.status = 'pending'
        AND pe.role IN ('ride_creator', 'captain_provider')
        AND r.distance_m IS NOT NULL
        AND r.distance_m < $1`,
    [s.partnerFraudMinDistanceM],
  );

  const burst = await pool.query(
    `UPDATE partner_earnings pe
        SET status = 'on_hold',
            hold_reason = 'creation_burst: > ' || $1 || ' courses créées en 1 h'
       FROM rides r, partners p
      WHERE pe.ride_id = r.id
        AND pe.partner_id = p.id
        AND pe.status = 'pending'
        AND pe.role = 'ride_creator'
        AND p.type = 'individual'
        AND (SELECT count(*) FROM rides r2
              WHERE r2.origin_partner_id = r.origin_partner_id
                AND r2.requested_at >= r.requested_at - interval '1 hour'
                AND r2.requested_at <= r.requested_at) > $1`,
    [s.partnerFraudMaxCreationsPerHour],
  );

  return {
    pairRecurrence: pair.rowCount ?? 0,
    shortDistance: short.rowCount ?? 0,
    creationBurst: burst.rowCount ?? 0,
  };
}
