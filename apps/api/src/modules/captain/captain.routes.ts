import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, type AuthedRequest } from '../../middleware/auth.js';
import { upload } from '../../middleware/upload.js';
import { HttpError } from '../../middleware/error.js';
import { pool } from '../../db/pool.js';
import * as svc from './application.service.js';
import { captainWalletRouter } from './wallet.routes.js';
import { captainStateRouter } from './state.routes.js';
import { captainRidesRouter } from '../rides/captain-rides.routes.js';
import { captainHomeRouter } from '../home/home.routes.js';
import { captainRecurringRouter } from '../recurring/captain.routes.js';
import { captainHeatmapRouter } from '../heatmap/heatmap.routes.js';
import { captainPreferencesRouter } from './preferences.routes.js';
import { captainBonusRouter } from './bonus.routes.js';

export const captainRouter = Router();
captainRouter.use(requireAuth);

// Captain-only sub-routers (require approved captain role).
captainRouter.use('/wallet', requireRole('captain'), captainWalletRouter);
captainRouter.use('/state', requireRole('captain'), captainStateRouter);
captainRouter.use('/rides', requireRole('captain'), captainRidesRouter);
captainRouter.use('/home', requireRole('captain'), captainHomeRouter);
captainRouter.use('/recurring-rides', requireRole('captain'), captainRecurringRouter);
captainRouter.use('/heatmap', requireRole('captain'), captainHeatmapRouter);
captainRouter.use('/preferences', requireRole('captain'), captainPreferencesRouter);
captainRouter.use('/bonus', requireRole('captain'), captainBonusRouter);

// /applications/* is accessible to rider OR captain — any signed-in user can apply.
const requireRiderOrCaptain = requireRole('rider', 'captain');

/**
 * POST /captain/applications
 * Returns the current open application, or creates a new draft.
 */
captainRouter.post('/applications', requireRiderOrCaptain, async (req, res) => {
  const userId = req.user!.id;
  res.json(await svc.getOrCreateDraft(userId));
});

/**
 * GET /captain/applications/me
 */
captainRouter.get('/applications/me', requireRiderOrCaptain, async (req, res) => {
  const userId = req.user!.id;
  const app = await svc.getMyApplication(userId);
  res.json(app ?? null);
});

/**
 * PATCH /captain/applications/me
 * Update personal + vehicle info.
 */
const updateBody = z.object({
  fullName: z.string().min(2).max(100).optional(),
  nni: z.string().regex(/^\d{6,15}$/).optional(),
  dateOfBirth: z.string().date().optional(),
  addressLabel: z.string().min(2).max(200).optional(),
  emergencyContactName: z.string().min(2).max(100).optional(),
  emergencyContactPhone: z.string().optional(),
  vehiclePlate: z.string().min(2).max(20).optional(),
  vehicleBrand: z.string().min(1).max(50).optional(),
  vehicleModel: z.string().min(1).max(50).optional(),
  vehicleYear: z.coerce.number().int().min(1980).max(new Date().getFullYear() + 1).optional(),
  vehicleColor: z.string().min(2).max(30).optional(),
  vehicleSeats: z.coerce.number().int().min(1).max(8).optional(),
  acceptsColis: z.boolean().optional(),
  acceptsLongDistance: z.boolean().optional(),
});

captainRouter.patch('/applications/me', requireRiderOrCaptain, async (req, res) => {
  const userId = req.user!.id;
  const body = updateBody.parse(req.body);
  res.json(await svc.updateMyApplication(userId, body));
});

/**
 * POST /captain/applications/me/documents (multipart)
 * Field: file (image), type (DocumentType), expiresAt (for time-bound docs).
 */
const docTypeSchema = z.enum([
  'selfie', 'nni_front', 'nni_back',
  'license_front', 'license_back',
  'carte_grise', 'assurance', 'vignette', 'visite_technique',
  'car_front', 'car_back', 'car_left', 'car_right', 'car_interior',
]);

const uploadBody = z.object({
  type: docTypeSchema,
  expiresAt: z.string().date().optional(),
});

captainRouter.post(
  '/applications/me/documents',
  requireRiderOrCaptain,
  upload.single('file'),
  async (req, res) => {
    if (!req.file) throw new HttpError(400, 'no_file', 'Missing "file" field');
    const userId = req.user!.id;
    const body = uploadBody.parse(req.body);
    const doc = await svc.uploadDocument(userId, {
      type: body.type,
      expiresAt: body.expiresAt ?? null,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });
    res.json(doc);
  },
);

/**
 * DELETE /captain/applications/me/documents/:docId
 */
captainRouter.delete('/applications/me/documents/:docId', requireRiderOrCaptain, async (req, res) => {
  const userId = req.user!.id;
  await svc.deleteDocument(userId, String(req.params.docId));
  res.json({ ok: true });
});

/**
 * POST /captain/applications/me/submit
 * Validates completeness and moves to "submitted" status.
 */
captainRouter.post('/applications/me/submit', requireRiderOrCaptain, async (req, res) => {
  const userId = req.user!.id;
  res.json(await svc.submitApplication(userId));
});

/**
 * GET /captain/applications/me/credentials
 * Returns the one-shot login credentials generated at approval time (phone +
 * plain password) so the freshly approved captain can copy them and re-login.
 * Returns null once acknowledged or when none were generated.
 */
captainRouter.get('/applications/me/credentials', requireRiderOrCaptain, async (req, res) => {
  const userId = req.user!.id;
  const r = await pool.query<{ phone: string | null; delivered_password: string | null }>(
    `SELECT u.phone, a.delivered_password
       FROM captain_applications a
       JOIN users u ON u.id = a.user_id
      WHERE a.user_id = $1
        AND a.status = 'approved'
        AND a.delivered_password IS NOT NULL
      ORDER BY a.reviewed_at DESC NULLS LAST
      LIMIT 1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row || !row.delivered_password || !row.phone) {
    res.json(null);
    return;
  }
  res.json({ phone: row.phone, password: row.delivered_password });
});

/**
 * POST /captain/applications/me/credentials/ack
 * Wipes the plain password once the captain has copied/memorized it. Idempotent.
 */
captainRouter.post('/applications/me/credentials/ack', requireRiderOrCaptain, async (req, res) => {
  const userId = req.user!.id;
  await pool.query(
    `UPDATE captain_applications
        SET delivered_password = NULL
      WHERE user_id = $1 AND delivered_password IS NOT NULL`,
    [userId],
  );
  res.json({ ok: true });
});
