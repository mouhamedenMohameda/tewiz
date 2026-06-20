/**
 * Shared helpers for the restaurants directory (rider read endpoints +
 * admin CRUD + bulk-import). All SQL touching the `restaurants` table goes
 * through here so the row → DTO mapping stays consistent.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';

/** Public DTO returned to the mobile app and admin web. */
export interface RestaurantDto {
  id: string;
  name: string;
  nameFr: string | null;
  nameAr: string | null;
  nameEn: string | null;
  zone: string | null;
  cuisine: string | null;
  tags: string[];
  priceLevel: '$' | '$$' | '$$$' | null;
  rating: number | null;
  etaMin: number | null;
  etaMax: number | null;
  description: string | null;
  photo: string | null;
  address: string | null;
  lat: number;
  lng: number;
  popularity: number;
  osmValue: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RestaurantRow {
  id: string;
  name: string;
  name_fr: string | null;
  name_ar: string | null;
  name_en: string | null;
  zone: string | null;
  cuisine: string | null;
  tags: string[] | null;
  price_level: string | null;
  rating: string | number | null; // numeric comes back as string from pg
  eta_min: number | null;
  eta_max: number | null;
  description: string | null;
  photo: string | null;
  address: string | null;
  lat: number;
  lng: number;
  popularity: number;
  osm_value: string | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

function toDto(r: RestaurantRow): RestaurantDto {
  return {
    id: r.id,
    name: r.name,
    nameFr: r.name_fr,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    zone: r.zone,
    cuisine: r.cuisine,
    tags: r.tags ?? [],
    priceLevel: (r.price_level as RestaurantDto['priceLevel']) ?? null,
    rating: r.rating == null ? null : Number(r.rating),
    etaMin: r.eta_min,
    etaMax: r.eta_max,
    description: r.description,
    photo: r.photo,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    popularity: r.popularity,
    osmValue: r.osm_value,
    isActive: r.is_active,
    createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : r.updated_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Slug — derive a URL-safe id from a name when the admin doesn't supply one.
// ---------------------------------------------------------------------------

/**
 * Lowercase + strip diacritics + replace non-alphanumeric runs with '-'.
 * Falls back to a short random suffix if the resulting string is empty
 * (e.g. an Arabic-only name).
 */
export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (base) return base;
  return `r-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Guarantee a slug is unique against the existing rows. Appends -2, -3, …
 * until free. Cheap loop — restaurants is a small table.
 */
export async function uniqueSlug(client: PoolClient, candidate: string, excludeId?: string): Promise<string> {
  let slug = candidate;
  let n = 1;
  for (;;) {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM restaurants WHERE id = $1 AND ($2::text IS NULL OR id <> $2)`,
      [slug, excludeId ?? null],
    );
    if (!r.rows[0]) return slug;
    n += 1;
    slug = `${candidate}-${n}`;
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface ListOptions {
  search?: string;
  cuisine?: string;
  /** Admin uses includeInactive=true to also see hidden rows. */
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}

export async function listRestaurants(opts: ListOptions = {}): Promise<{
  items: RestaurantDto[];
  total: number;
}> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (!opts.includeInactive) where.push('is_active = true');

  if (opts.cuisine) {
    params.push(opts.cuisine);
    where.push(`cuisine = $${params.length}`);
  }
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim().toLowerCase()}%`);
    where.push(
      `(lower(name) LIKE $${params.length}
        OR lower(coalesce(name_fr,'')) LIKE $${params.length}
        OR lower(coalesce(name_ar,'')) LIKE $${params.length}
        OR lower(coalesce(zone,'')) LIKE $${params.length})`,
    );
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  params.push(limit, offset);

  const { rows } = await pool.query<RestaurantRow>(
    `SELECT * FROM restaurants
       ${whereSql}
       ORDER BY popularity DESC, name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const totalParams = params.slice(0, params.length - 2);
  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM restaurants ${whereSql}`,
    totalParams,
  );

  return {
    items: rows.map(toDto),
    total: Number(countRows[0]?.count ?? 0),
  };
}

export async function getRestaurant(id: string, includeInactive = false): Promise<RestaurantDto | null> {
  const { rows } = await pool.query<RestaurantRow>(
    `SELECT * FROM restaurants WHERE id = $1 ${includeInactive ? '' : 'AND is_active = true'}`,
    [id],
  );
  return rows[0] ? toDto(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Upsert input — the canonical shape used by both single create/update and
// bulk-import. Most fields are optional; only name + lat + lng are required.
// ---------------------------------------------------------------------------

export interface UpsertInput {
  id?: string;
  name: string;
  nameFr?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
  zone?: string | null;
  cuisine?: string | null;
  tags?: string[];
  priceLevel?: '$' | '$$' | '$$$' | null;
  rating?: number | null;
  etaMin?: number | null;
  etaMax?: number | null;
  description?: string | null;
  photo?: string | null;
  address?: string | null;
  lat: number;
  lng: number;
  popularity?: number;
  osmValue?: string | null;
  rawTags?: Record<string, unknown>;
  isActive?: boolean;
}

/**
 * Map the free-form `cuisine` OSM tag (or osm_value/name fallback) to the
 * narrow set of buckets the mobile filter chips understand. OSM uses
 * semicolons to multi-tag ("pizza;italian"); we walk the list and keep the
 * first match. Returning null is safe — the mobile UI shows the row under
 * the "Tout" chip and won't crash filtering.
 */
function inferCuisine(
  osmValue: string | null,
  rawTags: Record<string, unknown>,
  name: string,
): string | null {
  const cuisineRaw = (rawTags['cuisine'] as string | undefined)?.toLowerCase() ?? '';
  const tokens = cuisineRaw.split(/[;,]+/).map((s) => s.trim()).filter(Boolean);

  // Bucket lookup — OSM tags on the left, our chip key on the right.
  const TAG_TO_BUCKET: Record<string, string> = {
    pizza: 'pizza', pizzeria: 'pizza', italian: 'pizza', pasta: 'pizza',

    burger: 'burger', burgers: 'burger', american: 'burger',
    sandwich: 'burger', hot_dog: 'burger',

    lebanese: 'libanais', syrian: 'libanais', levantine: 'libanais',
    shawarma: 'libanais', kebab: 'libanais', turkish: 'libanais',

    chinese: 'asiatique', japanese: 'asiatique', korean: 'asiatique',
    asian: 'asiatique', sushi: 'asiatique', thai: 'asiatique',
    vietnamese: 'asiatique', indian: 'asiatique', noodle: 'asiatique',
    ramen: 'asiatique',

    mauritanian: 'mauritanien', moroccan: 'mauritanien',
    north_african: 'mauritanien', african: 'mauritanien',
    arab: 'mauritanien', arabic: 'mauritanien', regional: 'mauritanien',
    couscous: 'mauritanien', tagine: 'mauritanien', tajine: 'mauritanien',

    bbq: 'grillades', grill: 'grillades', steak_house: 'grillades',
    barbecue: 'grillades', meat: 'grillades',

    coffee_shop: 'cafe', tea: 'cafe', cafe: 'cafe',

    dessert: 'patisserie', ice_cream: 'patisserie',
    cake: 'patisserie', pastry: 'patisserie', donut: 'patisserie',
    chocolate: 'patisserie', french: 'patisserie',
  };

  for (const t of tokens) {
    if (TAG_TO_BUCKET[t]) return TAG_TO_BUCKET[t];
  }

  // osm_value fallback — captures rows that don't carry a cuisine tag.
  switch (osmValue) {
    case 'cafe': return 'cafe';
    case 'fast_food': return 'burger';     // dominant in MR (burger + shawarma)
    case 'ice_cream': return 'patisserie';
    case 'bakery':
    case 'pastry':
    case 'confectionery': return 'patisserie';
    case 'pub':
    case 'bar':
    case 'biergarten': return null;        // no chip for these; surface in "Tout"
    case 'food_court': return null;
    case 'restaurant': break;              // fall through to name heuristic
  }

  // Last-chance name heuristic — catches "Pizza Lina", "Burger King", etc.
  // Conservative: only triggers on a clean keyword in the name.
  const lo = name.toLowerCase();
  if (/\bpizza|pizzeria/.test(lo)) return 'pizza';
  if (/\bburger|sandwich/.test(lo)) return 'burger';
  if (/\bcafé|cafe|coffee\b/.test(lo)) return 'cafe';
  if (/\bgrill|brochette|méchoui|mechoui/.test(lo)) return 'grillades';
  if (/\bshawarma|chawarma|libanais/.test(lo)) return 'libanais';
  if (/\bchinois|chinese|sushi|asiatique|wok|nouille/.test(lo)) return 'asiatique';
  if (/\bpâtisserie|patisserie|boulangerie|bakery/.test(lo)) return 'patisserie';

  return null;
}

/**
 * Normalize the OSM-shape JSON produced by the POI ingester
 * (apps/voice-location-api/scripts/ingest-poi-nouakchott.ts) into the
 * UpsertInput shape used by the bulk-import endpoint.
 *
 * Behavior:
 *   - cuisine is inferred from raw_tags.cuisine, then osm_value, then a
 *     conservative name heuristic. Stays null when nothing matches so the
 *     mobile filter chips reflect honest data.
 *   - tags stays empty; the admin enriches later.
 *   - photo / description / rating left null.
 *   - name picks name_fr → name → name_default → name_en → name_ar so the
 *     rider screen shows a clean French name when available.
 */
export function fromOsmSeed(raw: Record<string, unknown>): UpsertInput {
  const lat = Number(raw['lat']);
  const lng = Number(raw['lng']);
  const nameDefault = String(raw['name_default'] ?? raw['name'] ?? '').trim();
  const nameFr = (raw['name_fr'] as string | undefined)?.trim() || null;
  const nameAr = (raw['name_ar'] as string | undefined)?.trim() || null;
  const nameEn = (raw['name_en'] as string | undefined)?.trim() || null;
  const display = (nameFr || nameDefault || nameEn || nameAr || '').replace(/\s+/g, ' ').trim();

  const osmValue = (raw['osm_value'] as string | undefined) ?? null;
  const rawTags = (raw['raw_tags'] as Record<string, unknown> | undefined) ?? {};
  const cuisine = inferCuisine(osmValue, rawTags, display || nameDefault);

  return {
    name: display || nameDefault || 'Sans nom',
    nameFr,
    nameAr,
    nameEn,
    lat,
    lng,
    osmValue,
    cuisine,
    popularity: Number(raw['popularity'] ?? 0) || 0,
    rawTags,
  };
}

export async function upsertRestaurant(
  input: UpsertInput,
  actorId: string | null,
  client?: PoolClient,
): Promise<RestaurantDto> {
  const exec = client ?? pool;
  const id = input.id ?? (client ? await uniqueSlug(client, slugify(input.name)) : await uniqueSlugStandalone(input.name));

  const { rows } = await exec.query<RestaurantRow>(
    `INSERT INTO restaurants
       (id, name, name_fr, name_ar, name_en, zone, cuisine, tags, price_level,
        rating, eta_min, eta_max, description, photo, address, lat, lng,
        popularity, osm_value, raw_tags, is_active, created_by, updated_by)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22,$22)
     ON CONFLICT (id) DO UPDATE SET
       name        = EXCLUDED.name,
       name_fr     = EXCLUDED.name_fr,
       name_ar     = EXCLUDED.name_ar,
       name_en     = EXCLUDED.name_en,
       zone        = COALESCE(EXCLUDED.zone, restaurants.zone),
       cuisine     = COALESCE(EXCLUDED.cuisine, restaurants.cuisine),
       tags        = CASE WHEN cardinality(EXCLUDED.tags) > 0 THEN EXCLUDED.tags ELSE restaurants.tags END,
       price_level = COALESCE(EXCLUDED.price_level, restaurants.price_level),
       rating      = COALESCE(EXCLUDED.rating, restaurants.rating),
       eta_min     = COALESCE(EXCLUDED.eta_min, restaurants.eta_min),
       eta_max     = COALESCE(EXCLUDED.eta_max, restaurants.eta_max),
       description = COALESCE(EXCLUDED.description, restaurants.description),
       photo       = COALESCE(EXCLUDED.photo, restaurants.photo),
       address     = COALESCE(EXCLUDED.address, restaurants.address),
       lat         = EXCLUDED.lat,
       lng         = EXCLUDED.lng,
       popularity  = EXCLUDED.popularity,
       osm_value   = COALESCE(EXCLUDED.osm_value, restaurants.osm_value),
       raw_tags    = EXCLUDED.raw_tags,
       is_active   = EXCLUDED.is_active,
       updated_by  = EXCLUDED.updated_by,
       updated_at  = now()
     RETURNING *`,
    [
      id,
      input.name,
      input.nameFr ?? null,
      input.nameAr ?? null,
      input.nameEn ?? null,
      input.zone ?? null,
      input.cuisine ?? null,
      input.tags ?? [],
      input.priceLevel ?? null,
      input.rating ?? null,
      input.etaMin ?? null,
      input.etaMax ?? null,
      input.description ?? null,
      input.photo ?? null,
      input.address ?? null,
      input.lat,
      input.lng,
      input.popularity ?? 0,
      input.osmValue ?? null,
      JSON.stringify(input.rawTags ?? {}),
      input.isActive ?? true,
      actorId,
    ],
  );
  return toDto(rows[0]!);
}

async function uniqueSlugStandalone(name: string): Promise<string> {
  const candidate = slugify(name);
  let slug = candidate;
  let n = 1;
  for (;;) {
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM restaurants WHERE id = $1`,
      [slug],
    );
    if (!r.rows[0]) return slug;
    n += 1;
    slug = `${candidate}-${n}`;
  }
}

