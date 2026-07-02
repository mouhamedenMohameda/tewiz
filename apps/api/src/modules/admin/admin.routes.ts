import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../../db/pool.js';
import {
  requireAuth,
  requireRole,
  requireAdminRole,
  requireAdminRoleByMethod,
  type AuthedRequest,
} from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { defaultStorage } from '../storage/local-disk.js';
import { generatePassword, hashPassword } from '../auth/password.js';
import { audit } from './audit.js';
import { adminTopupRouter } from './topup.routes.js';
import { adminRecurringRouter } from '../recurring/admin.routes.js';
import { adminJobsRouter } from '../jobs/admin-jobs.routes.js';
import { adminRidesRouter } from '../rides/admin-rides.routes.js';
import { adminUsersRouter } from './users.routes.js';
import { adminSettingsRouter } from './settings.routes.js';
import { adminDocumentRequirementsRouter } from './document-requirements.routes.js';
import { getRequiredDocumentTypes } from './document-requirements.service.js';
import { adminStatsRouter } from './stats.routes.js';
import { adminVoiceRidesRouter } from '../voice-rides/admin-voice-rides.routes.js';
import { adminRestaurantsRouter } from '../restaurants/admin-restaurants.routes.js';
import { adminNotificationsRouter } from '../notifications/admin.routes.js';
import { adminPartnersRouter } from '../partners/admin-partners.routes.js';
import { attachCaptainToAgency } from '../partners/partners.service.js';
import * as roadReports from '../reports/road-reports.service.js';
import type { ApplicationStatus } from '@tewiz/shared-types';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

// ─── Sub-router permission gates ─────────────────────────────────────────────
// super_admin implicitly bypasses every requireAdminRole(...) check, so the
// lists below enumerate only the OTHER admin sub-roles that get access.
// Two-tier sections use requireAdminRoleByMethod(viewRoles, actionRoles):
// GET/HEAD goes through viewRoles, anything else through actionRoles.

// Top-up review queue — FINANCE acts, SUPPORT can look.
adminRouter.use(
  '/topups',
  requireAdminRoleByMethod(
    ['ops_manager', 'finance', 'support'],
    ['ops_manager', 'finance'],
  ),
  adminTopupRouter,
);
// Recurring rides processor — internal/cron, super_admin only.
adminRouter.use('/recurring', requireAdminRole(), adminRecurringRouter);
// Cron-triggered batch jobs (heatmap, expiry, etc.) — super_admin only.
adminRouter.use('/jobs', requireAdminRole(), adminJobsRouter);
// Rides: dispatchers act, finance + support look.
adminRouter.use(
  '/rides',
  requireAdminRoleByMethod(
    ['ops_manager', 'dispatcher', 'finance', 'support'],
    ['ops_manager', 'dispatcher'],
  ),
  adminRidesRouter,
);
// User directory — ops can list and manage riders/captains; admin-on-admin
// actions are further restricted inside the router (super_admin only).
adminRouter.use(
  '/users',
  requireAdminRole('ops_manager'),
  adminUsersRouter,
);
// Global settings — super_admin only.
adminRouter.use('/settings', requireAdminRole(), adminSettingsRouter);
// Required document types — kyc_reviewer can read, super_admin edits.
adminRouter.use(
  '/document-requirements',
  requireAdminRoleByMethod(['kyc_reviewer'], []),
  adminDocumentRequirementsRouter,
);
// Stats — currently only operational rides data, so only the roles that
// consume it. When KYC / finance sections are added, expand this list and
// guard the new endpoints individually inside stats.routes.ts.
adminRouter.use(
  '/stats',
  requireAdminRole('ops_manager', 'dispatcher'),
  adminStatsRouter,
);
// Voice-ride dispatch queue — dispatchers act, support can look.
adminRouter.use(
  '/voice-rides',
  requireAdminRoleByMethod(
    ['ops_manager', 'dispatcher', 'support'],
    ['ops_manager', 'dispatcher'],
  ),
  adminVoiceRidesRouter,
);
// Restaurants directory — ops acts, everyone except finance can look.
adminRouter.use(
  '/restaurants',
  requireAdminRoleByMethod(
    ['ops_manager', 'dispatcher', 'kyc_reviewer', 'support'],
    ['ops_manager'],
  ),
  adminRestaurantsRouter,
);
// Notifications broadcast — ops only.
adminRouter.use(
  '/notifications',
  requireAdminRole('ops_manager'),
  adminNotificationsRouter,
);
// Partner program (agencies / restaurants / individual members) — finance
// and ops act (contracts, settlements, fraud moderation), support can look.
adminRouter.use(
  '/partners',
  requireAdminRoleByMethod(
    ['ops_manager', 'finance', 'support'],
    ['ops_manager', 'finance'],
  ),
  adminPartnersRouter,
);

