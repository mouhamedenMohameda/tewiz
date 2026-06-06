import { Router } from 'express';
import { z } from 'zod';
import { type AuthedRequest } from '../../middleware/auth.js';
import * as svc from './favorites.service.js';

// Parent: riderRouter (auth + role=rider)
export const riderFavoritesRouter = Router();

const addBody = z.object({
  captainId: z.string().uuid(),
  nickname: z.string().min(1).max(50).optional(),
});

riderFavoritesRouter.get('/', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await svc.listMyFavorites(userId));
});

riderFavoritesRouter.post('/', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const body = addBody.parse(req.body);
  res.json(await svc.addFavorite(userId, body.captainId, body.nickname));
});

riderFavoritesRouter.delete('/:captainId', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  await svc.removeFavorite(userId, req.params.captainId!);
  res.json({ ok: true });
});
