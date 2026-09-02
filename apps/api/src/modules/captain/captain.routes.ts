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
import { captainFreeDaysRouter } from './free-days.routes.js';
import { captainSubscriptionRouter } from './subscription.routes.js';
import * as terms from './terms.service.js';
import * as onboarding from './onboarding.service.js';
import { getPricingSettings } from '../admin/app-settings.service.js';

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
captainRouter.use('/free-days', requireRole('captain'), captainFreeDaysRouter);
captainRouter.use('/subscription', requireRole('captain'), captainSubscriptionRouter);

// /applications/* is accessible to rider OR captain — any signed-in user can apply.
const requireRiderOrCaptain = requireRole('rider', 'captain');

/**
 * GET /captain/terms/me
 * Current T&C version + whether this user has accepted it.
 */
captainRouter.get('/terms/me', requireRiderOrCaptain, async (req, res) => {
  res.json(await terms.getTermsStatus(req.user!.id));
});

/**
 * GET /captain/whatsapp-group
 * The Captains-only WhatsApp group invite link (migration 0085). Gated on
 * requireRole('captain') so only an approved captain ever receives it — it is
 * deliberately absent from the public /config payload. `url` is null when the
 * admin hasn't configured a link, and the app hides the button.
 */
captainRouter.get('/whatsapp-group', requireRole('captain'), async (_req, res) => {
  const s = await getPricingSettings();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ url: s.whatsappCaptainUrl });
});

/**
 * POST /captain/terms/accept
 * Records the consent. `version` is what the client displayed — we reject
 * anything but the current version so an outdated build can't consent on
 * behalf of text the captain never saw.
 */
const acceptTermsBody = z.object({
  version: z.string().min(1),
  locale: z.enum(['ar', 'fr', 'en', 'hs', 'ff', 'wo', 'snk']),
  appVersion: z.string().max(40).optional(),
  platform: z.string().max(20).optional(),
});

captainRouter.post('/terms/accept', requireRiderOrCaptain, async (req, res) => {
  const body = acceptTermsBody.parse(req.body);
  if (body.version !== terms.TERMS_VERSION) {
    throw new HttpError(
      409, 'terms_version_mismatch',
      'A newer version of the terms is available. Please update the app.',
      { current: terms.TERMS_VERSION },
    );
  }
  res.json(await terms.acceptTerms(req.user!.id, {
    locale: body.locale,
    appVersion: body.appVersion ?? null,
    platform: body.platform ?? null,
  }));
});

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
  whatsapp: z.string().regex(/^\+?\d{8,15}$/).optional(),
  vehiclePlate: z.string().min(2).max(20).optional(),
  vehicleBrand: z.string().min(1).max(50).optional(),
  vehicleModel: z.string().min(1).max(50).optional(),
  vehicleYear: z.coerce.number().int().min(1980).max(new Date().getFullYear() + 1).optional(),
  vehicleColor: z.string().min(2).max(30).optional(),
  vehicleSeats: z.coerce.number().int().min(1).max(8).optional(),
  vehicleType: z.enum(['car', 'moto']).optional(),
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
 * GET /captain/onboarding
 * Ce qu'il reste à fournir après acceptation : véhicule déclaré + vérifié,
 * documents 'online' (pour rouler) et 'payout' (pour retirer). L'app captain
 * s'en sert pour afficher la carte de complétion et griser l'interrupteur
 * « en ligne » avec la bonne raison.
 */
captainRouter.get('/onboarding', requireRole('captain'), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await onboarding.getOnboardingStatus(req.user!.id));
});

/**
 * POST /captain/profile
 * Le captain déclare son nom et son véhicule (onboarding v3 : ce n'est plus
 * saisi avant l'acceptation, ni recopié par un opérateur). Repasse le véhicule
 * en « à vérifier » — un opérateur confronte la saisie à la carte grise du
 * dossier avant d'autoriser la mise en ligne.
 */
const profileBody = z.object({
  fullName: z.string().min(2).max(100),
  plate: z.string().min(2).max(20),
  brand: z.string().min(1).max(50),
  model: z.string().min(1).max(50),
  year: z.coerce.number().int().min(1980).max(new Date().getFullYear() + 1),
  color: z.string().min(2).max(30),
  seats: z.coerce.number().int().min(1).max(8),
  vehicleType: z.enum(['car', 'moto']),
});

captainRouter.post('/profile', requireRole('captain'), async (req, res) => {
  const body = profileBody.parse(req.body);
  if (body.vehicleType === 'moto' && body.seats > 2) {
    throw new HttpError(400, 'seats_invalid', 'Une moto ne peut pas avoir plus de 2 places.');
  }
  res.json(await onboarding.declareProfile(req.user!.id, body));
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
