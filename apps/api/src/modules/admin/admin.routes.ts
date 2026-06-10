import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../../db/pool.js';
import { requireAuth, requireRole, type AuthedRequest } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { defaultStorage } from '../storage/local-disk.js';
import { audit } from './audit.js';
import { adminTopupRouter } from './topup.routes.js';
import { adminRecurringRouter } from '../recurring/admin.routes.js';
import { adminJobsRouter } from '../jobs/admin-jobs.routes.js';
import { adminRidesRouter } from '../rides/admin-rides.routes.js';
import { adminUsersRouter } from './users.routes.js';
import * as roadReports from '../reports/road-reports.service.js';
import type { ApplicationStatus } from '@tewiz/shared-types';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

// Top-up review queue
adminRouter.use('/topups', adminTopupRouter);
// Recurring rides processor (triggered by cron in prod)
adminRouter.use('/recurring', adminRecurringRouter);
// Cron-triggered batch jobs (heatmap, expiry, etc.)
adminRouter.use('/jobs', adminJobsRouter);
// Admin books rides for phone-only passengers
adminRouter.use('/rides', adminRidesRouter);
// User management (create + regenerate password)
adminRouter.use('/users', adminUsersRouter);

// Admin can also drop abusive road reports.
adminRouter.delete('/road-reports/:id', async (req, res) => {
  res.json(await roadReports.adminRemove(req.params.id!));
});

// ─── Applications queue ──────────────────────────────────────────────────────

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
  const adminId = (req as AuthedRequest).user.id;
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
  const adminId = (req as AuthedRequest).user.id;
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
  const adminId = (req as AuthedRequest).user.id;

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

    const badDocs = await client.query(
      `SELECT type FROM application_documents
        WHERE application_id = $1 AND status <> 'approved'`,
      [req.params.id],
    );
    if ((badDocs.rowCount ?? 0) > 0) {
      throw new HttpError(400, 'docs_not_all_approved',
        'All documents must be approved first', {
          unapproved: badDocs.rows.map((r: { type: string }) => r.type),
        });
    }

    // Promote user role (they signed up as captain already, but be safe).
    await client.query(
      `UPDATE users SET role = 'captain' WHERE id = $1 AND role <> 'admin'`,
      [app.user_id],
    );

    // Create captain row
    await client.query(
      `INSERT INTO captains
         (user_id, application_id, status, accepts_colis, accepts_long_distance)
       VALUES ($1, $2, 'active', $3, $4)
       ON CONFLICT (user_id) DO NOTHING`,
      [app.user_id, app.id, app.accepts_colis, app.accepts_long_distance],
    );

    // Vehicle (unique active)
    await client.query(
      `UPDATE vehicles SET is_active = false WHERE captain_id = $1`,
      [app.user_id],
    );
    await client.query(
      `INSERT INTO vehicles
         (captain_id, plate, brand, model, year, color, seats)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        app.user_id,
        app.vehicle_plate,
        app.vehicle_brand,
        app.vehicle_model,
        app.vehicle_year,
        app.vehicle_color,
        app.vehicle_seats,
      ],
    );

    // Wallet at 0 + offline state
    await client.query(
      `INSERT INTO wallets (captain_id, balance_khoums) VALUES ($1, 0)
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
              reviewed_at = now()
        WHERE id = $2 RETURNING *`,
      [adminId, app.id],
    );
    return upd.rows[0];
  });

  await audit({
    adminId,
    action: 'approve_application',
    targetType: 'captain_application',
    targetId: req.params.id!,
    after: result,
  });
  res.json(result);
});

/**
 * Send the application back to the captain for fixes.
 */
const correctionsBody = z.object({
  notes: z.string().min(5).max(2000),
});
adminRouter.post('/applications/:id/request-corrections', async (req, res) => {
  const adminId = (req as AuthedRequest).user.id;
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
  const adminId = (req as AuthedRequest).user.id;
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
