import { withTx } from '../../db/pool.js';
import { getPricingSettings } from '../admin/app-settings.service.js';
import type { PartnerStatus, PartnerType } from '@tewiz/shared-types';

// Earning attribution at ride completion.
//
// Called AFTER the completion transaction commits, wrapped in try/catch by
// the caller: an attribution failure must never un-complete a ride or block
// the captain's payment. Idempotence is structural — partner_earnings has
// UNIQUE (ride_id, partner_id, role), every INSERT is ON CONFLICT DO NOTHING,
// and side effects (window counter, closure/conversion flags) only fire when
// the INSERT actually inserted. Replaying is always safe.
//
// One ride can pay TWO partners: the creation side (restaurant/member who
// booked it) and the captain side (agency of the courier, inside his
// window). Each gets its own share of the platform commission, but the sum
// of shares is capped by app_settings.partner_total_share_cap_bps — both
// are scaled down proportionally when the raw sum exceeds the cap.

interface RideForAttribution {
  id: string;
  status: string;
  source: string;
  origin_partner_id: string | null;
  captain_id: string | null;
  commission_mru: string | null;
  booker_phone: string | null;
}

interface PartnerTermsRow {
  id: string;
  type: PartnerType;
  status: PartnerStatus;
  share_bps: number;
  window_max_courses: number;
  closure_bonus_mru: string;
  quota_courses: number;
  quota_months: number;
  conversion_bonus_mru: string;
  created_at: Date;
}

export interface AttributionResult {
  creatorEarning: boolean;
  captainEarning: boolean;
  closureBonus: boolean;
  conversionBonus: boolean;
}

