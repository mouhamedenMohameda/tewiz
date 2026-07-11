/**
 * Admin dish catalog — the "chips" used by the restaurant menu builder.
 *
 *   GET  /admin/dishes            — searchable catalog, sorted by usage
 *   POST /admin/dishes            — create a dish (dedup on normalized name)
 *
 * Inherits requireAuth + role guard from the parent adminRouter mount.
 */

import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../admin/audit.js';
import { createDish, listDishes } from './dishes.service.js';

export const adminDishesRouter = Router();

const listQuery = z.object({
  search: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

adminDishesRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);
  const items = await listDishes({ search: q.search, limit: q.limit });
  res.json({ items });
});

const createSchema = z.object({
  nameAr: z.string().trim().min(1).max(120),
  nameFr: z.string().trim().max(120).nullable().optional(),
  category: z.string().trim().max(40).nullable().optional(),
});

adminDishesRouter.post('/', async (req, res) => {
  const adminId = req.user!.id;
  const body = createSchema.parse(req.body);
  const dish = await createDish(body, adminId);

  await audit({
    adminId,
    action: 'dish_create',
    targetType: 'dish',
    targetId: dish.id,
    after: dish,
  });
  res.status(201).json(dish);
});
