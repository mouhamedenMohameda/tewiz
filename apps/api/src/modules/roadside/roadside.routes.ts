import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import {
  PROBLEM_TYPES,
  acceptRequest,
  cancelRequest,
  createRequest,
  declineRequest,
  getCurrentForRequester,
  getProviderProfile,
  providerInbox,
  setProviderProfile,
  updateProviderStatus,
} from './roadside.service.js';

export const roadsideRouter = Router();

const createBody = z.object({
  problem_type: z.enum(PROBLEM_TYPES),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address_label: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
  photo_url: z.string().trim().max(500).optional(),
  radius_m: z.number().int().min(1000).max(50_000).optional(),
});

// --- Requester (any signed-in user) ---

roadsideRouter.post('/requests', requireAuth, async (req, res) => {
  const b = createBody.parse(req.body);
  const result = await createRequest(req.user!.id, {
    problemType: b.problem_type,
    lat: b.lat,
    lng: b.lng,
    addressLabel: b.address_label,
    note: b.note,
    photoUrl: b.photo_url,
    radiusM: b.radius_m,
  });
  res.status(201).json({ request: result.request, providersNotified: result.providersNotified });
});

roadsideRouter.get('/requests/current', requireAuth, async (req, res) => {
  const request = await getCurrentForRequester(req.user!.id);
  if (!request) {
    res.status(204).end();
    return;
  }
  res.json({ request });
});

roadsideRouter.post('/requests/:id/cancel', requireAuth, async (req, res) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
  const ok = await cancelRequest(String(req.params.id), req.user!.id, reason);
  if (!ok) throw new HttpError(404, 'request_not_found', 'Demande introuvable');
  res.json({ ok: true });
});

// --- Provider (captain) ---

const profileBody = z.object({
  offers_roadside: z.boolean(),
  specialties: z.array(z.enum(PROBLEM_TYPES)).max(PROBLEM_TYPES.length).default([]),
});

roadsideRouter.get('/provider', requireAuth, requireRole('captain'), async (req, res) => {
  res.json(await getProviderProfile(req.user!.id));
});

roadsideRouter.put('/provider', requireAuth, requireRole('captain'), async (req, res) => {
  const b = profileBody.parse(req.body);
  res.json(await setProviderProfile(req.user!.id, b.offers_roadside, b.specialties));
});

const inboxQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

roadsideRouter.get('/inbox', requireAuth, requireRole('captain'), async (req, res) => {
  const q = inboxQuery.parse(req.query);
  res.json({ requests: await providerInbox(req.user!.id, q.lat, q.lng) });
});

roadsideRouter.post('/requests/:id/accept', requireAuth, requireRole('captain'), async (req, res) => {
  const result = await acceptRequest(String(req.params.id), req.user!.id);
  res.json({
    request_id: result.requestId,
    problem_type: result.problemType,
    note: result.note,
    location: result.location,
    address_label: result.addressLabel,
    requester_name: result.requesterName,
    requester_phone: result.requesterPhone,
  });
});

roadsideRouter.post('/requests/:id/decline', requireAuth, requireRole('captain'), async (req, res) => {
  await declineRequest(String(req.params.id), req.user!.id);
  res.json({ ok: true });
});

const statusBody = z.object({ status: z.enum(['in_progress', 'completed']) });

roadsideRouter.post('/requests/:id/status', requireAuth, requireRole('captain'), async (req, res) => {
  const b = statusBody.parse(req.body);
  const ok = await updateProviderStatus(String(req.params.id), req.user!.id, b.status);
  if (!ok) throw new HttpError(404, 'request_not_found', 'Demande introuvable');
  res.json({ ok: true });
});
