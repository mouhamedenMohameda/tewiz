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
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { upload } from '../../middleware/upload.js';
import type { AuthedRequest } from '../../middleware/auth.js';
import { audit } from '../admin/audit.js';
import { defaultStorage } from '../storage/local-disk.js';
import {
  fromOsmSeed,
  getRestaurant,
  listRestaurants,
  patchRestaurant,
  softDeleteRestaurant,
  upsertRestaurant,
  type UpsertInput,
} from './restaurants.service.js';
import { getRestaurantMenu, setRestaurantMenu } from './dishes.service.js';

export const adminRestaurantsRouter = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const priceLevel = z.enum(['$', '$$', '$$$']);

/**
 * Accepts either an absolute http(s) URL or a root-relative path such as the
 * `/admin/restaurants/photos/<uuid>.webp` value returned by our own
 * `POST /upload-photo` endpoint. Plain `.url()` rejects relative paths.
 */
const photoUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => v.startsWith('/') || z.string().url().safeParse(v).success,
    'URL invalide',
  );

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
  photo: photoUrl.nullable().optional(),
  photos: z.array(photoUrl).max(12).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  phones: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
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
  const adminId = req.user!.id;
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
  const adminId = req.user!.id;
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
  const adminId = req.user!.id;
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
// Menu (dish + price) for a restaurant
// ---------------------------------------------------------------------------

const menuBody = z.object({
  items: z
    .array(
      z.object({
        dishId: z.string().uuid(),
        priceMru: z.number().int().min(0).max(1_000_000),
        sortOrder: z.number().int().min(0).optional(),
        isAvailable: z.boolean().optional(),
      }),
    )
    .max(300),
});

adminRestaurantsRouter.get('/:id/menu', async (req, res) => {
  const r = await getRestaurant(req.params.id!, true);
  if (!r) throw new HttpError(404, 'not_found', 'Restaurant introuvable');
  const items = await getRestaurantMenu(req.params.id!);
  res.json({ items });
});

adminRestaurantsRouter.put('/:id/menu', async (req, res) => {
  const adminId = req.user!.id;
  const r = await getRestaurant(req.params.id!, true);
  if (!r) throw new HttpError(404, 'not_found', 'Restaurant introuvable');
  const body = menuBody.parse(req.body);

  const items = await withTx((client) => setRestaurantMenu(req.params.id!, body.items, client));

  await audit({
    adminId,
    action: 'restaurant_menu_update',
    targetType: 'restaurant',
    targetId: req.params.id!,
    after: { count: items.length },
  });
  res.json({ items });
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
  const adminId = req.user!.id;
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

  // Bulk import — there's no single target row, so targetId stays null.
  // The count / error tally is kept in `after` for the audit trail.
  await audit({
    adminId,
    action: 'restaurant_bulk_import',
    targetType: 'restaurant',
    targetId: null,
    after: { count: result.length, errors: errors.length },
  });

  res.json({
    imported: result.length,
    skipped: errors.length,
    errors,
    items: result,
  });
});

// ---------------------------------------------------------------------------
// Photo upload
// ---------------------------------------------------------------------------

adminRestaurantsRouter.post('/upload-photo', upload.single('file'), async (req, res) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw new HttpError(400, 'no_file', 'No image file provided');

  const key = `restaurants/${randomUUID()}.webp`;
  const optimized = await sharp(file.buffer)
    .resize(800, 800, { fit: 'cover', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  await defaultStorage.put(key, optimized, 'image/webp');

  // Return an ABSOLUTE URL to the PUBLIC (no-auth) photo route. It must be
  // absolute so the mobile app's <Image> and the admin <img> can load it
  // directly, and public so unauthenticated customers can see it. `req.protocol`
  // respects X-Forwarded-Proto because `trust proxy` is enabled.
  const filename = key.replace('restaurants/', '');
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({ url: `${base}/public/restaurant-photos/${filename}` });
});

adminRestaurantsRouter.get('/photos/:filename', async (req, res) => {
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
