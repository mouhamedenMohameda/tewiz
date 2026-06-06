import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, type AuthedRequest } from '../../middleware/auth.js';
import * as svc from './road-reports.service.js';

export const roadReportsRouter = Router();
// Reports are made and consumed by both riders and captains.
roadReportsRouter.use(requireAuth, requireRole('rider', 'captain'));

const listQuery = z.object({
  minLat: z.coerce.number().optional(),
  maxLat: z.coerce.number().optional(),
  minLng: z.coerce.number().optional(),
  maxLng: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(500).default(200),
});
roadReportsRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);
  res.json(await svc.listActive(q));
});

const createBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(20).max(500).optional(),
  reason: z.enum(['sand', 'flood', 'construction', 'police_checkpoint', 'accident', 'protest', 'other']),
  note: z.string().min(2).max(500).optional(),
});
roadReportsRouter.post('/', async (req, res) => {
  const user = (req as AuthedRequest).user;
  const body = createBody.parse(req.body);
  res.json(await svc.createReport({
    reporterId: user.id,
    reporterRole: user.role as 'rider' | 'captain',
    ...body,
  }));
});

const voteBody = z.object({ confirm: z.boolean() });
roadReportsRouter.post('/:id/vote', async (req, res) => {
  const user = (req as AuthedRequest).user;
  const body = voteBody.parse(req.body);
  res.json(await svc.voteReport({
    reportId: req.params.id!,
    userId: user.id,
    vote: body.confirm ? 1 : -1,
  }));
});
