/**
 * POI search for the admin dispatcher, recycled from voice-location-api.
 *
 * The `voiceloc_pois` corpus (ingested from OpenStreetMap, migration 0012)
 * lives in this very database, so we query it directly with the main pool.
 *
 *   - searchPois(query)   → local trigram candidates (free, curated) merged
 *                           with an external geocoder complement (Google
 *                           Places when configured, else Nominatim).
 *   - autoSeedPoi(...)     → silently persist a chosen Google place into the
 *                           corpus so the next dispatcher finds it locally.
 *
 * This is the "POI logic recycled" half of retiring voice-location-api: the
 * fully-automated extractor/whisper pipeline goes away, but the corpus and
 * its self-improving auto-seed loop stay.
 */

import { pool } from '../../db/pool.js';
import { searchPlaces } from '../geocode/geocode.service.js';

export type PoiSource = 'local' | 'google' | 'nominatim';

export interface PoiCandidate {
  source: PoiSource;
  /** 'osm:<id>' / a Google place id / 'nominatim:<id>'. */
  placeId: string;
  name: string;
  /** Full address / descriptive label. */
  label: string;
  lat: number;
  lng: number;
  types: string[];
  /** Local-only: trigram similarity 0..1. */
  similarity?: number;
  /** Local-only: corpus popularity. */
  popularity?: number;
}

// ---------------------------------------------------------------------------
// Local corpus trigram search (ported from voice-location-api/services/pois)
// ---------------------------------------------------------------------------

interface LocalPoiRow {
  id: number;
  name_default: string;
  name_fr: string | null;
  name_ar: string | null;
  osm_kind: string;
  osm_value: string | null;
  lat: number;
  lng: number;
  popularity: number;
  google_place_id: string | null;
  similarity: number;
}

const LOCAL_MIN_SIMILARITY = 0.18;

export async function searchLocalPois(query: string, limit = 8): Promise<PoiCandidate[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  // GREATEST(similarity, word_similarity) lets a short Arabic/French query
  // match long bilingual POI names. The %/<% operators use the GIN trigram
  // index on search_text.
  const { rows } = await pool.query<LocalPoiRow>(
    `SELECT id, name_default, name_fr, name_ar,
            osm_kind, osm_value, lat, lng, popularity, google_place_id,
            GREATEST(similarity(search_text, $1), word_similarity($1, search_text)) AS similarity
       FROM voiceloc_pois
      WHERE search_text % $1 OR $1 <% search_text
      ORDER BY similarity DESC, popularity DESC
      LIMIT $2`,
    [q, limit * 3],
  );

  return rows
    .filter((r) => r.similarity >= LOCAL_MIN_SIMILARITY)
    .slice(0, limit)
    .map((r) => {
      const name = r.name_fr ?? r.name_default;
      const kind = r.osm_value ? `${r.osm_kind}=${r.osm_value}` : r.osm_kind;
      return {
        source: 'local' as const,
        // Prefer a Google id when we have one so confirm-time bumps line up.
        placeId: r.google_place_id ?? `osm:${r.id}`,
        name,
        label: `${name} · ${kind}`,
        lat: r.lat,
        lng: r.lng,
        types: [r.osm_kind, r.osm_value].filter((x): x is string => !!x),
        similarity: Number(r.similarity),
        popularity: r.popularity,
      };
    });
}

// ---------------------------------------------------------------------------
// Combined search: local corpus first, then an external complement.
// ---------------------------------------------------------------------------

export async function searchPois(
  query: string,
  opts: { proximity?: string; limit?: number } = {},
): Promise<{ candidates: PoiCandidate[]; local: number; external: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 15);

  const local = await searchLocalPois(query, limit);

  // External complement — best-effort. If the geocoder errors (e.g. Nominatim
  // rate-limit) we still return the local results.
  let external: PoiCandidate[] = [];
  try {
    const ext = await searchPlaces({ q: query, proximity: opts.proximity, limit });
    const seenGoogleIds = new Set(
      local.map((c) => c.placeId).filter((id) => !id.startsWith('osm:')),
    );
    external = ext
      .filter((g) => !seenGoogleIds.has(g.id))
      .map((g) => ({
        source: (g.id.startsWith('nominatim:') || /^\d+$/.test(g.id)
          ? 'nominatim'
          : 'google') as PoiSource,
        placeId: /^\d+$/.test(g.id) ? `nominatim:${g.id}` : g.id,
        name: g.name,
        label: g.label,
        lat: g.lat,
        lng: g.lng,
        types: g.types,
      }));
  } catch {
    external = [];
  }

  // Local first (curated + free), then external. Cap the merged list.
  const candidates = [...local, ...external].slice(0, limit + 5);
  return { candidates, local: local.length, external: external.length };
}