// Admin can also drop abusive road reports — ops + super.
adminRouter.delete(
  '/road-reports/:id',
  requireAdminRole('ops_manager'),
  async (req, res) => {
    res.json(await roadReports.adminRemove(req.params.id as string));
  },
);

// ─── Captains directory ──────────────────────────────────────────────────────

/**
 * GET /admin/captains
 * Returns EVERY user with role='captain' (approved or not) with their live
 * presence + last known location. Used by the back-office "Chauffeurs" page
 * to show who is connected on the map.
 *
 * Presence resolution:
 *   1. captain_state.presence when the captain has toggled online/paused
 *      from the mobile app (live, includes on_ride).
 *   2. Otherwise, fall back to users.last_seen_at (bumped by the heartbeat
 *      middleware on every authenticated request) — "online" if seen in the
 *      last 5 minutes, else "offline".
 */
adminRouter.get('/captains', requireAdminRole(
  'ops_manager', 'dispatcher', 'kyc_reviewer', 'finance', 'support',
), async (_req, res) => {
  const r = await pool.query(
    `SELECT
        u.id                                    AS id,
        u.full_name,
        u.phone,
        COALESCE(c.status::text, 'pending')     AS status,
        c.rating_avg,
        c.total_rides,
        CASE
          WHEN cs.presence IS NOT NULL THEN cs.presence::text
          WHEN u.last_seen_at > now() - interval '5 minutes' THEN 'online'
          ELSE 'offline'
        END                                     AS presence,
        GREATEST(cs.updated_at, u.last_seen_at) AS last_seen,
        ST_X(cs.location::geometry)             AS lng,
        ST_Y(cs.location::geometry)             AS lat,
        v.plate, v.brand, v.model, v.color
       FROM users u
       LEFT JOIN captains c       ON c.user_id    = u.id
       LEFT JOIN captain_state cs ON cs.captain_id = u.id
       LEFT JOIN vehicles v       ON v.captain_id  = u.id AND v.is_active = true
      WHERE u.role = 'captain'
        AND COALESCE(u.is_guest, false) = false
      ORDER BY
        CASE
          WHEN cs.presence::text = 'on_ride' THEN 0
          WHEN cs.presence::text = 'online'  THEN 1
          WHEN u.last_seen_at > now() - interval '5 minutes' THEN 1
          WHEN cs.presence::text = 'paused'  THEN 2
          ELSE 3
        END,
        u.full_name NULLS LAST`,
  );
  res.json(r.rows);
});

// ─── Applications queue ──────────────────────────────────────────────────────
// KYC reviewers act, ops + dispatcher + support can look.
adminRouter.use(
  '/applications',
  requireAdminRoleByMethod(
    ['ops_manager', 'dispatcher', 'kyc_reviewer', 'support'],
    ['ops_manager', 'kyc_reviewer'],
  ),
);

const listQuery = z.object({
  status: z.enum([
    'draft', 'submitted', 'under_review', 'needs_correction', 'approved', 'rejected',
  ]).default('submitted'),
  limit: z.coerce.number().min(1).max(200).default(50),
});

adminRouter.get('/applications', async (req, res) => {
  const q = listQuery.parse(req.query);
  const r = await pool.query(
    `SELECT id, phone, full_name, status, submitted_at, created_at, updated_at
       FROM captain_applications
      WHERE status = $1
      ORDER BY COALESCE(submitted_at, created_at) ASC
      LIMIT $2`,
    [q.status, q.limit],
  );
  res.json(r.rows);
});

adminRouter.get('/applications/:id', async (req, res) => {
  const a = await pool.query(
    `SELECT * FROM captain_applications WHERE id = $1`,
    [req.params.id],
  );
  if (!a.rows[0]) throw new HttpError(404, 'not_found', 'Application not found');
  const docs = await pool.query(
    `SELECT id, type, status, expires_at, reject_reason, uploaded_at,
            content_hash, reviewed_by, reviewed_at
       FROM application_documents
      WHERE application_id = $1 ORDER BY type`,
    [req.params.id],
  );
  res.json({ application: a.rows[0], documents: docs.rows });
});

