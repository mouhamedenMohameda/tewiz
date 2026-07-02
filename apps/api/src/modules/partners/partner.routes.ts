import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { findPartnerByUserId, shapePartner, type PartnerRow } from './partners.service.js';

// Partner-facing dashboard endpoints (mounted at /partner).
//
// A partner signs in with the regular password flow — their login account is
// an ordinary `users` row referenced by partners.user_id. Any authenticated
// user whose id matches a partner row gets through; everyone else is 403.
// This near-real-time view of attributed rides and amounts is the
// anti-dispute tool: the partner sees each earning the moment the ride
// completes, while payout stays monthly via settlements.

export const partnerRouter = Router();
partnerRouter.use(requireAuth);

// Resolve the partner once per request and stash it on res.locals.
const requirePartner: RequestHandler = async (req, res, next) => {
  try {
    const partner = await findPartnerByUserId(req.user!.id);
    if (!partner) {
      throw new HttpError(403, 'not_a_partner', 'Aucun compte partenaire lié');
    }
    res.locals.partner = partner;
    next();
  } catch (e) {
    next(e);
  }
};
partnerRouter.use(requirePartner);

/**
 * GET /partner/me — contract terms, status, and live progression
 * (quota consumed for members, courier windows for agencies).
 */
partnerRouter.get('/me', async (_req, res) => {
  const partner = res.locals.partner as PartnerRow;

  const totals = await pool.query<{ status: string; total: string; n: string }>(
    `SELECT status, COALESCE(SUM(amount_mru), 0) AS total, count(*) AS n
       FROM partner_earnings WHERE partner_id = $1 GROUP BY status`,
    [partner.id],
  );

  let quota: { coursesUsed: number; coursesMax: number; endsAt: string } | null = null;
  if (partner.type === 'individual') {
    const used = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM partner_earnings
        WHERE partner_id = $1 AND role = 'ride_creator' AND status <> 'cancelled'`,
      [partner.id],
    );
    const endsAt = new Date(partner.created_at.getTime());
    endsAt.setMonth(endsAt.getMonth() + partner.quota_months);
    quota = {
      coursesUsed: Number(used.rows[0]!.n),
      coursesMax: partner.quota_courses,
      endsAt: endsAt.toISOString(),
    };
  }

  let windows: unknown[] | null = null;
  if (partner.type === 'agency') {
    const links = await pool.query(
      `SELECT l.captain_id, u.full_name, u.phone,
              l.attached_at, l.expires_at, l.courses_counted,
              l.closed_at, l.closure_bonus_paid
         FROM captain_partner_links l
         JOIN users u ON u.id = l.captain_id
        WHERE l.partner_id = $1
        ORDER BY l.attached_at DESC`,
      [partner.id],
    );
    windows = links.rows.map((l) => ({
      captainId: l.captain_id,
      captainName: l.full_name,
      captainPhone: l.phone,
      attachedAt: l.attached_at,
      expiresAt: l.expires_at,
      coursesCounted: l.courses_counted,
      coursesMax: partner.window_max_courses,
      closedAt: l.closed_at,
      closureBonusPaid: l.closure_bonus_paid,
    }));
  }

  const byStatus = Object.fromEntries(
    totals.rows.map((t) => [t.status, { totalMru: Number(t.total), count: Number(t.n) }]),
  );

  res.json({ partner: shapePartner(partner), earningsByStatus: byStatus, quota, windows });
});

/**
 * GET /partner/earnings?from=&to=&status=&limit=
 * Attributed rides + amounts, newest first.
 */
const earningsQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.enum(['pending', 'on_hold', 'settled', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

partnerRouter.get('/earnings', async (req, res) => {
  const partner = res.locals.partner as PartnerRow;
  const q = earningsQuery.parse(req.query);
  const r = await pool.query(
    `SELECT e.id, e.ride_id, e.role, e.base_commission_mru, e.share_bps,
            e.amount_mru, e.status, e.settlement_id, e.created_at,
            r.completed_at, r.pickup_label, r.dropoff_label, r.ride_type
       FROM partner_earnings e
       JOIN rides r ON r.id = e.ride_id
      WHERE e.partner_id = $1
        AND ($2::timestamptz IS NULL OR e.created_at >= $2)
        AND ($3::timestamptz IS NULL OR e.created_at < $3)
        AND ($4::text IS NULL OR e.status = $4)
      ORDER BY e.created_at DESC
      LIMIT $5`,
    [partner.id, q.from ?? null, q.to ?? null, q.status ?? null, q.limit],
  );
  res.json(r.rows.map((e) => ({
    id: e.id,
    rideId: e.ride_id,
    role: e.role,
    baseCommissionMru: Number(e.base_commission_mru),
    shareBps: e.share_bps,
    amountMru: Number(e.amount_mru),
    status: e.status,
    settlementId: e.settlement_id,
    createdAt: e.created_at,
    ride: {
      completedAt: e.completed_at,
      pickupLabel: e.pickup_label,
      dropoffLabel: e.dropoff_label,
      rideType: e.ride_type,
    },
  })));
});

/**
 * GET /partner/settlements — monthly payout history.
 */
partnerRouter.get('/settlements', async (_req, res) => {
  const partner = res.locals.partner as PartnerRow;
  const r = await pool.query(
    `SELECT id, period_start, period_end, total_mru, status, paid_at, note, created_at
       FROM partner_settlements
      WHERE partner_id = $1
      ORDER BY period_start DESC`,
    [partner.id],
  );
  res.json(r.rows.map((s) => ({
    id: s.id,
    periodStart: s.period_start,
    periodEnd: s.period_end,
    totalMru: Number(s.total_mru),
    status: s.status,
    paidAt: s.paid_at,
    note: s.note,
    createdAt: s.created_at,
  })));
});
