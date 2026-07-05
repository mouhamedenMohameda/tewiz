import { Router } from 'express';
import { z } from 'zod';
import {
  getAdminStats,
  listAdminListings,
  listCategories,
  updateCategory,
} from './listings.service.js';

export const adminListingsRouter = Router();

adminListingsRouter.get('/', async (_req, res) => {
  const [listings, stats, categories] = await Promise.all([
    listAdminListings(),
    getAdminStats(),
    listCategories(false),
  ]);
  res.json({ listings, stats, categories });
});

adminListingsRouter.get('/categories', async (_req, res) => {
  const categories = await listCategories(false);
  res.json({ categories });
});

const categoryPatch = z.object({
  enabled: z.boolean().optional(),
  publication_fee_mru: z.number().int().min(0).max(1_000_000).optional(),
});

adminListingsRouter.put('/categories/:category', async (req, res) => {
  const body = categoryPatch.parse(req.body);
  const category = await updateCategory(String(req.params.category), {
    enabled: body.enabled,
    publicationFeeMru: body.publication_fee_mru,
  });
  res.json({ category });
});