export async function applyPartnerAttributionOnCompletion(
  rideId: string,
): Promise<AttributionResult> {
  const settings = await getPricingSettings();
  const result: AttributionResult = {
    creatorEarning: false,
    captainEarning: false,
    closureBonus: false,
    conversionBonus: false,
  };

  return withTx(async (client) => {
    const rideRes = await client.query<RideForAttribution>(
      `SELECT r.id, r.status, r.source, r.origin_partner_id, r.captain_id,
              r.commission_mru, u.phone AS booker_phone
         FROM rides r
         JOIN users u ON u.id = r.booker_id
        WHERE r.id = $1`,
      [rideId],
    );
    const ride = rideRes.rows[0];
    if (!ride || ride.status !== 'completed') return result;

    // The base is the commission the platform ACTUALLY charged on this ride
    // (post bonus/penalty adjustments) — we share what we earned, not a
    // theoretical figure.
    const baseCommission = Number(ride.commission_mru ?? 0);

    // ── Candidate shares ────────────────────────────────────────────────────
    let creator: { partnerId: string; shareBps: number } | null = null;
    let captainSide: {
      partnerId: string;
      shareBps: number;
      windowMaxCourses: number;
      closureBonusMru: number;
    } | null = null;

    // Creation side: restaurant or individual member who booked the ride.
    if (ride.origin_partner_id) {
      const pRes = await client.query<PartnerTermsRow>(
        `SELECT id, type, status, share_bps, window_max_courses,
                closure_bonus_mru, quota_courses, quota_months,
                conversion_bonus_mru, created_at
           FROM partners WHERE id = $1 FOR UPDATE`,
        [ride.origin_partner_id],
      );
      const p = pRes.rows[0];
      if (p && p.status === 'active') {
        let eligible = p.type === 'restaurant';
        if (p.type === 'individual') {
          // Quota: first `quota_courses` credited rides OR `quota_months`
          // after the contract started, whichever comes first. The partner
          // row is locked above so two concurrent completions can't both
          // pass the count check.
          const cnt = await client.query<{ n: string }>(
            `SELECT count(*) AS n FROM partner_earnings
              WHERE partner_id = $1 AND role = 'ride_creator'
                AND status <> 'cancelled'`,
            [p.id],
          );
          const withinQuota = Number(cnt.rows[0]!.n) < p.quota_courses;
          const withinTime =
            Date.now() < addMonths(p.created_at, p.quota_months).getTime();
          eligible = withinQuota && withinTime;
        }
        if (eligible) creator = { partnerId: p.id, shareBps: p.share_bps };
      }
    }

    // Captain side: the courier's agency window, if still open.
    if (ride.captain_id) {
      const linkRes = await client.query<{
        partner_id: string;
        expires_at: Date;
        courses_counted: number;
        closed_at: Date | null;
        closure_bonus_paid: boolean;
        p_status: PartnerStatus;
        share_bps: number;
        window_max_courses: number;
        closure_bonus_mru: string;
      }>(
        `SELECT l.partner_id, l.expires_at, l.courses_counted, l.closed_at,
                l.closure_bonus_paid,
                p.status AS p_status, p.share_bps, p.window_max_courses,
                p.closure_bonus_mru
           FROM captain_partner_links l
           JOIN partners p ON p.id = l.partner_id
          WHERE l.captain_id = $1
          FOR UPDATE OF l`,
        [ride.captain_id],
      );
      const link = linkRes.rows[0];
      if (link && link.closed_at === null) {
        const expired = Date.now() >= link.expires_at.getTime();
        const full = link.courses_counted >= link.window_max_courses;
        if (expired || full) {
          // The window lapsed before this ride could count: close it now and
          // pay the closure bonus (once) if it ended in good standing.
          await closeWindow(client, ride.captain_id, ride.id, {
            partnerId: link.partner_id,
            partnerActive: link.p_status === 'active',
            closureBonusMru: Number(link.closure_bonus_mru),
            closureBonusPaid: link.closure_bonus_paid,
          }, result);
        } else if (link.p_status === 'active') {
          captainSide = {
            partnerId: link.partner_id,
            shareBps: link.share_bps,
            windowMaxCourses: link.window_max_courses,
            closureBonusMru: Number(link.closure_bonus_mru),
          };
        }
      }
    }

    // ── Global cap: scale both shares down proportionally ──────────────────
    const capBps = settings.partnerTotalShareCapBps;
    const rawTotal = (creator?.shareBps ?? 0) + (captainSide?.shareBps ?? 0);
    const scale = rawTotal > capBps ? capBps / rawTotal : 1;
    const effectiveBps = (bps: number) => Math.floor(bps * scale);
    const amountFor = (bps: number) =>
      Math.floor((baseCommission * effectiveBps(bps)) / 10_000);

    if (creator && baseCommission > 0) {
      const ins = await client.query(
        `INSERT INTO partner_earnings
           (partner_id, ride_id, role, base_commission_mru, share_bps, amount_mru)
         VALUES ($1, $2, 'ride_creator', $3, $4, $5)
         ON CONFLICT (ride_id, partner_id, role) DO NOTHING`,
        [creator.partnerId, ride.id, baseCommission,
         effectiveBps(creator.shareBps), amountFor(creator.shareBps)],
      );
      result.creatorEarning = (ins.rowCount ?? 0) > 0;
    }

    if (captainSide && ride.captain_id) {
      const ins = await client.query(
        `INSERT INTO partner_earnings
           (partner_id, ride_id, role, base_commission_mru, share_bps, amount_mru)
         VALUES ($1, $2, 'captain_provider', $3, $4, $5)
         ON CONFLICT (ride_id, partner_id, role) DO NOTHING`,
        [captainSide.partnerId, ride.id, baseCommission,
         effectiveBps(captainSide.shareBps), amountFor(captainSide.shareBps)],
      );
      result.captainEarning = (ins.rowCount ?? 0) > 0;

      // The counter only moves when the earning actually inserted, so a
      // replay never double-counts. Reaching the max closes the window and
      // pays the closure bonus in the same transaction.
      if (result.captainEarning) {
        const upd = await client.query<{ courses_counted: number; closure_bonus_paid: boolean }>(
          `UPDATE captain_partner_links
              SET courses_counted = courses_counted + 1
            WHERE captain_id = $1
            RETURNING courses_counted, closure_bonus_paid`,
          [ride.captain_id],
        );
        const after = upd.rows[0]!;
        if (after.courses_counted >= captainSide.windowMaxCourses) {
          await closeWindow(client, ride.captain_id, ride.id, {
            partnerId: captainSide.partnerId,
            partnerActive: true,
            closureBonusMru: captainSide.closureBonusMru,
            closureBonusPaid: after.closure_bonus_paid,
          }, result);
        }
      }
    }

    // ── Conversion bonus (strategy 2) ───────────────────────────────────────
    // The end customer ordered HIMSELF from the app (source='app') and his
    // phone belongs to a member's beneficiary list, not yet converted. The
    // UPDATE ... WHERE converted_at IS NULL is the once-only latch.
    if (ride.source === 'app' && ride.booker_phone) {
      const conv = await client.query<{ partner_id: string }>(
        `UPDATE partner_beneficiaries
            SET converted_at = now(), conversion_ride_id = $2
          WHERE phone = $1 AND converted_at IS NULL
          RETURNING partner_id`,
        [ride.booker_phone, ride.id],
      );
      if (conv.rows[0]) {
        const pRes = await client.query<{ status: PartnerStatus; conversion_bonus_mru: string }>(
          `SELECT status, conversion_bonus_mru FROM partners WHERE id = $1`,
          [conv.rows[0].partner_id],
        );
        const p = pRes.rows[0];
        const bonus = Number(p?.conversion_bonus_mru ?? 0);
        if (p?.status === 'active' && bonus > 0) {
          const ins = await client.query(
            `INSERT INTO partner_earnings
               (partner_id, ride_id, role, base_commission_mru, share_bps, amount_mru)
             VALUES ($1, $2, 'conversion_bonus', 0, 0, $3)
             ON CONFLICT (ride_id, partner_id, role) DO NOTHING`,
            [conv.rows[0].partner_id, ride.id, bonus],
          );
          result.conversionBonus = (ins.rowCount ?? 0) > 0;
        }
      }
    }

    return result;
  });
}

