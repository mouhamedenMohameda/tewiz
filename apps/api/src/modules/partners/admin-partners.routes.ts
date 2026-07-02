import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { audit } from '../admin/audit.js';
import { generatePassword, hashPassword } from '../auth/password.js';
import { phoneSchema } from '../auth/phone.js';
import {
  createPartner,
  updatePartner,
  shapePartner,
  PARTNER_COLUMNS,
  type PartnerRow,
} from './partners.service.js';
import { scanPartnerEarnings } from './fraud.service.js';

// Back-office management of the partner program (mounted under
// /admin/partners; parent router already enforces auth + role gating).

export const adminPartnersRouter = Router();

// ─── Partners ────────────────────────────────────────────────────────────────

const listQuery = z.object({
  type: z.enum(['agency', 'restaurant', 'individual']).optional(),
  status: z.enum(['active', 'suspended', 'ended']).optional(),
});

/**
 * GET /admin/partners — directory with current-month earnings snapshot.
 */
adminPartnersRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);
  const r = await pool.query(
    `SELECT ${PARTNER_COLUMNS.split(',').map((c) => `p.${c.trim()}`).join(', ')},
            COALESCE(m.total, 0) AS month_total_mru,
            COALESCE(m.n, 0)     AS month_count
       FROM partners p
       LEFT JOIN LATERAL (
         SELECT SUM(e.amount_mru) AS total, count(*) AS n
           FROM partner_earnings e
          WHERE e.partner_id = p.id
            AND e.status <> 'cancelled'
            AND e.created_at >= date_trunc('month', now())
       ) m ON true
      WHERE ($1::text IS NULL OR p.type = $1)
        AND ($2::text IS NULL OR p.status = $2)
      ORDER BY p.created_at DESC`,
    [q.type ?? null, q.status ?? null],
  );
  res.json(r.rows.map((row) => ({
    ...shapePartner(row as PartnerRow),
    monthTotalMru: Number(row.month_total_mru),
    monthCount: Number(row.month_count),
  })));
});

const termsShape = {
  shareBps: z.number().int().min(0).max(5000),
  windowMonths: z.number().int().min(1).max(60).optional(),
  windowMaxCourses: z.number().int().min(1).max(10_000).optional(),
  closureBonusMru: z.number().int().min(0).optional(),
  quotaCourses: z.number().int().min(1).max(10_000).optional(),
  quotaMonths: z.number().int().min(1).max(60).optional(),
  conversionBonusMru: z.number().int().min(0).optional(),
};

const createBody = z.object({
  type: z.enum(['agency', 'restaurant', 'individual']),
  name: z.string().min(2).max(120),
  phone: z.string().min(6).max(20).optional(),
  code: z.string().min(3).max(20).optional(),
  restaurantId: z.string().max(120).optional(),
  // Login account for the partner dashboard / ride creation. When the phone
  // matches an existing user we link it; otherwise we create a rider account
  // and return its one-time password (shown once, like captain approval).
  userPhone: phoneSchema.optional(),
  ...termsShape,
});

adminPartnersRouter.post('/', async (req, res) => {
  const adminId = req.user!.id;
  const body = createBody.parse(req.body);

  let userId: string | null = null;
  let partnerPassword: string | null = null;
  if (body.userPhone) {
    const existing = await pool.query<{ id: string; role: string }>(
      `SELECT id, role FROM users WHERE phone = $1`,
      [body.userPhone],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].role === 'admin') {
        throw new HttpError(400, 'user_is_admin',
          'Un compte admin ne peut pas servir de compte partenaire');
      }
      userId = existing.rows[0].id;
    } else {
      partnerPassword = generatePassword();
      const hash = await hashPassword(partnerPassword);
      const created = await pool.query<{ id: string }>(
        `INSERT INTO users (phone, role, full_name, password_hash)
         VALUES ($1, 'rider', $2, $3) RETURNING id`,
        [body.userPhone, body.name, hash],
      );
      userId = created.rows[0]!.id;
    }
  }

  const partner = await createPartner({
    type: body.type,
    name: body.name,
    phone: body.phone ?? body.userPhone ?? null,
    code: body.code ?? null,
    userId,
    restaurantId: body.restaurantId ?? null,
    shareBps: body.shareBps,
    windowMonths: body.windowMonths,
    windowMaxCourses: body.windowMaxCourses,
    closureBonusMru: body.closureBonusMru,
    quotaCourses: body.quotaCourses,
    quotaMonths: body.quotaMonths,
    conversionBonusMru: body.conversionBonusMru,
    createdBy: adminId,
  });

  await audit({
    adminId,
    action: 'create_partner',
    targetType: 'partner',
    targetId: partner.id,
    after: partner,
  });
  // partnerPassword is non-null only when a fresh login account was created;
  // shown ONCE so the admin can hand it to the partner.
  res.status(201).json({ ...partner, partnerPassword });
});

