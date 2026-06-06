import { Router } from 'express';
import { z } from 'zod';
import { type AuthedRequest } from '../../middleware/auth.js';
import * as svc from './home.service.js';

// Parent (captainRouter) already enforces auth + role=captain.
export const captainHomeRouter = Router();

const upsertBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().min(2).max(200),
  currentLat: z.number().min(-90).max(90),
  currentLng: z.number().min(-180).max(180),
});

captainHomeRouter.get('/', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const home = await svc.getHome(userId);
  if (!home) {
    res.status(204).end();
    return;
  }
  res.json(home);
});

captainHomeRouter.post('/', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const body = upsertBody.parse(req.body);
  res.json(await svc.createHome({ captainId: userId, ...body }));
});

captainHomeRouter.patch('/', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const body = upsertBody.parse(req.body);
  res.json(await svc.updateHome({ captainId: userId, ...body }));
});
