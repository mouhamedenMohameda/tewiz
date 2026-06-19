/**
 * Admin CRUD for the restaurants directory.
 *
 *   GET    /admin/restaurants              — list (incl. inactive)
 *   GET    /admin/restaurants/:id          — single (incl. inactive)
 *   POST   /admin/restaurants              — create one
 *   PATCH  /admin/restaurants/:id          — partial update
 *   DELETE /admin/restaurants/:id          — soft delete (sets is_active=false)
 *   POST   /admin/restaurants/bulk-import  — upsert an array
 *                                            (accepts both UpsertInput shape
 *                                            AND the OSM-shape produced by
 *                                            ingest-poi-nouakchott.ts)
 *
 * All endpoints inherit requireAuth + requireRole('admin') from the parent
 * adminRouter.
 */

import { Router } from 'express';
import { z } from 'zod';
import { withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import type { AuthedRequest } from '../../middleware/auth.js';
import { audit } from '../admin/audit.js';
import {
  fromOsmSeed,
  getRestaurant,
  listRestaurants,
  patchRestaurant,
  softDeleteRestaurant,
  upsertRestaurant,
  type UpsertInput,
} from './restaurants.service.js';

export const adminRestaurantsRouter = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const priceLevel = z.enum(['$', '$$', '$$$']);

/** Canonical (camelCase) upsert shape used by the admin UI. */
const upsertSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/, 'id must be lowercase slug').optional(),
  name: z.string().trim().min(1).max(120),
  nameFr: z.string().trim().max(120).nullable().optional(),
  nameAr: z.string().trim().max(120).nullable().optional(),
  nameEn: z.string().trim().max(120).nullable().optional(),
  zone: z.string().trim().max(80).nullable().optional(),
  cuisine: z.string().trim().max(40).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  priceLevel: priceLevel.nullable().optional(),
  rating: z.number().min(0).max(5).nullable().optional(),
  etaMin: z.number().int().min(0).max(600).nullable().optional(),
  etaMax: z.number().int().min(0).max(600).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  photo: z.string().trim().url().max(500).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  popularity: z.number().int().min(-100).max(10000).optional(),
  osmValue: z.string().trim().max(40).nullable().optional(),
  isActive: z.boolean().optional(),
});

/** PATCH: every field optional, name + lat + lng included. */
const patchSchema = upsertSchema.partial();

const listQuery = z.object({
  search: z.string().trim().min(1).max(60).optional(),
  cuisine: z.string().trim().min(1).max(40).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// List + single
// ---------------------------------------------------------------------------

adminRestaurantsRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);
  const { items, total } = await listRestaurants({
    search: q.search,
    cuisine: q.cuisine,
    // Admin defaults to showing inactive too (so they can undelete).
    includeInactive: q.includeInactive !== 'false',
    limit: q.limit,
    offset: q.offset,
  });
  res.json({ items, total, limit: q.limit, offset: q.offset });
});

adminRestaurantsRouter.get('/:id', async (req, res) => {
  const r = await getRestaurant(req.params.id!, true);
  if (!r) throw new HttpError(404, 'not_found', 'Restaurant introuvable');
  res.json(r);
});

// ---------------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------------

adminRestaurantsRouter.post('/', async (req, res) => {
  const adminId = (req as AuthedRequest).user.id;
  const body = upsertSchema.parse(req.body);

  const created = await withTx(async (client) => {
    return upsertRestaurant(body as UpsertInput, adminId, client);
  });

  await audit({
    adminId,
    action: 'restaurant_create',
    targetType: 'restaurant',
    targetId: created.id,
    after: created,
  });
  res.status(201).json(created);
});

adminRestaurantsRouter.patch('/:id', async (req, res) => {
  const adminId = (req as AuthedRequest).user.id;
  const body = patchSchema.parse(req.body);
  const before = await getRestaurant(req.params.id!, true);
  if (!before) throw new HttpError(404, 'not_found', 'Restaurant introuvable');

  const after = await patchRestaurant(req.params.id!, body, adminId);
  if (!after) throw new HttpError(404, 'not_found', 'Restaurant introuvable');

  await audit({
    adminId,
    action: 'restaurant_update',
    targetType: 'restaurant',
    targetId: after.id,
    before,
    after,
  });
  res.json(after);
});

adminRestaurantsRouter.delete('/:id', async (req, res) => {
  const adminId = (req as AuthedRequest).user.id;
  const before = await getRestaurant(req.params.id!, true);
  if (!before) throw new HttpError(404, 'not_found', 'Restaurant introuvable');

  const ok = await softDeleteRestaurant(req.params.id!, adminId);
  if (!ok) throw new HttpError(404, 'not_found', 'Restaurant introuvable');

  await audit({
    adminId,
    action: 'restaurant_soft_delete',
    targetType: 'restaurant',
    targetId: req.params.id!,
    before,
    after: { ...before, isActive: false },
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Bulk import
//
// Accepts BOTH shapes in the same array (some entries may have been hand-
// curated, others ripped from OSM). Each item is normalized then upserted in
// a transaction so a malformed entry rolls everything back.
// ---------------------------------------------------------------------------

const bulkBody = z.object({
  items: z.array(z.record(z.string(), z.unknown())).min(1).max(2000),
  /** When true, missing optional fields on existing rows are wiped instead
   *  of preserved. Defaults to false (additive merge). */
  overwriteNulls: z.boolean().optional(),
});

function looksLikeOsmShape(raw: Record<string, unknown>): boolean {
  return 'name_default' in raw || 'raw_tags' in raw || 'osm_value' in raw;
}

adminRestaurantsRouter.post('/bulk-import', async (req, res) => {
  const adminId = (req as AuthedRequest).user.id;
  const body = bulkBody.parse(req.body);

  const inputs: UpsertInput[] = [];
  const errors: Array<{ index: number; reason: string }> = [];

  body.items.forEach((raw, i) => {
    try {
      const normalized = looksLikeOsmShape(raw)
        ? fromOsmSeed(raw)
        : (upsertSchema.parse(raw) as UpsertInput);
      if (!Number.isFinite(normalized.lat) || !Number.isFinite(normalized.lng)) {
        errors.push({ index: i, reason: 'lat/lng missing or not numeric' });
        return;
      }
      if (!normalized.name?.trim()) {
        errors.push({ index: i, reason: 'name is empty' });
        return;
      }
      inputs.push(normalized);
    } catch (e) {
      errors.push({ index: i, reason: (e as Error).message.slice(0, 200) });
    }
  });

  if (inputs.length === 0) {
    throw new HttpError(400, 'no_valid_items', 'Aucune entrée valide à importer', { errors });
  }

  // The upsert SQL already does COALESCE-merge for nullable fields. The
  // overwriteNulls flag only matters once we want explicit wiping; for now
  // we expose the knob in the API but always behave additively. Documenting
  // here so it's easy to wire later without changing the public shape.
  void body.overwriteNulls;

  const result = await withTx(async (client) => {
    const upserted: Array<{ id: string; name: string }> = [];
    for (const input of inputs) {
      const r = await upsertRestaurant(input, adminId, client);
      upserted.push({ id: r.id, name: r.name });
    }
    return upserted;
  });

  await audit({
    adminId,
    action: 'restaurant_bulk_import',
    targetType: 'restaurant',
    targetId: 'bulk',
    after: { count: result.length, errors: errors.length },
  });

  res.json({
    imported: result.length,
    skipped: errors.length,
    errors,
    items: result,
  });
});
