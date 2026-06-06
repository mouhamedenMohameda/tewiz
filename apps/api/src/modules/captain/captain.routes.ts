import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, type AuthedRequest } from '../../middleware/auth.js';
import { upload } from '../../middleware/upload.js';
import { HttpError } from '../../middleware/error.js';
import * as svc from './application.service.js';
import { captainWalletRouter } from './wallet.routes.js';
import { captainStateRouter } from './state.routes.js';
import { captainRidesRouter } from '../rides/captain-rides.routes.js';
import { captainHomeRouter } from '../home/home.routes.js';
import { captainRecurringRouter } from '../recurring/captain.routes.js';
import { captainHeatmapRouter } from '../heatmap/heatmap.routes.js';

export const captainRouter = Router();
captainRouter.use(requireAuth, requireRole('captain'));

// Wallet, presence (online/offline + going-home), rides, home, recurring
// all inherit auth + role from parent.
captainRouter.use('/wallet', captainWalletRouter);
captainRouter.use('/state', captainStateRouter);
captainRouter.use('/rides', captainRidesRouter);
captainRouter.use('/home', captainHomeRouter);
captainRouter.use('/recurring-rides', captainRecurringRouter);
captainRouter.use('/heatmap', captainHeatmapRouter);

/**
 * POST /captain/applications
 * Returns the current open application, or creates a new draft.
 */
captainRouter.post('/applications', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await svc.getOrCreateDraft(userId));
});

/**
 * GET /captain/applications/me
 */
captainRouter.get('/applications/me', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const app = await svc.getMyApplication(userId);
  if (!app) throw new HttpError(404, 'no_application', 'No application');
  res.json(app);
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

captainRouter.patch('/applications/me', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
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
  upload.single('file'),
  async (req, res) => {
    if (!req.file) throw new HttpError(400, 'no_file', 'Missing "file" field');
    const userId = (req as AuthedRequest).user.id;
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
captainRouter.delete('/applications/me/documents/:docId', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  await svc.deleteDocument(userId, req.params.docId!);
  res.json({ ok: true });
});

/**
 * POST /captain/applications/me/submit
 * Validates completeness and moves to "submitted" status.
 */
captainRouter.post('/applications/me/submit', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await svc.submitApplication(userId));
});
