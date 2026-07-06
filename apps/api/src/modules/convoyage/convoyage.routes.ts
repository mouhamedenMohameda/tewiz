import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import {
  acceptProposal,
  browseOpenJobs,
  cancelJob,
  createJob,
  getJobProposals,
  listMyJobs,
  listMyProposals,
  propose,
  withdrawProposal,
} from './convoyage.service.js';

export const convoyageRouter = Router();

// --- Client: jobs ---

const createBody = z.object({
  pickup_lat: z.number().min(-90).max(90).optional(),
  pickup_lng: z.number().min(-180).max(180).optional(),
  pickup_label: z.string().trim().min(2).max(200),
  dropoff_label: z.string().trim().min(2).max(200),
  vehicle_plate: z.string().trim().min(2).max(20),
  vehicle_model: z.string().trim().max(120).optional(),
  desired_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(500).optional(),
});

convoyageRouter.post('/jobs', requireAuth, async (req, res) => {
  const b = createBody.parse(req.body);
  const job = await createJob(req.user!.id, {
    pickupLat: b.pickup_lat,
    pickupLng: b.pickup_lng,
    pickupLabel: b.pickup_label,
    dropoffLabel: b.dropoff_label,
    vehiclePlate: b.vehicle_plate,
    vehicleModel: b.vehicle_model,
    desiredDate: b.desired_date,
    note: b.note,
  });
  res.status(201).json({ job });
});

convoyageRouter.get('/jobs/mine', requireAuth, async (req, res) => {
  res.json({ jobs: await listMyJobs(req.user!.id) });
});

convoyageRouter.get('/jobs/:id/proposals', requireAuth, async (req, res) => {
  res.json({ proposals: await getJobProposals(String(req.params.id), req.user!.id) });
});

const acceptBody = z.object({ proposal_id: z.string().uuid() });
convoyageRouter.post('/jobs/:id/accept', requireAuth, async (req, res) => {
  const b = acceptBody.parse(req.body);
  await acceptProposal(String(req.params.id), b.proposal_id, req.user!.id);
  res.json({ ok: true });
});

convoyageRouter.post('/jobs/:id/cancel', requireAuth, async (req, res) => {
  const ok = await cancelJob(String(req.params.id), req.user!.id);
  if (!ok) throw new HttpError(404, 'job_not_found', 'Demande introuvable');
  res.json({ ok: true });
});

// --- Provider: browse + propose ---

convoyageRouter.get('/open', requireAuth, async (req, res) => {
  res.json({ jobs: await browseOpenJobs(req.user!.id) });
});

const proposeBody = z.object({
  price_mru: z.number().int().min(0).max(10_000_000).optional(),
  note: z.string().trim().max(500).optional(),
});
convoyageRouter.post('/jobs/:id/propose', requireAuth, async (req, res) => {
  const b = proposeBody.parse(req.body);
  await propose(String(req.params.id), req.user!.id, { priceMru: b.price_mru, note: b.note });
  res.status(201).json({ ok: true });
});

convoyageRouter.post('/jobs/:id/withdraw', requireAuth, async (req, res) => {
  const ok = await withdrawProposal(String(req.params.id), req.user!.id);
  if (!ok) throw new HttpError(404, 'proposal_not_found', 'Proposition introuvable');
  res.json({ ok: true });
});

convoyageRouter.get('/proposals/mine', requireAuth, async (req, res) => {
  res.json({ proposals: await listMyProposals(req.user!.id) });
});