/**
 * Stream a document image to the admin reviewer. Admin only.
 */
adminRouter.get('/applications/:id/documents/:docId/file', async (req, res) => {
  const d = await pool.query<{ storage_key: string }>(
    `SELECT storage_key FROM application_documents
      WHERE id = $1 AND application_id = $2`,
    [req.params.docId, req.params.id],
  );
  if (!d.rows[0]) throw new HttpError(404, 'doc_not_found', 'Document not found');
  const buf = await defaultStorage.get(d.rows[0].storage_key);
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(buf);
});

// ─── Document review ─────────────────────────────────────────────────────────

const docReviewBody = z.object({
  status: z.enum(['approved', 'rejected']),
  rejectReason: z.string().min(2).max(500).optional(),
});

adminRouter.patch('/applications/:id/documents/:docId', async (req, res) => {
  const adminId = req.user!.id;
  const body = docReviewBody.parse(req.body);
  if (body.status === 'rejected' && !body.rejectReason) {
    throw new HttpError(400, 'reject_reason_required', 'rejectReason required when rejecting');
  }
  const before = await pool.query(
    `SELECT status, reject_reason FROM application_documents WHERE id = $1`,
    [req.params.docId],
  );
  const upd = await pool.query(
    `UPDATE application_documents
        SET status = $1,
            reject_reason = $2,
            reviewed_by = $3,
            reviewed_at = now()
      WHERE id = $4 AND application_id = $5
      RETURNING id, type, status, reject_reason, expires_at, reviewed_at`,
    [body.status, body.rejectReason ?? null, adminId, req.params.docId, req.params.id],
  );
  if (!upd.rows[0]) throw new HttpError(404, 'doc_not_found', 'Document not found');
  await audit({
    adminId,
    action: `document_${body.status}`,
    targetType: 'application_document',
    targetId: req.params.docId!,
    before: before.rows[0] ?? null,
    after: upd.rows[0],
    reason: body.rejectReason ?? null,
  });
  res.json(upd.rows[0]);
});

// ─── Application status transitions ──────────────────────────────────────────

/**
 * Move a submitted application to under_review (admin claims it).
 */
adminRouter.post('/applications/:id/claim', async (req, res) => {
  const adminId = req.user!.id;
  const upd = await pool.query(
    `UPDATE captain_applications
        SET status = 'under_review'
      WHERE id = $1 AND status = 'submitted'
      RETURNING *`,
    [req.params.id],
  );
  if (!upd.rows[0]) {
    throw new HttpError(409, 'cannot_claim', 'Application is not in "submitted" status');
  }
  await audit({
    adminId,
    action: 'claim_application',
    targetType: 'captain_application',
    targetId: req.params.id!,
    after: { status: 'under_review' },
  });
  res.json(upd.rows[0]);
});

/**
 * Approve the whole application. Requires all docs approved.
 * Creates: captain row, vehicle, wallet, captain_state.
 */
