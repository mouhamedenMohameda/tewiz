import { Router } from 'express';
import { z } from 'zod';
import * as svc from './heatmap.service.js';

// Parent: captainRouter (auth + role=captain)
export const captainHeatmapRouter = Router();

const query = z.object({
  minLat: z.coerce.number().optional(),
  maxLat: z.coerce.number().optional(),
  minLng: z.coerce.number().optional(),
  maxLng: z.coerce.number().optional(),
});

captainHeatmapRouter.get('/', async (req, res) => {
  const q = query.parse(req.query);
  res.json(await svc.listCells(q));
});
