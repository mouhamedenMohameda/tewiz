/**
 * Auto-seed the local POI corpus with high-confidence Google geocoding results.
 *
 * When the geocoder falls back to Google (the corpus didn't know the place),
 * and Google returns a precise, specific result, we persist it into
 * voiceloc_pois with osm_type='manual' and google_place_id set. The next
 * user saying the same thing is resolved locally — no extra Google call.
 *
 * Guardrails so we don't pollute the corpus with vague results:
 *   - Only when precision is "high" (ROOFTOP) or the viewport is small.
 *   - Only when types include something specific (point_of_interest,
 *     establishment, premise, named amenity) — NOT pure political /
 *     administrative bounds like "country" or "locality".
 *   - Skip if the same google_place_id is already in the corpus.
 */

import { pool } from '../db/pool.js';
import type { GeocodeResult } from './geocoder.js';

/**
 * Types that mean "a specific place" rather than a wide administrative
 * region. We require at least one of these in the Google result before
 * persisting.
 */
const SPECIFIC_TYPES = new Set([
  'point_of_interest',
  'establishment',
  'premise',
  'subpremise',
  'street_address',
  'route',
  'intersection',
  'transit_station',
  'bus_station',
  'airport',
  'hospital',
  'school',
  'university',
  'mosque',
  'place_of_worship',
  'stadium',
  'shopping_mall',
  'store',
  'restaurant',
  'cafe',
  'lodging',
  'museum',
  'park',
  'tourist_attraction',
]);

/** Types so vague we never want to seed (e.g. "country", "locality"). */
const BLOCKED_TYPES = new Set([
  'country',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'continent',
  'political', // alone — usually with locality
]);

/** Viewport bigger than this = too vague to be a single POI. */
const MAX_VIEWPORT_DIAGONAL_M = 1500;

export interface AutoSeedOutcome {
  status: 'seeded' | 'updated' | 'skipped_already_in_corpus' | 'skipped_low_quality';
  poi_id: number | null;
}

export async function autoSeedFromGoogle(
  originalQuery: string,
  geo: GeocodeResult,
): Promise<AutoSeedOutcome> {
  // Quality gates.
  const hasSpecific = geo.types.some((t) => SPECIFIC_TYPES.has(t));
  const isBlocked =
    geo.types.length > 0 && geo.types.every((t) => BLOCKED_TYPES.has(t));
  const viewportOk =
    geo.viewport_diagonal_m === null || geo.viewport_diagonal_m <= MAX_VIEWPORT_DIAGONAL_M;

  if (geo.precision !== 'high' || !hasSpecific || isBlocked || !viewportOk) {
    return { status: 'skipped_low_quality', poi_id: null };
  }

  // Already in corpus?
  const existing = await pool.query<{ id: number; popularity: number }>(
    `SELECT id, popularity FROM voiceloc_pois WHERE google_place_id = $1 LIMIT 1`,
    [geo.place_id],
  );
  if (existing.rows[0]) {
    return { status: 'skipped_already_in_corpus', poi_id: existing.rows[0].id };
  }

  // Build a meaningful name from the Google response. Prefer the head of
  // the formatted_address as a display name (Google returns POI name
  // first, then city, country), and search_text is the address itself,
  // lowercased.
  const displayName =
    geo.formatted_address.split(',')[0]?.trim() || geo.formatted_address;
  const searchText = [originalQuery, geo.formatted_address]
    .join(' ')
    .toLowerCase()
    .trim();

  const kind = geo.types.find((t) => SPECIFIC_TYPES.has(t)) ?? 'manual';
  const value = geo.types.find((t) => !BLOCKED_TYPES.has(t) && t !== kind) ?? null;

  const synthOsmId = hashStringToNegativeInt(`google:${geo.place_id}`);

  const { rows } = await pool.query<{ id: number; inserted: boolean }>(
    `INSERT INTO voiceloc_pois
       (osm_type, osm_id, name_default, name_fr, name_ar, name_en,
        search_text, osm_kind, osm_value, lat, lng, popularity,
        google_place_id, raw_tags)
     VALUES ('node', $1, $2, $3, NULL, NULL, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     ON CONFLICT (osm_type, osm_id) DO UPDATE SET
       name_default = EXCLUDED.name_default,
       name_fr      = EXCLUDED.name_fr,
       search_text  = EXCLUDED.search_text,
       lat          = EXCLUDED.lat,
       lng          = EXCLUDED.lng,
       google_place_id = EXCLUDED.google_place_id,
       updated_at   = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [
      synthOsmId,
      displayName,
      displayName, // assume French — most Google results in Mauritania are
      searchText,
      kind,
      value,
      geo.lat,
      geo.lng,
      // Starter popularity. A subsequent confirm bumps this up.
      25,
      geo.place_id,
      JSON.stringify({
        source: 'auto-seed-google',
        types: geo.types,
        formatted_address: geo.formatted_address,
        original_query: originalQuery,
      }),
    ],
  );

  const row = rows[0]!;
  return {
    status: row.inserted ? 'seeded' : 'updated',
    poi_id: row.id,
  };
}

// ---------------------------------------------------------------------------
// Popularity bump — called when a user confirms a place via /confirm.
// ---------------------------------------------------------------------------

export async function bumpPopularity(
  placeIdOrPoiId: string,
  delta: number = 5,
): Promise<{ updated: boolean; poi_id: number | null }> {
  // place_id can be 'osm:N', 'manual:N', or 'ChIJ...' (raw Google id).
  if (placeIdOrPoiId.startsWith('osm:') || placeIdOrPoiId.startsWith('manual:')) {
    const id = parseInt(placeIdOrPoiId.split(':', 2)[1] ?? '', 10);
    if (!Number.isFinite(id)) return { updated: false, poi_id: null };
    const { rows } = await pool.query<{ id: number }>(
      `UPDATE voiceloc_pois SET popularity = popularity + $1, updated_at = now()
        WHERE id = $2 RETURNING id`,
      [delta, id],
    );
    return { updated: !!rows[0], poi_id: rows[0]?.id ?? null };
  }

  // Otherwise treat as Google place_id.
  const { rows } = await pool.query<{ id: number }>(
    `UPDATE voiceloc_pois SET popularity = popularity + $1, updated_at = now()
      WHERE google_place_id = $2 RETURNING id`,
    [delta, placeIdOrPoiId],
  );
  return { updated: !!rows[0], poi_id: rows[0]?.id ?? null };
}

// ---------------------------------------------------------------------------
// Helper: deterministic negative int from a string (matches the convention
// used by ingest-poi-manual.ts for synthetic osm_id).
// ---------------------------------------------------------------------------

function hashStringToNegativeInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return -(Math.abs(h) || 1);
}