adminRouter.post('/applications/:id/approve', async (req, res) => {
  const adminId = req.user!.id;

  const result = await withTx(async (client) => {
    const a = await client.query(
      `SELECT * FROM captain_applications WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    );
    const app = a.rows[0];
    if (!app) throw new HttpError(404, 'not_found', 'Application not found');
    if (!['submitted', 'under_review'].includes(app.status)) {
      throw new HttpError(409, 'wrong_status',
        `Cannot approve from status "${app.status}"`);
    }
    if (!app.user_id) {
      throw new HttpError(500, 'no_user_id', 'Application has no linked user');
    }

    // Only required document types gate the approval. Optional types can be
    // missing or pending and the application still goes through. Required
    // types must (a) be uploaded and (b) be in status 'approved'.
    const requiredTypes = await getRequiredDocumentTypes();
    const docsRes = await client.query<{ type: string; status: string }>(
      `SELECT type, status FROM application_documents WHERE application_id = $1`,
      [req.params.id],
    );
    const byType = new Map(docsRes.rows.map((r) => [r.type, r.status] as const));
    const missing: string[] = [];
    const unapproved: string[] = [];
    for (const t of requiredTypes) {
      const status = byType.get(t);
      if (!status) missing.push(t);
      else if (status !== 'approved') unapproved.push(t);
    }
    if (missing.length > 0 || unapproved.length > 0) {
      throw new HttpError(400, 'required_docs_not_ready',
        'All required documents must be uploaded and approved first', {
          missing,
          unapproved,
        });
    }

    // Fetch the linked user's current identity so we can backfill name/phone
    // (a guest-originated applicant may have neither on the users row yet) and
    // decide whether to issue login credentials.
    const uRes = await client.query<{ phone: string | null; password_hash: string | null }>(
      `SELECT phone, password_hash FROM users WHERE id = $1 FOR UPDATE`,
      [app.user_id],
    );
    const u = uRes.rows[0];
    if (!u) throw new HttpError(404, 'not_found', 'Linked user not found');

    // A captain MUST be reachable by phone. Prefer the user's existing number,
    // fall back to the one captured on the application.
    const finalPhone = u.phone ?? app.phone ?? null;
    if (!finalPhone) {
      throw new HttpError(400, 'captain_needs_phone',
        'Le chauffeur doit avoir un numéro de téléphone avant validation.');
    }
    if (!u.phone) {
      const dup = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE phone = $1 AND id <> $2 LIMIT 1`,
        [finalPhone, app.user_id],
      );
      if (dup.rows[0]) {
        throw new HttpError(409, 'phone_taken',
          'Ce numéro est déjà utilisé par un autre compte.');
      }
    }

    // Issue login credentials if the captain has none yet (e.g. promoted from a
    // guest account) so they can sign in on another device via the password
    // flow. The admin sends this password to the new captain.
    let password: string | null = null;
    let passwordHash: string | null = null;
    if (!u.password_hash) {
      password = generatePassword();
      passwordHash = await hashPassword(password);
    }

    // Promote: captain role + clear the guest flag + backfill name/phone, and
    // attach the new password when one was generated.
    await client.query(
      `UPDATE users
          SET role = 'captain',
              is_guest = false,
              full_name = COALESCE(full_name, $2),
              phone = $3,
              password_hash = COALESCE($4, password_hash),
              password_updated_at = CASE WHEN $4 IS NULL THEN password_updated_at ELSE now() END,
              must_reset_password = CASE WHEN $4 IS NULL THEN must_reset_password ELSE false END
        WHERE id = $1 AND role <> 'admin'`,
      [app.user_id, app.full_name, finalPhone, passwordHash],
    );

    const vehicleType: 'car' | 'moto' = app.vehicle_type === 'moto' ? 'moto' : 'car';
    const acceptsColis = vehicleType === 'moto' ? true : !!app.accepts_colis;
    const acceptsLongDistance = vehicleType === 'moto' ? false : !!app.accepts_long_distance;

    // Create captain row
    await client.query(
      `INSERT INTO captains
         (user_id, application_id, status, vehicle_type, accepts_colis, accepts_long_distance)
       VALUES ($1, $2, 'active', $3, $4, $5)
       ON CONFLICT (user_id) DO NOTHING`,
      [app.user_id, app.id, vehicleType, acceptsColis, acceptsLongDistance],
    );

    // Vehicle (one active per captain). `plate` is globally UNIQUE, so a naive
    // INSERT explodes on re-approval (when the previous approval left a row)
    // or when the same plate was already attached to this captain (or worse,
    // someone else's). Reconcile:
    //   - If a row exists with this plate AND belongs to the same captain,
    //     reactivate it and refresh the other fields.
    //   - If it belongs to a DIFFERENT captain, refuse with a clear 409 so
    //     the operator knows there's a real plate collision.
    //   - Otherwise, deactivate all the captain's vehicles and insert a fresh
    //     row.
    const existingPlate = await client.query<{ captain_id: string }>(
      `SELECT captain_id FROM vehicles WHERE plate = $1 FOR UPDATE`,
      [app.vehicle_plate],
    );
    if (existingPlate.rows[0] && existingPlate.rows[0].captain_id !== app.user_id) {
      throw new HttpError(409, 'plate_taken',
        `La plaque ${app.vehicle_plate} est déjà associée à un autre chauffeur.`);
    }
    await client.query(
      `UPDATE vehicles SET is_active = false WHERE captain_id = $1`,
      [app.user_id],
    );
    if (existingPlate.rows[0]) {
      await client.query(
        `UPDATE vehicles
            SET brand = $2, model = $3, year = $4, color = $5, seats = $6,
                vehicle_type = $7,
                is_active = true
          WHERE plate = $1 AND captain_id = $8`,
        [
          app.vehicle_plate,
          app.vehicle_brand,
          app.vehicle_model,
          app.vehicle_year,
          app.vehicle_color,
          app.vehicle_seats,
          vehicleType,
          app.user_id,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO vehicles
           (captain_id, plate, brand, model, year, color, seats, vehicle_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          app.user_id,
          app.vehicle_plate,
          app.vehicle_brand,
          app.vehicle_model,
          app.vehicle_year,
          app.vehicle_color,
          app.vehicle_seats,
          vehicleType,
        ],
      );
    }

    // Partner program: open the courier's one-per-life agency earning window
    // when the application carries a validated agency code. Best-effort — an
    // agency that got suspended between application and approval must not
    // block the captain's approval (the window is simply not opened).
    if (app.agency_code) {
      try {
        await attachCaptainToAgency(client, app.user_id, app.agency_code);
      } catch (e: any) {
        req.log?.warn?.(
          { applicationId: app.id, agencyCode: app.agency_code, err: e?.message },
          'agency link skipped at approval',
        );
      }
    }

    // Wallet at 0 + offline state
    await client.query(
      `INSERT INTO wallets (captain_id, balance_mru) VALUES ($1, 0)
       ON CONFLICT (captain_id) DO NOTHING`,
      [app.user_id],
    );
    await client.query(
      `INSERT INTO captain_state (captain_id, presence) VALUES ($1, 'offline')
       ON CONFLICT (captain_id) DO NOTHING`,
      [app.user_id],
    );

    const upd = await client.query(
      `UPDATE captain_applications
          SET status = 'approved',
              reviewed_by = $1,
              reviewed_at = now(),
              delivered_password = COALESCE($3, delivered_password),
              delivered_password_at = CASE WHEN $3 IS NULL THEN delivered_password_at ELSE now() END
        WHERE id = $2 RETURNING *`,
      [adminId, app.id, password],
    );
    return { application: upd.rows[0], password };
  });

  await audit({
    adminId,
    action: 'approve_application',
    targetType: 'captain_application',
    targetId: req.params.id!,
    after: result.application,
  });
  // `captainPassword` is non-null only when we just generated it (captain had
  // none). Shown ONCE to the admin so they can forward it to the new captain.
  res.json({ ...result.application, captainPassword: result.password });
});