/**
 * Close a courier window and pay the closure bonus exactly once. The bonus
 * earning is keyed on the ride that triggered the closure, so the UNIQUE
 * constraint + closure_bonus_paid flag both protect against double payment.
 */
async function closeWindow(
  client: import('pg').PoolClient,
  captainId: string,
  rideId: string,
  w: {
    partnerId: string;
    partnerActive: boolean;
    closureBonusMru: number;
    closureBonusPaid: boolean;
  },
  result: AttributionResult,
): Promise<void> {
  await client.query(
    `UPDATE captain_partner_links
        SET closed_at = COALESCE(closed_at, now())
      WHERE captain_id = $1`,
    [captainId],
  );
  if (w.partnerActive && w.closureBonusMru > 0 && !w.closureBonusPaid) {
    const ins = await client.query(
      `INSERT INTO partner_earnings
         (partner_id, ride_id, role, base_commission_mru, share_bps, amount_mru)
       VALUES ($1, $2, 'closure_bonus', 0, 0, $3)
       ON CONFLICT (ride_id, partner_id, role) DO NOTHING`,
      [w.partnerId, rideId, w.closureBonusMru],
    );
    if ((ins.rowCount ?? 0) > 0) {
      await client.query(
        `UPDATE captain_partner_links SET closure_bonus_paid = true
          WHERE captain_id = $1`,
        [captainId],
      );
      result.closureBonus = true;
    }
  }
}

/**
 * Mirror of commission_refund: when a completed ride is refunded/voided by
 * an admin, its partner earnings flip to 'cancelled' (never deleted — the
 * ledger is append-only in spirit). Settled lines are left alone: money
 * already paid out is an admin conversation, not a silent flip.
 */
export async function cancelPartnerEarningsForRide(
  rideId: string,
  client?: import('pg').PoolClient,
): Promise<number> {
  const run = async (c: import('pg').PoolClient) => {
    const r = await c.query(
      `UPDATE partner_earnings
          SET status = 'cancelled'
        WHERE ride_id = $1 AND status IN ('pending', 'on_hold')`,
      [rideId],
    );
    return r.rowCount ?? 0;
  };
  return client ? run(client) : withTx(run);
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  out.setMonth(out.getMonth() + months);
  return out;
}
