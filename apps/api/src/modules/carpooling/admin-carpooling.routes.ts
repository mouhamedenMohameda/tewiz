import { Router } from 'express';
import { z } from 'zod';
import { getAdminStats, listAdminTrips } from './carpooling.service.js';

export const adminCarpoolingRouter = Router();

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(300),
});

adminCarpoolingRouter.get('/trips', async (req, res) => {
  const q = listQuery.parse(req.query);
  const trips = await listAdminTrips(q.limit);
  res.json({ trips });
});

adminCarpoolingRouter.get('/stats', async (_req, res) => {
  const stats = await getAdminStats();
  res.json(stats);
});