/**
 * Send the application back to the captain for fixes.
 */
const correctionsBody = z.object({
  notes: z.string().min(5).max(2000),
});
adminRouter.post('/applications/:id/request-corrections', async (req, res) => {
  const adminId = req.user!.id;
  const body = correctionsBody.parse(req.body);
  const upd = await pool.query(
    `UPDATE captain_applications
        SET status = 'needs_correction',
            correction_notes = $1,
            reviewed_by = $2,
            reviewed_at = now()
      WHERE id = $3 AND status IN ('submitted','under_review')
      RETURNING *`,
    [body.notes, adminId, req.params.id],
  );
  if (!upd.rows[0]) {
    throw new HttpError(409, 'wrong_status', 'Cannot request corrections from current status');
  }
  await audit({
    adminId,
    action: 'request_corrections',
    targetType: 'captain_application',
    targetId: req.params.id!,
    after: upd.rows[0],
    reason: body.notes,
  });
  res.json(upd.rows[0]);
});

/**
 * Reject permanently.
 */
const rejectBody = z.object({
  reason: z.string().min(5).max(2000),
});
adminRouter.post('/applications/:id/reject', async (req, res) => {
  const adminId = req.user!.id;
  const body = rejectBody.parse(req.body);
  const upd = await pool.query(
    `UPDATE captain_applications
        SET status = 'rejected',
            rejection_reason = $1,
            reviewed_by = $2,
            reviewed_at = now()
      WHERE id = $3 AND status NOT IN ('approved', 'rejected')
      RETURNING *`,
    [body.reason, adminId, req.params.id],
  );
  if (!upd.rows[0]) {
    throw new HttpError(409, 'wrong_status', 'Cannot reject from current status');
  }
  await audit({
    adminId,
    action: 'reject_application',
    targetType: 'captain_application',
    targetId: req.params.id!,
    after: upd.rows[0],
    reason: body.reason,
  });
  res.json(upd.rows[0]);
});
