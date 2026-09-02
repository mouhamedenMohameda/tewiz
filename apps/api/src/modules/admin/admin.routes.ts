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
import { adminTranslationsRouter } from './translations.routes.js';
import { adminReleasesRouter } from '../releases/admin-releases.routes.js';
import { adminDocumentRequirementsRouter } from './document-requirements.routes.js';
import { getDocumentTypesForStage } from './document-requirements.service.js';
import { adminStatsRouter } from './stats.routes.js';
import { adminVoiceRidesRouter } from '../voice-rides/admin-voice-rides.routes.js';
import { adminVoiceDatasetRouter } from '../voice-dataset/admin-voice-dataset.routes.js';
import { adminRestaurantsRouter } from '../restaurants/admin-restaurants.routes.js';
import { adminDishesRouter } from '../restaurants/admin-dishes.routes.js';
import { adminNotificationsRouter } from '../notifications/admin.routes.js';
import { adminPartnersRouter } from '../partners/admin-partners.routes.js';
import { adminCarpoolingRouter } from '../carpooling/admin-carpooling.routes.js';
import { adminListingsRouter } from '../listings/admin-listings.routes.js';
import { attachCaptainToAgency } from '../partners/partners.service.js';
import * as roadReports from '../reports/road-reports.service.js';
import { readTrack } from '../captain/track.service.js';
import {
  FreeDayGrantError,
  grantFreeDay,
  listCaptainFreeDaysForAdmin,
  revokeFreeDay,
} from '../rides/free-days.service.js';
import {
  getActiveSubscription,
  grantSubscription,
  listSubscriptions,
} from '../captain/subscription.service.js';
import { notifyCaptainFreeDays } from '../notifications/notifications.service.js';
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
// Editable i18n strings — super_admin only.
adminRouter.use('/translations', requireAdminRole(), adminTranslationsRouter);
// Hosted app builds (APK upload + history) — super_admin only.
adminRouter.use('/app-releases', requireAdminRole(), adminReleasesRouter);
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
// Voice-dataset corpus — ops reviews samples and manages the tester roster,
// dispatchers and support can look. Granting the tester flag is an access
// grant, and the export carries recorded voices, so writes stay with
// ops_manager (plus super_admin, which bypasses every check).
adminRouter.use(
  '/voice-dataset',
  requireAdminRoleByMethod(
    ['ops_manager', 'dispatcher', 'support'],
    ['ops_manager'],
  ),
  adminVoiceDatasetRouter,
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
// Dish catalog (chips) for the restaurant menu builder — same access as restaurants.
adminRouter.use(
  '/dishes',
  requireAdminRoleByMethod(
    ['ops_manager', 'dispatcher', 'kyc_reviewer', 'support'],
    ['ops_manager'],
  ),
  adminDishesRouter,
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

// Carpooling dashboard (listing + revenue stats) — ops/dispatch/finance/support view.
adminRouter.use(
  '/carpooling',
  requireAdminRoleByMethod(
    ['ops_manager', 'dispatcher', 'finance', 'support'],
    ['ops_manager', 'dispatcher'],
  ),
  adminCarpoolingRouter,
);

// Service listings ("annonces") dashboard + per-category config (enable/fee).
adminRouter.use(
  '/listings',
  requireAdminRoleByMethod(
    ['ops_manager', 'dispatcher', 'finance', 'support'],
    ['ops_manager', 'dispatcher'],
  ),
  adminListingsRouter,
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
 * presence + last known location. Used by the back-office "Captains" page
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
        u.full_name                             AS "fullName",
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
        v.plate, v.brand, v.model, v.color,
        -- Off-ride breadcrumb availability, so the UI can flag who has a
        -- recorded trail without probing /track for all 26 captains.
        COALESCE(tk.pts, 0)::int                AS track_points,
        tk.last_point                           AS track_last,
        -- Captain-reported background-location permission (migration 0068):
        -- 'denied' = won't ever emit, 'granted' = on, NULL = unknown/old app.
        cs.track_perm                           AS track_perm
       FROM users u
       LEFT JOIN captains c       ON c.user_id    = u.id
       LEFT JOIN captain_state cs ON cs.captain_id = u.id
       LEFT JOIN vehicles v       ON v.captain_id  = u.id AND v.is_active = true
       LEFT JOIN (
         SELECT captain_id, count(*) AS pts, max(recorded_at) AS last_point
           FROM captain_track
          WHERE recorded_at > now() - interval '24 hours'
          GROUP BY captain_id
       ) tk ON tk.captain_id = u.id
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

/**
 * GET /admin/captains/:id/track?from=<iso>&to=<iso>
 * Off-ride breadcrumb trail of one captain as an ordered point list, for
 * drawing the path (polyline) on the back-office map. Defaults to the last
 * 24 h when the window is omitted. Same viewer roles as the captains map.
 */
const trackQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
adminRouter.get('/captains/:id/track', requireAdminRole(
  'ops_manager', 'dispatcher', 'kyc_reviewer', 'finance', 'support',
), async (req, res) => {
  const captainId = String(req.params.id);
  const q = trackQuery.parse(req.query);
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 24 * 3600 * 1000);
  const points = await readTrack(captainId, from, to);
  res.json({ captainId, from: from.toISOString(), to: to.toISOString(), points });
});

/**
 * Manual commission-free days (migration 0086).
 *
 * The weekly draw is automatic, but ops needs a way to compensate a captain by
 * hand — a bad day on the road, a support gesture, a contest prize. A gift is
 * EXTRA: it does not consume the captain's weekly quota, so it never silently
 * cancels the day they were going to be drawn anyway.
 *
 * Reading is open to the same viewer roles as the captains map. Granting and
 * revoking cost real commission, so they are restricted to ops_manager and
 * finance, and every one of them is written to the audit log.
 */
const FREE_DAY_VIEWERS = [
  'ops_manager', 'dispatcher', 'kyc_reviewer', 'finance', 'support',
] as const;

adminRouter.get('/captains/:id/free-days', requireAdminRole(...FREE_DAY_VIEWERS),
  async (req, res) => {
    res.json(await listCaptainFreeDaysForAdmin(String(req.params.id)));
  });

const freeDayBody = z.object({
  // Plain calendar day. Mauritania is UTC+0, so this is unambiguous.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu: AAAA-MM-JJ'),
});

adminRouter.post('/captains/:id/free-days', requireAdminRole('ops_manager', 'finance'),
  async (req, res) => {
    const captainId = String(req.params.id);
    const { date } = freeDayBody.parse(req.body);
    let result;
    try {
      result = await grantFreeDay(captainId, date);
    } catch (err) {
      // A rejected date is the admin mistyping, not a server fault.
      if (err instanceof FreeDayGrantError) throw new HttpError(400, 'invalid_free_day', err.message);
      throw err;
    }

    if (result.granted) {
      await audit({
        adminId: req.user!.id,
        action: 'captain.free_day.grant',
        targetType: 'captain',
        targetId: captainId,
        before: null,
        after: { date },
      });
      // Tell the captain — this is the whole point of the gesture, and it
      // reaches captains running an old build too. Best-effort.
      void notifyCaptainFreeDays(captainId, [date]);
    }
    res.json(result);
  });

/**
 * Abonnement Captain (migration 0089).
 *
 * Lecture ouverte aux mêmes rôles que les jours gratuits. Offrir des jours
 * revient à renoncer à de la commission réelle, donc c'est réservé à
 * ops_manager / finance et tracé dans le journal d'audit.
 */
adminRouter.get('/captains/:id/subscription', requireAdminRole(...FREE_DAY_VIEWERS),
  async (req, res) => {
    const captainId = String(req.params.id);
    const [current, history] = await Promise.all([
      getActiveSubscription(captainId),
      listSubscriptions(captainId),
    ]);
    res.json({ current, history });
  });

const grantSubscriptionBody = z.object({
  // Des jours, pas une formule : offrir doit pouvoir être plus souple que
  // vendre (3 jours de dédommagement, 15 jours d'essai…).
  days: z.number().int().min(1).max(365),
});

adminRouter.post('/captains/:id/subscription', requireAdminRole('ops_manager', 'finance'),
  async (req, res) => {
    const captainId = String(req.params.id);
    const { days } = grantSubscriptionBody.parse(req.body);
    const result = await grantSubscription(captainId, days, req.user!.id);
    await audit({
      adminId: req.user!.id,
      action: 'captain.subscription.grant',
      targetType: 'captain',
      targetId: captainId,
      before: null,
      after: { days, endsAt: result.endsAt },
    });
    res.json(result);
  });

adminRouter.delete('/captains/:id/free-days/:date', requireAdminRole('ops_manager', 'finance'),
  async (req, res) => {
    const captainId = String(req.params.id);
    const { date } = freeDayBody.parse({ date: String(req.params.date) });
    let result;
    try {
      result = await revokeFreeDay(captainId, date);
    } catch (err) {
      if (err instanceof FreeDayGrantError) throw new HttpError(400, 'invalid_free_day', err.message);
      throw err;
    }
    if (result.revoked) {
      await audit({
        adminId: req.user!.id,
        action: 'captain.free_day.revoke',
        targetType: 'captain',
        targetId: captainId,
        before: { date },
        after: null,
      });
    }
    res.json(result);
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

// ─── Admin-editable application fields ───────────────────────────────────────
// Onboarding v2: the captain uploads photos + a WhatsApp number, and the
// reviewer transcribes the identity / vehicle data from the papers here before
// approving. These are the only columns the admin may write.
const ADMIN_EDITABLE_COLUMNS: Record<string, string> = {
  fullName: 'full_name',
  nni: 'nni',
  dateOfBirth: 'date_of_birth',
  vehiclePlate: 'vehicle_plate',
  vehicleBrand: 'vehicle_brand',
  vehicleModel: 'vehicle_model',
  vehicleYear: 'vehicle_year',
  vehicleColor: 'vehicle_color',
  vehicleSeats: 'vehicle_seats',
  vehicleType: 'vehicle_type',
  acceptsColis: 'accepts_colis',
  acceptsLongDistance: 'accepts_long_distance',
};

// `nullish()` so the admin can both set and clear a field. Empty strings are
// normalised to NULL below (a blank plate must be missing, not "").
const adminAppPatchBody = z.object({
  fullName: z.string().max(100).nullish(),
  nni: z.string().regex(/^\d{6,15}$/).nullish(),
  dateOfBirth: z.string().date().nullish(),
  vehiclePlate: z.string().max(20).nullish(),
  vehicleBrand: z.string().max(50).nullish(),
  vehicleModel: z.string().max(50).nullish(),
  vehicleYear: z.coerce.number().int().min(1980).max(new Date().getFullYear() + 1).nullish(),
  vehicleColor: z.string().max(30).nullish(),
  vehicleSeats: z.coerce.number().int().min(1).max(8).nullish(),
  vehicleType: z.enum(['car', 'moto']).nullish(),
  acceptsColis: z.boolean().optional(),
  acceptsLongDistance: z.boolean().optional(),
});

const ADMIN_APP_EDITABLE_STATUSES = ['draft', 'submitted', 'under_review', 'needs_correction'];

adminRouter.patch('/applications/:id', async (req, res) => {
  const adminId = req.user!.id;
  const body = adminAppPatchBody.parse(req.body);

  const cur = await pool.query(
    `SELECT * FROM captain_applications WHERE id = $1`,
    [req.params.id],
  );
  const before = cur.rows[0];
  if (!before) throw new HttpError(404, 'not_found', 'Application not found');
  if (!ADMIN_APP_EDITABLE_STATUSES.includes(before.status)) {
    throw new HttpError(409, 'not_editable',
      `Application is ${before.status} and cannot be edited`);
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    const col = ADMIN_EDITABLE_COLUMNS[k];
    if (!col || v === undefined) continue;
    // Blank text clears the column rather than storing an empty string.
    const value = typeof v === 'string' && v.trim() === '' ? null : v;
    values.push(value);
    fields.push(`${col} = $${values.length}`);
  }
  if (!fields.length) {
    res.json(before);
    return;
  }
  values.push(req.params.id);
  const upd = await pool.query(
    `UPDATE captain_applications SET ${fields.join(', ')}
      WHERE id = $${values.length} RETURNING *`,
    values,
  );
  await audit({
    adminId,
    action: 'edit_application',
    targetType: 'captain_application',
    targetId: req.params.id!,
    before,
    after: upd.rows[0],
  });
  res.json(upd.rows[0]);
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
 * GET /admin/captains/pending-online
 *
 * La file de la seconde revue. L'onboarding v3 coupe la validation en deux :
 * on accepte quelqu'un sur son permis et sa carte grise, puis on vérifie —
 * après coup, et seulement pour ceux qui ont continué — le véhicule qu'il
 * déclare et les documents qui conditionnent la mise en ligne.
 *
 * Le travail total baisse : les documents 'online' d'un candidat recalé sur
 * son permis ne sont jamais examinés, alors qu'ils l'étaient tous d'un bloc
 * avant.
 *
 * `carteGriseDocId` accompagne chaque ligne pour que l'opérateur confronte la
 * plaque saisie au document du dossier sans avoir à le chercher : c'est le
 * contrôle qui remplace la recopie manuelle d'avant.
 */
adminRouter.get('/captains/pending-online', async (_req, res) => {
  const onlineTypes = [...await getDocumentTypesForStage('online')];

  const r = await pool.query(
    `SELECT c.user_id                       AS captain_id,
            u.full_name,
            u.phone,
            v.id                            AS vehicle_id,
            v.plate, v.brand, v.model, v.year, v.color, v.seats,
            v.vehicle_type, v.verified_at, v.created_at AS vehicle_created_at,
            a.id                            AS application_id,
            cg.id                           AS carte_grise_doc_id,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'id', d.id, 'type', d.type, 'status', d.status,
                        'expiresAt', d.expires_at, 'rejectReason', d.reject_reason)
                      ORDER BY d.type)
                 FROM application_documents d
                WHERE d.application_id = a.id
                  AND d.type = ANY($1::document_type[])),
              '[]'::json)                   AS online_docs
       FROM captains c
       JOIN users u                ON u.id = c.user_id
       LEFT JOIN vehicles v        ON v.captain_id = c.user_id AND v.is_active = true
       LEFT JOIN captain_applications a ON a.id = c.application_id
       LEFT JOIN application_documents cg
              ON cg.application_id = a.id AND cg.type = 'carte_grise'
      WHERE c.status = 'active'
        AND (
          v.id IS NULL
          OR v.verified_at IS NULL
          OR EXISTS (
            SELECT 1 FROM application_documents d
             WHERE d.application_id = a.id
               AND d.type = ANY($1::document_type[])
               AND d.status <> 'approved'
          )
          OR EXISTS (
            SELECT 1 FROM application_documents d
             WHERE d.application_id = a.id
               AND d.type = ANY($1::document_type[])
               AND d.expires_at IS NOT NULL
               AND d.expires_at < now()
          )
          OR (
            SELECT count(*) FROM application_documents d
             WHERE d.application_id = a.id
               AND d.type = ANY($1::document_type[])
          ) < $2::int
        )
      ORDER BY v.created_at NULLS FIRST, u.full_name`,
    [onlineTypes, onlineTypes.length],
  );

  res.json(r.rows);
});

/**
 * POST /admin/vehicles/:id/verify
 * L'opérateur confirme que le véhicule déclaré correspond à la carte grise du
 * dossier. Dernier verrou avant la mise en ligne — toute modification
 * ultérieure de la saisie par le captain remet le véhicule dans cette file.
 */
adminRouter.post('/vehicles/:id/verify', async (req, res) => {
  const adminId = req.user!.id;
  const r = await pool.query(
    `UPDATE vehicles
        SET verified_at = now(), verified_by = $2
      WHERE id = $1 AND is_active = true
   RETURNING id, captain_id, plate, verified_at`,
    [req.params.id, adminId],
  );
  if (!r.rows[0]) {
    throw new HttpError(404, 'not_found', 'Véhicule actif introuvable');
  }
  await audit({
    adminId,
    action: 'vehicle.verify',
    targetType: 'vehicle',
    targetId: String(req.params.id),
    after: { verifiedAt: r.rows[0].verified_at, plate: r.rows[0].plate },
  });
  res.json(r.rows[0]);
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

    // Seuls les documents `stage = 'application'` conditionnent la validation :
    // ceux qui servent à décider si cette personne peut conduire. Ceux marqués
    // 'online' / 'payout' sont réclamés plus tard dans le parcours et ne
    // doivent pas retenir la décision. Les types requis ici doivent être
    // (a) déposés et (b) en statut 'approved'.
    const requiredTypes = await getDocumentTypesForStage('application');
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

    // Onboarding v3 : plus de saisie véhicule à la validation. La v2 la faisait
    // recopier par l'opérateur depuis la carte grise ; c'était déplacer la
    // corvée sur les ops, pas la supprimer. Le captain déclare son véhicule
    // lui-même une fois accepté (POST /captain/profile) — un opérateur
    // confronte alors sa saisie à la carte grise déjà au dossier avant de
    // l'autoriser à rouler (file /captains/pending-online).
    //
    // Les candidatures envoyées AVANT ce changement portent encore leurs
    // champs véhicule : on continue de créer leur véhicule ici (bloc plus bas,
    // conditionné à la présence de la plaque) pour ne pas laisser la file
    // d'attente du jour du déploiement à mi-chemin entre les deux parcours.

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
        'Le Captain doit avoir un numéro de téléphone avant validation.');
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

    // Copy the applicant's WhatsApp number onto the approved captain so ops can
    // reach them without joining back to the application. Runs after the insert
    // so it also refreshes the value on a re-approval (ON CONFLICT DO NOTHING).
    await client.query(
      `UPDATE captains SET whatsapp = $2 WHERE user_id = $1`,
      [app.user_id, app.whatsapp ?? null],
    );

    // Véhicule — uniquement pour les candidatures « v2 » qui portent encore une
    // plaque (voir la note à la validation). Les nouvelles arrivent sans, et
    // leur véhicule sera créé par le captain après acceptation ; il n'y a donc
    // rien à réconcilier ici.
    //
    // `plate` est UNIQUE globalement, donc un INSERT naïf explose à la
    // re-validation (quand la validation précédente a laissé une ligne) ou
    // quand la plaque est déjà rattachée à ce captain — ou pire, à un autre.
    // Réconciliation :
    //   - ligne existante avec cette plaque ET même captain → réactiver et
    //     rafraîchir les autres champs.
    //   - elle appartient à un AUTRE captain → 409 explicite, c'est une vraie
    //     collision de plaque.
    //   - sinon → désactiver les véhicules du captain et insérer une ligne.
    if (app.vehicle_plate) {
      const existingPlate = await client.query<{ captain_id: string }>(
        `SELECT captain_id FROM vehicles WHERE plate = $1 FOR UPDATE`,
        [app.vehicle_plate],
      );
      if (existingPlate.rows[0] && existingPlate.rows[0].captain_id !== app.user_id) {
        throw new HttpError(409, 'plate_taken',
          `La plaque ${app.vehicle_plate} est déjà associée à un autre Captain.`);
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