// ─── Earnings registry (before /:id so the literal path wins) ───────────────

const earningsQuery = z.object({
  partnerId: z.string().uuid().optional(),
  status: z.enum(['pending', 'on_hold', 'settled', 'cancelled']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

/**
 * GET /admin/partners/earnings — the registry, filterable. With
 * status=on_hold this doubles as the fraud report (hold_reason says which
 * signal froze each line).
 */
adminPartnersRouter.get('/earnings', async (req, res) => {
  const q = earningsQuery.parse(req.query);
  const r = await pool.query(
    `SELECT e.id, e.partner_id, p.name AS partner_name, p.code AS partner_code,
            e.ride_id, e.role, e.base_commission_mru, e.share_bps, e.amount_mru,
            e.status, e.hold_reason, e.settlement_id, e.created_at,
            r.completed_at, r.distance_m, r.pickup_label, r.dropoff_label
       FROM partner_earnings e
       JOIN partners p ON p.id = e.partner_id
       JOIN rides r    ON r.id = e.ride_id
      WHERE ($1::uuid IS NULL OR e.partner_id = $1)
        AND ($2::text IS NULL OR e.status = $2)
        AND ($3::timestamptz IS NULL OR e.created_at >= $3)
        AND ($4::timestamptz IS NULL OR e.created_at < $4)
      ORDER BY e.created_at DESC
      LIMIT $5`,
    [q.partnerId ?? null, q.status ?? null, q.from ?? null, q.to ?? null, q.limit],
  );
  res.json(r.rows.map((e) => ({
    id: e.id,
    partnerId: e.partner_id,
    partnerName: e.partner_name,
    partnerCode: e.partner_code,
    rideId: e.ride_id,
    role: e.role,
    baseCommissionMru: Number(e.base_commission_mru),
    shareBps: e.share_bps,
    amountMru: Number(e.amount_mru),
    status: e.status,
    holdReason: e.hold_reason,
    settlementId: e.settlement_id,
    createdAt: e.created_at,
    ride: {
      completedAt: e.completed_at,
      distanceM: e.distance_m,
      pickupLabel: e.pickup_label,
      dropoffLabel: e.dropoff_label,
    },
  })));
});

/**
 * PATCH /admin/partners/earnings/:id — moderation. Allowed moves:
 * pending ↔ on_hold, and (pending|on_hold) → cancelled. Settled lines are
 * immutable (money already paid).
 */
const moderateBody = z.object({
  status: z.enum(['pending', 'on_hold', 'cancelled']),
  reason: z.string().max(500).optional(),
});

adminPartnersRouter.patch('/earnings/:id', async (req, res) => {
  const adminId = req.user!.id;
  const body = moderateBody.parse(req.body);
  const before = await pool.query(
    `SELECT id, status, hold_reason FROM partner_earnings WHERE id = $1`,
    [req.params.id],
  );
  if (!before.rows[0]) throw new HttpError(404, 'not_found', 'Gain introuvable');
  if (before.rows[0].status === 'settled') {
    throw new HttpError(409, 'already_settled',
      'Gain déjà réglé — impossible de le modifier');
  }
  const upd = await pool.query(
    `UPDATE partner_earnings
        SET status = $1,
            hold_reason = CASE
              WHEN $1 = 'on_hold' THEN COALESCE($2, hold_reason, 'gel manuel admin')
              ELSE hold_reason
            END,
            settlement_id = CASE WHEN $1 = 'cancelled' THEN NULL ELSE settlement_id END
      WHERE id = $3 AND status <> 'settled'
      RETURNING id, status, hold_reason, settlement_id`,
    [body.status, body.reason ?? null, req.params.id],
  );
  await audit({
    adminId,
    action: `partner_earning_${body.status}`,
    targetType: 'partner_earning',
    targetId: req.params.id!,
    before: before.rows[0],
    after: upd.rows[0],
    reason: body.reason ?? null,
  });
  res.json(upd.rows[0]);
});

/**
 * POST /admin/partners/fraud-scan — same job as /admin/jobs/partner-fraud-scan
 * but reachable by finance/ops (the jobs router is super_admin-only, it's
 * meant for cron).
 */
adminPartnersRouter.post('/fraud-scan', async (_req, res) => {
  res.json(await scanPartnerEarnings());
});

// ─── Settlements ─────────────────────────────────────────────────────────────

const settlementsListQuery = z.object({
  partnerId: z.string().uuid().optional(),
  status: z.enum(['draft', 'paid']).optional(),
});

adminPartnersRouter.get('/settlements', async (req, res) => {
  const q = settlementsListQuery.parse(req.query);
  const r = await pool.query(
    `SELECT s.id, s.partner_id, p.name AS partner_name, p.code AS partner_code,
            s.period_start, s.period_end, s.total_mru, s.status,
            s.paid_at, s.paid_by, s.note, s.created_at
       FROM partner_settlements s
       JOIN partners p ON p.id = s.partner_id
      WHERE ($1::uuid IS NULL OR s.partner_id = $1)
        AND ($2::text IS NULL OR s.status = $2)
      ORDER BY s.created_at DESC`,
    [q.partnerId ?? null, q.status ?? null],
  );
  res.json(r.rows.map((s) => ({
    id: s.id,
    partnerId: s.partner_id,
    partnerName: s.partner_name,
    partnerCode: s.partner_code,
    periodStart: s.period_start,
    periodEnd: s.period_end,
    totalMru: Number(s.total_mru),
    status: s.status,
    paidAt: s.paid_at,
    paidBy: s.paid_by,
    note: s.note,
    createdAt: s.created_at,
  })));
});

/**
 * POST /admin/partners/:id/settlements — bundle the partner's un-settled
 * 'pending' earnings of the period into a draft settlement. on_hold lines
 * stay out until an admin releases them (they'll join a later settlement).
 */
const generateBody = z.object({
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  note: z.string().max(500).optional(),
});

adminPartnersRouter.post('/:id/settlements', async (req, res) => {
  const adminId = req.user!.id;
  const body = generateBody.parse(req.body);
  if (body.periodEnd < body.periodStart) {
    throw new HttpError(400, 'invalid_period', 'periodEnd doit être ≥ periodStart');
  }

  const settlement = await withTx(async (client) => {
    const p = await client.query(
      `SELECT id FROM partners WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    );
    if (!p.rows[0]) throw new HttpError(404, 'not_found', 'Partenaire introuvable');

    const s = await client.query(
      `INSERT INTO partner_settlements (partner_id, period_start, period_end, note)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [req.params.id, body.periodStart, body.periodEnd, body.note ?? null],
    );
    const settlementId = s.rows[0]!.id as string;

    // Attach the period's free pending lines. The period is matched on the
    // earning creation date (= ride completion date, same transaction-less
    // moment) with an exclusive upper bound at periodEnd + 1 day.
    const attached = await client.query<{ total: string; n: string }>(
      `WITH linked AS (
         UPDATE partner_earnings
            SET settlement_id = $1
          WHERE partner_id = $2
            AND status = 'pending'
            AND settlement_id IS NULL
            AND created_at >= $3
            AND created_at < $4::date + 1
          RETURNING amount_mru
       )
       SELECT COALESCE(SUM(amount_mru), 0) AS total, count(*) AS n FROM linked`,
      [settlementId, req.params.id, body.periodStart, body.periodEnd],
    );
    const total = Number(attached.rows[0]!.total);
    const n = Number(attached.rows[0]!.n);
    if (n === 0) {
      throw new HttpError(409, 'nothing_to_settle',
        'Aucun gain en attente sur cette période');
    }
    const upd = await client.query(
      `UPDATE partner_settlements SET total_mru = $1 WHERE id = $2
       RETURNING id, partner_id, period_start, period_end, total_mru, status, note, created_at`,
      [total, settlementId],
    );
    return { ...upd.rows[0], earningsCount: n };
  });

  await audit({
    adminId,
    action: 'generate_partner_settlement',
    targetType: 'partner_settlement',
    targetId: settlement.id,
    after: settlement,
  });
  res.status(201).json(settlement);
});

/**
 * POST /admin/partners/settlements/:id/pay — mark paid; the linked earnings
 * flip to 'settled' atomically.
 */
adminPartnersRouter.post('/settlements/:id/pay', async (req, res) => {
  const adminId = req.user!.id;
  const paid = await withTx(async (client) => {
    const s = await client.query(
      `UPDATE partner_settlements
          SET status = 'paid', paid_at = now(), paid_by = $1
        WHERE id = $2 AND status = 'draft'
        RETURNING id, partner_id, period_start, period_end, total_mru, status, paid_at`,
      [adminId, req.params.id],
    );
    if (!s.rows[0]) {
      throw new HttpError(409, 'not_draft', 'Règlement introuvable ou déjà payé');
    }
    await client.query(
      `UPDATE partner_earnings SET status = 'settled'
        WHERE settlement_id = $1 AND status = 'pending'`,
      [req.params.id],
    );
    return s.rows[0];
  });
  await audit({
    adminId,
    action: 'pay_partner_settlement',
    targetType: 'partner_settlement',
    targetId: req.params.id!,
    after: paid,
  });
  res.json(paid);
});

// ─── Courier ↔ agency links ─────────────────────────────────────────────────

/**
 * GET /admin/partners/links — every courier window, agency name included.
 */
adminPartnersRouter.get('/links', async (_req, res) => {
  const r = await pool.query(
    `SELECT l.captain_id, u.full_name AS captain_name, u.phone AS captain_phone,
            l.partner_id, p.name AS partner_name, p.code AS partner_code,
            p.window_max_courses,
            l.attached_at, l.expires_at, l.courses_counted,
            l.closed_at, l.closure_bonus_paid
       FROM captain_partner_links l
       JOIN users u    ON u.id = l.captain_id
       JOIN partners p ON p.id = l.partner_id
      ORDER BY l.attached_at DESC`,
  );
  res.json(r.rows.map((l) => ({
    captainId: l.captain_id,
    captainName: l.captain_name,
    captainPhone: l.captain_phone,
    partnerId: l.partner_id,
    partnerName: l.partner_name,
    partnerCode: l.partner_code,
    attachedAt: l.attached_at,
    expiresAt: l.expires_at,
    coursesCounted: l.courses_counted,
    coursesMax: l.window_max_courses,
    closedAt: l.closed_at,
    closureBonusPaid: l.closure_bonus_paid,
  })));
});

// ─── Partner detail / update ────────────────────────────────────────────────

adminPartnersRouter.get('/:id', async (req, res) => {
  const p = await pool.query<PartnerRow>(
    `SELECT ${PARTNER_COLUMNS} FROM partners WHERE id = $1`,
    [req.params.id],
  );
  if (!p.rows[0]) throw new HttpError(404, 'not_found', 'Partenaire introuvable');

  const links = await pool.query(
    `SELECT l.captain_id, u.full_name, u.phone,
            l.attached_at, l.expires_at, l.courses_counted,
            l.closed_at, l.closure_bonus_paid
       FROM captain_partner_links l
       JOIN users u ON u.id = l.captain_id
      WHERE l.partner_id = $1
      ORDER BY l.attached_at DESC`,
    [req.params.id],
  );

  const totals = await pool.query<{ status: string; total: string; n: string }>(
    `SELECT status, COALESCE(SUM(amount_mru), 0) AS total, count(*) AS n
       FROM partner_earnings WHERE partner_id = $1 GROUP BY status`,
    [req.params.id],
  );

  res.json({
    ...shapePartner(p.rows[0]),
    links: links.rows.map((l) => ({
      captainId: l.captain_id,
      captainName: l.full_name,
      captainPhone: l.phone,
      attachedAt: l.attached_at,
      expiresAt: l.expires_at,
      coursesCounted: l.courses_counted,
      coursesMax: p.rows[0]!.window_max_courses,
      closedAt: l.closed_at,
      closureBonusPaid: l.closure_bonus_paid,
    })),
    earningsByStatus: Object.fromEntries(
      totals.rows.map((t) => [t.status, { totalMru: Number(t.total), count: Number(t.n) }]),
    ),
  });
});

const patchBody = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().min(6).max(20).nullable().optional(),
  status: z.enum(['active', 'suspended', 'ended']).optional(),
  restaurantId: z.string().max(120).nullable().optional(),
  shareBps: z.number().int().min(0).max(5000).optional(),
  windowMonths: z.number().int().min(1).max(60).optional(),
  windowMaxCourses: z.number().int().min(1).max(10_000).optional(),
  closureBonusMru: z.number().int().min(0).optional(),
  quotaCourses: z.number().int().min(1).max(10_000).optional(),
  quotaMonths: z.number().int().min(1).max(60).optional(),
  conversionBonusMru: z.number().int().min(0).optional(),
});

adminPartnersRouter.patch('/:id', async (req, res) => {
  const adminId = req.user!.id;
  const body = patchBody.parse(req.body);
  const before = await pool.query<PartnerRow>(
    `SELECT ${PARTNER_COLUMNS} FROM partners WHERE id = $1`,
    [req.params.id],
  );
  if (!before.rows[0]) throw new HttpError(404, 'not_found', 'Partenaire introuvable');
  const updated = await updatePartner(req.params.id!, body);
  await audit({
    adminId,
    action: 'update_partner',
    targetType: 'partner',
    targetId: req.params.id!,
    before: shapePartner(before.rows[0]),
    after: updated,
  });
  res.json(updated);
});
