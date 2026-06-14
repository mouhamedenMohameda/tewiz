import { Router } from 'express';
import { z } from 'zod';
import { type AuthedRequest } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import * as voiceRides from './voice-rides.service.js';
import { searchPois } from './poi.service.js';

// Parent (adminRouter) enforces requireAuth + requireRole('admin').
export const adminVoiceRidesRouter = Router();

// ─── Queue + history ─────────────────────────────────────────────────────────

const listQuery = z.object({
  status: z
    .enum(['pending', 'confirmed', 'rejected', 'cancelled', 'all'])
    .default('pending'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /admin/voice-rides?status=pending
 * Drives the 5 s-polled dispatcher queue (oldest-first when pending).
 */
adminVoiceRidesRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);
  res.json(await voiceRides.listVoiceRideRequestsForAdmin(q));
});

// ─── POI search (Phase 1.4) ──────────────────────────────────────────────────

const poiQuery = z.object({
  q: z.string().min(2).max(120),
  // "lng,lat" bias for the external geocoder.
  proximity: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(15).optional(),
});

/**
 * GET /admin/voice-rides/poi-search?q=...&proximity=lng,lat
 * Local corpus (voiceloc_pois) first, then a Google/Nominatim complement.
 * Used by the map sidebar to place pickup/dropoff pins.
 */
adminVoiceRidesRouter.get('/poi-search', async (req, res) => {
  const q = poiQuery.parse(req.query);
  res.json(await searchPois(q.q, { proximity: q.proximity, limit: q.limit }));
});

// ─── Detail + audio ──────────────────────────────────────────────────────────

adminVoiceRidesRouter.get('/:id', async (req, res) => {
  res.json(await voiceRides.getVoiceRideRequestForAdmin(req.params.id!));
});

/**
 * GET /admin/voice-rides/:id/audio
 * Streams the recorded m4a back for in-browser playback.
 */
adminVoiceRidesRouter.get('/:id/audio', async (req, res) => {
  const { buffer, mime } = await voiceRides.getVoiceRideAudio(req.params.id!);
  res.setHeader('Content-Type', mime || 'audio/m4a');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Accept-Ranges', 'none');
  res.send(buffer);
});

// ─── Process: confirm / reject ───────────────────────────────────────────────

const pinSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().min(1).max(200).optional(),
  placeId: z.string().max(300).optional(),
  name: z.string().max(200).optional(),
  source: z.enum(['local', 'google', 'nominatim']).optional(),
  types: z.array(z.string().max(60)).max(20).optional(),
});

const confirmBody = z.object({
  pickup: pinSchema,
  dropoff: pinSchema,
  paymentMethod: z.enum(['cash', 'wallet']).default('cash'),
});

/**
 * POST /admin/voice-rides/:id/confirm
 * Creates the ride from the dispatcher's pins, links it, auto-seeds Google
 * picks into the corpus, and pushes the rider.
 */
adminVoiceRidesRouter.post('/:id/confirm', async (req, res) => {
  const adminId = (req as AuthedRequest).user.id;
  const body = confirmBody.parse(req.body);
  res.json(
    await voiceRides.confirmVoiceRideRequest({
      id: req.params.id!,
      adminId,
      pickup: body.pickup,
      dropoff: body.dropoff,
      paymentMethod: body.paymentMethod,
    }),
  );
});

const rejectBody = z.object({ reason: z.string().min(2).max(500) });

/**
 * POST /admin/voice-rides/:id/reject
 */
adminVoiceRidesRouter.post('/:id/reject', async (req, res) => {
  const adminId = (req as AuthedRequest).user.id;
  const body = rejectBody.parse(req.body);
  if (!body.reason) {
    throw new HttpError(400, 'reason_required', 'A reject reason is required');
  }
  res.json(
    await voiceRides.rejectVoiceRideRequest({ id: req.params.id!, adminId, reason: body.reason }),
  );
});