// ---------------------------------------------------------------------------
// Auto-seed (ported from voice-location-api/services/auto-seed)
// ---------------------------------------------------------------------------

/** Types that mean "a specific place" rather than a wide administrative region. */
const SPECIFIC_TYPES = new Set([
  'point_of_interest', 'establishment', 'premise', 'subpremise',
  'street_address', 'route', 'intersection', 'transit_station', 'bus_station',
  'airport', 'hospital', 'school', 'university', 'mosque', 'place_of_worship',
  'stadium', 'shopping_mall', 'store', 'restaurant', 'cafe', 'lodging',
  'museum', 'park', 'tourist_attraction',
]);

/** Types so vague we never want to seed (e.g. "country", "locality"). */
const BLOCKED_TYPES = new Set([
  'country', 'administrative_area_level_1', 'administrative_area_level_2',
  'administrative_area_level_3', 'continent', 'political',
]);

export interface AutoSeedInput {
  /** What the dispatcher searched/heard — kept for search_text. */
  query: string;
  placeId: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
  types: string[];
  source: PoiSource;
}

export interface AutoSeedOutcome {
  status: 'seeded' | 'updated' | 'skipped_local' | 'skipped_already_in_corpus' | 'skipped_low_quality';
  poiId: number | null;
}

/**
 * Silently persist a chosen external place into voiceloc_pois. Called at
 * confirm time for any pin the dispatcher took from Google. Local picks and
 * vague administrative results are skipped. Always soft-fails (never throws)
 * so it can't break the confirm flow.
 */
export async function autoSeedPoi(input: AutoSeedInput): Promise<AutoSeedOutcome> {
  try {
    // Only seed external picks; local ones are already in the corpus.
    if (input.source === 'local' || input.placeId.startsWith('osm:')) {
      return { status: 'skipped_local', poiId: null };
    }

    // Quality gates (mirrors voice-location-api): require at least one
    // specific type and reject pure administrative regions. Nominatim results
    // carry OSM class/type pairs which usually pass.
    const hasSpecific =
      input.types.length === 0 || input.types.some((t) => SPECIFIC_TYPES.has(t));
    const isBlocked =
      input.types.length > 0 && input.types.every((t) => BLOCKED_TYPES.has(t));
    if (!hasSpecific || isBlocked) {
      return { status: 'skipped_low_quality', poiId: null };
    }

    // Already in corpus by google_place_id?
    if (!input.placeId.startsWith('nominatim:')) {
      const existing = await pool.query<{ id: number }>(
        `SELECT id FROM voiceloc_pois WHERE google_place_id = $1 LIMIT 1`,
        [input.placeId],
      );
      if (existing.rows[0]) {
        return { status: 'skipped_already_in_corpus', poiId: existing.rows[0].id };
      }
    }

    const displayName = input.name || input.label.split(',')[0]?.trim() || input.label;
    const searchText = [input.query, input.name, input.label].join(' ').toLowerCase().trim();
    const kind = input.types.find((t) => SPECIFIC_TYPES.has(t)) ?? 'manual';
    const value = input.types.find((t) => !BLOCKED_TYPES.has(t) && t !== kind) ?? null;
    const googlePlaceId = input.placeId.startsWith('nominatim:') ? null : input.placeId;
    const synthOsmId = hashStringToNegativeInt(`${input.source}:${input.placeId}`);

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
         google_place_id = COALESCE(EXCLUDED.google_place_id, voiceloc_pois.google_place_id),
         popularity   = voiceloc_pois.popularity + 5,
         updated_at   = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [
        synthOsmId,
        displayName,
        displayName, // assume French — most picks in Mauritania are
        searchText,
        kind,
        value,
        input.lat,
        input.lng,
        30, // starter popularity (a confirmed pick is worth more than a raw geocode)
        googlePlaceId,
        JSON.stringify({
          source: `auto-seed-${input.source}`,
          types: input.types,
          label: input.label,
          original_query: input.query,
        }),
      ],
    );
    const row = rows[0]!;
    return { status: row.inserted ? 'seeded' : 'updated', poiId: row.id };
  } catch {
    // Never let corpus maintenance break a confirm.
    return { status: 'skipped_low_quality', poiId: null };
  }
}

/** Deterministic negative int from a string — matches ingest-poi-manual.ts. */
function hashStringToNegativeInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return -(Math.abs(h) || 1);
}