/**
 * Partial update. Only fields explicitly present in `patch` are touched.
 */
export async function patchRestaurant(
  id: string,
  patch: Partial<UpsertInput>,
  actorId: string | null,
): Promise<RestaurantDto | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };

  if (patch.name !== undefined) push('name', patch.name);
  if (patch.nameFr !== undefined) push('name_fr', patch.nameFr);
  if (patch.nameAr !== undefined) push('name_ar', patch.nameAr);
  if (patch.nameEn !== undefined) push('name_en', patch.nameEn);
  if (patch.zone !== undefined) push('zone', patch.zone);
  if (patch.cuisine !== undefined) push('cuisine', patch.cuisine);
  if (patch.tags !== undefined) push('tags', patch.tags);
  if (patch.priceLevel !== undefined) push('price_level', patch.priceLevel);
  if (patch.rating !== undefined) push('rating', patch.rating);
  if (patch.etaMin !== undefined) push('eta_min', patch.etaMin);
  if (patch.etaMax !== undefined) push('eta_max', patch.etaMax);
  if (patch.description !== undefined) push('description', patch.description);
  if (patch.photo !== undefined) push('photo', patch.photo);
  if (patch.address !== undefined) push('address', patch.address);
  if (patch.lat !== undefined) push('lat', patch.lat);
  if (patch.lng !== undefined) push('lng', patch.lng);
  if (patch.popularity !== undefined) push('popularity', patch.popularity);
  if (patch.isActive !== undefined) push('is_active', patch.isActive);

  if (sets.length === 0) return getRestaurant(id, true);

  params.push(actorId);
  sets.push(`updated_by = $${params.length}`);
  sets.push(`updated_at = now()`);

  params.push(id);
  const { rows } = await pool.query<RestaurantRow>(
    `UPDATE restaurants SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  return rows[0] ? toDto(rows[0]) : null;
}

export async function softDeleteRestaurant(id: string, actorId: string | null): Promise<boolean> {
  const r = await pool.query(
    `UPDATE restaurants SET is_active = false, updated_by = $1, updated_at = now() WHERE id = $2`,
    [actorId, id],
  );
  return (r.rowCount ?? 0) > 0;
}
