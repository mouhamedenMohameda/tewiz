/**
 * Rider-facing read endpoints for the restaurants directory.
 *
 *   GET /rider/restaurants             — paged active list with filters
 *   GET /rider/restaurants/:id         — single active restaurant
 *
 * Mounted under riderRouter so the same requireAuth + requireRole('rider',
 * 'captain') gate as the rest of /rider/* applies. Guests get a 'rider' role
 * on their auto-issued token, so they can browse without manual signup.
 */

import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../middleware/error.js';
import { defaultStorage } from '../storage/local-disk.js';
import { getRestaurant, listRestaurants } from './restaurants.service.js';

export const riderRestaurantsRouter = Router();

const listQuery = z.object({
  search: z.string().trim().min(1).max(60).optional(),
  cuisine: z.string().trim().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

riderRestaurantsRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);
  const { items, total } = await listRestaurants({
    search: q.search,
    cuisine: q.cuisine,
    limit: q.limit,
    offset: q.offset,
  });
  res.json({ items, total, limit: q.limit, offset: q.offset });
});

riderRestaurantsRouter.get('/photos/:filename', async (req, res) => {
  const key = `restaurants/${req.params.filename}`;
  try {
    const buf = await defaultStorage.get(key);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch {
    throw new HttpError(404, 'not_found', 'Photo not found');
  }
});

riderRestaurantsRouter.get('/:id', async (req, res) => {
  const r = await getRestaurant(req.params.id!);
  if (!r) throw new HttpError(404, 'not_found', 'Restaurant introuvable');
  res.json(r);
});
